import { describe, expect, it } from 'vitest'
import { appReducer } from './reducer'
import { autoTagBudgetTransactions, initialState } from './state'

describe('budget reducer', () => {
  it('ensures an expense snapshot without any manual-income action', () => {
    const state = { ...initialState(), budgetExpenseAmountsByYear: { '2024': { rent: 1000 } } }
    expect(appReducer(state, { type: 'ENSURE_BUDGET_YEAR_SNAPSHOT', year: '2025' }).budgetExpenseAmountsByYear['2025']).toEqual({ rent: 1000 })
  })

  it('reconciles transaction signs and records the applied convention', () => {
    const state = {
      ...initialState(),
      budgetTransactions: [{ id: 'tx', date: '2026-09-19', description: 'Store', categoryId: 'other', accountName: 'checking', amount: 10 }],
    }
    const result = appReducer(state, {
      type: 'RECONCILE_BUDGET_ACCOUNT_CONVENTIONS',
      rules: [{ normalizedName: 'checking', displayName: 'Checking', statementConvention: 'positiveSpend', updatedAt: '' }],
    })

    expect(result.budgetTransactions[0]).toMatchObject({ accountName: 'Checking', amount: -10 })
    expect(result.budgetAccountAppliedConventions).toEqual({ checking: 'positiveSpend' })
  })

  it('reverts signs after a rule is deleted', () => {
    const state = {
      ...initialState(),
      budgetTransactions: [{ id: 'tx', date: '2026-09-19', description: 'Store', categoryId: 'other', accountName: 'Checking', amount: -10 }],
      budgetAccountAppliedConventions: { checking: 'positiveSpend' as const },
    }
    const result = appReducer(state, {
      type: 'RECONCILE_BUDGET_ACCOUNT_CONVENTIONS',
      rules: [{ normalizedName: 'checking', displayName: 'Checking', statementConvention: 'positiveSpend', updatedAt: '', deletedAt: '2026-09-19T00:00:00.000Z' }],
    })

    expect(result.budgetTransactions[0].amount).toBe(10)
    expect(result.budgetAccountAppliedConventions).toEqual({ checking: 'negativeSpend' })
  })

  it('AUTO_TAG_BUDGET_TRANSACTIONS delegates to autoTagBudgetTransactions', () => {
    const state = {
      ...initialState(),
      budgetTransactions: [
        { id: 'a', date: '2024-06-01', description: 'COSTCO WHOLESALE #101', categoryId: 'other', amount: -50 },
        { id: 'b', date: '2025-06-01', description: 'COSTCO WHOLESALE #202', categoryId: 'other', amount: -60 },
      ],
    }
    const viaReducer = appReducer(state, { type: 'AUTO_TAG_BUDGET_TRANSACTIONS' })
    const direct = autoTagBudgetTransactions(state)
    expect(viaReducer).toEqual(direct)
    expect(viaReducer.budgetTransactions).toMatchObject([
      { id: 'a', tags: ['COSTCO WHOLESALE #'] },
      { id: 'b', tags: ['COSTCO WHOLESALE #'] },
    ])
  })
})
