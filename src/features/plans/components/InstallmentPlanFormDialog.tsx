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
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DateField } from '@/components/DateField'
import { CURRENCIES } from '@/domain/money'
import { todayStamp } from '@/lib/dates'
import { useExpenseCategories } from '../hooks/useExpenseCategories'
import { usePaymentOptions } from '../hooks/usePaymentOptions'
import { useCuotaInOpenStatement, useOpenStatementHasOpening } from '../hooks/useCuotaInOpenStatement'
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
    alreadyPaying: false,
    currentCuota: '',
    currentCuotaInOpening: false,
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
  const [alreadyPaying, currentCuota, purchaseDate] = useWatch({
    control: form.control,
    name: ['alreadyPaying', 'currentCuota', 'purchaseDate'],
  })
  // With a card, the cuota the purchase date puts in today's statement —
  // checked against the bank's number before saving.
  const expectedCuota = useCuotaInOpenStatement(cardId, purchaseDate)
  const openingCoversToday = useOpenStatementHasOpening(cardId, currency)
  const cuotaNumber = Number(currentCuota)
  // With a card the number must match the purchase date (every cuota is
  // placed from it): a mismatch blocks saving, it doesn't just warn.
  const notBilledYet = alreadyPaying && !!cardId && expectedCuota !== undefined && expectedCuota < 1
  const cuotaMismatch =
    alreadyPaying && !!cardId && !notBilledYet && expectedCuota !== undefined && Number.isInteger(cuotaNumber) && cuotaNumber > 0
      ? expectedCuota !== cuotaNumber
      : false

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
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva compra en cuotas</DialogTitle>
          <DialogDescription>
            Se generan las cuotas de una vez: las que ya vencieron quedan confirmadas, el resto aparece como proyectado
            hasta su fecha. Si ya la venías pagando, Moneta arranca desde la cuota por la que vas.
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
                      <FormLabel>{alreadyPaying ? 'Vence esa cuota' : 'Primera cuota'}</FormLabel>
                      <FormControl>
                        <DateField value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            <FormField
              control={form.control}
              name="alreadyPaying"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start gap-3 rounded-lg border border-border p-3">
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} className="mt-0.5" />
                  </FormControl>
                  <div className="flex flex-1 flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <FormLabel>Ya la venía pagando</FormLabel>
                      <FormDescription>
                        Moneta carga sólo las cuotas que faltan: las anteriores no aparecen como gastos de meses en los
                        que no la usabas{cardId ? ' (o ya están en el saldo inicial de la tarjeta)' : ''}.
                      </FormDescription>
                    </div>
                    {alreadyPaying && (
                      <FormField
                        control={form.control}
                        name="currentCuota"
                        render={({ field: cuota }) => (
                          <FormItem>
                            <FormLabel>
                              {cardId ? '¿Qué cuota figura en el resumen en curso?' : '¿Cuál es la próxima cuota a pagar?'}
                            </FormLabel>
                            <FormControl>
                              <Input inputMode="numeric" placeholder="Ej: 3" className="w-24" {...cuota} />
                            </FormControl>
                            {cuotaMismatch && (
                              <p className="text-xs font-medium text-negative">
                                Con esa fecha de compra, la cuota del resumen en curso es la {expectedCuota}. Corregí la
                                fecha o el día de cierre de la tarjeta.
                              </p>
                            )}
                            {notBilledYet && (
                              <p className="text-xs font-medium text-negative">
                                La compra todavía no entró en ningún resumen: no hace falta "Ya la venía pagando".
                              </p>
                            )}
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                    {alreadyPaying && cardId && openingCoversToday && (
                      <FormField
                        control={form.control}
                        name="currentCuotaInOpening"
                        render={({ field: included }) => (
                          <FormItem className="flex flex-row items-start gap-2">
                            <FormControl>
                              <Checkbox
                                checked={included.value}
                                onCheckedChange={(checked) => included.onChange(checked === true)}
                                className="mt-0.5"
                              />
                            </FormControl>
                            <div className="flex flex-col gap-0.5">
                              <FormLabel>Esa cuota ya está en el saldo inicial del resumen en curso</FormLabel>
                              <FormDescription>
                                Si la contaste en "lo que llevás gastado" al cargar la tarjeta, tildalo y Moneta arranca
                                desde la siguiente, para no contarla dos veces.
                              </FormDescription>
                            </div>
                          </FormItem>
                        )}
                      />
                    )}
                  </div>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting || cuotaMismatch || notBilledYet}>
                Guardar
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
