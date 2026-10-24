import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ChevronLeft, ChevronRight, Receipt } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { MoneyText } from '@/components/MoneyText'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatFullDate, formatMonthLabel, formatShortDate, isValidMonthStamp, shiftMonth, type MonthStamp } from '@/lib/dates'
import { StatementDatesDialog } from '../components/StatementDatesDialog'
import { MoneyTotals } from '@/components/MoneyTotals'
import { useOpenPeriod } from '../hooks/useOpenPeriod'
import { useStatementDetail } from '../hooks/useStatementDetail'
import type { StatementStatus } from '../service'

const STATUS_LABEL: Record<StatementStatus, string> = {
  open: 'En curso',
  closed: 'Cerrado',
  upcoming: 'Próximo',
}

export function CardStatementPage() {
  const { cardId = '' } = useParams()
  // Keyed by card: React Router reuses the component across :cardId, and
  // the open dates dialog must not carry over to another card.
  return <StatementBrowser key={cardId} cardId={cardId} />
}

function StatementBrowser({ cardId }: { cardId: string }) {
  const openPeriod = useOpenPeriod(cardId)
  // The statement shown lives in the URL (?resumen=2026-10) as an absolute
  // month: it survives a reload, and correcting dates (which can change
  // which statement is "open") never makes the page jump to another one.
  const [searchParams, setSearchParams] = useSearchParams()
  const param = searchParams.get('resumen')
  const period: MonthStamp | undefined = param && isValidMonthStamp(param) ? param : (openPeriod ?? undefined)
  const detail = useStatementDetail(cardId, period)
  const [editingDates, setEditingDates] = useState(false)

  function goTo(next: MonthStamp) {
    setSearchParams(next === openPeriod ? {} : { resumen: next }, { replace: true })
  }

  if (openPeriod === null || detail === null) {
    return (
      <EmptyState
        icon={Receipt}
        title="No encontramos esa tarjeta"
        description="Puede que la hayas eliminado."
        action={
          <Button asChild>
            <Link to="/tarjetas">Volver a Tarjetas</Link>
          </Button>
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Link to="/tarjetas" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        Tarjetas
      </Link>

      <PageHeader title={detail?.card.name ?? 'Tarjeta'} description="Cada resumen se nombra por el mes en que cierra." />

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="Resumen anterior" onClick={() => period && goTo(shiftMonth(period, -1))}>
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-40 text-center text-sm font-medium">{period ? formatMonthLabel(period) : '—'}</span>
        <Button variant="ghost" size="icon" aria-label="Resumen siguiente" onClick={() => period && goTo(shiftMonth(period, 1))}>
          <ChevronRight className="size-4" />
        </Button>
        {openPeriod && period !== openPeriod && (
          <Button variant="link" size="sm" onClick={() => goTo(openPeriod)}>
            Ir al resumen en curso
          </Button>
        )}
      </div>

      {detail === undefined ? (
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground">Total del resumen</p>
                  <Badge variant={detail.status === 'open' ? 'default' : 'secondary'}>{STATUS_LABEL[detail.status]}</Badge>
                </div>
                <MoneyTotals totals={detail.totals} className="mt-1 text-2xl font-semibold" />
                {detail.projectedCount > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Incluye {detail.projectedCount} cuota{detail.projectedCount === 1 ? '' : 's'} todavía no vencida
                    {detail.projectedCount === 1 ? '' : 's'}.
                  </p>
                )}
              </div>
              <div className="text-sm sm:text-right">
                <p>
                  Cierra el <span className="font-medium">{formatFullDate(detail.closeDate)}</span>
                </p>
                <p>
                  Vence el <span className="font-medium">{formatFullDate(detail.dueDate)}</span>
                </p>
                <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setEditingDates(true)}>
                  {detail.isCorrected ? 'Fechas corregidas · editar' : 'Corregir fechas'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {detail.expenses.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No hay gastos en este resumen.</p>
          ) : (
            <div className="rounded-xl border border-border px-3">
              {detail.expenses.map((expense) => (
                <div key={expense.id} className="flex items-center gap-3 border-b border-border py-3 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{expense.description}</p>
                      {expense.status === 'projected' && <Badge variant="secondary">Proyectado</Badge>}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{expense.categoryLabel}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold">
                      <MoneyText value={expense.amount} />
                    </p>
                    <p className="text-xs text-muted-foreground">{formatShortDate(expense.date)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <StatementDatesDialog
        cardId={cardId}
        statement={editingDates && detail ? detail : undefined}
        onOpenChange={(open) => (open ? undefined : setEditingDates(false))}
      />
    </div>
  )
}
