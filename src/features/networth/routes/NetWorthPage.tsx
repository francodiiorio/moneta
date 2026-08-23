import { useState } from 'react'
import { toast } from 'sonner'
import { LineChart, PiggyBank, Plus } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { MoneyText } from '@/components/MoneyText'
import { MissingRateBanner } from '@/components/MissingRateBanner'
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
import { useSettings } from '../hooks/useSettings'
import { useInvestmentAssets } from '../hooks/useInvestmentAssets'
import { useInvestmentHoldingsWithDetails } from '../hooks/useInvestmentHoldingsWithDetails'
import { SavingsFormDialog } from '../components/SavingsFormDialog'
import { SavingsRow } from '../components/SavingsRow'
import { NetWorthDistribution } from '../components/NetWorthDistribution'
import { InvestmentAssetFormDialog } from '../components/InvestmentAssetFormDialog'
import { InvestmentHoldingFormDialog } from '../components/InvestmentHoldingFormDialog'
import { InvestmentPriceDialog } from '../components/InvestmentPriceDialog'
import { InvestmentRow } from '../components/InvestmentRow'
import { deleteInvestmentHolding, deleteSavingsHolding } from '../service'

type PendingDelete = { kind: 'savings' | 'holding'; id: string }

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
    holdingDialogOpen,
    editingHoldingId,
    openCreateHoldingDialog,
    openEditHoldingDialog,
    closeHoldingDialog,
    pricingAssetId,
    openPriceDialog,
    closePriceDialog,
  } = useNetWorthUiStore()
  const savings = useSavingsHoldings()
  const summary = useNetWorthSummary()
  const settings = useSettings()
  const assets = useInvestmentAssets()
  const holdings = useInvestmentHoldingsWithDetails()
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)

  const editingSavings = savings?.find((h) => h.id === editingSavingsId)
  const editingHolding = holdings?.find((h) => h.holding.id === editingHoldingId)?.holding
  const pricingAsset = assets?.find((a) => a.id === pricingAssetId) ?? null

  async function handleDelete() {
    if (!pendingDelete) return
    try {
      if (pendingDelete.kind === 'savings') {
        await deleteSavingsHolding(pendingDelete.id)
        toast.success('Ahorro eliminado')
      } else {
        await deleteInvestmentHolding(pendingDelete.id)
        toast.success('Posición eliminada')
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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Patrimonio"
        description="Ahorros e inversiones, y tu patrimonio total consolidado."
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
                <DropdownMenuItem onClick={openCreateHoldingDialog} disabled={!assets || assets.length === 0}>
                  Nueva posición
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : undefined
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as NetWorthTab)}>
        <TabsList>
          <TabsTrigger value="summary">Resumen</TabsTrigger>
          <TabsTrigger value="savings">Ahorros</TabsTrigger>
          <TabsTrigger value="investments">Inversiones</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'summary' &&
        (summary === undefined ? (
          <div className="h-64 animate-pulse rounded-xl bg-muted" />
        ) : (
          <div className="flex flex-col gap-4">
            <MissingRateBanner
              count={summary.missingRateCount}
              itemLabel={['cuenta, ahorro o inversión', 'cuentas, ahorros o inversiones']}
            />

            <Card>
              <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Patrimonio total</p>
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
                <NetWorthDistribution
                  accounts={summary.byBucket.accounts}
                  savings={summary.byBucket.savings}
                  investments={summary.byBucket.investments}
                />
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
        (holdings === undefined ? (
          <div className="h-40 animate-pulse rounded-xl bg-muted" />
        ) : holdings.length === 0 ? (
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
                onEdit={() => openEditHoldingDialog(item.holding.id)}
                onDelete={() => setPendingDelete({ kind: 'holding', id: item.holding.id })}
                onLoadPrice={() => openPriceDialog(item.asset.id)}
              />
            ))}
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
      <InvestmentHoldingFormDialog
        open={holdingDialogOpen}
        holding={editingHolding}
        assets={assets}
        onOpenChange={(open) => (open ? undefined : closeHoldingDialog())}
      />
      <InvestmentPriceDialog
        asset={pricingAsset}
        onOpenChange={(open) => (open ? undefined : closePriceDialog())}
      />

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDelete?.kind === 'savings' ? '¿Eliminar este ahorro?' : '¿Eliminar esta posición?'}
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
