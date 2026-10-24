import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Button } from '@/components/ui/button'
import { DateField } from '@/components/DateField'
import { formatMonthLabel, type MonthStamp } from '@/lib/dates'
import { statementDatesFormSchema, type StatementDatesFormValues } from '../schema'
import { correctStatementDates, resetStatementDates, type StatementView } from '../service'

interface StatementDatesDialogProps {
  cardId: string
  statement: StatementView | undefined
  onOpenChange: (open: boolean) => void
}

function movedMessage(moved: number): string {
  if (moved === 0) return ''
  return moved === 1 ? ' · 1 gasto cambió de resumen' : ` · ${moved} gastos cambiaron de resumen`
}

export function StatementDatesDialog({ cardId, statement, onOpenChange }: StatementDatesDialogProps) {
  const form = useForm<StatementDatesFormValues>({
    resolver: zodResolver(statementDatesFormSchema),
    defaultValues: { closeDate: '', dueDate: '' },
  })

  useEffect(() => {
    if (statement) form.reset({ closeDate: statement.closeDate, dueDate: statement.dueDate })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statement?.period])

  async function run(action: () => Promise<number>, label: string) {
    try {
      const moved = await action()
      toast.success(`${label}${movedMessage(moved)}`)
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron guardar las fechas')
    }
  }

  const period: MonthStamp | undefined = statement?.period

  return (
    <Dialog open={!!statement} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fechas del resumen de {period ? formatMonthLabel(period).toLowerCase() : ''}</DialogTitle>
          <DialogDescription>
            Si el banco publicó otras fechas para este mes, cargalas acá. Los gastos que estaban en este resumen o en el
            siguiente por fecha se reacomodan solos; los que moviste a mano se quedan donde están.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) =>
              period ? run(() => correctStatementDates(cardId, period, values), 'Fechas corregidas') : undefined,
            )}
            className="flex flex-col gap-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="closeDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cierre</FormLabel>
                    <FormControl>
                      <DateField value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dueDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vencimiento</FormLabel>
                    <FormControl>
                      <DateField value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter className="sm:justify-between">
              {statement?.isCorrected ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => (period ? void run(() => resetStatementDates(cardId, period), 'Volvió a los días de la tarjeta') : undefined)}
                >
                  Volver a los días de la tarjeta
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  Guardar
                </Button>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
