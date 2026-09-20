import { describe, expect, it } from 'vitest'
import {
  addExpenseDefinition,
  ensureExpenseAmountsSnapshotForYear,
  importBudgetTransactions,
  initialState,
  reconcileBudgetAccountConventions,
  rolloverBudgetExpenseAmountsIfNeeded,
  stripEmptyBudgetSnapshots,
  updateExpenseDefinition,
} from './state'
import type { BudgetAccountRule, StatementConvention } from './types'

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
