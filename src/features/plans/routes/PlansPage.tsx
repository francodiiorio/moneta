import { useEffect, useState } from 'react'
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
import { usePlansUiStore, type PlanKind } from '../store'
import { useRecurringPlans } from '../hooks/useRecurringPlans'
import { useInstallmentPlans } from '../hooks/useInstallmentPlans'
import { useCuotaTimeline } from '../hooks/useCuotaTimeline'
import { RecurringPlanFormDialog } from '../components/RecurringPlanFormDialog'
import { InstallmentPlanFormDialog } from '../components/InstallmentPlanFormDialog'
import { InstallmentPlanEditDialog } from '../components/InstallmentPlanEditDialog'
import { RecurringPlanRow } from '../components/RecurringPlanRow'
import { InstallmentPlanRow } from '../components/InstallmentPlanRow'
import { CuotaTimeline } from '../components/CuotaTimeline'
import { removeInstallmentPlan, removeRecurringPlan, setRecurringPlanPaused } from '../service'

interface PlansPageProps {
  /** Each kind is a tab of a hub page (src/app/hubs): installments under
   *  Tarjetas, recurring plans under Presupuesto as "Gastos
   *  fijos". */
  kind: PlanKind
}

export function PlansPage({ kind }: PlansPageProps) {
  const closeAll = usePlansUiStore((s) => s.closeAll)
  useEffect(() => closeAll, [closeAll])
  return kind === 'recurring' ? <RecurringPlans /> : <InstallmentPlans />
}

function RecurringPlans() {
  const {
    recurringDialogOpen,
    editingRecurringId,
    newRecurringKind,
    openCreateRecurringDialog,
    openEditRecurringDialog,
    closeRecurringDialog,
  } = usePlansUiStore()
  const plans = useRecurringPlans()
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [deleteGenerated, setDeleteGenerated] = useState(false)

  const editingPlan = plans?.find((item) => item.id === editingRecurringId)?.plan
  const pendingDelete = plans?.find((item) => item.id === pendingDeleteId)

  async function handleTogglePaused(id: string, isPaused: boolean) {
    try {
      await setRecurringPlanPaused(id, !isPaused)
    } catch (error) {
      // The real message matters here: a MaterializationFailedError means
      // the pause/unpause itself already succeeded (only the immediate
      // catch-up failed) — a generic "no se pudo actualizar" would falsely
      // suggest nothing happened, right next to a row whose badge/icon
      // already shows the new (correct) paused state.
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar el gasto fijo')
    }
  }

  async function handleDelete() {
    if (!pendingDeleteId) return
    try {
      await removeRecurringPlan(pendingDeleteId, { deleteGeneratedExpenses: deleteGenerated })
      toast.success('Eliminado')
    } catch {
      toast.error('No se pudo eliminar')
    } finally {
      setPendingDeleteId(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        embedded
        title="Fijos"
        description="Lo que se repite solo: el sueldo, la prepaga, el alquiler, las suscripciones."
        actions={
          <>
            <Button variant="outline" onClick={() => openCreateRecurringDialog('income')}>
              <Plus className="size-4" />
              Nuevo ingreso fijo
            </Button>
            <Button onClick={() => openCreateRecurringDialog('expense')}>
              <Plus className="size-4" />
              Nuevo gasto fijo
            </Button>
          </>
        }
      />

      {plans === undefined ? (
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
      ) : plans.length === 0 ? (
        <EmptyState
          icon={CalendarSync}
          title="Todavía no tenés nada fijo"
          description="Cargá tu sueldo, la prepaga o el alquiler una vez y se anotan solos cada mes."
          action={<Button onClick={() => openCreateRecurringDialog('income')}>Cargar mi sueldo</Button>}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {plans.map((item) => (
            <RecurringPlanRow
              key={item.id}
              item={item}
              onEdit={() => openEditRecurringDialog(item.id)}
              onTogglePaused={() => void handleTogglePaused(item.id, item.isPaused)}
              onDelete={() => {
                setDeleteGenerated(false)
                setPendingDeleteId(item.id)
              }}
            />
          ))}
        </div>
      )}

      <RecurringPlanFormDialog
        open={recurringDialogOpen}
        plan={editingPlan}
        newKind={newRecurringKind}
        onOpenChange={(open) => (open ? undefined : closeRecurringDialog())}
      />

      <AlertDialog open={!!pendingDeleteId} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar {pendingDelete?.kind === 'income' ? 'este ingreso fijo' : 'este gasto fijo'}?</AlertDialogTitle>
            <AlertDialogDescription>
              Los movimientos que ya se generaron quedan intactos — sólo se detienen los futuros.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {(pendingDelete?.generatedCount ?? 0) > 0 && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="delete-generated-transactions"
                checked={deleteGenerated}
                onCheckedChange={(checked) => setDeleteGenerated(checked === true)}
              />
              <Label htmlFor="delete-generated-transactions" className="text-sm font-normal">
                Borrar también los {pendingDelete?.generatedCount} movimientos que ya generó
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

function InstallmentPlans() {
  const {
    installmentDialogOpen,
    openInstallmentDialog,
    closeInstallmentDialog,
    installmentEditId,
    openInstallmentEditDialog,
    closeInstallmentEditDialog,
  } = usePlansUiStore()
  const plans = useInstallmentPlans()
  const timeline = useCuotaTimeline()
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const editingPlan = plans?.find((item) => item.id === installmentEditId)?.plan ?? null

  async function handleDelete() {
    if (!pendingDeleteId) return
    try {
      await removeInstallmentPlan(pendingDeleteId)
      toast.success('Eliminado')
    } catch {
      toast.error('No se pudo eliminar')
    } finally {
      setPendingDeleteId(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        embedded
        title="Cuotas"
        description="Compras en cuotas, con tarjeta o sin."
        actions={
          <Button onClick={openInstallmentDialog}>
            <Plus className="size-4" />
            Nueva compra en cuotas
          </Button>
        }
      />

      {plans === undefined ? (
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
      ) : plans.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Todavía no tenés compras en cuotas"
          description="Cargá una compra dividida en cuotas y seguí cuánto te falta pagar."
          action={<Button onClick={openInstallmentDialog}>Nueva compra en cuotas</Button>}
        />
      ) : (
        <>
          <CuotaTimeline timeline={timeline} />
          <div className="grid gap-3 sm:grid-cols-2">
            {plans.map((item) => (
              <InstallmentPlanRow
                key={item.id}
                item={item}
                onEdit={() => openInstallmentEditDialog(item.id)}
                onDelete={() => setPendingDeleteId(item.id)}
              />
            ))}
          </div>
        </>
      )}

      <InstallmentPlanFormDialog
        open={installmentDialogOpen}
        onOpenChange={(open) => (open ? undefined : closeInstallmentDialog())}
      />
      <InstallmentPlanEditDialog
        plan={editingPlan}
        onOpenChange={(open) => (open ? undefined : closeInstallmentEditDialog())}
      />

      <AlertDialog open={!!pendingDeleteId} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta compra en cuotas?</AlertDialogTitle>
            <AlertDialogDescription>
              Las cuotas ya vencidas quedan intactas en Movimientos — sólo se borran las que todavía no vencieron.
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
