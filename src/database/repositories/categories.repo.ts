import { db } from '../db'
import type { Category, CategoryKind } from '@/domain/entities'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'

export interface CreateCategoryInput {
  name: string
  kind: CategoryKind
  parentId?: string
  color?: string
  icon?: string
}

/** `color`/`icon` explicitly allow `undefined` (unlike the entity's own
 *  `?:` optional fields) so a caller can clear a previously-set one —
 *  `db.categories.update()` only touches keys actually present in the
 *  patch, so omitting a key leaves the stored value alone, while including
 *  it as `undefined` genuinely blanks it. */
export interface UpdateCategoryInput {
  name?: string
  color?: string | undefined
  icon?: string | undefined
}

const DEFAULT_CATEGORIES: readonly string[] = [
  'Comida',
  'Transporte',
  'Vivienda',
  'Salud',
  'Entretenimiento',
  'Ropa',
  'Educación',
  'Otros',
]

const DEFAULT_INCOME_CATEGORIES: readonly string[] = ['Sueldo', 'Otros ingresos']

export async function listCategories(): Promise<Category[]> {
  return db.categories.orderBy('order').toArray()
}

/** Active categories of one kind only — an archived one can't be picked
 *  for a new gasto/ingreso, presupuesto, plan or import mapping (a past
 *  record that already used one still shows its name via
 *  `listCategories`, unfiltered). `kind` is explicit, never defaulted: a
 *  gasto picker offering income categories (or vice versa) is exactly the
 *  bug this parameter exists to prevent. */
export async function listActiveCategories(kind: CategoryKind): Promise<Category[]> {
  return (await listCategories()).filter((c) => !c.isArchived && c.kind === kind)
}

async function assertValidParent(parentId: string | undefined, kind: CategoryKind): Promise<void> {
  if (!parentId) return
  const parent = await db.categories.get(parentId)
  invariant(parent, `Categoría padre no encontrada: ${parentId}`)
  invariant(parent.kind === kind, 'Una subcategoría tiene que ser del mismo tipo (gasto/ingreso) que su padre')
  invariant(
    !parent.parentId,
    `"${parent.name}" ya es una subcategoría — sólo se admite un nivel de jerarquía`,
  )
}

export async function createCategory(input: CreateCategoryInput): Promise<Category> {
  const now = new Date().toISOString()
  return db.transaction('rw', db.categories, async () => {
    await assertValidParent(input.parentId, input.kind)
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

export async function updateCategory(id: string, patch: UpdateCategoryInput): Promise<void> {
  await db.categories.update(id, { ...patch, updatedAt: new Date().toISOString() })
}

export async function setCategoryArchived(id: string, isArchived: boolean): Promise<void> {
  await db.transaction('rw', db.categories, async () => {
    if (isArchived) {
      // Archiving a parent would strand its active children: they'd vanish
      // from both the management tree (never rendered as top-level, never
      // shown as archived) and the expense category picker, with no UI
      // path back. Archive the children first, or reassign them.
      const activeChildren = await db.categories.where('parentId').equals(id).toArray()
      invariant(
        activeChildren.every((c) => c.isArchived),
        'Esta categoría tiene subcategorías activas — archivalas primero',
      )
    }
    await db.categories.update(id, { isArchived, updatedAt: new Date().toISOString() })
  })
}

/** Swaps `order` with the adjacent sibling (same `parentId` and `kind`,
 *  active only). No-op if `id` is already at that end of its sibling
 *  group. `kind` matters: top-level gasto and ingreso categories share
 *  `parentId: undefined`, and each tab of the management page only shows
 *  one kind — swapping across them would reorder something invisible. */
export async function moveCategory(id: string, direction: 'up' | 'down'): Promise<void> {
  await db.transaction('rw', db.categories, async () => {
    const category = await db.categories.get(id)
    invariant(category, `Categoría no encontrada: ${id}`)

    const siblings = (await db.categories.toArray())
      .filter((c) => c.parentId === category.parentId && c.kind === category.kind && !c.isArchived)
      .sort((a, b) => a.order - b.order)

    const index = siblings.findIndex((c) => c.id === id)
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= siblings.length) return

    const sibling = siblings[swapIndex]!
    const currentOrder = category.order
    await db.categories.update(category.id, { order: sibling.order })
    await db.categories.update(sibling.id, { order: currentOrder })
  })
}

/** Seeds a starter set of Spanish categories exactly once, only when the
 *  table is empty — never runs again once the user has any category
 *  (created by hand or from a prior seed), so it can't duplicate. */
export async function seedDefaultsIfEmpty(): Promise<void> {
  await db.transaction('rw', db.categories, async () => {
    const count = await db.categories.count()
    if (count > 0) return

    const now = new Date().toISOString()
    const categories: Category[] = DEFAULT_CATEGORIES.map((name, index) => ({
      id: generateId(),
      name,
      kind: 'expense',
      order: index,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    }))
    await db.categories.bulkAdd(categories)
  })
}

/** Seeds the starter income categories once, when there's no income
 *  category at all (archived ones count) — covers both a brand-new
 *  database and one upgraded from version 4, where the Etapa 7 migration
 *  had deleted every income category. Same never-duplicates guarantee as
 *  `seedDefaultsIfEmpty`. */
export async function seedIncomeDefaultsIfNone(): Promise<void> {
  await db.transaction('rw', db.categories, async () => {
    const count = await db.categories.where('kind').equals('income').count()
    if (count > 0) return

    const now = new Date().toISOString()
    const maxOrder = await db.categories.orderBy('order').last()
    const start = (maxOrder?.order ?? -1) + 1
    const categories: Category[] = DEFAULT_INCOME_CATEGORIES.map((name, index) => ({
      id: generateId(),
      name,
      kind: 'income',
      order: start + index,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    }))
    await db.categories.bulkAdd(categories)
  })
}
