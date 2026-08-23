import type { Category } from '@/domain/entities'

/** Sorts top-level categories first (each followed by its own children) so
 *  the flat, order-sorted list from listCategoriesByKind renders as a tree
 *  in the picker's flat `Select` list. */
export function groupByParent(categories: Category[]): { category: Category; isChild: boolean }[] {
  const topLevel = categories.filter((c) => !c.parentId)
  const result: { category: Category; isChild: boolean }[] = []
  for (const parent of topLevel) {
    result.push({ category: parent, isChild: false })
    for (const child of categories.filter((c) => c.parentId === parent.id)) {
      result.push({ category: child, isChild: true })
    }
  }
  return result
}
