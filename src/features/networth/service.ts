import {
  assetPricesRepo,
  exchangeRatesRepo,
  investmentsRepo,
  savingsHoldingsRepo,
  settingsRepo,
} from '@/database/repositories'
import { quantity, parseQuantity, valuePosition } from '@/domain/decimal'
import { valuateNetWorth, type ValuationPosition, type ValuationResult } from '@/domain/networth'
import { convert, MissingRateError } from '@/domain/currency'
import { money, parseAmount, percentChange, sub, type CurrencyCode, type Money } from '@/domain/money'
import type { AssetPrice, InvestmentAsset, InvestmentHolding } from '@/domain/entities'
import { todayStamp } from '@/lib/dates'
import { invariant } from '@/lib/invariant'
import { NO_PROFILE, rateValueToNumber, type ExchangeRateFormValues } from './schema'
import type {
  InvestmentAssetFormValues,
  InvestmentHoldingFormValues,
  InvestmentPriceFormValues,
  SavingsFormValues,
} from './schema'

export { listSavingsHoldings, deleteSavingsHolding } from '@/database/repositories/savingsHoldings.repo'
export { listInvestmentAssets, deleteInvestmentAsset, deleteInvestmentHolding } from '@/database/repositories/investments.repo'
export { listExchangeRates, deleteExchangeRate } from '@/database/repositories/exchangeRates.repo'
// Cotizaciones automáticas (Etapa 6C) is a headless orchestration layer
// with no UI of its own — the Cotizaciones tab here is its only consumer.
// Re-exporting a service (not a component) across features is the
// established exception — see docs/DECISIONS.md "Un feature puede
// importar el service.ts/hooks de otro, nunca sus componentes".
export { refreshQuotes, isStale, STALE_HOURS, type RefreshResult } from '@/features/quotes/service'

export async function createExchangeRateFromForm(values: ExchangeRateFormValues) {
  return exchangeRatesRepo.createExchangeRate({
    date: values.date,
    from: values.from,
    to: values.to,
    rate: rateValueToNumber(values.rate),
    source: 'manual',
    ...(values.profile !== NO_PROFILE && { profile: values.profile }),
  })
}

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
 *  (ahorros, posiciones + sus activos + su último precio, tasas) and
 *  calls it — the only place besides the domain layer itself that knows
 *  the quantity -> native value -> conversion order.
 *
 *  Deliberately excludes Cuentas (`accounts: []` below): this feature is
 *  scoped to Ahorro e Inversiones only — plata que no aparece ya en
 *  /cuentas. A consolidated total that also folds in cuentas still
 *  exists, but only in Reportes (`getMonthlyReport`/`getNetWorthHistory`
 *  in features/reports/service.ts, which call `valuateNetWorth`
 *  independently with its own accounts list) — see docs/DECISIONS.md
 *  "Ahorro e Inversiones deja de incluir Cuentas". */
export async function getNetWorthSummary(overrideDisplayCurrency?: CurrencyCode): Promise<NetWorthSummary> {
  const settings = await settingsRepo.getSettings()
  const displayCurrency = overrideDisplayCurrency ?? settings.displayCurrency ?? settings.baseCurrency
  const date = todayStamp()

  const [savings, holdings, assets, rates] = await Promise.all([
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
    accounts: [],
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
  const externalId = values.externalId?.trim()
  // CoinGecko is the only automatic price provider wired up (Etapa 6C),
  // and it only covers crypto — auto only takes effect with both a
  // crypto type and an externalId to look up; anything else falls back
  // to manual regardless of the switch (e.g. flipping type away from
  // crypto after checking it, or leaving externalId blank).
  const isAuto = values.type === 'crypto' && values.autoPrice && !!externalId
  return investmentsRepo.createInvestmentAsset({
    name: values.name,
    type: values.type,
    currency: values.currency,
    priceMode: isAuto ? 'auto' : 'manual',
    ...(symbol && { symbol }),
    ...(isAuto && { externalId }),
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
  /** `quantity × averageCost`, in the asset's own currency — undefined
   *  unless the holding has a valid (non-negative) `averageCost` on
   *  file; a negative one is treated as absent, see the comment where
   *  this is computed. */
  costBasis?: Money
  /** `nativeValue - costBasis`, in the asset's own currency — undefined
   *  unless both a usable price and a `costBasis` are available. */
  gainLoss?: Money
  /** Percent change from `costBasis` to `nativeValue`, display-only —
   *  see `domain/money:percentChange`. Undefined whenever `gainLoss` is
   *  undefined (no usable price or no costBasis), or when `costBasis`
   *  is zero. */
  gainLossPercent?: number
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

      // A negative averageCost can only reach here from a corrupted or
      // hand-edited backup (the form and the Zod schema both reject one
      // going forward) — treated as absent rather than fed into
      // percentChange, which rejects a negative magnitude outright.
      const costBasis =
        holding.averageCost !== undefined && holding.averageCost >= 0
          ? valuePosition(quantity(holding.quantity), money(holding.averageCost, asset.currency))
          : undefined

      // A priceRow whose currency doesn't match the asset's own currency
      // (reachable today: a crypto asset can be set to any currency while
      // CoinGecko's auto-refresh always writes a USD price) or a
      // corrupted non-positive price (a hand-edited backup bypasses
      // assetPrices.repo.ts's own `price > 0` invariant) would otherwise
      // feed a mismatched or invalid Money into valuePosition/sub/
      // percentChange below, which both assert on it — treated as no
      // usable price instead, same as an asset with no price loaded yet.
      const priceRow = latestPrices.get(asset.id)
      if (!priceRow || priceRow.currency !== asset.currency || priceRow.price <= 0) {
        return { holding, asset, ...(costBasis && { costBasis }) }
      }

      const price = money(priceRow.price, priceRow.currency)
      const nativeValue = valuePosition(quantity(holding.quantity), price)
      const gainLoss = costBasis ? sub(nativeValue, costBasis) : undefined
      const gainLossPercent = costBasis ? percentChange(costBasis, nativeValue) : undefined
      const gainLossFields = {
        ...(costBasis && { costBasis }),
        ...(gainLoss && { gainLoss }),
        ...(gainLossPercent !== undefined && { gainLossPercent }),
      }

      try {
        const convertedValue = convert(nativeValue, displayCurrency, rates, date, settings.rateProfile)
        return { holding, asset, price: priceRow, nativeValue, convertedValue, ...gainLossFields }
      } catch (error) {
        if (error instanceof MissingRateError) return { holding, asset, price: priceRow, nativeValue, ...gainLossFields }
        throw error
      }
    })
    .filter((item): item is InvestmentHoldingWithDetails => item !== undefined)
}
