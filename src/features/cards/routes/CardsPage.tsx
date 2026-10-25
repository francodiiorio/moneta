import { useState } from 'react'
import { Link } from 'react-router'
import { ChevronRight, CreditCard as CreditCardIcon, MoreVertical, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { CreditCard } from '@/domain/entities'
import { formatShortDate, relativeDays } from '@/lib/dates'
import { CardFormDialog } from '../components/CardFormDialog'
import { PayStatementDialog } from '../components/PayStatementDialog'
import { DueBadge } from '../components/DueBadge'
import { MoneyTotals } from '@/components/MoneyTotals'
import { useCardSummaries } from '../hooks/useCardSummaries'
import { deleteCreditCard, setCreditCardArchived, type CardSummary } from '../service'
import { useCardsUiStore } from '../store'

export function CardsPage() {
  const summaries = useCardSummaries()
  const { formOpen, editingCardId, showArchived, openCreateDialog, openEditDialog, closeDialog, toggleShowArchived } =
    useCardsUiStore()
  const [pendingDelete, setPendingDelete] = useState<CreditCard | null>(null)
  const [payingCardId, setPayingCardId] = useState<string | null>(null)
  const paying = summaries?.find((s) => s.card.id === payingCardId)

  const editingCard = summaries?.find((s) => s.card.id === editingCardId)?.card
  const active = summaries?.filter((s) => !s.card.isArchived) ?? []
  const archived = summaries?.filter((s) => s.card.isArchived) ?? []

  async function handleArchive(card: CreditCard, isArchived: boolean) {
    try {
      await setCreditCardArchived(card.id, isArchived)
      toast.success(isArchived ? 'Tarjeta archivada' : 'Tarjeta restaurada')
    } catch {
      toast.error('No se pudo actualizar la tarjeta')
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return
    try {
      await deleteCreditCard(pendingDelete.id)
      toast.success('Tarjeta eliminada')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo eliminar la tarjeta')
    } finally {
      setPendingDelete(null)
    }
  }

  function renderCard({ card, current, previous, daysToClose, daysToDue }: CardSummary) {
    return (
      <Card key={card.id} className={card.isArchived ? 'opacity-70' : undefined}>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium">{card.name}</p>
              <p className="text-xs text-muted-foreground">
                Cierra el {card.closingDay} · vence el {card.dueDay}
                {card.closingDayToNext && ` · lo del ${card.closingDay} va al siguiente`}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="shrink-0" aria-label={`Opciones de ${card.name}`}>
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => openEditDialog(card.id)}>Editar</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void handleArchive(card, !card.isArchived)}>
                  {card.isArchived ? 'Restaurar' : 'Archivar'}
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => setPendingDelete(card)}>
                  Eliminar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground">
              Resumen en curso · cierra el {formatShortDate(current.closeDate)} ({relativeDays(daysToClose)})
            </p>
            <MoneyTotals totals={current.totals} className="mt-1 text-lg font-semibold" />
          </div>

          <div className="flex items-end justify-between gap-2 px-1">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">
                Resumen cerrado · {daysToDue >= 0 ? 'vence' : 'venció'} el {formatShortDate(previous.dueDate)} (
                {relativeDays(daysToDue)})
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <MoneyTotals totals={previous.totals} className="font-medium" />
                <DueBadge due={previous.due} />
              </div>
            </div>
            {/* Archived too: a cancelled card still has its last statement to pay. */}
            {(previous.due === 'pending' || previous.due === 'overdue') && (
              <Button size="sm" onClick={() => setPayingCardId(card.id)}>
                Pagar
              </Button>
            )}
          </div>

          <Button variant="outline" size="sm" className="w-full" asChild>
            <Link to={`/tarjetas/${card.id}`}>
              Ver resúmenes
              <ChevronRight className="size-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Tarjetas"
        description="Cuándo cierra y vence cada tarjeta, y cuánto vas a pagar en cada resumen."
        actions={
          <Button onClick={openCreateDialog}>
            <Plus className="size-4" />
            Nueva tarjeta
          </Button>
        }
      />

      {summaries === undefined ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-56 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : summaries.length === 0 ? (
        <EmptyState
          icon={CreditCardIcon}
          title="Todavía no cargaste tarjetas"
          description="Agregá tu tarjeta con sus días de cierre y vencimiento. Después, al cargar un gasto, elegila como medio de pago."
          action={<Button onClick={openCreateDialog}>Nueva tarjeta</Button>}
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{active.map(renderCard)}</div>
          {archived.length > 0 && (
            <div className="flex flex-col gap-3">
              <Button variant="ghost" size="sm" className="w-fit" onClick={toggleShowArchived}>
                {showArchived ? 'Ocultar archivadas' : `Ver archivadas (${archived.length})`}
              </Button>
              {showArchived && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{archived.map(renderCard)}</div>}
            </div>
          )}
        </>
      )}

      <PayStatementDialog
        cardId={paying?.card.id ?? ''}
        cardName={paying?.card.name ?? ''}
        statement={paying?.previous}
        onOpenChange={(open) => (open ? undefined : setPayingCardId(null))}
      />

      <CardFormDialog open={formOpen} card={editingCard} onOpenChange={(open) => (open ? undefined : closeDialog())} />

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar la tarjeta "{pendingDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Sólo se puede eliminar una tarjeta sin gastos. Si ya tiene, archivala: deja de aparecer para cargar gastos
              nuevos, pero sus resúmenes se conservan.
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
