import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatQuantity, quantity } from '@/domain/decimal'
import { formatMoney, money } from '@/domain/money'
import type { InvestmentAsset, InvestmentHolding } from '@/domain/entities'
import { investmentHoldingFormSchema, type InvestmentHoldingFormValues } from '../schema'
import { createInvestmentHoldingFromForm, updateInvestmentHoldingFromForm } from '../service'

interface InvestmentHoldingFormDialogProps {
  open: boolean
  /** undefined = create mode, defined = editing that holding. */
  holding: InvestmentHolding | undefined
  assets: InvestmentAsset[] | undefined
  onOpenChange: (open: boolean) => void
}

function defaultValues(): InvestmentHoldingFormValues {
  return { assetId: '', quantity: '', averageCost: '' }
}

export function InvestmentHoldingFormDialog({ open, holding, assets, onOpenChange }: InvestmentHoldingFormDialogProps) {
  const isEditing = !!holding

  const form = useForm<InvestmentHoldingFormValues>({
    resolver: zodResolver(investmentHoldingFormSchema),
    defaultValues: defaultValues(),
  })
  const selectedAssetId = form.watch('assetId')
  const selectedAsset = assets?.find((a) => a.id === selectedAssetId)

  useEffect(() => {
    if (!open) return
    const asset = holding ? assets?.find((a) => a.id === holding.assetId) : undefined
    form.reset(
      holding
        ? {
            assetId: holding.assetId,
            quantity: formatQuantity(quantity(holding.quantity)),
            averageCost:
              holding.averageCost !== undefined && asset
                ? formatMoney(money(holding.averageCost, asset.currency)).replace(/[^\d,.-]/g, '')
                : '',
          }
        : defaultValues(),
    )
  }, [open, holding, assets, form])

  async function onSubmit(values: InvestmentHoldingFormValues) {
    try {
      if (isEditing) {
        await updateInvestmentHoldingFromForm(holding.id, values)
        toast.success('Posición actualizada')
      } else {
        await createInvestmentHoldingFromForm(values)
        toast.success('Posición creada')
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la posición')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar posición' : 'Nueva posición'}</DialogTitle>
          <DialogDescription>Cuánto tenés de un activo que ya cargaste.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="assetId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Activo</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={isEditing}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Elegí un activo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {assets?.map((asset) => (
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
                name="averageCost"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Costo promedio {selectedAsset ? `(${selectedAsset.currency})` : ''} (opcional)
                    </FormLabel>
                    <FormControl>
                      <Input inputMode="decimal" placeholder="0,00" {...field} />
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
