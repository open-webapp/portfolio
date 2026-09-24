import { describe, it, expect, vi } from 'vitest'
import {
  initialGlobalCategoryState,
  addCategory,
  renameCategory,
  setCategoryExcludeFromSpend,
  deleteCategory,
  visibleCategories,
  configureBudgetAccountRule,
  deleteBudgetAccountRule,
  visibleBudgetAccountRules,
  categoryStoreReducer,
  type GlobalCategoryState,
} from './categoryStore'
import type { BudgetAccountRule, Category } from './types'

describe('categoryStore', () => {
  describe('addCategory', () => {
    it('appends a new category with the given id and name', () => {
      const s = initialGlobalCategoryState()
      const updated = addCategory(s, 'cat-1', 'Groceries')
      expect(updated.categories).toHaveLength(1)
      expect(updated.categories[0]).toMatchObject({ id: 'cat-1', name: 'Groceries' })
      expect(updated.categories[0].updatedAt).toBeTruthy()
    })
  })

  describe('renameCategory', () => {
    it('patches the name and stamps updatedAt', () => {
      const s: GlobalCategoryState = { ...initialGlobalCategoryState(), categories: [{ id: 'cat-1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' }] }
      const updated = renameCategory(s, 'cat-1', 'Food & Dining')
      expect(updated.categories[0].name).toBe('Food & Dining')
      expect(updated.categories[0].updatedAt).not.toBe('2026-01-01T00:00:00.000Z')
    })

    it('is a no-op when the id is unknown', () => {
      const s: GlobalCategoryState = { ...initialGlobalCategoryState(), categories: [{ id: 'cat-1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' }] }
      const updated = renameCategory(s, 'cat-nope', 'Food & Dining')
      expect(updated.categories).toEqual(s.categories)
    })
  })

  describe('SET_CATEGORY_EXCLUDE_FROM_SPEND / setCategoryExcludeFromSpend', () => {
    it('sets excludeFromSpend: true and stamps updatedAt, and toggling back to false clears it', () => {
      const s: GlobalCategoryState = { ...initialGlobalCategoryState(), categories: [{ id: 'cat-1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' }] }
      const excluded = categoryStoreReducer(s, { type: 'SET_CATEGORY_EXCLUDE_FROM_SPEND', id: 'cat-1', exclude: true })
      expect(excluded.categories[0].excludeFromSpend).toBe(true)
      expect(excluded.categories[0].updatedAt).not.toBe('2026-01-01T00:00:00.000Z')

      const included = categoryStoreReducer(excluded, { type: 'SET_CATEGORY_EXCLUDE_FROM_SPEND', id: 'cat-1', exclude: false })
      expect(included.categories[0].excludeFromSpend).toBe(false)
    })

    it('is a no-op when the id is unknown', () => {
      const s: GlobalCategoryState = { ...initialGlobalCategoryState(), categories: [{ id: 'cat-1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' }] }
      const updated = setCategoryExcludeFromSpend(s, 'cat-nope', true)
      expect(updated.categories).toEqual(s.categories)
    })
  })

  describe('deleteCategory', () => {
    it('stamps both deletedAt and updatedAt', () => {
      const s: GlobalCategoryState = { ...initialGlobalCategoryState(), categories: [{ id: 'cat-1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' }] }
      const updated = deleteCategory(s, 'cat-1')
      expect(updated.categories[0].deletedAt).toBeTruthy()
      expect(updated.categories[0].updatedAt).toBe(updated.categories[0].deletedAt)
    })

    it('is a no-op if the id is unknown', () => {
      const s: GlobalCategoryState = { ...initialGlobalCategoryState(), categories: [{ id: 'cat-1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' }] }
      const updated = deleteCategory(s, 'cat-nope')
      expect(updated).toEqual(s)
    })
  })

  describe('budget account rules', () => {
    it('creates then updates a rule while preserving its first live display name', () => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime('2026-01-01T00:00:00.000Z')
        const created = configureBudgetAccountRule(initialGlobalCategoryState(), ' Primary Checking ', 'negativeSpend')
        vi.setSystemTime('2026-01-01T00:00:00.001Z')
        const updated = configureBudgetAccountRule(created, 'PRIMARY CHECKING', 'positiveSpend')

        expect(updated.budgetAccountRules).toHaveLength(1)
        expect(updated.budgetAccountRules[0]).toMatchObject({
          normalizedName: 'primary checking',
          displayName: 'Primary Checking',
          statementConvention: 'positiveSpend',
        })
        expect(updated.budgetAccountRules[0].updatedAt).not.toBe(created.budgetAccountRules[0].updatedAt)
      } finally {
        vi.useRealTimers()
      }
    })

    it('uses one rule for differently spelled versions of the same account name', () => {
      const first = configureBudgetAccountRule(initialGlobalCategoryState(), 'Savings', 'negativeSpend')
      const second = configureBudgetAccountRule(first, ' savings ', 'positiveSpend')

      expect(second.budgetAccountRules).toHaveLength(1)
      expect(second.budgetAccountRules[0].displayName).toBe('Savings')
    })

    it('is a reference-equal no-op for a matching convention or blank name', () => {
      const configured = configureBudgetAccountRule(initialGlobalCategoryState(), 'Checking', 'negativeSpend')

      expect(configureBudgetAccountRule(configured, ' checking ', 'negativeSpend')).toBe(configured)
      const empty = initialGlobalCategoryState()
      expect(configureBudgetAccountRule(empty, '   ', 'positiveSpend')).toBe(empty)
      expect(empty.budgetAccountRules).toEqual([])
    })

    it('tombstones a live rule and ignores unknown or already tombstoned names', () => {
      const configured = configureBudgetAccountRule(initialGlobalCategoryState(), 'Checking', 'negativeSpend')
      const deleted = deleteBudgetAccountRule(configured, 'checking')

      expect(deleted.budgetAccountRules[0].deletedAt).toBeTruthy()
      expect(deleted.budgetAccountRules[0].updatedAt).toBe(deleted.budgetAccountRules[0].deletedAt)
      expect(deleteBudgetAccountRule(configured, 'unknown')).toBe(configured)
      expect(deleteBudgetAccountRule(deleted, 'checking')).toBe(deleted)
    })

    it('filters tombstoned rules from the visible list', () => {
      const rules: BudgetAccountRule[] = [
        { normalizedName: 'checking', displayName: 'Checking', statementConvention: 'negativeSpend', updatedAt: '2026-01-01T00:00:00.000Z' },
        { normalizedName: 'savings', displayName: 'Savings', statementConvention: 'positiveSpend', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: '2026-01-02T00:00:00.000Z' },
      ]

      expect(visibleBudgetAccountRules({ ...initialGlobalCategoryState(), budgetAccountRules: rules })).toEqual([rules[0]])
    })
  })

  describe('visibleCategories', () => {
    it('filters out tombstoned records and preserves order', () => {
      const categories: Category[] = [
        { id: 'cat-1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'cat-2', name: 'Deleted', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: '2026-01-02T00:00:00.000Z' },
        { id: 'cat-3', name: 'Dining', updatedAt: '2026-01-01T00:00:00.000Z' },
      ]
      const s: GlobalCategoryState = { categories, budgetAccountRules: [] }
      expect(visibleCategories(s)).toEqual([categories[0], categories[2]])
    })
  })

  describe('categoryStoreReducer', () => {
    it('ADD_CATEGORY appends a category', () => {
      const updated = categoryStoreReducer(initialGlobalCategoryState(), { type: 'ADD_CATEGORY', id: 'cat-1', name: 'Groceries' })
      expect(updated.categories).toHaveLength(1)
      expect(updated.categories[0]).toMatchObject({ id: 'cat-1', name: 'Groceries' })
    })

    it('RENAME_CATEGORY renames a category', () => {
      const s: GlobalCategoryState = { ...initialGlobalCategoryState(), categories: [{ id: 'cat-1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' }] }
      const updated = categoryStoreReducer(s, { type: 'RENAME_CATEGORY', id: 'cat-1', name: 'Food' })
      expect(updated.categories[0].name).toBe('Food')
    })

    it('DELETE_CATEGORY tombstones a category', () => {
      const s: GlobalCategoryState = { ...initialGlobalCategoryState(), categories: [{ id: 'cat-1', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' }] }
      const updated = categoryStoreReducer(s, { type: 'DELETE_CATEGORY', id: 'cat-1' })
      expect(updated.categories[0].deletedAt).toBeTruthy()
    })

    it('__MERGE_IMPORTED merges the imported state in via mergeCategoryState (newer updatedAt wins per id, unique ids pass through)', () => {
      const s: GlobalCategoryState = {
        categories: [
          { id: 'c1', name: 'A-Groceries', updatedAt: '2024-01-05T00:00:00.000Z' },
          { id: 'c3', name: 'A-only-cat', updatedAt: '2024-01-01T00:00:00.000Z' },
        ],
        budgetAccountRules: [],
      }
      const imported: GlobalCategoryState = {
        categories: [
          { id: 'c1', name: 'B-Groceries', updatedAt: '2024-01-02T00:00:00.000Z' },
          { id: 'c4', name: 'B-only-cat', updatedAt: '2024-01-01T00:00:00.000Z' },
        ],
        budgetAccountRules: [],
      }
      const updated = categoryStoreReducer(s, { type: '__MERGE_IMPORTED', imported })

      expect(updated.categories).toEqual(
        expect.arrayContaining([
          { id: 'c1', name: 'A-Groceries', updatedAt: '2024-01-05T00:00:00.000Z' },
          { id: 'c3', name: 'A-only-cat', updatedAt: '2024-01-01T00:00:00.000Z' },
          { id: 'c4', name: 'B-only-cat', updatedAt: '2024-01-01T00:00:00.000Z' },
        ])
      )
      expect(updated.categories).toHaveLength(3)
    })
  })
})
