import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { BudgetAnalytics } from './BudgetAnalytics'
import { initialState, type AppState } from '../lib/state'
import type { BudgetTransaction, Category } from '../lib/types'

afterEach(() => {
  cleanup()
})

const CATEGORY_UPDATED_AT = '2025-01-01T00:00:00.000Z'

const CATEGORIES: Category[] = [
  { id: 'cat-housing', name: 'Housing', updatedAt: CATEGORY_UPDATED_AT },
  { id: 'cat-food', name: 'Food', updatedAt: CATEGORY_UPDATED_AT },
]

function makeTransaction(overrides: Partial<BudgetTransaction> = {}): BudgetTransaction {
  return {
    id: overrides.id ?? `tx-${Math.random()}`,
    date: overrides.date ?? '2025-03-10',
    description: overrides.description ?? 'Purchase',
    categoryId: overrides.categoryId ?? 'cat-housing',
    amount: overrides.amount ?? 100,
    ...overrides,
  }
}

const SECTION_TITLES = [
  'Areas of concern',
  'Savings rate by year',
  'Category share of spend',
  'Monthly seasonality',
  'Budget accuracy by year',
  'Category trends year over year',
  'Biggest movers',
]

describe('BudgetAnalytics', () => {
  it('renders without crashing with zero budgetTransactions and shows the empty-state message in all 7 placeholders', () => {
    const state: AppState = { ...initialState(), budgetTransactions: [] }
    const { container, getAllByText } = render(<BudgetAnalytics state={state} categories={CATEGORIES} />)

    const cards = container.querySelectorAll('.card.blueprint.elev-sm')
    expect(cards.length).toBe(7)

    const emptyMessages = getAllByText('No records for this period.')
    expect(emptyMessages.length).toBe(7)
  })

  it('renders 7 section placeholders in the correct order when given a fixture with data', () => {
    const state: AppState = {
      ...initialState(),
      budgetTransactions: [
        makeTransaction({ date: '2025-03-05' }),
        makeTransaction({ date: '2024-06-15', categoryId: 'cat-food' }),
      ],
    }
    const { container } = render(<BudgetAnalytics state={state} categories={CATEGORIES} />)

    const titles = Array.from(container.querySelectorAll('.card-title')).map((el) => el.textContent)
    expect(titles).toEqual(SECTION_TITLES)
  })

  it('renders all 5 concern cards with correct values for a multi-year, multi-category fixture', () => {
    // `years` always includes the current calendar year (from availableBudgetYears), which becomes
    // the "latest year" that latest-year-only concerns (over-budget, concentration risk) key off of.
    // So the fixture's most-recent data year must be the current year, with a prior year for YoY concerns.
    const currentYear = String(new Date().getFullYear())
    const prevYear = String(new Date().getFullYear() - 1)
    const transactions: BudgetTransaction[] = [
      // prevYear: baseline year, Housing dominant
      makeTransaction({ date: `${prevYear}-01-10`, categoryId: 'cat-housing', amount: 1000 }),
      makeTransaction({ date: `${prevYear}-02-10`, categoryId: 'cat-housing', amount: 1000 }),
      makeTransaction({ date: `${prevYear}-01-10`, categoryId: 'cat-food', amount: 100 }),
      makeTransaction({ date: `${prevYear}-02-10`, categoryId: 'cat-food', amount: 100 }),
      // currentYear: spend jumps, plus a spike month in December, still Housing dominant
      makeTransaction({ date: `${currentYear}-01-10`, categoryId: 'cat-housing', amount: 2000 }),
      makeTransaction({ date: `${currentYear}-02-10`, categoryId: 'cat-housing', amount: 2000 }),
      makeTransaction({ date: `${currentYear}-01-10`, categoryId: 'cat-food', amount: 100 }),
      makeTransaction({ date: `${currentYear}-02-10`, categoryId: 'cat-food', amount: 100 }),
      makeTransaction({ date: `${currentYear}-12-10`, categoryId: 'cat-housing', amount: 9000 }),
    ]
    const state: AppState = {
      ...initialState(),
      budgetTransactions: transactions,
      budgetExpensesByYear: {
        [currentYear]: [{ id: 'exp-1', name: 'Rent', categoryId: 'cat-housing', amount: 500, frequency: 'monthly' }],
      },
      budgetIncomeByYear: {
        [prevYear]: { monthly: 5000, yearly: 60000 },
        [currentYear]: { monthly: 5000, yearly: 60000 },
      },
    }

    const { getByText, getAllByText } = render(<BudgetAnalytics state={state} categories={CATEGORIES} />)

    // Over budget: Housing actual avg in currentYear (latest year) >> budgeted 500/mo
    expect(getAllByText('Over budget').length).toBeGreaterThan(0)
    expect(getAllByText(/Housing/).length).toBeGreaterThan(0)

    // Spend trend: present (>=2 years)
    expect(getByText('Spend trend')).toBeTruthy()

    // Spike month: December of currentYear
    expect(getByText('Spike month')).toBeTruthy()
    expect(getByText(`Dec ${currentYear}`)).toBeTruthy()

    // Savings rate shrinking: present (>=2 years)
    expect(getByText('Savings rate')).toBeTruthy()

    // Concentration risk: Housing dominant category
    expect(getByText('Concentration risk')).toBeTruthy()
    expect(getByText(/Housing —/)).toBeTruthy()
  })

  it('shows empty-state for the 2 YoY-dependent cards with a single-year fixture, others still render', () => {
    const currentYear = String(new Date().getFullYear())
    const transactions: BudgetTransaction[] = [
      makeTransaction({ date: `${currentYear}-01-10`, categoryId: 'cat-housing', amount: 1000 }),
      makeTransaction({ date: `${currentYear}-02-10`, categoryId: 'cat-housing', amount: 1000 }),
      makeTransaction({ date: `${currentYear}-12-10`, categoryId: 'cat-housing', amount: 9000 }),
      makeTransaction({ date: `${currentYear}-01-10`, categoryId: 'cat-food', amount: 100 }),
    ]
    const state: AppState = {
      ...initialState(),
      budgetTransactions: transactions,
      budgetExpensesByYear: {
        [currentYear]: [{ id: 'exp-1', name: 'Rent', categoryId: 'cat-housing', amount: 200, frequency: 'monthly' }],
      },
      budgetIncomeByYear: {
        [currentYear]: { monthly: 5000, yearly: 60000 },
      },
    }

    const { getAllByText, getByText } = render(<BudgetAnalytics state={state} categories={CATEGORIES} />)

    // The 2 YoY-dependent concern cards (Spend trend, Savings rate) plus the Category-trends
    // and Biggest-movers sections (each needs >=2 years) show the empty-state message.
    const emptyMessages = getAllByText('No records for this period.')
    expect(emptyMessages.length).toBe(4)

    // Over-budget, Spike-month, Concentration-risk still render with real values.
    expect(getByText('Over budget')).toBeTruthy()
    expect(getAllByText(/Housing/).length).toBeGreaterThan(0)
    expect(getByText('Spike month')).toBeTruthy()
    expect(getByText(`Dec ${currentYear}`)).toBeTruthy()
    expect(getByText('Concentration risk')).toBeTruthy()
  })

  it('renders one savings-rate bar per year with correct relative heights and colors', () => {
    const transactions: BudgetTransaction[] = [
      // 2024: spend 2000, income 5000/mo * 2 months = 10000 -> savings rate 80%
      makeTransaction({ date: '2024-01-10', categoryId: 'cat-housing', amount: 1000 }),
      makeTransaction({ date: '2024-02-10', categoryId: 'cat-housing', amount: 1000 }),
      // 2025: spend 9000, income 10000 -> savings rate 10%
      makeTransaction({ date: '2025-01-10', categoryId: 'cat-housing', amount: 4500 }),
      makeTransaction({ date: '2025-02-10', categoryId: 'cat-housing', amount: 4500 }),
    ]
    const state: AppState = {
      ...initialState(),
      budgetTransactions: transactions,
      budgetIncomeByYear: {
        '2024': { monthly: 5000, yearly: 60000 },
        '2025': { monthly: 5000, yearly: 60000 },
      },
    }

    const { container } = render(<BudgetAnalytics state={state} categories={CATEGORIES} />)
    const bars = container.querySelectorAll('[data-testid="savings-rate-bar"]')
    expect(bars.length).toBeGreaterThanOrEqual(2)

    const byYear = new Map(Array.from(bars).map((b) => [b.getAttribute('data-year'), b]))
    const bar2024 = byYear.get('2024')!
    const bar2025 = byYear.get('2025')!

    const pct2024 = Number(bar2024.getAttribute('data-pct'))
    const pct2025 = Number(bar2025.getAttribute('data-pct'))
    expect(pct2024).toBeGreaterThan(pct2025)
    expect(pct2024).toBeGreaterThan(0)
    expect(pct2025).toBeGreaterThan(0)

    const innerBar2024 = bar2024.querySelector('div:nth-child(2)') as HTMLElement
    const innerBar2025 = bar2025.querySelector('div:nth-child(2)') as HTMLElement
    const height2024 = parseInt(innerBar2024.style.height, 10)
    const height2025 = parseInt(innerBar2025.style.height, 10)
    expect(height2024).toBeGreaterThan(height2025)
    // Both positive savings rates -> GAIN_COLOR
    expect(innerBar2024.style.background).toBe('rgb(31, 169, 113)')
    expect(innerBar2025.style.background).toBe('rgb(31, 169, 113)')
  })

  it('renders category-share stacked rows summing to ~100% with stable colors per category, and a legend of at most 6', () => {
    const transactions: BudgetTransaction[] = [
      makeTransaction({ date: '2024-01-10', categoryId: 'cat-housing', amount: 1000 }),
      makeTransaction({ date: '2024-01-10', categoryId: 'cat-food', amount: 500 }),
      makeTransaction({ date: '2025-01-10', categoryId: 'cat-housing', amount: 3000 }),
      makeTransaction({ date: '2025-01-10', categoryId: 'cat-food', amount: 100 }),
    ]
    const state: AppState = { ...initialState(), budgetTransactions: transactions }
    const { container } = render(<BudgetAnalytics state={state} categories={CATEGORIES} />)

    const rows = container.querySelectorAll('[data-testid="category-share-row"]')
    expect(rows.length).toBeGreaterThanOrEqual(2)

    const colorByCategory = new Map<string, string>()
    rows.forEach((row) => {
      const segments = Array.from(row.querySelectorAll('[data-testid="category-share-segment"]'))
      const total = segments.reduce((sum, seg) => sum + Number(seg.getAttribute('data-pct')), 0)
      // Years with no spend data at all legitimately sum to 0%; only assert ~100% for years with spend.
      if (total > 0) {
        expect(total).toBeGreaterThan(99.5)
        expect(total).toBeLessThan(100.5)
      }

      segments.forEach((seg) => {
        const categoryId = seg.getAttribute('data-category-id')!
        const color = (seg as HTMLElement).style.backgroundColor
        if (colorByCategory.has(categoryId)) {
          expect(color).toBe(colorByCategory.get(categoryId))
        } else {
          colorByCategory.set(categoryId, color)
        }
      })
    })

    const legendItems = container.querySelectorAll('[data-testid="category-share-legend-item"]')
    expect(legendItems.length).toBeLessThanOrEqual(6)
    expect(legendItems.length).toBeGreaterThan(0)
  })

  it('renders 12 monthly-seasonality bars Jan-Dec with the peak month visually distinguished', () => {
    const transactions: BudgetTransaction[] = [
      makeTransaction({ date: '2025-01-10', categoryId: 'cat-housing', amount: 100 }),
      makeTransaction({ date: '2025-02-10', categoryId: 'cat-housing', amount: 100 }),
      makeTransaction({ date: '2025-12-10', categoryId: 'cat-housing', amount: 9000 }),
    ]
    const state: AppState = { ...initialState(), budgetTransactions: transactions }
    const { container } = render(<BudgetAnalytics state={state} categories={CATEGORIES} />)

    const bars = container.querySelectorAll('[data-testid="seasonality-bar"]')
    expect(bars.length).toBe(12)

    const months = Array.from(bars).map((b) => Number(b.getAttribute('data-month')))
    expect(months).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

    const peakBars = Array.from(bars).filter((b) => b.getAttribute('data-peak') === 'true')
    expect(peakBars.length).toBe(1)
    expect(peakBars[0].getAttribute('data-month')).toBe('12')

    const peakInner = peakBars[0].querySelector('div') as HTMLElement
    const nonPeakInner = Array.from(bars)
      .find((b) => b.getAttribute('data-peak') !== 'true')!
      .querySelector('div') as HTMLElement
    expect(peakInner.style.background).not.toBe(nonPeakInner.style.background)
  })

  it('renders real category-share and seasonality content (not the empty state) with exactly 1 year of data', () => {
    const currentYear = String(new Date().getFullYear())
    const transactions: BudgetTransaction[] = [
      makeTransaction({ date: `${currentYear}-01-10`, categoryId: 'cat-housing', amount: 500 }),
      makeTransaction({ date: `${currentYear}-06-10`, categoryId: 'cat-food', amount: 200 }),
    ]
    const state: AppState = { ...initialState(), budgetTransactions: transactions }
    const { container } = render(<BudgetAnalytics state={state} categories={CATEGORIES} />)

    const cards = Array.from(container.querySelectorAll('.card.blueprint.elev-sm'))
    const shareCard = cards.find((c) => c.querySelector('.card-title')?.textContent === 'Category share of spend')!
    const seasonalityCard = cards.find((c) => c.querySelector('.card-title')?.textContent === 'Monthly seasonality')!

    // Category share: real segments render, not the empty-state message.
    const segments = shareCard.querySelectorAll('[data-testid="category-share-segment"]')
    expect(segments.length).toBeGreaterThan(0)
    expect(shareCard.textContent).not.toContain('No records for this period.')

    // Monthly seasonality: 12 real bars render, not the empty-state message.
    const bars = seasonalityCard.querySelectorAll('[data-testid="seasonality-bar"]')
    expect(bars.length).toBe(12)
    expect(seasonalityCard.textContent).not.toContain('No records for this period.')
  })

  describe('Budget accuracy by year', () => {
    it('renders correctly with only 1 year of data (not the empty state)', () => {
      const currentYear = String(new Date().getFullYear())
      const transactions: BudgetTransaction[] = [
        makeTransaction({ date: `${currentYear}-01-10`, categoryId: 'cat-housing', amount: 100 }),
        makeTransaction({ date: `${currentYear}-02-10`, categoryId: 'cat-housing', amount: 100 }),
      ]
      const state: AppState = {
        ...initialState(),
        budgetTransactions: transactions,
        budgetExpensesByYear: {
          [currentYear]: [{ id: 'exp-1', name: 'Rent', categoryId: 'cat-housing', amount: 200, frequency: 'monthly' }],
        },
      }
      const { container } = render(<BudgetAnalytics state={state} categories={CATEGORIES} />)
      const cards = Array.from(container.querySelectorAll('.card.blueprint.elev-sm'))
      const accuracyCard = cards.find((c) => c.querySelector('.card-title')?.textContent === 'Budget accuracy by year')!
      expect(accuracyCard.textContent).not.toContain('No records for this period.')
      const rows = accuracyCard.querySelectorAll('[data-testid="accuracy-row"]')
      expect(rows.length).toBe(1)
    })

    it('shows correct variance sign/color for an over-budget year and an under-budget year', () => {
      const transactions: BudgetTransaction[] = [
        // 2024: under budget (budget 200/mo * 2mo = 400, actual 100)
        makeTransaction({ date: '2024-01-10', categoryId: 'cat-housing', amount: 50 }),
        makeTransaction({ date: '2024-02-10', categoryId: 'cat-housing', amount: 50 }),
        // 2025: over budget (budget 200/mo * 2mo = 400, actual 2000)
        makeTransaction({ date: '2025-01-10', categoryId: 'cat-housing', amount: 1000 }),
        makeTransaction({ date: '2025-02-10', categoryId: 'cat-housing', amount: 1000 }),
      ]
      const state: AppState = {
        ...initialState(),
        budgetTransactions: transactions,
        budgetExpensesByYear: {
          '2024': [{ id: 'exp-1', name: 'Rent', categoryId: 'cat-housing', amount: 200, frequency: 'monthly' }],
          '2025': [{ id: 'exp-1', name: 'Rent', categoryId: 'cat-housing', amount: 200, frequency: 'monthly' }],
        },
      }
      const { container } = render(<BudgetAnalytics state={state} categories={CATEGORIES} />)
      const rows = container.querySelectorAll('[data-testid="accuracy-row"]')
      const byYear = new Map(Array.from(rows).map((r) => [r.getAttribute('data-year'), r]))

      const row2024 = byYear.get('2024')!
      const variance2024 = row2024.querySelector('[data-testid="accuracy-variance"]') as HTMLElement
      expect(variance2024.textContent).toMatch(/^Under by/)
      expect(variance2024.style.color).toBe('rgb(31, 169, 113)') // GAIN_COLOR

      const row2025 = byYear.get('2025')!
      const variance2025 = row2025.querySelector('[data-testid="accuracy-variance"]') as HTMLElement
      expect(variance2025.textContent).toMatch(/^Over by/)
      expect(variance2025.style.color).toBe('rgb(226, 87, 76)') // LOSS_COLOR
    })
  })

  describe('Category trends year over year', () => {
    it('shows the empty-state message with a fixture that has fewer than 2 years of data', () => {
      const currentYear = String(new Date().getFullYear())
      const transactions: BudgetTransaction[] = [
        makeTransaction({ date: `${currentYear}-01-10`, categoryId: 'cat-housing', amount: 100 }),
      ]
      const state: AppState = { ...initialState(), budgetTransactions: transactions }
      const { container } = render(<BudgetAnalytics state={state} categories={CATEGORIES} />)
      const cards = Array.from(container.querySelectorAll('.card.blueprint.elev-sm'))
      const trendsCard = cards.find(
        (c) => c.querySelector('.card-title')?.textContent === 'Category trends year over year'
      )!
      expect(trendsCard.textContent).toContain('No records for this period.')
    })

    it('renders the full sorted table with a >=2-year fixture, with the Over-budget pill only on flagged rows', () => {
      const currentYear = String(new Date().getFullYear())
      const prevYear = String(new Date().getFullYear() - 1)
      const transactions: BudgetTransaction[] = [
        // prevYear: Housing 200/mo avg, Food 200/mo avg
        makeTransaction({ date: `${prevYear}-01-10`, categoryId: 'cat-housing', amount: 200 }),
        makeTransaction({ date: `${prevYear}-02-10`, categoryId: 'cat-housing', amount: 200 }),
        makeTransaction({ date: `${prevYear}-01-10`, categoryId: 'cat-food', amount: 200 }),
        makeTransaction({ date: `${prevYear}-02-10`, categoryId: 'cat-food', amount: 200 }),
        // currentYear (last): Housing spikes to 1000/mo avg (over budget), Food stays flat at 200/mo (not over budget)
        makeTransaction({ date: `${currentYear}-01-10`, categoryId: 'cat-housing', amount: 1000 }),
        makeTransaction({ date: `${currentYear}-02-10`, categoryId: 'cat-housing', amount: 1000 }),
        makeTransaction({ date: `${currentYear}-01-10`, categoryId: 'cat-food', amount: 200 }),
        makeTransaction({ date: `${currentYear}-02-10`, categoryId: 'cat-food', amount: 200 }),
      ]
      const state: AppState = {
        ...initialState(),
        budgetTransactions: transactions,
        budgetExpensesByYear: {
          [currentYear]: [{ id: 'exp-1', name: 'Rent', categoryId: 'cat-housing', amount: 200, frequency: 'monthly' }],
        },
      }
      const { container } = render(<BudgetAnalytics state={state} categories={CATEGORIES} />)
      const cards = Array.from(container.querySelectorAll('.card.blueprint.elev-sm'))
      const trendsCard = cards.find(
        (c) => c.querySelector('.card-title')?.textContent === 'Category trends year over year'
      )!
      expect(trendsCard.textContent).not.toContain('No records for this period.')

      const table = trendsCard.querySelector('table.table')
      expect(table).toBeTruthy()

      const rows = trendsCard.querySelectorAll('[data-testid="trend-row"]')
      expect(rows.length).toBe(2)

      // Sorted by delta descending -> Housing (large increase) comes before Food (flat).
      const rowOrder = Array.from(rows).map((r) => r.getAttribute('data-category-id'))
      expect(rowOrder).toEqual(['cat-housing', 'cat-food'])

      const housingRow = Array.from(rows).find((r) => r.getAttribute('data-category-id') === 'cat-housing')!
      const foodRow = Array.from(rows).find((r) => r.getAttribute('data-category-id') === 'cat-food')!

      expect(housingRow.querySelector('[data-testid="over-budget-pill"]')).toBeTruthy()
      expect(foodRow.querySelector('[data-testid="over-budget-pill"]')).toBeFalsy()
    })
  })

  describe('Biggest movers', () => {
    const MOVER_CATEGORIES: Category[] = [
      { id: 'cat-housing', name: 'Housing', updatedAt: CATEGORY_UPDATED_AT },
      { id: 'cat-food', name: 'Food', updatedAt: CATEGORY_UPDATED_AT },
      { id: 'cat-travel', name: 'Travel', updatedAt: CATEGORY_UPDATED_AT },
      { id: 'cat-fun', name: 'Fun', updatedAt: CATEGORY_UPDATED_AT },
      { id: 'cat-utilities', name: 'Utilities', updatedAt: CATEGORY_UPDATED_AT },
      { id: 'cat-shopping', name: 'Shopping', updatedAt: CATEGORY_UPDATED_AT },
      { id: 'cat-zero', name: 'ZeroDelta', updatedAt: CATEGORY_UPDATED_AT },
    ]

    function findMoversCard(container: HTMLElement) {
      const cards = Array.from(container.querySelectorAll('.card.blueprint.elev-sm'))
      return cards.find((c) => c.querySelector('.card-title')?.textContent === 'Biggest movers')!
    }

    it('shows the empty-state message with a fixture that has fewer than 2 years of data', () => {
      const currentYear = String(new Date().getFullYear())
      const transactions: BudgetTransaction[] = [
        makeTransaction({ date: `${currentYear}-01-10`, categoryId: 'cat-housing', amount: 100 }),
      ]
      const state: AppState = { ...initialState(), budgetTransactions: transactions }
      const { container } = render(<BudgetAnalytics state={state} categories={MOVER_CATEGORIES} />)
      const moversCard = findMoversCard(container)
      expect(moversCard.textContent).toContain('No records for this period.')
    })

    it('renders 3 increases and 3 decreases, correctly ordered and labeled, for a multi-category multi-year fixture', () => {
      const currentYear = String(new Date().getFullYear())
      const prevYear = String(new Date().getFullYear() - 1)
      const transactions: BudgetTransaction[] = [
        // Housing: prev 100/mo avg -> current 500/mo avg (+400, biggest increase)
        makeTransaction({ date: `${prevYear}-01-10`, categoryId: 'cat-housing', amount: 100 }),
        makeTransaction({ date: `${prevYear}-02-10`, categoryId: 'cat-housing', amount: 100 }),
        makeTransaction({ date: `${currentYear}-01-10`, categoryId: 'cat-housing', amount: 500 }),
        makeTransaction({ date: `${currentYear}-02-10`, categoryId: 'cat-housing', amount: 500 }),
        // Food: prev 100/mo -> current 300/mo (+200)
        makeTransaction({ date: `${prevYear}-01-10`, categoryId: 'cat-food', amount: 100 }),
        makeTransaction({ date: `${prevYear}-02-10`, categoryId: 'cat-food', amount: 100 }),
        makeTransaction({ date: `${currentYear}-01-10`, categoryId: 'cat-food', amount: 300 }),
        makeTransaction({ date: `${currentYear}-02-10`, categoryId: 'cat-food', amount: 300 }),
        // Travel: prev 100/mo -> current 150/mo (+50, smallest increase)
        makeTransaction({ date: `${prevYear}-01-10`, categoryId: 'cat-travel', amount: 100 }),
        makeTransaction({ date: `${prevYear}-02-10`, categoryId: 'cat-travel', amount: 100 }),
        makeTransaction({ date: `${currentYear}-01-10`, categoryId: 'cat-travel', amount: 150 }),
        makeTransaction({ date: `${currentYear}-02-10`, categoryId: 'cat-travel', amount: 150 }),
        // Fun: prev 500/mo -> current 100/mo (-400, biggest decrease)
        makeTransaction({ date: `${prevYear}-01-10`, categoryId: 'cat-fun', amount: 500 }),
        makeTransaction({ date: `${prevYear}-02-10`, categoryId: 'cat-fun', amount: 500 }),
        makeTransaction({ date: `${currentYear}-01-10`, categoryId: 'cat-fun', amount: 100 }),
        makeTransaction({ date: `${currentYear}-02-10`, categoryId: 'cat-fun', amount: 100 }),
        // Utilities: prev 300/mo -> current 100/mo (-200)
        makeTransaction({ date: `${prevYear}-01-10`, categoryId: 'cat-utilities', amount: 300 }),
        makeTransaction({ date: `${prevYear}-02-10`, categoryId: 'cat-utilities', amount: 300 }),
        makeTransaction({ date: `${currentYear}-01-10`, categoryId: 'cat-utilities', amount: 100 }),
        makeTransaction({ date: `${currentYear}-02-10`, categoryId: 'cat-utilities', amount: 100 }),
        // Shopping: prev 150/mo -> current 100/mo (-50, smallest decrease)
        makeTransaction({ date: `${prevYear}-01-10`, categoryId: 'cat-shopping', amount: 150 }),
        makeTransaction({ date: `${prevYear}-02-10`, categoryId: 'cat-shopping', amount: 150 }),
        makeTransaction({ date: `${currentYear}-01-10`, categoryId: 'cat-shopping', amount: 100 }),
        makeTransaction({ date: `${currentYear}-02-10`, categoryId: 'cat-shopping', amount: 100 }),
        // ZeroDelta: prev 100/mo -> current 100/mo (0, must appear in neither list)
        makeTransaction({ date: `${prevYear}-01-10`, categoryId: 'cat-zero', amount: 100 }),
        makeTransaction({ date: `${prevYear}-02-10`, categoryId: 'cat-zero', amount: 100 }),
        makeTransaction({ date: `${currentYear}-01-10`, categoryId: 'cat-zero', amount: 100 }),
        makeTransaction({ date: `${currentYear}-02-10`, categoryId: 'cat-zero', amount: 100 }),
      ]
      const state: AppState = { ...initialState(), budgetTransactions: transactions }
      const { container } = render(<BudgetAnalytics state={state} categories={MOVER_CATEGORIES} />)
      const moversCard = findMoversCard(container)
      expect(moversCard.textContent).not.toContain('No records for this period.')

      const increaseRows = moversCard.querySelectorAll('[data-testid="mover-increase-row"]')
      const decreaseRows = moversCard.querySelectorAll('[data-testid="mover-decrease-row"]')
      expect(increaseRows.length).toBe(3)
      expect(decreaseRows.length).toBe(3)

      // No crash and zero-delta category excluded from both lists.
      expect(moversCard.querySelector('[data-category-id="cat-zero"]')).toBeFalsy()

      const increaseIds = Array.from(increaseRows).map((r) => r.getAttribute('data-category-id'))
      expect(increaseIds).toEqual(['cat-housing', 'cat-food', 'cat-travel'])
      expect(increaseRows[0].textContent).toContain('Housing')
      expect(increaseRows[0].textContent).toContain('+$400/mo')
      expect(increaseRows[1].textContent).toContain('+$200/mo')
      expect(increaseRows[2].textContent).toContain('+$50/mo')

      const decreaseIds = Array.from(decreaseRows).map((r) => r.getAttribute('data-category-id'))
      // Most-negative-first.
      expect(decreaseIds).toEqual(['cat-fun', 'cat-utilities', 'cat-shopping'])
      expect(decreaseRows[0].textContent).toContain('Fun')
      expect(decreaseRows[0].textContent).toContain('-$400/mo')
      expect(decreaseRows[0].textContent).not.toContain('--')
      expect(decreaseRows[1].textContent).toContain('-$200/mo')
      expect(decreaseRows[2].textContent).toContain('-$50/mo')
    })
  })

  describe('excludeFromSpend leak audit', () => {
    it('never lets a large excludeFromSpend category leak into any of the 7 sections', () => {
      // Fixture: 2 years, 3 normal categories (Housing, Food, Travel) plus one
      // excludeFromSpend category ("Investments") with amounts an order of magnitude
      // larger than everything else, so any leak would visibly dominate/skew results.
      const currentYear = String(new Date().getFullYear())
      const prevYear = String(new Date().getFullYear() - 1)
      const AUDIT_CATEGORIES: Category[] = [
        { id: 'cat-housing', name: 'Housing', updatedAt: CATEGORY_UPDATED_AT },
        { id: 'cat-food', name: 'Food', updatedAt: CATEGORY_UPDATED_AT },
        { id: 'cat-travel', name: 'Travel', updatedAt: CATEGORY_UPDATED_AT },
        { id: 'cat-excluded', name: 'Investments', updatedAt: CATEGORY_UPDATED_AT, excludeFromSpend: true },
      ]

      const transactions: BudgetTransaction[] = [
        // prevYear normal spend: Housing 200/mo, Food 100/mo, Travel 50/mo (Jan+Feb)
        makeTransaction({ date: `${prevYear}-01-10`, categoryId: 'cat-housing', amount: 200 }),
        makeTransaction({ date: `${prevYear}-02-10`, categoryId: 'cat-housing', amount: 200 }),
        makeTransaction({ date: `${prevYear}-01-10`, categoryId: 'cat-food', amount: 100 }),
        makeTransaction({ date: `${prevYear}-02-10`, categoryId: 'cat-food', amount: 100 }),
        makeTransaction({ date: `${prevYear}-01-10`, categoryId: 'cat-travel', amount: 50 }),
        makeTransaction({ date: `${prevYear}-02-10`, categoryId: 'cat-travel', amount: 50 }),
        // currentYear normal spend: same categories, same amounts (flat YoY - Travel/Food
        // are the "movers" baseline; Housing stays flat too so nothing but the excluded
        // category would ever look like a spike/mover/concentration risk).
        makeTransaction({ date: `${currentYear}-01-10`, categoryId: 'cat-housing', amount: 200 }),
        makeTransaction({ date: `${currentYear}-02-10`, categoryId: 'cat-housing', amount: 200 }),
        makeTransaction({ date: `${currentYear}-01-10`, categoryId: 'cat-food', amount: 100 }),
        makeTransaction({ date: `${currentYear}-02-10`, categoryId: 'cat-food', amount: 100 }),
        makeTransaction({ date: `${currentYear}-01-10`, categoryId: 'cat-travel', amount: 50 }),
        makeTransaction({ date: `${currentYear}-02-10`, categoryId: 'cat-travel', amount: 50 }),
        // Excluded category "Investments": massive amounts, order of magnitude larger,
        // concentrated in December of both years (would dominate spike/seasonality/
        // concentration/movers/budget-accuracy if it leaked anywhere).
        makeTransaction({ date: `${prevYear}-12-15`, categoryId: 'cat-excluded', amount: 50000 }),
        makeTransaction({ date: `${currentYear}-12-15`, categoryId: 'cat-excluded', amount: 90000 }),
      ]

      const state: AppState = {
        ...initialState(),
        budgetTransactions: transactions,
        budgetExpensesByYear: {
          [currentYear]: [
            { id: 'exp-housing', name: 'Rent', categoryId: 'cat-housing', amount: 200, frequency: 'monthly' },
          ],
        },
        budgetIncomeByYear: {
          [prevYear]: { monthly: 5000, yearly: 60000 },
          [currentYear]: { monthly: 5000, yearly: 60000 },
        },
      }

      const { container } = render(<BudgetAnalytics state={state} categories={AUDIT_CATEGORIES} />)

      // Global sanity: the excluded category's name never appears anywhere in the
      // rendered analytics, and neither does its distinguishing raw amount.
      expect(container.textContent).not.toContain('Investments')
      expect(container.textContent).not.toContain('50,000')
      expect(container.textContent).not.toContain('90,000')

      const cards = Array.from(container.querySelectorAll('.card.blueprint.elev-sm'))
      const cardByTitle = (title: string) =>
        cards.find((c) => c.querySelector('.card-title')?.textContent === title)!

      // --- 1. Areas of concern ---
      const concernCard = cardByTitle('Areas of concern')
      // Over budget: only Housing's own budget (200/mo) vs its own actual (200/mo) is
      // evaluated in the latest year -> not over budget. Investments must never appear
      // as an over-budget category name, and the count must not reflect it.
      expect(concernCard.textContent).not.toContain('Investments')
      expect(concernCard.textContent).toContain('0 categories')
      // Concentration risk: Housing (400/yr) is the largest among non-excluded categories
      // (Housing 400, Food 200, Travel 100 in currentYear) -> Housing, never Investments,
      // even though Investments' raw total (90000) dwarfs everything.
      expect(concernCard.textContent).toContain('Housing —')
      expect(concernCard.textContent).not.toMatch(/Investments\s*—/)

      // --- 2. Savings rate by year ---
      // Expected pct excludes Investments entirely:
      // prevYear: income = 5000*2 = 10000, spend = 200*2+100*2+50*2 = 700 -> pct = (10000-700)/10000*100 = 93%
      // currentYear: same spend/income shape -> pct = 93%
      // (If Investments leaked in, spend would balloon to 50700/90700 and pct would go deeply negative.)
      const savingsBars = container.querySelectorAll('[data-testid="savings-rate-bar"]')
      const savingsByYear = new Map(Array.from(savingsBars).map((b) => [b.getAttribute('data-year'), b]))
      const pctPrev = Number(savingsByYear.get(prevYear)!.getAttribute('data-pct'))
      const pctCurrent = Number(savingsByYear.get(currentYear)!.getAttribute('data-pct'))
      expect(pctPrev).toBeCloseTo(93, 0)
      expect(pctCurrent).toBeCloseTo(93, 0)

      // --- 3. Category share of spend ---
      const shareCard = cardByTitle('Category share of spend')
      expect(shareCard.textContent).not.toContain('Investments')
      const legendNames = Array.from(shareCard.querySelectorAll('[data-testid="category-share-legend-item"]')).map(
        (el) => el.textContent
      )
      expect(legendNames.every((n) => !n?.includes('Investments'))).toBe(true)
      const segments = shareCard.querySelectorAll('[data-testid="category-share-segment"]')
      expect(Array.from(segments).every((s) => s.getAttribute('data-category-id') !== 'cat-excluded')).toBe(true)

      // --- 4. Monthly seasonality ---
      // Expected avg spend for December, excluding Investments: neither year has any
      // non-excluded spend in December -> avg should be 0, and December must NOT be
      // flagged as the peak month (would be, if the 50k/90k leaked in).
      const seasonalityCard = cardByTitle('Monthly seasonality')
      const decBar = seasonalityCard.querySelector('[data-testid="seasonality-bar"][data-month="12"]')!
      expect(decBar.getAttribute('data-peak')).toBe('false')
      // January has Housing+Food+Travel = 200+100+50 = 350 in both years -> avg 350,
      // which should be the (or tied for) largest, definitely not December.
      const janBar = seasonalityCard.querySelector('[data-testid="seasonality-bar"][data-month="1"]')!
      // avgSpend isn't exposed via data attribute, but height is proportional to avgSpend/maxAvgSpend;
      // since Dec is 0 and Jan is 350 (max), Jan's inner bar should be full height (100%) and Dec's minimal.
      const janHeight = parseInt((janBar.querySelector('div') as HTMLElement).style.height, 10)
      const decHeight = parseInt((decBar.querySelector('div') as HTMLElement).style.height, 10)
      expect(janHeight).toBeGreaterThan(decHeight)

      // --- 5. Budget accuracy by year ---
      // currentYear: budgetTotal = 200/mo * 2 months = 400; actualTotal excluding Investments
      // = Housing(400) + Food(200) + Travel(100) = 700 -> variance = 400 - 700 = -300 (Over by $300).
      // If Investments' 90000 leaked into actualTotal, variance would be wildly more negative.
      const accuracyCard = cardByTitle('Budget accuracy by year')
      const accuracyRows = accuracyCard.querySelectorAll('[data-testid="accuracy-row"]')
      const accuracyByYear = new Map(Array.from(accuracyRows).map((r) => [r.getAttribute('data-year'), r]))
      const currentAccuracyRow = accuracyByYear.get(currentYear)!
      const varianceEl = currentAccuracyRow.querySelector('[data-testid="accuracy-variance"]') as HTMLElement
      expect(varianceEl.textContent).toBe('Over by $300')

      // --- 6. Category trends year over year ---
      const trendsCard = cardByTitle('Category trends year over year')
      const trendRows = trendsCard.querySelectorAll('[data-testid="trend-row"]')
      expect(trendsCard.querySelector('[data-category-id="cat-excluded"]')).toBeFalsy()
      expect(Array.from(trendRows).every((r) => r.textContent && !r.textContent.includes('Investments'))).toBe(true)

      // --- 7. Biggest movers ---
      // All three normal categories are flat YoY (delta 0) so none should appear as movers
      // either, but the key assertion is that Investments (delta = 90000-50000=40000/yr,
      // i.e. the dominant mover by far) never appears in either list.
      const moversCard = cardByTitle('Biggest movers')
      expect(moversCard.querySelector('[data-category-id="cat-excluded"]')).toBeFalsy()
      expect(moversCard.textContent).not.toContain('Investments')
    })
  })
})
