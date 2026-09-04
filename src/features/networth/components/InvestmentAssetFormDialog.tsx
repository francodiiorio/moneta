import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { CURRENCIES } from '@/domain/money'
import { investmentAssetTypeSchema, type InvestmentAsset } from '@/domain/entities'
import { INVESTMENT_ASSET_TYPE_LABELS } from '../labels'
import { investmentAssetFormSchema, NETWORTH_CURRENCIES, type InvestmentAssetFormValues } from '../schema'
import { createInvestmentAssetFromForm, updateInvestmentAssetFromForm } from '../service'

interface InvestmentAssetFormDialogProps {
  open: boolean
  /** Present -> edit mode: type/currency are locked (they never change
   *  after creation — see updateInvestmentAssetFromForm's docstring),
   *  the rest prefilled from the asset. Absent -> create a new one. */
  asset?: InvestmentAsset
  onOpenChange: (open: boolean) => void
}

const ASSET_TYPES = investmentAssetTypeSchema.options

/** Types with an automatic price provider wired up — see
 *  features/quotes/providers/. Kept local to the form (rather than
 *  shared with service.ts's own copy) since it's purely about which
 *  extra fields to render, same duplication already accepted between
 *  the domain schema's refine and the service's own check. */
function hasAutoProvider(type: InvestmentAssetFormValues['type']): boolean {
  return type === 'crypto' || type === 'cedear'
}

function defaultValues(asset?: InvestmentAsset): InvestmentAssetFormValues {
  if (!asset) return { name: '', symbol: '', type: 'stock', currency: 'USD', autoPrice: false, externalId: '' }
  return {
    name: asset.name,
    symbol: asset.symbol ?? '',
    type: asset.type,
    currency: asset.currency,
    autoPrice: asset.priceMode === 'auto',
    externalId: asset.externalId ?? '',
  }
}

export function InvestmentAssetFormDialog({ open, asset, onOpenChange }: InvestmentAssetFormDialogProps) {
  const form = useForm<InvestmentAssetFormValues>({
    resolver: zodResolver(investmentAssetFormSchema),
    defaultValues: defaultValues(asset),
  })
  const type = form.watch('type')
  const autoPrice = form.watch('autoPrice')

  useEffect(() => {
    if (open) form.reset(defaultValues(asset))
  }, [open, asset, form])

  // A CEDEAR only ever trades in pesos on BYMA (see the domain schema's
  // matching refine) — forcing this here, not just disabling the select,
  // means switching type to 'cedear' can't leave a stale non-ARS value
  // sitting in the form.
  useEffect(() => {
    if (!asset && type === 'cedear') form.setValue('currency', 'ARS')
  }, [type, asset, form])

  async function onSubmit(values: InvestmentAssetFormValues) {
    try {
      if (asset) {
        await updateInvestmentAssetFromForm(asset.id, values)
        toast.success('Activo actualizado')
      } else {
        await createInvestmentAssetFromForm(values)
        toast.success('Activo creado')
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el activo')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{asset ? 'Editar activo' : 'Nuevo activo'}</DialogTitle>
          <DialogDescription>
            {asset
              ? 'Tipo y moneda no se pueden cambiar una vez creado — para eso, borralo y cargalo de nuevo.'
              : 'El instrumento en sí (ej. SPY, Bitcoin) — después le cargás una posición y un precio.'}
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
                    <Select value={field.value} onValueChange={field.onChange} disabled={!!asset}>
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
                    <Select value={field.value} onValueChange={field.onChange} disabled={!!asset || type === 'cedear'}>
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
                    {!asset && type === 'cedear' && (
                      <p className="text-xs text-muted-foreground">Un CEDEAR siempre cotiza en pesos.</p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {hasAutoProvider(type) && (
              <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <Switch
                    id="auto-price"
                    checked={autoPrice}
                    onCheckedChange={(checked) => form.setValue('autoPrice', checked)}
                  />
                  <Label htmlFor="auto-price">
                    {type === 'crypto'
                      ? 'Actualizar precio automáticamente (CoinGecko)'
                      : 'Actualizar precio automáticamente (BYMA vía data912)'}
                  </Label>
                </div>
                {autoPrice && (
                  <FormField
                    control={form.control}
                    name="externalId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{type === 'crypto' ? 'ID en CoinGecko' : 'Símbolo en BYMA'}</FormLabel>
                        <FormControl>
                          <Input placeholder={type === 'crypto' ? 'Ej: bitcoin' : 'Ej: KO'} {...field} />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">
                          {type === 'crypto' ? (
                            <>
                              El id que usa CoinGecko para este activo (no el símbolo) — se ve en la URL de su
                              página, ej. coingecko.com/en/coins/<strong>bitcoin</strong>.
                            </>
                          ) : (
                            'El ticker exacto con el que este CEDEAR cotiza en BYMA — normalmente el mismo símbolo del activo subyacente (ej. KO, AAPL, SPY).'
                          )}
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                {autoPrice && (
                  <p className="text-xs text-muted-foreground">
                    Si el proveedor no responde, se sigue usando el último precio cargado. Podés apagar este
                    switch en cualquier momento y cargar el precio vos mismo desde &quot;Cargar precio&quot;.
                  </p>
                )}
              </div>
            )}

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
