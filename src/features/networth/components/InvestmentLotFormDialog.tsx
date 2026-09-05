import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DateField } from '@/components/DateField'
import { formatQuantity, quantity } from '@/domain/decimal'
import { formatMoney, money } from '@/domain/money'
import type { InvestmentAsset, InvestmentLot } from '@/domain/entities'
import { todayStamp } from '@/lib/dates'
import { investmentLotFormSchema, type InvestmentLotFormValues } from '../schema'
import { createInvestmentLotFromForm, updateInvestmentLotFromForm } from '../service'

interface InvestmentLotFormDialogProps {
  open: boolean
  /** undefined = create mode, defined = editing that lot. */
  lot: InvestmentLot | undefined
  assets: InvestmentAsset[] | undefined
  /** Sólo los activos que todavía no tienen una posición — son las
   *  únicas opciones que se pueden elegir al crear una compra nueva sin
   *  `initialAssetId` (ver `assets` arriba, que sigue haciendo falta
   *  completo para resolver la moneda del activo ya asignado al editar
   *  o al agregar otra compra a una posición existente). Evita el caso
   *  real de elegir un activo que ya tiene holding y terminar con dos
   *  filas separadas para el mismo activo — ver ADR "'Nueva posición'
   *  no ofrece un activo que ya tiene holding" en docs/DECISIONS.md. */
  availableAssets: InvestmentAsset[] | undefined
  /** Fija (y bloquea) el activo al crear — agregar otra compra a una
   *  posición que ya existe, desde InvestmentLotsDialog. Ignorado al
   *  editar, donde el activo ya viene fijo por el propio `lot`. */
  initialAssetId?: string
  onOpenChange: (open: boolean) => void
}

function defaultValues(initialAssetId?: string): InvestmentLotFormValues {
  return { assetId: initialAssetId ?? '', quantity: '', costPerUnit: '', date: todayStamp() }
}

export function InvestmentLotFormDialog({
  open,
  lot,
  assets,
  availableAssets,
  initialAssetId,
  onOpenChange,
}: InvestmentLotFormDialogProps) {
  const isEditing = !!lot
  // El activo va fijo (y el selector deshabilitado) tanto al editar una
  // compra existente como al agregar una compra nueva a una posición que
  // ya existe (initialAssetId) — en ambos casos ese activo ya tiene
  // holding, así que no está en availableAssets y hace falta la lista
  // completa para poder mostrarlo igual.
  const assetLocked = isEditing || initialAssetId !== undefined
  const selectableAssets = assetLocked ? assets : availableAssets

  const form = useForm<InvestmentLotFormValues>({
    resolver: zodResolver(investmentLotFormSchema),
    defaultValues: defaultValues(),
  })
  const selectedAssetId = form.watch('assetId')
  const selectedAsset = assets?.find((a) => a.id === selectedAssetId)

  useEffect(() => {
    if (!open) return
    const asset = lot ? assets?.find((a) => a.id === lot.assetId) : undefined
    form.reset(
      lot
        ? {
            assetId: lot.assetId,
            quantity: formatQuantity(quantity(lot.quantity)),
            costPerUnit:
              lot.costPerUnit !== undefined && asset
                ? formatMoney(money(lot.costPerUnit, asset.currency)).replace(/[^\d,.-]/g, '')
                : '',
            date: lot.date,
          }
        : defaultValues(initialAssetId),
    )
  }, [open, lot, assets, initialAssetId, form])

  async function onSubmit(values: InvestmentLotFormValues) {
    try {
      if (isEditing) {
        await updateInvestmentLotFromForm(lot.id, values)
        toast.success('Compra actualizada')
      } else {
        await createInvestmentLotFromForm(values)
        toast.success('Compra registrada')
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la compra')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar compra' : 'Nueva compra'}</DialogTitle>
          <DialogDescription>Cuánto compraste, a qué costo y cuándo.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="assetId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Activo</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={assetLocked}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Elegí un activo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {selectableAssets?.map((asset) => (
                        <SelectItem key={asset.id} value={asset.id}>
                          {asset.symbol ? `${asset.symbol} · ${asset.name}` : asset.name}
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
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cantidad</FormLabel>
                    <FormControl>
                      <Input inputMode="decimal" placeholder="0" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="costPerUnit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Costo por unidad {selectedAsset ? `(${selectedAsset.currency})` : ''} (opcional)</FormLabel>
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
