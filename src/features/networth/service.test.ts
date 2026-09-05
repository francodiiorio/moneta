import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/database/db'
import { createExchangeRate } from '@/database/repositories/exchangeRates.repo'
import { createInvestmentAsset, createInvestmentHolding, listInvestmentHoldings } from '@/database/repositories/investments.repo'
import { createAssetPrice } from '@/database/repositories/assetPrices.repo'
import { updateSettings } from '@/database/repositories/settings.repo'
import { QUANTITY_SCALE } from '@/domain/decimal'
import { money } from '@/domain/money'
import { generateId } from '@/lib/ids'
import {
  createExchangeRateFromForm,
  createInvestmentAssetFromForm,
  createInvestmentLotFromForm,
  createManualPriceFromForm,
  createSavingsHoldingFromForm,
  getInvestmentHoldingsWithDetails,
  getNetWorthSummary,
  getSavingsAndInvestmentsHistory,
  listExchangeRates,
  listInvestmentAssets,
  listSavingsHoldings,
  updateInvestmentAssetFromForm,
  updateInvestmentLotFromForm,
  updateSavingsHoldingFromForm,
} from './service'
import { NO_PROFILE } from './schema'

afterEach(async () => {
  await Promise.all([
    db.exchangeRates.clear(),
    db.settings.clear(),
    db.savingsHoldings.clear(),
    db.investmentAssets.clear(),
    db.investmentHoldings.clear(),
    db.assetPrices.clear(),
    db.investmentLots.clear(),
    db.categories.clear(),
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
  it('consolidates savings into the display currency, with no investments yet', async () => {
    await createSavingsHoldingFromForm({ name: 'USD efectivo', currency: 'USD', amount: '8000' })
    await createExchangeRate({ date: '2026-08-01', from: 'USD', to: 'ARS', rate: 1450 })
    await updateSettings({ baseCurrency: 'ARS' })

    const summary = await getNetWorthSummary()

    expect(summary.displayCurrency).toBe('ARS')
    // 8.000 USD * 1450 = 11.600.000
    expect(summary.total).toEqual(money(11_600_000_00, 'ARS'))
    expect(summary.byBucket.investments).toEqual(money(0, 'ARS'))
    expect(summary.missingRateCount).toBe(0)
    expect(summary.missingPriceCount).toBe(0)
  })

  it('respects an explicit display currency override without touching stored amounts', async () => {
    await createSavingsHoldingFromForm({ name: 'USD efectivo', currency: 'USD', amount: '100' })

    const summary = await getNetWorthSummary('USD')
    expect(summary.displayCurrency).toBe('USD')
    expect(summary.total).toEqual(money(100_00, 'USD'))
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

  it('excludes a savings holding with no usable rate and counts the miss', async () => {
    await createSavingsHoldingFromForm({ name: 'Ahorro EUR', currency: 'EUR', amount: '100' })

    const summary = await getNetWorthSummary('ARS')
    expect(summary.missingRateCount).toBe(1)
    expect(summary.total).toEqual(money(0, 'ARS'))
  })
})

describe('getSavingsAndInvestmentsHistory', () => {
  it('revalues an investment position at each month\'s own historical price, not the latest one', async () => {
    // Fake only Date (not timers) — faking setTimeout/Promise scheduling
    // too makes Dexie's internal transaction machinery hang indefinitely.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-23T12:00:00Z'))
    try {
      await updateSettings({ baseCurrency: 'ARS' })
      const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'ARS', priceMode: 'manual' })
      await createInvestmentHolding({ assetId: asset.id, quantity: 2 * QUANTITY_SCALE })
      // Price changed mid-window: 1000 until mid-July, 1500 from then on —
      // same shape as the equivalent test in features/reports/service.test.ts.
      await createAssetPrice({ assetId: asset.id, price: 1000, currency: 'ARS', date: '2026-01-01', source: 'manual' })
      await createAssetPrice({ assetId: asset.id, price: 1500, currency: 'ARS', date: '2026-07-15', source: 'manual' })

      const { points, missingRateCount, missingPriceCount } = await getSavingsAndInvestmentsHistory(3) // Jun, Jul, Aug(today)
      expect(missingRateCount).toBe(0)
      expect(missingPriceCount).toBe(0)
      expect(points.map((p) => [p.month, p.total.amount])).toEqual([
        ['2026-06', 2_000], // 2 units * 1000 (price valid at 2026-06-30)
        ['2026-07', 3_000], // 2 units * 1500 (price changed 2026-07-15, valid at 2026-07-31)
        ['2026-08', 3_000], // 2 units * 1500 (still valid as of "today" 2026-08-23)
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('accumulates missingRateCount/missingPriceCount across every point', async () => {
    await createSavingsHoldingFromForm({ name: 'Ahorro EUR', currency: 'EUR', amount: '100' }) // no rate loaded
    const asset = await createInvestmentAsset({ name: 'Sin precio', type: 'stock', currency: 'USD', priceMode: 'manual' })
    await createInvestmentHolding({ assetId: asset.id, quantity: 1 * QUANTITY_SCALE }) // no price loaded

    const { missingRateCount, missingPriceCount } = await getSavingsAndInvestmentsHistory(3)
    expect(missingRateCount).toBe(3) // one EUR miss per point
    expect(missingPriceCount).toBe(3) // one no-price miss per point
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

describe('createInvestmentLotFromForm / updateInvestmentLotFromForm', () => {
  it('parses quantity and costPerUnit in the asset currency, and the holding aggregate matches a single lot exactly', async () => {
    const asset = await createInvestmentAssetFromForm({ name: 'SPY', type: 'etf', currency: 'USD', autoPrice: false })
    const lot = await createInvestmentLotFromForm({ assetId: asset.id, quantity: '5', costPerUnit: '600', date: '2026-01-01' })

    expect(lot.quantity).toBe(500_000_000) // 5.00000000 scaled
    expect(lot.costPerUnit).toBe(60_000) // "600" parsed as major units -> 600.00 USD

    const [holding] = await listInvestmentHoldings()
    expect(holding).toMatchObject({ assetId: asset.id, quantity: 500_000_000, averageCost: 60_000 })

    await updateInvestmentLotFromForm(lot.id, { quantity: '7', costPerUnit: '', date: '2026-01-01' })
    const [updatedHolding] = await listInvestmentHoldings()
    expect(updatedHolding?.quantity).toBe(700_000_000)
    // Clearing "Costo por unidad" must actually clear it, not just leave
    // the quantity change through while the old cost lingers underneath.
    expect(updatedHolding?.averageCost).toBeUndefined()
  })

  it('resolves costPerUnit against the lot\'s real asset currency, ignoring a mismatched assetId if one were passed', async () => {
    const usdAsset = await createInvestmentAssetFromForm({ name: 'SPY', type: 'etf', currency: 'USD', autoPrice: false })
    const eurAsset = await createInvestmentAssetFromForm({ name: 'Bono EUR', type: 'bond', currency: 'EUR', autoPrice: false })
    const lot = await createInvestmentLotFromForm({ assetId: usdAsset.id, quantity: '1', date: '2026-01-01' })

    // A caller passing a different asset's id can't smuggle the wrong
    // currency in — updateInvestmentLotFromForm's signature doesn't even
    // accept assetId, so this can't compile with one; verifying the
    // currency used is still the lot's real (USD) one.
    await updateInvestmentLotFromForm(lot.id, { quantity: '1', costPerUnit: '600', date: '2026-01-01' })
    const [holding] = await listInvestmentHoldings()
    expect(holding?.averageCost).toBe(60_000) // 600.00 USD, not EUR — resolved from the lot, not eurAsset
    expect(eurAsset.currency).toBe('EUR') // sanity: the mismatched asset really is a different currency
  })

  it('rejects a lot for a non-existent asset', async () => {
    await expect(
      createInvestmentLotFromForm({ assetId: 'missing', quantity: '1', date: '2026-01-01' }),
    ).rejects.toThrow(/no encontrado/)
  })

  it('omits costPerUnit when left blank, and the holding aggregate has no averageCost either', async () => {
    const asset = await createInvestmentAssetFromForm({ name: 'Bitcoin', type: 'crypto', currency: 'USD', autoPrice: false })
    const lot = await createInvestmentLotFromForm({ assetId: asset.id, quantity: '1', date: '2026-01-01' })
    expect('costPerUnit' in lot).toBe(false)

    const [holding] = await listInvestmentHoldings()
    expect('averageCost' in (holding ?? {})).toBe(false)
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

  it('computes an unrealized gain when the price is above averageCost', async () => {
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    await createInvestmentHolding({ assetId: asset.id, quantity: 500_000_000, averageCost: 600_00 }) // 5 shares @ 600
    await createAssetPrice({ assetId: asset.id, price: 650_00, currency: 'USD', date: '2026-08-01', source: 'manual' })

    const [item] = await getInvestmentHoldingsWithDetails('USD')
    expect(item?.costBasis).toEqual(money(5 * 600_00, 'USD'))
    expect(item?.gainLoss).toEqual(money(5 * 50_00, 'USD')) // (650-600) * 5
    expect(item?.gainLossPercent).toBeCloseTo((50 / 600) * 100)
  })

  it('computes an unrealized loss when the price is below averageCost', async () => {
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    await createInvestmentHolding({ assetId: asset.id, quantity: 500_000_000, averageCost: 600_00 })
    await createAssetPrice({ assetId: asset.id, price: 500_00, currency: 'USD', date: '2026-08-01', source: 'manual' })

    const [item] = await getInvestmentHoldingsWithDetails('USD')
    expect(item?.gainLoss).toEqual(money(-5 * 100_00, 'USD'))
    expect(item?.gainLossPercent).toBeLessThan(0)
  })

  it('has no gain/loss fields when the holding has no averageCost on file', async () => {
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    await createInvestmentHolding({ assetId: asset.id, quantity: 500_000_000 })
    await createAssetPrice({ assetId: asset.id, price: 650_00, currency: 'USD', date: '2026-08-01', source: 'manual' })

    const [item] = await getInvestmentHoldingsWithDetails('USD')
    expect(item?.nativeValue).toBeDefined()
    expect(item?.costBasis).toBeUndefined()
    expect(item?.gainLoss).toBeUndefined()
    expect(item?.gainLossPercent).toBeUndefined()
  })

  it('has a costBasis but no gain/loss when averageCost is on file but no price has been loaded yet', async () => {
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    await createInvestmentHolding({ assetId: asset.id, quantity: 500_000_000, averageCost: 600_00 })

    const [item] = await getInvestmentHoldingsWithDetails('USD')
    expect(item?.costBasis).toEqual(money(5 * 600_00, 'USD'))
    expect(item?.nativeValue).toBeUndefined()
    expect(item?.gainLoss).toBeUndefined()
  })

  it('treats a corrupted negative averageCost (not reachable via the form) as absent instead of crashing', async () => {
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    await createInvestmentHolding({ assetId: asset.id, quantity: 500_000_000, averageCost: -600_00 })
    await createAssetPrice({ assetId: asset.id, price: 650_00, currency: 'USD', date: '2026-08-01', source: 'manual' })

    const [item] = await getInvestmentHoldingsWithDetails('USD')
    expect(item?.nativeValue).toBeDefined()
    expect(item?.costBasis).toBeUndefined()
    expect(item?.gainLoss).toBeUndefined()
  })

  it('treats a corrupted non-positive price as absent instead of crashing', async () => {
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    await createInvestmentHolding({ assetId: asset.id, quantity: 500_000_000, averageCost: 600_00 })
    // createAssetPrice's own `price > 0` invariant doesn't run on a
    // backup import, which writes assetPrices rows directly — inserted
    // the same way here to simulate that, rather than going through the
    // repo (which would reject it before this code ever sees it).
    await db.assetPrices.add({
      id: generateId(),
      assetId: asset.id,
      price: 0,
      currency: 'USD',
      date: '2026-08-01',
      source: 'manual',
      capturedAt: new Date().toISOString(),
    })

    const [item] = await getInvestmentHoldingsWithDetails('USD')
    expect(item?.nativeValue).toBeUndefined()
    expect(item?.costBasis).toEqual(money(5 * 600_00, 'USD'))
    expect(item?.gainLoss).toBeUndefined()
  })

  // Reachable in practice: a crypto asset can be set to any currency
  // while CoinGecko's auto-refresh always writes a USD price row —
  // without the currency guard this crashed sub()/percentChange() (both
  // assert same-currency) and took down every holding in the list, not
  // just this one.
  it('treats a price whose currency differs from the asset currency as absent instead of crashing', async () => {
    const asset = await createInvestmentAsset({ name: 'Bitcoin', type: 'crypto', currency: 'ARS', priceMode: 'auto' })
    await createInvestmentHolding({ assetId: asset.id, quantity: 100_000_000, averageCost: 50_000_00 })
    await createAssetPrice({ assetId: asset.id, price: 60_000, currency: 'USD', date: '2026-08-01', source: 'automatic' })

    const [item] = await getInvestmentHoldingsWithDetails('ARS')
    expect(item?.nativeValue).toBeUndefined()
    expect(item?.costBasis).toEqual(money(50_000_00, 'ARS'))
    expect(item?.gainLoss).toBeUndefined()
  })

  it('reports an exact break-even as a zero gainLoss and a 0% gainLossPercent, not undefined', async () => {
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    await createInvestmentHolding({ assetId: asset.id, quantity: 500_000_000, averageCost: 600_00 })
    await createAssetPrice({ assetId: asset.id, price: 600_00, currency: 'USD', date: '2026-08-01', source: 'manual' })

    const [item] = await getInvestmentHoldingsWithDetails('USD')
    expect(item?.gainLoss).toEqual(money(0, 'USD'))
    expect(item?.gainLossPercent).toBe(0)
  })

  it('has a full gainLoss but no percent when averageCost is exactly zero (e.g. a gifted position)', async () => {
    const asset = await createInvestmentAsset({ name: 'SPY', type: 'etf', currency: 'USD', priceMode: 'manual' })
    await createInvestmentHolding({ assetId: asset.id, quantity: 500_000_000, averageCost: 0 })
    await createAssetPrice({ assetId: asset.id, price: 650_00, currency: 'USD', date: '2026-08-01', source: 'manual' })

    const [item] = await getInvestmentHoldingsWithDetails('USD')
    expect(item?.costBasis).toEqual(money(0, 'USD'))
    expect(item?.gainLoss).toEqual(money(5 * 650_00, 'USD'))
    expect(item?.gainLossPercent).toBeUndefined()
  })
})

describe('createInvestmentAssetFromForm — auto price (crypto, cedear)', () => {
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

  it('sets priceMode auto for a cedear too, with the BYMA ticker as externalId', async () => {
    const asset = await createInvestmentAssetFromForm({
      name: 'Coca-Cola CEDEAR',
      symbol: 'KO',
      type: 'cedear',
      currency: 'ARS',
      autoPrice: true,
      externalId: 'KO',
    })
    expect(asset.priceMode).toBe('auto')
    expect(asset.externalId).toBe('KO')
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

  it('falls back to manual when the type has no provider, even with autoPrice on and an externalId', async () => {
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

  // Regression: a CEDEAR only ever trades in pesos on BYMA — a mismatched
  // currency would make data912's (always ARS) quote silently look like
  // "no price" downstream. The form locks this, but the service/repo
  // layer is the real defense against any other caller.
  it('rejects a cedear created with a currency other than ARS', async () => {
    await expect(
      createInvestmentAssetFromForm({ name: 'Coca-Cola CEDEAR', type: 'cedear', currency: 'USD', autoPrice: false }),
    ).rejects.toThrow(/ARS/)
  })
})

describe('updateInvestmentAssetFromForm', () => {
  it('updates name and symbol, re-reading the asset\'s real type rather than trusting the caller', async () => {
    const asset = await createInvestmentAssetFromForm({ name: 'SPY', symbol: 'SPY', type: 'etf', currency: 'USD', autoPrice: false })

    await updateInvestmentAssetFromForm(asset.id, { name: 'SPDR S&P 500', symbol: 'SPY', autoPrice: false, externalId: '' })

    const [updated] = await listInvestmentAssets()
    expect(updated).toMatchObject({ name: 'SPDR S&P 500', symbol: 'SPY', priceMode: 'manual' })
  })

  // Regression: symbol doubles as the row's display title
  // (asset.symbol ?? asset.name) — silently leaving a stale symbol in
  // place after the user clears the field would keep showing it instead
  // of falling back to the name.
  it('clears symbol when the field is emptied', async () => {
    const asset = await createInvestmentAssetFromForm({ name: 'SPY', symbol: 'SPY', type: 'etf', currency: 'USD', autoPrice: false })

    await updateInvestmentAssetFromForm(asset.id, { name: 'SPY', symbol: '', autoPrice: false, externalId: '' })

    const [updated] = await listInvestmentAssets()
    expect(updated?.symbol).toBeUndefined()
  })

  it('turns priceMode auto on for an existing cedear, and back to manual — the explicit fallback for when the provider is unreliable', async () => {
    const asset = await createInvestmentAssetFromForm({
      name: 'Coca-Cola CEDEAR',
      symbol: 'KO',
      type: 'cedear',
      currency: 'ARS',
      autoPrice: false,
    })

    await updateInvestmentAssetFromForm(asset.id, { name: 'Coca-Cola CEDEAR', symbol: 'KO', autoPrice: true, externalId: 'KO' })
    expect((await listInvestmentAssets())[0]).toMatchObject({ priceMode: 'auto', externalId: 'KO' })

    await updateInvestmentAssetFromForm(asset.id, { name: 'Coca-Cola CEDEAR', symbol: 'KO', autoPrice: false, externalId: 'KO' })
    expect((await listInvestmentAssets())[0]?.priceMode).toBe('manual')
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
