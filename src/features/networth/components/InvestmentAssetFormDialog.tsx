import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CURRENCIES } from '@/domain/money'
import { investmentAssetTypeSchema } from '@/domain/entities'
import { INVESTMENT_ASSET_TYPE_LABELS } from '../labels'
import { investmentAssetFormSchema, NETWORTH_CURRENCIES, type InvestmentAssetFormValues } from '../schema'
import { createInvestmentAssetFromForm } from '../service'

interface InvestmentAssetFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const ASSET_TYPES = investmentAssetTypeSchema.options

function defaultValues(): InvestmentAssetFormValues {
  return { name: '', symbol: '', type: 'stock', currency: 'USD' }
}

export function InvestmentAssetFormDialog({ open, onOpenChange }: InvestmentAssetFormDialogProps) {
  const form = useForm<InvestmentAssetFormValues>({
    resolver: zodResolver(investmentAssetFormSchema),
    defaultValues: defaultValues(),
  })

  useEffect(() => {
    if (open) form.reset(defaultValues())
  }, [open, form])

  async function onSubmit(values: InvestmentAssetFormValues) {
    try {
      await createInvestmentAssetFromForm(values)
      toast.success('Activo creado')
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear el activo')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo activo</DialogTitle>
          <DialogDescription>
            El instrumento en sí (ej. SPY, Bitcoin) — después le cargás una posición y un precio.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: SPDR S&P 500" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="symbol"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Símbolo (opcional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: SPY" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {ASSET_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {INVESTMENT_ASSET_TYPE_LABELS[type]}
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
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {NETWORTH_CURRENCIES.map((code) => (
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
