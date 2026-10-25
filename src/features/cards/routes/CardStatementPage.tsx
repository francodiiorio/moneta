import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ChevronLeft, ChevronRight, Receipt } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { MoneyText } from '@/components/MoneyText'
import { Badge } from '@/components/ui/badge'
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
import { negate } from '@/domain/money'
import { formatFullDate, formatMonthLabel, formatShortDate, isValidMonthStamp, shiftMonth, type MonthStamp } from '@/lib/dates'
import { StatementDatesDialog } from '../components/StatementDatesDialog'
import { PayStatementDialog } from '../components/PayStatementDialog'
import { ReconcileStatementDialog } from '../components/ReconcileStatementDialog'
import { DueBadge } from '../components/DueBadge'
import { MoneyTotals } from '@/components/MoneyTotals'
import { useOpenPeriod } from '../hooks/useOpenPeriod'
import { useStatementDetail } from '../hooks/useStatementDetail'
import { undoStatementPayment, type StatementStatus } from '../service'

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
  const [paying, setPaying] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  const [confirmingUndo, setConfirmingUndo] = useState(false)

  async function handleUndo() {
    if (!period) return
    try {
      const removed = await undoStatementPayment(cardId, period)
      toast.success(removed > 0 ? 'Pago deshecho · el débito volvió a la cuenta' : 'Ese pago ya se había deshecho')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo deshacer el pago')
    } finally {
      setConfirmingUndo(false)
    }
  }

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
                  {/* Unpaid means nothing until the statement closes. */}
                  {(detail.status === 'closed' || detail.payments.length > 0) && <DueBadge due={detail.due} />}
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

          {/* Banks move the close (a holiday, a weekend): until the real
              dates are in, purchases near the close may land in the wrong
              statement. */}
          {detail.status === 'open' && !detail.isCorrected && (
            <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">Fechas estimadas</span> con los días de la tarjeta. El banco
                suele correr el cierre de un mes a otro: ¿ya sabés cuándo cierra este resumen?
              </p>
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => setEditingDates(true)}>
                Cargar las del banco
              </Button>
            </div>
          )}

          {detail.payments.length > 0 ? (
            <Card>
              <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-1 text-sm">
                  {detail.payments.map((payment) => (
                    <p key={payment.id}>
                      Pagaste <MoneyText value={payment.amount} className="font-medium" />
                      {payment.debited.currency !== payment.amount.currency && (
                        <>
                          {' '}
                          (<MoneyText value={payment.debited} />)
                        </>
                      )}{' '}
                      desde {payment.accountName} el {formatShortDate(payment.date)}
                    </p>
                  ))}
                  {/* differences = Moneta's total − what was paid, per currency. */}
                  {detail.payment.differences.map((difference) =>
                    detail.unpaidCurrencies.includes(difference.currency) ? (
                      <p key={difference.currency} className="font-medium text-negative">
                        Falta pagar <MoneyText value={difference} />.
                      </p>
                    ) : difference.amount < 0 ? (
                      <p key={difference.currency} className="text-negative">
                        Pagaste <MoneyText value={negate(difference)} /> más de lo que tiene Moneta: impuestos,
                        intereses o gastos sin cargar. Conciliá la diferencia para registrarla.
                      </p>
                    ) : (
                      <p key={difference.currency} className="text-negative">
                        Pagaste <MoneyText value={difference} /> menos de lo que tiene Moneta. Si fue un pago parcial,
                        el banco pasa el saldo (con intereses) al resumen siguiente; si no, puede ser un gasto que el
                        banco factura en otro resumen (movelo) o un reintegro. Para corregir las fechas del resumen,
                        deshacé el pago primero.
                      </p>
                    ),
                  )}
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                  {detail.unpaidCurrencies.length > 0 && (
                    <Button size="sm" onClick={() => setPaying(true)}>
                      Pagar lo que falta
                    </Button>
                  )}
                  {detail.payment.differences.some((d) => d.amount < 0) && (
                    <Button size="sm" onClick={() => setReconciling(true)}>
                      Conciliar la diferencia
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => setConfirmingUndo(true)}>
                    Deshacer pago
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            detail.status === 'closed' && (
              <div className="flex flex-col gap-2 sm:flex-row">
                {/* Before paying: the bank's total may carry taxes or fees
                    Moneta doesn't have yet. */}
                <Button variant="outline" className="w-full sm:w-fit" onClick={() => setReconciling(true)}>
                  Conciliar con el banco
                </Button>
                {/* Even with nothing loaded: the bank may have billed it. */}
                <Button className="w-full sm:w-fit" onClick={() => setPaying(true)}>
                  Pagar resumen
                </Button>
              </div>
            )
          )}

          {detail.expenses.length === 0 && detail.openingBalance.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No hay gastos en este resumen.</p>
          ) : (
            <div className="rounded-xl border border-border px-3">
              {detail.openingBalance.length > 0 && (
                <div className="flex items-center gap-3 border-b border-border py-3 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">Saldo inicial</p>
                    <p className="truncate text-xs text-muted-foreground">
                      Lo que ya debías antes de usar Moneta · no cuenta como gasto
                    </p>
                  </div>
                  <MoneyTotals totals={detail.openingBalance} className="shrink-0 text-sm font-semibold" />
                </div>
              )}
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

      <PayStatementDialog
        cardId={cardId}
        cardName={detail?.card.name ?? ''}
        statement={paying && detail ? detail : undefined}
        onOpenChange={(open) => (open ? undefined : setPaying(false))}
      />

      <ReconcileStatementDialog
        cardId={cardId}
        cardName={detail?.card.name ?? ''}
        statement={reconciling && detail ? detail : undefined}
        {...(detail && detail.payments.length > 0 && { bankTotals: detail.payments.map((p) => p.amount) })}
        onOpenChange={(open) => (open ? undefined : setReconciling(false))}
      />

      <AlertDialog open={confirmingUndo} onOpenChange={setConfirmingUndo}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Deshacer el pago de este resumen?</AlertDialogTitle>
            <AlertDialogDescription>
              El débito vuelve al saldo de la cuenta y el resumen queda sin pagar. Los gastos no cambian.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleUndo()}>Deshacer pago</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <StatementDatesDialog
        cardId={cardId}
        statement={editingDates && detail ? detail : undefined}
        onOpenChange={(open) => (open ? undefined : setEditingDates(false))}
      />
    </div>
  )
}
