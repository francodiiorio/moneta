import { db } from '../db'
import type { Category } from '@/domain/entities'
import { generateId } from '@/lib/ids'

export interface CreateCategoryInput {
  name: string
  kind: Category['kind']
  parentId?: string
  color?: string
  icon?: string
}

export async function listCategories(): Promise<Category[]> {
  return db.categories.orderBy('order').toArray()
}

export async function createCategory(input: CreateCategoryInput): Promise<Category> {
  const now = new Date().toISOString()
  return db.transaction('rw', db.categories, async () => {
    const maxOrder = await db.categories.orderBy('order').last()
    const category: Category = {
      id: generateId(),
      name: input.name,
      kind: input.kind,
      order: (maxOrder?.order ?? -1) + 1,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
      ...(input.parentId !== undefined && { parentId: input.parentId }),
      ...(input.color !== undefined && { color: input.color }),
      ...(input.icon !== undefined && { icon: input.icon }),
    }
    await db.categories.add(category)
    return category
  })
}
