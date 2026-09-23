import { describe, expect, it } from 'vitest'
import {
  addBudgetTransaction,
  addExpenseDefinition,
  addCategoryMapping,
  autoTagBudgetTransactions,
  clearBudgetTransactionTags,
  deleteCategoryMapping,
  deleteExpenseDefinition,
  ensureExpenseAmountsSnapshotForYear,
  importBudgetTransactions,
  initialState,
  reconcileBudgetAccountConventions,
  resolveBudgetImportRows,
  rolloverBudgetExpenseAmountsIfNeeded,
  stripEmptyBudgetSnapshots,
  updateBudgetTransaction,
  updateBudgetTransactionsBulk,
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

describe('budget import tags passthrough', () => {
  const categories = [{ id: 'other', name: 'Other', updatedAt: '' }]

  it('resolveBudgetImportRows carries tags into toAdd unchanged', () => {
    const { toAdd, duplicateCount } = resolveBudgetImportRows(
      [],
      [{ date: '2026-01-01', description: 'Groceries', amount: -50, tags: ['food', 'weekly'] }],
      categories,
      [],
      []
    )
    expect(duplicateCount).toBe(0)
    expect(toAdd).toHaveLength(1)
    expect(toAdd[0].tags).toEqual(['food', 'weekly'])
  })

  it('tags do not participate in the dedup key: a row differing only by tags is a duplicate', () => {
    const { toAdd, duplicateCount } = resolveBudgetImportRows(
      [],
      [
        { date: '2026-01-01', description: 'Groceries', amount: -50, tags: ['food'] },
        { date: '2026-01-01', description: 'Groceries', amount: -50, tags: ['weekly'] },
      ],
      categories,
      [],
      []
    )
    expect(toAdd).toHaveLength(1)
    expect(duplicateCount).toBe(1)
    // First row wins; the duplicate row (with different tags) is dropped entirely.
    expect(toAdd[0].tags).toEqual(['food'])
  })
})

describe('updateBudgetTransactionsBulk tagsToAdd', () => {
  const tx = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    date: '2026-01-01',
    description: `Tx ${id}`,
    categoryId: 'other',
    amount: -10,
    ...extra,
  })

  it('bulk-applies tagsToAdd to rows with no existing tags', () => {
    const state = { ...initialState(), budgetTransactions: [tx('a'), tx('b')] }
    const result = updateBudgetTransactionsBulk(state, ['a', 'b'], { categoryId: 'other', tagsToAdd: ['work'] })
    expect(result.budgetTransactions).toMatchObject([
      { id: 'a', tags: ['work'] },
      { id: 'b', tags: ['work'] },
    ])
  })

  it('keeps existing casing on case-insensitive collision', () => {
    const state = { ...initialState(), budgetTransactions: [tx('a', { tags: ['Work'] })] }
    const result = updateBudgetTransactionsBulk(state, ['a'], { categoryId: 'other', tagsToAdd: ['work'] })
    expect(result.budgetTransactions[0].tags).toEqual(['Work'])
  })

  it('caps merged tags at 5, appending in order given', () => {
    const state = {
      ...initialState(),
      budgetTransactions: [tx('a', { tags: ['t1', 't2', 't3', 't4'] })],
    }
    const result = updateBudgetTransactionsBulk(state, ['a'], { categoryId: 'other', tagsToAdd: ['a', 'b'] })
    expect(result.budgetTransactions[0].tags).toEqual(['t1', 't2', 't3', 't4', 'a'])
  })

  it('leaves a 5-tag row unchanged when applying new tags', () => {
    const state = {
      ...initialState(),
      budgetTransactions: [tx('a', { tags: ['t1', 't2', 't3', 't4', 't5'] })],
    }
    const result = updateBudgetTransactionsBulk(state, ['a'], { categoryId: 'other', tagsToAdd: ['new'] })
    expect(result.budgetTransactions[0].tags).toEqual(['t1', 't2', 't3', 't4', 't5'])
  })

  it('categoryId/spendExpenseId-only bulk edit still works when tagsToAdd is omitted', () => {
    const state = { ...initialState(), budgetTransactions: [tx('a'), tx('b', { tags: ['keep'] })] }
    const result = updateBudgetTransactionsBulk(state, ['a'], { categoryId: 'food', spendExpenseId: 'exp1' })
    expect(result.budgetTransactions[0]).toMatchObject({ categoryId: 'food', spendExpenseId: 'exp1' })
    expect(result.budgetTransactions[0]).not.toHaveProperty('tags')
    expect(result.budgetTransactions[1]).toMatchObject({ categoryId: 'other', tags: ['keep'] })
  })
})

describe('budget transaction tags passthrough', () => {
  const base = { date: '2026-01-01', description: 'Groceries', categoryId: 'other', amount: -50 }

  it('addBudgetTransaction stores tags when provided', () => {
    const result = addBudgetTransaction(initialState(), { ...base, tags: ['foo', 'bar'] })
    expect(result.budgetTransactions).toHaveLength(1)
    expect(result.budgetTransactions[0].tags).toEqual(['foo', 'bar'])
  })

  it('addBudgetTransaction omits the tags key when tags are not provided', () => {
    const result = addBudgetTransaction(initialState(), { ...base })
    expect(result.budgetTransactions).toHaveLength(1)
    expect(result.budgetTransactions[0]).not.toHaveProperty('tags')
  })

  it('updateBudgetTransaction patches tags', () => {
    const added = addBudgetTransaction(initialState(), { ...base })
    const id = added.budgetTransactions[0].id
    const result = updateBudgetTransaction(added, id, { tags: ['x'] })
    expect(result.budgetTransactions[0].tags).toEqual(['x'])
  })

  it('updateBudgetTransaction clears tags when patch has tags: undefined', () => {
    const added = addBudgetTransaction(initialState(), { ...base, tags: ['x'] })
    const id = added.budgetTransactions[0].id
    const result = updateBudgetTransaction(added, id, { tags: undefined })
    expect(result.budgetTransactions[0].tags).toBeUndefined()
  })
})

describe('autoTagBudgetTransactions', () => {
  it('tags clusters spanning different years (scope is ALL budgetTransactions)', () => {
    const state = {
      ...initialState(),
      budgetTransactions: [
        { id: 'a', date: '2024-06-01', description: 'COSTCO WHOLESALE #101', categoryId: 'other', amount: -50 },
        { id: 'b', date: '2025-06-01', description: 'COSTCO WHOLESALE #202', categoryId: 'other', amount: -60 },
      ],
    }
    const result = autoTagBudgetTransactions(state)
    expect(result.budgetTransactions).toMatchObject([
      { id: 'a', tags: ['COSTCO WHOLESALE #'] },
      { id: 'b', tags: ['COSTCO WHOLESALE #'] },
    ])
  })

  it('leaves isolated descriptions unchanged', () => {
    const state = {
      ...initialState(),
      budgetTransactions: [
        { id: 'a', date: '2024-06-01', description: 'COSTCO WHOLESALE #101', categoryId: 'other', amount: -50 },
        { id: 'b', date: '2025-06-01', description: 'COSTCO WHOLESALE #202', categoryId: 'other', amount: -60 },
        { id: 'solo', date: '2025-01-01', description: 'UNIQUE ONE-OFF ZZZ QQQ', categoryId: 'other', amount: -10 },
      ],
    }
    const result = autoTagBudgetTransactions(state)
    expect(result.budgetTransactions.find((t) => t.id === 'solo')).toEqual(state.budgetTransactions[2])
    expect(result.budgetTransactions.find((t) => t.id === 'solo')).not.toHaveProperty('tags')
  })
})

describe('clearBudgetTransactionTags', () => {
  it('strips tags across years, leaving untagged records alone', () => {
    const state = {
      ...initialState(),
      budgetTransactions: [
        { id: 'a', date: '2024-06-01', description: 'COSTCO WHOLESALE #101', categoryId: 'other', amount: -50, tags: ['COSTCO'] },
        { id: 'b', date: '2025-06-01', description: 'COSTCO WHOLESALE #202', categoryId: 'other', amount: -60, tags: ['COSTCO'] },
        { id: 'solo', date: '2025-01-01', description: 'UNIQUE ONE-OFF ZZZ QQQ', categoryId: 'other', amount: -10 },
      ],
    }
    const result = clearBudgetTransactionTags(state)
    expect(result.budgetTransactions.find((t) => t.id === 'a')).not.toHaveProperty('tags')
    expect(result.budgetTransactions.find((t) => t.id === 'b')).not.toHaveProperty('tags')
    expect(result.budgetTransactions.find((t) => t.id === 'solo')).toEqual(state.budgetTransactions[2])
    expect(result.budgetTransactions.find((t) => t.id === 'solo')).not.toHaveProperty('tags')
  })

  it('cleared records omit the tags key (never tags: [])', () => {
    const state = {
      ...initialState(),
      budgetTransactions: [
        { id: 'a', date: '2025-01-01', description: 'COFFEE SHOP', categoryId: 'other', amount: -5, tags: ['CAFE'] },
      ],
    }
    const result = clearBudgetTransactionTags(state)
    expect(result.budgetTransactions[0]).not.toHaveProperty('tags')
  })

  it('zero-tag state returns transactions unchanged in content', () => {
    const state = {
      ...initialState(),
      budgetTransactions: [
        { id: 'a', date: '2024-06-01', description: 'COSTCO WHOLESALE #101', categoryId: 'other', amount: -50 },
        { id: 'b', date: '2025-06-01', description: 'UNIQUE ONE-OFF ZZZ QQQ', categoryId: 'other', amount: -10 },
      ],
    }
    const result = clearBudgetTransactionTags(state)
    expect(result.budgetTransactions).toHaveLength(state.budgetTransactions.length)
    result.budgetTransactions.forEach((t, i) => expect(t).toEqual(state.budgetTransactions[i]))
  })

  it('leaves other fields untouched on cleared records', () => {
    const state = {
      ...initialState(),
      budgetTransactions: [
        { id: 'a', date: '2025-03-15', description: 'TRADER JOES #12', categoryId: 'groceries', amount: -42.5, tags: ['GROCERY'] },
      ],
    }
    const result = clearBudgetTransactionTags(state)
    expect(result.budgetTransactions[0]).toMatchObject({
      id: 'a',
      date: '2025-03-15',
      description: 'TRADER JOES #12',
      categoryId: 'groceries',
      amount: -42.5,
    })
  })
})

describe('importBudgetTransactions auto-tag', () => {
  const categories = [{ id: 'other', name: 'Other', updatedAt: '' }]
  const convention = { accountName: 'Checking', statementConvention: 'negativeSpend' as const }

  it('tags batch-internal clusters on import', () => {
    const result = importBudgetTransactions(
      initialState(),
      [
        { date: '2026-01-01', description: 'COSTCO WHOLESALE #101', amount: -50 },
        { date: '2026-01-02', description: 'COSTCO WHOLESALE #202', amount: -60 },
      ],
      categories,
      [],
      [],
      convention
    )
    expect(result.budgetTransactions).toMatchObject([
      { description: 'COSTCO WHOLESALE #101', tags: ['COSTCO WHOLESALE #'] },
      { description: 'COSTCO WHOLESALE #202', tags: ['COSTCO WHOLESALE #'] },
    ])
  })

  it('never clusters an incoming row with pre-existing records', () => {
    const state = {
      ...initialState(),
      budgetTransactions: [
        { id: 'existing', date: '2025-01-01', description: 'COSTCO WHOLESALE #999', categoryId: 'other', amount: -10 },
      ],
    }
    const result = importBudgetTransactions(
      state,
      [{ date: '2026-01-01', description: 'COSTCO WHOLESALE #101', amount: -50 }],
      categories,
      [],
      [],
      convention
    )
    expect(result.budgetTransactions).toHaveLength(2)
    expect(result.budgetTransactions[0]).toEqual(state.budgetTransactions[0])
    expect(result.budgetTransactions[0]).not.toHaveProperty('tags')
    expect(result.budgetTransactions[1]).not.toHaveProperty('tags')
  })

  it('dedup still drops identical rows even though auto-tag would tag both', () => {
    const result = importBudgetTransactions(
      initialState(),
      [
        { date: '2026-01-01', description: 'COSTCO WHOLESALE #101', amount: -50 },
        { date: '2026-01-01', description: 'COSTCO WHOLESALE #101', amount: -50 },
      ],
      categories,
      [],
      [],
      convention
    )
    expect(result.budgetTransactions).toHaveLength(1)
    expect(result.budgetTransactions[0].tags).toEqual(['COSTCO WHOLESALE #101'])
  })

  it('resolveBudgetImportRows called directly does not auto-tag', () => {
    const { toAdd } = resolveBudgetImportRows(
      [],
      [
        { date: '2026-01-01', description: 'COSTCO WHOLESALE #101', amount: -50 },
        { date: '2026-01-02', description: 'COSTCO WHOLESALE #202', amount: -60 },
      ],
      categories,
      [],
      []
    )
    expect(toAdd).toHaveLength(2)
    expect(toAdd[0]).not.toHaveProperty('tags')
    expect(toAdd[1]).not.toHaveProperty('tags')
  })
})
