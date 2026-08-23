import { useEffect, useState } from 'react'
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatMoney, money } from '@/domain/money'
import { todayStamp } from '@/lib/dates'
import { CategoryField } from './CategoryField'
import { useAccounts } from '../hooks/useAccounts'
import {
  expenseIncomeFormSchema,
  transferFormSchema,
  type ExpenseIncomeFormValues,
  type TransferFormValues,
} from '../schema'
import { saveExpenseIncome, saveTransfer, type TransactionListItem } from '../service'
import { TRANSACTION_KIND_LABELS } from '../labels'
import type { TransactionKindTab } from '../store'

interface TransactionFormDialogProps {
  open: boolean
  item: TransactionListItem | undefined
  initialKind: TransactionKindTab
  onOpenChange: (open: boolean) => void
}

const EMPTY_EXPENSE_INCOME: ExpenseIncomeFormValues = {
  date: todayStamp(),
  description: '',
  accountId: '',
  categoryId: '',
  amount: '',
}

const EMPTY_TRANSFER: TransferFormValues = {
  date: todayStamp(),
  description: '',
  fromAccountId: '',
  toAccountId: '',
  amount: '',
  toAmount: '',
}

function magnitudeString(value: { amount: number; currency: string }): string {
  return formatMoney(money(Math.abs(value.amount), value.currency)).replace(/[^\d,.-]/g, '')
}

export function TransactionFormDialog({ open, item, initialKind, onOpenChange }: TransactionFormDialogProps) {
  const accounts = useAccounts()
  const isEditing = !!item
  const [tab, setTab] = useState<TransactionKindTab>(initialKind)

  const expenseIncomeForm = useForm<ExpenseIncomeFormValues>({
    resolver: zodResolver(expenseIncomeFormSchema),
    defaultValues: EMPTY_EXPENSE_INCOME,
  })
  const transferForm = useForm<TransferFormValues>({
    resolver: zodResolver(transferFormSchema),
    defaultValues: EMPTY_TRANSFER,
  })

  useEffect(() => {
    if (!open) return
    setTab(initialKind)

    if (item && (item.kind === 'expense' || item.kind === 'income')) {
      expenseIncomeForm.reset({
        date: item.date,
        description: item.description,
        accountId: item.accountId ?? '',
        categoryId: item.categoryId ?? '',
        amount: magnitudeString(item.amount),
      })
    } else if (item && item.kind === 'transfer') {
      transferForm.reset({
        date: item.date,
        description: item.description,
        fromAccountId: item.fromAccountId ?? '',
        toAccountId: item.toAccountId ?? '',
        amount: item.fromAmount ? magnitudeString(item.fromAmount) : '',
        toAmount: item.toAmount ? magnitudeString(item.toAmount) : '',
      })
    } else {
      expenseIncomeForm.reset(EMPTY_EXPENSE_INCOME)
      transferForm.reset(EMPTY_TRANSFER)
    }
    // Keyed on item?.id (a stable primitive), not the live-query-derived `item`
    // object, so a background refetch of the same transaction (e.g. a cross-tab
    // write) doesn't reset an in-progress edit; forms are stable refs from useForm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id, initialKind])

  async function onSubmitExpenseIncome(values: ExpenseIncomeFormValues) {
    if (!accounts) return
    try {
      const kind = tab === 'income' ? 'income' : 'expense'
      await saveExpenseIncome(kind, values, accounts, item?.id)
      toast.success(isEditing ? 'Movimiento actualizado' : 'Movimiento creado')
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el movimiento')
    }
  }

  async function onSubmitTransfer(values: TransferFormValues) {
    if (!accounts) return
    try {
      await saveTransfer(values, accounts, item?.id)
      toast.success(isEditing ? 'Movimiento actualizado' : 'Movimiento creado')
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el movimiento')
    }
  }

  const fromAccountId = transferForm.watch('fromAccountId')
  const toAccountId = transferForm.watch('toAccountId')
  const fromCurrency = accounts?.find((a) => a.id === fromAccountId)?.currency
  const toCurrency = accounts?.find((a) => a.id === toAccountId)?.currency
  const needsToAmount = !!fromCurrency && !!toCurrency && fromCurrency !== toCurrency

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar movimiento' : 'Nuevo movimiento'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? `Editando un ${TRANSACTION_KIND_LABELS[item.kind].toLowerCase()}.`
              : 'Registrá un gasto, un ingreso o una transferencia.'}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as TransactionKindTab)}>
          {!isEditing && (
            <TabsList className="w-full">
              <TabsTrigger value="expense">Gasto</TabsTrigger>
              <TabsTrigger value="income">Ingreso</TabsTrigger>
              <TabsTrigger value="transfer">Transferencia</TabsTrigger>
            </TabsList>
          )}

          {tab !== 'transfer' ? (
            <Form {...expenseIncomeForm}>
              <form
                onSubmit={expenseIncomeForm.handleSubmit(onSubmitExpenseIncome)}
                className="flex flex-col gap-4 pt-2"
              >
                <FormField
                  control={expenseIncomeForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Descripción</FormLabel>
                      <FormControl>
                        <Input placeholder="Ej: Supermercado" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={expenseIncomeForm.control}
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
                  <FormField
                    control={expenseIncomeForm.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Monto</FormLabel>
                        <FormControl>
                          <Input inputMode="decimal" placeholder="0,00" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={expenseIncomeForm.control}
                  name="accountId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cuenta</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Elegí una cuenta" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {accounts?.map((account) => (
                            <SelectItem key={account.id} value={account.id}>
                              {account.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={expenseIncomeForm.control}
                  name="categoryId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Categoría</FormLabel>
                      <CategoryField
                        kind={tab === 'income' ? 'income' : 'expense'}
                        value={field.value}
                        onChange={field.onChange}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={expenseIncomeForm.formState.isSubmitting}>
                    Guardar
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          ) : (
            <Form {...transferForm}>
              <form onSubmit={transferForm.handleSubmit(onSubmitTransfer)} className="flex flex-col gap-4 pt-2">
                <FormField
                  control={transferForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Descripción</FormLabel>
                      <FormControl>
                        <Input placeholder="Ej: Ahorro mensual" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={transferForm.control}
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

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={transferForm.control}
                    name="fromAccountId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Desde</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Cuenta origen" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {accounts?.map((account) => (
                              <SelectItem key={account.id} value={account.id}>
                                {account.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={transferForm.control}
                    name="toAccountId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Hacia</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Cuenta destino" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {accounts?.map((account) => (
                              <SelectItem key={account.id} value={account.id}>
                                {account.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className={needsToAmount ? 'grid grid-cols-2 gap-4' : ''}>
                  <FormField
                    control={transferForm.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{needsToAmount ? `Sale (${fromCurrency})` : 'Monto'}</FormLabel>
                        <FormControl>
                          <Input inputMode="decimal" placeholder="0,00" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {needsToAmount && (
                    <FormField
                      control={transferForm.control}
                      name="toAmount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Recibe ({toCurrency})</FormLabel>
                          <FormControl>
                            <Input inputMode="decimal" placeholder="0,00" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>

                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={transferForm.formState.isSubmitting}>
                    Guardar
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
