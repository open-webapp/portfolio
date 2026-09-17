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
})
