import { describe, expect, it } from 'vitest'
import { acctFilteredClosedPositions, acctFilteredPositions, acctScopedPositions, actualByCategory, actualIncomeForYear, budgetedIncomeForYear, categoryBreakdown, categoryCards, closedPositionsCard, computeRecurringSpendIds, expenseTableYears, isIncomeOrExcludedTransaction, overBudgetCategories, overBudgetCategoriesForScope, projectedSpendForScope, sankeyFlowData, savingsRateByYear, savingsRateForScope, SPEND_ALL_YEARS, spendBudgetYears, spendCardTotals, spendPaceForScope, spendScopeKind, spendTransactionsForScope, yearElapsedFraction, yearTotalSpend } from './selectors'
import { toPeriod } from './computations'
import { initialState } from './state'
import type { Account, BudgetTransaction, Category, ExpenseDefinition } from './types'

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
    const transactions = [tx({ categoryId: 'income', amount: 5000 }), tx({ id: 'food', amount: -100 })]
    expect(yearTotalSpend(transactions, categories, '2025', definitions)).toBe(100)
  })

  it('reports debit-signed expenses as positive spend across totals and categories', () => {
    const transactions = [tx({ id: 'groceries', amount: -527 })]
    expect(yearTotalSpend(transactions, categories, '2025', definitions)).toBe(527)
    expect(actualByCategory(transactions, definitions, categories)).toEqual({ food: 527 })
    expect(spendCardTotals(definitions, { '2025': { groceries: 315 } }, transactions, categories, '2025')).toMatchObject({
      actualSpend: 527,
      variance: 3253,
    })
  })
})

describe('categoryBreakdown', () => {
  it('scales each category against its own budget and actual totals', () => {
    const categoryDefs: ExpenseDefinition[] = [
      { id: 'housing', name: 'Housing', categoryId: 'housing', frequency: 'yearly' },
      { id: 'utilities', name: 'Utilities', categoryId: 'utilities', frequency: 'yearly' },
    ]
    const categoryList: Category[] = [
      { id: 'housing', name: 'Housing', updatedAt: '' },
      { id: 'utilities', name: 'Utilities', updatedAt: '' },
    ]

    expect(categoryBreakdown(
      categoryDefs,
      { housing: 1000, utilities: 100 },
      [tx({ id: 'housing', categoryId: 'housing', amount: -500 }), tx({ id: 'utilities', categoryId: 'utilities', amount: -50 })],
      categoryList
    )).toMatchObject([
      { name: 'Housing', budgetPct: 100, actualPct: 50 },
      { name: 'Utilities', budgetPct: 100, actualPct: 50 },
    ])
  })

  it('provides drill lines for each definition and no unlinked actual when all spend is linked', () => {
    const categoryDefs: ExpenseDefinition[] = [
      { id: 'groceries', name: 'Groceries', categoryId: 'food', frequency: 'monthly' },
      { id: 'dining', name: 'Dining', categoryId: 'food', frequency: 'yearly' },
    ]
    const result = categoryBreakdown(
      categoryDefs,
      { groceries: 100, dining: 500 },
      [
        tx({ id: 'groceries-tx', spendExpenseId: 'groceries', amount: -75 }),
        tx({ id: 'dining-tx', spendExpenseId: 'dining', amount: -600 }),
      ],
      [{ id: 'food', name: 'Food', updatedAt: '' }]
    )

    expect(result).toMatchObject([{
      categoryId: 'food',
      actual: 675,
      unlinkedActual: null,
      drillLines: [
        { id: 'groceries', name: 'Groceries', frequencyLabel: 'Monthly', budget: 1200, actual: 75, variance: 1125, budgetPct: 100, actualPct: 6.25 },
        { id: 'dining', name: 'Dining', frequencyLabel: 'Yearly', budget: 500, actual: 600, variance: -100, budgetPct: 83.33333333333334, actualPct: 100 },
      ],
    }])
  })

  it('reconciles linked and unlinked actual spend within a category', () => {
    const result = categoryBreakdown(
      [{ id: 'groceries', name: 'Groceries', categoryId: 'food', frequency: 'yearly' }],
      { groceries: 500 },
      [
        tx({ id: 'linked', spendExpenseId: 'groceries', amount: -100 }),
        tx({ id: 'unlinked', amount: -30 }),
        tx({ id: 'stale-link', spendExpenseId: 'missing', amount: -20 }),
      ],
      [{ id: 'food', name: 'Food', updatedAt: '' }]
    )[0]

    expect(result.unlinkedActual).toBe(50)
    expect(result.drillLines[0]).toMatchObject({ budget: 500, actual: 100, variance: 400 })
    expect(result.drillLines.reduce((sum, line) => sum + line.actual, 0) + (result.unlinkedActual ?? 0)).toBe(result.actual)
  })

  it('returns all actual spend as unlinked when a category has no definitions', () => {
    const result = categoryBreakdown(
      [],
      {},
      [tx({ id: 'food-tx', amount: -80 })],
      [{ id: 'food', name: 'Food', updatedAt: '' }]
    )

    expect(result).toMatchObject([{ categoryId: 'food', actual: 80, drillLines: [], unlinkedActual: 80 }])
  })

  it('returns null unlinked actual for a definition-free category with no spend', () => {
    expect(categoryBreakdown([], {}, [], [{ id: 'food', name: 'Food', updatedAt: '' }])).toMatchObject([
      { categoryId: 'food', actual: 0, drillLines: [], unlinkedActual: null },
    ])
  })

  it('omits excluded categories entirely rather than emitting empty drilldown data', () => {
    const result = categoryBreakdown(
      [{ id: 'ignored-expense', name: 'Ignored expense', categoryId: 'ignored', frequency: 'yearly' }],
      { 'ignored-expense': 100 },
      [tx({ id: 'ignored-tx', categoryId: 'ignored', amount: -50 })],
      [{ id: 'ignored', name: 'Ignored', updatedAt: '', excludeFromSpend: true }]
    )

    expect(result.find((row) => row.categoryId === 'ignored')).toBeUndefined()
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
    tx({ id: 'food-2025', date: '2025-01-01', amount: -100 }),
    tx({ id: 'income-2024', date: '2024-01-01', categoryId: 'income', amount: 1000 }),
    tx({ id: 'excluded-2023', date: '2023-01-01', categoryId: 'ignored', amount: -50 }),
    tx({ id: 'food-2024', date: '2024-02-01', amount: -20 }),
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
    expect(all).toEqual({ budgetedIncome: 2500, actualIncome: 1000, budgetedSpend: 1540, actualSpend: 120, variance: 1420 })
  })

  it('uses zero budgets for missing exact snapshots and ignores snapshot-only years', () => {
    const amountsByYear = { '2025': { groceries: 100 }, '2022': { groceries: 900 } }
    expect(spendCardTotals(spendDefinitions, amountsByYear, transactions, spendCategories, '2024')).toEqual({
      budgetedIncome: 0, actualIncome: 1000, budgetedSpend: 0, actualSpend: 20, variance: -20,
    })
    expect(spendCardTotals(spendDefinitions, amountsByYear, transactions, spendCategories, SPEND_ALL_YEARS).budgetedSpend).toBe(1200)
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
    expect(totals.budgetedSpend).toBe(780)
    expect(totals.variance).toBe(680)
  })
})

describe('projectedSpendForScope', () => {
  const foodCategory: Category[] = [{ id: 'food', name: 'Food', updatedAt: '' }]
  const yearlyFoodDefinition: ExpenseDefinition[] = [{ id: 'food-budget', name: 'Food', categoryId: 'food', frequency: 'yearly' }]
  const monthlyFoodDefinition: ExpenseDefinition[] = [{ id: 'food-budget', name: 'Food', categoryId: 'food', frequency: 'monthly' }]
  const midYear = new Date(2025, 6, 1) // fraction = 0.5 (181/365, ~mid-year; exact value from yearElapsedFraction)

  it('counts a yearly-linked expense at actual, never extrapolated', () => {
    const fraction = yearElapsedFraction(2025, midYear)
    const result = projectedSpendForScope(
      yearlyFoodDefinition,
      { '2025': { 'food-budget': 1200 } },
      [tx({ amount: -1200, date: '2025-01-15', spendExpenseId: 'food-budget' })],
      foodCategory,
      '2025',
      midYear
    )
    expect(fraction).toBeLessThan(1)
    expect(result?.projectedTotal).toBe(1200)
    expect(result?.budgetTotal).toBe(1200)
  })

  it('extrapolates a monthly-linked expense by the elapsed fraction', () => {
    const fraction = yearElapsedFraction(2025, midYear)
    const result = projectedSpendForScope(
      monthlyFoodDefinition,
      { '2025': { 'food-budget': 100 } },
      [tx({ amount: -600, date: '2025-03-01', spendExpenseId: 'food-budget' })],
      foodCategory,
      '2025',
      midYear
    )
    expect(result?.projectedTotal).toBeCloseTo(600 / fraction)
  })

  it('extrapolates unlinked spend the same way as monthly-linked spend', () => {
    const fraction = yearElapsedFraction(2025, midYear)
    const result = projectedSpendForScope(
      [],
      {},
      [tx({ amount: -600, date: '2025-03-01' })],
      foodCategory,
      '2025',
      midYear
    )
    expect(result?.projectedTotal).toBeCloseTo(600 / fraction)
  })

  it('sums yearly-actual plus extrapolated-other within the same category', () => {
    const fraction = yearElapsedFraction(2025, midYear)
    const mixedDefinitions: ExpenseDefinition[] = [
      { id: 'yearly-bill', name: 'Yearly Bill', categoryId: 'food', frequency: 'yearly' },
      { id: 'monthly-bill', name: 'Monthly Bill', categoryId: 'food', frequency: 'monthly' },
    ]
    const result = projectedSpendForScope(
      mixedDefinitions,
      { '2025': { 'yearly-bill': 1200, 'monthly-bill': 100 } },
      [
        tx({ id: 'y', amount: -1200, date: '2025-01-15', spendExpenseId: 'yearly-bill' }),
        tx({ id: 'm', amount: -300, date: '2025-03-01', spendExpenseId: 'monthly-bill' }),
      ],
      foodCategory,
      '2025',
      midYear
    )
    expect(result?.projectedTotal).toBeCloseTo(1200 + 300 / fraction)
  })

  it('never divides by zero or produces Infinity/NaN on the first day of the year', () => {
    const asOf = new Date(2025, 0, 1)
    const fraction = yearElapsedFraction(2025, asOf)
    const result = projectedSpendForScope(
      [],
      {},
      [tx({ amount: -100, date: '2025-01-01' })],
      foodCategory,
      '2025',
      asOf
    )
    expect(fraction).toBeGreaterThan(0)
    expect(result?.projectedTotal).toBeCloseTo(100 / fraction)
    expect(Number.isFinite(result?.projectedTotal)).toBe(true)
    expect(result?.projectedTotal).not.toBe(0)
  })

  it('excludes income/excluded category spend from projections', () => {
    const incomeCategories: Category[] = [{ id: 'income', name: 'Income', updatedAt: '' }]
    const result = projectedSpendForScope(
      [],
      {},
      [tx({ amount: -1000, date: '2025-03-01', categoryId: 'income' })],
      incomeCategories,
      '2025',
      midYear
    )
    expect(result?.projectedTotal).toBe(0)
  })

  it('returns null for the unbounded all-years scope', () => {
    expect(projectedSpendForScope(yearlyFoodDefinition, {}, [], foodCategory, SPEND_ALL_YEARS, midYear)).toBeNull()
  })

  it('uses actual spend as-is (no extrapolation) for a past year', () => {
    const result = projectedSpendForScope(
      [],
      {},
      [tx({ amount: -800, date: '2023-12-31' })],
      foodCategory,
      '2023',
      midYear
    )
    expect(result?.projectedTotal).toBe(800)
  })

  it('uses actual spend as-is (no extrapolation) for a future year', () => {
    const result = projectedSpendForScope(
      [],
      {},
      [tx({ amount: -800, date: '2030-01-01' })],
      foodCategory,
      '2030',
      midYear
    )
    expect(result?.projectedTotal).toBe(800)
  })

  it('flags isOverBudget with pctOver 0 when budgetTotal is zero and there is spend', () => {
    const result = projectedSpendForScope(
      [],
      {},
      [tx({ amount: -100, date: '2025-03-01' })],
      foodCategory,
      '2025',
      midYear
    )
    expect(result?.budgetTotal).toBe(0)
    expect(result?.pctOver).toBe(0)
    expect(result?.isOverBudget).toBe(true)
  })

  it('flags isOverBudget false with pctOver 0 when budgetTotal and spend are both zero', () => {
    expect(projectedSpendForScope([], {}, [], foodCategory, '2025', midYear)).toEqual({
      projectedTotal: 0,
      budgetTotal: 0,
      pctOver: 0,
      isOverBudget: false
    })
  })
})

describe('overBudgetCategories', () => {
  const overBudgetCategoriesList: Category[] = [
    { id: 'food', name: 'Food', updatedAt: '' },
    { id: 'rent', name: 'Rent', updatedAt: '' },
    { id: 'travel', name: 'Travel', updatedAt: '' },
  ]
  const overBudgetDefinitions: ExpenseDefinition[] = [
    { id: 'food-budget', name: 'Food', categoryId: 'food', frequency: 'yearly' },
    { id: 'rent-budget', name: 'Rent', categoryId: 'rent', frequency: 'yearly' },
    { id: 'travel-budget', name: 'Travel', categoryId: 'travel', frequency: 'yearly' },
  ]

  it('returns an over-budget category with its overage amount and percentage', () => {
    expect(overBudgetCategories(
      overBudgetDefinitions,
      { '2025': { 'food-budget': 100 } },
      [tx({ amount: -150 })],
      overBudgetCategoriesList,
      '2025'
    )).toEqual([{ categoryId: 'food', label: 'Food', overageAmount: 50, pctOver: 50 }])
  })

  it('sorts multiple overages from largest to smallest', () => {
    expect(overBudgetCategories(
      overBudgetDefinitions,
      { '2025': { 'food-budget': 100, 'rent-budget': 300 } },
      [tx({ amount: -150 }), tx({ id: 'rent', categoryId: 'rent', amount: -500 })],
      overBudgetCategoriesList,
      '2025'
    ).map((item) => item.categoryId)).toEqual(['rent', 'food'])
  })

  it('excludes categories exactly at budget', () => {
    expect(overBudgetCategories(
      overBudgetDefinitions,
      { '2025': { 'food-budget': 100 } },
      [tx({ amount: -100 })],
      overBudgetCategoriesList,
      '2025'
    )).toEqual([])
  })

  it('uses Infinity pctOver for unbudgeted actual spend', () => {
    expect(overBudgetCategories(
      overBudgetDefinitions,
      { '2025': { 'travel-budget': 0 } },
      [tx({ id: 'travel', categoryId: 'travel', amount: -25 })],
      overBudgetCategoriesList,
      '2025'
    )).toEqual([{ categoryId: 'travel', label: 'Travel', overageAmount: 25, pctOver: Infinity }])
  })

  it('returns no action items for an empty scope', () => {
    expect(overBudgetCategories(overBudgetDefinitions, { '2025': { 'food-budget': 100 } }, [], overBudgetCategoriesList, '2025')).toEqual([])
  })
})

describe('overBudgetCategoriesForScope', () => {
  it('flags a category as over budget only once its summed multi-year actual exceeds its summed multi-year budget', () => {
    const categories: Category[] = [{ id: 'x', name: 'X', updatedAt: '' }]
    const definitions: ExpenseDefinition[] = [{ id: 'x-budget', name: 'X', categoryId: 'x', frequency: 'yearly' }]
    // 2025 alone: budget 100, actual 90 -> under. 2024 alone: budget clamps to 0, actual 0 -> not over.
    // Summed raw budget (100 + -80 = 20) is what's compared against summed actual (90), so combined is over.
    const amountsByYear = { '2025': { 'x-budget': 100 }, '2024': { 'x-budget': -80 } }
    const transactions = [
      tx({ id: 't1', date: '2025-06-01', categoryId: 'x', amount: -90 }),
      tx({ id: 't2', date: '2024-01-01', categoryId: 'x', amount: 0 }),
    ]

    expect(overBudgetCategoriesForScope(definitions, amountsByYear, transactions, categories, '2025')).toEqual([])
    expect(overBudgetCategoriesForScope(definitions, amountsByYear, transactions, categories, '2024')).toEqual([])
    expect(overBudgetCategoriesForScope(definitions, amountsByYear, transactions, categories, SPEND_ALL_YEARS)).toEqual([
      { categoryId: 'x', label: 'X', overageAmount: 70, pctOver: 350, status: 'over' },
    ])
  })

  it('delegates concrete-year scope to overBudgetCategories', () => {
    const categories: Category[] = [{ id: 'food', name: 'Food', updatedAt: '' }]
    const definitions: ExpenseDefinition[] = [{ id: 'food-budget', name: 'Food', categoryId: 'food', frequency: 'yearly' }]
    const amountsByYear = { '2025': { 'food-budget': 100 } }
    const transactions = [tx({ amount: -150 })]
    expect(overBudgetCategoriesForScope(definitions, amountsByYear, transactions, categories, '2025'))
      .toEqual(overBudgetCategories(definitions, amountsByYear, transactions, categories, '2025').map((row) => ({ ...row, status: 'over' })))
  })

  it('without asOfDate, only returns status: over rows (unchanged behavior)', () => {
    const categories: Category[] = [{ id: 'food', name: 'Food', updatedAt: '' }]
    const definitions: ExpenseDefinition[] = [{ id: 'food-budget', name: 'Food', categoryId: 'food', frequency: 'yearly' }]
    const amountsByYear = { '2025': { 'food-budget': 100 } }
    const transactions = [tx({ amount: -150 })]
    expect(overBudgetCategoriesForScope(definitions, amountsByYear, transactions, categories, '2025')).toEqual([
      { categoryId: 'food', label: 'Food', overageAmount: 50, pctOver: 50, status: 'over' },
    ])
  })

  it('flags a category under budget today as projected/amber when frequency-aware projection exceeds its budget', () => {
    const categories: Category[] = [{ id: 'travel', name: 'Travel', updatedAt: '' }]
    const definitions: ExpenseDefinition[] = [{ id: 'travel-budget', name: 'Travel', categoryId: 'travel', frequency: 'monthly' }]
    const amountsByYear = { '2025': { 'travel-budget': 100 } } // annualized budget 1200
    // Half the year elapsed (fraction .5), actual 700 so far -> projected 1400, under budget today but over on projection.
    const asOfDate = new Date('2025-07-02T00:00:00Z')
    const transactions = [tx({ date: '2025-02-01', categoryId: 'travel', amount: -700, spendExpenseId: 'travel-budget' })]

    const fraction = yearElapsedFraction(2025, asOfDate)
    const projected = 700 / fraction
    const result = overBudgetCategoriesForScope(definitions, amountsByYear, transactions, categories, '2025', asOfDate)
    expect(result).toEqual([
      { categoryId: 'travel', label: 'Travel', overageAmount: expect.closeTo(projected - 1200, 5), pctOver: expect.closeTo((projected / 1200 - 1) * 100, 5), status: 'projected' },
    ])
  })

  it('does not flag a yearly-linked lump sum within its yearly budget as amber, even though naive straight-line projection would', () => {
    const categories: Category[] = [{ id: 'insurance', name: 'Insurance', updatedAt: '' }]
    const definitions: ExpenseDefinition[] = [{ id: 'insurance-budget', name: 'Insurance', categoryId: 'insurance', frequency: 'yearly' }]
    const amountsByYear = { '2025': { 'insurance-budget': 1000 } }
    // Paid once in January, in full, within budget. Naive straight-line projection (fraction ~ small) would blow this up.
    const asOfDate = new Date('2025-02-01T00:00:00Z')
    const transactions = [tx({ date: '2025-01-15', categoryId: 'insurance', amount: -1000, spendExpenseId: 'insurance-budget' })]

    const result = overBudgetCategoriesForScope(definitions, amountsByYear, transactions, categories, '2025', asOfDate)
    expect(result).toEqual([])
  })

  it('a category already over budget today appears only once, as status: over, never duplicated as projected', () => {
    const categories: Category[] = [{ id: 'food', name: 'Food', updatedAt: '' }]
    const definitions: ExpenseDefinition[] = [{ id: 'food-budget', name: 'Food', categoryId: 'food', frequency: 'monthly' }]
    const amountsByYear = { '2025': { 'food-budget': 50 } } // annualized 600
    const asOfDate = new Date('2025-07-02T00:00:00Z')
    const transactions = [tx({ date: '2025-02-01', categoryId: 'food', amount: -700, spendExpenseId: 'food-budget' })]

    const result = overBudgetCategoriesForScope(definitions, amountsByYear, transactions, categories, '2025', asOfDate)
    expect(result).toEqual([
      { categoryId: 'food', label: 'Food', overageAmount: 100, pctOver: expect.closeTo((700 / 600 - 1) * 100, 5), status: 'over' },
    ])
  })

  it('past-year scope with asOfDate returns no amber rows (only over, identical to no-asOfDate call)', () => {
    const categories: Category[] = [{ id: 'travel', name: 'Travel', updatedAt: '' }]
    const definitions: ExpenseDefinition[] = [{ id: 'travel-budget', name: 'Travel', categoryId: 'travel', frequency: 'monthly' }]
    const amountsByYear = { '2024': { 'travel-budget': 100 } }
    const asOfDate = new Date('2025-07-02T00:00:00Z')
    const transactions = [tx({ date: '2024-02-01', categoryId: 'travel', amount: -700, spendExpenseId: 'travel-budget' })]

    const withAsOf = overBudgetCategoriesForScope(definitions, amountsByYear, transactions, categories, '2024', asOfDate)
    const withoutAsOf = overBudgetCategoriesForScope(definitions, amountsByYear, transactions, categories, '2024')
    expect(withAsOf).toEqual(withoutAsOf)
    expect(withAsOf.every((row) => row.status === 'over')).toBe(true)
  })

  it('all-years scope with asOfDate returns no amber rows', () => {
    const categories: Category[] = [{ id: 'travel', name: 'Travel', updatedAt: '' }]
    const definitions: ExpenseDefinition[] = [{ id: 'travel-budget', name: 'Travel', categoryId: 'travel', frequency: 'monthly' }]
    const amountsByYear = { '2025': { 'travel-budget': 100 } }
    const asOfDate = new Date('2025-07-02T00:00:00Z')
    const transactions = [tx({ date: '2025-02-01', categoryId: 'travel', amount: -700, spendExpenseId: 'travel-budget' })]

    const result = overBudgetCategoriesForScope(definitions, amountsByYear, transactions, categories, SPEND_ALL_YEARS, asOfDate)
    expect(result.every((row) => row.status === 'over')).toBe(true)
  })

  it('zero-budget category with spend, current year: still over with Infinity pctOver, with or without asOfDate', () => {
    const categories: Category[] = [{ id: 'travel', name: 'Travel', updatedAt: '' }]
    const definitions: ExpenseDefinition[] = [{ id: 'travel-budget', name: 'Travel', categoryId: 'travel', frequency: 'yearly' }]
    const amountsByYear = { '2025': { 'travel-budget': 0 } }
    const asOfDate = new Date('2025-07-02T00:00:00Z')
    const transactions = [tx({ date: '2025-02-01', categoryId: 'travel', amount: -25, spendExpenseId: 'travel-budget' })]

    const withoutAsOf = overBudgetCategoriesForScope(definitions, amountsByYear, transactions, categories, '2025')
    const withAsOf = overBudgetCategoriesForScope(definitions, amountsByYear, transactions, categories, '2025', asOfDate)
    expect(withoutAsOf).toEqual([{ categoryId: 'travel', label: 'Travel', overageAmount: 25, pctOver: Infinity, status: 'over' }])
    expect(withAsOf).toEqual([{ categoryId: 'travel', label: 'Travel', overageAmount: 25, pctOver: Infinity, status: 'over' }])
  })

  it('sorts over rows before projected rows, each group by overage descending', () => {
    const categories: Category[] = [
      { id: 'food', name: 'Food', updatedAt: '' },
      { id: 'rent', name: 'Rent', updatedAt: '' },
      { id: 'travel', name: 'Travel', updatedAt: '' },
      { id: 'fun', name: 'Fun', updatedAt: '' },
    ]
    const definitions: ExpenseDefinition[] = [
      { id: 'food-budget', name: 'Food', categoryId: 'food', frequency: 'monthly' },
      { id: 'rent-budget', name: 'Rent', categoryId: 'rent', frequency: 'monthly' },
      { id: 'travel-budget', name: 'Travel', categoryId: 'travel', frequency: 'monthly' },
      { id: 'fun-budget', name: 'Fun', categoryId: 'fun', frequency: 'monthly' },
    ]
    const amountsByYear = {
      '2025': { 'food-budget': 50, 'rent-budget': 200, 'travel-budget': 100, 'fun-budget': 40 },
    } // annualized: food 600, rent 2400, travel 1200, fun 480
    const asOfDate = new Date('2025-07-02T00:00:00Z') // fraction .5
    const transactions = [
      // food: already over today (actual 700 > 600)
      tx({ id: 't-food', date: '2025-02-01', categoryId: 'food', amount: -700, spendExpenseId: 'food-budget' }),
      // rent: already over today by more (actual 3000 > 2400)
      tx({ id: 't-rent', date: '2025-02-01', categoryId: 'rent', amount: -3000, spendExpenseId: 'rent-budget' }),
      // travel: under today (actual 700 <= 1200) but projected 1400 > 1200
      tx({ id: 't-travel', date: '2025-02-01', categoryId: 'travel', amount: -700, spendExpenseId: 'travel-budget' }),
      // fun: under today (actual 260 <= 480) and projected 520 > 480
      tx({ id: 't-fun', date: '2025-02-01', categoryId: 'fun', amount: -260, spendExpenseId: 'fun-budget' }),
    ]

    const result = overBudgetCategoriesForScope(definitions, amountsByYear, transactions, categories, '2025', asOfDate)
    expect(result.map((r) => ({ categoryId: r.categoryId, status: r.status }))).toEqual([
      { categoryId: 'rent', status: 'over' },
      { categoryId: 'food', status: 'over' },
      { categoryId: 'travel', status: 'projected' },
      { categoryId: 'fun', status: 'projected' },
    ])
  })

  it('excludes an excluded category from both over and projected lists', () => {
    const categories: Category[] = [{ id: 'internal', name: 'Internal Transfer', updatedAt: '', excludeFromSpend: true }]
    const definitions: ExpenseDefinition[] = [{ id: 'internal-budget', name: 'Internal Transfer', categoryId: 'internal', frequency: 'monthly' }]
    const amountsByYear = { '2025': { 'internal-budget': 10 } }
    const asOfDate = new Date('2025-07-02T00:00:00Z')
    const transactions = [tx({ date: '2025-02-01', categoryId: 'internal', amount: -1000, spendExpenseId: 'internal-budget' })]

    const result = overBudgetCategoriesForScope(definitions, amountsByYear, transactions, categories, '2025', asOfDate)
    expect(result).toEqual([])
  })
})

describe('sankeyFlowData', () => {
  const sankeyCategories: Category[] = [
    { id: 'food', name: 'Food', updatedAt: '' },
    { id: 'rent', name: 'Rent', updatedAt: '' },
  ]
  const sankeyDefinitions: ExpenseDefinition[] = [
    { id: 'food-budget', name: 'Food', categoryId: 'food', frequency: 'yearly' },
    { id: 'rent-budget', name: 'Rent', categoryId: 'rent', frequency: 'yearly' },
  ]

  it('matches budget and actual category heights with no Unspent flow when on budget', () => {
    const result = sankeyFlowData(
      sankeyDefinitions,
      { '2025': { 'food-budget': 100, 'rent-budget': 300 } },
      [tx({ id: 'food', amount: -100 }), tx({ id: 'rent', categoryId: 'rent', amount: -300 })],
      sankeyCategories,
      '2025'
    )

    expect(result.nodes.find((node) => node.id === 'budget:food')?.height).toBe(result.nodes.find((node) => node.id === 'actual:food')?.height)
    expect(result.nodes.find((node) => node.id === 'budget:rent')?.height).toBe(result.nodes.find((node) => node.id === 'actual:rent')?.height)
    expect(result.links.some((link) => link.targetId === 'actual:unspent')).toBe(false)
  })

  it('keeps adjacent Sankey node label centers at least one label height apart', () => {
    const categories = [
      { id: 'large', name: 'Large', updatedAt: '' },
      { id: 'small-a', name: 'Small A', updatedAt: '' },
      { id: 'small-b', name: 'Small B', updatedAt: '' },
    ]
    const definitions = categories.map((category) => ({ id: `${category.id}-budget`, name: category.name, categoryId: category.id, frequency: 'yearly' as const }))
    const result = sankeyFlowData(definitions, { '2025': { 'large-budget': 1000, 'small-a-budget': 1, 'small-b-budget': 1 } }, [], categories, '2025')
    const smallNodes = result.nodes.filter((node) => node.id.startsWith('budget:small'))

    expect(smallNodes[1].y + smallNodes[1].height / 2 - (smallNodes[0].y + smallNodes[0].height / 2)).toBeGreaterThanOrEqual(32)
  })

  it('routes category shortfalls to a proportionally-sized Unspent node', () => {
    const result = sankeyFlowData(sankeyDefinitions, { '2025': { 'food-budget': 100, 'rent-budget': 300 } }, [tx({ amount: -50 }), tx({ id: 'rent', categoryId: 'rent', amount: -300 })], sankeyCategories, '2025')

    expect(result.nodes.find((node) => node.id === 'actual:unspent')).toMatchObject({ value: 50 })
    expect(result.links.find((link) => link.sourceId === 'budget:food' && link.targetId === 'actual:unspent')?.title).toContain('$50')
  })

  it('caps overflow geometry while reporting the real overage percentage', () => {
    const result = sankeyFlowData(sankeyDefinitions, { '2025': { 'food-budget': 100, 'rent-budget': 0 } }, [tx({ amount: -150 })], sankeyCategories, '2025')

    expect(result.links.find((link) => link.targetId === 'actual:food')?.title).toContain('50.0% over budget')
  })

  it('returns finite geometry without budget definitions', () => {
    const result = sankeyFlowData([], {}, [], [], '2025')

    expect(result.nodes.length).toBeLessThanOrEqual(1)
    expect([...result.nodes, ...result.links].every((item) => !JSON.stringify(item).includes('NaN') && !JSON.stringify(item).includes('Infinity'))).toBe(true)
  })

  it('renders untracked spend with a zero-height budget node and finite width', () => {
    const result = sankeyFlowData([], {}, [tx({ amount: -25 })], sankeyCategories.slice(0, 1), '2025')

    expect(result.nodes.find((node) => node.id === 'budget:food')).toMatchObject({ height: 0, width: expect.any(Number) })
    expect(result.nodes.find((node) => node.id === 'actual:food')?.height).toBeGreaterThan(0)
  })

  it('returns zero-height actual nodes when the scope has no transactions', () => {
    const result = sankeyFlowData(sankeyDefinitions, { '2025': { 'food-budget': 100, 'rent-budget': 300 } }, [tx({ date: '2024-01-01', amount: -10 })], sankeyCategories, '2025')

    expect(result.nodes.filter((node) => node.column === 'actual').every((node) => node.height === 0)).toBe(true)
    expect(() => sankeyFlowData(sankeyDefinitions, {}, [], sankeyCategories, '2025')).not.toThrow()
  })

  it('places the budget node at x=545 by default (width=1200)', () => {
    const result = sankeyFlowData(
      sankeyDefinitions,
      { '2025': { 'food-budget': 100, 'rent-budget': 300 } },
      [tx({ id: 'food', amount: -100 }), tx({ id: 'rent', categoryId: 'rent', amount: -300 })],
      sankeyCategories,
      '2025'
    )

    expect(result.nodes.find((node) => node.id === 'budget:food')?.x).toBe(545)
  })

  it('scales node x positions proportionally for width=640 (floor)', () => {
    const result = sankeyFlowData(
      sankeyDefinitions,
      { '2025': { 'food-budget': 100, 'rent-budget': 300 } },
      [tx({ id: 'food', amount: -100 }), tx({ id: 'rent', categoryId: 'rent', amount: -300 })],
      sankeyCategories,
      '2025',
      640
    )

    expect(result.nodes.find((node) => node.id === 'budget:food')?.x).toBeCloseTo(545 * (640 / 1200))
    expect([...result.nodes, ...result.links].every((item) => !JSON.stringify(item).includes('NaN') && !JSON.stringify(item).includes('Infinity'))).toBe(true)
  })

  it('scales node x positions proportionally for width=1600 (cap)', () => {
    const result = sankeyFlowData(
      sankeyDefinitions,
      { '2025': { 'food-budget': 100, 'rent-budget': 300 } },
      [tx({ id: 'food', amount: -100 }), tx({ id: 'rent', categoryId: 'rent', amount: -300 })],
      sankeyCategories,
      '2025',
      1600
    )

    expect(result.nodes.find((node) => node.id === 'budget:food')?.x).toBeCloseTo(545 * (1600 / 1200))
    expect([...result.nodes, ...result.links].every((item) => !JSON.stringify(item).includes('NaN') && !JSON.stringify(item).includes('Infinity'))).toBe(true)
  })

  it('ignores width on the empty-input early-return path', () => {
    const result = sankeyFlowData([], {}, [], [], '2025', 640)

    expect(result).toEqual({ nodes: [], links: [] })
  })
})

describe('computeRecurringSpendIds', () => {
  const recurringCategories: Category[] = [
    ...categories,
    { id: 'excluded', name: 'Excluded', updatedAt: '', excludeFromSpend: true },
  ]
  const recurringDefinitions = definitions
  const recurring = (id: string, date: string, amount: number, accountId = 'account-a', categoryId = 'food') =>
    tx({ id, date, amount, accountId, categoryId })
  const ids = (transactions: BudgetTransaction[]) => computeRecurringSpendIds(transactions, recurringCategories, recurringDefinitions)

  it('flags three equal monthly charges in the same account and category', () => {
    const transactions = [
      recurring('jan', '2025-01-15', -100),
      recurring('feb', '2025-02-15', -100),
      recurring('mar', '2025-03-15', -100),
    ]

    expect(ids(transactions)).toEqual(new Set(['jan', 'feb', 'mar']))
  })

  it('does not flag a two-month run', () => {
    expect(ids([
      recurring('jan', '2025-01-15', -100),
      recurring('feb', '2025-02-15', -100),
    ])).toEqual(new Set())
  })

  it('does not bridge a missing month', () => {
    expect(ids([
      recurring('jan', '2025-01-15', -100),
      recurring('feb', '2025-02-15', -100),
      recurring('apr', '2025-04-15', -100),
    ])).toEqual(new Set())
  })

  it('accepts amounts within ten percent of the running average', () => {
    const transactions = [
      recurring('jan', '2025-01-15', -100),
      recurring('feb', '2025-02-15', -108),
      recurring('mar', '2025-03-15', -96),
    ]

    expect(ids(transactions)).toEqual(new Set(['jan', 'feb', 'mar']))
  })

  it('breaks a chain when the third amount exceeds the tolerance', () => {
    expect(ids([
      recurring('jan', '2025-01-15', -100),
      recurring('feb', '2025-02-15', -100),
      recurring('mar', '2025-03-15', -111),
    ])).toEqual(new Set())
  })

  it('does not flag transactions in categories excluded from spend', () => {
    expect(ids([
      recurring('jan', '2025-01-15', -100, 'account-a', 'excluded'),
      recurring('feb', '2025-02-15', -100, 'account-a', 'excluded'),
      recurring('mar', '2025-03-15', -100, 'account-a', 'excluded'),
    ])).toEqual(new Set())
  })

  it('tracks interleaved account and category chains independently', () => {
    const transactions = [
      recurring('a-jan', '2025-01-15', -100, 'account-a', 'food'),
      recurring('b-jan', '2025-01-15', -200, 'account-b', 'other-income'),
      recurring('a-feb', '2025-02-15', -100, 'account-a', 'food'),
      recurring('b-feb', '2025-02-15', -200, 'account-b', 'other-income'),
      recurring('a-mar', '2025-03-15', -100, 'account-a', 'food'),
      recurring('b-mar', '2025-03-15', -200, 'account-b', 'other-income'),
    ]

    expect(ids(transactions)).toEqual(new Set(['a-jan', 'a-feb', 'a-mar', 'b-jan', 'b-feb', 'b-mar']))
  })

  it('chooses the closest same-month candidate instead of the first candidate', () => {
    const transactions = [
      recurring('jan', '2025-01-15', -100),
      recurring('feb-far-first', '2025-02-01', -150),
      recurring('feb-close', '2025-02-15', -102),
      recurring('mar', '2025-03-15', -101),
    ]

    expect(ids(transactions)).toEqual(new Set(['jan', 'feb-close', 'mar']))
  })

  it('does not reuse a monthly representative across overlapping candidate chains', () => {
    const transactions = [
      recurring('jan', '2025-01-15', -100),
      recurring('feb', '2025-02-15', -100),
      recurring('mar', '2025-03-15', -100),
      recurring('apr-far-first', '2025-04-01', -150),
      recurring('apr-close', '2025-04-15', -100),
    ]

    const recurringIds = ids(transactions)
    expect(recurringIds).toEqual(new Set(['jan', 'feb', 'mar', 'apr-close']))
    expect(recurringIds).not.toContain('apr-far-first')
    expect(recurringIds.size).toBe(4)
  })

  it('is independent of UI year scope and requires full history for cross-year runs', () => {
    const transactions = [
      recurring('nov', '2024-11-15', -100),
      recurring('dec', '2024-12-15', -100),
      recurring('jan', '2025-01-15', -100),
      recurring('feb', '2025-02-15', -100),
    ]
    const fullHistory = ids(transactions)
    const allYearsScope = ids(transactions)
    const only2025 = ids(transactions.filter((transaction) => transaction.date.startsWith('2025')))

    expect(allYearsScope).toEqual(fullHistory)
    expect(fullHistory).toEqual(new Set(['nov', 'dec', 'jan', 'feb']))
    expect(only2025).toEqual(new Set())
    expect(only2025).not.toEqual(fullHistory)
  })
})

describe('categoryCards / closedPositionsCard', () => {
  const account = (patch: Partial<Account>): Account => ({
    id: patch.id ?? 'acct',
    accountNumber: '1234',
    name: 'Account',
    institution: 'Bank',
    taxCategory: 'taxable',
    retirement: false,
    createdAt: '2025-01-01',
    ...patch,
  })

  it('categoryCards output has no expanded key', () => {
    const state = initialState()
    state.accounts = [account({ id: 'a1' })]

    const cards = categoryCards(state)
    expect(cards.length).toBeGreaterThan(0)
    cards.forEach((card) => {
      expect(card).not.toHaveProperty('expanded')
    })
  })

  it('closedPositionsCard output has no expanded key', () => {
    const state = initialState()
    expect(closedPositionsCard(state)).not.toHaveProperty('expanded')
  })

  it('groups accounts into correct category cards with per-account totals and accountCount', () => {
    const state = initialState()
    state.accounts = [
      account({ id: 'a1', taxCategory: 'taxable' }),
      account({ id: 'a2', taxCategory: 'taxable' }),
      account({ id: 'a3', taxCategory: 'nonTaxable' }),
    ]
    state.positions = [
      { id: 'p1', accountId: 'a1', symbol: 'AAPL', shares: 10, price: 100, assetClass: 'Equity', lastImportedAt: '2025-01-01' } as never,
      { id: 'p2', accountId: 'a3', symbol: 'MSFT', shares: 5, price: 200, assetClass: 'Equity', lastImportedAt: '2025-01-01' } as never,
    ]

    const cards = categoryCards(state)
    expect(cards).toHaveLength(3)

    const taxable = cards.find((c) => c.key === 'taxable')!
    expect(taxable.accounts).toHaveLength(2)
    expect(taxable.accountCount).toBe(2)
    expect(taxable.totalStr).toBe('$1,000.00')

    const nonTaxable = cards.find((c) => c.key === 'nonTaxable')!
    expect(nonTaxable.accounts).toHaveLength(1)
    expect(nonTaxable.accountCount).toBe(1)
    expect(nonTaxable.totalStr).toBe('$1,000.00')

    const taxDeferred = cards.find((c) => c.key === 'taxDeferred')!
    expect(taxDeferred.accounts).toHaveLength(0)
    expect(taxDeferred.accountCount).toBe(0)
  })
})

describe('tab-scoped position selectors (tabAccountIds)', () => {
  const account = (patch: Partial<Account>): Account => ({
    id: patch.id ?? 'acct',
    accountNumber: '1234',
    name: 'Account',
    institution: 'Bank',
    taxCategory: 'taxable',
    retirement: false,
    createdAt: '2025-01-01',
    ...patch,
  })

  function buildState() {
    const state = initialState()
    state.accounts = [
      account({ id: 'a1', taxCategory: 'taxable' }),
      account({ id: 'a2', taxCategory: 'taxable' }),
      account({ id: 'a3', taxCategory: 'nonTaxable' }),
    ]
    state.positions = [
      { id: 'p1', accountId: 'a1', symbol: 'AAPL', shares: 10, price: 100, assetClass: 'Equity', lastImportedAt: '2025-01-01' } as never,
      { id: 'p2', accountId: 'a2', symbol: 'VTI', shares: 5, price: 200, assetClass: 'ETF', lastImportedAt: '2025-01-01' } as never,
      { id: 'p3', accountId: 'a3', symbol: 'MSFT', shares: 5, price: 200, assetClass: 'Equity', lastImportedAt: '2025-01-01' } as never,
    ]
    state.closedPositions = [
      {
        id: 'cp1',
        accountId: 'a1',
        symbol: 'GOOG',
        shares: 1,
        assetClass: 'Equity',
        realizedGL: 100,
        realizedGLBasis: 'transactions',
        lastImportedAt: '2025-01-01',
      } as never,
    ]
    return state
  }

  it('returns only positions in the active tab accounts when no account selected', () => {
    const state = buildState()
    const tabAccountIds = ['a1', 'a2']
    const results = acctFilteredPositions(state, tabAccountIds)
    expect(results.map((p) => p.id).sort()).toEqual(['p1', 'p2'])
  })

  it('stays scoped to the selected account even within a tab', () => {
    const state = buildState()
    state.selectedAccountId = 'a1'
    state.selectedCategoryKey = 'taxable'
    const results = acctScopedPositions(state, ['a1', 'a2'])
    expect(results.map((p) => p.id)).toEqual(['p1'])
  })

  it('returns an empty list with no crash for a tab with zero accounts', () => {
    const state = buildState()
    const results = acctFilteredPositions(state, [])
    expect(results).toEqual([])
  })

  it('scopes closed positions to the selected account within the closedPositions tab', () => {
    const state = buildState()
    state.selectedAccountId = 'a1'
    state.selectedCategoryKey = 'closedPositions'
    const results = acctFilteredClosedPositions(state, ['a1'])
    expect(results.map((cp) => cp.id)).toEqual(['cp1'])
  })
})

describe('spendScopeKind', () => {
  it('classifies SPEND_ALL_YEARS as all', () => {
    expect(spendScopeKind(SPEND_ALL_YEARS, new Date(2025, 5, 15))).toBe('all')
  })

  it('classifies a scope matching asOf year as current', () => {
    expect(spendScopeKind('2025', new Date(2025, 5, 15))).toBe('current')
  })

  it('classifies a scope year before asOf year as past', () => {
    expect(spendScopeKind('2024', new Date(2025, 5, 15))).toBe('past')
  })

  it('classifies a scope year after asOf year as future', () => {
    expect(spendScopeKind('2026', new Date(2025, 5, 15))).toBe('future')
  })
})

describe('yearElapsedFraction', () => {
  it('returns 1/365 on Jan 1 of a non-leap year', () => {
    expect(yearElapsedFraction(2023, new Date(2023, 0, 1))).toBeCloseTo(1 / 365)
  })

  it('returns 1 on Dec 31 of a non-leap year', () => {
    expect(yearElapsedFraction(2023, new Date(2023, 11, 31))).toBe(1)
  })

  it('returns 366/366 = 1 on Dec 31 of a leap year', () => {
    expect(yearElapsedFraction(2024, new Date(2024, 11, 31))).toBe(1)
  })

  it('clamps to a value in (0, 1] when asOf is in a later year than the target year', () => {
    const result = yearElapsedFraction(2023, new Date(2025, 5, 15))
    expect(result).toBeGreaterThan(0)
    expect(result).toBeLessThanOrEqual(1)
  })
})

describe('spendCardTotals budgetedSpend annualization', () => {
  const annualizeCategories: Category[] = [
    { id: 'food', name: 'Food', updatedAt: '' },
    { id: 'ignored', name: 'Ignored', updatedAt: '', excludeFromSpend: true },
  ]
  const annualizeDefinitions: ExpenseDefinition[] = [
    { id: 'groceries', name: 'Groceries', categoryId: 'food', frequency: 'monthly' },
    { id: 'insurance', name: 'Insurance', categoryId: 'food', frequency: 'yearly' },
    { id: 'ignored-definition', name: 'Ignored', categoryId: 'ignored', frequency: 'monthly' },
  ]
  const annualizeTransactions = [tx({ id: 'food-2025', date: '2025-01-01', categoryId: 'food', amount: -1 })]

  it('annualizes a monthly definition amount into budgetedSpend (500/mo -> 6000/yr)', () => {
    const totals = spendCardTotals(annualizeDefinitions, { '2025': { groceries: 500 } }, annualizeTransactions, annualizeCategories, '2025')
    expect(totals.budgetedSpend).toBe(6000)
  })

  it('leaves a yearly definition amount unchanged in budgetedSpend', () => {
    const totals = spendCardTotals(annualizeDefinitions, { '2025': { insurance: 500 } }, annualizeTransactions, annualizeCategories, '2025')
    expect(totals.budgetedSpend).toBe(500)
  })

  it('skips definitions in excluded categories when annualizing budgetedSpend', () => {
    const totals = spendCardTotals(annualizeDefinitions, { '2025': { 'ignored-definition': 500 } }, annualizeTransactions, annualizeCategories, '2025')
    expect(totals.budgetedSpend).toBe(0)
  })

  it('matches the sum of per-category annualized budgets (cross-check against toPeriod)', () => {
    const amountsByYear = { '2025': { groceries: 500, insurance: 500, 'ignored-definition': 500 } }
    const totals = spendCardTotals(annualizeDefinitions, amountsByYear, annualizeTransactions, annualizeCategories, '2025')
    const expectedBudget = annualizeDefinitions.reduce((sum, definition) => {
      if (definition.categoryId === 'ignored') return sum
      return sum + toPeriod(amountsByYear['2025'][definition.id] ?? 0, definition.frequency, 'yearly')
    }, 0)
    expect(totals.budgetedSpend).toBe(expectedBudget)
    expect(totals.budgetedSpend).toBe(6500)
  })
})

describe('savingsRateForScope', () => {
  const rateCategories: Category[] = [
    { id: 'income', name: ' Income ', updatedAt: '' },
    { id: 'food', name: 'Food', updatedAt: '' },
    { id: 'ignored', name: 'Ignored', updatedAt: '', excludeFromSpend: true },
  ]
  const rateDefinitions: ExpenseDefinition[] = [
    { id: 'salary', name: 'Salary', categoryId: 'income', frequency: 'monthly' },
    { id: 'groceries', name: 'Groceries', categoryId: 'food', frequency: 'monthly' },
  ]

  it('matches savingsRateByYear for a single-year scope', () => {
    const transactions = [
      tx({ id: 'income-2025', date: '2025-01-01', categoryId: 'income', amount: 1000 }),
      tx({ id: 'food-2025', date: '2025-02-01', categoryId: 'food', amount: -400 }),
    ]
    const result = savingsRateForScope(transactions, rateCategories, rateDefinitions, '2025')
    const expected = savingsRateByYear(['2025'], transactions, rateCategories, rateDefinitions)[0]
    expect(result?.pct).toBe(expected.pct)
    expect(result?.isPositive).toBe(expected.isPositive)
  })

  it('aggregates income and spend across all years rather than averaging per-year rates', () => {
    const transactions = [
      tx({ id: 'income-a', date: '2024-01-01', categoryId: 'income', amount: 1000 }),
      tx({ id: 'food-a', date: '2024-02-01', categoryId: 'food', amount: -500 }),
      tx({ id: 'income-b', date: '2025-01-01', categoryId: 'income', amount: 5000 }),
      tx({ id: 'food-b', date: '2025-02-01', categoryId: 'food', amount: -500 }),
    ]
    const perYear = savingsRateByYear(['2024', '2025'], transactions, rateCategories, rateDefinitions)
    expect(perYear[0].pct).toBe(50)
    expect(perYear[1].pct).toBe(90)
    const average = (perYear[0].pct + perYear[1].pct) / 2
    expect(average).toBe(70)

    const result = savingsRateForScope(transactions, rateCategories, rateDefinitions, SPEND_ALL_YEARS)
    expect(result?.income).toBe(6000)
    expect(result?.spend).toBe(1000)
    expect(result?.pct).toBeCloseTo((6000 - 1000) / 6000 * 100, 10)
    expect(result?.pct).not.toBe(average)
  })

  it('reports isPositive false when spend exceeds income for a year', () => {
    const transactions = [
      tx({ id: 'income-2025', date: '2025-01-01', categoryId: 'income', amount: 500 }),
      tx({ id: 'food-2025', date: '2025-02-01', categoryId: 'food', amount: -900 }),
    ]
    const result = savingsRateForScope(transactions, rateCategories, rateDefinitions, '2025')
    expect(result?.isPositive).toBe(false)
    expect(result?.pct).toBeLessThan(0)
  })

  it('returns null when income is zero or negative', () => {
    const noIncomeYear = [tx({ id: 'food-2025', date: '2025-02-01', categoryId: 'food', amount: -900 })]
    expect(savingsRateForScope(noIncomeYear, rateCategories, rateDefinitions, '2025')).toBeNull()
    expect(savingsRateForScope(noIncomeYear, rateCategories, rateDefinitions, SPEND_ALL_YEARS)).toBeNull()
  })

  it('excludes excludeFromSpend categories from income/spend totals', () => {
    const transactions = [
      tx({ id: 'income-2025', date: '2025-01-01', categoryId: 'income', amount: 1000 }),
      tx({ id: 'food-2025', date: '2025-02-01', categoryId: 'food', amount: -400 }),
      tx({ id: 'ignored-2025', date: '2025-03-01', categoryId: 'ignored', amount: -9999 }),
    ]
    const result = savingsRateForScope(transactions, rateCategories, rateDefinitions, '2025')
    expect(result?.income).toBe(1000)
    expect(result?.spend).toBe(400)
    expect(result?.pct).toBe(60)
  })
})

describe('spendPaceForScope', () => {
  const foodCategory: Category[] = [{ id: 'food', name: 'Food', updatedAt: '' }]
  const midYear = new Date(2025, 6, 1) // fraction = 0.5

  it('current year, monthly definition: expectedByToday prorates by elapsed fraction', () => {
    const monthlyDefinition: ExpenseDefinition[] = [{ id: 'food-budget', name: 'Food', categoryId: 'food', frequency: 'monthly' }]
    const fraction = yearElapsedFraction(2025, midYear)
    expect(fraction).toBeCloseTo(0.5, 1)
    const expected = 1200 * fraction

    const onTrack = spendPaceForScope(
      monthlyDefinition,
      { '2025': { 'food-budget': 100 } },
      [tx({ amount: -(expected - 100), date: '2025-03-01', spendExpenseId: 'food-budget' })],
      foodCategory,
      '2025',
      midYear
    )
    expect(onTrack.expectedByToday).toBeCloseTo(expected)
    expect(onTrack.actual).toBeCloseTo(expected - 100)
    expect(onTrack.isOnTrack).toBe(true)

    const offTrack = spendPaceForScope(
      monthlyDefinition,
      { '2025': { 'food-budget': 100 } },
      [tx({ amount: -(expected + 100), date: '2025-03-01', spendExpenseId: 'food-budget' })],
      foodCategory,
      '2025',
      midYear
    )
    expect(offTrack.expectedByToday).toBeCloseTo(expected)
    expect(offTrack.actual).toBeCloseTo(expected + 100)
    expect(offTrack.isOnTrack).toBe(false)
  })

  it('current year, yearly definition paid within budget counts fully toward expectedByToday', () => {
    const yearlyDefinition: ExpenseDefinition[] = [{ id: 'insurance', name: 'Insurance', categoryId: 'food', frequency: 'yearly' }]
    const earlyYear = new Date(2025, 1, 25) // fraction close to 0.2
    const fraction = yearElapsedFraction(2025, earlyYear)
    expect(fraction).toBeLessThan(1)

    const result = spendPaceForScope(
      yearlyDefinition,
      { '2025': { insurance: 1000 } },
      [tx({ amount: -1000, date: '2025-02-01', spendExpenseId: 'insurance' })],
      foodCategory,
      '2025',
      earlyYear
    )
    expect(result.expectedByToday).toBe(1000)
    expect(result.actual).toBe(1000)
    expect(result.isOnTrack).toBe(true)
  })

  it('yearly definition overpaid past its budget caps its expectedByToday contribution', () => {
    const yearlyDefinition: ExpenseDefinition[] = [{ id: 'insurance', name: 'Insurance', categoryId: 'food', frequency: 'yearly' }]
    const earlyYear = new Date(2025, 1, 25)

    const result = spendPaceForScope(
      yearlyDefinition,
      { '2025': { insurance: 1000 } },
      [tx({ amount: -1100, date: '2025-02-01', spendExpenseId: 'insurance' })],
      foodCategory,
      '2025',
      earlyYear
    )
    expect(result.expectedByToday).toBe(1000)
    expect(result.actual).toBe(1100)
    expect(result.isOnTrack).toBe(false)
  })

  it('past year scope: expectedByToday is null, compares actual against plain annualized budget', () => {
    const monthlyDefinition: ExpenseDefinition[] = [{ id: 'food-budget', name: 'Food', categoryId: 'food', frequency: 'monthly' }]
    const result = spendPaceForScope(
      monthlyDefinition,
      { '2024': { 'food-budget': 100 } },
      [tx({ amount: -1300, date: '2024-06-01', spendExpenseId: 'food-budget' })],
      foodCategory,
      '2024',
      midYear
    )
    expect(result.expectedByToday).toBeNull()
    expect(result.budget).toBe(1200)
    expect(result.actual).toBe(1300)
    expect(result.isOnTrack).toBe(false)
  })

  it('all-years scope: expectedByToday is null, compares actual against plain annualized budget', () => {
    const monthlyDefinition: ExpenseDefinition[] = [{ id: 'food-budget', name: 'Food', categoryId: 'food', frequency: 'monthly' }]
    const result = spendPaceForScope(
      monthlyDefinition,
      { '2024': { 'food-budget': 100 } },
      [tx({ amount: -1100, date: '2024-06-01', spendExpenseId: 'food-budget' })],
      foodCategory,
      SPEND_ALL_YEARS,
      midYear
    )
    expect(result.expectedByToday).toBeNull()
    expect(result.budget).toBe(1200)
    expect(result.actual).toBe(1100)
    expect(result.isOnTrack).toBe(true)
  })

  it('zero budget: pctOfBudget is 0, isOnTrack true iff actual is 0', () => {
    const zeroSpend = spendPaceForScope([], {}, [], foodCategory, '2025', midYear)
    expect(zeroSpend.budget).toBe(0)
    expect(zeroSpend.pctOfBudget).toBe(0)
    expect(zeroSpend.isOnTrack).toBe(true)

    const someSpend = spendPaceForScope(
      [],
      {},
      [tx({ amount: -50, date: '2025-03-01' })],
      foodCategory,
      '2025',
      midYear
    )
    expect(someSpend.budget).toBe(0)
    expect(someSpend.pctOfBudget).toBe(0)
    expect(someSpend.isOnTrack).toBe(false)
  })
})
