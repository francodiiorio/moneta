import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { CreditCard } from '@/domain/entities'
import { cardFormSchema, type CardFormValues } from '../schema'
import { createCardFromForm, openingBasePeriod, openingFormValues, updateCardFromForm } from '../service'
import { formatMonthLabel, shiftMonth } from '@/lib/dates'

interface CardFormDialogProps {
  open: boolean
  /** undefined = create mode, defined = editing that card. */
  card: CreditCard | undefined
  onOpenChange: (open: boolean) => void
}

const EMPTY: CardFormValues = {
  name: '',
  closingDay: '',
  dueDay: '',
  closingDayToNext: false,
  openingClosedArs: '',
  openingClosedUsd: '',
  openingOpenArs: '',
  openingOpenUsd: '',
  notes: '',
}

const OPENING_INPUTS = [
  { name: 'openingClosedArs', currency: 'ARS' },
  { name: 'openingClosedUsd', currency: 'USD' },
] as const
const OPENING_OPEN_INPUTS = [
  { name: 'openingOpenArs', currency: 'ARS' },
  { name: 'openingOpenUsd', currency: 'USD' },
] as const

export function CardFormDialog({ open, card, onOpenChange }: CardFormDialogProps) {
  const form = useForm<CardFormValues>({ resolver: zodResolver(cardFormSchema), defaultValues: EMPTY })

  useEffect(() => {
    if (!open) return
    form.reset(
      card
        ? {
            name: card.name,
            closingDay: String(card.closingDay),
            dueDay: String(card.dueDay),
            closingDayToNext: card.closingDayToNext ?? false,
            ...openingFormValues(card),
            notes: card.notes ?? '',
          }
        : EMPTY,
    )
    // Keyed on card?.id — a background refetch must not reset an edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, card?.id])

  // Which statements the opening balance is for, once the days are known.
  const [closingDayText, dueDayText, toNext] = useWatch({ control: form.control, name: ['closingDay', 'dueDay', 'closingDayToNext'] })
  const closingDay = Number(closingDayText)
  const dueDay = Number(dueDayText)
  const openingLabels =
    Number.isInteger(closingDay) && closingDay >= 1 && closingDay <= 31 && Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31
      ? (() => {
          const base = openingBasePeriod({
            card: { closingDay, dueDay, closingDayToNext: toNext, ...(card?.openingBase && { openingBase: card.openingBase }) },
            overrides: [],
          })
          return { closed: formatMonthLabel(base).toLowerCase(), open: formatMonthLabel(shiftMonth(base, 1)).toLowerCase() }
        })()
      : undefined

  async function onSubmit(values: CardFormValues) {
    try {
      if (card) {
        const moved = await updateCardFromForm(card.id, values)
        toast.success(
          moved === 0
            ? 'Tarjeta actualizada'
            : `Tarjeta actualizada · ${moved === 1 ? '1 gasto cambió' : `${moved} gastos cambiaron`} de resumen`,
        )
      } else {
        await createCardFromForm(values)
        toast.success('Tarjeta creada')
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la tarjeta')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{card ? 'Editar tarjeta' : 'Nueva tarjeta'}</DialogTitle>
          <DialogDescription>
            Los días en que suele cerrar y vencer el resumen. Si un mes el banco los mueve, lo corregís en ese resumen.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: Visa Galicia" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="closingDay"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Día de cierre</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" placeholder="Ej: 25" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dueDay"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Día de vencimiento</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" placeholder="Ej: 5" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="closingDayToNext"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start gap-3 rounded-lg border border-border p-3">
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} className="mt-0.5" />
                  </FormControl>
                  <div className="flex flex-col gap-1">
                    <FormLabel>Lo comprado el día del cierre va al resumen siguiente</FormLabel>
                    <FormDescription>
                      Así lo hacen muchos bancos: el comercio presenta la compra después del corte. Activalo si en tu
                      resumen las compras de ese día aparecen en el mes siguiente.
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />
            <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-medium">Lo que ya debías al empezar (opcional)</legend>
              <p className="-mt-1 text-xs text-muted-foreground">
                Si arrancás con la tarjeta ya usada, cargá los totales que te muestra el banco en vez de cada gasto. No
                cuentan como gastos tuyos en Moneta (son de antes), pero suman al resumen para que lo puedas pagar desde
                tus cuentas.
              </p>
              {[
                { inputs: OPENING_INPUTS, title: 'Resumen cerrado sin pagar', month: openingLabels?.closed },
                { inputs: OPENING_OPEN_INPUTS, title: 'Resumen en curso, hasta hoy', month: openingLabels?.open },
              ].map(({ inputs, title, month }) => (
                <div key={title} className="flex flex-col gap-1.5">
                  <p className="text-sm">
                    {title}
                    {month && <span className="text-muted-foreground"> · {month}</span>}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {inputs.map(({ name, currency }) => (
                      <FormField
                        key={name}
                        control={form.control}
                        name={name}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs text-muted-foreground">
                              <span className="sr-only">{title} en </span>
                              {currency}
                            </FormLabel>
                            <FormControl>
                              <Input inputMode="decimal" placeholder={currency === 'ARS' ? '$ 0,00' : 'US$ 0,00'} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </fieldset>
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas (opcional)</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
