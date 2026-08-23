import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { InvestmentAsset } from '@/domain/entities'
import { todayStamp } from '@/lib/dates'
import { investmentPriceFormSchema, type InvestmentPriceFormValues } from '../schema'
import { createManualPriceFromForm } from '../service'

interface InvestmentPriceDialogProps {
  /** The asset to load a price for — null closes the dialog. */
  asset: InvestmentAsset | null
  onOpenChange: (open: boolean) => void
}

function defaultValues(): InvestmentPriceFormValues {
  return { price: '', date: todayStamp() }
}

export function InvestmentPriceDialog({ asset, onOpenChange }: InvestmentPriceDialogProps) {
  const form = useForm<InvestmentPriceFormValues>({
    resolver: zodResolver(investmentPriceFormSchema),
    defaultValues: defaultValues(),
  })

  useEffect(() => {
    if (asset) form.reset(defaultValues())
  }, [asset, form])

  async function onSubmit(values: InvestmentPriceFormValues) {
    if (!asset) return
    try {
      await createManualPriceFromForm(asset.id, asset.currency, values)
      toast.success('Precio cargado')
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar el precio')
    }
  }

  return (
    <Dialog open={!!asset} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cargar precio {asset?.symbol ? `de ${asset.symbol}` : ''}</DialogTitle>
          <DialogDescription>
            Se guarda como una fila nueva de historial — no reemplaza el precio anterior.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Precio ({asset?.currency})</FormLabel>
                    <FormControl>
                      <Input inputMode="decimal" placeholder="0,00" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
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
