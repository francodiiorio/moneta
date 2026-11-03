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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CURRENCIES, formatAmountInput, magnitude } from '@/domain/money'
import { formatMonthLabel, formatShortDate, todayStamp } from '@/lib/dates'
import { CategoryField } from './CategoryField'
import { useCards } from '../hooks/useCards'
import { useStatementChoices } from '../hooks/useStatementChoices'
import { useQuickPicks } from '../hooks/useQuickPicks'
import {
  EXPENSE_CURRENCIES,
  movementFormSchema,
  type MovementFormValues,
  type MovementKind,
} from '../schema'
import { saveMovement, type QuickPick, type TransactionListItem } from '../service'

const NO_CARD = '__none__'
const AUTO_PERIOD = '__auto__'

interface MovementFormProps {
  /** Gasto or ingreso — chosen by the dialog's tabs. Switching between the
   *  two keeps what was already typed (except the category: they're
   *  disjoint). */
  kind: MovementKind
  /** The base currency, already loaded — see TransactionFormDialog. */
  defaultCurrency: string
  item: TransactionListItem | undefined
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
    // An ingreso never goes on a credit card.
    if (kind === 'income') {
      form.setValue('cardId', '')
      form.setValue('statementPeriod', '')
    }
    form.clearErrors()
  }, [kind, form])

  const cards = useCards()
  const [cardId, date] = useWatch({ control: form.control, name: ['cardId', 'date'] })
  const statementChoices = useStatementChoices(cardId, date) ?? []
  // Archived cards can't take new gastos, but the one an edited gasto is
  // already on stays selectable so the form can show it.
  const cardOptions = cards?.filter((c) => !c.isArchived || c.id === item?.cardId) ?? []

  function handleCardChange(next: string) {
    // Radix Select inside a <form> can fire onValueChange('') when it
    // (re)mounts before its items — e.g. coming back from the Ingreso tab.
    // Every real option has a value, so '' is never a user's choice.
    if (next === '') return
    form.setValue('cardId', next === NO_CARD ? '' : next)
    form.setValue('statementPeriod', '')
  }

  // Quick entry: the merchants loaded most often, filtered as the user types.
  const quickPicks = useQuickPicks(kind)
  const description = useWatch({ control: form.control, name: 'description' })
  const typed = description.trim().toLowerCase()
  const visiblePicks = item
    ? []
    : (quickPicks ?? [])
        .filter((p) => p.description.toLowerCase() !== typed && p.description.toLowerCase().includes(typed))
        .slice(0, 5)

  /** Fills everything the merchant had last time — only the amount is left. */
  function applyQuickPick(pick: QuickPick) {
    form.setValue('description', pick.description, { shouldValidate: form.formState.isSubmitted })
    form.setValue('categoryId', pick.categoryId, { shouldValidate: form.formState.isSubmitted })
    form.setValue('currency', pick.currency)
    form.setValue('cardId', kind === 'expense' ? (pick.cardId ?? '') : '')
    form.setValue('statementPeriod', '')
    form.setFocus('amount')
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
                  autoComplete="off"
                  {...field}
                />
              </FormControl>
              {visiblePicks.length > 0 && (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Cargados seguido">
                  {visiblePicks.map((pick) => (
                    <Button
                      key={pick.description}
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-7 rounded-full px-3 text-xs"
                      onClick={() => applyQuickPick(pick)}
                    >
                      {pick.description}
                    </Button>
                  ))}
                </div>
              )}
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
          {kind === 'expense' && (
            <FormField
              control={form.control}
              name="cardId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tarjeta</FormLabel>
                  <Select value={field.value || NO_CARD} onValueChange={handleCardChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_CARD}>Sin tarjeta</SelectItem>
                      {cardOptions.map((card) => (
                        <SelectItem key={card.id} value={card.id}>
                          {card.name}
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
                <Select value={field.value} onValueChange={field.onChange}>
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
                    {/* Its options are a sentence long: on a phone they wrap
                        instead of being cut. */}
                    <SelectTrigger className="w-full text-left whitespace-normal data-[size=default]:h-auto data-[size=default]:min-h-9">
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
              <FormControl>
                <CategoryField kind={kind} value={field.value} onChange={field.onChange} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

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
