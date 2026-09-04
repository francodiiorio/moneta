import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchData912CedearPrices } from './data912'

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: () => Promise.resolve(body) } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchData912CedearPrices', () => {
  it('maps every row to a PriceQuote in ARS, keyed by its BYMA symbol', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse([
          { symbol: 'KO', c: 28220 },
          { symbol: 'SPY', c: 20400 },
        ]),
      ),
    )
    const quotes = await fetchData912CedearPrices()

    expect(quotes).toHaveLength(2)
    expect(quotes.every((q) => typeof q.date === 'string' && q.date.length > 0)).toBe(true)
    expect(quotes.map((q) => ({ externalId: q.externalId, price: q.price, currency: q.currency }))).toEqual(
      expect.arrayContaining([
        { externalId: 'KO', price: 28220, currency: 'ARS' },
        { externalId: 'SPY', price: 20400, currency: 'ARS' },
      ]),
    )
  })

  it('filters out a row with a zero or negative price', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([{ symbol: 'DEAD', c: 0 }])))
    await expect(fetchData912CedearPrices()).resolves.toEqual([])
  })

  it('returns [] on a non-OK HTTP response, without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([], false)))
    await expect(fetchData912CedearPrices()).resolves.toEqual([])
  })

  it('returns [] when the response shape is unexpected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ not: 'an array' })))
    await expect(fetchData912CedearPrices()).resolves.toEqual([])
  })

  it('returns [] instead of throwing when the request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    await expect(fetchData912CedearPrices()).resolves.toEqual([])
  })
})
