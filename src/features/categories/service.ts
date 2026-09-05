import { categoriesRepo } from '@/database/repositories'
import type { Category } from '@/domain/entities'
import type { CategoryFormValues } from './schema'

export { listCategories, setCategoryArchived, moveCategory } from '@/database/repositories/categories.repo'

export async function createCategoryFromForm(values: CategoryFormValues): Promise<Category> {
  return categoriesRepo.createCategory({
    name: values.name,
    ...(values.parentId && { parentId: values.parentId }),
    ...(values.color && { color: values.color }),
    ...(values.icon && { icon: values.icon }),
  })
}

export async function updateCategoryFromForm(id: string, values: CategoryFormValues): Promise<void> {
  // Unlike create, always sends color/icon (even '' → undefined) rather
  // than omitting them when unset — editing has to be able to clear a
  // previously-chosen one, not just leave the old one in place.
  await categoriesRepo.updateCategory(id, {
    name: values.name,
    color: values.color || undefined,
    icon: values.icon || undefined,
  })
}
