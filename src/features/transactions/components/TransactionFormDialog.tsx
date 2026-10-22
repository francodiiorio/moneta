import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { DateField } from '@/components/DateField'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CURRENCIES, formatMoney, money } from '@/domain/money'
import { todayStamp } from '@/lib/dates'
import { CategoryField } from './CategoryField'
import { useAccounts } from '../hooks/useAccounts'
import { useSettings } from '../hooks/useSettings'
import {
  EXPENSE_CURRENCIES,
  movementFormSchema,
  movementKindSchema,
  type MovementFormValues,
  type MovementKind,
} from '../schema'
import { saveMovement, type EditableTransactionItem } from '../service'

const NO_ACCOUNT = '__none__'

interface TransactionFormDialogProps {
  open: boolean
  item: EditableTransactionItem | undefined
  onOpenChange: (open: boolean) => void
}

function emptyValues(defaultCurrency: string): MovementFormValues {
  return {
    kind: 'expense',
    date: todayStamp(),
    description: '',
    categoryId: '',
    currency: defaultCurrency,
    amount: '',
    accountId: '',
  }
}

function magnitudeString(value: { amount: number; currency: string }): string {
  return formatMoney(money(Math.abs(value.amount), value.currency)).replace(/[^\d,.-]/g, '')
}

const COPY: Record<MovementKind, { create: string; edit: string; description: string; saved: string; updated: string }> = {
  expense: {
    create: 'Nuevo gasto',
    edit: 'Editar gasto',
    description: 'Registrá en qué se fue la plata. Si lo pagaste con débito, elegí la cuenta.',
    saved: 'Gasto creado',
    updated: 'Gasto actualizado',
  },
  income: {
    create: 'Nuevo ingreso',
    edit: 'Editar ingreso',
    description: 'Registrá plata que entró a una de tus cuentas.',
    saved: 'Ingreso creado',
    updated: 'Ingreso actualizado',
  },
}

export function TransactionFormDialog({ open, item, onOpenChange }: TransactionFormDialogProps) {
  const settings = useSettings()
  const accounts = useAccounts()
  const isEditing = !!item
  const defaultCurrency = settings?.baseCurrency ?? 'ARS'

  const form = useForm<MovementFormValues>({
    resolver: zodResolver(movementFormSchema),
    defaultValues: emptyValues(defaultCurrency),
  })

  useEffect(() => {
    if (!open) return
    if (item) {
      form.reset({
        kind: item.kind,
        date: item.date,
        description: item.description,
        categoryId: item.categoryId,
        currency: item.amount.currency,
        amount: magnitudeString(item.amount),
        accountId: item.accountId ?? '',
      })
    } else {
      form.reset(emptyValues(defaultCurrency))
    }
    // Keyed on item?.id (a stable primitive), not the live-query-derived `item`
    // object, so a background refetch of the same transaction (e.g. a cross-tab
    // write) doesn't reset an in-progress edit; form is a stable ref from useForm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id])

  const watchedKind = useWatch({ control: form.control, name: 'kind' })
  // Editing never switches kind (the tabs are hidden), so read it from the
  // item itself: the form only picks it up in the reset effect, after the
  // first render — reading the watched value would flash "Editar gasto"
  // and the gasto categories for an ingreso.
  const kind = item?.kind ?? watchedKind
  const accountId = useWatch({ control: form.control, name: 'accountId' })
  const selectedAccount = accounts?.find((a) => a.id === accountId)
  // Archived accounts can't take new movements, but the one an edited
  // movement already points at stays selectable so the form can show it.
  const accountOptions = accounts?.filter((a) => !a.isArchived || a.id === item?.accountId) ?? []
  const copy = COPY[kind]

  function handleKindChange(next: MovementKind) {
    form.setValue('kind', next)
    // Gasto and ingreso categories are disjoint — a category picked for one
    // is never valid for the other.
    form.setValue('categoryId', '')
    form.clearErrors()
  }

  function handleAccountChange(next: string) {
    const nextId = next === NO_ACCOUNT ? '' : next
    form.setValue('accountId', nextId, { shouldValidate: form.formState.isSubmitted })
    // An account has one fixed currency: every movement against it is in
    // that currency (enforced again in the repository).
    const account = accounts?.find((a) => a.id === nextId)
    if (account) form.setValue('currency', account.currency)
  }

  async function onSubmit(values: MovementFormValues) {
    try {
      await saveMovement(values, item?.id)
      toast.success(isEditing ? copy.updated : copy.saved)
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el movimiento')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? copy.edit : copy.create}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4 pt-2">
            {!isEditing && (
              <Tabs
                value={kind}
                onValueChange={(v) => {
                  const parsed = movementKindSchema.safeParse(v)
                  if (parsed.success) handleKindChange(parsed.data)
                }}
              >
                <TabsList className="w-full">
                  <TabsTrigger value="expense">Gasto</TabsTrigger>
                  <TabsTrigger value="income">Ingreso</TabsTrigger>
                </TabsList>
              </Tabs>
            )}

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción</FormLabel>
                  <FormControl>
                    <Input placeholder={kind === 'income' ? 'Ej: Sueldo' : 'Ej: Supermercado'} {...field} />
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
                      <DateField value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} />
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
              <FormField
                control={form.control}
                name="accountId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{kind === 'income' ? 'Cuenta' : 'Cuenta (opcional)'}</FormLabel>
                    <Select value={field.value || (kind === 'income' ? '' : NO_ACCOUNT)} onValueChange={handleAccountChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Elegí una cuenta" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {kind === 'expense' && <SelectItem value={NO_ACCOUNT}>Sin cuenta</SelectItem>}
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

              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Moneda</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={!!selectedAccount}>
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
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                Guardar
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
