import { useReducer, useState } from 'react'
import { cleanup, fireEvent, render, screen, act, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BudgetPage as BudgetPageUnderTest, type BudgetPageProps } from './BudgetPage'
import { initialState } from '../lib/state'
import { appReducer } from '../lib/reducer'
import { sankeyFlowData, SPEND_ALL_YEARS, spendBudgetYears, expenseBudgetYears, projectedSpendForScope, type SpendScope } from '../lib/selectors'

afterEach(() => cleanup())
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

const periodProps = { period: 'spend' as const, setPeriod: vi.fn() }

// The Expense Summary card's "Largest transaction" tile renders a
// category tag + the largest transaction's description, which can collide
// with the same description text in the records table when queried with a
// bare screen.getByText. Scope row/description lookups to the table.
const recordsTable = () => screen.getByTestId('records-table')

// BudgetPage's production owner is App. This host supplies the controlled
// scope and retains the legacy test suite's direct-page interaction coverage.
function BudgetPage(props: Omit<BudgetPageProps, 'selectedScope' | 'setSelectedScope' | 'onScopeChange'>) {
  const [selectedScope, setSelectedScope] = useState<SpendScope>(
    () => spendBudgetYears(props.state.budgetTransactions)[0] ?? SPEND_ALL_YEARS
  )
  const availableYears = spendBudgetYears(props.state.budgetTransactions)
  const expenseYears = expenseBudgetYears(props.state.budgetExpenseAmountsByYear, new Date())
  const onScopeChange = (scope: SpendScope) => {
    setSelectedScope(scope)
    if (scope !== SPEND_ALL_YEARS && !props.state.budgetExpenseAmountsByYear[scope]) {
      props.dispatch({ type: 'ENSURE_BUDGET_YEAR_SNAPSHOT', year: scope })
    }
  }

  return (
    <>
      {props.period === 'spend' && (
        <select
          aria-label="Select year"
          value={selectedScope === SPEND_ALL_YEARS ? '__spend_all_years__' : selectedScope}
          onChange={(event) => onScopeChange(event.target.value === '__spend_all_years__' ? SPEND_ALL_YEARS : event.target.value)}
        >
          <option value="__spend_all_years__">All</option>
          {availableYears.map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
      )}
      {props.period === 'expenses' && (
        <select
          aria-label="Select year"
          value={selectedScope === SPEND_ALL_YEARS ? '' : selectedScope}
          onChange={(event) => onScopeChange(event.target.value)}
        >
          {expenseYears.map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
      )}
      <BudgetPageUnderTest {...props} selectedScope={selectedScope} setSelectedScope={setSelectedScope} onScopeChange={onScopeChange} />
    </>
  )
}

describe('BudgetPage derived income', () => {
  it('renders the scoped budget flow between the summary cards and records', () => {
    const year = String(new Date().getFullYear())
    const categories = [
      { id: 'income', name: 'Income', updatedAt: '' },
      { id: 'food', name: 'Food', updatedAt: '' },
    ]
    const definitions = [
      { id: 'salary', name: 'Salary', categoryId: 'income', frequency: 'yearly' as const },
      { id: 'groceries', name: 'Groceries', categoryId: 'food', frequency: 'yearly' as const },
    ]
    const amounts = { [year]: { salary: 1000, groceries: 400 } }
    const transactions = [
      { id: 'pay', date: `${year}-01-01`, description: 'Pay', categoryId: 'income', amount: 1000 },
      { id: 'market', date: `${year}-01-02`, description: 'Market', categoryId: 'food', amount: -250 },
    ]
    const expected = sankeyFlowData(definitions, amounts, transactions, categories, year)
    const { container } = render(
      <BudgetPage
        state={{ ...initialState(), budgetExpenseDefinitions: definitions, budgetExpenseAmountsByYear: amounts, budgetTransactions: transactions }}
        dispatch={vi.fn()}
        categories={categories}
        categoryDispatch={vi.fn()}
        {...periodProps}
      />
    )

    const chart = screen.getByTestId('budget-sankey')
    expect(chart.querySelectorAll('path')).toHaveLength(expected.links.length)
    expect(chart.querySelectorAll('rect')).toHaveLength(expected.nodes.length)
    expect(chart.textContent).toContain('Food: $400.00')
    expect(chart.textContent).toContain('Food: $250.00 actual')
    expect(container.querySelector('[data-testid="summary-cards"]')!.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(chart.compareDocumentPosition(screen.getByText(`Spend records (${year})`)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows an empty budget-flow state with no scoped categories', () => {
    render(<BudgetPage state={initialState()} dispatch={vi.fn()} categories={[]} categoryDispatch={vi.fn()} {...periodProps} />)

    expect(screen.getByTestId('budget-sankey').textContent).toContain('No budget flow for this period.')
    expect(screen.getByTestId('budget-sankey').querySelector('svg')).toBeNull()
  })

  it('renders a valid budget flow for a single category', () => {
    const year = String(new Date().getFullYear())
    render(
      <BudgetPage
        state={{
          ...initialState(),
          budgetExpenseDefinitions: [{ id: 'rent', name: 'Rent', categoryId: 'housing', frequency: 'yearly' }],
          budgetExpenseAmountsByYear: { [year]: { rent: 1000 } },
          budgetTransactions: [{ id: 'rent', date: `${year}-01-01`, description: 'Rent', categoryId: 'housing', amount: -500 }],
        }}
        dispatch={vi.fn()}
        categories={[{ id: 'housing', name: 'Housing', updatedAt: '' }]}
        categoryDispatch={vi.fn()}
        {...periodProps}
      />
    )

    const chart = screen.getByTestId('budget-sankey')
    expect(chart.querySelector('svg')).toBeTruthy()
    expect(chart.querySelectorAll('rect')).toHaveLength(4)
    expect(chart.querySelectorAll('path')).toHaveLength(3)
  })

  it('renders exactly four KPI tiles with no nested cards, and a savings-rate income editor', () => {
    const state = {
      ...initialState(),
      budgetExpenseDefinitions: [
        { id: 'salary', name: 'Salary', categoryId: 'income', frequency: 'monthly' as const },
        { id: 'rent', name: 'Rent', categoryId: 'housing', frequency: 'monthly' as const },
      ],
      budgetExpenseAmountsByYear: { [String(new Date().getFullYear())]: { salary: 1000, rent: 500 } },
      budgetTransactions: [
        { id: 'pay', date: `${new Date().getFullYear()}-01-01`, description: 'Pay', categoryId: 'income', amount: 1000 },
        { id: 'rent', date: `${new Date().getFullYear()}-01-02`, description: 'Rent', categoryId: 'housing', amount: 500 },
      ],
    }
    render(<BudgetPage state={state} dispatch={vi.fn()} categories={[{ id: 'income', name: 'Income', updatedAt: '' }, { id: 'housing', name: 'Housing', updatedAt: '' }]} categoryDispatch={vi.fn()} {...periodProps} />)
    const cards = screen.getByTestId('summary-cards')
    const tiles = cards.querySelectorAll('.kpi')
    expect(tiles).toHaveLength(4)
    tiles.forEach((tile) => expect(tile.querySelector('.card')).toBeNull())
    expect(screen.getByTestId('kpi-spend')).toBeTruthy()
    expect(screen.getByTestId('kpi-projected')).toBeTruthy()
    expect(screen.getByTestId('kpi-savings')).toBeTruthy()
    expect(screen.getByTestId('kpi-over-budget')).toBeTruthy()
    expect(screen.getByText(`Spend vs budget (${new Date().getFullYear()})`)).toBeTruthy()
    expect(cards.textContent).toContain('-$500.00 of $6,000.00 budget')
    expect(screen.getByText('Savings rate')).toBeTruthy()
    expect(screen.getByLabelText('Edit income')).toBeTruthy()
  })

  it('spend tile shows an on-pace/over-pace bar-fill class and renders the pace marker only for the current year', () => {
    vi.useFakeTimers()
    // Dec 31: full year elapsed, so the whole $1,200 annualized budget is "expected" — $300 actual is on pace.
    vi.setSystemTime(new Date('2026-12-31T12:00:00'))
    const state = {
      ...initialState(),
      budgetExpenseDefinitions: [{ id: 'rent', name: 'Rent', categoryId: 'housing', frequency: 'monthly' as const }],
      budgetExpenseAmountsByYear: { '2026': { rent: 100 } },
      budgetTransactions: [{ id: 'rent', date: '2026-01-02', description: 'Rent', categoryId: 'housing', amount: -300 }],
    }
    const { rerender } = render(<BudgetPage state={state} dispatch={vi.fn()} categories={[{ id: 'housing', name: 'Housing', updatedAt: '' }]} categoryDispatch={vi.fn()} {...periodProps} />)

    let spendTile = screen.getByTestId('kpi-spend')
    expect(spendTile.querySelector('.kpi-bar-fill')?.classList.contains('is-gain')).toBe(true)
    expect(within(spendTile).getByTestId('kpi-pace-marker')).toBeTruthy()

    // Jan 2: almost none of the year elapsed, so the prorated expected-by-today is tiny — $300 actual is over pace.
    vi.setSystemTime(new Date('2026-01-02T12:00:00'))
    rerender(<BudgetPage state={state} dispatch={vi.fn()} categories={[{ id: 'housing', name: 'Housing', updatedAt: '' }]} categoryDispatch={vi.fn()} {...periodProps} />)
    spendTile = screen.getByTestId('kpi-spend')
    expect(spendTile.querySelector('.kpi-bar-fill')?.classList.contains('is-loss')).toBe(true)
    expect(within(spendTile).getByTestId('kpi-pace-marker')).toBeTruthy()
    vi.useRealTimers()
  })

  it('spend tile has no pace marker for a past year or All scope, and bases gain/loss on actual-vs-budget only', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T12:00:00'))
    const definitions = [{ id: 'rent', name: 'Rent', categoryId: 'housing', frequency: 'yearly' as const }]
    const categories = [{ id: 'housing', name: 'Housing', updatedAt: '' }]

    // Past year, under budget: $100 actual vs $200 budget -> is-gain, no marker.
    const underState = {
      ...initialState(),
      budgetExpenseDefinitions: definitions,
      budgetExpenseAmountsByYear: { '2024': { rent: 200 } },
      budgetTransactions: [{ id: 'rent', date: '2024-01-02', description: 'Rent', categoryId: 'housing', amount: -100 }],
    }
    const { rerender } = render(<BudgetPage state={underState} dispatch={vi.fn()} categories={categories} categoryDispatch={vi.fn()} {...periodProps} />)
    let spendTile = screen.getByTestId('kpi-spend')
    expect(spendTile.querySelector('.kpi-bar-fill')?.classList.contains('is-gain')).toBe(true)
    expect(within(spendTile).queryByTestId('kpi-pace-marker')).toBeNull()

    // Past year, over budget: $300 actual vs $200 budget -> is-loss, no marker.
    const overState = {
      ...initialState(),
      budgetExpenseDefinitions: definitions,
      budgetExpenseAmountsByYear: { '2024': { rent: 200 } },
      budgetTransactions: [{ id: 'rent', date: '2024-01-02', description: 'Rent', categoryId: 'housing', amount: -300 }],
    }
    rerender(<BudgetPage state={overState} dispatch={vi.fn()} categories={categories} categoryDispatch={vi.fn()} {...periodProps} />)
    spendTile = screen.getByTestId('kpi-spend')
    expect(spendTile.querySelector('.kpi-bar-fill')?.classList.contains('is-loss')).toBe(true)
    expect(within(spendTile).queryByTestId('kpi-pace-marker')).toBeNull()

    // All scope: aggregated actual under aggregated budget -> is-gain, no marker.
    const allScopeState = {
      ...initialState(),
      budgetExpenseDefinitions: definitions,
      budgetExpenseAmountsByYear: { '2024': { rent: 200 } },
      budgetTransactions: [{ id: 'rent', date: '2024-01-02', description: 'Rent', categoryId: 'housing', amount: -100 }],
    }
    render(<BudgetPageUnderTest state={allScopeState} dispatch={vi.fn()} categories={categories} categoryDispatch={vi.fn()} categoriesHydrated selectedScope={SPEND_ALL_YEARS} setSelectedScope={vi.fn()} onScopeChange={vi.fn()} {...periodProps} />)
    const allScopeTile = screen.getAllByTestId('kpi-spend').at(-1)!
    expect(allScopeTile.querySelector('.kpi-bar-fill')?.classList.contains('is-gain')).toBe(true)
    expect(within(allScopeTile).queryByTestId('kpi-pace-marker')).toBeNull()

    vi.useRealTimers()
  })

  it('projected tile shows year-end projection for the current year without extrapolating a once-paid yearly lump sum', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-02T12:00:00'))
    const definitions = [{ id: 'ins', name: 'Insurance', categoryId: 'housing', frequency: 'yearly' as const }]
    const amountsByYear = { '2026': { ins: 2400 } }
    const transactions = [{ id: 'ins-pay', date: '2026-01-05', description: 'Insurance payment', categoryId: 'housing', amount: -1200, spendExpenseId: 'ins' }]
    const categories = [{ id: 'housing', name: 'Housing', updatedAt: '' }]
    const state = { ...initialState(), budgetExpenseDefinitions: definitions, budgetExpenseAmountsByYear: amountsByYear, budgetTransactions: transactions }

    const expected = projectedSpendForScope(definitions, amountsByYear, transactions, categories, '2026', new Date('2026-07-02T12:00:00'))!
    // Sanity: a naive straight-line extrapolation would inflate this well past the lump amount actually paid.
    expect(expected.projectedTotal).toBe(1200)

    render(<BudgetPage state={state} dispatch={vi.fn()} categories={categories} categoryDispatch={vi.fn()} {...periodProps} />)
    const projectedTile = screen.getByTestId('kpi-projected')
    expect(projectedTile.textContent).toContain('Projected year-end')
    expect(projectedTile.textContent).toContain('$1,200.00')
    expect(projectedTile.textContent).toMatch(/% under budget|% over budget/)
    expect(projectedTile.textContent).toContain('50.0% under budget')
    vi.useRealTimers()
  })

  it('projected tile shows final-vs-budget for a past year and avg-yearly for All scope', () => {
    const definitions = [{ id: 'rent', name: 'Rent', categoryId: 'housing', frequency: 'yearly' as const }]
    const categories = [{ id: 'housing', name: 'Housing', updatedAt: '' }]
    const pastState = {
      ...initialState(),
      budgetExpenseDefinitions: definitions,
      budgetExpenseAmountsByYear: { '2024': { rent: 200 } },
      budgetTransactions: [{ id: 'rent', date: '2024-01-02', description: 'Rent', categoryId: 'housing', amount: -100 }],
    }
    render(<BudgetPage state={pastState} dispatch={vi.fn()} categories={categories} categoryDispatch={vi.fn()} {...periodProps} />)
    const pastTile = screen.getByTestId('kpi-projected')
    expect(pastTile.textContent).toContain('Final vs budget')
    expect(pastTile.textContent).toContain('$100.00')
    expect(pastTile.textContent).toContain('under budget')

    cleanup()
    render(<BudgetPageUnderTest state={pastState} dispatch={vi.fn()} categories={categories} categoryDispatch={vi.fn()} categoriesHydrated selectedScope={SPEND_ALL_YEARS} setSelectedScope={vi.fn()} onScopeChange={vi.fn()} {...periodProps} />)
    const allTile = screen.getByTestId('kpi-projected')
    expect(allTile.textContent).toContain('Avg yearly spend')
    expect(allTile.textContent).toContain('avg yearly budget')
  })

  it('savings tile shows the income editor per-year but not for All scope, which shows an aggregate instead', () => {
    const definitions = [{ id: 'salary', name: 'Salary', categoryId: 'income', frequency: 'yearly' as const }]
    const categories = [{ id: 'income', name: 'Income', updatedAt: '' }]
    const state = {
      ...initialState(),
      budgetExpenseDefinitions: definitions,
      budgetExpenseAmountsByYear: { '2025': { salary: 1000 } },
      budgetTransactions: [{ id: 'pay', date: '2025-01-01', description: 'Pay', categoryId: 'income', amount: 1000 }],
    }
    render(<BudgetPage state={state} dispatch={vi.fn()} categories={categories} categoryDispatch={vi.fn()} {...periodProps} />)
    const yearTile = screen.getByTestId('kpi-savings')
    expect(within(yearTile).getByLabelText('Edit income')).toBeTruthy()
    expect(yearTile.textContent).toMatch(/%/)

    cleanup()
    render(<BudgetPageUnderTest state={state} dispatch={vi.fn()} categories={categories} categoryDispatch={vi.fn()} categoriesHydrated selectedScope={SPEND_ALL_YEARS} setSelectedScope={vi.fn()} onScopeChange={vi.fn()} {...periodProps} />)
    const allTile = screen.getByTestId('kpi-savings')
    expect(within(allTile).queryByLabelText('Edit income')).toBeNull()
    expect(allTile.textContent).toMatch(/%/)
  })

  it('updates an existing Income definition and clamps a negative income amount to zero', () => {
    const dispatch = vi.fn()
    const year = new Date().getFullYear()
    const state = {
      ...initialState(),
      budgetExpenseDefinitions: [{ id: 'income', name: 'Income', categoryId: 'income-category', frequency: 'yearly' as const }],
      budgetExpenseAmountsByYear: { [year]: { income: 1000 } },
      budgetTransactions: [{ id: 'spend', date: `${year}-01-01`, description: 'Rent', categoryId: 'housing', amount: -50 }],
    }
    render(<BudgetPage state={state} dispatch={dispatch} categories={[{ id: 'income-category', name: 'Income', updatedAt: '' }, { id: 'housing', name: 'Housing', updatedAt: '' }]} categoryDispatch={vi.fn()} {...periodProps} />)

    fireEvent.click(screen.getByLabelText('Edit income'))
    fireEvent.change(screen.getByLabelText('Income amount'), { target: { value: '1500' } })
    fireEvent.blur(screen.getByLabelText('Income amount'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_EXPENSE_AMOUNT', year: String(year), expenseId: 'income', amount: 1500 })

    fireEvent.click(screen.getByLabelText('Edit income'))
    fireEvent.change(screen.getByLabelText('Income amount'), { target: { value: '-10' } })
    fireEvent.blur(screen.getByLabelText('Income amount'))
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'SET_EXPENSE_AMOUNT', year: String(year), expenseId: 'income', amount: 0 })
  })

  it('creates an Income definition when none exists', () => {
    const dispatch = vi.fn()
    const year = new Date().getFullYear()
    const state = {
      ...initialState(),
      budgetTransactions: [{ id: 'spend', date: `${year}-01-01`, description: 'Rent', categoryId: 'housing', amount: -50 }],
    }
    render(<BudgetPage state={state} dispatch={dispatch} categories={[{ id: 'income-category', name: 'Income', updatedAt: '' }, { id: 'housing', name: 'Housing', updatedAt: '' }]} categoryDispatch={vi.fn()} {...periodProps} />)

    fireEvent.click(screen.getByLabelText('Edit income'))
    fireEvent.change(screen.getByLabelText('Income amount'), { target: { value: '2000' } })
    fireEvent.blur(screen.getByLabelText('Income amount'))

    expect(dispatch).toHaveBeenCalledWith({
      type: 'ADD_EXPENSE_DEFINITION',
      definition: { name: 'Income', categoryId: 'income-category', frequency: 'yearly' },
      amount: 2000,
    })
  })

  it('finds unlinked spend records by their displayed Uncategorized category label', () => {
    const year = new Date().getFullYear()
    const state = {
      ...initialState(),
      budgetTransactions: [
        { id: 'grocery', date: `${year}-01-01`, description: 'Market run', categoryId: 'food', amount: 42 },
      ],
    }
    render(
      <BudgetPage
        state={state}
        dispatch={vi.fn()}
        categories={[{ id: 'food', name: 'Food', updatedAt: '' }]}
        categoryDispatch={vi.fn()}
        {...periodProps}
      />
    )

    fireEvent.change(screen.getAllByLabelText('Search records').at(-1)!, { target: { value: 'Uncategorized' } })

    expect(within(recordsTable()).getByText('Market run')).toBeTruthy()
    expect(within(recordsTable()).getByText('Uncategorized (Food)')).toBeTruthy()
  })

  it('over-budget tile shows at most 3 rows plus a "+N more" line, correct statuses, an infinite % for zero-budget overage, and matches the total count', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-02T12:00:00'))
    const categories = [
      { id: 'c1', name: 'Cat One', updatedAt: '' },
      { id: 'c2', name: 'Cat Two', updatedAt: '' },
      { id: 'c3', name: 'Cat Three', updatedAt: '' },
      { id: 'c4', name: 'Cat Four', updatedAt: '' },
      { id: 'c5', name: 'Cat Five', updatedAt: '' },
    ]
    const definitions = [
      { id: 'd1', name: 'D1', categoryId: 'c1', frequency: 'monthly' as const },
      { id: 'd2', name: 'D2', categoryId: 'c2', frequency: 'monthly' as const },
      { id: 'd3', name: 'D3', categoryId: 'c3', frequency: 'monthly' as const },
      { id: 'd4', name: 'D4', categoryId: 'c4', frequency: 'monthly' as const },
      { id: 'd5', name: 'D5', categoryId: 'c5', frequency: 'monthly' as const },
    ]
    // c1, c2: already over budget today ("over"). c3, c4, c5: under budget today but
    // their year-end projection (extrapolated from ~50% of the year elapsed) exceeds
    // budget ("projected"). c2 has a zero budget, exercising the "infinite %" case.
    const amountsByYear = {
      '2026': { d1: 80, d2: 0, d3: 100, d4: 200, d5: 50 },
    }
    const transactions = [
      { id: 't1', date: '2026-01-10', description: 'Over one', categoryId: 'c1', amount: -1000 },
      { id: 't2', date: '2026-01-10', description: 'Over two', categoryId: 'c2', amount: -333 },
      { id: 't3', date: '2026-01-10', description: 'Proj three', categoryId: 'c3', amount: -700 },
      { id: 't4', date: '2026-01-10', description: 'Proj four', categoryId: 'c4', amount: -1300 },
      { id: 't5', date: '2026-01-10', description: 'Proj five', categoryId: 'c5', amount: -350 },
    ]
    const state = { ...initialState(), budgetExpenseDefinitions: definitions, budgetExpenseAmountsByYear: amountsByYear, budgetTransactions: transactions }
    render(<BudgetPage state={state} dispatch={vi.fn()} categories={categories} categoryDispatch={vi.fn()} {...periodProps} />)

    const tile = screen.getByTestId('kpi-over-budget')
    const items = within(tile).getAllByTestId('kpi-over-budget-item')
    expect(items).toHaveLength(3)
    const statuses = items.map((item) => item.getAttribute('data-status'))
    expect(statuses.filter((s) => s === 'over').length).toBeGreaterThan(0)
    expect(statuses.filter((s) => s === 'projected').length).toBeGreaterThan(0)
    expect(tile.textContent).toContain('∞%')
    const more = within(tile).getByTestId('kpi-over-budget-more')
    const totalRows = items.length + Number(more.textContent!.match(/\+(\d+) more/)![1])
    expect(tile.querySelector('.kpi-value')!.textContent).toBe(String(totalRows))
    vi.useRealTimers()
  })

  it('over-budget tile shows the on-track empty state with a "0" value when nothing is over budget', () => {
    const categories = [{ id: 'housing', name: 'Housing', updatedAt: '' }]
    const definitions = [{ id: 'rent', name: 'Rent', categoryId: 'housing', frequency: 'monthly' as const }]
    const state = {
      ...initialState(),
      budgetExpenseDefinitions: definitions,
      budgetExpenseAmountsByYear: { '2025': { rent: 100 } },
      budgetTransactions: [{ id: 'rent', date: '2025-01-02', description: 'Rent', categoryId: 'housing', amount: -50 }],
    }
    render(<BudgetPage state={state} dispatch={vi.fn()} categories={categories} categoryDispatch={vi.fn()} {...periodProps} />)

    const tile = screen.getByTestId('kpi-over-budget')
    expect(tile.textContent).toContain('All categories on track')
    expect(tile.querySelector('.kpi-value')!.textContent).toBe('0')
    expect(screen.queryByTestId('kpi-over-budget-item')).toBeNull()
  })

  it('clicking an over-budget category name searches records for it, resets to page 1, and scrolls the records section into view', () => {
    const categories = [
      { id: 'housing', name: 'Housing', updatedAt: '' },
      { id: 'food', name: 'Food', updatedAt: '' },
    ]
    const definitions = [{ id: 'rent', name: 'Rent', categoryId: 'housing', frequency: 'monthly' as const }]
    const pagedFoodRecords = Array.from({ length: 55 }, (_, index) => ({
      id: `food-${index}`,
      date: `2025-02-${String((index % 27) + 1).padStart(2, '0')}`,
      description: `Food record ${String(index).padStart(2, '0')}`,
      categoryId: 'food',
      amount: -1,
    }))
    const state = {
      ...initialState(),
      budgetExpenseDefinitions: definitions,
      budgetExpenseAmountsByYear: { '2025': { rent: 2 } },
      budgetTransactions: [
        { id: 'rent', date: '2025-01-02', description: 'Rent', categoryId: 'housing', amount: -50 },
        ...pagedFoodRecords,
      ],
    }
    render(<BudgetPage state={state} dispatch={vi.fn()} categories={categories} categoryDispatch={vi.fn()} {...periodProps} />)

    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByTestId('records-pagination').textContent).toContain('Page 2 of 2')

    const tile = screen.getByTestId('kpi-over-budget')
    fireEvent.click(within(tile).getByText('Housing'))

    expect((screen.getByLabelText('Search records') as HTMLInputElement).value).toBe('Housing')
    // The Housing filter narrows results to a single page, so pagination resetting to
    // page 1 is evidenced by the filtered (first-page) row being visible directly.
    expect(within(recordsTable()).getByText('Rent')).toBeTruthy()
    expect(screen.queryByTestId('records-pagination')).toBeNull()
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })
})

describe('BudgetPage period props', () => {
  const props = {
    state: initialState(),
    dispatch: vi.fn(),
    categories: [],
    categoryDispatch: vi.fn(),
    categoriesHydrated: true,
    setPeriod: vi.fn(),
  }

  it('renders sub-tab content from the period prop and updates it on rerender', () => {
    const { container, rerender } = render(<BudgetPage {...props} period="spend" />)
    const contents = new Set<string>()
    contents.add(container.textContent ?? '')
    expect(screen.getByTestId('summary-cards')).toBeTruthy()

    for (const period of ['expenses', 'analytics'] as const) {
      rerender(<BudgetPage {...props} period={period} />)
      expect(screen.queryByTestId('summary-cards')).toBeNull()
      contents.add(container.textContent ?? '')
    }

    expect(contents.size).toBe(3)
  })

  it('does not render the App-owned year scope selector', () => {
    render(<BudgetPageUnderTest {...props} period="spend" selectedScope="2025" setSelectedScope={vi.fn()} onScopeChange={vi.fn()} />)

    expect(screen.queryByLabelText('Select year')).toBeNull()
  })
})

describe('BudgetPage Spend/Expenses shared-scope reconcile (T6)', () => {
  const currentYear = String(new Date().getFullYear())
  const t6Categories = [{ id: 'food', name: 'Food', updatedAt: '' }]
  const t6Definitions = [{ id: 'groceries', name: 'Groceries', categoryId: 'food', frequency: 'monthly' as const }]

  // Local harness that owns `period` (mirroring App.tsx's PeriodSegControl
  // Spend/Expenses tabs) and a real reducer, so the reconcile effects in
  // BudgetPage run against actual state transitions exactly as in production.
  const T6Harness = ({ initial, actions }: { initial: ReturnType<typeof initialState>; actions: ReturnType<typeof vi.fn> }) => {
    const [period, setPeriod] = useState<'spend' | 'expenses' | 'analytics'>('spend')
    const [appState, setAppState] = useState(initial)
    return (
      <>
        <button type="button" onClick={() => setPeriod('spend')}>Spend</button>
        <button type="button" onClick={() => setPeriod('expenses')}>Expenses</button>
        {/*
          Test-only escape hatch: clearing an expense's last amount for a year
          removes that expenseId key but (per state.ts's clearExpenseAmount)
          leaves the year's now-empty {} entry in place, which
          expenseBudgetYears still counts as budgeted. This button instead
          drops the year key outright, simulating the year fully vacating the
          budgeted map, to exercise BudgetPage's reconcile effect in isolation
          from that unrelated persistence detail.
        */}
        <button
          type="button"
          onClick={() =>
            setAppState((s) => {
              const { ['2027']: _drop, ...rest } = s.budgetExpenseAmountsByYear
              return { ...s, budgetExpenseAmountsByYear: rest }
            })
          }
        >
          clear-2027-amount
        </button>
        <BudgetPage
          state={appState}
          dispatch={(action) => {
            actions(action)
            setAppState((s) => appReducer(s, action))
          }}
          categories={t6Categories}
          categoryDispatch={vi.fn()}
          categoriesHydrated
          period={period}
          setPeriod={setPeriod}
        />
      </>
    )
  }

  const renderReconcile = (state = initialState()) => {
    const actions = vi.fn()
    render(<T6Harness initial={state} actions={actions} />)
    return actions
  }

  const RECONCILE_TIMEOUT_MS = 2000

  it('(a) resets All scope to the current year when switching Spend -> Expenses', () => {
    renderReconcile()
    fireEvent.click(screen.getByText('Expenses'))

    const yearSelect = screen.getByLabelText('Select year') as HTMLSelectElement
    expect(yearSelect.value).toBe(currentYear)
  }, RECONCILE_TIMEOUT_MS)

  it('(b) resets a past year with transactions but no budgeted amounts to the current year on Expenses', () => {
    const state = {
      ...initialState(),
      budgetExpenseDefinitions: t6Definitions,
      budgetTransactions: [{ id: 'old', date: '2019-01-01', description: 'Old', categoryId: 'food', amount: -10 }],
    }
    renderReconcile(state)
    const spendYearSelect = screen.getByLabelText('Select year') as HTMLSelectElement
    fireEvent.change(spendYearSelect, { target: { value: '2019' } })
    expect(spendYearSelect.value).toBe('2019')

    fireEvent.click(screen.getByText('Expenses'))

    const yearSelect = screen.getByLabelText('Select year') as HTMLSelectElement
    expect(yearSelect.value).toBe(currentYear)
  }, RECONCILE_TIMEOUT_MS)

  it('(c) keeps a budgeted-only future year selected on Expenses (Spend reset effect stays gated off)', () => {
    const state = {
      ...initialState(),
      budgetExpenseDefinitions: t6Definitions,
      budgetExpenseAmountsByYear: { '2027': { groceries: 100 } },
    }
    renderReconcile(state)
    fireEvent.click(screen.getByText('Expenses'))
    let yearSelect = screen.getByLabelText('Select year') as HTMLSelectElement
    fireEvent.change(yearSelect, { target: { value: '2027' } })
    yearSelect = screen.getByLabelText('Select year') as HTMLSelectElement
    expect(yearSelect.value).toBe('2027')
    // If the Spend all-years reset effect were still running for the Expenses
    // period, this would ping-pong (2027 -> All -> current year) or hang.
  }, RECONCILE_TIMEOUT_MS)

  it('(d) switching back to Spend from a budgeted future year on Expenses resets scope to All', () => {
    const state = {
      ...initialState(),
      budgetExpenseDefinitions: t6Definitions,
      budgetExpenseAmountsByYear: { '2027': { groceries: 100 } },
    }
    renderReconcile(state)
    fireEvent.click(screen.getByText('Expenses'))
    fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '2027' } })
    fireEvent.click(screen.getByText('Spend'))

    const yearSelect = screen.getByLabelText('Select year') as HTMLSelectElement
    expect(yearSelect.value).toBe('__spend_all_years__')
  }, RECONCILE_TIMEOUT_MS)

  it('(e) clearing the last budget amount of the selected non-current year on Expenses jumps to current year', () => {
    const state = {
      ...initialState(),
      budgetExpenseDefinitions: t6Definitions,
      budgetExpenseAmountsByYear: { '2027': { groceries: 100 } },
    }
    renderReconcile(state)
    fireEvent.click(screen.getByText('Expenses'))
    fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '2027' } })
    expect((screen.getByLabelText('Select year') as HTMLSelectElement).value).toBe('2027')

    fireEvent.click(screen.getByText('clear-2027-amount'))

    const yearSelect = screen.getByLabelText('Select year') as HTMLSelectElement
    expect(yearSelect.value).toBe(currentYear)
  }, RECONCILE_TIMEOUT_MS)

  it('(f) reconcile with no current-year snapshot dispatches ENSURE_BUDGET_YEAR_SNAPSHOT and lands on the current year', () => {
    const state = {
      ...initialState(),
      budgetExpenseDefinitions: t6Definitions,
      budgetExpenseAmountsByYear: { '2024': { groceries: 100 } },
    }
    const actions = renderReconcile(state)
    fireEvent.click(screen.getByText('Expenses'))

    expect(actions).toHaveBeenCalledWith({ type: 'ENSURE_BUDGET_YEAR_SNAPSHOT', year: currentYear })
    const yearSelect = screen.getByLabelText('Select year') as HTMLSelectElement
    expect(yearSelect.value).toBe(currentYear)
  }, RECONCILE_TIMEOUT_MS)

  it('(g) reconcile does not dispatch ENSURE_BUDGET_YEAR_SNAPSHOT when the current year already has a snapshot entry', () => {
    const state = {
      ...initialState(),
      budgetExpenseDefinitions: t6Definitions,
      budgetExpenseAmountsByYear: { [currentYear]: { groceries: 100 } },
    }
    const actions = renderReconcile(state)
    fireEvent.click(screen.getByText('Expenses'))

    expect(actions).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ENSURE_BUDGET_YEAR_SNAPSHOT' }))
    const yearSelect = screen.getByLabelText('Select year') as HTMLSelectElement
    expect(yearSelect.value).toBe(currentYear)
  }, RECONCILE_TIMEOUT_MS)
})

describe('BudgetPage Spend scopes', () => {
  const categories = [
    { id: 'food', name: 'Food', updatedAt: '' },
    { id: 'income', name: 'Income', updatedAt: '' },
    { id: 'excluded', name: 'Excluded', updatedAt: '', excludeFromSpend: true },
  ]
  const definitions = [
    { id: 'salary', name: 'Salary', categoryId: 'income', frequency: 'monthly' as const },
    { id: 'groceries', name: 'Groceries', categoryId: 'food', frequency: 'monthly' as const },
    { id: 'ignored', name: 'Ignored', categoryId: 'excluded', frequency: 'monthly' as const },
  ]
  const transactions = [
    { id: 'income-2024', date: '2024-01-01', description: 'Pay 2024', categoryId: 'income', amount: 1000 },
    { id: 'alpha-2024', date: '2024-03-01', description: 'Alpha spend', categoryId: 'food', amount: 25, accountName: 'Shared account' },
    { id: 'excluded-2024', date: '2024-04-01', description: 'Excluded 2024', categoryId: 'excluded', amount: 7 },
    { id: 'income-2025', date: '2025-01-01', description: 'Pay 2025', categoryId: 'income', amount: 2000 },
    { id: 'zulu-2025', date: '2025-03-01', description: 'Zulu spend', categoryId: 'food', amount: 75, accountName: 'Shared account' },
    { id: 'excluded-2025', date: '2025-04-01', description: 'Excluded 2025', categoryId: 'excluded', amount: 10 },
  ]

  const spendState = (extraTransactions = transactions) => ({
    ...initialState(),
    budgetExpenseDefinitions: definitions,
    // 2025 intentionally has transactions but no snapshot; 2023 is snapshot-only.
    budgetExpenseAmountsByYear: {
      '2023': { salary: 999, groceries: 999 },
      '2024': { salary: 100, groceries: 50, ignored: 10 },
    },
    budgetTransactions: extraTransactions,
  })

  const renderSpend = (state = spendState()) => {
    const dispatch = vi.fn()
    render(<BudgetPage state={state} dispatch={dispatch} categories={categories} categoryDispatch={vi.fn()} categoriesHydrated {...periodProps} />)
    return dispatch
  }

  const SpendHarness = ({ state = spendState(), actions }: { state?: ReturnType<typeof spendState>; actions: ReturnType<typeof vi.fn> }) => {
    const [appState, dispatch] = useReducer(appReducer, state)
    return (
      <BudgetPage
        state={appState}
        dispatch={(action) => {
          actions(action)
          dispatch(action)
        }}
        categories={categories}
        categoryDispatch={vi.fn()}
        categoriesHydrated
        {...periodProps}
      />
    )
  }

  const renderSpendHarness = (state = spendState()) => {
    const actions = vi.fn()
    render(<SpendHarness state={state} actions={actions} />)
    return actions
  }

  it('starts at the newest transaction year and only offers transaction-backed concrete years after All', () => {
    renderSpend()

    const yearSelect = screen.getByLabelText('Select year') as HTMLSelectElement
    expect(Array.from(yearSelect.options, (option) => option.text)).toEqual(['All', '2025', '2024'])
    expect(yearSelect.value).toBe('2025')
    expect(screen.getByText('Spend vs budget (2025)')).toBeTruthy()
    expect(screen.getByText('Zulu spend')).toBeTruthy()
    expect(screen.queryByText('Alpha spend')).toBeNull()
  })

  it('shows an all-years zero state without requesting a snapshot', () => {
    const dispatch = renderSpend(spendState([]))

    const yearSelect = screen.getByLabelText('Select year') as HTMLSelectElement
    expect(Array.from(yearSelect.options, (option) => option.text)).toEqual(['All'])
    expect(screen.getByText('Spend vs budget (All years)')).toBeTruthy()
    expect(screen.getByTestId('summary-cards').querySelectorAll('.kpi')).toHaveLength(4)
    expect(screen.getAllByText('N/A')).toHaveLength(1)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('aggregates exact transaction years and renders rows from both years under All', () => {
    renderSpend()

    fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '__spend_all_years__' } })

    expect(screen.getByText('Spend vs budget (All years)')).toBeTruthy()
    expect(screen.getByTestId('summary-cards').textContent).toContain('-$100.00 of $600.00 budget')
    expect(screen.getByText('Alpha spend')).toBeTruthy()
    expect(screen.getByText('Zulu spend')).toBeTruthy()
    expect(screen.getByTestId('records-total-row').textContent).toContain('$100.00')
  })

  it('uses parent-supplied All and concrete scopes on rerender', () => {
    const props = {
      state: spendState(),
      dispatch: vi.fn(),
      categories,
      categoryDispatch: vi.fn(),
      categoriesHydrated: true,
      ...periodProps,
      setSelectedScope: vi.fn(),
      onScopeChange: vi.fn(),
    }
    const { rerender } = render(<BudgetPageUnderTest {...props} selectedScope={SPEND_ALL_YEARS} />)

    expect(screen.getByText('Spend vs budget (All years)')).toBeTruthy()
    expect(screen.getByText('Alpha spend')).toBeTruthy()
    expect(screen.getByText('Zulu spend')).toBeTruthy()

    rerender(<BudgetPageUnderTest {...props} selectedScope="2024" />)

    expect(screen.getByText('Spend vs budget (2024)')).toBeTruthy()
    expect(screen.getByText('Alpha spend')).toBeTruthy()
    expect(screen.queryByText('Zulu spend')).toBeNull()
  })

  it('includes excluded rows and their table total without changing all-years cards', () => {
    renderSpend()
    fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '__spend_all_years__' } })
    const cardsBefore = screen.getByTestId('summary-cards').textContent

    fireEvent.click(screen.getByLabelText('Show excluded'))

    expect(screen.getByText('Pay 2024')).toBeTruthy()
    expect(screen.getByText('Excluded 2025')).toBeTruthy()
    expect(screen.getByTestId('records-total-row').textContent).toContain('$3,117.00')
    expect(screen.getByTestId('summary-cards').textContent).toBe(cardsBefore)
  })

  it('searches, sorts, and paginates the combined all-years records', () => {
    const pagedTransactions = [
      ...transactions,
      ...Array.from({ length: 51 }, (_, index) => ({
        id: `paged-${index}`,
        date: `${index % 2 === 0 ? '2024' : '2025'}-06-${String((index % 28) + 1).padStart(2, '0')}`,
        description: `Paged ${String(index).padStart(2, '0')}`,
        categoryId: 'food',
        amount: index + 1,
      })),
    ]
    renderSpend(spendState(pagedTransactions))
    fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '__spend_all_years__' } })

    fireEvent.change(screen.getByLabelText('Search records'), { target: { value: 'Shared account' } })
    expect(screen.getByText('Alpha spend')).toBeTruthy()
    expect(screen.getByText('Zulu spend')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Search records'), { target: { value: '' } })
    fireEvent.click(screen.getByLabelText('Sort by description'))
    expect(screen.getByText('Alpha spend').compareDocumentPosition(screen.getByText('Paged 00')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('records-pagination').textContent).toContain('Page 1 of 2')
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByTestId('records-pagination').textContent).toContain('Page 2 of 2')
    expect(screen.getByText('Paged 49')).toBeTruthy()
    expect(screen.getByText('Zulu spend')).toBeTruthy()
  })

  it('restores a concrete year and requests its missing snapshot exactly once', () => {
    const dispatch = renderSpend()
    fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '__spend_all_years__' } })
    fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '2025' } })

    expect(screen.getByText('Spend vs budget (2025)')).toBeTruthy()
    expect(screen.getByText('Zulu spend')).toBeTruthy()
    expect(screen.queryByText('Alpha spend')).toBeNull()
    expect(screen.getByTestId('summary-cards').textContent).toContain('-$75.00 of $0.00 budget')
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({ type: 'ENSURE_BUDGET_YEAR_SNAPSHOT', year: '2025' })
  })

  it('keeps All after adding a record without ensuring its year snapshot', () => {
    const actions = renderSpendHarness()
    fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '__spend_all_years__' } })
    fireEvent.change(screen.getByLabelText('Record date'), { target: { value: '2026-02-01' } })
    fireEvent.change(screen.getByLabelText('Record description'), { target: { value: 'All scope add' } })
    fireEvent.change(screen.getByLabelText('Record amount'), { target: { value: '20' } })
    fireEvent.click(screen.getByText('Add Record'))

    expect((screen.getByLabelText('Select year') as HTMLSelectElement).value).toBe('__spend_all_years__')
    expect(screen.getByText('All scope add')).toBeTruthy()
    expect(actions).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ENSURE_BUDGET_YEAR_SNAPSHOT' }))
  })

  it('switches a concrete scope to an added record year and ensures its missing snapshot', () => {
    const actions = renderSpendHarness()
    fireEvent.change(screen.getByLabelText('Record date'), { target: { value: '2026-02-01' } })
    fireEvent.change(screen.getByLabelText('Record description'), { target: { value: 'Concrete scope add' } })
    fireEvent.change(screen.getByLabelText('Record amount'), { target: { value: '20' } })
    fireEvent.click(screen.getByText('Add Record'))

    expect((screen.getByLabelText('Select year') as HTMLSelectElement).value).toBe('2026')
    expect(within(recordsTable()).getByText('Concrete scope add')).toBeTruthy()
    expect(actions).toHaveBeenCalledWith({ type: 'ENSURE_BUDGET_YEAR_SNAPSHOT', year: '2026' })
  })

  it('keeps All after importing records without ensuring a snapshot', () => {
    const actions = renderSpendHarness()
    fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '__spend_all_years__' } })
    fireEvent.click(screen.getByText('Import transactions…'))
    fireEvent.change(screen.getByLabelText('Import account'), { target: { value: '__new__' } })
    fireEvent.change(screen.getByLabelText('New import account name'), { target: { value: 'Imported account' } })
    fireEvent.change(screen.getByLabelText('Paste CSV text'), {
      target: { value: 'Date,Description,Amount\n2026-02-01,Imported all scope,30' },
    })
    fireEvent.click(screen.getByText('Import'))

    expect((screen.getByLabelText('Select year') as HTMLSelectElement).value).toBe('__spend_all_years__')
    expect(screen.getByText('Imported all scope')).toBeTruthy()
    expect(actions).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ENSURE_BUDGET_YEAR_SNAPSHOT' }))
  })

  it('moves to All only when deleting the last row in a concrete year', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const lifecycleTransactions = transactions.filter((transaction) => transaction.id === 'alpha-2024' || transaction.id === 'zulu-2025')
    renderSpendHarness(spendState(lifecycleTransactions))
    fireEvent.click(screen.getByLabelText('Delete record'))
    expect((screen.getByLabelText('Select year') as HTMLSelectElement).value).toBe('__spend_all_years__')
    cleanup()

    renderSpendHarness(spendState([...lifecycleTransactions, { id: 'second-2025', date: '2025-06-01', description: 'Second 2025', categoryId: 'food', amount: 5 }]))
    fireEvent.click(screen.getAllByLabelText('Delete record')[0])
    expect((screen.getByLabelText('Select year') as HTMLSelectElement).value).toBe('2025')
    confirm.mockRestore()
  })

  it('moves to All only when editing the last row out of a concrete year', () => {
    const lifecycleTransactions = transactions.filter((transaction) => transaction.id === 'alpha-2024' || transaction.id === 'zulu-2025')
    renderSpendHarness(spendState(lifecycleTransactions))
    fireEvent.click(screen.getByText('2025-03-01'))
    const dateInput = screen.getByLabelText('Edit record date')
    fireEvent.change(dateInput, { target: { value: '2024-06-01' } })
    fireEvent.blur(dateInput)
    expect((screen.getByLabelText('Select year') as HTMLSelectElement).value).toBe('__spend_all_years__')
    cleanup()

    renderSpendHarness(spendState([...lifecycleTransactions, { id: 'second-2025', date: '2025-06-01', description: 'Second 2025', categoryId: 'food', amount: 5 }]))
    fireEvent.click(screen.getByText('2025-03-01'))
    const secondDateInput = screen.getByLabelText('Edit record date')
    fireEvent.change(secondDateInput, { target: { value: '2024-06-01' } })
    fireEvent.blur(secondDateInput)
    expect((screen.getByLabelText('Select year') as HTMLSelectElement).value).toBe('2025')
  })

  it('leaves scope and snapshot actions unchanged for invalid add and import attempts', () => {
    const actions = renderSpendHarness()
    fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '__spend_all_years__' } })
    fireEvent.click(screen.getByText('Add Record'))
    fireEvent.click(screen.getByText('Import transactions…'))
    fireEvent.click(screen.getByText('Upload file'))
    fireEvent.click(screen.getByText('Import'))

    expect((screen.getByLabelText('Select year') as HTMLSelectElement).value).toBe('__spend_all_years__')
    expect(actions).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ENSURE_BUDGET_YEAR_SNAPSHOT' }))
  })

})

describe('BudgetPage budget account imports and signed amounts', () => {
  const categories = [{ id: 'other', name: 'Other', updatedAt: '' }]
  const positiveRule = {
    normalizedName: 'primary checking',
    displayName: 'Primary Checking',
    statementConvention: 'positiveSpend' as const,
    updatedAt: '',
  }

  const renderBudget = (state = initialState(), dispatch = vi.fn(), rules = [positiveRule]) => {
    render(
      <BudgetPage
        state={state}
        dispatch={dispatch}
        categories={categories}
        categoryDispatch={vi.fn()}
        categoriesHydrated
        budgetAccountRules={rules}
        {...periodProps}
      />
    )
    return dispatch
  }

  const openImport = () => {
    fireEvent.click(screen.getByText('Import transactions…'))
    return screen.getByLabelText('Import account') as HTMLSelectElement
  }

  it('requires an observed account or a nonblank new account', () => {
    renderBudget()
    const account = openImport()
    const importButton = screen.getByText('Import') as HTMLButtonElement

    expect(Array.from(account.options, (option) => option.text)).toEqual([
      'Select an account',
      'Primary Checking',
      'New account',
    ])
    expect(importButton.disabled).toBe(true)

    fireEvent.change(account, { target: { value: '__new__' } })
    expect(importButton.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('New import account name'), { target: { value: '  Cash  ' } })
    expect(importButton.disabled).toBe(false)
  })

  it('converts positive CSV rows before deduplication and reports every import outcome', () => {
    const state = {
      ...initialState(),
      budgetTransactions: [{ id: 'existing', date: '2026-02-01', description: 'Store', categoryId: 'other', amount: -10, accountName: 'Primary Checking' }],
    }
    const dispatch = renderBudget(state)
    const account = openImport()
    fireEvent.change(account, { target: { value: 'Primary Checking' } })
    fireEvent.change(screen.getByLabelText('Paste CSV text'), {
      target: { value: 'Date,Description,Amount\n2026-02-01,Store,10' },
    })
    fireEvent.click(screen.getByText('Import'))

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'IMPORT_BUDGET_TRANSACTIONS',
      rows: [expect.objectContaining({ amount: -10, accountName: 'Primary Checking' })],
      appliedConvention: { accountName: 'Primary Checking', statementConvention: 'positiveSpend' },
    }))
    expect(screen.getByText('1 row(s) detected')).toBeTruthy()
    expect(screen.getAllByText('1 row(s) converted')).toHaveLength(2)
    expect(screen.getByText('0 imported')).toBeTruthy()
    expect(screen.getByText('1 skipped (already imported)')).toBeTruthy()
  })

  it('keeps the default negative-spend convention unchanged', () => {
    const dispatch = renderBudget(initialState(), vi.fn(), [])
    const account = openImport()
    fireEvent.change(account, { target: { value: '__new__' } })
    fireEvent.change(screen.getByLabelText('New import account name'), { target: { value: 'Cash' } })
    fireEvent.change(screen.getByLabelText('Paste CSV text'), {
      target: { value: 'Date,Description,Amount\n2026-02-01,Store,10' },
    })
    fireEvent.click(screen.getByText('Import'))

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      rows: [expect.objectContaining({ amount: 10, accountName: 'Cash' })],
      appliedConvention: { accountName: 'Cash', statementConvention: 'negativeSpend' },
    }))
  })

  it('converts positive OFX rows before dispatching them', () => {
    class MockFileReader {
      result = '<STMTTRN><DTPOSTED>20260201<NAME>Store<TRNAMT>10</STMTTRN>'
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null

      readAsText() {
        this.onload?.(new ProgressEvent('load'))
      }
    }
    vi.stubGlobal('FileReader', MockFileReader)
    const dispatch = renderBudget()
    const account = openImport()
    fireEvent.change(account, { target: { value: 'Primary Checking' } })
    fireEvent.click(screen.getByText('Upload file'))
    fireEvent.change(screen.getByLabelText('CSV, OFX, or QFX file'), {
      target: { files: [new File(['ignored'], 'statement.ofx')] },
    })
    fireEvent.click(screen.getByText('Import'))

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      rows: [expect.objectContaining({ amount: -10, accountName: 'Primary Checking' })],
    }))
    vi.unstubAllGlobals()
  })

  it('does not dispatch an import marker when CSV parsing produces no valid rows', () => {
    const dispatch = renderBudget()
    const account = openImport()
    fireEvent.change(account, { target: { value: 'Primary Checking' } })
    fireEvent.change(screen.getByLabelText('Paste CSV text'), { target: { value: 'bad,row' } })
    fireEvent.click(screen.getByText('Import'))

    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'IMPORT_BUDGET_TRANSACTIONS' }))
    expect(screen.getByText(/No transactions found in CSV/)).toBeTruthy()
  })

  it('persists signed manual amounts and rejects zero or nonnumeric values', () => {
    const actions = vi.fn()
    const state = initialState()
    const Harness = () => {
      const [appState, dispatch] = useReducer(appReducer, state)
      return <BudgetPage state={appState} dispatch={(action) => { actions(action); dispatch(action) }} categories={categories} categoryDispatch={vi.fn()} categoriesHydrated budgetAccountRules={[positiveRule]} {...periodProps} />
    }
    render(<Harness />)

    fireEvent.change(screen.getByLabelText('Record date'), { target: { value: '2026-02-01' } })
    fireEvent.change(screen.getByLabelText('Record amount'), { target: { value: '-12.50' } })
    fireEvent.click(screen.getByText('Add Record'))
    expect(actions).toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_BUDGET_TRANSACTION', tx: expect.objectContaining({ amount: -12.5 }) }))
    expect(screen.getByTestId('records-total-row').textContent).toContain('-$12.50')

    fireEvent.change(screen.getByLabelText('Record date'), { target: { value: '2026-02-02' } })
    fireEvent.change(screen.getByLabelText('Record amount'), { target: { value: '0' } })
    fireEvent.click(screen.getByText('Add Record'))
    expect(screen.getByText('Amount must be a nonzero number.')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Record amount'), { target: { value: 'not-a-number' } })
    fireEvent.click(screen.getByText('Add Record'))
    expect(screen.getByText('Amount must be a nonzero number.')).toBeTruthy()
  })
})

describe('BudgetPage period control', () => {
  it('does not render the App-owned period control', () => {
    render(
      <BudgetPage
        state={initialState()}
        dispatch={vi.fn()}
        categories={[]}
        categoryDispatch={vi.fn()}
        categoriesHydrated
        {...periodProps}
      />,
    )

    expect(document.querySelector('input[name="budgetPeriod"]')).toBeNull()
    expect(screen.queryByText('Accounts')).toBeNull()
  })
})

describe('BudgetPage spend record description edits', () => {
  const year = new Date().getFullYear()
  const categories = [{ id: 'food', name: 'Food', updatedAt: '' }]
  const state = {
    ...initialState(),
    budgetExpenseDefinitions: [{ id: 'groceries', name: 'Groceries', categoryId: 'food', frequency: 'monthly' as const }],
    budgetTransactions: [{ id: 'market-row', date: `${year}-01-01`, description: 'Market run', categoryId: 'food', amount: 42, spendExpenseId: 'groceries' }],
  }

  const renderDescriptionRow = () => {
    const dispatch = vi.fn()
    render(<BudgetPage state={state} dispatch={dispatch} categories={categories} categoryDispatch={vi.fn()} categoriesHydrated {...periodProps} />)
    return dispatch
  }

  it('commits a Description inline edit on Enter with one update action', () => {
    const dispatch = renderDescriptionRow()

    fireEvent.click(within(recordsTable()).getByText('Market run'))
    const input = screen.getByDisplayValue('Market run')
    fireEvent.change(input, { target: { value: 'Fresh market run' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(dispatch).toHaveBeenCalledWith({ type: 'UPDATE_BUDGET_TRANSACTION', id: 'market-row', patch: { description: 'Fresh market run' } })
    expect(screen.queryByDisplayValue('Fresh market run')).toBeNull()
  })

  it('cancels a Description inline edit on Escape without dispatching', () => {
    const dispatch = renderDescriptionRow()

    fireEvent.click(within(recordsTable()).getByText('Market run'))
    const input = screen.getByDisplayValue('Market run')
    fireEvent.change(input, { target: { value: 'Discarded market run' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UPDATE_BUDGET_TRANSACTION' }))
    expect(screen.queryByDisplayValue('Discarded market run')).toBeNull()
    expect(within(recordsTable()).getByText('Market run')).toBeTruthy()
  })
})

describe('BudgetPage spend record tag filter', () => {
  const tagCategories = [{ id: 'food', name: 'Food', updatedAt: '' }]

  type TagRow = {
    id: string
    date: string
    description: string
    categoryId: string
    amount: number
    tags?: string[]
  }

  const renderTagSpend = (budgetTransactions: TagRow[], categories = tagCategories) => {
    const dispatch = vi.fn()
    render(
      <BudgetPage
        state={{ ...initialState(), budgetTransactions }}
        dispatch={dispatch}
        categories={categories}
        categoryDispatch={vi.fn()}
        categoriesHydrated
        {...periodProps}
      />
    )
    return dispatch
  }

  it('finds spend records with matching tags via the search box', () => {
    renderTagSpend([
      { id: 'a', date: '2025-01-01', description: 'Office supplies', categoryId: 'food', amount: 10, tags: ['Work'] },
      { id: 'b', date: '2025-01-02', description: 'Team lunch', categoryId: 'food', amount: 12, tags: ['personal'] },
    ])

    fireEvent.change(screen.getByLabelText('Search records'), { target: { value: 'work' } })
    expect(within(recordsTable()).getByText('Office supplies')).toBeTruthy()
    expect(within(recordsTable()).queryByText('Team lunch')).toBeNull()

    fireEvent.change(screen.getByLabelText('Search records'), { target: { value: 'WORK' } })
    expect(within(recordsTable()).getByText('Office supplies')).toBeTruthy()
    expect(within(recordsTable()).queryByText('Team lunch')).toBeNull()

    fireEvent.change(screen.getByLabelText('Search records'), { target: { value: 'WoRk' } })
    expect(within(recordsTable()).getByText('Office supplies')).toBeTruthy()
    expect(within(recordsTable()).queryByText('Team lunch')).toBeNull()

    fireEvent.change(screen.getByLabelText('Search records'), { target: { value: 'zzz-no-such-tag' } })
    expect(screen.queryByTestId('records-table')).toBeNull()
    expect(screen.getByText('No records for this period.')).toBeTruthy()
  })
})

describe('BudgetPage Add Record tags', () => {
  const addCategories = [{ id: 'food', name: 'Food', updatedAt: '' }]

  const renderAddForm = () => {
    const dispatch = vi.fn()
    render(
      <BudgetPage
        state={initialState()}
        dispatch={dispatch}
        categories={addCategories}
        categoryDispatch={vi.fn()}
        categoriesHydrated
        {...periodProps}
      />
    )
    return dispatch
  }

  const fillBaseRecord = () => {
    fireEvent.change(screen.getByLabelText('Record date'), { target: { value: '2025-01-01' } })
    fireEvent.change(screen.getByLabelText('Record description'), { target: { value: 'Tag test record' } })
    fireEvent.change(screen.getByLabelText('Record amount'), { target: { value: '20' } })
  }

  const addTagViaForm = (tag: string) => {
    const input = screen.getByLabelText('Record tags') as HTMLInputElement
    fireEvent.change(input, { target: { value: tag } })
    fireEvent.keyDown(input, { key: 'Enter' })
  }

  const findAddAction = (dispatch: ReturnType<typeof vi.fn>) =>
    dispatch.mock.calls.map((call) => call[0]).find((action) => action?.type === 'ADD_BUDGET_TRANSACTION')

  it('includes entered tags in the dispatched Add Record payload', () => {
    const dispatch = renderAddForm()
    fillBaseRecord()
    addTagViaForm('food')
    addTagViaForm('weekly')

    fireEvent.click(screen.getByText('Add Record'))

    const addAction = findAddAction(dispatch)
    expect(addAction).toBeTruthy()
    expect(addAction.tx.tags).toEqual(['food', 'weekly'])
  })

  it('omits tags (undefined, not []) when no tags are entered', () => {
    const dispatch = renderAddForm()
    fillBaseRecord()

    fireEvent.click(screen.getByText('Add Record'))

    const addAction = findAddAction(dispatch)
    expect(addAction).toBeTruthy()
    expect(addAction.tx.tags).toBeUndefined()
  })

  it('clears the TagInput after a successful submit', () => {
    renderAddForm()
    fillBaseRecord()
    addTagViaForm('food')
    addTagViaForm('weekly')
    expect(screen.getByText('food')).toBeTruthy()
    expect(screen.getByText('weekly')).toBeTruthy()

    fireEvent.click(screen.getByText('Add Record'))

    expect(screen.queryByText('food')).toBeNull()
    expect(screen.queryByText('weekly')).toBeNull()
    expect((screen.getByLabelText('Record tags') as HTMLInputElement).value).toBe('')
  })
})

describe('BudgetPage bulk-edit tags', () => {
  const bulkCategories = [{ id: 'food', name: 'Food', updatedAt: '' }]
  const bulkDefinitions = [{ id: 'groceries', name: 'Groceries', categoryId: 'food', frequency: 'monthly' as const }]
  const bulkTransactions = [
    { id: 'a', date: '2025-01-01', description: 'Bulk row one', categoryId: 'food', amount: 10 },
    { id: 'b', date: '2025-01-02', description: 'Bulk row two', categoryId: 'food', amount: 12 },
  ]

  const renderBulkForm = () => {
    const dispatch = vi.fn()
    render(
      <BudgetPage
        state={{ ...initialState(), budgetExpenseDefinitions: bulkDefinitions, budgetTransactions: bulkTransactions }}
        dispatch={dispatch}
        categories={bulkCategories}
        categoryDispatch={vi.fn()}
        categoriesHydrated
        {...periodProps}
      />
    )
    return dispatch
  }

  const selectBothRows = () => {
    fireEvent.click(screen.getByTestId('row-select-a'))
    fireEvent.click(screen.getByTestId('row-select-b'), { shiftKey: true })
    expect(screen.getByTestId('bulk-action-bar')).toBeTruthy()
  }

  const addBulkTag = (tag: string) => {
    const input = screen.getByLabelText('Bulk edit tags') as HTMLInputElement
    fireEvent.change(input, { target: { value: tag } })
    fireEvent.keyDown(input, { key: 'Enter' })
  }

  const pickBulkCategory = () => {
    fireEvent.change(screen.getByLabelText('Bulk edit spend category'), { target: { value: 'groceries' } })
  }

  const findBulkAction = (dispatch: ReturnType<typeof vi.fn>) =>
    dispatch.mock.calls.map((call) => call[0]).find((action) => action?.type === 'UPDATE_BUDGET_TRANSACTIONS_BULK')

  it('includes the bulk tag alongside categoryId/spendExpenseId on Apply', () => {
    const dispatch = renderBulkForm()
    selectBothRows()
    addBulkTag('urgent')
    pickBulkCategory()

    fireEvent.click(screen.getByText('Apply'))

    const bulkAction = findBulkAction(dispatch)
    expect(bulkAction).toBeTruthy()
    expect(bulkAction.ids).toEqual(expect.arrayContaining(['a', 'b']))
    expect(bulkAction.ids).toHaveLength(2)
    expect(bulkAction.categoryId).toBe('food')
    expect(bulkAction.spendExpenseId).toBe('groceries')
    expect(bulkAction.tagsToAdd).toEqual(['urgent'])
  })

  it('omits tagsToAdd (undefined) when Apply runs with no bulk tags entered', () => {
    const dispatch = renderBulkForm()
    selectBothRows()
    pickBulkCategory()

    fireEvent.click(screen.getByText('Apply'))

    const bulkAction = findBulkAction(dispatch)
    expect(bulkAction).toBeTruthy()
    expect(bulkAction.categoryId).toBe('food')
    expect(bulkAction.spendExpenseId).toBe('groceries')
    expect(bulkAction.tagsToAdd).toBeUndefined()
  })

  it('clears the bulk TagInput after Apply', () => {
    renderBulkForm()
    selectBothRows()
    addBulkTag('urgent')
    expect(screen.getByText('urgent')).toBeTruthy()
    pickBulkCategory()

    fireEvent.click(screen.getByText('Apply'))

    expect(screen.queryByTestId('bulk-action-bar')).toBeNull()
    fireEvent.click(screen.getByTestId('row-select-a'))
    expect(screen.getByTestId('bulk-action-bar')).toBeTruthy()
    expect(screen.queryByText('urgent')).toBeNull()
    expect((screen.getByLabelText('Bulk edit tags') as HTMLInputElement).value).toBe('')
  })
})

describe('BudgetPage Tags column per-cell editor', () => {
  const tagCellCategories = [{ id: 'food', name: 'Food', updatedAt: '' }]

  type TagCellRow = {
    id: string
    date: string
    description: string
    categoryId: string
    amount: number
    tags?: string[]
  }

  const renderTagCells = (budgetTransactions: TagCellRow[]) => {
    const dispatch = vi.fn()
    render(
      <BudgetPage
        state={{ ...initialState(), budgetTransactions }}
        dispatch={dispatch}
        categories={tagCellCategories}
        categoryDispatch={vi.fn()}
        categoriesHydrated
        {...periodProps}
      />
    )
    return dispatch
  }

  const findUpdateAction = (dispatch: ReturnType<typeof vi.fn>) =>
    dispatch.mock.calls.map((call) => call[0]).find((action) => action?.type === 'UPDATE_BUDGET_TRANSACTION')

  const clickTagsCell = (description: string) => {
    const cell = within(recordsTable()).getByText(description).closest('tr')!.querySelectorAll('td')[5]!
    fireEvent.click(cell)
    return cell
  }

  it('renders a Tags header with no sort handler and opens TagInput pre-populated on cell click', () => {
    renderTagCells([
      { id: 'a', date: '2025-01-01', description: 'Tagged row', categoryId: 'food', amount: 10, tags: ['food', 'weekly'] },
    ])

    const header = screen.getAllByText('Tags').map((el) => el.closest('th')).find(Boolean)!
    expect(header).toBeTruthy()
    expect(header.hasAttribute('aria-label')).toBe(false)
    expect(header.querySelector('svg')).toBeNull()

    clickTagsCell('Tagged row')

    const input = screen.getByLabelText('Edit record tags') as HTMLInputElement
    expect(input).toBeTruthy()
    const tagsCell = within(recordsTable()).getByText('Tagged row').closest('tr')!.querySelectorAll('td')[5]!
    expect(tagsCell.textContent).toContain('food')
    expect(tagsCell.textContent).toContain('weekly')
  })

  it('dispatches the full merged tags array on add + blur', () => {
    const dispatch = renderTagCells([
      { id: 'a', date: '2025-01-01', description: 'Tagged row', categoryId: 'food', amount: 10, tags: ['food'] },
    ])

    clickTagsCell('Tagged row')
    const input = screen.getByLabelText('Edit record tags') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'weekly' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('weekly')).toBeTruthy()
    fireEvent.blur(input)

    const updateAction = findUpdateAction(dispatch)
    expect(updateAction).toBeTruthy()
    expect(updateAction.id).toBe('a')
    expect(updateAction.patch).toEqual({ tags: ['food', 'weekly'] })
  })

  it('dispatches tags: undefined (not []) when the last tag is removed + blur', () => {
    const dispatch = renderTagCells([
      { id: 'a', date: '2025-01-01', description: 'Solo tag row', categoryId: 'food', amount: 10, tags: ['solo'] },
    ])

    clickTagsCell('Solo tag row')
    fireEvent.click(screen.getByLabelText('Remove solo'))
    fireEvent.blur(screen.getByLabelText('Edit record tags'))

    const updateAction = findUpdateAction(dispatch)
    expect(updateAction).toBeTruthy()
    expect(updateAction.id).toBe('a')
    expect(updateAction.patch).toEqual({ tags: undefined })
    expect('tags' in updateAction.patch).toBe(true)
    expect(updateAction.patch.tags).not.toEqual([])
  })

  it('persists an × removal when navigating to another row without blur', () => {
    const dispatch = renderTagCells([
      { id: 'a', date: '2025-01-01', description: 'First row', categoryId: 'food', amount: 10, tags: ['food', 'weekly'] },
      { id: 'b', date: '2025-01-02', description: 'Second row', categoryId: 'food', amount: 12, tags: ['other'] },
    ])

    clickTagsCell('First row')
    fireEvent.click(screen.getByLabelText('Remove weekly'))
    // No blur: × unmounts the focused button, so the cell's blur-commit
    // path never fires. Navigating straight to another row must not drop
    // the removal.
    clickTagsCell('Second row')

    const updateAction = findUpdateAction(dispatch)
    expect(updateAction).toBeTruthy()
    expect(updateAction.id).toBe('a')
    expect(updateAction.patch).toEqual({ tags: ['food'] })
  })

  it('reverts without dispatching on Escape after typing', () => {
    const dispatch = renderTagCells([
      { id: 'a', date: '2025-01-01', description: 'Escape row', categoryId: 'food', amount: 10, tags: ['food'] },
    ])

    clickTagsCell('Escape row')
    const input = screen.getByLabelText('Edit record tags') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'scratch' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UPDATE_BUDGET_TRANSACTION' }))
    expect(screen.queryByLabelText('Edit record tags')).toBeNull()
    const tagsCell = within(recordsTable()).getByText('Escape row').closest('tr')!.querySelectorAll('td')[5]!
    expect(tagsCell.textContent).toContain('food')
    expect(tagsCell.textContent).not.toContain('scratch')
  })

  it('renders an empty state (not "undefined" text) for rows with no tags', () => {
    renderTagCells([
      { id: 'a', date: '2025-01-01', description: 'Untagged row', categoryId: 'food', amount: 10 },
    ])

    const cell = within(recordsTable()).getByText('Untagged row').closest('tr')!.querySelectorAll('td')[5]!
    expect(cell.textContent).not.toContain('undefined')
    expect(cell.textContent?.trim()).not.toBe('')
  })
})

describe('BudgetPage auto-tag records', () => {
  const autoTagCategories = [{ id: 'food', name: 'Food', updatedAt: '' }]

  const clusteringTransactions = [
    { id: 'a', date: '2025-01-01', description: 'TRADER JOES #123', categoryId: 'food', amount: 10 },
    { id: 'b', date: '2025-01-02', description: 'TRADER JOES #456', categoryId: 'food', amount: 12 },
  ]

  const renderAutoTag = (transactions: typeof clusteringTransactions) => {
    const actions: unknown[] = []
    const Harness = () => {
      const [appState, dispatch] = useReducer(appReducer, {
        ...initialState(),
        budgetTransactions: transactions,
      })
      return (
        <BudgetPage
          state={appState}
          dispatch={(action) => {
            actions.push(action)
            dispatch(action)
          }}
          categories={autoTagCategories}
            categoryDispatch={vi.fn()}
          categoriesHydrated
          {...periodProps}
        />
      )
    }
    render(<Harness />)
    return actions
  }

  it('tags clustered records, dispatches the auto-tag action, and shows the tagged count', () => {
    const actions = renderAutoTag(clusteringTransactions)

    fireEvent.click(screen.getByRole('button', { name: 'Auto-tag records' }))

    expect(actions).toContainEqual({ type: 'AUTO_TAG_BUDGET_TRANSACTIONS' })
    expect(screen.getByText('Tagged 2 record(s)')).toBeTruthy()
    expect(screen.getAllByText('TRADERJOES')).toHaveLength(2)
  })

  it('shows "No new tags found" when nothing clusters', () => {
    const actions = renderAutoTag([
      { id: 'solo', date: '2025-01-01', description: 'Unique coffee shop', categoryId: 'food', amount: 10 },
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Auto-tag records' }))

    expect(actions).toContainEqual({ type: 'AUTO_TAG_BUDGET_TRANSACTIONS' })
    expect(screen.getByText('No new tags found')).toBeTruthy()
  })

  it('clears the feedback after 4 seconds', () => {
    vi.useFakeTimers()
    try {
      renderAutoTag(clusteringTransactions)

      fireEvent.click(screen.getByRole('button', { name: 'Auto-tag records' }))
      expect(screen.getByText('Tagged 2 record(s)')).toBeTruthy()

      vi.advanceTimersByTime(3999)
      expect(screen.getByText('Tagged 2 record(s)')).toBeTruthy()
      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(screen.queryByText('Tagged 2 record(s)')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders the button in the left-hand group alongside the Spend records title', () => {
    const { container } = render(
      <BudgetPage
        state={{ ...initialState(), budgetTransactions: clusteringTransactions }}
        dispatch={vi.fn()}
        categories={autoTagCategories}
        categoryDispatch={vi.fn()}
        categoriesHydrated
        {...periodProps}
      />
    )

    const button = screen.getByRole('button', { name: 'Auto-tag records' })
    const title = Array.from(container.querySelectorAll('.card-title')).find((el) =>
      el.textContent?.includes('Spend records')
    )
    expect(title?.textContent).toContain('Spend records')
    expect(button.parentElement).toBe(title?.parentElement)
  })
})

describe('BudgetPage clear all tags', () => {
  const clearTagCategories = [{ id: 'food', name: 'Food', updatedAt: '' }]

  const taggedTransactions = [
    { id: 'a', date: '2025-01-01', description: 'Tagged market', categoryId: 'food', amount: 10, tags: ['grocery'] },
    { id: 'b', date: '2025-01-02', description: 'Tagged diner', categoryId: 'food', amount: 12, tags: ['dining'] },
  ]

  type ClearTagsRow = {
    id: string
    date: string
    description: string
    categoryId: string
    amount: number
    tags?: string[]
    autoTags?: string[]
  }

  const renderClearTags = (transactions: ClearTagsRow[]) => {
    const actions: unknown[] = []
    const Harness = () => {
      const [appState, dispatch] = useReducer(appReducer, {
        ...initialState(),
        budgetTransactions: transactions,
      })
      return (
        <BudgetPage
          state={appState}
          dispatch={(action) => {
            actions.push(action)
            dispatch(action)
          }}
          categories={clearTagCategories}
            categoryDispatch={vi.fn()}
          categoriesHydrated
          {...periodProps}
        />
      )
    }
    render(<Harness />)
    return actions
  }

  const openChooser = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Clear all tags' }))
    return screen.getByRole('dialog', { name: 'Clear tags' })
  }

  it('user scope (default) dispatches only CLEAR_BUDGET_TRANSACTION_TAGS with the user count', () => {
    const actions = renderClearTags(taggedTransactions)

    const dialog = openChooser()
    // Default scope is User tags, with the per-scope count in the label.
    expect(screen.getByRole('radio', { name: 'User tags (2)' })).toBeTruthy()
    expect((screen.getByRole('radio', { name: 'User tags (2)' }) as HTMLInputElement).checked).toBe(true)
    expect(dialog.textContent).toContain('Remove user tags from 2 record(s)? This cannot be undone.')

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(actions).toContainEqual({ type: 'CLEAR_BUDGET_TRANSACTION_TAGS' })
    expect(actions).not.toContainEqual({ type: 'CLEAR_BUDGET_TRANSACTION_AUTO_TAGS' })
    expect(screen.getByText('Cleared user tags from 2 record(s)')).toBeTruthy()
    expect(screen.queryByText('grocery')).toBeNull()
    expect(screen.queryByText('dining')).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Clear tags' })).toBeNull()
  })

  it('auto scope dispatches only CLEAR_BUDGET_TRANSACTION_AUTO_TAGS and preserves user tags', () => {
    const actions = renderClearTags([
      { id: 'a', date: '2025-01-01', description: 'Mixed market', categoryId: 'food', amount: 10, tags: ['grocery'], autoTags: ['COSTCOWHOL'] },
      { id: 'b', date: '2025-01-02', description: 'Mixed diner', categoryId: 'food', amount: 12, tags: ['dining'], autoTags: ['TRADERJOES'] },
    ])

    openChooser()
    fireEvent.click(screen.getByRole('radio', { name: 'Auto-tags (2)' }))
    expect(screen.getByRole('dialog', { name: 'Clear tags' }).textContent).toContain(
      'Remove auto-tags from 2 record(s)? This cannot be undone.'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(actions).not.toContainEqual({ type: 'CLEAR_BUDGET_TRANSACTION_TAGS' })
    expect(actions).toContainEqual({ type: 'CLEAR_BUDGET_TRANSACTION_AUTO_TAGS' })
    expect(screen.getByText('Cleared auto-tags from 2 record(s)')).toBeTruthy()
    expect(screen.queryByText('COSTCOWHOL')).toBeNull()
    expect(screen.getByText('grocery')).toBeTruthy()
    expect(screen.getByText('dining')).toBeTruthy()
  })

  it('both scope dispatches both actions sequentially with the union count', () => {
    const actions = renderClearTags([
      { id: 'a', date: '2025-01-01', description: 'Mixed market', categoryId: 'food', amount: 10, tags: ['grocery'], autoTags: ['COSTCOWHOL'] },
      { id: 'b', date: '2025-01-02', description: 'User-only diner', categoryId: 'food', amount: 12, tags: ['dining'] },
      { id: 'c', date: '2025-01-03', description: 'Auto-only cafe', categoryId: 'food', amount: 8, autoTags: ['PEETSC0FFEE'] },
    ])

    openChooser()
    expect(screen.getByRole('radio', { name: 'User tags (2)' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Auto-tags (2)' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Both (3)' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Both (3)' }))
    expect(screen.getByRole('dialog', { name: 'Clear tags' }).textContent).toContain(
      'Remove all tags from 3 record(s)? This cannot be undone.'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(actions).toEqual([
      { type: 'CLEAR_BUDGET_TRANSACTION_TAGS' },
      { type: 'CLEAR_BUDGET_TRANSACTION_AUTO_TAGS' },
    ])
    expect(screen.getByText('Cleared all tags from 3 record(s)')).toBeTruthy()
    expect(screen.queryByText('grocery')).toBeNull()
    expect(screen.queryByText('COSTCOWHOL')).toBeNull()
  })

  it('cancel dispatches nothing and shows no feedback', () => {
    const actions = renderClearTags(taggedTransactions)

    openChooser()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(actions).toHaveLength(0)
    expect(screen.queryByRole('dialog', { name: 'Clear tags' })).toBeNull()
    expect(screen.getByText('grocery')).toBeTruthy()
    expect(screen.getByText('dining')).toBeTruthy()
    expect(screen.queryByText(/Cleared/)).toBeNull()
    expect(screen.queryByText(/No .*tags to clear/)).toBeNull()
  })

  it('zero-count auto scope confirms to feedback only without dispatching', () => {
    const actions = renderClearTags(taggedTransactions)

    openChooser()
    fireEvent.click(screen.getByRole('radio', { name: 'Auto-tags (0)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(actions).toHaveLength(0)
    expect(screen.getByText('No auto-tags to clear')).toBeTruthy()
    expect(screen.getByText('grocery')).toBeTruthy()
  })

  it('zero-count user scope confirms to feedback only without dispatching', () => {
    const actions = renderClearTags([
      { id: 'solo', date: '2025-01-01', description: 'Auto-only row', categoryId: 'food', amount: 10, autoTags: ['COSTCOWHOL'] },
    ])

    openChooser()
    // User scope is the default and has nothing to clear here.
    expect((screen.getByRole('radio', { name: 'User tags (0)' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(actions).toHaveLength(0)
    expect(screen.getByText('No user tags to clear')).toBeTruthy()
    expect(screen.getByText('COSTCOWHOL')).toBeTruthy()
  })

  it('shows "No tags to clear" without opening the chooser when nothing is tagged', () => {
    const actions = renderClearTags([
      { id: 'solo', date: '2025-01-01', description: 'Untagged row', categoryId: 'food', amount: 10 },
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Clear all tags' }))

    expect(screen.queryByRole('dialog', { name: 'Clear tags' })).toBeNull()
    expect(actions).not.toContainEqual({ type: 'CLEAR_BUDGET_TRANSACTION_TAGS' })
    expect(actions).not.toContainEqual({ type: 'CLEAR_BUDGET_TRANSACTION_AUTO_TAGS' })
    expect(screen.getByText('No tags to clear')).toBeTruthy()
  })

  it('clears user tags across years with one confirm while scoped to a concrete year', () => {
    const actions = renderClearTags([
      { id: 'old', date: '2024-06-01', description: 'Old tagged row', categoryId: 'food', amount: 10, tags: ['grocery'] },
      { id: 'new', date: '2025-06-01', description: 'New tagged row', categoryId: 'food', amount: 12, tags: ['dining'] },
    ])

    // Harness defaults to the newest concrete year, hiding the 2024 record.
    expect((screen.getByLabelText('Select year') as HTMLSelectElement).value).toBe('2025')
    expect(screen.queryByText('Old tagged row')).toBeNull()

    openChooser()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(actions).toContainEqual({ type: 'CLEAR_BUDGET_TRANSACTION_TAGS' })
    expect(screen.getByText('Cleared user tags from 2 record(s)')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '2024' } })
    expect(within(recordsTable()).getByText('Old tagged row')).toBeTruthy()
    expect(screen.queryByText('grocery')).toBeNull()
  })

  it('renders the button in the left-hand group alongside the title and auto-tag button', () => {
    const { container } = render(
      <BudgetPage
        state={{ ...initialState(), budgetTransactions: taggedTransactions }}
        dispatch={vi.fn()}
        categories={clearTagCategories}
        categoryDispatch={vi.fn()}
        categoriesHydrated
        {...periodProps}
      />
    )

    const clearButton = screen.getByRole('button', { name: 'Clear all tags' })
    const autoTagButton = screen.getByRole('button', { name: 'Auto-tag records' })
    const title = Array.from(container.querySelectorAll('.card-title')).find((el) =>
      el.textContent?.includes('Spend records')
    )
    expect(title?.textContent).toContain('Spend records')
    expect(clearButton.parentElement).toBe(title?.parentElement)
    expect(autoTagButton.parentElement).toBe(title?.parentElement)
  })
})

describe('BudgetPage auto vs user tags (T5)', () => {
  const provenanceCategories = [{ id: 'food', name: 'Food', updatedAt: '' }]

  type ProvenanceRow = {
    id: string
    date: string
    description: string
    categoryId: string
    amount: number
    tags?: string[]
    autoTags?: string[]
  }

  const renderProvenance = (budgetTransactions: ProvenanceRow[]) => {
    const dispatch = vi.fn()
    render(
      <BudgetPage
        state={{ ...initialState(), budgetTransactions }}
        dispatch={dispatch}
        categories={provenanceCategories}
        categoryDispatch={vi.fn()}
        categoriesHydrated
        {...periodProps}
      />
    )
    return dispatch
  }

  const tagsCell = (description: string) =>
    within(recordsTable()).getByText(description).closest('tr')!.querySelectorAll('td')[5]!

  const clickTagsCell = (description: string) => {
    fireEvent.click(tagsCell(description))
  }

  it('renders auto chips gray first then user chips red, with title="Auto-tag" on gray', () => {
    renderProvenance([
      { id: 'a', date: '2025-01-01', description: 'Mixed row', categoryId: 'food', amount: 10, tags: ['mine'], autoTags: ['COSTCOWHOL'] },
    ])

    const cell = tagsCell('Mixed row')
    const chips = Array.from(cell.querySelectorAll('span.tag'))
    expect(chips).toHaveLength(2)
    expect(chips[0].textContent).toBe('COSTCOWHOL')
    expect(chips[0].classList.contains('tag-neutral')).toBe(true)
    expect(chips[0].getAttribute('title')).toBe('Auto-tag')
    expect(chips[1].textContent).toBe('mine')
    expect(chips[1].classList.contains('tag-outline')).toBe(true)
  })

  it('suppresses an auto chip duplicating a user chip (case-insensitive)', () => {
    renderProvenance([
      { id: 'a', date: '2025-01-01', description: 'Dupe row', categoryId: 'food', amount: 10, tags: ['Grocery'], autoTags: ['grocery', 'COSTCOWHOL'] },
    ])

    const cell = tagsCell('Dupe row')
    const chips = Array.from(cell.querySelectorAll('span.tag'))
    expect(chips).toHaveLength(2)
    // Visible auto chip first, then the single user chip; the duped auto chip is hidden.
    expect(chips[0].textContent).toBe('COSTCOWHOL')
    expect(chips[0].classList.contains('tag-neutral')).toBe(true)
    expect(chips[1].textContent).toBe('Grocery')
    expect(chips[1].classList.contains('tag-outline')).toBe(true)
  })

  it('renders the toolbar legend line', () => {
    renderProvenance([
      { id: 'a', date: '2025-01-01', description: 'Any row', categoryId: 'food', amount: 10 },
    ])

    expect(screen.getByText('Gray = auto-tag, red = your tag')).toBeTruthy()
  })

  it('finds auto-only records via the search box', () => {
    renderProvenance([
      { id: 'a', date: '2025-01-01', description: 'Auto match', categoryId: 'food', amount: 10, autoTags: ['COSTCOWHOL'] },
      { id: 'b', date: '2025-01-02', description: 'No match here', categoryId: 'food', amount: 12, tags: ['personal'] },
    ])

    fireEvent.change(screen.getByLabelText('Search records'), { target: { value: 'costcowhol' } })
    expect(within(recordsTable()).getByText('Auto match')).toBeTruthy()
    expect(within(recordsTable()).queryByText('No match here')).toBeNull()
  })

  it('editor shows read-only gray chips with no × and refuses a user dupe of an auto tag', () => {
    const dispatch = renderProvenance([
      { id: 'a', date: '2025-01-01', description: 'Edit row', categoryId: 'food', amount: 10, tags: ['mine'], autoTags: ['COSTCOWHOL'] },
    ])

    clickTagsCell('Edit row')
    const cell = tagsCell('Edit row')
    const gray = cell.querySelector('span.tag.tag-neutral')
    expect(gray?.textContent).toBe('COSTCOWHOL')
    expect(gray?.getAttribute('title')).toBe('Auto-tag')
    expect(gray?.querySelector('button')).toBeNull()

    const input = screen.getByLabelText('Edit record tags') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'costcowhol' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    // Silent refusal: no new chip, draft cleared.
    expect(cell.querySelectorAll('span.tag.tag-outline')).toHaveLength(1)
    expect(input.value).toBe('')

    fireEvent.blur(input)
    const updateAction = dispatch.mock.calls.map((call) => call[0]).find((action) => action?.type === 'UPDATE_BUDGET_TRANSACTION')
    expect(updateAction).toBeTruthy()
    expect(updateAction.id).toBe('a')
    expect(updateAction.patch).toEqual({ tags: ['mine'] })
  })

  it('editor refuses a new user tag when the merged set is already at the 5-tag cap', () => {
    const dispatch = renderProvenance([
      { id: 'a', date: '2025-01-01', description: 'Full row', categoryId: 'food', amount: 10, tags: ['u1', 'u2', 'u3', 'u4'], autoTags: ['a1'] },
    ])

    clickTagsCell('Full row')
    const input = screen.getByLabelText('Edit record tags') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'newtag' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.queryByText('newtag')).toBeNull()

    fireEvent.blur(input)
    const updateAction = dispatch.mock.calls.map((call) => call[0]).find((action) => action?.type === 'UPDATE_BUDGET_TRANSACTION')
    expect(updateAction).toBeTruthy()
    expect(updateAction.patch).toEqual({ tags: ['u1', 'u2', 'u3', 'u4'] })
  })
})
