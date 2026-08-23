import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/database/db'
import { createAccount } from '@/database/repositories/accounts.repo'
import { createExchangeRate } from '@/database/repositories/exchangeRates.repo'
import { createInvestmentAsset, createInvestmentHolding } from '@/database/repositories/investments.repo'
import { createAssetPrice } from '@/database/repositories/assetPrices.repo'
import { updateSettings } from '@/database/repositories/settings.repo'
import { minor, money } from '@/domain/money'
import {
  createSavingsHoldingFromForm,
  getNetWorthSummary,
  listSavingsHoldings,
  updateSavingsHoldingFromForm,
} from './service'

afterEach(async () => {
  await Promise.all([
    db.accounts.clear(),
    db.exchangeRates.clear(),
    db.settings.clear(),
    db.savingsHoldings.clear(),
    db.investmentAssets.clear(),
    db.investmentHoldings.clear(),
    db.assetPrices.clear(),
  ])
})

describe('createSavingsHoldingFromForm / updateSavingsHoldingFromForm', () => {
  it('parses the amount in the given currency and persists optional fields', async () => {
    const holding = await createSavingsHoldingFromForm({
      name: 'USD efectivo',
      currency: 'USD',
      amount: '2500',
      location: 'Casa',
    })
    expect(holding.amount).toBe(250_000) // "2500" parsed as major units -> 2500.00
    expect(holding.location).toBe('Casa')

    await updateSavingsHoldingFromForm(holding.id, { name: 'USD efectivo', currency: 'USD', amount: '3000' })
    const [updated] = await listSavingsHoldings()
    expect(updated?.amount).toBe(300_000)
  })

  it('can clear a previously-set location by editing it away, unlike create which just omits it', async () => {
    const holding = await createSavingsHoldingFromForm({
      name: 'USD efectivo',
      currency: 'USD',
      amount: '100',
      location: 'Casa',
    })

    await updateSavingsHoldingFromForm(holding.id, {
      name: 'USD efectivo',
      currency: 'USD',
      amount: '100',
      location: '',
    })

    const [updated] = await listSavingsHoldings()
    expect(updated?.location).toBeFalsy()
  })
})

describe('getNetWorthSummary', () => {
  it('consolidates accounts + savings into the display currency, with no investments yet', async () => {
    await createAccount({ name: 'Banco', type: 'bank', currency: 'ARS', openingBalance: minor(1_000_000) })
    await createSavingsHoldingFromForm({ name: 'USD efectivo', currency: 'USD', amount: '8000' })
    await createExchangeRate({ date: '2026-08-01', from: 'USD', to: 'ARS', rate: 1450 })
    await updateSettings({ baseCurrency: 'ARS' })

    const summary = await getNetWorthSummary()

    expect(summary.displayCurrency).toBe('ARS')
    // openingBalance is in minor units already: 1_000_000 minor = ARS 10.000,00.
    // 10.000 ARS + 8.000 USD * 1450 = 10.000 + 11.600.000 = 11.610.000
    expect(summary.total).toEqual(money(11_610_000_00, 'ARS'))
    expect(summary.byBucket.investments).toEqual(money(0, 'ARS'))
    expect(summary.missingRateCount).toBe(0)
    expect(summary.missingPriceCount).toBe(0)
  })

  it('respects an explicit display currency override without touching stored amounts', async () => {
    await createAccount({ name: 'Banco', type: 'bank', currency: 'ARS', openingBalance: minor(1_450_00) })
    await createExchangeRate({ date: '2026-08-01', from: 'USD', to: 'ARS', rate: 1450 })

    const summary = await getNetWorthSummary('USD')
    expect(summary.displayCurrency).toBe('USD')
    expect(summary.total).toEqual(money(100, 'USD'))
  })

  it('includes investment positions, valuing quantity x price before converting', async () => {
    await createExchangeRate({ date: '2026-08-01', from: 'USD', to: 'ARS', rate: 1450 })
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    await createInvestmentHolding({ assetId: asset.id, quantity: 500_000_000 }) // 5 shares
    await createAssetPrice({ assetId: asset.id, price: 650_00, currency: 'USD', date: '2026-08-01', source: 'manual' })

    const summary = await getNetWorthSummary('ARS')
    // 5 * 650 USD = 3.250 USD -> * 1450 = 4.712.500 ARS
    expect(summary.byBucket.investments).toEqual(money(4_712_500_00, 'ARS'))
    expect(summary.missingPriceCount).toBe(0)
  })

  it('counts a holding with no price as missingPriceCount, not a zero value', async () => {
    const asset = await createInvestmentAsset({ name: 'Sin precio', type: 'stock', currency: 'USD', priceMode: 'manual' })
    await createInvestmentHolding({ assetId: asset.id, quantity: 100_000_000 })

    const summary = await getNetWorthSummary('ARS')
    expect(summary.missingPriceCount).toBe(1)
    expect(summary.byBucket.investments).toEqual(money(0, 'ARS'))
  })

  it('excludes an account with no usable rate and counts the miss', async () => {
    await createAccount({ name: 'Cuenta EUR', type: 'bank', currency: 'EUR', openingBalance: minor(100_00) })

    const summary = await getNetWorthSummary('ARS')
    expect(summary.missingRateCount).toBe(1)
    expect(summary.total).toEqual(money(0, 'ARS'))
  })
})
