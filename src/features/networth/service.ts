import {
  accountsRepo,
  assetPricesRepo,
  exchangeRatesRepo,
  investmentsRepo,
  savingsHoldingsRepo,
  settingsRepo,
} from '@/database/repositories'
import { quantity, parseQuantity, valuePosition } from '@/domain/decimal'
import { valuateNetWorth, type ValuationPosition, type ValuationResult } from '@/domain/networth'
import { convert, MissingRateError } from '@/domain/currency'
import { money, parseAmount, type CurrencyCode, type Money } from '@/domain/money'
import type { AssetPrice, InvestmentAsset, InvestmentHolding } from '@/domain/entities'
import { todayStamp } from '@/lib/dates'
import { invariant } from '@/lib/invariant'
import type {
  InvestmentAssetFormValues,
  InvestmentHoldingFormValues,
  InvestmentPriceFormValues,
  SavingsFormValues,
} from './schema'

export { listSavingsHoldings, deleteSavingsHolding } from '@/database/repositories/savingsHoldings.repo'
export { listInvestmentAssets, deleteInvestmentAsset, deleteInvestmentHolding } from '@/database/repositories/investments.repo'

export async function createSavingsHoldingFromForm(values: SavingsFormValues) {
  const amount = parseAmount(values.amount, values.currency).amount
  return savingsHoldingsRepo.createSavingsHolding({
    name: values.name,
    currency: values.currency,
    amount,
    ...(values.location && { location: values.location }),
    ...(values.notes && { notes: values.notes }),
  })
}

export async function updateSavingsHoldingFromForm(id: string, values: SavingsFormValues) {
  const amount = parseAmount(values.amount, values.currency).amount
  // Unlike create, always sends location/notes (even '') rather than
  // omitting them when falsy — editing has to be able to clear a
  // previously-set value, not just leave the old one in place.
  return savingsHoldingsRepo.updateSavingsHolding(id, {
    name: values.name,
    currency: values.currency,
    amount,
    location: values.location,
    notes: values.notes,
  })
}

export interface NetWorthSummary extends ValuationResult {
  displayCurrency: CurrencyCode
}

/** Orchestrates every repository `domain/networth:valuateNetWorth` needs
 *  (accounts, ahorros, posiciones + sus activos + su último precio,
 *  tasas) and calls it — the only place besides the domain layer itself
 *  that knows the quantity -> native value -> conversion order. */
export async function getNetWorthSummary(overrideDisplayCurrency?: CurrencyCode): Promise<NetWorthSummary> {
  const settings = await settingsRepo.getSettings()
  const displayCurrency = overrideDisplayCurrency ?? settings.displayCurrency ?? settings.baseCurrency
  const date = todayStamp()

  const [accounts, savings, holdings, assets, rates] = await Promise.all([
    accountsRepo.listAccountsWithBalances(),
    savingsHoldingsRepo.listSavingsHoldings(),
    investmentsRepo.listInvestmentHoldings(),
    investmentsRepo.listInvestmentAssets(),
    exchangeRatesRepo.listExchangeRates(),
  ])

  const assetById = new Map(assets.map((a) => [a.id, a]))
  const latestPrices = await assetPricesRepo.latestAssetPrices(
    assets.map((a) => a.id),
    date,
  )

  const positions: ValuationPosition[] = holdings.map((holding) => {
    const asset = assetById.get(holding.assetId)
    const priceRow = asset ? latestPrices.get(asset.id) : undefined
    return {
      quantity: quantity(holding.quantity),
      ...(priceRow && { price: money(priceRow.price, priceRow.currency) }),
    }
  })

  const result = valuateNetWorth({
    accounts: accounts.map((a) => ({ balance: a.balance, currency: a.currency })),
    savings,
    positions,
    rates,
    displayCurrency,
    date,
    ...(settings.rateProfile !== undefined && { profile: settings.rateProfile }),
  })

  return { ...result, displayCurrency }
}

export async function createInvestmentAssetFromForm(values: InvestmentAssetFormValues) {
  const symbol = values.symbol?.trim()
  return investmentsRepo.createInvestmentAsset({
    name: values.name,
    type: values.type,
    currency: values.currency,
    // 'auto' only means something once a quotes provider exists for this
    // asset (Etapa 6C) — every asset created from this form starts
    // manual, and can be switched later from the Cotizaciones tab.
    priceMode: 'manual',
    ...(symbol && { symbol }),
  })
}

async function requireAsset(assetId: string): Promise<InvestmentAsset> {
  const asset = await investmentsRepo.getInvestmentAsset(assetId)
  invariant(asset, `Activo no encontrado: ${assetId}`)
  return asset
}

/** Shared quantity/averageCost parsing for create and update — averageCost
 *  is always resolved against `assetCurrency`, never a currency chosen
 *  separately in the form (a holding's cost basis is always in its
 *  asset's own currency). */
function parseHoldingFields(quantityInput: string, averageCostInput: string | undefined, assetCurrency: CurrencyCode) {
  return {
    quantity: parseQuantity(quantityInput),
    ...(averageCostInput?.trim() && { averageCost: parseAmount(averageCostInput, assetCurrency).amount }),
  }
}

export async function createInvestmentHoldingFromForm(values: InvestmentHoldingFormValues) {
  const asset = await requireAsset(values.assetId)
  const fields = parseHoldingFields(values.quantity, values.averageCost, asset.currency)
  return investmentsRepo.createInvestmentHolding({ assetId: values.assetId, ...fields })
}

/** Quantity/averageCost only — the asset a holding belongs to never
 *  changes after creation (moving a position to a different asset means
 *  deleting it and creating a new one, same as an account's currency).
 *  Deliberately re-reads the holding's *real* `assetId` from the database
 *  instead of trusting the form's `assetId` field for currency resolution
 *  — the dialog disables that select while editing, but a service
 *  function shouldn't depend on a caller's UI state to stay correct. */
export async function updateInvestmentHoldingFromForm(
  id: string,
  values: Pick<InvestmentHoldingFormValues, 'quantity' | 'averageCost'>,
) {
  const holding = await investmentsRepo.getInvestmentHolding(id)
  invariant(holding, `Posición no encontrada: ${id}`)
  const asset = await requireAsset(holding.assetId)
  const fields = parseHoldingFields(values.quantity, values.averageCost, asset.currency)
  return investmentsRepo.updateInvestmentHolding(id, fields)
}

export async function createManualPriceFromForm(
  assetId: string,
  currency: CurrencyCode,
  values: InvestmentPriceFormValues,
) {
  const price = parseAmount(values.price, currency).amount
  return assetPricesRepo.createAssetPrice({ assetId, price, currency, date: values.date, source: 'manual' })
}

export interface InvestmentHoldingWithDetails {
  holding: InvestmentHolding
  asset: InvestmentAsset
  price?: AssetPrice
  /** `quantity × price`, in the asset's own currency — undefined if the
   *  asset has no price loaded yet. */
  nativeValue?: Money
  /** `nativeValue` converted to the display currency — undefined if
   *  there's no price, or no usable exchange rate for it. */
  convertedValue?: Money
}

/** Per-position detail for the Inversiones tab — the aggregate total for
 *  Resumen comes from `valuateNetWorth` via `getNetWorthSummary`; this is
 *  a separate join for the row-by-row list, reusing the same domain
 *  functions (`valuePosition`, `convert`) rather than duplicating the
 *  math. */
export async function getInvestmentHoldingsWithDetails(
  overrideDisplayCurrency?: CurrencyCode,
): Promise<InvestmentHoldingWithDetails[]> {
  const settings = await settingsRepo.getSettings()
  const displayCurrency = overrideDisplayCurrency ?? settings.displayCurrency ?? settings.baseCurrency
  const date = todayStamp()

  const [holdings, assets, rates] = await Promise.all([
    investmentsRepo.listInvestmentHoldings(),
    investmentsRepo.listInvestmentAssets(),
    exchangeRatesRepo.listExchangeRates(),
  ])
  const assetById = new Map(assets.map((a) => [a.id, a]))
  const latestPrices = await assetPricesRepo.latestAssetPrices(
    assets.map((a) => a.id),
    date,
  )

  return holdings
    .map((holding): InvestmentHoldingWithDetails | undefined => {
      const asset = assetById.get(holding.assetId)
      if (!asset) return undefined // asset was deleted out from under the holding — shouldn't happen, repo forbids it

      const priceRow = latestPrices.get(asset.id)
      if (!priceRow) return { holding, asset }

      const price = money(priceRow.price, priceRow.currency)
      const nativeValue = valuePosition(quantity(holding.quantity), price)
      try {
        const convertedValue = convert(nativeValue, displayCurrency, rates, date, settings.rateProfile)
        return { holding, asset, price: priceRow, nativeValue, convertedValue }
      } catch (error) {
        if (error instanceof MissingRateError) return { holding, asset, price: priceRow, nativeValue }
        throw error
      }
    })
    .filter((item): item is InvestmentHoldingWithDetails => item !== undefined)
}
