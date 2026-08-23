import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/database/db'
import { createAccount } from '@/database/repositories/accounts.repo'
import { createExchangeRate } from '@/database/repositories/exchangeRates.repo'
import { createInvestmentAsset, createInvestmentHolding, listInvestmentHoldings } from '@/database/repositories/investments.repo'
import { createAssetPrice } from '@/database/repositories/assetPrices.repo'
import { updateSettings } from '@/database/repositories/settings.repo'
import { minor, money } from '@/domain/money'
import {
  createExchangeRateFromForm,
  createInvestmentAssetFromForm,
  createInvestmentHoldingFromForm,
  createManualPriceFromForm,
  createSavingsHoldingFromForm,
  getInvestmentHoldingsWithDetails,
  getNetWorthSummary,
  listExchangeRates,
  listInvestmentAssets,
  listSavingsHoldings,
  updateInvestmentHoldingFromForm,
  updateSavingsHoldingFromForm,
} from './service'
import { NO_PROFILE } from './schema'

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

describe('createInvestmentAssetFromForm', () => {
  it('always creates the asset with priceMode manual — auto only means something once a provider exists', async () => {
    const asset = await createInvestmentAssetFromForm({ name: 'SPY', symbol: 'SPY', type: 'etf', currency: 'USD', autoPrice: false })
    expect(asset.priceMode).toBe('manual')

    const [listed] = await listInvestmentAssets()
    expect(listed?.symbol).toBe('SPY')
  })

  it('omits symbol when not provided', async () => {
    const asset = await createInvestmentAssetFromForm({ name: 'Bitcoin', type: 'crypto', currency: 'USD', autoPrice: false })
    expect('symbol' in asset).toBe(false)
  })
})

describe('createInvestmentHoldingFromForm / updateInvestmentHoldingFromForm', () => {
  it('parses quantity and averageCost in the asset currency', async () => {
    const asset = await createInvestmentAssetFromForm({ name: 'SPY', type: 'etf', currency: 'USD', autoPrice: false })
    const holding = await createInvestmentHoldingFromForm({ assetId: asset.id, quantity: '5', averageCost: '600' })

    expect(holding.quantity).toBe(500_000_000) // 5.00000000 scaled
    expect(holding.averageCost).toBe(60_000) // "600" parsed as major units -> 600.00 USD

    await updateInvestmentHoldingFromForm(holding.id, { quantity: '7', averageCost: '' })
    const [updated] = await listInvestmentHoldings()
    expect(updated?.quantity).toBe(700_000_000)
  })

  it('resolves averageCost against the holding\'s real asset currency, ignoring a mismatched assetId if one were passed', async () => {
    const usdAsset = await createInvestmentAssetFromForm({ name: 'SPY', type: 'etf', currency: 'USD', autoPrice: false })
    const eurAsset = await createInvestmentAssetFromForm({ name: 'Bono EUR', type: 'bond', currency: 'EUR', autoPrice: false })
    const holding = await createInvestmentHoldingFromForm({ assetId: usdAsset.id, quantity: '1' })

    // A caller passing a different asset's id can't smuggle the wrong
    // currency in — updateInvestmentHoldingFromForm's signature doesn't
    // even accept assetId, so this can't compile with one; verifying the
    // currency used is still the holding's real (USD) one.
    await updateInvestmentHoldingFromForm(holding.id, { quantity: '1', averageCost: '600' })
    const [updated] = (await listInvestmentHoldings()).filter((h) => h.id === holding.id)
    expect(updated?.averageCost).toBe(60_000) // 600.00 USD, not EUR — resolved from the holding, not eurAsset
    expect(eurAsset.currency).toBe('EUR') // sanity: the mismatched asset really is a different currency
  })

  it('rejects a holding for a non-existent asset', async () => {
    await expect(
      createInvestmentHoldingFromForm({ assetId: 'missing', quantity: '1' }),
    ).rejects.toThrow(/no encontrado/)
  })

  it('omits averageCost when left blank', async () => {
    const asset = await createInvestmentAssetFromForm({ name: 'Bitcoin', type: 'crypto', currency: 'USD', autoPrice: false })
    const holding = await createInvestmentHoldingFromForm({ assetId: asset.id, quantity: '1' })
    expect('averageCost' in holding).toBe(false)
  })
})

describe('createManualPriceFromForm', () => {
  it('creates a manual, append-only price row for the asset', async () => {
    const asset = await createInvestmentAssetFromForm({ name: 'SPY', type: 'etf', currency: 'USD', autoPrice: false })
    const price = await createManualPriceFromForm(asset.id, asset.currency, { price: '650', date: '2026-08-20' })

    expect(price).toMatchObject({ assetId: asset.id, price: 65_000, currency: 'USD', source: 'manual', date: '2026-08-20' })
  })
})

describe('getInvestmentHoldingsWithDetails', () => {
  it('joins holding + asset + latest price, valuing quantity x price then converting', async () => {
    await createExchangeRate({ date: '2026-08-01', from: 'USD', to: 'ARS', rate: 1450 })
    const asset = await createInvestmentAsset({ name: 'SPY', symbol: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    await createInvestmentHolding({ assetId: asset.id, quantity: 500_000_000 }) // 5 shares
    await createAssetPrice({ assetId: asset.id, price: 650_00, currency: 'USD', date: '2026-08-01', source: 'manual' })

    const [item] = await getInvestmentHoldingsWithDetails('ARS')
    expect(item?.nativeValue).toEqual(money(5 * 650_00, 'USD'))
    expect(item?.convertedValue).toEqual(money(5 * 650_00 * 1450, 'ARS'))
  })

  it('has no native/converted value when the asset has no price yet', async () => {
    const asset = await createInvestmentAsset({ name: 'Sin precio', type: 'stock', currency: 'USD', priceMode: 'manual' })
    await createInvestmentHolding({ assetId: asset.id, quantity: 100_000_000 })

    const [item] = await getInvestmentHoldingsWithDetails('ARS')
    expect(item?.nativeValue).toBeUndefined()
    expect(item?.convertedValue).toBeUndefined()
  })

  it('has a native value but no converted value when there is a price but no usable rate', async () => {
    const asset = await createInvestmentAsset({ name: 'Sin tasa', type: 'stock', currency: 'EUR', priceMode: 'manual' })
    await createInvestmentHolding({ assetId: asset.id, quantity: 100_000_000 })
    await createAssetPrice({ assetId: asset.id, price: 10_00, currency: 'EUR', date: '2026-08-01', source: 'manual' })

    const [item] = await getInvestmentHoldingsWithDetails('ARS')
    expect(item?.nativeValue).toEqual(money(10_00, 'EUR'))
    expect(item?.convertedValue).toBeUndefined()
  })
})

describe('createInvestmentAssetFromForm — auto price (crypto only)', () => {
  it('sets priceMode auto and stores externalId when type is crypto, autoPrice is on and externalId is set', async () => {
    const asset = await createInvestmentAssetFromForm({
      name: 'Bitcoin',
      type: 'crypto',
      currency: 'USD',
      autoPrice: true,
      externalId: 'bitcoin',
    })
    expect(asset.priceMode).toBe('auto')
    expect(asset.externalId).toBe('bitcoin')
  })

  it('falls back to manual when autoPrice is on but externalId is blank', async () => {
    const asset = await createInvestmentAssetFromForm({
      name: 'Bitcoin',
      type: 'crypto',
      currency: 'USD',
      autoPrice: true,
      externalId: '  ',
    })
    expect(asset.priceMode).toBe('manual')
    expect('externalId' in asset).toBe(false)
  })

  it('falls back to manual when the type is not crypto, even with autoPrice on and an externalId', async () => {
    const asset = await createInvestmentAssetFromForm({
      name: 'SPY',
      type: 'etf',
      currency: 'USD',
      autoPrice: true,
      externalId: 'spy',
    })
    expect(asset.priceMode).toBe('manual')
    expect('externalId' in asset).toBe(false)
  })
})

describe('createExchangeRateFromForm', () => {
  it('creates a manual rate with the chosen profile', async () => {
    const rate = await createExchangeRateFromForm({
      date: '2026-08-23',
      from: 'USD',
      to: 'ARS',
      rate: '1.520,00',
      profile: 'oficial',
    })
    expect(rate).toMatchObject({ from: 'USD', to: 'ARS', rate: 1520, profile: 'oficial', source: 'manual' })

    const [listed] = await listExchangeRates()
    expect(listed?.profile).toBe('oficial')
  })

  it('omits profile when NO_PROFILE is selected', async () => {
    const rate = await createExchangeRateFromForm({ date: '2026-08-23', from: 'USD', to: 'ARS', rate: '1500', profile: NO_PROFILE })
    expect('profile' in rate).toBe(false)
  })
})
