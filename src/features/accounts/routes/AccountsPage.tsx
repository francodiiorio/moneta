import { MoreVertical, Plus, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { MoneyText } from '@/components/MoneyText'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAccounts } from '../hooks/useAccounts'
import { useAccountsUiStore } from '../store'
import { AccountFormDialog } from '../components/AccountFormDialog'
import { ACCOUNT_TYPE_LABELS } from '../labels'
import { setAccountArchived } from '../service'

export function AccountsPage() {
  const accounts = useAccounts()
  const { dialogOpen, editingAccountId, openCreateDialog, openEditDialog, closeDialog } =
    useAccountsUiStore()

  const editingAccount = accounts?.find((a) => a.id === editingAccountId)
  const visibleAccounts = accounts?.filter((a) => !a.isArchived) ?? []

  async function handleArchive(accountId: string, isArchived: boolean) {
    await setAccountArchived(accountId, isArchived)
    toast.success(isArchived ? 'Cuenta archivada' : 'Cuenta restaurada')
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Cuentas"
        description="Bancos, efectivo, tarjetas e inversiones."
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
            <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : visibleAccounts.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Todavía no tenés cuentas"
          description="Creá tu primera cuenta para empezar a registrar tus finanzas."
          action={<Button onClick={openCreateDialog}>Nueva cuenta</Button>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleAccounts.map((account) => (
            <Card key={account.id}>
              <CardContent className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{account.name}</p>
                    <Badge variant="secondary">{ACCOUNT_TYPE_LABELS[account.type]}</Badge>
                  </div>
                  <p className="mt-2 text-xl font-semibold">
                    <MoneyText value={{ amount: account.balance, currency: account.currency }} />
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="shrink-0">
                      <MoreVertical className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => openEditDialog(account.id)}>
                      Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleArchive(account.id, true)}>
                      Archivar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AccountFormDialog
        open={dialogOpen}
        account={editingAccount}
        onOpenChange={(open) => (open ? undefined : closeDialog())}
      />
    </div>
  )
}
