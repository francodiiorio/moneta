import {
  assetPricesRepo,
  exchangeRatesRepo,
  investmentLotsRepo,
  investmentsRepo,
  savingsHoldingsRepo,
  settingsRepo,
} from '@/database/repositories'
import { quantity, parseQuantity, valuePosition } from '@/domain/decimal'
import { valuateNetWorth, type ValuationPosition, type ValuationResult } from '@/domain/networth'
import { convert, MissingRateError } from '@/domain/currency'
import { money, parseAmount, percentChange, sub, type CurrencyCode, type Money } from '@/domain/money'
import type { AssetPrice, ExchangeRate, InvestmentAsset, InvestmentHolding, SavingsHolding } from '@/domain/entities'
import { currentMonthStamp, monthRange, shiftMonth, todayStamp, type DateStamp, type MonthStamp } from '@/lib/dates'
import { invariant } from '@/lib/invariant'
import { NO_PROFILE, rateValueToNumber, type ExchangeRateFormValues } from './schema'
import type {
  InvestmentAssetFormValues,
  InvestmentLotFormValues,
  InvestmentPriceFormValues,
  SavingsFormValues,
} from './schema'

export { listSavingsHoldings, deleteSavingsHolding } from '@/database/repositories/savingsHoldings.repo'
export { listInvestmentAssets, deleteInvestmentAsset, deleteInvestmentHolding } from '@/database/repositories/investments.repo'
export { listInvestmentLots, deleteInvestmentLot } from '@/database/repositories/investmentLots.repo'
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

/** Valúa Ahorros + Inversiones (nunca Cuentas — `accounts: []`, ver ADR
 *  "Ahorro e Inversiones deja de incluir Cuentas" en docs/DECISIONS.md)
 *  a una fecha puntual: pide el último precio de cada activo vigente a
 *  esa fecha y llama a `domain/networth:valuateNetWorth`. Compartido por
 *  `getNetWorthSummary` (una sola fecha, hoy) y
 *  `getSavingsAndInvestmentsHistory` (una fecha por mes) — la única
 *  diferencia entre ambas es la fecha que se le pasa. Un consolidado que
 *  también incluye Cuentas sigue existiendo, pero sólo en Reportes
 *  (`features/reports/service.ts`, que llama a `valuateNetWorth` de
 *  forma independiente con su propia lista de cuentas). */
async function valueSavingsAndInvestmentsAt(
  asOfDate: DateStamp,
  displayCurrency: CurrencyCode,
  rates: readonly ExchangeRate[],
  profile: string | undefined,
  savings: readonly SavingsHolding[],
  holdings: readonly { assetId: string; quantity: number }[],
  assetById: Map<string, InvestmentAsset>,
): Promise<ValuationResult> {
  const latestPrices = await assetPricesRepo.latestAssetPrices(
    [...assetById.keys()],
    asOfDate,
  )
  const positions: ValuationPosition[] = holdings.map((holding) => {
    const asset = assetById.get(holding.assetId)
    const priceRow = asset ? latestPrices.get(asset.id) : undefined
    return {
      quantity: quantity(holding.quantity),
      ...(priceRow && { price: money(priceRow.price, priceRow.currency) }),
    }
  })

  return valuateNetWorth({
    accounts: [],
    savings,
    positions,
    rates,
    displayCurrency,
    date: asOfDate,
    ...(profile !== undefined && { profile }),
  })
}

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

  const result = await valueSavingsAndInvestmentsAt(
    date,
    displayCurrency,
    rates,
    settings.rateProfile,
    savings,
    holdings,
    assetById,
  )

  return { ...result, displayCurrency }
}

export interface SavingsAndInvestmentsPoint {
  month: MonthStamp
  total: Money
  byBucket: { savings: Money; investments: Money }
}

export interface SavingsAndInvestmentsHistory {
  points: SavingsAndInvestmentsPoint[]
  missingRateCount: number
  missingPriceCount: number
}

/** Un punto por mes para los últimos `monthsBack` meses (valuado a fin de
 *  mes, salvo el mes en curso, valuado a hoy) — misma técnica que
 *  features/reports/service.ts:getNetWorthHistory: usa la cantidad/monto
 *  de HOY de cada ahorro/posición, revaluada con el precio o tasa
 *  vigente en cada mes (ni SavingsHolding ni InvestmentHolding tienen
 *  historial propio — ver ADR "Evolución del patrimonio: cantidades de
 *  hoy, precios de cada mes" en docs/DECISIONS.md). Deliberadamente
 *  independiente de esa función de Reportes (no se comparte código):
 *  dos consumidores distintos del mismo dominio, con distinto alcance. */
export async function getSavingsAndInvestmentsHistory(monthsBack = 6): Promise<SavingsAndInvestmentsHistory> {
  const settings = await settingsRepo.getSettings()
  const displayCurrency = settings.displayCurrency ?? settings.baseCurrency
  const currentMonth = currentMonthStamp()

  const [rates, savings, holdings, assets] = await Promise.all([
    exchangeRatesRepo.listExchangeRates(),
    savingsHoldingsRepo.listSavingsHoldings(),
    investmentsRepo.listInvestmentHoldings(),
    investmentsRepo.listInvestmentAssets(),
  ])
  const assetById = new Map(assets.map((a) => [a.id, a]))

  const points: SavingsAndInvestmentsPoint[] = []
  let missingRateCount = 0
  let missingPriceCount = 0

  for (let i = monthsBack - 1; i >= 0; i--) {
    const month = shiftMonth(currentMonth, -i)
    const asOfDate = i === 0 ? todayStamp() : monthRange(month).end

    const result = await valueSavingsAndInvestmentsAt(
      asOfDate,
      displayCurrency,
      rates,
      settings.rateProfile,
      savings,
      holdings,
      assetById,
    )

    missingRateCount += result.missingRateCount
    missingPriceCount += result.missingPriceCount
    points.push({
      month,
      total: result.total,
      byBucket: { savings: result.byBucket.savings, investments: result.byBucket.investments },
    })
  }

  return { points, missingRateCount, missingPriceCount }
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

/** Shared quantity/costPerUnit parsing for create and update — costPerUnit
 *  is always resolved against `assetCurrency`, never a currency chosen
 *  separately in the form (a lot's cost is always in its asset's own
 *  currency). */
function parseLotFields(quantityInput: string, costPerUnitInput: string | undefined, assetCurrency: CurrencyCode) {
  const costPerUnit = costPerUnitInput?.trim() ? parseAmount(costPerUnitInput, assetCurrency).amount : undefined
  return { quantity: parseQuantity(quantityInput), costPerUnit }
}

/** Records a purchase. `InvestmentHolding` (the position's cached
 *  quantity/averageCost, everything else in the app reads) is never
 *  written here directly — `investmentLotsRepo.createInvestmentLot`
 *  recomputes it from every lot for the asset, inside the same
 *  transaction as this write. Ver ADR "Tracking de inversiones por
 *  lote" en docs/DECISIONS.md. */
export async function createInvestmentLotFromForm(values: InvestmentLotFormValues) {
  const asset = await requireAsset(values.assetId)
  const { quantity, costPerUnit } = parseLotFields(values.quantity, values.costPerUnit, asset.currency)
  return investmentLotsRepo.createInvestmentLot({
    assetId: values.assetId,
    currency: asset.currency,
    date: values.date,
    quantity,
    ...(costPerUnit !== undefined && { costPerUnit }),
  })
}

/** Quantity/costPerUnit/date only — the asset a lot belongs to never
 *  changes after creation (same reasoning as a holding's asset used to
 *  have: moving a purchase to a different asset means deleting it and
 *  creating a new one). Deliberately re-reads the lot's *real* `assetId`
 *  from the database instead of trusting a caller's UI state, same
 *  pattern the old holding-update function used.
 *
 *  The form always submits the lot's full desired state (never a sparse
 *  patch from multiple origins), so an empty "Costo por unidad" means
 *  "clear it", not "leave it as is" — hence `costPerUnit ?? null`. See
 *  `UpdateInvestmentLotInput`'s tri-state. */
export async function updateInvestmentLotFromForm(
  id: string,
  values: Pick<InvestmentLotFormValues, 'quantity' | 'costPerUnit' | 'date'>,
) {
  const lot = await investmentLotsRepo.getInvestmentLot(id)
  invariant(lot, `Compra no encontrada: ${id}`)
  const asset = await requireAsset(lot.assetId)
  const { quantity, costPerUnit } = parseLotFields(values.quantity, values.costPerUnit, asset.currency)
  return investmentLotsRepo.updateInvestmentLot(id, { date: values.date, quantity, costPerUnit: costPerUnit ?? null })
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
