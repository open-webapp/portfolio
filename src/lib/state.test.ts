import { describe, expect, it } from 'vitest'
import {
  addBudgetTransaction,
  addExpenseDefinition,
  autoTagBudgetTransactions,
  clearBudgetTransactionAutoTags,
  clearBudgetTransactionTags,
  deleteExpenseDefinition,
  ensureExpenseAmountsSnapshotForYear,
  importBudgetTransactions,
  initialState,
  propagateSpendLinksByAutoTag,
  reconcileBudgetAccountConventions,
  resolveBudgetImportRows,
  rolloverBudgetExpenseAmountsIfNeeded,
  stripEmptyBudgetSnapshots,
  updateBudgetTransaction,
  updateBudgetTransactionsBulk,
  updateExpenseDefinition,
} from './state'
import type { BudgetAccountRule, StatementConvention } from './types'

describe('budget state', () => {
  it('has no manual income state', () => {
    expect(initialState()).not.toHaveProperty('budgetIncomeByYear')
  })

  it('has no expandedCategories state', () => {
    expect(initialState()).not.toHaveProperty('expandedCategories')
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

  it('deleteExpenseDefinition no longer touches mappings', () => {
    const state = {
      ...initialState(),
      budgetExpenseDefinitions: [{ id: 'rent', name: 'Rent', categoryId: 'housing', frequency: 'monthly' as const }],
      budgetExpenseAmountsByYear: { '2026': { rent: 1000 } },
    }

    expect(state).not.toHaveProperty('categoryMappings')
    const result = deleteExpenseDefinition(state, 'rent')
    expect(result).not.toHaveProperty('categoryMappings')
    expect(result.budgetExpenseDefinitions).toEqual([])
    expect(result.budgetExpenseAmountsByYear).toEqual({ '2026': {} })
  })
})

describe('propagateSpendLinksByAutoTag', () => {
  const defs = [
    { id: 'expA', name: 'A', categoryId: 'catA', frequency: 'monthly' as const },
    { id: 'expB', name: 'B', categoryId: 'catB', frequency: 'monthly' as const },
  ]
  const btx = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    date: '2026-01-01',
    description: `Tx ${id}`,
    categoryId: 'other',
    amount: -10,
    ...extra,
  })

  it('most-common-wins across carriers of the same tag', () => {
    const txs = [
      btx('a', { autoTags: ['COSTCO'], spendExpenseId: 'expA', categoryId: 'catA' }),
      btx('b', { autoTags: ['COSTCO'], spendExpenseId: 'expA', categoryId: 'catA' }),
      btx('c', { autoTags: ['COSTCO'], spendExpenseId: 'expB', categoryId: 'catB' }),
      btx('d', { autoTags: ['COSTCO'], categoryId: 'other' }),
    ]
    const result = propagateSpendLinksByAutoTag(txs, defs)
    for (const t of result) {
      expect(t.spendExpenseId).toBe('expA')
      expect(t.categoryId).toBe('catA')
    }
  })

  it('ties resolve to first in input order', () => {
    const txs = [
      btx('a', { autoTags: ['TAG'], spendExpenseId: 'expB', categoryId: 'catB' }),
      btx('b', { autoTags: ['TAG'], spendExpenseId: 'expA', categoryId: 'catA' }),
      btx('c', { autoTags: ['TAG'], categoryId: 'other' }),
    ]
    const result = propagateSpendLinksByAutoTag(txs, defs)
    for (const t of result) {
      expect(t.spendExpenseId).toBe('expB')
      expect(t.categoryId).toBe('catB')
    }
  })

  it('multi-autoTag carriers overwrite in sorted tag order', () => {
    const txs = [
      btx('a', { autoTags: ['AAA'], spendExpenseId: 'expA', categoryId: 'catA' }),
      btx('b', { autoTags: ['ZZZ'], spendExpenseId: 'expB', categoryId: 'catB' }),
      btx('multi', { autoTags: ['AAA', 'ZZZ'], categoryId: 'other' }),
    ]
    const result = propagateSpendLinksByAutoTag(txs, defs)
    // Sorted tags: AAA first sets multi→expA, then ZZZ overwrites multi→expB.
    expect(result.find((t) => t.id === 'multi')).toMatchObject({ spendExpenseId: 'expB', categoryId: 'catB' })
    expect(result.find((t) => t.id === 'a')).toMatchObject({ spendExpenseId: 'expA', categoryId: 'catA' })
    expect(result.find((t) => t.id === 'b')).toMatchObject({ spendExpenseId: 'expB', categoryId: 'catB' })
  })

  it('singleton without a link is untouched', () => {
    const txs = [btx('solo', { autoTags: ['SOLO'], categoryId: 'other' })]
    const result = propagateSpendLinksByAutoTag(txs, defs)
    expect(result[0]).toEqual(txs[0])
    expect(result[0]).not.toHaveProperty('spendExpenseId')
  })

  it('dangling winner leaves carriers untouched', () => {
    const txs = [
      btx('a', { autoTags: ['TAG'], spendExpenseId: 'missing', categoryId: 'catX' }),
      btx('b', { autoTags: ['TAG'], categoryId: 'other' }),
    ]
    const result = propagateSpendLinksByAutoTag(txs, defs)
    expect(result).toEqual(txs)
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
    const result = importBudgetTransactions(state, [row], [{ id: 'other', name: 'Other', updatedAt: '' }], [], {
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
    const result = importBudgetTransactions(state, [], [], [], {
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
      { id: 'a', autoTags: ['COSTCOWHOL'] },
      { id: 'b', autoTags: ['COSTCOWHOL'] },
    ])
    expect(result.budgetTransactions[0]).not.toHaveProperty('tags')
    expect(result.budgetTransactions[1]).not.toHaveProperty('tags')
  })

  it('leaves user tags untouched when recomputing auto tags', () => {
    const state = {
      ...initialState(),
      budgetTransactions: [
        { id: 'a', date: '2024-06-01', description: 'COSTCO WHOLESALE #101', categoryId: 'other', amount: -50, tags: ['mine'] },
        { id: 'b', date: '2025-06-01', description: 'COSTCO WHOLESALE #202', categoryId: 'other', amount: -60, tags: ['mine'] },
      ],
    }
    const result = autoTagBudgetTransactions(state)
    expect(result.budgetTransactions).toMatchObject([
      { id: 'a', tags: ['mine'], autoTags: ['COSTCOWHOL'] },
      { id: 'b', tags: ['mine'], autoTags: ['COSTCOWHOL'] },
    ])
  })

  it('removes stale auto tags on recompute (singleton clears prior auto)', () => {
    const state = {
      ...initialState(),
      budgetTransactions: [
        { id: 'a', date: '2024-06-01', description: 'TOTALLY UNRELATED ALPHA XYZ', categoryId: 'other', amount: -50, tags: ['mine'], autoTags: ['STALE'] },
      ],
    }
    const result = autoTagBudgetTransactions(state)
    expect(result.budgetTransactions[0]).toMatchObject({ id: 'a', tags: ['mine'] })
    expect(result.budgetTransactions[0]).not.toHaveProperty('autoTags')
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

describe('clearBudgetTransactionTags / clearBudgetTransactionAutoTags scope split', () => {
  const both = (id: string) => ({
    id,
    date: '2025-01-01',
    description: `Tx ${id}`,
    categoryId: 'other',
    amount: -10,
    tags: ['Mine'],
    autoTags: ['AUTO'],
  })

  it('clear-user preserves auto tags', () => {
    const state = { ...initialState(), budgetTransactions: [both('a')] }
    const result = clearBudgetTransactionTags(state)
    expect(result.budgetTransactions[0]).not.toHaveProperty('tags')
    expect(result.budgetTransactions[0].autoTags).toEqual(['AUTO'])
  })

  it('clear-auto preserves user tags', () => {
    const state = { ...initialState(), budgetTransactions: [both('a')] }
    const result = clearBudgetTransactionAutoTags(state)
    expect(result.budgetTransactions[0]).not.toHaveProperty('autoTags')
    expect(result.budgetTransactions[0].tags).toEqual(['Mine'])
  })

  it('clear-auto omits the autoTags key (never autoTags: []) and leaves untagged records alone', () => {
    const state = {
      ...initialState(),
      budgetTransactions: [
        both('a'),
        { id: 'b', date: '2025-01-01', description: 'Tx b', categoryId: 'other', amount: -10, tags: ['Mine'] },
      ],
    }
    const result = clearBudgetTransactionAutoTags(state)
    expect(result.budgetTransactions[0]).not.toHaveProperty('autoTags')
    expect(result.budgetTransactions[1]).toEqual(state.budgetTransactions[1])
  })
})

describe('updateBudgetTransactionsBulk merged-set guards', () => {
  const btx = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    date: '2026-01-01',
    description: `Tx ${id}`,
    categoryId: 'other',
    amount: -10,
    ...extra,
  })

  it('refuses tagsToAdd duplicating an auto tag (case-insensitive)', () => {
    const state = { ...initialState(), budgetTransactions: [btx('a', { autoTags: ['COSTCOWHOL'] })] }
    const result = updateBudgetTransactionsBulk(state, ['a'], { categoryId: 'other', tagsToAdd: ['costcowhol', 'Fresh'] })
    expect(result.budgetTransactions[0].tags).toEqual(['Fresh'])
    expect(result.budgetTransactions[0].autoTags).toEqual(['COSTCOWHOL'])
  })

  it('refuses tagsToAdd when the combined user+auto count is already at cap', () => {
    const state = {
      ...initialState(),
      budgetTransactions: [btx('a', { tags: ['t1', 't2', 't3', 't4'], autoTags: ['a1'] })],
    }
    const result = updateBudgetTransactionsBulk(state, ['a'], { categoryId: 'other', tagsToAdd: ['sixth'] })
    expect(result.budgetTransactions[0].tags).toEqual(['t1', 't2', 't3', 't4'])
    expect(result.budgetTransactions[0].autoTags).toEqual(['a1'])
  })

  it('fills only remaining combined-cap slots, in order given', () => {
    const state = {
      ...initialState(),
      budgetTransactions: [btx('a', { tags: ['t1', 't2', 't3'], autoTags: ['a1'] })],
    }
    const result = updateBudgetTransactionsBulk(state, ['a'], { categoryId: 'other', tagsToAdd: ['n1', 'n2'] })
    expect(result.budgetTransactions[0].tags).toEqual(['t1', 't2', 't3', 'n1'])
  })
})

describe('importBudgetTransactions auto-tag', () => {
  const categories = [{ id: 'other', name: 'Other', updatedAt: '' }]
  const convention = { accountName: 'Checking', statementConvention: 'negativeSpend' as const }

  it('tags batch-internal clusters on import into autoTags (user tags untouched)', () => {
    const result = importBudgetTransactions(
      initialState(),
      [
        { date: '2026-01-01', description: 'COSTCO WHOLESALE #101', amount: -50 },
        { date: '2026-01-02', description: 'COSTCO WHOLESALE #202', amount: -60 },
      ],
      categories,
      [],
      convention
    )
    expect(result.budgetTransactions).toMatchObject([
      { description: 'COSTCO WHOLESALE #101', autoTags: ['COSTCOWHOL'] },
      { description: 'COSTCO WHOLESALE #202', autoTags: ['COSTCOWHOL'] },
    ])
    expect(result.budgetTransactions[0]).not.toHaveProperty('tags')
    expect(result.budgetTransactions[1]).not.toHaveProperty('tags')
  })

  it('keeps CSV-parsed batch tags as user tags alongside cluster auto tags', () => {
    const result = importBudgetTransactions(
      initialState(),
      [
        { date: '2026-01-01', description: 'COSTCO WHOLESALE #101', amount: -50, tags: ['receipt'] },
        { date: '2026-01-02', description: 'COSTCO WHOLESALE #202', amount: -60, tags: ['receipt'] },
      ],
      categories,
      [],
      convention
    )
    expect(result.budgetTransactions).toMatchObject([
      { description: 'COSTCO WHOLESALE #101', tags: ['receipt'], autoTags: ['COSTCOWHOL'] },
      { description: 'COSTCO WHOLESALE #202', tags: ['receipt'], autoTags: ['COSTCOWHOL'] },
    ])
  })

  it('skips the cluster auto tag when it clashes with an existing user tag (user casing wins)', () => {
    const result = importBudgetTransactions(
      initialState(),
      [
        { date: '2026-01-01', description: 'COSTCO WHOLESALE #101', amount: -50, tags: ['COSTCOWHOL'] },
        { date: '2026-01-02', description: 'COSTCO WHOLESALE #202', amount: -60, tags: ['COSTCOWHOL'] },
      ],
      categories,
      [],
      convention
    )
    expect(result.budgetTransactions).toMatchObject([
      { description: 'COSTCO WHOLESALE #101', tags: ['COSTCOWHOL'] },
      { description: 'COSTCO WHOLESALE #202', tags: ['COSTCOWHOL'] },
    ])
    expect(result.budgetTransactions[0]).not.toHaveProperty('autoTags')
    expect(result.budgetTransactions[1]).not.toHaveProperty('autoTags')
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
      convention
    )
    expect(result.budgetTransactions).toHaveLength(2)
    expect(result.budgetTransactions[0]).toEqual(state.budgetTransactions[0])
    expect(result.budgetTransactions[0]).not.toHaveProperty('tags')
    expect(result.budgetTransactions[1]).not.toHaveProperty('tags')
    expect(result.budgetTransactions[1]).not.toHaveProperty('autoTags')
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
      convention
    )
    expect(result.budgetTransactions).toHaveLength(1)
    expect(result.budgetTransactions[0].autoTags).toEqual(['COSTCOWHOL'])
  })

  it('resolveBudgetImportRows called directly does not auto-tag', () => {
    const { toAdd } = resolveBudgetImportRows(
      [],
      [
        { date: '2026-01-01', description: 'COSTCO WHOLESALE #101', amount: -50 },
        { date: '2026-01-02', description: 'COSTCO WHOLESALE #202', amount: -60 },
      ],
      categories,
      []
    )
    expect(toAdd).toHaveLength(2)
    expect(toAdd[0]).not.toHaveProperty('tags')
    expect(toAdd[1]).not.toHaveProperty('tags')
  })

  it('import batch links via existing tag', () => {
    const defs = [{ id: 'expA', name: 'A', categoryId: 'catA', frequency: 'monthly' as const }]
    const state = {
      ...initialState(),
      budgetExpenseDefinitions: defs,
      budgetTransactions: [
        {
          id: 'existing',
          date: '2025-01-01',
          description: 'COSTCO WHOLESALE #999',
          categoryId: 'catA',
          amount: -10,
          spendExpenseId: 'expA',
          autoTags: ['COSTCOWHOL'],
        },
      ],
    }
    const result = importBudgetTransactions(
      state,
      [
        { date: '2026-01-01', description: 'COSTCO WHOLESALE #101', amount: -50, autoTags: ['COSTCOWHOL'] },
        { date: '2026-01-02', description: 'COSTCO WHOLESALE #202', amount: -60, autoTags: ['COSTCOWHOL'] },
      ],
      [...categories, { id: 'catA', name: 'CatA', updatedAt: '' }],
      defs,
      convention
    )
    // applyAutoTags(rows) recomputes batch tags from descriptions; both rows
    // cluster to COSTCOWHOL which matches the existing carrier's tag.
    const added = result.budgetTransactions.slice(1)
    expect(added).toHaveLength(2)
    for (const t of added) {
      expect(t.spendExpenseId).toBe('expA')
      expect(t.categoryId).toBe('catA')
    }
  })
})

describe('updateBudgetTransactionsBulk spend-link cascade', () => {
  it('bulk explicit wins then cascades to autoTag siblings', () => {
    const defs = [
      { id: 'expA', name: 'A', categoryId: 'catA', frequency: 'monthly' as const },
      { id: 'expB', name: 'B', categoryId: 'catB', frequency: 'monthly' as const },
    ]
    const state = {
      ...initialState(),
      budgetExpenseDefinitions: defs,
      budgetTransactions: [
        { id: 'a', date: '2026-01-01', description: 'Tx a', categoryId: 'other', amount: -10, autoTags: ['SHARED'] },
        { id: 'b', date: '2026-01-02', description: 'Tx b', categoryId: 'other', amount: -20, autoTags: ['SHARED'] },
      ],
    }
    const result = updateBudgetTransactionsBulk(state, ['a'], { categoryId: 'catB', spendExpenseId: 'expB' })
    // Explicit patch applies to selected row first, then propagation
    // overwrites ALL carriers (overwrite-all-siblings).
    expect(result.budgetTransactions).toMatchObject([
      { id: 'a', spendExpenseId: 'expB', categoryId: 'catB' },
      { id: 'b', spendExpenseId: 'expB', categoryId: 'catB' },
    ])
  })
})
