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
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DateField } from '@/components/DateField'
import { CURRENCIES } from '@/domain/money'
import { todayStamp } from '@/lib/dates'
import { useExpenseCategories } from '../hooks/useExpenseCategories'
import { usePaymentOptions } from '../hooks/usePaymentOptions'
import { getInstallmentPreview } from '../installmentPreview'
import { createInstallmentPlanFromForm } from '../service'
import { installmentPlanFormSchema, PLAN_CURRENCIES, type InstallmentPlanFormValues } from '../schema'

interface InstallmentPlanFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function defaultValues(): InstallmentPlanFormValues {
  const today = todayStamp()
  return {
    description: '',
    categoryId: '',
    currency: 'ARS',
    totalAmount: '',
    count: '',
    firstDueDate: today,
    purchaseDate: today,
    cardId: '',
  }
}

const NO_CARD = '__none__'

export function InstallmentPlanFormDialog({ open, onOpenChange }: InstallmentPlanFormDialogProps) {
  const categories = useExpenseCategories()

  const form = useForm<InstallmentPlanFormValues>({
    resolver: zodResolver(installmentPlanFormSchema),
    defaultValues: defaultValues(),
  })

  useEffect(() => {
    if (open) form.reset(defaultValues())
  }, [open, form])

  const totalAmountInput = form.watch('totalAmount')
  const countInput = form.watch('count')
  const currency = form.watch('currency')
  const cardId = useWatch({ control: form.control, name: 'cardId' })
  const cards = usePaymentOptions()?.cards.filter((c) => !c.isArchived) ?? []
  const installmentPreview = getInstallmentPreview(totalAmountInput, countInput, currency)

  async function onSubmit(values: InstallmentPlanFormValues) {
    try {
      await createInstallmentPlanFromForm(values)
      toast.success('Compra en cuotas creada')
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear la compra en cuotas')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva compra en cuotas</DialogTitle>
          <DialogDescription>
            Se generan las {form.watch('count') || 'N'} cuotas de una vez: las que ya vencieron quedan confirmadas,
            el resto aparece como proyectado hasta su fecha.
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
                    <Input placeholder="Ej: Notebook" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="totalAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monto total</FormLabel>
                    <FormControl>
                      <Input inputMode="decimal" placeholder="0,00" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="count"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cantidad de cuotas</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" placeholder="Ej: 12" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {installmentPreview && <p className="-mt-2 text-xs text-muted-foreground">{installmentPreview}</p>}

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
            </div>

            {cards.length > 0 && (
              <FormField
                control={form.control}
                name="cardId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tarjeta (opcional)</FormLabel>
                    <Select
                      value={field.value || NO_CARD}
                      onValueChange={(next) => {
                        if (next === '') return // spurious Radix value on remount
                        field.onChange(next === NO_CARD ? '' : next)
                        // The hidden "Primera cuota" still validates: keep it
                        // filled (with a card it's the purchase date anyway).
                        if (next !== NO_CARD) form.setValue('firstDueDate', form.getValues('purchaseDate'))
                      }}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_CARD}>Sin tarjeta</SelectItem>
                        {cards.map((card) => (
                          <SelectItem key={card.id} value={card.id}>
                            {card.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {cardId && (
                      <p className="text-xs text-muted-foreground">
                        Cada cuota entra en un resumen, empezando por el de la fecha de compra.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className={cardId ? 'grid gap-4' : 'grid grid-cols-2 gap-4'}>
              <FormField
                control={form.control}
                name="purchaseDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha de compra</FormLabel>
                    <FormControl>
                      <DateField value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {/* With a card the first cuota follows the purchase. */}
              {!cardId && (
                <FormField
                  control={form.control}
                  name="firstDueDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Primera cuota</FormLabel>
                      <FormControl>
                        <DateField value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
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
