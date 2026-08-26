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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { InstallmentPlan } from '@/domain/entities'
import { useAccounts } from '../hooks/useAccounts'
import { useExpenseCategories } from '../hooks/useExpenseCategories'
import { updateInstallmentPlanFromForm } from '../service'
import { installmentPlanEditFormSchema, type InstallmentPlanEditFormValues } from '../schema'

interface InstallmentPlanEditDialogProps {
  /** null while closed; the plan being edited while open. */
  plan: InstallmentPlan | null
  onOpenChange: (open: boolean) => void
}

function planToFormValues(plan: InstallmentPlan): InstallmentPlanEditFormValues {
  return { description: plan.description, accountId: plan.accountId, categoryId: plan.categoryId }
}

/**
 * Deliberately narrower than InstallmentPlanFormDialog: only description,
 * cuenta y categoría son editables — ver
 * installmentPlans.repo.ts:updateInstallmentPlan para por qué el monto
 * total, la cantidad de cuotas y las fechas quedan fijas después de crear
 * la compra (para eso hay que borrarla y cargarla de nuevo).
 */
export function InstallmentPlanEditDialog({ plan, onOpenChange }: InstallmentPlanEditDialogProps) {
  const accounts = useAccounts()
  const categories = useExpenseCategories()
  // The plan's own scheduleCache amounts are frozen in its original
  // currency — offering a different-currency account would silently make
  // updateInstallmentPlan reject the edit, so it never shows up as an option.
  const accountOptions = accounts?.filter((a) => a.currency === plan?.currency)

  const form = useForm<InstallmentPlanEditFormValues>({
    resolver: zodResolver(installmentPlanEditFormSchema),
    defaultValues: { description: '', accountId: '', categoryId: '' },
  })

  useEffect(() => {
    if (plan) form.reset(planToFormValues(plan))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.id])

  async function onSubmit(values: InstallmentPlanEditFormValues) {
    if (!plan) return
    try {
      await updateInstallmentPlanFromForm(plan.id, values)
      toast.success('Compra en cuotas actualizada')
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar la compra en cuotas')
    }
  }

  return (
    <Dialog open={!!plan} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar compra en cuotas</DialogTitle>
          <DialogDescription>
            Las cuotas ya confirmadas quedan igual — el cambio rige para las que todavía no se
            confirmaron. El monto total y la cantidad de cuotas no se pueden editar.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: Notebook" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
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
                      {accountOptions?.map((account) => (
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
              control={form.control}
              name="categoryId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Categoría</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Elegí una categoría" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {categories?.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
