import { db } from '../db'
import type { Category } from '@/domain/entities'
import { generateId } from '@/lib/ids'
import { invariant } from '@/lib/invariant'

export interface CreateCategoryInput {
  name: string
  kind: Category['kind']
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

const DEFAULT_CATEGORIES: Array<{ name: string; kind: Category['kind'] }> = [
  { name: 'Comida', kind: 'expense' },
  { name: 'Transporte', kind: 'expense' },
  { name: 'Vivienda', kind: 'expense' },
  { name: 'Salud', kind: 'expense' },
  { name: 'Entretenimiento', kind: 'expense' },
  { name: 'Ropa', kind: 'expense' },
  { name: 'Educación', kind: 'expense' },
  { name: 'Otros', kind: 'expense' },
  { name: 'Sueldo', kind: 'income' },
  { name: 'Freelance', kind: 'income' },
  { name: 'Inversiones', kind: 'income' },
  { name: 'Otros', kind: 'income' },
]

export async function listCategories(): Promise<Category[]> {
  return db.categories.orderBy('order').toArray()
}

/** Id literal, no generateId() — es la única forma de reencontrar esta
 *  categoría que sobrevive a que el usuario la renombre (buscar por
 *  nombre no: DEFAULT_CATEGORIES ya siembra una "Inversiones" propia,
 *  de kind 'income', con la que un lookup por nombre chocaría). */
export const INVESTMENT_CATEGORY_ID = 'category-investment-purchases'
export const INVESTMENT_CATEGORY_NAME = 'Compra de inversiones'

/** Contrapartida fija de toda compra de inversión pagada desde una
 *  cuenta (domain/ledger:buildInvestmentPurchase). Nace archivada para
 *  no aparecer en el selector de categorías de un Gasto manual ni en el
 *  de Presupuestos (los dos filtran `!isArchived`) — sí en el filtro de
 *  Movimientos, que no filtra archivadas, justo donde conviene poder
 *  encontrar estas compras. No pasa por createCategory() porque esa
 *  fuerza `isArchived: false`. Ver ADR "Una compra de inversión no es un
 *  gasto" en docs/DECISIONS.md. */
export async function getOrCreateInvestmentCategory(): Promise<Category> {
  return db.transaction('rw', db.categories, async () => {
    const existing = await db.categories.get(INVESTMENT_CATEGORY_ID)
    if (existing) return existing

    const now = new Date().toISOString()
    const maxOrder = await db.categories.orderBy('order').last()
    const category: Category = {
      id: INVESTMENT_CATEGORY_ID,
      name: INVESTMENT_CATEGORY_NAME,
      kind: 'expense',
      order: (maxOrder?.order ?? -1) + 1,
      isArchived: true,
      createdAt: now,
      updatedAt: now,
    }
    await db.categories.add(category)
    return category
  })
}

async function assertValidParent(parentId: string | undefined, kind: Category['kind']): Promise<void> {
  if (!parentId) return
  const parent = await db.categories.get(parentId)
  invariant(parent, `Categoría padre no encontrada: ${parentId}`)
  invariant(
    !parent.parentId,
    `"${parent.name}" ya es una subcategoría — sólo se admite un nivel de jerarquía`,
  )
  invariant(
    parent.kind === kind,
    `"${parent.name}" es de otro tipo — una subcategoría debe ser del mismo tipo que su padre`,
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
      // shown as archived) and the transaction category picker, with no UI
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

/** Swaps `order` with the adjacent sibling (same `kind` + `parentId`, active only).
 *  No-op if `id` is already at that end of its sibling group. */
export async function moveCategory(id: string, direction: 'up' | 'down'): Promise<void> {
  await db.transaction('rw', db.categories, async () => {
    const category = await db.categories.get(id)
    invariant(category, `Categoría no encontrada: ${id}`)

    const siblings = (await db.categories.toArray())
      .filter((c) => c.kind === category.kind && c.parentId === category.parentId && !c.isArchived)
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
    const categories: Category[] = DEFAULT_CATEGORIES.map((def, index) => ({
      id: generateId(),
      name: def.name,
      kind: def.kind,
      order: index,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    }))
    await db.categories.bulkAdd(categories)
  })
}
