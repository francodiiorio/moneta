import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CURRENCIES, formatMoney, money } from '@/domain/money'
import type { SavingsHolding } from '@/domain/entities'
import { savingsFormSchema, NETWORTH_CURRENCIES, type SavingsFormValues } from '../schema'
import { createSavingsHoldingFromForm, updateSavingsHoldingFromForm } from '../service'

interface SavingsFormDialogProps {
  open: boolean
  /** undefined = create mode, defined = editing that holding. */
  holding: SavingsHolding | undefined
  onOpenChange: (open: boolean) => void
}

const DEFAULT_VALUES: SavingsFormValues = { name: '', currency: 'ARS', amount: '0', location: '', notes: '' }

export function SavingsFormDialog({ open, holding, onOpenChange }: SavingsFormDialogProps) {
  const isEditing = !!holding

  const form = useForm<SavingsFormValues>({
    resolver: zodResolver(savingsFormSchema),
    defaultValues: DEFAULT_VALUES,
  })

  useEffect(() => {
    if (!open) return
    form.reset(
      holding
        ? {
            name: holding.name,
            currency: holding.currency,
            amount: formatMoney(money(holding.amount, holding.currency)).replace(/[^\d,.-]/g, ''),
            location: holding.location ?? '',
            notes: holding.notes ?? '',
          }
        : DEFAULT_VALUES,
    )
  }, [open, holding, form])

  async function onSubmit(values: SavingsFormValues) {
    try {
      if (isEditing) {
        await updateSavingsHoldingFromForm(holding.id, values)
        toast.success('Ahorro actualizado')
      } else {
        await createSavingsHoldingFromForm(values)
        toast.success('Ahorro creado')
      }
      onOpenChange(false)
    } catch {
      toast.error('No se pudo guardar el ahorro')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar ahorro' : 'Nuevo ahorro'}</DialogTitle>
          <DialogDescription>
            Plata que tenés guardada pero no pasa por movimientos — efectivo, una caja de ahorro que no
            conciliás, etc.
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
                    <Input placeholder="Ej: USD efectivo" {...field} />
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

              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Importe</FormLabel>
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
              name="location"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ubicación (opcional)</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: Banco X, colchón" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
