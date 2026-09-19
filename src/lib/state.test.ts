import { describe, expect, it } from 'vitest'
import {
  addExpenseDefinition,
  ensureExpenseAmountsSnapshotForYear,
  initialState,
  rolloverBudgetExpenseAmountsIfNeeded,
  stripEmptyBudgetSnapshots,
  updateExpenseDefinition,
} from './state'

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
