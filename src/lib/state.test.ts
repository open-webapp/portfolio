import { describe, expect, it } from 'vitest'
import {
  addExpenseDefinition,
  addCategoryMapping,
  deleteCategoryMapping,
  deleteExpenseDefinition,
  ensureExpenseAmountsSnapshotForYear,
  importBudgetTransactions,
  initialState,
  reconcileBudgetAccountConventions,
  rolloverBudgetExpenseAmountsIfNeeded,
  stripEmptyBudgetSnapshots,
  updateCategoryMapping,
  updateExpenseDefinition,
  upsertCategoryMapping,
} from './state'
import type { BudgetAccountRule, StatementConvention } from './types'
import { appReducer, type AppAction } from './reducer'

describe('budget state', () => {
  it('has no manual income state', () => {
    expect(initialState()).not.toHaveProperty('budgetIncomeByYear')
  })

  it('strips empty expense snapshots only', () => {
    const state = { ...initialState(), budgetExpenseAmountsByYear: { '2024': {}, '2025': { rent: 1000 } } }
    expect(stripEmptyBudgetSnapshots(state).budgetExpenseAmountsByYear).toEqual({ '2025': { rent: 1000 } })
  })

  it('clones only expense amounts when ensuring a year', () => {
    const state = { ...initialState(), budgetExpenseAmountsByYear: { '2024': { rent: 1000 } } }
    expect(ensureExpenseAmountsSnapshotForYear(state, '2025').budgetExpenseAmountsByYear['2025']).toEqual({ rent: 1000 })
  })

  it('rolls current-year expense amounts forward', () => {
    const now = new Date('2026-06-01T00:00:00Z')
    const state = { ...initialState(), budgetExpenseAmountsByYear: { '2025': { rent: 1000 } } }
    expect(rolloverBudgetExpenseAmountsIfNeeded(state, now).budgetExpenseAmountsByYear['2026']).toEqual({ rent: 1000 })
  })

  it('deduplicates expense definitions by normalized name and category', () => {
    const now = new Date('2026-06-01T00:00:00Z')
    const definition = { name: ' Rent ', categoryId: 'housing', frequency: 'monthly' as const }
    const once = addExpenseDefinition(initialState(), definition, 1000, now)
    const twice = addExpenseDefinition(once, { ...definition, name: 'rent' }, 1200, now)

    expect(twice.budgetExpenseDefinitions).toHaveLength(1)
    expect(twice.budgetExpenseAmountsByYear['2026']).toEqual({ [once.budgetExpenseDefinitions[0].id]: 1200 })
  })

  it('does not allow an edit to duplicate an expense definition', () => {
    const state = {
      ...initialState(),
      budgetExpenseDefinitions: [
        { id: 'rent', name: 'Rent', categoryId: 'housing', frequency: 'monthly' as const },
        { id: 'utilities', name: 'Utilities', categoryId: 'housing', frequency: 'monthly' as const },
      ],
    }

    expect(updateExpenseDefinition(state, 'utilities', { name: ' rent ' })).toBe(state)
  })

  it('hard-deletes mappings for a deleted expense definition', () => {
    const state = {
      ...initialState(),
      budgetExpenseDefinitions: [{ id: 'rent', name: 'Rent', categoryId: 'housing', frequency: 'monthly' as const }],
      categoryMappings: [
        { id: 'rent-map', substring: 'Landlord', spendExpenseId: 'rent', updatedAt: '' },
        { id: 'other-map', substring: 'Store', spendExpenseId: 'other', updatedAt: '' },
      ],
    }

    const result = deleteExpenseDefinition(state, 'rent')
    expect(result.categoryMappings.find((mapping) => mapping.id === 'rent-map')).toBeUndefined()
    expect(result.categoryMappings).toEqual([state.categoryMappings[1]])
  })

  it('leaves mappings untouched when deleting an expense without mappings', () => {
    const state = {
      ...initialState(),
      categoryMappings: [{ id: 'other-map', substring: 'Store', spendExpenseId: 'other', updatedAt: '' }],
    }

    expect(deleteExpenseDefinition(state, 'rent').categoryMappings).toBe(state.categoryMappings)
  })
})

describe('category mappings', () => {
  it('upserts by case-insensitive substring without tombstoning', () => {
    const once = upsertCategoryMapping(initialState(), ' Grocery ', 'groceries')
    const twice = upsertCategoryMapping(once, 'gRoCeRy', 'food')

    expect(twice.categoryMappings).toHaveLength(1)
    expect(twice.categoryMappings[0]).toMatchObject({ substring: 'Grocery', spendExpenseId: 'food' })
    expect(twice.categoryMappings[0]).not.toHaveProperty('deletedAt')
  })

  it('updates a mapping by ID', () => {
    const state = {
      ...initialState(),
      budgetExpenseDefinitions: [
        { id: 'other-expense', name: 'Other', categoryId: 'other', frequency: 'monthly' as const },
        { id: 'food-expense', name: 'Food', categoryId: 'food', frequency: 'monthly' as const },
      ],
      categoryMappings: [{ id: 'map', substring: 'Store', spendExpenseId: 'other', updatedAt: '' }],
      budgetTransactions: [
        { id: 'store', date: '2026-01-01', description: 'Store run', categoryId: 'other', amount: 10, spendExpenseId: 'other-expense' },
        { id: 'market', date: '2026-01-02', description: 'Market run', categoryId: 'other', amount: 20 },
      ],
    }

    const result = updateCategoryMapping(state, 'map', { substring: 'Market', spendExpenseId: 'food-expense' })
    expect(result.categoryMappings[0])
      .toMatchObject({ id: 'map', substring: 'Market', spendExpenseId: 'food-expense' })
    expect(result.budgetTransactions).toMatchObject([
      { id: 'store', categoryId: 'other', spendExpenseId: 'other-expense' },
      { id: 'market', categoryId: 'food', spendExpenseId: 'food-expense' },
    ])
  })

  it('does not add mappings with blank substrings', () => {
    const state = initialState()
    expect(addCategoryMapping(state, 'food', '   ')).toBe(state)
    expect(upsertCategoryMapping(state, '   ', 'food')).toBe(state)
  })

  it('hard-deletes a mapping and no-ops for an unknown ID', () => {
    const state = {
      ...initialState(),
      categoryMappings: [{ id: 'map', substring: 'Store', spendExpenseId: 'food', updatedAt: '' }],
    }
    const deleted = deleteCategoryMapping(state, 'map')

    expect(deleted.categoryMappings.find((mapping) => mapping.id === 'map')).toBeUndefined()
    expect(deleteCategoryMapping(state, 'missing')).toBe(state)
  })

  it('handles mapping mutations through the app reducer', () => {
    const state = {
      ...initialState(),
      categoryMappings: [{ id: 'existing', substring: 'Store', spendExpenseId: 'other', updatedAt: '' }],
    }
    const upserted = appReducer(state, {
      type: 'UPSERT_CATEGORY_MAPPING', description: ' Grocery ', spendExpenseId: 'groceries',
    })
    const updated = appReducer(upserted, {
      type: 'UPDATE_CATEGORY_MAPPING', id: 'existing', patch: { spendExpenseId: 'food' },
    })
    const added = appReducer(updated, {
      type: 'ADD_CATEGORY_MAPPING', spendExpenseId: 'food', substring: ' Market ',
    })
    const deleted = appReducer(added, { type: 'DELETE_CATEGORY_MAPPING', id: 'existing' })

    expect(upserted.categoryMappings).toHaveLength(2)
    expect(upserted.categoryMappings[1]).toMatchObject({ substring: 'Grocery', spendExpenseId: 'groceries' })
    expect(updated.categoryMappings[0]).toMatchObject({ id: 'existing', spendExpenseId: 'food' })
    expect(added.categoryMappings[2]).toMatchObject({ substring: 'Market', spendExpenseId: 'food' })
    expect(deleted.categoryMappings.map((mapping) => mapping.id)).not.toContain('existing')
  })

  it('returns the original state for an unknown mapping-shaped action', () => {
    const state = initialState()
    const action = {
      type: 'UPSERT_CATEGORY_MAPING', description: 'Grocery', spendExpenseId: 'groceries',
    } as unknown as AppAction

    expect(appReducer(state, action)).toBe(state)
  })
})

describe('budget account conventions', () => {
  const positiveRule: BudgetAccountRule = {
    normalizedName: 'checking',
    displayName: 'Checking',
    statementConvention: 'positiveSpend',
    updatedAt: '',
  }
  const row = { date: '2026-09-19', description: 'Store', amount: -10, accountName: 'Checking' }

  it('records the selected import convention even when every converted row deduplicates', () => {
    const state = { ...initialState(), budgetTransactions: [{ id: 'existing', categoryId: 'other', ...row }] }
    const result = importBudgetTransactions(state, [row], [{ id: 'other', name: 'Other', updatedAt: '' }], [], [], {
      accountName: ' Checking ',
      statementConvention: 'positiveSpend',
    })

    expect(result.budgetTransactions).toBe(state.budgetTransactions)
    expect(result.budgetAccountAppliedConventions).toEqual({ checking: 'positiveSpend' })
  })

  it('preserves converted records when their canonical natural keys collide', () => {
    const state = {
      ...initialState(),
      budgetTransactions: [
        { id: 'first', categoryId: 'other', ...row, accountName: 'checking' },
        { id: 'second', categoryId: 'other', ...row },
      ],
      budgetAccountAppliedConventions: { checking: 'positiveSpend' as const },
    }

    expect(reconcileBudgetAccountConventions(state, [{ ...positiveRule, statementConvention: 'negativeSpend' }]).budgetTransactions)
      .toHaveLength(2)
  })

  it('does not add an invalid import marker for an unassigned account', () => {
    const state = initialState()
    const result = importBudgetTransactions(state, [], [], [], [], {
      accountName: 'Unassigned',
      statementConvention: 'invalid' as StatementConvention,
    })

    expect(result).toBe(state)
  })

  it('keeps the same state reference when reconciliation has nothing to apply', () => {
    const state = initialState()
    expect(reconcileBudgetAccountConventions(state, [positiveRule])).toBe(state)
  })
})
