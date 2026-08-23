import { useState } from 'react'
import { toast } from 'sonner'
import { PiggyBank, Plus } from 'lucide-react'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { settingsRepo } from '@/database/repositories'
import { NETWORTH_CURRENCIES } from '../schema'
import { useNetWorthUiStore, type NetWorthTab } from '../store'
import { useSavingsHoldings } from '../hooks/useSavingsHoldings'
import { useNetWorthSummary } from '../hooks/useNetWorthSummary'
import { useSettings } from '../hooks/useSettings'
import { SavingsFormDialog } from '../components/SavingsFormDialog'
import { SavingsRow } from '../components/SavingsRow'
import { NetWorthDistribution } from '../components/NetWorthDistribution'
import { deleteSavingsHolding } from '../service'

export function NetWorthPage() {
  const { tab, setTab, savingsDialogOpen, editingSavingsId, openCreateSavingsDialog, openEditSavingsDialog, closeSavingsDialog } =
    useNetWorthUiStore()
  const savings = useSavingsHoldings()
  const summary = useNetWorthSummary()
  const settings = useSettings()
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const editingHolding = savings?.find((h) => h.id === editingSavingsId)

  async function handleDelete() {
    if (!pendingDeleteId) return
    try {
      await deleteSavingsHolding(pendingDeleteId)
      toast.success('Ahorro eliminado')
    } catch {
      toast.error('No se pudo eliminar')
    } finally {
      setPendingDeleteId(null)
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
          ) : undefined
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as NetWorthTab)}>
        <TabsList>
          <TabsTrigger value="summary">Resumen</TabsTrigger>
          <TabsTrigger value="savings">Ahorros</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'summary' ? (
        summary === undefined ? (
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
        )
      ) : savings === undefined ? (
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
              onDelete={() => setPendingDeleteId(item.id)}
            />
          ))}
        </div>
      )}

      <SavingsFormDialog
        open={savingsDialogOpen}
        holding={editingHolding}
        onOpenChange={(open) => (open ? undefined : closeSavingsDialog())}
      />

      <AlertDialog open={!!pendingDeleteId} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este ahorro?</AlertDialogTitle>
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
