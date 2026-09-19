import { describe, expect, it } from 'vitest'
import { buildExportableState } from './importExport'
import { initialState } from './state'

describe('budget backup export', () => {
  it('exports definitions, snapshots, and transactions without manual income', () => {
    const state = {
      ...initialState(),
      budgetExpenseDefinitions: [{ id: 'income', name: 'Salary', categoryId: 'income-category', frequency: 'monthly' as const }],
      budgetExpenseAmountsByYear: { '2025': { income: 1000 } },
      budgetTransactions: [{ id: 'pay', date: '2025-01-01', description: 'Paycheck', categoryId: 'income-category', amount: 1000 }],
    }
    const exported = buildExportableState(state)
    expect(exported.budgetExpenseDefinitions).toEqual(state.budgetExpenseDefinitions)
    expect(exported.budgetTransactions).toEqual(state.budgetTransactions)
    expect(exported).not.toHaveProperty('budgetIncomeByYear')
  })
})
