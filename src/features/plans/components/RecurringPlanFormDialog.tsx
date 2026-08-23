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
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { todayStamp } from '@/lib/dates'
import { useAccounts } from '../hooks/useAccounts'
import { useExpenseCategories } from '../hooks/useExpenseCategories'
import { useIncomeCategories } from '../hooks/useIncomeCategories'
import { createRecurringPlanFromForm } from '../service'
import { recurringPlanFormSchema, type RecurringPlanFormValues } from '../schema'

interface RecurringPlanFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function defaultValues(): RecurringPlanFormValues {
  return {
    description: '',
    kind: 'expense',
    accountId: '',
    categoryId: '',
    toAccountId: '',
    amount: '',
    freq: 'monthly',
    interval: '1',
    dayOfMonth: '',
    startDate: todayStamp(),
    endDate: '',
    maxOccurrences: '',
  }
}

const FREQ_LABELS: Record<RecurringPlanFormValues['freq'], string> = {
  daily: 'Diario',
  weekly: 'Semanal',
  monthly: 'Mensual',
  yearly: 'Anual',
}

export function RecurringPlanFormDialog({ open, onOpenChange }: RecurringPlanFormDialogProps) {
  const accounts = useAccounts()
  const expenseCategories = useExpenseCategories()
  const incomeCategories = useIncomeCategories()

  const form = useForm<RecurringPlanFormValues>({
    resolver: zodResolver(recurringPlanFormSchema),
    defaultValues: defaultValues(),
  })

  useEffect(() => {
    if (open) form.reset(defaultValues())
  }, [open, form])

  const kind = form.watch('kind')
  const freq = form.watch('freq')
  const accountId = form.watch('accountId')
  const categories = kind === 'income' ? incomeCategories : expenseCategories
  // A recurring transfer template only holds one amount+currency — it can't
  // represent a cross-currency leg (see service.ts:createRecurringPlanFromForm),
  // so only same-currency destination accounts are offered.
  const selectedCurrency = accounts?.find((a) => a.id === accountId)?.currency
  const toAccountOptions = accounts?.filter((a) => a.id !== accountId && a.currency === selectedCurrency)

  async function onSubmit(values: RecurringPlanFormValues) {
    try {
      await createRecurringPlanFromForm(values)
      toast.success('Recurrente creado')
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear el recurrente')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo recurrente</DialogTitle>
          <DialogDescription>
            Se genera un movimiento automáticamente cada vez que corresponda, al abrir la app.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="kind"
              render={({ field }) => (
                <Tabs value={field.value} onValueChange={field.onChange}>
                  <TabsList className="w-full">
                    <TabsTrigger value="expense">Gasto</TabsTrigger>
                    <TabsTrigger value="income">Ingreso</TabsTrigger>
                    <TabsTrigger value="transfer">Transferencia</TabsTrigger>
                  </TabsList>
                </Tabs>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: Alquiler" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="accountId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{kind === 'transfer' ? 'Desde' : 'Cuenta'}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Elegí una cuenta" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {accounts?.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.name}
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

            {kind === 'transfer' ? (
              <FormField
                control={form.control}
                name="toAccountId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hacia</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Cuenta destino" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {toAccountOptions?.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <FormField
                control={form.control}
                name="categoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categoría</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Elegí una categoría" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {categories?.map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="freq"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Frecuencia</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.entries(FREQ_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
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
                name="interval"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cada cuántos</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {freq === 'monthly' && (
              <FormField
                control={form.control}
                name="dayOfMonth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Día del mes (opcional)</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" placeholder="Ej: 5" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="startDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Empieza</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Termina (opcional)</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="maxOccurrences"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Máximo de veces (opcional)</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" {...field} />
                    </FormControl>
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
