import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CURRENCIES, formatMoney, money } from '@/domain/money'
import { ACCOUNT_TYPE_LABELS } from '../labels'
import { accountFormSchema, ACCOUNT_CURRENCIES, type AccountFormValues } from '../schema'
import { createAccountFromForm, updateAccountFromForm, type AccountWithBalance } from '../service'

interface AccountFormDialogProps {
  open: boolean
  /** undefined = create mode, defined = editing that account. */
  account: AccountWithBalance | undefined
  onOpenChange: (open: boolean) => void
}

const DEFAULT_VALUES: AccountFormValues = {
  name: '',
  type: 'bank',
  currency: 'ARS',
  openingBalance: '0',
}

export function AccountFormDialog({ open, account, onOpenChange }: AccountFormDialogProps) {
  const isEditing = !!account

  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: DEFAULT_VALUES,
  })

  useEffect(() => {
    if (!open) return
    form.reset(
      account
        ? {
            name: account.name,
            type: account.type,
            currency: account.currency as AccountFormValues['currency'],
            openingBalance: formatMoney(money(account.openingBalance, account.currency)).replace(
              /[^\d,.-]/g,
              '',
            ),
          }
        : DEFAULT_VALUES,
    )
  }, [open, account, form])

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
    } catch {
      toast.error('No se pudo guardar la cuenta')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar cuenta' : 'Nueva cuenta'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Actualizá los datos de tu cuenta.'
              : 'Agregá una cuenta para empezar a registrar movimientos.'}
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
                    <Input placeholder="Ej: Banco Galicia" {...field} />
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
                    <Select value={field.value} onValueChange={field.onChange} disabled={isEditing}>
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

            <FormField
              control={form.control}
              name="openingBalance"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{isEditing ? 'Saldo inicial' : 'Saldo inicial'}</FormLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder="0,00" {...field} />
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
