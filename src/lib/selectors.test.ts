import { describe, expect, it } from 'vitest'
import { actualIncomeForYear, budgetedIncomeForYear, isIncomeOrExcludedTransaction, yearTotalSpend } from './selectors'
import type { BudgetTransaction, Category, ExpenseDefinition } from './types'

const categories: Category[] = [
  { id: 'income', name: ' Income ', updatedAt: '' },
  { id: 'food', name: 'Food', updatedAt: '' },
  { id: 'other-income', name: 'Other Income', updatedAt: '' },
]
const definitions: ExpenseDefinition[] = [
  { id: 'salary', name: 'Salary', categoryId: 'income', frequency: 'monthly' },
  { id: 'bonus', name: 'Bonus', categoryId: 'income', frequency: 'yearly' },
  { id: 'groceries', name: 'Groceries', categoryId: 'food', frequency: 'monthly' },
]
const tx = (patch: Partial<BudgetTransaction>): BudgetTransaction => ({ id: 't', date: '2025-01-01', description: '', categoryId: 'food', amount: 1, ...patch })

describe('derived budget income', () => {
  it('annualizes exact active Income definitions for the selected year', () => {
    expect(budgetedIncomeForYear(definitions, { '2025': { salary: 1000, bonus: 5000 }, '2024': { salary: 1 } }, categories, '2025')).toBe(17000)
  })

  it('uses signed transactions and linked definition category authority', () => {
    const transactions = [tx({ id: 'income', categoryId: 'food', spendExpenseId: 'salary', amount: 1000 }), tx({ id: 'reversal', categoryId: 'income', amount: -100 })]
    expect(actualIncomeForYear(transactions, categories, definitions, '2025')).toBe(900)
    expect(isIncomeOrExcludedTransaction(transactions[0], categories, definitions)).toBe(true)
  })

  it('excludes Income from spend totals', () => {
    const transactions = [tx({ categoryId: 'income', amount: 5000 }), tx({ id: 'food', amount: 100 })]
    expect(yearTotalSpend(transactions, categories, '2025', definitions)).toBe(100)
  })
})
