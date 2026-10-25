import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DateField } from '@/components/DateField'
import { MoneyText } from '@/components/MoneyText'
import { formatImpliedRate, transferImpliedRate } from '@/domain/accounts'
import type { Account } from '@/domain/entities'
import { formatAmountInput, money, negate, sub, tryParsePositiveAmount } from '@/domain/money'
import { formatMonthLabel, todayStamp } from '@/lib/dates'
import { useAccounts } from '../hooks/useAccounts'
import { useDialogSession } from '../hooks/useDialogSession'
import { paymentFormSchema, type PaymentFormValues } from '../schema'
import { payStatementFromForm, reconcileCurrencies, type StatementView } from '../service'

interface PayStatementDialogProps {
  cardId: string
  cardName: string
  /** The statement to pay; the dialog is open while set. */
  statement: StatementView | undefined
  onOpenChange: (open: boolean) => void
}

export function PayStatementDialog({ cardId, cardName, statement, onOpenChange }: PayStatementDialogProps) {
  const accounts = useAccounts()
  const session = useDialogSession(statement)

  return (
    <Dialog open={!!statement} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mounted once accounts load: each line's default account is
            picked when the form mounts. */}
        {session && accounts && (
          <DialogBody
            key={session.key}
            cardId={cardId}
            cardName={cardName}
            statement={session.value}
            accounts={accounts}
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
  accounts: Account[]
  onClose: () => void
}

function DialogBody({ cardId, cardName, statement, accounts, onClose }: DialogBodyProps) {
  const active = accounts.filter((a) => !a.isArchived)
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
      lines: owed.map((total) => ({
        currency: total.currency,
        // An account in the statement's own currency, if there is one.
        accountId: active.find((a) => a.currency === total.currency)?.id ?? '',
        // Moneta's total as a starting point: what the bank charged goes here.
        paidAmount: total.amount > 0 ? formatAmountInput(total) : '',
        debitedAmount: '',
      })),
    },
  })
  const lines = useWatch({ control: form.control, name: 'lines' })

  function accountOf(index: number): Account | undefined {
    const accountId = lines[index]?.accountId
    return accounts.find((a) => a.id === accountId)
  }

  async function onSubmit(values: PaymentFormValues) {
    let missing = false
    values.lines.forEach((line, index) => {
      if (line.paidAmount.trim() === '') return
      const account = accountOf(index)
      if (account && account.currency !== line.currency && !tryParsePositiveAmount(line.debitedAmount, account.currency)) {
        form.setError(`lines.${index}.debitedAmount`, {
          message: line.debitedAmount.trim() ? 'Ingresá un monto válido' : `Ingresá cuánto se debitó en ${account.currency}`,
        })
        missing = true
      }
    })
    if (missing) return
    try {
      await payStatementFromForm(cardId, statement.period, values, {
        accountCurrency: new Map(accounts.map((a) => [a.id, a.currency])),
      })
      toast.success('Resumen pagado')
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
          Cargá lo que pagaste según el banco. Las compras ya se contaron como gastos: el pago sólo baja el saldo de la
          cuenta desde la que pagaste.
        </DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          {owed.map((total, index) => {
            const account = accountOf(index)
            const crossCurrency = !!account && account.currency !== total.currency
            const paid = tryParsePositiveAmount(lines[index]?.paidAmount ?? '', total.currency)
            // Paid minus Moneta's total: what the bank charged beyond (or
            // short of) what's loaded.
            const difference = paid ? sub(paid, total) : undefined
            const debited = crossCurrency
              ? tryParsePositiveAmount(lines[index]?.debitedAmount ?? '', account.currency)
              : undefined
            const rate =
              debited &&
              paid &&
              transferImpliedRate({
                fromAmount: debited.amount,
                fromCurrency: debited.currency,
                toAmount: paid.amount,
                toCurrency: paid.currency,
              })
            return (
              <div key={total.currency} className="flex flex-col gap-3 rounded-lg border border-border p-3">
                <div className="grid grid-cols-2 gap-3">
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
                  <FormField
                    control={form.control}
                    name={`lines.${index}.accountId`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Desde</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={(next) => {
                            // Radix fires '' when the select remounts — never
                            // let that clear a chosen account.
                            if (next === '') return
                            // An amount typed for an account in another
                            // currency would be read in the new one.
                            if (accounts.find((a) => a.id === next)?.currency !== account?.currency) {
                              form.setValue(`lines.${index}.debitedAmount`, '')
                            }
                            field.onChange(next)
                          }}
                        >
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Elegí una cuenta" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {active.map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.name} · {a.currency}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {crossCurrency && (
                    <FormField
                      control={form.control}
                      name={`lines.${index}.debitedAmount`}
                      render={({ field }) => (
                        <FormItem className="col-span-2">
                          <FormLabel>Se debitó ({account.currency})</FormLabel>
                          <FormControl>
                            <Input inputMode="decimal" placeholder="0,00" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
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
                {rate && <p className="text-xs text-muted-foreground">Cotización del pago: {formatImpliedRate(rate)}</p>}
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

          {active.length === 0 && (
            <p className="text-sm text-muted-foreground">Para pagar necesitás al menos una cuenta en Cuentas.</p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting || active.length === 0}>
              Pagar
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </>
  )
}
