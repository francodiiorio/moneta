import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ChevronLeft, ChevronRight, Plus, Receipt, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { useAccounts } from '../hooks/useAccounts'
import { useTransactionsUiStore } from '../store'
import { TransactionFormDialog } from '../components/TransactionFormDialog'
import { TransactionRow } from '../components/TransactionRow'
import { isEditableTransaction, removeTransaction, type TransactionKind, type TransactionListItem } from '../service'

const ALL = '__all__'

const DELETE_COPY: Record<TransactionKind, { title: string; deleted: string; failed: string }> = {
  expense: { title: '¿Eliminar este gasto?', deleted: 'Gasto eliminado', failed: 'No se pudo eliminar el gasto' },
  income: { title: '¿Eliminar este ingreso?', deleted: 'Ingreso eliminado', failed: 'No se pudo eliminar el ingreso' },
  transfer: {
    title: '¿Eliminar esta transferencia?',
    deleted: 'Transferencia eliminada',
    failed: 'No se pudo eliminar la transferencia',
  },
  // Never shown: an investment purchase has no delete action here.
  investment: {
    title: '¿Eliminar esta compra?',
    deleted: 'Compra eliminada',
    failed: 'No se pudo eliminar la compra',
  },
  // Never shown either: a statement payment is undone in Tarjetas.
  cardPayment: {
    title: '¿Eliminar este pago?',
    deleted: 'Pago eliminado',
    failed: 'No se pudo eliminar el pago',
  },
  adjustment: {
    title: '¿Eliminar este ajuste de saldo?',
    deleted: 'Ajuste de saldo eliminado',
    failed: 'No se pudo eliminar el ajuste de saldo',
  },
}

const CATEGORY_GROUPS = [
  { kind: 'expense', label: 'Gastos' },
  { kind: 'income', label: 'Ingresos' },
] as const

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
  const accounts = useAccounts()

  const {
    month,
    categoryFilter,
    accountFilter,
    setMonth,
    setCategoryFilter,
    setAccountFilter,
    dialogOpen,
    editingTransactionId,
    openCreateDialog,
    openEditDialog,
    closeDialog,
  } = useTransactionsUiStore()

  const [pendingDelete, setPendingDelete] = useState<TransactionListItem | null>(null)

  // "Ver movimientos" from Cuentas links here with ?cuenta=<id>: show only
  // that account, clearing any category filter left over from before (it
  // could otherwise hide everything), then drop the param so the filter
  // stays a normal, editable filter.
  const [searchParams, setSearchParams] = useSearchParams()
  const accountParam = searchParams.get('cuenta')
  useEffect(() => {
    if (!accountParam) return
    setAccountFilter(accountParam)
    setCategoryFilter(null)
    setSearchParams({}, { replace: true })
  }, [accountParam, setAccountFilter, setCategoryFilter, setSearchParams])

  const editingItem = transactions?.filter(isEditableTransaction).find((t) => t.id === editingTransactionId)
  const groups = groupByDate(transactions ?? [])

  const deleteCopy = pendingDelete ? DELETE_COPY[pendingDelete.kind] : DELETE_COPY.expense

  async function handleDelete() {
    if (!pendingDelete) return
    try {
      await removeTransaction(pendingDelete.id, pendingDelete.kind)
      toast.success(deleteCopy.deleted)
    } catch {
      toast.error(deleteCopy.failed)
    } finally {
      setPendingDelete(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Movimientos"
        description="Tus gastos, ingresos y transferencias."
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
              Nuevo movimiento
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
            {CATEGORY_GROUPS.map(({ kind, label }) => {
              const ofKind = categories?.filter((c) => c.kind === kind) ?? []
              if (ofKind.length === 0) return null
              return (
                <SelectGroup key={kind}>
                  <SelectLabel>{label}</SelectLabel>
                  {ofKind.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )
            })}
          </SelectContent>
        </Select>

        {accounts !== undefined && accounts.length > 0 && (
          <Select value={accountFilter ?? ALL} onValueChange={(v) => setAccountFilter(v === ALL ? null : v)}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Todas las cuentas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas las cuentas</SelectItem>
              {accounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.isArchived ? `${account.name} (archivada)` : account.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
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
          title="No hay movimientos este mes"
          description="Registrá un gasto o un ingreso para empezar."
          action={<Button onClick={() => openCreateDialog()}>Nuevo movimiento</Button>}
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
                    onDelete={() => setPendingDelete(item)}
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

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteCopy.title}</AlertDialogTitle>
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
