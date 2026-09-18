import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Portfolio } from './portfolioRegistry'
import { computeSeedFromPortfolio, seedGlobalCategoriesIfNeeded } from './categoryMigration'
import { isGlobalStoreSeeded, markGlobalStoreSeeded, saveGlobalCategoryState } from './categoryPersist'

vi.mock('./categoryPersist', () => ({
  isGlobalStoreSeeded: vi.fn(),
  markGlobalStoreSeeded: vi.fn(),
  saveGlobalCategoryState: vi.fn(),
}))

const portfolio: Portfolio = { id: 'p1', name: 'Main', dbName: 'db1', createdAt: 0 }

beforeEach(() => {
  vi.mocked(isGlobalStoreSeeded).mockReset()
  vi.mocked(markGlobalStoreSeeded).mockReset()
  vi.mocked(saveGlobalCategoryState).mockReset()
})

describe('computeSeedFromPortfolio', () => {
  it('returns categories/categoryMappings verbatim when present', () => {
    const categories = [{ id: 'c1', name: 'Groceries', updatedAt: '2024-01-01T00:00:00.000Z' }]
    const categoryMappings = [{ id: 'm1', substring: 'whole foods', spendExpenseId: 'exp-1', updatedAt: '2024-01-01T00:00:00.000Z' }]
    const result = computeSeedFromPortfolio({ categories, categoryMappings })
    expect(result).toEqual({ categories, categoryMappings })
  })

  it('defaults categoryMappings to [] when missing', () => {
    const categories = [{ id: 'c1', name: 'Groceries', updatedAt: '2024-01-01T00:00:00.000Z' }]
    const result = computeSeedFromPortfolio({ categories })
    expect(result).toEqual({ categories, categoryMappings: [] })
  })

  it('returns null when no categories key at all', () => {
    expect(computeSeedFromPortfolio({ accounts: [] })).toBeNull()
  })

  it('returns null when categories is not an array', () => {
    expect(computeSeedFromPortfolio({ categories: 'not-an-array' })).toBeNull()
  })
})

describe('seedGlobalCategoriesIfNeeded', () => {
  it('seeds the global store byte-for-byte from the portfolio blob, then marks seeded', async () => {
    vi.mocked(isGlobalStoreSeeded).mockResolvedValue(false)
    const categories = [{ id: 'c1', name: 'Groceries', updatedAt: '2024-01-01T00:00:00.000Z' }]
    const categoryMappings = [{ id: 'm1', substring: 'whole foods', spendExpenseId: 'exp-1', updatedAt: '2024-01-01T00:00:00.000Z' }]

    await seedGlobalCategoriesIfNeeded(portfolio, { categories, categoryMappings })

    expect(saveGlobalCategoryState).toHaveBeenCalledWith({ categories, categoryMappings })
    expect(markGlobalStoreSeeded).toHaveBeenCalled()
  })

  it('is idempotent: does not save when already seeded', async () => {
    vi.mocked(isGlobalStoreSeeded).mockResolvedValue(true)

    await seedGlobalCategoriesIfNeeded(portfolio, { categories: [{ id: 'c1', name: 'X', updatedAt: 'now' }] })

    expect(saveGlobalCategoryState).not.toHaveBeenCalled()
  })

  it('when blob has no categories, still marks seeded but does not save', async () => {
    vi.mocked(isGlobalStoreSeeded).mockResolvedValue(false)

    await seedGlobalCategoriesIfNeeded(portfolio, { accounts: [] })

    expect(saveGlobalCategoryState).not.toHaveBeenCalled()
    expect(markGlobalStoreSeeded).toHaveBeenCalled()
  })
})
