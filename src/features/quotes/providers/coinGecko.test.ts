import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchCoinGeckoPrices } from './coinGecko'

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: () => Promise.resolve(body) } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchCoinGeckoPrices', () => {
  it('returns [] without calling fetch when there are no coin ids', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchCoinGeckoPrices([])).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps each coin id to a PriceQuote in USD', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ bitcoin: { usd: 77408 }, ethereum: { usd: 2448.6 } })))
    const quotes = await fetchCoinGeckoPrices(['bitcoin', 'ethereum'])

    expect(quotes).toHaveLength(2)
    expect(quotes.every((q) => typeof q.date === 'string' && q.date.length > 0)).toBe(true)
    expect(quotes.map((q) => ({ externalId: q.externalId, price: q.price, currency: q.currency }))).toEqual(
      expect.arrayContaining([
        { externalId: 'bitcoin', price: 77408, currency: 'USD' },
        { externalId: 'ethereum', price: 2448.6, currency: 'USD' },
      ]),
    )
  })

  it('filters out a coin with a zero price', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ deadcoin: { usd: 0 } })))
    await expect(fetchCoinGeckoPrices(['deadcoin'])).resolves.toEqual([])
  })

  it('returns [] on a non-OK HTTP response, without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false)))
    await expect(fetchCoinGeckoPrices(['bitcoin'])).resolves.toEqual([])
  })

  it('returns [] when the response shape is unexpected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ bitcoin: 'not an object' })))
    await expect(fetchCoinGeckoPrices(['bitcoin'])).resolves.toEqual([])
  })

  it('returns [] instead of throwing when the request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    await expect(fetchCoinGeckoPrices(['bitcoin'])).resolves.toEqual([])
  })
})
