import { useState } from 'react'
import { toast } from 'sonner'
import { CalendarSync, Plus, Receipt } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePlansUiStore, type PlansTab } from '../store'
import { useRecurringPlans } from '../hooks/useRecurringPlans'
import { useInstallmentPlans } from '../hooks/useInstallmentPlans'
import { RecurringPlanFormDialog } from '../components/RecurringPlanFormDialog'
import { InstallmentPlanFormDialog } from '../components/InstallmentPlanFormDialog'
import { InstallmentPlanEditDialog } from '../components/InstallmentPlanEditDialog'
import { RecurringPlanRow } from '../components/RecurringPlanRow'
import { InstallmentPlanRow } from '../components/InstallmentPlanRow'
import { removeInstallmentPlan, removeRecurringPlan, setRecurringPlanPaused } from '../service'

export function PlansPage() {
  const {
    tab,
    setTab,
    recurringDialogOpen,
    editingRecurringId,
    openCreateRecurringDialog,
    openEditRecurringDialog,
    closeRecurringDialog,
    installmentDialogOpen,
    openInstallmentDialog,
    closeInstallmentDialog,
    installmentEditId,
    openInstallmentEditDialog,
    closeInstallmentEditDialog,
  } = usePlansUiStore()
  const recurringPlans = useRecurringPlans()
  const installmentPlans = useInstallmentPlans()
  const [pendingDelete, setPendingDelete] = useState<{ kind: PlansTab; id: string } | null>(null)
  const [deleteGenerated, setDeleteGenerated] = useState(false)

  const editingRecurringPlan = recurringPlans?.find((item) => item.id === editingRecurringId)?.plan
  const editingInstallmentPlan = installmentPlans?.find((item) => item.id === installmentEditId)?.plan ?? null
  const pendingDeleteRecurringPlan =
    pendingDelete?.kind === 'recurring' ? recurringPlans?.find((item) => item.id === pendingDelete.id) : undefined

  async function handleTogglePaused(id: string, isPaused: boolean) {
    try {
      await setRecurringPlanPaused(id, !isPaused)
    } catch (error) {
      // The real message matters here: a MaterializationFailedError means
      // the pause/unpause itself already succeeded (only the immediate
      // catch-up failed) — a generic "no se pudo actualizar" would falsely
      // suggest nothing happened, right next to a row whose badge/icon
      // already shows the new (correct) paused state.
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar el recurrente')
    }
  }

  function openDeleteDialog(kind: PlansTab, id: string) {
    setDeleteGenerated(false)
    setPendingDelete({ kind, id })
  }

  async function handleDelete() {
    if (!pendingDelete) return
    try {
      if (pendingDelete.kind === 'recurring') {
        await removeRecurringPlan(pendingDelete.id, { deleteGeneratedExpenses: deleteGenerated })
      } else {
        await removeInstallmentPlan(pendingDelete.id)
      }
      toast.success('Eliminado')
    } catch {
      toast.error('No se pudo eliminar')
    } finally {
      setPendingDelete(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Planes"
        description="Recurrentes y compras en cuotas."
        actions={
          <Button onClick={tab === 'recurring' ? openCreateRecurringDialog : openInstallmentDialog}>
            <Plus className="size-4" />
            {tab === 'recurring' ? 'Nuevo recurrente' : 'Nueva compra en cuotas'}
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as PlansTab)}>
        <TabsList>
          <TabsTrigger value="recurring">Recurrentes</TabsTrigger>
          <TabsTrigger value="installments">Cuotas</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'recurring' ? (
        recurringPlans === undefined ? (
          <div className="h-40 animate-pulse rounded-xl bg-muted" />
        ) : recurringPlans.length === 0 ? (
          <EmptyState
            icon={CalendarSync}
            title="Todavía no tenés recurrentes"
            description="Creá uno para que un movimiento se genere solo cada vez que corresponda."
            action={<Button onClick={openCreateRecurringDialog}>Nuevo recurrente</Button>}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {recurringPlans.map((item) => (
              <RecurringPlanRow
                key={item.id}
                item={item}
                onEdit={() => openEditRecurringDialog(item.id)}
                onTogglePaused={() => void handleTogglePaused(item.id, item.isPaused)}
                onDelete={() => openDeleteDialog('recurring', item.id)}
              />
            ))}
          </div>
        )
      ) : installmentPlans === undefined ? (
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
      ) : installmentPlans.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Todavía no tenés compras en cuotas"
          description="Cargá una compra dividida en cuotas y seguí cuánto te falta pagar."
          action={<Button onClick={openInstallmentDialog}>Nueva compra en cuotas</Button>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {installmentPlans.map((item) => (
            <InstallmentPlanRow
              key={item.id}
              item={item}
              onEdit={() => openInstallmentEditDialog(item.id)}
              onDelete={() => openDeleteDialog('installments', item.id)}
            />
          ))}
        </div>
      )}

      <RecurringPlanFormDialog
        open={recurringDialogOpen}
        plan={editingRecurringPlan}
        onOpenChange={(open) => (open ? undefined : closeRecurringDialog())}
      />
      <InstallmentPlanFormDialog
        open={installmentDialogOpen}
        onOpenChange={(open) => (open ? undefined : closeInstallmentDialog())}
      />
      <InstallmentPlanEditDialog
        plan={editingInstallmentPlan}
        onOpenChange={(open) => (open ? undefined : closeInstallmentEditDialog())}
      />

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDelete?.kind === 'recurring' ? '¿Eliminar este recurrente?' : '¿Eliminar esta compra en cuotas?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.kind === 'recurring'
                ? 'Los movimientos que ya se generaron quedan intactos — sólo se detienen los futuros.'
                : 'Las cuotas ya vencidas quedan intactas en Movimientos — sólo se borran las que todavía no vencieron.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingDelete?.kind === 'recurring' && (pendingDeleteRecurringPlan?.generatedCount ?? 0) > 0 && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="delete-generated-transactions"
                checked={deleteGenerated}
                onCheckedChange={(checked) => setDeleteGenerated(checked === true)}
              />
              <Label htmlFor="delete-generated-transactions" className="text-sm font-normal">
                Borrar también los {pendingDeleteRecurringPlan?.generatedCount} movimientos que ya generó
              </Label>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
