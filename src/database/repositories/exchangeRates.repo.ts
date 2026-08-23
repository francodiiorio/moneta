import { db } from '../db'
import type { ExchangeRate } from '@/domain/entities'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'

export interface CreateExchangeRateInput {
  date: ExchangeRate['date']
  from: ExchangeRate['from']
  to: ExchangeRate['to']
  rate: number
}

export async function listExchangeRates(): Promise<ExchangeRate[]> {
  const rates = await db.exchangeRates.orderBy('date').toArray()
  return rates.reverse() // most recent first, for display
}

export async function createExchangeRate(input: CreateExchangeRateInput): Promise<ExchangeRate> {
  // Defense in depth, same as validateLedgerEntry for transactions — the
  // form already validates this, but the repo shouldn't trust every future
  // caller to (e.g. a backup import calling this directly).
  invariant(input.rate > 0, `La tasa debe ser mayor a cero, recibido: ${input.rate}`)
  invariant(input.from !== input.to, 'La moneda de origen y destino deben ser distintas')

  const rate: ExchangeRate = { id: generateId(), ...input }
  await db.exchangeRates.add(rate)
  return rate
}

export async function deleteExchangeRate(id: string): Promise<void> {
  await db.exchangeRates.delete(id)
}
