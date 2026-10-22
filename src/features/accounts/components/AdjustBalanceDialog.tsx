import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { DateField } from '@/components/DateField'
import { MoneyText } from '@/components/MoneyText'
import { formatMoney } from '@/domain/money'
import { todayStamp } from '@/lib/dates'
import { adjustBalanceFormSchema, type AdjustBalanceFormValues } from '../schema'
import { adjustBalanceFromForm, type AccountWithBalance } from '../service'

interface AdjustBalanceDialogProps {
  account: AccountWithBalance | undefined
  onOpenChange: (open: boolean) => void
}

export function AdjustBalanceDialog({ account, onOpenChange }: AdjustBalanceDialogProps) {
  const form = useForm<AdjustBalanceFormValues>({
    resolver: zodResolver(adjustBalanceFormSchema),
    defaultValues: { realBalance: '', date: todayStamp(), description: '' },
  })

  useEffect(() => {
    if (!account) return
    form.reset({ realBalance: '', date: todayStamp(), description: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id])

  async function onSubmit(values: AdjustBalanceFormValues) {
    if (!account) return
    try {
      const result = await adjustBalanceFromForm(account, values)
      toast.success(
        result.adjusted
          ? `Saldo ajustado (${formatMoney(result.difference)})`
          : 'El saldo ya coincidía — no hizo falta ajustar nada',
      )
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo ajustar el saldo')
    }
  }

  return (
    <Dialog open={!!account} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajustar saldo</DialogTitle>
          <DialogDescription>
            Escribí el saldo que muestra tu banco. Moneta guarda la diferencia como un ajuste — nada de lo ya
            cargado se modifica.
          </DialogDescription>
        </DialogHeader>

        {account?.balance && (
          <p className="text-sm">
            Saldo calculado hoy en <span className="font-medium">{account.name}</span>:{' '}
            <MoneyText value={account.balance} className="font-semibold" />
          </p>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="realBalance"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Saldo real ({account?.currency})</FormLabel>
                    <FormControl>
                      <Input inputMode="decimal" placeholder="0,00" autoFocus {...field} />
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
                    <FormLabel>Fecha del saldo</FormLabel>
                    <FormControl>
                      <DateField value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Motivo (opcional)</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: intereses, redondeo" {...field} />
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
                Ajustar
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
