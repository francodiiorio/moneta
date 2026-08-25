import { useState } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, PiggyBank, Plus } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { MissingRateBanner } from '@/components/MissingRateBanner'
import { Button } from '@/components/ui/button'
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
import { formatMonthLabel, shiftMonth } from '@/lib/dates'
import { useBudgetsUiStore } from '../store'
import { useBudgetsWithProgress } from '../hooks/useBudgetsWithProgress'
import { BudgetFormDialog } from '../components/BudgetFormDialog'
import { BudgetProgressRow } from '../components/BudgetProgressRow'
import { removeBudget } from '../service'

export function BudgetsPage() {
  const { month, setMonth, dialogOpen, openCreateDialog, closeDialog } = useBudgetsUiStore()
  const result = useBudgetsWithProgress(month)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  async function handleDelete() {
    if (!pendingDeleteId) return
    try {
      await removeBudget(pendingDeleteId)
      toast.success('Presupuesto eliminado')
    } catch {
      toast.error('No se pudo eliminar el presupuesto')
    } finally {
      setPendingDeleteId(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Presupuestos"
        description="Límites de gasto por categoría, mensuales o anuales."
        actions={
          <Button onClick={openCreateDialog}>
            <Plus className="size-4" />
            Nuevo presupuesto
          </Button>
        }
      />

      <MissingRateBanner count={result?.missingRateCount ?? 0} />

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" onClick={() => setMonth(shiftMonth(month, -1))}>
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-36 text-center text-sm font-medium capitalize">{formatMonthLabel(month)}</span>
        <Button variant="ghost" size="icon" onClick={() => setMonth(shiftMonth(month, 1))}>
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {result === undefined ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : result.items.length === 0 ? (
        <EmptyState
          icon={PiggyBank}
          title="Todavía no tenés presupuestos"
          description="Creá uno para ponerle un límite de gasto a una categoría."
          action={<Button onClick={openCreateDialog}>Nuevo presupuesto</Button>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {result.items.map((item) => (
            <BudgetProgressRow
              key={item.budgetId}
              item={item}
              onDelete={() => setPendingDeleteId(item.budgetId)}
            />
          ))}
        </div>
      )}

      <BudgetFormDialog open={dialogOpen} onOpenChange={(open) => (open ? undefined : closeDialog())} />

      <AlertDialog open={!!pendingDeleteId} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este presupuesto?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Si tenía versiones anteriores con otro monto,
              esas quedan intactas — sólo se borra la vigencia actual.
            </AlertDialogDescription>
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
