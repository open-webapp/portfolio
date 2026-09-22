import { describe, it, expect, vi } from 'vitest'
import {
  initialGlobalCategoryState,
  addCategory,
  renameCategory,
  setCategoryExcludeFromSpend,
  deleteCategory,
  resolveSpendExpenseIdForDescription,
  visibleCategories,
  configureBudgetAccountRule,
  deleteBudgetAccountRule,
  visibleBudgetAccountRules,
  reapplyMappingsToTransactions,
  resolveSpendExpenseForCategory,
  categoryStoreReducer,
  type GlobalCategoryState,
} from './categoryStore'
import type { BudgetAccountRule, Category, CategoryMapping, BudgetTransaction, ExpenseDefinition } from './types'

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

  describe('resolveSpendExpenseIdForDescription', () => {
    it('returns the spendExpenseId for a single match', () => {
      const mappings: CategoryMapping[] = [
        { id: 'map-1', substring: 'Costco', spendExpenseId: 'exp-1', updatedAt: '2026-01-01T00:00:00.000Z' },
      ]
      expect(resolveSpendExpenseIdForDescription(mappings, 'COSTCO WHSE #123')).toBe('exp-1')
    })

    it('matches case-insensitively', () => {
      const mappings: CategoryMapping[] = [
        { id: 'map-1', substring: 'Grocery', spendExpenseId: 'exp-1', updatedAt: '2026-01-01T00:00:00.000Z' },
      ]
      expect(resolveSpendExpenseIdForDescription(mappings, 'grocery store')).toBe('exp-1')
    })

    it('returns null when there is no match', () => {
      const mappings: CategoryMapping[] = [
        { id: 'map-1', substring: 'Costco', spendExpenseId: 'exp-1', updatedAt: '2026-01-01T00:00:00.000Z' },
      ]
      expect(resolveSpendExpenseIdForDescription(mappings, 'Netflix')).toBeNull()
    })

    it('returns the spendExpenseId of the latest-updatedAt match among multiple matches, regardless of substring length', () => {
      const mappings: CategoryMapping[] = [
        { id: 'map-1', substring: 'Whole Foods Market', spendExpenseId: 'exp-older', updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'map-2', substring: 'Whole Foods', spendExpenseId: 'exp-newer', updatedAt: '2026-06-01T00:00:00.000Z' },
      ]
      expect(resolveSpendExpenseIdForDescription(mappings, 'Whole Foods Market #42')).toBe('exp-newer')
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

  describe('reapplyMappingsToTransactions', () => {
    it('rewrites categoryId and spendExpenseId for matching transactions and leaves non-matching ones untouched', () => {
      const mappings: CategoryMapping[] = [
        { id: 'map-1', substring: 'Costco', spendExpenseId: 'exp-1', updatedAt: '2026-01-01T00:00:00.000Z' },
      ]
      const budgetExpenseDefinitions: ExpenseDefinition[] = [
        { id: 'exp-1', name: 'Groceries', categoryId: 'cat-groceries', frequency: 'monthly' },
      ]
      const txMatching: BudgetTransaction = { id: 'tx-1', date: '2026-01-01', description: 'Costco Gas', categoryId: 'cat-old', amount: 40 }
      // Non-matching tx already carries a link: no-match must not clear or rewrite it.
      const txNonMatching: BudgetTransaction = { id: 'tx-2', date: '2026-01-02', description: 'Netflix', categoryId: 'cat-subs', spendExpenseId: 'exp-subs', amount: 15 }

      const updated = reapplyMappingsToTransactions([txMatching, txNonMatching], mappings, budgetExpenseDefinitions)

      const matching = updated.find((t) => t.id === 'tx-1')
      expect(matching?.categoryId).toBe('cat-groceries')
      expect(matching?.spendExpenseId).toBe('exp-1')
      expect(updated.find((t) => t.id === 'tx-2')).toEqual(txNonMatching)
    })

    it('is idempotent when run twice', () => {
      const mappings: CategoryMapping[] = [
        { id: 'map-1', substring: 'Costco', spendExpenseId: 'exp-1', updatedAt: '2026-01-01T00:00:00.000Z' },
      ]
      const budgetExpenseDefinitions: ExpenseDefinition[] = [
        { id: 'exp-1', name: 'Groceries', categoryId: 'cat-groceries', frequency: 'monthly' },
      ]
      const tx: BudgetTransaction = { id: 'tx-1', date: '2026-01-01', description: 'Costco Gas', categoryId: 'cat-old', amount: 40 }

      const once = reapplyMappingsToTransactions([tx], mappings, budgetExpenseDefinitions)
      const twice = reapplyMappingsToTransactions(once, mappings, budgetExpenseDefinitions)

      expect(twice).toEqual(once)
    })

    it('uses the latest-updated mapping when multiple substrings match', () => {
      const mappings: CategoryMapping[] = [
        { id: 'map-1', substring: 'Costco', spendExpenseId: 'exp-older', updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'map-2', substring: 'Costco Gas', spendExpenseId: 'exp-newer', updatedAt: '2026-06-01T00:00:00.000Z' },
      ]
      const definitions: ExpenseDefinition[] = [
        { id: 'exp-older', name: 'Groceries', categoryId: 'cat-groceries', frequency: 'monthly' },
        { id: 'exp-newer', name: 'Fuel', categoryId: 'cat-fuel', frequency: 'monthly' },
      ]
      const transaction: BudgetTransaction = { id: 'tx-1', date: '2026-01-01', description: 'Costco Gas', categoryId: 'cat-old', amount: 40 }

      expect(reapplyMappingsToTransactions([transaction], mappings, definitions)).toEqual([
        { ...transaction, categoryId: 'cat-fuel', spendExpenseId: 'exp-newer' },
      ])
    })

    // Note: mappings are keyed by spendExpenseId (not categoryId) since the T2 rekey, so
    // every fixture below points its mapping at an ExpenseDefinition id and resolution is
    // a direct definition lookup — no category-based guessing.
    it('sets both categoryId and spendExpenseId directly from the matched mapping\'s spendExpenseId, no guessing', () => {
      const mappings: CategoryMapping[] = [
        { id: 'map-1', substring: 'Costco', spendExpenseId: 'exp-2', updatedAt: '2026-01-01T00:00:00.000Z' },
      ]
      const budgetExpenseDefinitions: ExpenseDefinition[] = [
        { id: 'exp-1', name: 'Costco membership', categoryId: 'cat-A', frequency: 'yearly' },
        { id: 'exp-2', name: 'Gas', categoryId: 'cat-B', frequency: 'monthly' },
      ]
      const tx: BudgetTransaction = {
        id: 'tx-1',
        date: '2026-01-01',
        description: 'Costco Gas',
        categoryId: 'cat-A',
        spendExpenseId: 'exp-1',
        amount: 40,
      }

      const updated = reapplyMappingsToTransactions([tx], mappings, budgetExpenseDefinitions)

      const result = updated.find((t) => t.id === 'tx-1')
      expect(result?.categoryId).toBe('cat-B')
      expect(result?.spendExpenseId).toBe('exp-2')
    })

    it('keeps the spendExpenseId link when the mapping already points at the linked expense', () => {
      const mappings: CategoryMapping[] = [
        { id: 'map-1', substring: 'Costco', spendExpenseId: 'exp-1', updatedAt: '2026-01-01T00:00:00.000Z' },
      ]
      const budgetExpenseDefinitions: ExpenseDefinition[] = [
        { id: 'exp-1', name: 'Costco membership', categoryId: 'cat-A', frequency: 'yearly' },
      ]
      const tx: BudgetTransaction = {
        id: 'tx-1',
        date: '2026-01-01',
        description: 'Costco Gas',
        categoryId: 'cat-old',
        spendExpenseId: 'exp-1',
        amount: 40,
      }

      const updated = reapplyMappingsToTransactions([tx], mappings, budgetExpenseDefinitions)

      const result = updated.find((t) => t.id === 'tx-1')
      expect(result?.categoryId).toBe('cat-A')
      expect(result?.spendExpenseId).toBe('exp-1')
    })

    it('always sets spendExpenseId alongside categoryId when a mapping matches a transaction without one', () => {
      const mappings: CategoryMapping[] = [
        { id: 'map-1', substring: 'Costco', spendExpenseId: 'exp-1', updatedAt: '2026-01-01T00:00:00.000Z' },
      ]
      const budgetExpenseDefinitions: ExpenseDefinition[] = [
        { id: 'exp-1', name: 'Groceries', categoryId: 'cat-groceries', frequency: 'monthly' },
      ]
      const tx: BudgetTransaction = { id: 'tx-1', date: '2026-01-01', description: 'Costco Gas', categoryId: 'cat-old', amount: 40 }

      const updated = reapplyMappingsToTransactions([tx], mappings, budgetExpenseDefinitions)

      const result = updated.find((t) => t.id === 'tx-1')
      expect(result?.categoryId).toBe('cat-groceries')
      expect(result?.spendExpenseId).toBe('exp-1')
    })

    it('leaves the transaction untouched when the matched mapping points at an expense definition that no longer exists', () => {
      // Dangling spendExpenseId (definition deleted) is treated as no-match: already-set
      // fields are left as-is, never cleared.
      const mappings: CategoryMapping[] = [
        { id: 'map-1', substring: 'Costco', spendExpenseId: 'exp-gone', updatedAt: '2026-01-01T00:00:00.000Z' },
      ]
      const budgetExpenseDefinitions: ExpenseDefinition[] = [
        { id: 'exp-1', name: 'Costco membership', categoryId: 'cat-A', frequency: 'yearly' },
      ]
      const tx: BudgetTransaction = {
        id: 'tx-1',
        date: '2026-01-01',
        description: 'Costco Gas',
        categoryId: 'cat-A',
        spendExpenseId: 'exp-1',
        amount: 40,
      }

      const updated = reapplyMappingsToTransactions([tx], mappings, budgetExpenseDefinitions)

      expect(updated.find((t) => t.id === 'tx-1')).toEqual(tx)
    })

    // Reasoning note: the old "opportunistically links spendExpenseId when categoryId is
    // unchanged but was previously unset" test and the old "accepted tradeoff:
    // silently re-links a manually-Uncategorized transaction" test covered the same code
    // path under direct-resolution semantics — any confirmed match sets both fields, so
    // there is no separate opportunistic branch anymore. Both are consolidated here: a
    // match overwrites a cleared link because nothing records the manual choice.
    it('re-links spendExpenseId when a mapping matches a transaction whose link was manually cleared', () => {
      const mappings: CategoryMapping[] = [
        { id: 'map-1', substring: 'Costco', spendExpenseId: 'exp-1', updatedAt: '2026-01-01T00:00:00.000Z' },
      ]
      const budgetExpenseDefinitions: ExpenseDefinition[] = [
        { id: 'exp-1', name: 'Costco membership', categoryId: 'cat-A', frequency: 'yearly' },
      ]
      // The per-cell picker's "Uncategorized" choice sets spendExpenseId to undefined
      // without recording that choice anywhere else, so reapply re-links it.
      const tx: BudgetTransaction = {
        id: 'tx-1',
        date: '2026-01-01',
        description: 'Costco Gas',
        categoryId: 'cat-A',
        spendExpenseId: undefined,
        amount: 40,
      }

      const updated = reapplyMappingsToTransactions([tx], mappings, budgetExpenseDefinitions)

      const result = updated.find((t) => t.id === 'tx-1')
      expect(result?.categoryId).toBe('cat-A')
      expect(result?.spendExpenseId).toBe('exp-1')
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

  describe('resolveSpendExpenseForCategory', () => {
    it('returns the first array-order ExpenseDefinition matching categoryId', () => {
      const expenseA: ExpenseDefinition = { id: 'exp-A', name: 'A', categoryId: 'cat-1', frequency: 'monthly' }
      const expenseB: ExpenseDefinition = { id: 'exp-B', name: 'B', categoryId: 'cat-2', frequency: 'monthly' }
      const expenseC: ExpenseDefinition = { id: 'exp-C', name: 'C', categoryId: 'cat-1', frequency: 'monthly' }

      const result = resolveSpendExpenseForCategory([expenseA, expenseB, expenseC], 'cat-1')

      expect(result).toBe(expenseA)
    })

    it('returns undefined when no ExpenseDefinition matches categoryId', () => {
      const expenseA: ExpenseDefinition = { id: 'exp-A', name: 'A', categoryId: 'cat-1', frequency: 'monthly' }

      const result = resolveSpendExpenseForCategory([expenseA], 'cat-9')

      expect(result).toBeUndefined()
    })

    it('returns undefined for an empty budgetExpenseDefinitions array', () => {
      const result = resolveSpendExpenseForCategory([], 'cat-1')

      expect(result).toBeUndefined()
    })
  })
})
