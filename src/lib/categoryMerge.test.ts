import { describe, it, expect } from 'vitest'
import { mergeCategoryState } from './categoryMerge'
import type { GlobalCategoryState } from './categoryStore'

function state(partial: Partial<GlobalCategoryState>): GlobalCategoryState {
  return { categories: [], categoryMappings: [], ...partial }
}

describe('mergeCategoryState', () => {
  it('same id, a newer updatedAt -> a wins', () => {
    const a = state({ categories: [{ id: 'c1', name: 'A-name', updatedAt: '2024-01-02T00:00:00.000Z' }] })
    const b = state({ categories: [{ id: 'c1', name: 'B-name', updatedAt: '2024-01-01T00:00:00.000Z' }] })
    const merged = mergeCategoryState(a, b)
    expect(merged.categories).toEqual([{ id: 'c1', name: 'A-name', updatedAt: '2024-01-02T00:00:00.000Z' }])
  })

  it('same id, b newer updatedAt -> b wins', () => {
    const a = state({ categories: [{ id: 'c1', name: 'A-name', updatedAt: '2024-01-01T00:00:00.000Z' }] })
    const b = state({ categories: [{ id: 'c1', name: 'B-name', updatedAt: '2024-01-02T00:00:00.000Z' }] })
    const merged = mergeCategoryState(a, b)
    expect(merged.categories).toEqual([{ id: 'c1', name: 'B-name', updatedAt: '2024-01-02T00:00:00.000Z' }])
  })

  it('a has deletedAt newer than b bare updatedAt -> tombstoned version wins and stays tombstoned', () => {
    const a = state({
      categories: [
        { id: 'c1', name: 'A-name', updatedAt: '2024-01-01T00:00:00.000Z', deletedAt: '2024-01-05T00:00:00.000Z' },
      ],
    })
    const b = state({ categories: [{ id: 'c1', name: 'B-name', updatedAt: '2024-01-03T00:00:00.000Z' }] })
    const merged = mergeCategoryState(a, b)
    expect(merged.categories).toEqual([
      { id: 'c1', name: 'A-name', updatedAt: '2024-01-01T00:00:00.000Z', deletedAt: '2024-01-05T00:00:00.000Z' },
    ])
  })

  it('equal updatedAt on both sides, no deletedAt -> a wins (tie-break)', () => {
    const a = state({ categories: [{ id: 'c1', name: 'A-name', updatedAt: '2024-01-01T00:00:00.000Z' }] })
    const b = state({ categories: [{ id: 'c1', name: 'B-name', updatedAt: '2024-01-01T00:00:00.000Z' }] })
    const merged = mergeCategoryState(a, b)
    expect(merged.categories).toEqual([{ id: 'c1', name: 'A-name', updatedAt: '2024-01-01T00:00:00.000Z' }])
  })

  it('id only on a, id only on b -> both included untouched', () => {
    const a = state({ categories: [{ id: 'c1', name: 'A-only', updatedAt: '2024-01-01T00:00:00.000Z' }] })
    const b = state({ categories: [{ id: 'c2', name: 'B-only', updatedAt: '2024-01-01T00:00:00.000Z' }] })
    const merged = mergeCategoryState(a, b)
    expect(merged.categories).toEqual(
      expect.arrayContaining([
        { id: 'c1', name: 'A-only', updatedAt: '2024-01-01T00:00:00.000Z' },
        { id: 'c2', name: 'B-only', updatedAt: '2024-01-01T00:00:00.000Z' },
      ])
    )
    expect(merged.categories).toHaveLength(2)
  })

  it('empty vs nonempty -> nonempty side survives fully', () => {
    const a = state({})
    const b = state({
      categories: [
        { id: 'c1', name: 'B1', updatedAt: '2024-01-01T00:00:00.000Z' },
        { id: 'c2', name: 'B2', updatedAt: '2024-01-02T00:00:00.000Z' },
      ],
    })
    const merged = mergeCategoryState(a, b)
    expect(merged.categories).toEqual(b.categories)

    const merged2 = mergeCategoryState(b, a)
    expect(merged2.categories).toEqual(b.categories)
  })

  it('merges both categories and categoryMappings in one call', () => {
    const a = state({
      categories: [
        { id: 'c1', name: 'A-Groceries', updatedAt: '2024-01-05T00:00:00.000Z' },
        { id: 'c3', name: 'A-only-cat', updatedAt: '2024-01-01T00:00:00.000Z' },
      ],
      categoryMappings: [
        { id: 'm1', substring: 'walmart', spendExpenseId: 'exp-1', updatedAt: '2024-01-01T00:00:00.000Z' },
      ],
    })
    const b = state({
      categories: [
        { id: 'c1', name: 'B-Groceries', updatedAt: '2024-01-02T00:00:00.000Z' },
        { id: 'c4', name: 'B-only-cat', updatedAt: '2024-01-01T00:00:00.000Z' },
      ],
      categoryMappings: [
        { id: 'm1', substring: 'walmart-b', spendExpenseId: 'exp-1', updatedAt: '2024-01-09T00:00:00.000Z' },
        { id: 'm2', substring: 'costco', spendExpenseId: 'exp-4', updatedAt: '2024-01-01T00:00:00.000Z' },
      ],
    })
    const merged = mergeCategoryState(a, b)

    expect(merged.categories).toEqual(
      expect.arrayContaining([
        { id: 'c1', name: 'A-Groceries', updatedAt: '2024-01-05T00:00:00.000Z' },
        { id: 'c3', name: 'A-only-cat', updatedAt: '2024-01-01T00:00:00.000Z' },
        { id: 'c4', name: 'B-only-cat', updatedAt: '2024-01-01T00:00:00.000Z' },
      ])
    )
    expect(merged.categories).toHaveLength(3)

    expect(merged.categoryMappings).toEqual(
      expect.arrayContaining([
        { id: 'm1', substring: 'walmart-b', spendExpenseId: 'exp-1', updatedAt: '2024-01-09T00:00:00.000Z' },
        { id: 'm2', substring: 'costco', spendExpenseId: 'exp-4', updatedAt: '2024-01-01T00:00:00.000Z' },
      ])
    )
    expect(merged.categoryMappings).toHaveLength(2)
  })
})
