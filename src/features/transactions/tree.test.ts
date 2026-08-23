import { describe, expect, it } from 'vitest'
import type { Category } from '@/domain/entities'
import { groupByParent } from './tree'

function cat(id: string, name: string, parentId?: string): Category {
  const now = new Date().toISOString()
  return {
    id,
    name,
    kind: 'expense',
    order: 0,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    ...(parentId !== undefined && { parentId }),
  }
}

describe('groupByParent', () => {
  it('interleaves each parent with its own children, in list order', () => {
    const categories = [
      cat('p1', 'Comida'),
      cat('c1', 'Restaurantes', 'p1'),
      cat('p2', 'Transporte'),
      cat('c2', 'Nafta', 'p2'),
      cat('c3', 'Colectivo', 'p2'),
    ]

    const result = groupByParent(categories)

    expect(result.map((r) => [r.category.name, r.isChild])).toEqual([
      ['Comida', false],
      ['Restaurantes', true],
      ['Transporte', false],
      ['Nafta', true],
      ['Colectivo', true],
    ])
  })

  it('handles a flat list with no hierarchy', () => {
    const categories = [cat('p1', 'Comida'), cat('p2', 'Transporte')]
    expect(groupByParent(categories).every((r) => !r.isChild)).toBe(true)
  })

  it('drops an orphaned child whose parent is not in the list', () => {
    // e.g. the parent was filtered out upstream (different kind/archived) —
    // the picker should never show a dangling child with no parent header.
    const categories = [cat('c1', 'Restaurantes', 'missing-parent')]
    expect(groupByParent(categories)).toEqual([])
  })
})
