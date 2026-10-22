import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { DateField } from '@/components/DateField'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CURRENCIES, formatMoney, money } from '@/domain/money'
import { todayStamp } from '@/lib/dates'
import { ACCOUNT_TYPE_LABELS } from '../labels'
import { accountFormSchema, ACCOUNT_CURRENCIES, type AccountFormValues } from '../schema'
import { createAccountFromForm, updateAccountFromForm, type AccountWithBalance } from '../service'

interface AccountFormDialogProps {
  open: boolean
  /** undefined = create mode, defined = editing that account. */
  account: AccountWithBalance | undefined
  onOpenChange: (open: boolean) => void
}

function emptyValues(): AccountFormValues {
  return { name: '', type: 'bank', currency: 'ARS', openingBalance: '0', openingDate: todayStamp(), notes: '' }
}

export function AccountFormDialog({ open, account, onOpenChange }: AccountFormDialogProps) {
  const isEditing = !!account

  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: emptyValues(),
  })

  useEffect(() => {
    if (!open) return
    form.reset(
      account
        ? {
            name: account.name,
            type: account.type,
            currency: account.currency,
            openingBalance: formatMoney(money(account.openingBalance, account.currency)).replace(/[^\d,.-]/g, ''),
            openingDate: account.openingDate,
            notes: account.notes ?? '',
          }
        : emptyValues(),
    )
    // Keyed on account?.id, not the live-query-derived object, so a
    // background refetch doesn't reset an in-progress edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account?.id])

  async function onSubmit(values: AccountFormValues) {
    try {
      if (isEditing) {
        await updateAccountFromForm(account.id, values)
        toast.success('Cuenta actualizada')
      } else {
        await createAccountFromForm(values)
        toast.success('Cuenta creada')
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la cuenta')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar cuenta' : 'Nueva cuenta'}</DialogTitle>
          <DialogDescription>
            Una cuenta tiene una sola moneda. Su saldo se calcula solo: saldo inicial + ingresos − gastos con
            débito ± transferencias ± ajustes.
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
                    <Input placeholder="Ej: Galicia pesos" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                        {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
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
                    <Select value={field.value} onValueChange={field.onChange} disabled={account?.hasMovements ?? false}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {ACCOUNT_CURRENCIES.map((code) => (
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

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="openingBalance"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Saldo inicial</FormLabel>
                    <FormControl>
                      <Input inputMode="decimal" placeholder="0,00" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="openingDate"
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
            <p className="-mt-2 text-sm text-muted-foreground">
              Lo que tenías en la cuenta al empezar ese día. Los movimientos se cargan desde esa fecha en adelante.
              {account?.hasMovements && ' La moneda ya no se puede cambiar: la cuenta tiene movimientos.'}
            </p>

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
