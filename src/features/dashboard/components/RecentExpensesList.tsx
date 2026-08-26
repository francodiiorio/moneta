import { Link } from 'react-router'
import { MoneyText } from '@/components/MoneyText'
import { CategoryIcon } from '@/components/CategoryIcon'
import { formatShortDate } from '@/lib/dates'
import type { TransactionListItem } from '@/features/transactions/service'

interface RecentExpensesListProps {
  /** Non-empty — the caller gates rendering on having data (see
   *  `hasRecentExpenses` in `DashboardPage`), so there's no empty state here. */
  items: TransactionListItem[]
}

export function RecentExpensesList({ items }: RecentExpensesListProps) {
  return (
    <div className="flex flex-col">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <CategoryIcon icon={item.categoryIcon} color={item.categoryColor} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{item.description}</p>
              <p className="truncate text-xs text-muted-foreground">
                {item.categoryLabel ? `${item.categoryLabel} · ` : ''}
                {item.accountLabel}
              </p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-semibold">
              <MoneyText value={item.amount} signColor />
            </p>
            <p className="text-xs text-muted-foreground">{formatShortDate(item.date)}</p>
          </div>
        </div>
      ))}
      <Link to="/movimientos" className="pt-3 text-center text-xs font-medium text-primary hover:underline">
        Ver todos los movimientos
      </Link>
    </div>
  )
}
