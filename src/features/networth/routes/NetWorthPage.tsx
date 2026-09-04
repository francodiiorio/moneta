import { useState } from 'react'
import { toast } from 'sonner'
import { LineChart, PiggyBank, Plus, TrendingUp } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { MoneyText } from '@/components/MoneyText'
import { MissingRateBanner } from '@/components/MissingRateBanner'
import { MissingPriceBanner } from '@/components/MissingPriceBanner'
import { MoneyTrendChart } from '@/components/MoneyTrendChart'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { settingsRepo } from '@/database/repositories'
import { NETWORTH_CURRENCIES } from '../schema'
import { useNetWorthUiStore, type NetWorthTab } from '../store'
import { useSavingsHoldings } from '../hooks/useSavingsHoldings'
import { useNetWorthSummary } from '../hooks/useNetWorthSummary'
import { useSavingsAndInvestmentsHistory } from '../hooks/useSavingsAndInvestmentsHistory'
import { useSettings } from '../hooks/useSettings'
import { useInvestmentAssets } from '../hooks/useInvestmentAssets'
import { useInvestmentHoldingsWithDetails } from '../hooks/useInvestmentHoldingsWithDetails'
import { useExchangeRates } from '../hooks/useExchangeRates'
import { SavingsFormDialog } from '../components/SavingsFormDialog'
import { SavingsRow } from '../components/SavingsRow'
import { NetWorthDistribution } from '../components/NetWorthDistribution'
import { InvestmentGainLossChart } from '../components/InvestmentGainLossChart'
import { InvestmentAssetFormDialog } from '../components/InvestmentAssetFormDialog'
import { InvestmentLotFormDialog } from '../components/InvestmentLotFormDialog'
import { InvestmentLotsDialog } from '../components/InvestmentLotsDialog'
import { InvestmentPriceDialog } from '../components/InvestmentPriceDialog'
import { InvestmentRow } from '../components/InvestmentRow'
import { InvestmentAssetRow } from '../components/InvestmentAssetRow'
import { ExchangeRateFormDialog } from '../components/ExchangeRateFormDialog'
import { ExchangeRateRow } from '../components/ExchangeRateRow'
import { QuotesControls } from '../components/QuotesControls'
import { deleteExchangeRate, deleteInvestmentAsset, deleteInvestmentHolding, deleteSavingsHolding } from '../service'

type PendingDelete = { kind: 'savings' | 'holding' | 'rate' | 'asset'; id: string }

export function NetWorthPage() {
  const {
    tab,
    setTab,
    savingsDialogOpen,
    editingSavingsId,
    openCreateSavingsDialog,
    openEditSavingsDialog,
    closeSavingsDialog,
    assetDialogOpen,
    openAssetDialog,
    closeAssetDialog,
    lotDialogOpen,
    newLotAssetId,
    openCreateLotDialog,
    closeLotDialog,
    managingLotsAssetId,
    openManageLotsDialog,
    closeManageLotsDialog,
    pricingAssetId,
    openPriceDialog,
    closePriceDialog,
    rateDialogOpen,
    openRateDialog,
    closeRateDialog,
  } = useNetWorthUiStore()
  const savings = useSavingsHoldings()
  const summary = useNetWorthSummary()
  const history = useSavingsAndInvestmentsHistory()
  const settings = useSettings()
  const assets = useInvestmentAssets()
  const holdings = useInvestmentHoldingsWithDetails()
  const rates = useExchangeRates()
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)

  const historyPoints = history?.points.map((p) => ({ month: p.month, value: p.total }))
  const gainLossItems = holdings?.flatMap((item) =>
    item.gainLossPercent !== undefined
      ? [{ label: item.asset.symbol ?? item.asset.name, gainLossPercent: item.gainLossPercent }]
      : [],
  )

  const editingSavings = savings?.find((h) => h.id === editingSavingsId)
  const managingLotsAsset = assets?.find((a) => a.id === managingLotsAssetId) ?? null
  const pricingAsset = assets?.find((a) => a.id === pricingAssetId) ?? null
  // An asset the user just created has no holding yet, so it never shows
  // up in `holdings` — without this, creating one looked like it silently
  // did nothing (see InvestmentAssetRow's docstring).
  const assetsWithoutHolding = assets?.filter((a) => !holdings?.some((h) => h.asset.id === a.id))

  async function handleDelete() {
    if (!pendingDelete) return
    try {
      if (pendingDelete.kind === 'savings') {
        await deleteSavingsHolding(pendingDelete.id)
        toast.success('Ahorro eliminado')
      } else if (pendingDelete.kind === 'holding') {
        await deleteInvestmentHolding(pendingDelete.id)
        toast.success('Posición eliminada')
      } else if (pendingDelete.kind === 'asset') {
        await deleteInvestmentAsset(pendingDelete.id)
        toast.success('Activo eliminado')
      } else {
        await deleteExchangeRate(pendingDelete.id)
        toast.success('Tasa eliminada')
      }
    } catch {
      toast.error('No se pudo eliminar')
    } finally {
      setPendingDelete(null)
    }
  }

  async function handleDisplayCurrencyChange(currency: string) {
    try {
      await settingsRepo.updateSettings({ displayCurrency: currency })
    } catch {
      toast.error('No se pudo cambiar la moneda')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Ahorro e Inversiones"
        description="Plata guardada e invertida, fuera de tus cuentas."
        actions={
          tab === 'savings' ? (
            <Button onClick={openCreateSavingsDialog}>
              <Plus className="size-4" />
              Nuevo ahorro
            </Button>
          ) : tab === 'investments' ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button>
                  <Plus className="size-4" />
                  Nuevo
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={openAssetDialog}>Nuevo activo</DropdownMenuItem>
                {/* Deshabilitado también cuando todo activo ya tiene una
                    posición — nada nuevo que crear ahí, y el selector de
                    "Nueva posición" sólo ofrece activos sin holding
                    (ver InvestmentLotFormDialog) para no terminar con
                    dos filas separadas para el mismo activo. */}
                <DropdownMenuItem
                  onClick={() => openCreateLotDialog()}
                  disabled={!assetsWithoutHolding || assetsWithoutHolding.length === 0}
                >
                  Nueva posición
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : tab === 'quotes' ? (
            <Button onClick={openRateDialog}>
              <Plus className="size-4" />
              Nueva tasa
            </Button>
          ) : undefined
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as NetWorthTab)}>
        <TabsList>
          <TabsTrigger value="summary">Resumen</TabsTrigger>
          <TabsTrigger value="savings">Ahorros</TabsTrigger>
          <TabsTrigger value="investments">Inversiones</TabsTrigger>
          <TabsTrigger value="quotes">Cotizaciones</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'summary' &&
        (summary === undefined ? (
          <div className="h-64 animate-pulse rounded-xl bg-muted" />
        ) : (
          <div className="flex flex-col gap-4">
            <MissingRateBanner
              count={summary.missingRateCount}
              itemLabel={['ahorro o inversión', 'ahorros o inversiones']}
            />
            <MissingPriceBanner count={summary.missingPriceCount} />

            <Card>
              <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Total ahorros e inversiones</p>
                  <p className="mt-1 text-3xl font-semibold">
                    <MoneyText value={summary.total} />
                  </p>
                </div>
                <div className="flex flex-col gap-1.5 sm:w-40">
                  <span className="text-xs text-muted-foreground">Mostrar en</span>
                  {settings ? (
                    <Select value={summary.displayCurrency} onValueChange={(v) => void handleDisplayCurrencyChange(v)}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {NETWORTH_CURRENCIES.map((code) => (
                          <SelectItem key={code} value={code}>
                            {code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="h-9 animate-pulse rounded-md bg-muted" />
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Distribución</CardTitle>
              </CardHeader>
              <CardContent>
                <NetWorthDistribution savings={summary.byBucket.savings} investments={summary.byBucket.investments} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Evolución</CardTitle>
              </CardHeader>
              <CardContent>
                {historyPoints ? (
                  <MoneyTrendChart points={historyPoints} />
                ) : (
                  <div className="h-48 animate-pulse rounded-xl bg-muted" />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Ganancia/pérdida por posición</CardTitle>
              </CardHeader>
              <CardContent>
                {gainLossItems ? (
                  <InvestmentGainLossChart items={gainLossItems} />
                ) : (
                  <div className="h-32 animate-pulse rounded-xl bg-muted" />
                )}
              </CardContent>
            </Card>
          </div>
        ))}

      {tab === 'savings' &&
        (savings === undefined ? (
          <div className="h-40 animate-pulse rounded-xl bg-muted" />
        ) : savings.length === 0 ? (
          <EmptyState
            icon={PiggyBank}
            title="Todavía no cargaste ahorros"
            description="Registrá plata que tenés guardada pero no pasa por movimientos — efectivo, una caja de ahorro, etc."
            action={<Button onClick={openCreateSavingsDialog}>Nuevo ahorro</Button>}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {savings.map((item) => (
              <SavingsRow
                key={item.id}
                item={item}
                onEdit={() => openEditSavingsDialog(item.id)}
                onDelete={() => setPendingDelete({ kind: 'savings', id: item.id })}
              />
            ))}
          </div>
        ))}

      {tab === 'investments' &&
        (holdings === undefined || assets === undefined ? (
          <div className="h-40 animate-pulse rounded-xl bg-muted" />
        ) : assets.length === 0 ? (
          <EmptyState
            icon={LineChart}
            title="Todavía no cargaste inversiones"
            description="Creá un activo (ej. SPY, un CEDEAR, Bitcoin) y después una posición para ver cuánto tenés."
            action={<Button onClick={openAssetDialog}>Nuevo activo</Button>}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {holdings.map((item) => (
              <InvestmentRow
                key={item.holding.id}
                item={item}
                onManageLots={() => openManageLotsDialog(item.asset.id)}
                onDelete={() => setPendingDelete({ kind: 'holding', id: item.holding.id })}
                onLoadPrice={() => openPriceDialog(item.asset.id)}
              />
            ))}
            {assetsWithoutHolding?.map((asset) => (
              <InvestmentAssetRow
                key={asset.id}
                asset={asset}
                onAddHolding={() => openCreateLotDialog(asset.id)}
                onDelete={() => setPendingDelete({ kind: 'asset', id: asset.id })}
              />
            ))}
          </div>
        ))}

      {tab === 'quotes' &&
        (settings === undefined ? (
          <div className="h-40 animate-pulse rounded-xl bg-muted" />
        ) : (
          <div className="flex flex-col gap-4">
            <QuotesControls settings={settings} />

            {rates === undefined ? (
              <div className="h-40 animate-pulse rounded-xl bg-muted" />
            ) : rates.length === 0 ? (
              <EmptyState
                icon={TrendingUp}
                title="Todavía no cargaste ninguna tasa"
                description="Sin tasas, los ahorros e inversiones en otra moneda no se pueden consolidar."
                action={<Button onClick={openRateDialog}>Nueva tasa</Button>}
              />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Historial de tasas</CardTitle>
                </CardHeader>
                <CardContent className="px-3">
                  {rates.map((rate) => (
                    <ExchangeRateRow
                      key={rate.id}
                      item={rate}
                      onDelete={() => setPendingDelete({ kind: 'rate', id: rate.id })}
                    />
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        ))}

      <SavingsFormDialog
        open={savingsDialogOpen}
        holding={editingSavings}
        onOpenChange={(open) => (open ? undefined : closeSavingsDialog())}
      />

      <InvestmentAssetFormDialog
        open={assetDialogOpen}
        onOpenChange={(open) => (open ? undefined : closeAssetDialog())}
      />
      <InvestmentLotFormDialog
        open={lotDialogOpen}
        lot={undefined}
        assets={assets}
        availableAssets={assetsWithoutHolding}
        {...(newLotAssetId !== null && { initialAssetId: newLotAssetId })}
        onOpenChange={(open) => (open ? undefined : closeLotDialog())}
      />
      <InvestmentLotsDialog
        asset={managingLotsAsset}
        assets={assets}
        onOpenChange={(open) => (open ? undefined : closeManageLotsDialog())}
      />
      <InvestmentPriceDialog
        asset={pricingAsset}
        onOpenChange={(open) => (open ? undefined : closePriceDialog())}
      />
      <ExchangeRateFormDialog
        open={rateDialogOpen}
        onOpenChange={(open) => (open ? undefined : closeRateDialog())}
      />

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDelete?.kind === 'savings'
                ? '¿Eliminar este ahorro?'
                : pendingDelete?.kind === 'holding'
                  ? '¿Eliminar esta posición?'
                  : pendingDelete?.kind === 'asset'
                    ? '¿Eliminar este activo?'
                    : '¿Eliminar esta tasa?'}
            </AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
