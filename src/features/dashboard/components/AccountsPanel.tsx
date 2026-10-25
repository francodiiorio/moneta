import { Link } from 'react-router'
import { Wallet } from 'lucide-react'
import { MoneyText } from '@/components/MoneyText'
// Another feature's hook and labels, never its components (see CardDeadlines).
import { useAccountsWithBalances } from '@/features/accounts/hooks/useAccountsWithBalances'
import { ACCOUNT_TYPE_LABELS } from '@/features/accounts/labels'
import { Panel, PanelEmpty } from './Panel'

interface AccountsPanelProps {
  /** The Patrimonio eye: balances are part of it, so they hide with it. */
  hideAmounts: boolean
}

export function AccountsPanel({ hideAmounts }: AccountsPanelProps) {
  const accounts = useAccountsWithBalances()?.filter((a) => !a.isArchived)

  return (
    <Panel title="Cuentas" icon={Wallet} to="/cuentas">
      {accounts === undefined ? (
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
      ) : accounts.length === 0 ? (
        <PanelEmpty text="Cargá tu banco o tu efectivo con el saldo de hoy." to="/cuentas" action="Crear una cuenta" />
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {accounts.slice(0, 5).map((account) => (
            <Link key={account.id} to="/cuentas" className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{account.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {ACCOUNT_TYPE_LABELS[account.type]} · {account.currency}
                </span>
              </span>
              <span className="shrink-0 text-sm font-semibold">
                {hideAmounts ? (
                  <span className="font-mono text-muted-foreground">••••••</span>
                ) : account.balance ? (
                  <MoneyText value={account.balance} />
                ) : (
                  '—'
                )}
              </span>
            </Link>
          ))}
          {accounts.length > 5 && (
            <p className="pt-2.5 text-xs text-muted-foreground">y {accounts.length - 5} más</p>
          )}
        </div>
      )}
    </Panel>
  )
}
