import type { Category } from '@/domain/entities'

export interface CategoryNode {
  category: Category
  children: Category[]
}

/** Groups a flat category list into top-level nodes with their children
 *  attached, each list sorted by `order` — the shared shape both the
 *  management tree and the transaction category picker render from. */
export function groupCategoriesByParent(categories: Category[]): CategoryNode[] {
  const topLevel = categories.filter((c) => !c.parentId).sort((a, b) => a.order - b.order)
  return topLevel.map((parent) => ({
    category: parent,
    children: categories
      .filter((c) => c.parentId === parent.id)
      .sort((a, b) => a.order - b.order),
  }))
}
