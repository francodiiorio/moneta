import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchFrankfurterRate } from './frankfurter'

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: () => Promise.resolve(body) } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchFrankfurterRate', () => {
  it('returns a rate on a valid response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ date: '2026-08-24', base: 'EUR', quote: 'USD', rate: 1.1691 })),
    )
    const quote = await fetchFrankfurterRate('EUR', 'USD')
    expect(quote).toEqual({ from: 'EUR', to: 'USD', rate: 1.1691, date: '2026-08-24' })
  })

  it('returns undefined on a non-OK HTTP response, without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false)))
    await expect(fetchFrankfurterRate('EUR', 'USD')).resolves.toBeUndefined()
  })

  it('returns undefined when the response shape is unexpected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ unexpected: true })))
    await expect(fetchFrankfurterRate('EUR', 'USD')).resolves.toBeUndefined()
  })

  it('returns undefined instead of throwing when the request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    await expect(fetchFrankfurterRate('EUR', 'USD')).resolves.toBeUndefined()
  })

  it('returns undefined on a timeout (AbortError)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'AbortError')),
    )
    await expect(fetchFrankfurterRate('EUR', 'USD')).resolves.toBeUndefined()
  })
})
