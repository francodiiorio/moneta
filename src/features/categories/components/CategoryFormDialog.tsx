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
import type { Category } from '@/domain/entities'
import { useCategories } from '../hooks/useCategories'
import { createCategoryFromForm, updateCategoryFromForm } from '../service'
import { categoryFormSchema, type CategoryFormValues } from '../schema'

const NO_PARENT = '__none__'

interface CategoryFormDialogProps {
  open: boolean
  category: Category | undefined
  defaultKind: Category['kind']
  onOpenChange: (open: boolean) => void
}

function defaultValues(kind: Category['kind']): CategoryFormValues {
  return { name: '', kind, parentId: '' }
}

export function CategoryFormDialog({ open, category, defaultKind, onOpenChange }: CategoryFormDialogProps) {
  const categories = useCategories()
  const isEditing = !!category

  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: defaultValues(defaultKind),
  })

  useEffect(() => {
    if (!open) return
    form.reset(
      category
        ? { name: category.name, kind: category.kind, parentId: category.parentId ?? '' }
        : defaultValues(defaultKind),
    )
    // Keyed on category?.id (a stable primitive), not the live-query-derived
    // `category` object, so a background refetch of the same category doesn't
    // reset an in-progress edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, category?.id, defaultKind, form])

  const kind = form.watch('kind')
  const parentOptions =
    categories?.filter((c) => c.kind === kind && !c.parentId && !c.isArchived && c.id !== category?.id) ?? []

  async function onSubmit(values: CategoryFormValues) {
    try {
      if (isEditing) {
        await updateCategoryFromForm(category.id, values)
        toast.success('Categoría actualizada')
      } else {
        await createCategoryFromForm(values)
        toast.success('Categoría creada')
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la categoría')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar categoría' : 'Nueva categoría'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Sólo se puede cambiar el nombre — el tipo y la categoría padre quedan fijos.'
              : 'Agregá una categoría de gasto o ingreso.'}
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
                    <Input placeholder="Ej: Comida" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="kind"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(next) => {
                      field.onChange(next)
                      // A category chosen as parent before the type switch may no
                      // longer be valid (a subcategory must match its parent's tipo).
                      form.setValue('parentId', '')
                    }}
                    disabled={isEditing}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="expense">Gasto</SelectItem>
                      <SelectItem value="income">Ingreso</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="parentId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Categoría padre (opcional)</FormLabel>
                  <Select
                    value={field.value === '' ? NO_PARENT : field.value}
                    onValueChange={(v) => field.onChange(v === NO_PARENT ? '' : v)}
                    disabled={isEditing}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_PARENT}>Ninguna (categoría principal)</SelectItem>
                      {parentOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
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
