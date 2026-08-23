import { exchangeRatesRepo } from '@/database/repositories'
import type { ExchangeRate } from '@/domain/entities'
import { rateValueToNumber, type ExchangeRateFormValues } from './schema'

export { listExchangeRates, deleteExchangeRate } from '@/database/repositories/exchangeRates.repo'

export async function createExchangeRateFromForm(values: ExchangeRateFormValues): Promise<ExchangeRate> {
  return exchangeRatesRepo.createExchangeRate({
    date: values.date,
    from: values.from,
    to: values.to,
    rate: rateValueToNumber(values.rate),
  })
}
