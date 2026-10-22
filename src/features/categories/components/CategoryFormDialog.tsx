import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Tag } from 'lucide-react'
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
import { CategoryIcon } from '@/components/CategoryIcon'
import { CATEGORY_COLOR_OPTIONS, CATEGORY_ICON_OPTIONS } from '@/components/categoryOptions'
import type { Category } from '@/domain/entities'
import { cn } from '@/lib/cn'
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
  return { name: '', kind, parentId: '', color: '', icon: '' }
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
        ? {
            name: category.name,
            kind: category.kind,
            parentId: category.parentId ?? '',
            color: category.color ?? '',
            icon: category.icon ?? '',
          }
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
  const selectedColor = form.watch('color')
  const selectedIcon = form.watch('icon')

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
              ? 'El tipo y la categoría padre quedan fijos — el resto se puede cambiar.'
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

            <div className="flex items-center gap-3">
              <CategoryIcon icon={selectedIcon || undefined} color={selectedColor || undefined} />
              <span className="text-sm text-muted-foreground">Así se va a ver en Movimientos.</span>
            </div>

            <FormField
              control={form.control}
              name="color"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Color (opcional)</FormLabel>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      aria-label="Sin color"
                      title="Sin color"
                      onClick={() => field.onChange('')}
                      className={cn(
                        'flex size-7 items-center justify-center rounded-full border-2',
                        field.value === '' ? 'border-foreground' : 'border-transparent',
                      )}
                    >
                      <span className="size-5 rounded-full bg-muted" />
                    </button>
                    {CATEGORY_COLOR_OPTIONS.map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        aria-label={label}
                        title={label}
                        onClick={() => field.onChange(value)}
                        className={cn(
                          'size-7 rounded-full border-2',
                          field.value === value ? 'border-foreground' : 'border-transparent',
                        )}
                        style={{ backgroundColor: value }}
                      />
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="icon"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ícono (opcional)</FormLabel>
                  <div className="grid max-h-40 grid-cols-6 gap-1 overflow-y-auto rounded-lg border border-border p-2">
                    <button
                      type="button"
                      aria-label="Sin ícono"
                      title="Sin ícono"
                      onClick={() => field.onChange('')}
                      className={cn(
                        'flex items-center justify-center rounded-md p-2 hover:bg-muted',
                        field.value === '' && 'bg-muted ring-2 ring-primary',
                      )}
                    >
                      <Tag className="size-4 text-muted-foreground" />
                    </button>
                    {CATEGORY_ICON_OPTIONS.map(({ key, label, icon: Icon }) => (
                      <button
                        key={key}
                        type="button"
                        aria-label={label}
                        title={label}
                        onClick={() => field.onChange(key)}
                        className={cn(
                          'flex items-center justify-center rounded-md p-2 hover:bg-muted',
                          field.value === key && 'bg-muted ring-2 ring-primary',
                        )}
                      >
                        <Icon className="size-4" />
                      </button>
                    ))}
                  </div>
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
