import { useState } from 'react'
import { Link } from 'react-router'
import { ChevronLeft, ChevronRight, Plus, Receipt, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
import { fromDateStamp, formatMonthLabel, shiftMonth } from '@/lib/dates'
import { useTransactions } from '../hooks/useTransactions'
import { useAllCategories } from '../hooks/useAllCategories'
import { useTransactionsUiStore } from '../store'
import { TransactionFormDialog } from '../components/TransactionFormDialog'
import { TransactionRow } from '../components/TransactionRow'
import { removeTransaction, type TransactionListItem } from '../service'

const ALL = '__all__'

function groupByDate(items: TransactionListItem[]): [string, TransactionListItem[]][] {
  const groups = new Map<string, TransactionListItem[]>()
  for (const item of items) {
    const list = groups.get(item.date) ?? []
    list.push(item)
    groups.set(item.date, list)
  }
  return [...groups.entries()]
}

function dateLabel(date: string): string {
  const label = format(fromDateStamp(date), "EEEE d 'de' MMMM", { locale: es })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function TransactionsPage() {
  const transactions = useTransactions()
  const categories = useAllCategories()

  const {
    month,
    categoryFilter,
    setMonth,
    setCategoryFilter,
    dialogOpen,
    editingTransactionId,
    openCreateDialog,
    openEditDialog,
    closeDialog,
  } = useTransactionsUiStore()

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const editingItem = transactions?.find((t) => t.id === editingTransactionId)
  const groups = groupByDate(transactions ?? [])

  async function handleDelete() {
    if (!pendingDeleteId) return
    try {
      await removeTransaction(pendingDeleteId)
      toast.success('Gasto eliminado')
    } catch {
      toast.error('No se pudo eliminar el gasto')
    } finally {
      setPendingDeleteId(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Movimientos"
        description="Tus gastos."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/movimientos/importar">
                <Upload className="size-4" />
                Importar CSV
              </Link>
            </Button>
            <Button onClick={() => openCreateDialog()}>
              <Plus className="size-4" />
              Nuevo gasto
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-36 text-center text-sm font-medium capitalize">
            {formatMonthLabel(month)}
          </span>
          <Button variant="ghost" size="icon" onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <Select value={categoryFilter ?? ALL} onValueChange={(v) => setCategoryFilter(v === ALL ? null : v)}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Todas las categorías" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas las categorías</SelectItem>
            {categories?.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {transactions === undefined ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No hay gastos este mes"
          description="Registrá un gasto para empezar."
          action={<Button onClick={() => openCreateDialog()}>Nuevo gasto</Button>}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map(([date, items]) => (
            <div key={date}>
              <p className="mb-1 text-xs font-medium text-muted-foreground">{dateLabel(date)}</p>
              <div className="rounded-xl border border-border px-3">
                {items.map((item) => (
                  <TransactionRow
                    key={item.id}
                    item={item}
                    onEdit={() => openEditDialog(item.id)}
                    onDelete={() => setPendingDeleteId(item.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <TransactionFormDialog
        open={dialogOpen}
        item={editingItem}
        onOpenChange={(open) => (open ? undefined : closeDialog())}
      />

      <AlertDialog open={!!pendingDeleteId} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este gasto?</AlertDialogTitle>
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
