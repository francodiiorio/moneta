import { toast } from 'sonner'
import { ArchiveRestore, ChevronDown, ChevronUp, Pencil, Archive as ArchiveIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CategoryIcon } from '@/components/CategoryIcon'
import type { Category } from '@/domain/entities'
import { moveCategory, setCategoryArchived } from '../service'
import { useCategoriesUiStore } from '../store'
import { groupCategoriesByParent } from '../tree'

interface CategoryTreeProps {
  categories: Category[]
  onEdit: (categoryId: string) => void
}

async function handleArchive(id: string, isArchived: boolean) {
  try {
    await setCategoryArchived(id, isArchived)
    toast.success(isArchived ? 'Categoría archivada' : 'Categoría restaurada')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'No se pudo actualizar la categoría')
  }
}

async function handleMove(id: string, direction: 'up' | 'down') {
  try {
    await moveCategory(id, direction)
  } catch {
    toast.error('No se pudo reordenar la categoría')
  }
}

interface RowProps {
  category: Category
  indent?: boolean
  onEdit: (id: string) => void
}

function CategoryRow({ category, indent, onEdit }: RowProps) {
  return (
    <div className={`flex items-center gap-2 border-b border-border py-2 last:border-b-0 ${indent ? 'pl-6' : ''}`}>
      <CategoryIcon icon={category.icon} color={category.color} size="sm" />
      <p className="min-w-0 flex-1 truncate text-sm">{category.name}</p>
      <Button variant="ghost" size="icon" className="size-7" onClick={() => void handleMove(category.id, 'up')}>
        <ChevronUp className="size-4" />
      </Button>
      <Button variant="ghost" size="icon" className="size-7" onClick={() => void handleMove(category.id, 'down')}>
        <ChevronDown className="size-4" />
      </Button>
      <Button variant="ghost" size="icon" className="size-7" onClick={() => onEdit(category.id)}>
        <Pencil className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        onClick={() => void handleArchive(category.id, true)}
      >
        <ArchiveIcon className="size-3.5" />
      </Button>
    </div>
  )
}

export function CategoryTree({ categories, onEdit }: CategoryTreeProps) {
  const showArchived = useCategoriesUiStore((s) => s.showArchived)
  const toggleShowArchived = useCategoriesUiStore((s) => s.toggleShowArchived)

  const tree = groupCategoriesByParent(categories.filter((c) => !c.isArchived))
  const archived = categories.filter((c) => c.isArchived).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border px-3">
        {tree.map(({ category: parent, children }) => (
          <div key={parent.id}>
            <CategoryRow category={parent} onEdit={onEdit} />
            {children.map((child) => (
              <CategoryRow key={child.id} category={child} indent onEdit={onEdit} />
            ))}
          </div>
        ))}
      </div>

      {archived.length > 0 && (
        <div>
          <Button variant="ghost" size="sm" onClick={toggleShowArchived}>
            {showArchived ? 'Ocultar' : 'Mostrar'} archivadas ({archived.length})
          </Button>
          {showArchived && (
            <div className="mt-2 rounded-xl border border-dashed border-border px-3">
              {archived.map((category) => (
                <div key={category.id} className="flex items-center gap-2 border-b border-border py-2 last:border-b-0">
                  <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{category.name}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleArchive(category.id, false)}
                  >
                    <ArchiveRestore className="size-3.5" />
                    Restaurar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
