import { describe, expect, it } from 'vitest'
import { actualByCategory, actualIncomeForYear, budgetedIncomeForYear, CATEGORY_SHARE_PALETTE, categoryBreakdown, computeRecurringSpendIds, expenseStreamBands, expenseTableYears, isIncomeOrExcludedTransaction, mappingsForExpense, overBudgetCategories, projectedSpendForScope, sankeyFlowData, SPEND_ALL_YEARS, spendBudgetYears, spendCardTotals, spendTransactionsForScope, yearTotalSpend } from './selectors'
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
    const transactions = [tx({ categoryId: 'income', amount: 5000 }), tx({ id: 'food', amount: -100 })]
    expect(yearTotalSpend(transactions, categories, '2025', definitions)).toBe(100)
  })

  it('reports debit-signed expenses as positive spend across totals and categories', () => {
    const transactions = [tx({ id: 'groceries', amount: -527 })]
    expect(yearTotalSpend(transactions, categories, '2025', definitions)).toBe(527)
    expect(actualByCategory(transactions, definitions, categories)).toEqual({ food: 527 })
    expect(spendCardTotals(definitions, { '2025': { groceries: 315 } }, transactions, categories, '2025')).toMatchObject({
      actualSpend: 527,
      variance: -212,
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

describe('projectedSpendForScope', () => {
  const foodCategory: Category[] = [{ id: 'food', name: 'Food', updatedAt: '' }]
  const foodDefinition: ExpenseDefinition[] = [{ id: 'food-budget', name: 'Food', categoryId: 'food', frequency: 'yearly' }]

  it('extrapolates mid-year actual spend and flags projected overages', () => {
    const result = projectedSpendForScope(
      foodDefinition,
      { '2025': { 'food-budget': 700 } },
      [tx({ amount: -728, date: '2025-06-30' })],
      foodCategory,
      '2025',
      new Date(2025, 6, 2)
    )

    expect(result).toEqual({ projectedTotal: 1460, budgetTotal: 700, pctOver: 108.57142857142858, isOverBudget: true })
  })

  it('does not flag projections at or below budget', () => {
    expect(projectedSpendForScope(
      foodDefinition,
      { '2025': { 'food-budget': 1500 } },
      [tx({ amount: -728, date: '2025-06-30' })],
      foodCategory,
      '2025',
      new Date(2025, 6, 2)
    )?.isOverBudget).toBe(false)
  })

  it('returns null for the unbounded all-years scope', () => {
    expect(projectedSpendForScope(foodDefinition, {}, [], foodCategory, SPEND_ALL_YEARS, new Date(2025, 6, 2))).toBeNull()
  })

  it('returns zero projection on the first day of the period', () => {
    expect(projectedSpendForScope(
      foodDefinition,
      { '2025': { 'food-budget': 700 } },
      [tx({ amount: -100 })],
      foodCategory,
      '2025',
      new Date(2025, 0, 1)
    )).toMatchObject({ projectedTotal: 0, budgetTotal: 700, pctOver: -100, isOverBudget: false })
  })

  it('clamps stale as-of dates to the period end', () => {
    expect(projectedSpendForScope(
      foodDefinition,
      { '2025': { 'food-budget': 700 } },
      [tx({ amount: -800, date: '2025-12-31' })],
      foodCategory,
      '2025',
      new Date(2026, 2, 1)
    )).toMatchObject({ projectedTotal: 800, budgetTotal: 700, isOverBudget: true })
  })

  it('handles empty transactions and definitions', () => {
    expect(projectedSpendForScope([], {}, [], foodCategory, '2025', new Date(2025, 6, 2))).toEqual({
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
})

describe('expenseStreamBands', () => {
  const streamCategories: Category[] = [
    { id: 'food', name: 'Food', updatedAt: '' },
    { id: 'housing', name: 'Housing', updatedAt: '' },
  ]

  it('builds one multi-point stacked area per category across years with data', () => {
    const result = expenseStreamBands([
      tx({ id: 'food-2024', date: '2024-01-01', amount: -100 }),
      tx({ id: 'housing-2024', date: '2024-02-01', categoryId: 'housing', amount: -300 }),
      tx({ id: 'food-2025', date: '2025-01-01', amount: -150 }),
      tx({ id: 'housing-2025', date: '2025-02-01', categoryId: 'housing', amount: -350 }),
    ], streamCategories, [])

    expect(result.years).toEqual(['2024', '2025'])
    expect(result.bands).toHaveLength(2)
    expect(result.bands.every((band) => /^M .+ L .+ Z$/.test(band.d))).toBe(true)
  })

  it('reconciles legend totals to actual scoped category spend', () => {
    const transactions = [
      tx({ id: 'food-2024', date: '2024-01-01', amount: -100 }),
      tx({ id: 'housing-2024', date: '2024-02-01', categoryId: 'housing', amount: -300 }),
      tx({ id: 'food-2025', date: '2025-01-01', amount: -150 }),
    ]
    const result = expenseStreamBands(transactions, streamCategories, [])

    expect(result.legend.reduce((sum, entry) => sum + entry.total, 0)).toBe(550)
  })

  it('excludes years without non-excluded transaction activity', () => {
    const result = expenseStreamBands([
      tx({ id: 'food-2024', date: '2024-01-01', amount: -100 }),
      tx({ id: 'food-2026', date: '2026-01-01', categoryId: 'income', amount: 1000 }),
    ], [...streamCategories, { id: 'income', name: 'Income', updatedAt: '' }], [])

    expect(result.years).toEqual(['2024'])
    expect(result.bands).toHaveLength(1)
  })

  it('clamps colors to the final palette entry for categories beyond six', () => {
    const manyCategories = Array.from({ length: 7 }, (_, index) => ({ id: `category-${index}`, name: `Category ${index}`, updatedAt: '' }))
    const result = expenseStreamBands(
      manyCategories.map((category, index) => tx({ id: category.id, categoryId: category.id, amount: -(index + 1) })),
      manyCategories,
      []
    )

    expect(result.bands).toHaveLength(7)
    expect(result.bands.every((band) => band.color !== undefined)).toBe(true)
    expect(result.bands.at(-1)?.color).toBe(CATEGORY_SHARE_PALETTE.at(-1))
  })

  it('returns empty chart data without transactions', () => {
    expect(expenseStreamBands([], streamCategories, [])).toEqual({ years: [], bands: [], legend: [] })
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
