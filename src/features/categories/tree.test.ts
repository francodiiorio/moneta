import { describe, expect, it } from 'vitest'
import type { Category } from '@/domain/entities'
import { groupCategoriesByParent } from './tree'

function cat(id: string, name: string, order: number, parentId?: string): Category {
  const now = new Date().toISOString()
  return {
    id,
    name,
    kind: 'expense',
    order,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    ...(parentId !== undefined && { parentId }),
  }
}

describe('groupCategoriesByParent', () => {
  it('nests children under their parent, both sorted by order', () => {
    const categories = [
      cat('c2', 'Colectivo', 1, 'p2'),
      cat('p2', 'Transporte', 1),
      cat('c1', 'Restaurantes', 0, 'p1'),
      cat('p1', 'Comida', 0),
      cat('c3', 'Nafta', 0, 'p2'),
    ]

    const tree = groupCategoriesByParent(categories)

    expect(tree.map((n) => n.category.name)).toEqual(['Comida', 'Transporte'])
    expect(tree[0]?.children.map((c) => c.name)).toEqual(['Restaurantes'])
    expect(tree[1]?.children.map((c) => c.name)).toEqual(['Nafta', 'Colectivo'])
  })

  it('gives a parent with no children an empty array, not undefined', () => {
    const tree = groupCategoriesByParent([cat('p1', 'Comida', 0)])
    expect(tree).toHaveLength(1)
    expect(tree[0]?.category.name).toBe('Comida')
    expect(tree[0]?.children).toEqual([])
  })

  it('excludes an orphaned child whose parent is not in the list', () => {
    const tree = groupCategoriesByParent([cat('c1', 'Restaurantes', 0, 'missing-parent')])
    expect(tree).toEqual([])
  })
})
