import { describe, it, expect } from 'vitest'
import { mergeCategoryState } from './categoryMerge'
import type { GlobalCategoryState } from './categoryStore'

function state(partial: Partial<GlobalCategoryState>): GlobalCategoryState {
  return { categories: [], categoryMappings: [], budgetAccountRules: [], ...partial }
}

type BudgetAccountRule = GlobalCategoryState['budgetAccountRules'][number]

function rule(normalizedName: string, updatedAt: string, extra: Record<string, unknown> = {}): BudgetAccountRule {
  return { normalizedName, updatedAt, ...extra } as BudgetAccountRule
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

  it('merges rules by LWW and tombstone precedence without regressing categories or mappings in the same call', () => {
    const local = state({
      categories: [
        { id: 'category-shared', name: 'Local category', updatedAt: '2026-01-03T00:00:00.000Z' },
        { id: 'category-local', name: 'Local only', updatedAt: '2026-01-01T00:00:00.000Z' },
      ],
      categoryMappings: [
        { id: 'mapping-shared', substring: 'local', spendExpenseId: 'expense-local', updatedAt: '2026-01-01T00:00:00.000Z' },
      ],
      budgetAccountRules: [
        rule('checking', '2026-01-01T00:00:00.000Z', { statementConvention: 'negativeSpend' }),
        rule('savings', '2026-01-01T00:00:00.000Z', { deletedAt: '2026-01-04T00:00:00.000Z' }),
      ],
    })
    const remote = state({
      categories: [
        { id: 'category-shared', name: 'Remote category', updatedAt: '2026-01-02T00:00:00.000Z' },
        { id: 'category-remote', name: 'Remote only', updatedAt: '2026-01-01T00:00:00.000Z' },
      ],
      categoryMappings: [
        { id: 'mapping-shared', substring: 'remote', spendExpenseId: 'expense-remote', updatedAt: '2026-01-05T00:00:00.000Z' },
        { id: 'mapping-remote', substring: 'remote only', spendExpenseId: 'expense-remote', updatedAt: '2026-01-01T00:00:00.000Z' },
      ],
      budgetAccountRules: [
        rule('checking', '2026-01-03T00:00:00.000Z', { statementConvention: 'positiveSpend' }),
        rule('savings', '2026-01-03T00:00:00.000Z', { statementConvention: 'positiveSpend' }),
        rule('cash', '2026-01-01T00:00:00.000Z', { statementConvention: 'positiveSpend' }),
      ],
    })

    const merged = mergeCategoryState(local, remote)

    expect(merged.categories).toEqual(expect.arrayContaining([
      local.categories[0], local.categories[1], remote.categories[1],
    ]))
    expect(merged.categoryMappings).toEqual(expect.arrayContaining([
      remote.categoryMappings[0], remote.categoryMappings[1],
    ]))
    expect(merged.budgetAccountRules).toEqual(expect.arrayContaining([
      remote.budgetAccountRules[0], local.budgetAccountRules[1], remote.budgetAccountRules[2],
    ]))
  })

  it('merges budget account rules by normalized name, with newer remote records winning', () => {
    const a = state({ budgetAccountRules: [rule('checking', '2024-01-01T00:00:00.000Z', { sign: 1 })] })
    const b = state({ budgetAccountRules: [rule('checking', '2024-01-02T00:00:00.000Z', { sign: -1 })] })

    expect(mergeCategoryState(a, b).budgetAccountRules).toEqual([
      rule('checking', '2024-01-02T00:00:00.000Z', { sign: -1 }),
    ])
  })

  it('keeps the local budget account rule on an equal timestamp', () => {
    const a = state({ budgetAccountRules: [rule('checking', '2024-01-01T00:00:00.000Z', { sign: 1 })] })
    const b = state({ budgetAccountRules: [rule('checking', '2024-01-01T00:00:00.000Z', { sign: -1 })] })

    expect(mergeCategoryState(a, b).budgetAccountRules).toEqual([
      rule('checking', '2024-01-01T00:00:00.000Z', { sign: 1 }),
    ])
  })

  it('keeps a newer budget account rule tombstone over an older live rule from either side', () => {
    const tombstone = rule('checking', '2024-01-01T00:00:00.000Z', {
      sign: 1,
      deletedAt: '2024-01-03T00:00:00.000Z',
    })
    const live = rule('checking', '2024-01-02T00:00:00.000Z', { sign: -1 })

    expect(mergeCategoryState(state({ budgetAccountRules: [tombstone] }), state({ budgetAccountRules: [live] })).budgetAccountRules).toEqual([
      tombstone,
    ])
    expect(mergeCategoryState(state({ budgetAccountRules: [live] }), state({ budgetAccountRules: [tombstone] })).budgetAccountRules).toEqual([
      tombstone,
    ])
  })

  it('passes through budget account rules present on only one side', () => {
    const aOnly = rule('checking', '2024-01-01T00:00:00.000Z', { sign: 1 })
    const bOnly = rule('savings', '2024-01-02T00:00:00.000Z', { sign: -1 })

    expect(mergeCategoryState(state({ budgetAccountRules: [aOnly] }), state({ budgetAccountRules: [bOnly] })).budgetAccountRules).toEqual([
      aOnly,
      bOnly,
    ])
  })

  it('treats malformed or missing budget account rule arrays as empty', () => {
    const valid = rule('checking', '2024-01-01T00:00:00.000Z', { sign: 1 })
    const malformed = state({ budgetAccountRules: undefined as unknown as BudgetAccountRule[] })
    const missing = { categories: [], categoryMappings: [] } as GlobalCategoryState

    expect(mergeCategoryState(malformed, state({ budgetAccountRules: [valid] })).budgetAccountRules).toEqual([valid])
    expect(mergeCategoryState(state({ budgetAccountRules: [valid] }), missing).budgetAccountRules).toEqual([valid])
  })
})
