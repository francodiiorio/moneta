import { useState } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Category } from '@/domain/entities'
import { useCategories } from '../hooks/useCategories'
import { createCategoryQuick } from '../service'

const NEW_CATEGORY_VALUE = '__new__'

interface CategoryFieldProps {
  kind: Category['kind']
  value: string
  onChange: (categoryId: string) => void
}

/** Category select with an inline "+ Nueva categoría" option — full
 *  category management (edit, archive, hierarchy) is a future stage;
 *  this is just enough to not block creating a transaction. */
export function CategoryField({ kind, value, onChange }: CategoryFieldProps) {
  const categories = useCategories(kind)
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  async function handleCreate() {
    const name = newName.trim()
    if (!name) return
    setIsSaving(true)
    try {
      const category = await createCategoryQuick(name, kind)
      onChange(category.id)
      setIsCreating(false)
      setNewName('')
    } catch {
      toast.error('No se pudo crear la categoría')
    } finally {
      setIsSaving(false)
    }
  }

  if (isCreating) {
    return (
      <div className="flex gap-2">
        <Input
          autoFocus
          placeholder="Nombre de la categoría"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void handleCreate()
            }
            if (e.key === 'Escape') setIsCreating(false)
          }}
        />
        <Button type="button" size="sm" onClick={() => void handleCreate()} disabled={isSaving}>
          Crear
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setIsCreating(false)}>
          Cancelar
        </Button>
      </div>
    )
  }

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next === NEW_CATEGORY_VALUE) {
          setIsCreating(true)
          return
        }
        onChange(next)
      }}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Elegí una categoría" />
      </SelectTrigger>
      <SelectContent>
        {categories?.map((category) => (
          <SelectItem key={category.id} value={category.id}>
            {category.name}
          </SelectItem>
        ))}
        <SelectItem value={NEW_CATEGORY_VALUE}>+ Nueva categoría</SelectItem>
      </SelectContent>
    </Select>
  )
}
