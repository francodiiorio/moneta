import { useState } from 'react'
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
import { tryParsePositiveAmount } from '@/domain/money'
import { formatMonthLabel, todayStamp } from '@/lib/dates'
import { useAccounts } from '../hooks/useAccounts'
import { paymentFormSchema, type PaymentFormValues } from '../schema'
import { payStatementFromForm, type StatementView } from '../service'

interface PayStatementDialogProps {
  cardId: string
  cardName: string
  /** The statement to pay; the dialog is open while set. */
  statement: StatementView | undefined
  onOpenChange: (open: boolean) => void
}

export function PayStatementDialog({ cardId, cardName, statement, onOpenChange }: PayStatementDialogProps) {
  const accounts = useAccounts()
  // The body outlives `statement` so the dialog keeps its content during
  // the close animation; a new `key` per open starts the form fresh.
  const [session, setSession] = useState(() => (statement ? { key: 1, statement } : undefined))
  const [wasOpen, setWasOpen] = useState(!!statement)
  if (!!statement !== wasOpen) {
    setWasOpen(!!statement)
    if (statement) setSession({ key: (session?.key ?? 0) + 1, statement })
  }

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
            statement={session.statement}
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
  // `statement` is pinned to what the user saw when opening: these are the
  // totals they agree to pay, and the repository rejects the payment if
  // the real ones changed meanwhile.
  const active = accounts.filter((a) => !a.isArchived)

  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentFormSchema),
    defaultValues: {
      date: todayStamp(),
      lines: statement.totals.map((total) => ({
        currency: total.currency,
        // An account in the statement's own currency, if there is one.
        accountId: active.find((a) => a.currency === total.currency)?.id ?? '',
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
        totals: statement.totals,
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
          Registrá el pago total del resumen. Las compras ya se contaron como gastos: el pago sólo baja el saldo de la
          cuenta desde la que pagaste.
        </DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          {statement.totals.map((total, index) => {
            const account = accountOf(index)
            const crossCurrency = !!account && account.currency !== total.currency
            const debited = crossCurrency
              ? tryParsePositiveAmount(lines[index]?.debitedAmount ?? '', account.currency)
              : undefined
            const rate =
              debited &&
              transferImpliedRate({
                fromAmount: debited.amount,
                fromCurrency: debited.currency,
                toAmount: total.amount,
                toCurrency: total.currency,
              })
            return (
              <div key={total.currency} className="flex flex-col gap-3 rounded-lg border border-border p-3">
                <p className="text-sm">
                  Pagás <MoneyText value={total} className="font-semibold" />
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name={`lines.${index}.accountId`}
                    render={({ field }) => (
                      <FormItem className={crossCurrency ? undefined : 'col-span-2'}>
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
                        <FormItem>
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
                {rate && (
                  <p className="text-xs text-muted-foreground">
                    Cotización del pago: {formatImpliedRate(rate)}
                  </p>
                )}
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
