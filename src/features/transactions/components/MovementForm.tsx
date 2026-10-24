import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { DateField } from '@/components/DateField'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CURRENCIES, formatAmountInput, magnitude } from '@/domain/money'
import { formatMonthLabel, formatShortDate, todayStamp } from '@/lib/dates'
import { CategoryField } from './CategoryField'
import { useAccounts } from '../hooks/useAccounts'
import { useCards } from '../hooks/useCards'
import { useStatementChoices } from '../hooks/useStatementChoices'
import {
  EXPENSE_CURRENCIES,
  movementFormSchema,
  type MovementFormValues,
  type MovementKind,
} from '../schema'
import { saveMovement, type EditableTransactionItem } from '../service'

const NO_ACCOUNT = '__none__'
const AUTO_PERIOD = '__auto__'

/** One Select for the gasto's payment method: nothing, a debit account or
 *  a credit card — encoded so the two kinds of id can't collide. */
function paymentValue(accountId: string, cardId: string): string {
  if (cardId) return `card:${cardId}`
  if (accountId) return `account:${accountId}`
  return NO_ACCOUNT
}

interface MovementFormProps {
  /** Gasto or ingreso — chosen by the dialog's tabs. Switching between the
   *  two keeps what was already typed (except the category: they're
   *  disjoint). */
  kind: MovementKind
  /** The base currency, already loaded — see TransactionFormDialog. */
  defaultCurrency: string
  item: (EditableTransactionItem & { kind: MovementKind }) | undefined
  onSaved: () => void
  onCancel: () => void
}

function emptyValues(kind: MovementKind, defaultCurrency: string): MovementFormValues {
  return {
    kind,
    date: todayStamp(),
    description: '',
    categoryId: '',
    currency: defaultCurrency,
    amount: '',
    accountId: '',
    cardId: '',
    statementPeriod: '',
  }
}

export function MovementForm({
  kind,
  defaultCurrency,
  item,
  onSaved,
  onCancel,
}: MovementFormProps) {
  const accounts = useAccounts()

  const form = useForm<MovementFormValues>({
    resolver: zodResolver(movementFormSchema),
    defaultValues: emptyValues(kind, defaultCurrency),
  })

  useEffect(() => {
    if (item) {
      form.reset({
        kind: item.kind,
        date: item.date,
        description: item.description,
        categoryId: item.categoryId,
        currency: item.amount.currency,
        amount: formatAmountInput(magnitude(item.amount)),
        accountId: item.cardId ? '' : (item.accountId ?? ''),
        cardId: item.cardId ?? '',
        // "Según la fecha" unless the user had pinned it elsewhere — so
        // correcting the date re-places it (the repository does the same
        // for an echoed-back automatic period).
        statementPeriod: item.statementPinned ? (item.statementPeriod ?? '') : '',
      })
    } else {
      form.reset(emptyValues(kind, defaultCurrency))
    }
    // Keyed on item?.id (a stable primitive), not the live-query-derived `item`
    // object, so a background refetch of the same transaction (e.g. a cross-tab
    // write) doesn't reset an in-progress edit; form is a stable ref from useForm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id])

  useEffect(() => {
    if (form.getValues('kind') === kind) return
    form.setValue('kind', kind)
    // Gasto and ingreso categories are disjoint — a category picked for one
    // is never valid for the other.
    form.setValue('categoryId', '')
    // An ingreso can't go on a credit card: drop it, or coming back to
    // gasto would show the card while the account picked meanwhile is
    // still set — two payment methods at once.
    if (kind === 'income') {
      form.setValue('cardId', '')
      form.setValue('statementPeriod', '')
    }
    form.clearErrors()
  }, [kind, form])

  const accountId = useWatch({ control: form.control, name: 'accountId' })
  const selectedAccount = accounts?.find((a) => a.id === accountId)
  const cards = useCards()
  const [cardId, date] = useWatch({ control: form.control, name: ['cardId', 'date'] })
  const statementChoices = useStatementChoices(cardId, date) ?? []
  const cardOptions = cards?.filter((c) => !c.isArchived || c.id === item?.cardId) ?? []
  // Archived accounts can't take new movements, but the one an edited
  // movement already points at stays selectable so the form can show it.
  const accountOptions = accounts?.filter((a) => !a.isArchived || a.id === item?.accountId) ?? []

  function handlePaymentChange(next: string) {
    // Radix Select inside a <form> can fire onValueChange('') when it
    // (re)mounts before its items — e.g. coming back from the Ingreso tab.
    // Every real option has a value, so '' is never a user's choice.
    if (next === '') return
    const [type, id = ''] = next.split(/:(.*)/s)
    form.setValue('accountId', type === 'account' ? id : '')
    form.setValue('cardId', type === 'card' ? id : '')
    form.setValue('statementPeriod', '')
    const account = type === 'account' ? accounts?.find((a) => a.id === id) : undefined
    if (account) form.setValue('currency', account.currency)
  }

  function handleAccountChange(next: string) {
    if (next === '') return // same spurious Radix value as handlePaymentChange
    const nextId = next === NO_ACCOUNT ? '' : next
    form.setValue('accountId', nextId, { shouldValidate: form.formState.isSubmitted })
    form.setValue('cardId', '')
    form.setValue('statementPeriod', '')
    // An account has one fixed currency: every movement against it is in
    // that currency (enforced again in the repository).
    const account = accounts?.find((a) => a.id === nextId)
    if (account) form.setValue('currency', account.currency)
  }

  async function onSubmit(values: MovementFormValues) {
    try {
      await saveMovement({ ...values, kind }, item?.id)
      toast.success(
        kind === 'income'
          ? item
            ? 'Ingreso actualizado'
            : 'Ingreso creado'
          : item
            ? 'Gasto actualizado'
            : 'Gasto creado',
      )
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el movimiento')
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Descripción</FormLabel>
              <FormControl>
                <Input
                  placeholder={kind === 'income' ? 'Ej: Sueldo' : 'Ej: Supermercado'}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Fecha</FormLabel>
                <FormControl>
                  <DateField
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    ref={field.ref}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Monto</FormLabel>
                <FormControl>
                  <Input inputMode="decimal" placeholder="0,00" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          {kind === 'expense' ? (
            <FormField
              control={form.control}
              name="cardId"
              render={() => (
                <FormItem>
                  <FormLabel>Medio de pago</FormLabel>
                  <Select
                    value={paymentValue(accountId, cardId)}
                    onValueChange={handlePaymentChange}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_ACCOUNT}>Sin especificar</SelectItem>
                      {accountOptions.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>Débito</SelectLabel>
                          {accountOptions.map((account) => (
                            <SelectItem key={account.id} value={`account:${account.id}`}>
                              {account.name} · {account.currency}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                      {cardOptions.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>Tarjeta de crédito</SelectLabel>
                          {cardOptions.map((card) => (
                            <SelectItem key={card.id} value={`card:${card.id}`}>
                              {card.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : (
            <FormField
              control={form.control}
              name="accountId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cuenta</FormLabel>
                  <Select value={field.value} onValueChange={handleAccountChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Elegí una cuenta" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {accountOptions.map((account) => (
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
          )}

          <FormField
            control={form.control}
            name="currency"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Moneda</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={!!selectedAccount}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {EXPENSE_CURRENCIES.map((code) => (
                      <SelectItem key={code} value={code}>
                        {code} · {CURRENCIES[code]?.symbol}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {kind === 'expense' && cardId && (
          <FormField
            control={form.control}
            name="statementPeriod"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Resumen</FormLabel>
                <Select
                  value={field.value || AUTO_PERIOD}
                  onValueChange={(next) => {
                    if (next === '') return // spurious Radix value on remount
                    field.onChange(next === AUTO_PERIOD ? '' : next)
                  }}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {statementChoices[0] && (
                      <SelectItem value={AUTO_PERIOD}>
                        Según la fecha: {formatMonthLabel(statementChoices[0].period).toLowerCase()}{' '}
                        (cierra el {formatShortDate(statementChoices[0].closeDate)})
                      </SelectItem>
                    )}
                    {/* Pinned options: stay in that statement even if the date
                        changes later (a late presentation). */}
                    {statementChoices.map((choice) => (
                      <SelectItem key={choice.period} value={choice.period}>
                        Fijar en {formatMonthLabel(choice.period).toLowerCase()} (cierra el{' '}
                        {formatShortDate(choice.closeDate)})
                      </SelectItem>
                    ))}
                    {/* An edited gasto pinned to a statement outside the
                        three offered (e.g. an older one) stays selectable. */}
                    {field.value && !statementChoices.some((c) => c.period === field.value) && (
                      <SelectItem value={field.value}>
                        Fijar en {formatMonthLabel(field.value).toLowerCase()}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="categoryId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Categoría</FormLabel>
              <CategoryField kind={kind} value={field.value} onChange={field.onChange} />
              <FormMessage />
            </FormItem>
          )}
        />

        {kind === 'income' && accountOptions.length === 0 && accounts !== undefined && (
          <p className="text-sm text-muted-foreground">
            Para cargar un ingreso primero creá una cuenta en Cuentas.
          </p>
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
