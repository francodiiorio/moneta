import { z } from 'zod'
import type { RateQuote } from './types'

/** One of the few places in the app that makes a network request — see
 *  frankfurter.ts's docblock for the privacy rationale, which applies
 *  here identically.
 *
 *  dolarapi.com (https://dolarapi.com) is a free, key-less, CORS-enabled
 *  API for Argentine USD/ARS references — verified against a real
 *  request before wiring this up (see docs/DECISIONS.md). It's the only
 *  provider used for this: Argentina has no single "USD/ARS rate", and
 *  this is the source that actually distinguishes oficial/blue/MEP/CCL/
 *  etc, unlike a general FX API. */

const CASA_TO_PROFILE: Record<string, string> = {
  oficial: 'oficial',
  blue: 'blue',
  bolsa: 'mep',
  contadoconliqui: 'ccl',
  cripto: 'cripto',
  mayorista: 'mayorista',
  tarjeta: 'tarjeta',
}

const rowSchema = z.object({
  moneda: z.string(),
  casa: z.string(),
  venta: z.number(),
  fechaActualizacion: z.string(),
})

const responseSchema = z.array(rowSchema)

/** Never throws — see fetchFrankfurterRate's docblock for why. Returns
 *  one `RateQuote` per referencia (oficial/blue/mep/...), always
 *  USD -> ARS. Uses `venta` (what it costs to buy USD) as the
 *  representative figure — the closest single number to "what this
 *  reference is worth" for valuing a net worth in ARS. */
export async function fetchDolarApiRates(): Promise<RateQuote[]> {
  try {
    const response = await fetch('https://dolarapi.com/v1/dolares', { signal: AbortSignal.timeout(8000) })
    if (!response.ok) return []

    const parsed = responseSchema.safeParse(await response.json())
    if (!parsed.success) return []

    return parsed.data
      .filter((row) => row.moneda === 'USD' && row.venta > 0)
      .map((row) => ({
        from: 'USD',
        to: 'ARS',
        rate: row.venta,
        date: row.fechaActualizacion.slice(0, 10),
        profile: CASA_TO_PROFILE[row.casa] ?? row.casa,
      }))
  } catch {
    return []
  }
}
