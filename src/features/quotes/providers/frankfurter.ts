import { z } from 'zod'
import type { RateQuote } from './types'

/**
 * One of the few places in the app that makes a network request — see
 * "Cotizaciones automáticas, opt-in" in docs/DECISIONS.md and the
 * `CLAUDE.md` privacy grep exclusion for this directory. Only ever called
 * when `Settings.autoQuotesEnabled` is true; sends nothing but the two
 * currency codes, never any user data.
 *
 * Frankfurter (https://frankfurter.dev) is a free, key-less, CORS-enabled
 * FX rate API backed by ECB reference rates — verified against its live
 * docs and a real request before wiring this up (see docs/DECISIONS.md).
 */
const responseSchema = z.object({
  date: z.string(),
  base: z.string(),
  quote: z.string(),
  rate: z.number().positive(),
})

/** Never throws — a network failure, timeout, or unexpected response
 *  shape all just mean "no quote this time"; the caller keeps whatever
 *  rate was already loaded. */
export async function fetchFrankfurterRate(from: string, to: string): Promise<RateQuote | undefined> {
  try {
    const response = await fetch(`https://api.frankfurter.dev/v2/rate/${from}/${to}`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return undefined

    const parsed = responseSchema.safeParse(await response.json())
    if (!parsed.success) return undefined

    return { from: parsed.data.base, to: parsed.data.quote, rate: parsed.data.rate, date: parsed.data.date }
  } catch {
    return undefined
  }
}
