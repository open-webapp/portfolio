import { describe, expect, it } from 'vitest'
import { actualIncomeForYear, budgetedIncomeForYear, expenseTableYears, isIncomeOrExcludedTransaction, mappingsForExpense, SPEND_ALL_YEARS, spendBudgetYears, spendCardTotals, spendTransactionsForScope, yearTotalSpend } from './selectors'
import type { BudgetTransaction, Category, CategoryMapping, ExpenseDefinition } from './types'

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

describe('expenseTableYears', () => {
  const now = new Date(2026, 8, 19)

  it('returns the ascending union of the current year, transaction years, and amount snapshot years', () => {
    expect(expenseTableYears(
      [tx({ date: '2024-01-01' }), tx({ id: 'later', date: '2027-12-31' })],
      { '2023': {}, '2025': {} },
      now
    )).toEqual(['2023', '2024', '2025', '2026', '2027'])
  })

  it('deduplicates years and returns only the current year without transaction or amount data', () => {
    expect(expenseTableYears(
      [tx({ date: '2026-01-01' }), tx({ id: 'duplicate', date: '2026-02-01' })],
      { '2026': {}, '2025': {} },
      now
    )).toEqual(['2025', '2026'])
    expect(expenseTableYears([], {}, now)).toEqual(['2026'])
  })

  it('includes malformed legacy date prefixes and amount keys without throwing', () => {
    expect(expenseTableYears(
      [tx({ date: 'bad' }), tx({ id: 'short', date: '20' })],
      { invalid: {}, '': {} },
      now
    )).toEqual(['', '20', '2026', 'bad', 'invalid'])
  })
})

describe('Spend scopes', () => {
  const spendCategories: Category[] = [
    ...categories,
    { id: 'ignored', name: 'Ignored', updatedAt: '', excludeFromSpend: true },
  ]
  const spendDefinitions: ExpenseDefinition[] = [
    ...definitions,
    { id: 'rent', name: 'Rent', categoryId: 'food', frequency: 'yearly' },
    { id: 'ignored-definition', name: 'Ignored', categoryId: 'ignored', frequency: 'monthly' },
  ]
  const transactions = [
    tx({ id: 'food-2025', date: '2025-01-01', amount: 100 }),
    tx({ id: 'income-2024', date: '2024-01-01', categoryId: 'income', amount: 1000 }),
    tx({ id: 'excluded-2023', date: '2023-01-01', categoryId: 'ignored', amount: 50 }),
    tx({ id: 'food-2024', date: '2024-02-01', amount: 20 }),
  ]

  it('uses every transaction category to derive unique descending Spend years', () => {
    expect(spendBudgetYears(transactions)).toEqual(['2025', '2024', '2023'])
    expect(spendBudgetYears([])).toEqual([])
    expect(spendBudgetYears([],)).not.toContain('2026')
  })

  it('filters all and concrete Spend scopes without period-selector sentinels', () => {
    expect(spendTransactionsForScope(transactions, SPEND_ALL_YEARS)).toEqual(transactions)
    expect(spendTransactionsForScope(transactions, '2024')).toEqual([transactions[1], transactions[3]])
  })

  it('sums exact-year card totals across all transaction-backed years', () => {
    const amountsByYear = {
      '2025': { salary: 100, bonus: 500, groceries: 40, rent: 300, 'ignored-definition': 20 },
      '2024': { salary: 50, bonus: 200, groceries: 30, rent: 400, 'ignored-definition': 10 },
      '2022': { salary: 999, groceries: 999 },
    }
    const all = spendCardTotals(spendDefinitions, amountsByYear, transactions, spendCategories, SPEND_ALL_YEARS)
    const separate = ['2025', '2024', '2023'].map((year) => spendCardTotals(spendDefinitions, amountsByYear, transactions, spendCategories, year))
    expect(all).toEqual(separate.reduce(
      (sum, totals) => ({
        budgetedIncome: sum.budgetedIncome + totals.budgetedIncome,
        actualIncome: sum.actualIncome + totals.actualIncome,
        budgetedSpend: sum.budgetedSpend + totals.budgetedSpend,
        actualSpend: sum.actualSpend + totals.actualSpend,
        variance: sum.variance + totals.variance,
      }),
      { budgetedIncome: 0, actualIncome: 0, budgetedSpend: 0, actualSpend: 0, variance: 0 }
    ))
    expect(all).toEqual({ budgetedIncome: 2500, actualIncome: 1000, budgetedSpend: 770, actualSpend: 120, variance: 650 })
  })

  it('uses zero budgets for missing exact snapshots and ignores snapshot-only years', () => {
    const amountsByYear = { '2025': { groceries: 100 }, '2022': { groceries: 900 } }
    expect(spendCardTotals(spendDefinitions, amountsByYear, transactions, spendCategories, '2024')).toEqual({
      budgetedIncome: 0, actualIncome: 1000, budgetedSpend: 0, actualSpend: 20, variance: -20,
    })
    expect(spendCardTotals(spendDefinitions, amountsByYear, transactions, spendCategories, SPEND_ALL_YEARS).budgetedSpend).toBe(100)
  })

  it('uses linked definition categories and preserves signed income', () => {
    const linked = [
      tx({ id: 'linked-income', date: '2025-01-01', categoryId: 'food', spendExpenseId: 'salary', amount: 100 }),
      tx({ id: 'reversal', date: '2025-01-02', categoryId: 'income', amount: -25 }),
      tx({ id: 'linked-excluded', date: '2025-01-03', categoryId: 'food', spendExpenseId: 'ignored-definition', amount: 50 }),
    ]
    expect(spendCardTotals(spendDefinitions, {}, linked, spendCategories, '2025')).toEqual({
      budgetedIncome: 0, actualIncome: 75, budgetedSpend: 0, actualSpend: 0, variance: 0,
    })
  })

  it('matches existing exact-year income and spend selectors', () => {
    const amountsByYear = { '2025': { salary: 100, bonus: 500, groceries: 40, rent: 300 } }
    const totals = spendCardTotals(spendDefinitions, amountsByYear, transactions, spendCategories, '2025')
    expect(totals.budgetedIncome).toBe(budgetedIncomeForYear(spendDefinitions, amountsByYear, spendCategories, '2025'))
    expect(totals.actualIncome).toBe(actualIncomeForYear(transactions, spendCategories, spendDefinitions, '2025'))
    expect(totals.actualSpend).toBe(yearTotalSpend(transactions, spendCategories, '2025', spendDefinitions))
    expect(totals.budgetedSpend).toBe(340)
    expect(totals.variance).toBe(240)
  })
})

describe('mappingsForExpense', () => {
  it('excludes tombstoned mappings while preserving substring sort', () => {
    const mappings = [
      { id: 'zebra', spendExpenseId: 'groceries', substring: 'zebra' },
      { id: 'deleted', spendExpenseId: 'groceries', substring: 'apple', deletedAt: '2026-09-19T00:00:00.000Z' },
      { id: 'alpha', spendExpenseId: 'groceries', substring: 'alpha' },
      { id: 'other', spendExpenseId: 'salary', substring: 'aardvark' }
    ] as CategoryMapping[]

    expect(mappingsForExpense(mappings, 'groceries').map((mapping) => mapping.id)).toEqual(['alpha', 'zebra'])
  })
})
