import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
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
import { CURRENCIES, formatMoney, money } from '@/domain/money'
import { todayStamp } from '@/lib/dates'
import { CategoryField } from './CategoryField'
import { useSettings } from '../hooks/useSettings'
import { EXPENSE_CURRENCIES, expenseFormSchema, type ExpenseFormValues } from '../schema'
import { saveExpense, type TransactionListItem } from '../service'

interface TransactionFormDialogProps {
  open: boolean
  item: TransactionListItem | undefined
  onOpenChange: (open: boolean) => void
}

function emptyValues(defaultCurrency: string): ExpenseFormValues {
  return { date: todayStamp(), description: '', categoryId: '', currency: defaultCurrency, amount: '' }
}

function magnitudeString(value: { amount: number; currency: string }): string {
  return formatMoney(money(Math.abs(value.amount), value.currency)).replace(/[^\d,.-]/g, '')
}

export function TransactionFormDialog({ open, item, onOpenChange }: TransactionFormDialogProps) {
  const settings = useSettings()
  const isEditing = !!item
  const defaultCurrency = settings?.baseCurrency ?? 'ARS'

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: emptyValues(defaultCurrency),
  })

  useEffect(() => {
    if (!open) return
    if (item) {
      form.reset({
        date: item.date,
        description: item.description,
        categoryId: item.categoryId,
        currency: item.amount.currency,
        amount: magnitudeString(item.amount),
      })
    } else {
      form.reset(emptyValues(defaultCurrency))
    }
    // Keyed on item?.id (a stable primitive), not the live-query-derived `item`
    // object, so a background refetch of the same transaction (e.g. a cross-tab
    // write) doesn't reset an in-progress edit; form is a stable ref from useForm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id])

  async function onSubmit(values: ExpenseFormValues) {
    try {
      await saveExpense(values, item?.id)
      toast.success(isEditing ? 'Gasto actualizado' : 'Gasto creado')
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el gasto')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar gasto' : 'Nuevo gasto'}</DialogTitle>
          <DialogDescription>Registrá en qué se fue la plata.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4 pt-2">
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: Supermercado" {...field} />
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

              <FormField
                control={form.control}
                name="categoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categoría</FormLabel>
                    <CategoryField value={field.value} onChange={field.onChange} />
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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
