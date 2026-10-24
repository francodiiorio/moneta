import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { CreditCard } from '@/domain/entities'
import { cardFormSchema, type CardFormValues } from '../schema'
import { createCardFromForm, updateCardFromForm } from '../service'

interface CardFormDialogProps {
  open: boolean
  /** undefined = create mode, defined = editing that card. */
  card: CreditCard | undefined
  onOpenChange: (open: boolean) => void
}

const EMPTY: CardFormValues = { name: '', closingDay: '', dueDay: '', notes: '' }

export function CardFormDialog({ open, card, onOpenChange }: CardFormDialogProps) {
  const form = useForm<CardFormValues>({ resolver: zodResolver(cardFormSchema), defaultValues: EMPTY })

  useEffect(() => {
    if (!open) return
    form.reset(
      card
        ? { name: card.name, closingDay: String(card.closingDay), dueDay: String(card.dueDay), notes: card.notes ?? '' }
        : EMPTY,
    )
    // Keyed on card?.id — a background refetch must not reset an edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, card?.id])

  async function onSubmit(values: CardFormValues) {
    try {
      if (card) {
        const moved = await updateCardFromForm(card.id, values)
        toast.success(
          moved === 0
            ? 'Tarjeta actualizada'
            : `Tarjeta actualizada · ${moved === 1 ? '1 gasto cambió' : `${moved} gastos cambiaron`} de resumen`,
        )
      } else {
        await createCardFromForm(values)
        toast.success('Tarjeta creada')
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la tarjeta')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{card ? 'Editar tarjeta' : 'Nueva tarjeta'}</DialogTitle>
          <DialogDescription>
            Los días en que suele cerrar y vencer el resumen. Si un mes el banco los mueve, lo corregís en ese resumen.
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
                    <Input placeholder="Ej: Visa Galicia" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="closingDay"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Día de cierre</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" placeholder="Ej: 25" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dueDay"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Día de vencimiento</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" placeholder="Ej: 5" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
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
