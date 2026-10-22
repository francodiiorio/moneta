import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { DateField } from '@/components/DateField'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { transferImpliedRate } from '@/domain/accounts'
import type { Account } from '@/domain/entities'
import { formatMoney, money, parseAmount, type Money } from '@/domain/money'
import { todayStamp } from '@/lib/dates'
import { useAccounts } from '../hooks/useAccounts'
import { transferFormSchema, type TransferFormValues } from '../schema'
import { saveTransferFromForm, type EditableTransactionItem } from '../service'

interface TransferFormProps {
  item: (EditableTransactionItem & { kind: 'transfer' }) | undefined
  onSaved: () => void
  onCancel: () => void
}

function emptyValues(): TransferFormValues {
  return { date: todayStamp(), description: '', fromAccountId: '', toAccountId: '', fromAmount: '', toAmount: '' }
}

function amountString(value: Money): string {
  return formatMoney(money(Math.abs(value.amount), value.currency)).replace(/[^\d,.-]/g, '')
}

/** Parses for the live rate preview only — the real parse happens again
 *  in the service, against the accounts as stored. */
function tryParse(value: string, currency: string): Money | undefined {
  if (!/\d/.test(value)) return undefined
  try {
    const parsed = parseAmount(value, currency)
    return parsed.amount > 0 ? parsed : undefined
  } catch {
    return undefined
  }
}

const rateFormatter = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 4 })

export function TransferForm({ item, onSaved, onCancel }: TransferFormProps) {
  const accounts = useAccounts()

  const form = useForm<TransferFormValues>({
    resolver: zodResolver(transferFormSchema),
    defaultValues: emptyValues(),
  })

  useEffect(() => {
    if (!item?.transfer) {
      form.reset(emptyValues())
      return
    }
    form.reset({
      date: item.date,
      description: item.description,
      fromAccountId: item.transfer.fromAccountId,
      toAccountId: item.transfer.toAccountId,
      fromAmount: amountString(item.transfer.fromAmount),
      toAmount: amountString(item.transfer.toAmount),
    })
    // Keyed on item?.id, same reasoning as MovementForm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id])

  const [fromAccountId, toAccountId, fromAmountText, toAmountText] = useWatch({
    control: form.control,
    name: ['fromAccountId', 'toAccountId', 'fromAmount', 'toAmount'],
  })
  const from = accounts?.find((a) => a.id === fromAccountId)
  const to = accounts?.find((a) => a.id === toAccountId)
  const crossCurrency = !!from && !!to && from.currency !== to.currency

  const fromParsed = from ? tryParse(fromAmountText, from.currency) : undefined
  const toParsed = to && crossCurrency ? tryParse(toAmountText, to.currency) : undefined
  const impliedRate =
    fromParsed && toParsed
      ? transferImpliedRate({
          fromAmount: fromParsed.amount,
          fromCurrency: fromParsed.currency,
          toAmount: toParsed.amount,
          toCurrency: toParsed.currency,
        })
      : undefined

  // Archived accounts can't take new transfers, but the ones an edited
  // transfer already points at stay selectable so the form can show them.
  const keep = new Set([item?.transfer?.fromAccountId, item?.transfer?.toAccountId])
  const accountOptions = accounts?.filter((a) => !a.isArchived || keep.has(a.id)) ?? []

  async function onSubmit(values: TransferFormValues) {
    if (crossCurrency && !values.toAmount.trim()) {
      form.setError('toAmount', { message: `Ingresá cuánto entró en ${to.currency}` })
      return
    }
    try {
      await saveTransferFromForm(values, item?.id)
      toast.success(item ? 'Transferencia actualizada' : 'Transferencia creada')
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la transferencia')
    }
  }

  function accountSelect(name: 'fromAccountId' | 'toAccountId', label: string) {
    return (
      <FormField
        control={form.control}
        name={name}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{label}</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Elegí una cuenta" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {accountOptions.map((account: Account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name} · {account.currency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          {accountSelect('fromAccountId', 'Desde')}
          {accountSelect('toAccountId', 'Hacia')}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="fromAmount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{crossCurrency ? `Sale (${from.currency})` : 'Monto'}</FormLabel>
                <FormControl>
                  <Input inputMode="decimal" placeholder="0,00" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {crossCurrency ? (
            <FormField
              control={form.control}
              name="toAmount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Entra ({to.currency})</FormLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder="0,00" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : (
            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha</FormLabel>
                  <FormControl>
                    <DateField value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        {impliedRate && (
          <p className="-mt-2 text-sm text-muted-foreground">
            Cotización de esta operación: 1 {impliedRate.base} = {rateFormatter.format(impliedRate.rate)}{' '}
            {impliedRate.quote}
          </p>
        )}

        <div className="grid grid-cols-2 gap-4">
          {crossCurrency && (
            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha</FormLabel>
                  <FormControl>
                    <DateField value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem className={crossCurrency ? undefined : 'col-span-2'}>
                <FormLabel>Descripción (opcional)</FormLabel>
                <FormControl>
                  <Input placeholder={crossCurrency ? 'Ej: Compra de dólares' : 'Transferencia'} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {accounts !== undefined && accountOptions.length < 2 && (
          <p className="text-sm text-muted-foreground">Para transferir necesitás al menos dos cuentas en Cuentas.</p>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Guardar
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}
