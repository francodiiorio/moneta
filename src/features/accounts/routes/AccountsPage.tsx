import { useState } from 'react'
import { useNavigate } from 'react-router'
import { MoreVertical, Plus, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { MoneyText } from '@/components/MoneyText'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
import { isNegative } from '@/domain/money'
import { formatShortDate } from '@/lib/dates'
import { useAccountsWithBalances } from '../hooks/useAccountsWithBalances'
import { useAccountsUiStore } from '../store'
import { AccountFormDialog } from '../components/AccountFormDialog'
import { AdjustBalanceDialog } from '../components/AdjustBalanceDialog'
import { ACCOUNT_TYPE_LABELS } from '../labels'
import { deleteAccount, setAccountArchived, type AccountWithBalance } from '../service'

export function AccountsPage() {
  const accounts = useAccountsWithBalances()
  const navigate = useNavigate()
  const {
    formOpen,
    editingAccountId,
    adjustingAccountId,
    showArchived,
    openCreateDialog,
    openEditDialog,
    openAdjustDialog,
    closeDialogs,
    toggleShowArchived,
  } = useAccountsUiStore()
  const [pendingDelete, setPendingDelete] = useState<AccountWithBalance | null>(null)

  const editingAccount = accounts?.find((a) => a.id === editingAccountId)
  const adjustingAccount = accounts?.find((a) => a.id === adjustingAccountId)
  const activeAccounts = accounts?.filter((a) => !a.isArchived) ?? []
  const archivedAccounts = accounts?.filter((a) => a.isArchived) ?? []

  // A URL param, not a write into Movimientos' own UI store: that page
  // decides what the param means for its filters (see TransactionsPage).
  function handleViewMovements(accountId: string) {
    void navigate(`/movimientos?cuenta=${encodeURIComponent(accountId)}`)
  }

  async function handleArchive(account: AccountWithBalance, isArchived: boolean) {
    try {
      await setAccountArchived(account.id, isArchived)
      toast.success(isArchived ? 'Cuenta archivada' : 'Cuenta restaurada')
    } catch {
      toast.error('No se pudo actualizar la cuenta')
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return
    try {
      await deleteAccount(pendingDelete.id)
      toast.success('Cuenta eliminada')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo eliminar la cuenta')
    } finally {
      setPendingDelete(null)
    }
  }

  function renderAccount(account: AccountWithBalance) {
    return (
      <Card key={account.id} className={account.isArchived ? 'opacity-70' : undefined}>
        <CardContent className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate font-medium">{account.name}</p>
              <Badge variant="secondary">{ACCOUNT_TYPE_LABELS[account.type]}</Badge>
            </div>
            <p className="mt-2 text-xl font-semibold">
              {account.balance ? (
                <MoneyText value={account.balance} signColor={isNegative(account.balance)} />
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {account.currency} · desde el {formatShortDate(account.openingDate)}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0" aria-label={`Opciones de ${account.name}`}>
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => handleViewMovements(account.id)}>Ver movimientos</DropdownMenuItem>
              {!account.isArchived && (
                <DropdownMenuItem onSelect={() => openAdjustDialog(account.id)}>Ajustar saldo</DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => openEditDialog(account.id)}>Editar</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void handleArchive(account, !account.isArchived)}>
                {account.isArchived ? 'Restaurar' : 'Archivar'}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setPendingDelete(account)}>
                Eliminar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Cuentas"
        description="Bancos, efectivo y billeteras. El saldo se calcula con tus ingresos, gastos con débito, transferencias y ajustes."
        actions={
          <Button onClick={openCreateDialog}>
            <Plus className="size-4" />
            Nueva cuenta
          </Button>
        }
      />

      {accounts === undefined ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : activeAccounts.length === 0 && archivedAccounts.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Todavía no tenés cuentas"
          description="Creá una cuenta para registrar ingresos y gastos con débito, y seguir su saldo."
          action={<Button onClick={openCreateDialog}>Nueva cuenta</Button>}
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{activeAccounts.map(renderAccount)}</div>
          {archivedAccounts.length > 0 && (
            <div className="flex flex-col gap-3">
              <Button variant="ghost" size="sm" className="w-fit" onClick={toggleShowArchived}>
                {showArchived ? 'Ocultar archivadas' : `Ver archivadas (${archivedAccounts.length})`}
              </Button>
              {showArchived && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{archivedAccounts.map(renderAccount)}</div>
              )}
            </div>
          )}
        </>
      )}

      <AccountFormDialog
        open={formOpen}
        account={editingAccount}
        onOpenChange={(open) => (open ? undefined : closeDialogs())}
      />
      <AdjustBalanceDialog account={adjustingAccount} onOpenChange={(open) => (open ? undefined : closeDialogs())} />

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar la cuenta "{pendingDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Sólo se puede eliminar una cuenta sin movimientos. Si ya tiene, archivala: deja de aparecer para
              cargar movimientos nuevos, pero su historial y su saldo se conservan.
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
