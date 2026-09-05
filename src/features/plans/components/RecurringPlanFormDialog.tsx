import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { ChevronRight } from 'lucide-react'
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { DateField } from '@/components/DateField'
import type { RecurringPlan } from '@/domain/entities'
import { CURRENCIES, formatMoney, money } from '@/domain/money'
import { cn } from '@/lib/cn'
import { todayStamp } from '@/lib/dates'
import { useExpenseCategories } from '../hooks/useExpenseCategories'
import { createRecurringPlanFromForm, MaterializationFailedError, updateRecurringPlanFromForm } from '../service'
import { PLAN_CURRENCIES, recurringPlanFormSchema, type RecurringPlanFormValues } from '../schema'

interface RecurringPlanFormDialogProps {
  open: boolean
  /** Defined when editing an existing plan, undefined when creating one —
   *  same convention as TransactionFormDialog's `item`. */
  plan: RecurringPlan | undefined
  onOpenChange: (open: boolean) => void
}

function defaultValues(): RecurringPlanFormValues {
  return {
    description: '',
    categoryId: '',
    currency: 'ARS',
    amount: '',
    freq: 'monthly',
    interval: '1',
    dayOfMonth: '',
    startDate: todayStamp(),
    endDate: '',
    maxOccurrences: '',
  }
}

function planToFormValues(plan: RecurringPlan): RecurringPlanFormValues {
  const { template, rule } = plan
  return {
    description: template.description,
    categoryId: template.categoryId,
    currency: template.currency,
    amount: formatMoney(money(template.amount, template.currency)).replace(/[^\d,.-]/g, ''),
    freq: rule.freq,
    interval: String(rule.interval),
    dayOfMonth: rule.dayOfMonth !== undefined ? String(rule.dayOfMonth) : '',
    startDate: rule.startDate,
    endDate: rule.endDate ?? '',
    maxOccurrences: rule.maxOccurrences !== undefined ? String(rule.maxOccurrences) : '',
  }
}

const FREQ_LABELS: Record<RecurringPlanFormValues['freq'], string> = {
  daily: 'Diario',
  weekly: 'Semanal',
  monthly: 'Mensual',
  yearly: 'Anual',
}

export function RecurringPlanFormDialog({ open, plan, onOpenChange }: RecurringPlanFormDialogProps) {
  const categories = useExpenseCategories()
  const isEditing = !!plan

  const form = useForm<RecurringPlanFormValues>({
    resolver: zodResolver(recurringPlanFormSchema),
    defaultValues: defaultValues(),
  })

  const [advancedOpen, setAdvancedOpen] = useState(false)

  useEffect(() => {
    if (open) {
      form.reset(plan ? planToFormValues(plan) : defaultValues())
      // Open by default when editing a plan that already uses one of these
      // — otherwise the user has no way to notice it's there without
      // clicking to expand, and might assume the plan has no end.
      setAdvancedOpen(!!plan && (plan.rule.endDate !== undefined || plan.rule.maxOccurrences !== undefined))
    }
    // Keyed on plan?.id (a stable primitive), not the live-query-derived
    // `plan` object, so a background refetch doesn't reset an in-progress
    // edit — same reasoning as TransactionFormDialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, plan?.id])

  // Forces the section open if a submit attempt left an error inside it —
  // otherwise a hidden field could block the form with no visible feedback.
  const hasAdvancedError = !!(form.formState.errors.endDate || form.formState.errors.maxOccurrences)

  const freq = form.watch('freq')

  async function onSubmit(values: RecurringPlanFormValues) {
    try {
      if (plan) {
        await updateRecurringPlanFromForm(plan.id, values)
        toast.success('Recurrente actualizado')
      } else {
        await createRecurringPlanFromForm(values)
        toast.success('Recurrente creado')
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el recurrente')
      // MaterializationFailedError means the plan itself was already
      // created/updated successfully — only the immediate catch-up
      // failed. Close anyway: leaving the form open would invite
      // resubmitting it, which (in create mode) would write a genuine
      // duplicate plan with a new id, same template+rule.
      if (error instanceof MaterializationFailedError) onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar recurrente' : 'Nuevo recurrente'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Los movimientos ya generados quedan igual — el cambio rige desde la próxima vez que corresponda.'
              : 'Se genera un movimiento automáticamente cada vez que corresponda — el primero, ahora mismo si ya corresponde.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
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
                        {PLAN_CURRENCIES.map((code) => (
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
                    <DateField value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Collapsible open={advancedOpen || hasAdvancedError} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  <ChevronRight
                    className={cn('size-4 transition-transform', (advancedOpen || hasAdvancedError) && 'rotate-90')}
                  />
                  Opciones avanzadas
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="endDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Termina (opcional)</FormLabel>
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
              </CollapsibleContent>
            </Collapsible>

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
