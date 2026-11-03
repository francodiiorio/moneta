import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateField } from '@/components/DateField'
import { MoneyText } from '@/components/MoneyText'
import { formatAmountInput, money, negate, sub, tryParsePositiveAmount } from '@/domain/money'
import { formatMonthLabel, todayStamp } from '@/lib/dates'
import { useDialogSession } from '@/components/useDialogSession'
import { useNextStatementDates } from '../hooks/useNextStatementDates'
import { paymentFormSchema, type PaymentFormValues } from '../schema'
import { payStatementFromForm, reconcileCurrencies, type NextStatementDates, type StatementView } from '../service'

interface PayStatementDialogProps {
  cardId: string
  cardName: string
  /** The statement to pay; the dialog is open while set. */
  statement: StatementView | undefined
  onOpenChange: (open: boolean) => void
}

export function PayStatementDialog({ cardId, cardName, statement, onOpenChange }: PayStatementDialogProps) {
  // The card goes in the session too: Tarjetas clears `cardId` as the
  // dialog closes, and the content must stay through the animation.
  const session = useDialogSession(statement && { cardId, cardName, statement })
  const next = useNextStatementDates(session?.value.cardId ?? '', session?.value.statement.period)

  return (
    <Dialog open={!!statement} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        {/* Mounted once the next statement's dates load: the form's
            defaults are picked when it mounts. */}
        {session && next !== undefined && (
          <DialogBody
            key={session.key}
            cardId={session.value.cardId}
            cardName={session.value.cardName}
            statement={session.value.statement}
            next={next}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

interface DialogBodyProps {
  cardId: string
  cardName: string
  statement: StatementView
  /** The statement after this one, while still open — `null` once closed. */
  next: NextStatementDates | null
  onClose: () => void
}

function DialogBody({ cardId, cardName, statement, next: liveNext, onClose }: DialogBodyProps) {
  // The dates the form starts from — what a change is measured against,
  // even if another tab corrects them while this dialog is open.
  const [next] = useState(liveNext)
  // One line per currency still to pay: all of Moneta's, or — once some
  // currency is paid — only the rest. A statement Moneta has empty still
  // offers pesos and dollars: the bank may have charged something not loaded.
  const owed =
    statement.payment.status !== 'unpaid'
      ? statement.totals.filter((t) => statement.unpaidCurrencies.includes(t.currency))
      : statement.totals.length > 0
        ? statement.totals
        : reconcileCurrencies([]).map((currency) => money(0, currency))

  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentFormSchema),
    defaultValues: {
      date: todayStamp(),
      ...(next && { nextCloseDate: next.closeDate, nextDueDate: next.dueDate }),
      lines: owed.map((total) => ({
        currency: total.currency,
        // Moneta's total as a starting point: what the bank charged goes here.
        paidAmount: total.amount > 0 ? formatAmountInput(total) : '',
      })),
    },
  })
  const lines = useWatch({ control: form.control, name: 'lines' })

  async function onSubmit(values: PaymentFormValues) {
    try {
      const result = await payStatementFromForm(cardId, statement.period, values, next ? { nextDates: next } : {})
      const moved =
        result.moved === 0 ? '' : result.moved === 1 ? ' · 1 gasto cambió de resumen' : ` · ${result.moved} gastos cambiaron de resumen`
      toast.success(result.nextDatesSaved ? `Resumen pagado · fechas del próximo resumen guardadas${moved}` : 'Resumen pagado')
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo registrar el pago')
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Pagar {cardName} · {formatMonthLabel(statement.period).toLowerCase()}
        </DialogTitle>
        <DialogDescription>
          Cargá lo que pagaste según el banco. Las compras ya se contaron como gastos: el pago sólo marca el resumen
          como pagado.
        </DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          {owed.map((total, index) => {
            const paid = tryParsePositiveAmount(lines[index]?.paidAmount ?? '', total.currency)
            // Paid minus Moneta's total: what the bank charged beyond (or
            // short of) what's loaded.
            const difference = paid ? sub(paid, total) : undefined
            return (
              <div key={total.currency} className="flex flex-col gap-3 rounded-lg border border-border p-3">
                <FormField
                  control={form.control}
                  name={`lines.${index}.paidAmount`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Pagaste ({total.currency})</FormLabel>
                      <FormControl>
                        <Input inputMode="decimal" placeholder="0,00" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  Moneta tiene <MoneyText value={total} />
                  {difference && difference.amount > 0 && (
                    <span className="font-medium text-negative">
                      {' '}
                      · pagaste <MoneyText value={difference} /> más: lo podés conciliar como cargos del resumen
                    </span>
                  )}
                  {difference && difference.amount < 0 && (
                    <span className="font-medium text-negative">
                      {' '}
                      · pagaste <MoneyText value={negate(difference)} /> menos: queda la diferencia a la vista
                    </span>
                  )}
                  {(lines[index]?.paidAmount ?? '').trim() === '' && ' · sin pago en esta moneda'}
                </p>
              </div>
            )
          })}

          <FormField
            control={form.control}
            name="date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Fecha del pago</FormLabel>
                <FormControl>
                  <DateField value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {next && (
            <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium">Próximo resumen</p>
                <p className="text-xs text-muted-foreground">
                  {next.isCorrected
                    ? 'Ya cargaste las fechas del banco para el próximo resumen.'
                    : 'Fechas estimadas con los días de la tarjeta. Si tu resumen dice otras ("próximo cierre", "próximo vencimiento"), cargalas acá.'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="nextCloseDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Próximo cierre</FormLabel>
                      <FormControl>
                        <DateField value={field.value ?? ''} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="nextDueDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Próximo vencimiento</FormLabel>
                      <FormControl>
                        <DateField value={field.value ?? ''} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Pagar
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </>
  )
}
