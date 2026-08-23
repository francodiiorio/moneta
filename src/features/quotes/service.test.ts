import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/database/db'
import { createInvestmentAsset } from '@/database/repositories/investments.repo'
import { listExchangeRates } from '@/database/repositories/exchangeRates.repo'
import { listAssetPrices } from '@/database/repositories/assetPrices.repo'
import { getSettings } from '@/database/repositories/settings.repo'
import { isStale, refreshQuotes, STALE_HOURS } from './service'

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: () => Promise.resolve(body) } as Response
}

function stubFetch(overrides: { dolar?: unknown; frankfurter?: unknown; coingecko?: unknown } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.includes('dolarapi.com')) {
        return Promise.resolve(
          jsonResponse(
            overrides.dolar ?? [
              { moneda: 'USD', casa: 'oficial', venta: 1520, fechaActualizacion: '2026-08-23T00:00:00.000Z' },
              { moneda: 'USD', casa: 'blue', venta: 1550, fechaActualizacion: '2026-08-23T00:00:00.000Z' },
            ],
          ),
        )
      }
      if (url.includes('frankfurter.dev')) {
        return Promise.resolve(
          jsonResponse(overrides.frankfurter ?? { date: '2026-08-24', base: 'EUR', quote: 'USD', rate: 1.17 }),
        )
      }
      if (url.includes('coingecko.com')) {
        return Promise.resolve(jsonResponse(overrides.coingecko ?? {}))
      }
      return Promise.resolve(jsonResponse({}, false))
    }),
  )
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all([db.exchangeRates.clear(), db.investmentAssets.clear(), db.assetPrices.clear(), db.settings.clear()])
})

describe('isStale', () => {
  it('is stale when never captured', () => {
    expect(isStale(undefined)).toBe(true)
  })

  it('is not stale just now', () => {
    expect(isStale(new Date().toISOString())).toBe(false)
  })

  it('is stale past the given window', () => {
    const past = new Date(Date.now() - (STALE_HOURS + 1) * 60 * 60 * 1000).toISOString()
    expect(isStale(past)).toBe(true)
  })

  it('is not stale just under the given window', () => {
    const recent = new Date(Date.now() - (STALE_HOURS - 1) * 60 * 60 * 1000).toISOString()
    expect(isStale(recent)).toBe(false)
  })
})

describe('refreshQuotes', () => {
  it('writes a rate per dolarapi casa and one for EUR/USD, all source automatic', async () => {
    stubFetch()
    const result = await refreshQuotes()

    expect(result.ratesAdded).toBe(3) // oficial + blue + EUR/USD
    expect(result.failed).toEqual([])

    const rates = await listExchangeRates()
    expect(rates).toHaveLength(3)
    expect(rates.every((r) => r.source === 'automatic')).toBe(true)
    expect(rates.map((r) => r.profile).sort()).toEqual(['blue', 'oficial', undefined].sort())
    expect(rates.find((r) => r.from === 'EUR')).toMatchObject({ from: 'EUR', to: 'USD', rate: 1.17 })
  })

  it('updates Settings.quotesRefreshedAt even when every provider fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const before = await getSettings()
    expect(before.quotesRefreshedAt).toBeUndefined()

    const result = await refreshQuotes()
    expect(result).toEqual({ ratesAdded: 0, pricesAdded: 0, failed: ['dolarapi', 'frankfurter'] })

    const after = await getSettings()
    expect(after.quotesRefreshedAt).toBeDefined()
    expect(isStale(after.quotesRefreshedAt)).toBe(false)
  })

  it('never writes a rate or deletes anything when a provider fails — only adds what succeeded', async () => {
    stubFetch({ frankfurter: { unexpected: 'shape' } })
    const result = await refreshQuotes()

    expect(result.failed).toEqual(['frankfurter'])
    expect(result.ratesAdded).toBe(2) // dolarapi still wrote its two rows
    const rates = await listExchangeRates()
    expect(rates.every((r) => r.to === 'ARS')).toBe(true) // no EUR/USD row got written
  })

  it('only fetches and writes crypto prices for auto-priceMode assets with an externalId', async () => {
    const autoAsset = await createInvestmentAsset({
      name: 'Bitcoin',
      type: 'crypto',
      currency: 'USD',
      priceMode: 'auto',
      externalId: 'bitcoin',
    })
    await createInvestmentAsset({ name: 'Ethereum', type: 'crypto', currency: 'USD', priceMode: 'manual' })

    stubFetch({ coingecko: { bitcoin: { usd: 77000 } } })
    const result = await refreshQuotes()

    expect(result.pricesAdded).toBe(1)
    const prices = await listAssetPrices(autoAsset.id)
    expect(prices).toHaveLength(1)
    expect(prices[0]).toMatchObject({ price: 77_000_00, currency: 'USD', source: 'automatic' })
  })

  it('does not call CoinGecko at all when there are no auto-priceMode crypto assets', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('coingecko.com')) throw new Error('should not be called')
      return Promise.resolve(jsonResponse([], false))
    })
    vi.stubGlobal('fetch', fetchMock)

    await refreshQuotes()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('coingecko.com'))).toBe(false)
  })

  // Regression: a Map keyed by externalId used to silently drop every
  // asset but the last whenever two assets shared the same CoinGecko id
  // (e.g. the same coin held in two different wallets, tracked as two
  // separate InvestmentAssets).
  it('writes a price for every auto asset that shares the same externalId, not just one', async () => {
    const exchangeHolding = await createInvestmentAsset({
      name: 'Bitcoin — exchange',
      type: 'crypto',
      currency: 'USD',
      priceMode: 'auto',
      externalId: 'bitcoin',
    })
    const coldStorage = await createInvestmentAsset({
      name: 'Bitcoin — cold storage',
      type: 'crypto',
      currency: 'USD',
      priceMode: 'auto',
      externalId: 'bitcoin',
    })

    stubFetch({ coingecko: { bitcoin: { usd: 77000 } } })
    const result = await refreshQuotes()

    expect(result.pricesAdded).toBe(2)
    expect(await listAssetPrices(exchangeHolding.id)).toHaveLength(1)
    expect(await listAssetPrices(coldStorage.id)).toHaveLength(1)
  })

  it('skips a crypto price that rounds to zero in the asset currency, instead of throwing or writing a corrupt value', async () => {
    const asset = await createInvestmentAsset({
      name: 'Micro Coin',
      type: 'crypto',
      currency: 'USD',
      priceMode: 'auto',
      externalId: 'microcoin',
    })

    // Small enough that String() would produce scientific notation —
    // exactly the case moneyFromNumber exists to handle safely.
    stubFetch({ coingecko: { microcoin: { usd: 1.2e-7 } } })
    const result = await refreshQuotes()

    expect(result.pricesAdded).toBe(0)
    expect(await listAssetPrices(asset.id)).toEqual([])
  })
})
