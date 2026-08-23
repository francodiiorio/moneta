import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchDolarApiRates } from './dolarApi'

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: () => Promise.resolve(body) } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const SAMPLE_ROWS = [
  { moneda: 'USD', casa: 'oficial', nombre: 'Oficial', compra: 1470, venta: 1520, fechaActualizacion: '2026-08-21T18:55:00.000Z' },
  { moneda: 'USD', casa: 'bolsa', nombre: 'MEP', compra: 1540, venta: 1545.3, fechaActualizacion: '2026-08-23T20:00:00.000Z' },
  { moneda: 'USD', casa: 'contadoconliqui', nombre: 'CCL', compra: 1580, venta: 1589.7, fechaActualizacion: '2026-08-23T20:00:00.000Z' },
]

describe('fetchDolarApiRates', () => {
  it('maps each casa to a RateQuote, translating bolsa/contadoconliqui to mep/ccl', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(SAMPLE_ROWS)))
    const quotes = await fetchDolarApiRates()

    expect(quotes).toEqual([
      { from: 'USD', to: 'ARS', rate: 1520, date: '2026-08-21', profile: 'oficial' },
      { from: 'USD', to: 'ARS', rate: 1545.3, date: '2026-08-23', profile: 'mep' },
      { from: 'USD', to: 'ARS', rate: 1589.7, date: '2026-08-23', profile: 'ccl' },
    ])
  })

  it('passes through an unmapped casa name as-is instead of dropping the row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse([
          { moneda: 'USD', casa: 'algunReferenciaFutura', venta: 1000, fechaActualizacion: '2026-08-23T00:00:00.000Z' },
        ]),
      ),
    )
    const quotes = await fetchDolarApiRates()
    expect(quotes[0]?.profile).toBe('algunReferenciaFutura')
  })

  it('filters out a row with venta <= 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse([{ moneda: 'USD', casa: 'oficial', venta: 0, fechaActualizacion: '2026-08-23T00:00:00.000Z' }]),
      ),
    )
    await expect(fetchDolarApiRates()).resolves.toEqual([])
  })

  it('returns [] on a non-OK HTTP response, without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([], false)))
    await expect(fetchDolarApiRates()).resolves.toEqual([])
  })

  it('returns [] when the response shape is unexpected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ not: 'an array' })))
    await expect(fetchDolarApiRates()).resolves.toEqual([])
  })

  it('returns [] instead of throwing when the request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    await expect(fetchDolarApiRates()).resolves.toEqual([])
  })
})
