import { categoriesRepo } from '@/database/repositories'
import type { Category } from '@/domain/entities'
import type { CategoryFormValues } from './schema'

export { listCategories, setCategoryArchived, moveCategory } from '@/database/repositories/categories.repo'

export async function createCategoryFromForm(values: CategoryFormValues): Promise<Category> {
  return categoriesRepo.createCategory({
    name: values.name,
    kind: values.kind,
    ...(values.parentId && { parentId: values.parentId }),
  })
}

export async function updateCategoryFromForm(id: string, values: CategoryFormValues): Promise<void> {
  await categoriesRepo.updateCategory(id, { name: values.name })
}
