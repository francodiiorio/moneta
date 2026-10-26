import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useDialogSession } from '@/components/useDialogSession'
import { formatAmountInput } from '@/domain/money'
import type { MonthStamp } from '@/lib/dates'
import { editBudgetFromForm, type BudgetProgressItem } from '../service'
import { budgetEditFormSchema, type BudgetEditFormValues } from '../schema'

interface BudgetEditDialogProps {
  /** The budget being edited; the dialog is open while set. */
  item: BudgetProgressItem | undefined
  /** Where the change starts by default: the month being browsed. */
  defaultStartsOn: MonthStamp
  onOpenChange: (open: boolean) => void
}

export function BudgetEditDialog({ item, defaultStartsOn, onOpenChange }: BudgetEditDialogProps) {
  // Keeps the content through the close animation; a fresh form per open.
  const session = useDialogSession(item && { item, defaultStartsOn })
  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent>
        {session && (
          <EditForm
            key={session.key}
            item={session.value.item}
            defaultStartsOn={session.value.defaultStartsOn}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function EditForm({ item, defaultStartsOn, onClose }: { item: BudgetProgressItem; defaultStartsOn: MonthStamp; onClose: () => void }) {
  const form = useForm<BudgetEditFormValues>({
    resolver: zodResolver(budgetEditFormSchema),
    defaultValues: { amount: formatAmountInput(item.progress.budget), startsOn: defaultStartsOn },
  })

  async function onSubmit(values: BudgetEditFormValues) {
    try {
      await editBudgetFromForm(item, values)
      toast.success('Presupuesto actualizado')
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar el presupuesto')
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Editar presupuesto de {item.categoryName}</DialogTitle>
        <DialogDescription>
          El monto nuevo rige desde el mes que elijas. Los meses anteriores conservan el monto que tenían.
        </DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Monto {item.period === 'monthly' ? 'mensual' : 'anual'}</FormLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder="0,00" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="startsOn"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Desde</FormLabel>
                  <FormControl>
                    <Input type="month" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </>
  )
}
