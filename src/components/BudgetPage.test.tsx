import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { BudgetPage } from './BudgetPage'
import { initialState, type AppState } from '../lib/state'
import type { Expense, BudgetTransaction, Category, CategoryMapping } from '../lib/types'
import { GAIN_COLOR, LOSS_COLOR, fmtUSD, toPeriod } from '../lib/computations'
import { appReducer } from '../lib/reducer'

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const CATEGORY_UPDATED_AT = '2025-01-01T00:00:00.000Z'

const CATEGORIES: Category[] = [
  { id: 'cat-housing', name: 'Housing', updatedAt: CATEGORY_UPDATED_AT },
  { id: 'cat-entertainment', name: 'Entertainment', updatedAt: CATEGORY_UPDATED_AT },
  { id: 'cat-food', name: 'Food', updatedAt: CATEGORY_UPDATED_AT },
  { id: 'cat-travel', name: 'Travel', updatedAt: CATEGORY_UPDATED_AT },
  { id: 'cat-other', name: 'Other', updatedAt: CATEGORY_UPDATED_AT },
  { id: 'cat-zoo', name: 'Zoo', updatedAt: CATEGORY_UPDATED_AT },
  { id: 'cat-alpha', name: 'Alpha Cat', updatedAt: CATEGORY_UPDATED_AT },
  { id: 'cat-mid', name: 'Mid Cat', updatedAt: CATEGORY_UPDATED_AT },
  { id: 'cat-auto', name: 'Auto', updatedAt: CATEGORY_UPDATED_AT },
]

function defaultState(overrides: Partial<AppState> = {}): AppState {
  return { ...initialState(), ...overrides }
}

/**
 * Renders BudgetPage with the standard category fixtures wired in as props
 * (categories/categoryMappings/categoryDispatch no longer live on AppState).
 * Callers can override any of the BudgetPage props, e.g. to supply a
 * dedicated `categoryDispatch` mock to assert against, or custom
 * `categoryMappings` for auto-categorization tests.
 */
function renderBudgetPage(overrides: {
  state?: AppState
  dispatch?: (action: any) => void
  categories?: Category[]
  categoryMappings?: CategoryMapping[]
  categoryDispatch?: (action: any) => void
} = {}) {
  return render(
    <BudgetPage
      state={overrides.state ?? defaultState()}
      dispatch={overrides.dispatch ?? vi.fn()}
      categories={overrides.categories ?? CATEGORIES}
      categoryMappings={overrides.categoryMappings ?? []}
      categoryDispatch={overrides.categoryDispatch ?? vi.fn()}
    />
  )
}

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: overrides.id ?? `exp-${Math.random()}`,
    name: overrides.name ?? 'Rent',
    categoryId: overrides.categoryId ?? 'cat-housing',
    amount: overrides.amount ?? 1000,
    frequency: overrides.frequency ?? 'monthly',
    ...overrides,
  }
}

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

describe('BudgetPage', () => {
  it('renders 4 summary cards with correct labels and values at default yearly period', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-03-15T00:00:00'))
    const state: AppState = defaultState({
      budgetIncomeMonthly: 5000,
      budgetIncomeYearly: 1200,
      budgetExpenses: [makeExpense({ amount: 1000, frequency: 'monthly' }), makeExpense({ amount: 2400, frequency: 'yearly' })],
      budgetTransactions: [
        makeTransaction({ date: '2025-03-05', categoryId: 'cat-housing', amount: 300 }),
        makeTransaction({ date: '2025-03-20', categoryId: 'cat-housing', amount: 150 }),
      ],
    })

    const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
    const summary = container.querySelector('[data-testid="summary-cards"]') as HTMLElement
    const cards = summary.querySelectorAll(':scope > div')
    expect(cards.length).toBe(4)

    expect(within(summary).getByText('Income')).toBeTruthy()
    // income: 5000*12 + 1200 = 61200
    expect(within(summary).getByText('$61,200.00')).toBeTruthy()

    expect(within(summary).getByText('Budgeted (Yearly)')).toBeTruthy()
    // expenses: 1000*12 + 2400 = 14400
    expect(within(summary).getByText('$14,400.00')).toBeTruthy()

    expect(within(summary).getByText('Actual spend (2025)')).toBeTruthy()
    // actual: 300 + 150 = 450 (both March 2025, within selected year 2025)
    expect(within(summary).getByText('$450.00')).toBeTruthy()

    expect(within(summary).getByText('Variance')).toBeTruthy()
    // variance: 14400 - 450 = 13950
    expect(within(summary).getByText('$13,950.00')).toBeTruthy()

    vi.useRealTimers()
  })

  it('toggling to Monthly recomputes summary values per monthly formulas', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-03-15T00:00:00'))
    const state: AppState = defaultState({
      budgetIncomeMonthly: 5000,
      budgetIncomeYearly: 1200,
      budgetExpenses: [makeExpense({ amount: 1000, frequency: 'monthly' }), makeExpense({ amount: 2400, frequency: 'yearly' })],
      budgetTransactions: [makeTransaction({ date: '2025-03-06', categoryId: 'cat-housing', amount: 500 })],
    })

    const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

    fireEvent.click(within(container.querySelector('.seg')!).getByText('Monthly'))
    const summary = container.querySelector('[data-testid="summary-cards"]') as HTMLElement

    // income: 5000 + 1200/12 = 5100
    expect(within(summary).getByText('$5,100.00')).toBeTruthy()
    // expenses: 1000 + 2400/12 = 1200
    expect(within(summary).getByText('$1,200.00')).toBeTruthy()
    // actual: 500 (transaction falls within March 2025, the current month)
    expect(within(summary).getByText('$500.00')).toBeTruthy()
    // variance: 1200 - 500 = 700
    expect(within(summary).getByText('$700.00')).toBeTruthy()

    vi.useRealTimers()
  })

  it('renders period toggle as .seg/.seg-opt radio markup with correct checked state', () => {
    const state: AppState = defaultState()
    const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

    const seg = container.querySelector('.seg')
    expect(seg).toBeTruthy()
    const radios = seg!.querySelectorAll('input[type="radio"]')
    expect(radios.length).toBe(2)
    expect((radios[0] as HTMLInputElement).checked).toBe(false)
    expect((radios[1] as HTMLInputElement).checked).toBe(true) // Yearly is default

    fireEvent.click(within(seg!).getByText('Monthly'))
    const radiosAfter = seg!.querySelectorAll('input[type="radio"]')
    expect((radiosAfter[0] as HTMLInputElement).checked).toBe(true)
    expect((radiosAfter[1] as HTMLInputElement).checked).toBe(false)
  })

  it('shows GAIN_COLOR for the Variance card when budgeted >= actual', () => {
    const state: AppState = defaultState({
      budgetExpenses: [makeExpense({ amount: 1000, frequency: 'monthly', categoryId: 'cat-housing' })],
      budgetTransactions: [],
    })
    const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
    const summary = container.querySelector('[data-testid="summary-cards"]') as HTMLElement
    const varianceLabel = within(summary).getByText('Variance')
    // default period is Yearly: variance = 1000*12 - 0 = 12000
    const varianceValue = varianceLabel.nextElementSibling as HTMLElement
    expect(varianceValue.textContent).toBe('$12,000.00')
    expect(varianceValue.style.color).toBe(hexToRgb(GAIN_COLOR))
  })

  it('shows LOSS_COLOR for the Variance card when budgeted < actual', () => {
    const now = new Date()
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const state: AppState = defaultState({
      budgetExpenses: [makeExpense({ amount: 100, frequency: 'monthly', categoryId: 'cat-housing' })],
      budgetTransactions: [makeTransaction({ date: `${currentMonth}-05`, categoryId: 'cat-housing', amount: 500 })],
    })
    const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
    fireEvent.click(within(container.querySelector('.seg')!).getByText('Monthly'))
    const summary = container.querySelector('[data-testid="summary-cards"]') as HTMLElement
    // variance: 100 - 500 = -400
    const varianceValue = within(summary).getByText('-$400.00')
    expect(varianceValue.style.color).toBe(hexToRgb(LOSS_COLOR))
  })

  it('filtering by category shows only matching rows', () => {
    const state: AppState = defaultState({
      budgetExpenses: [
        makeExpense({ id: 'e1', name: 'Rent', categoryId: 'cat-housing' }),
        makeExpense({ id: 'e2', name: 'Netflix', categoryId: 'cat-entertainment' }),
      ],
    })
    render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Filter by category'), { target: { value: 'cat-entertainment' } })

    expect(screen.queryByText('Rent')).toBeFalsy()
    expect(screen.getByText('Netflix')).toBeTruthy()
  })

  describe('sorting', () => {
    const fixture = [
      makeExpense({ id: 'a', name: 'Zeta', categoryId: 'cat-zoo', amount: 10, frequency: 'monthly' }),
      makeExpense({ id: 'b', name: 'Alpha', categoryId: 'cat-alpha', amount: 500, frequency: 'monthly' }),
      makeExpense({ id: 'c', name: 'Mid', categoryId: 'cat-mid', amount: 100, frequency: 'monthly' }),
    ]

    function getBodyRowNames(container: HTMLElement): string[] {
      return Array.from(container.querySelectorAll('tbody tr:not([data-testid="expenses-total-row"])')).map(
        (tr) => tr.querySelector('td')!.textContent
      ) as string[]
    }

    it('sorts by name via the Name column header', () => {
      const state: AppState = defaultState({ budgetExpenses: fixture })
      const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      fireEvent.click(screen.getByLabelText('Sort by name'))
      expect(getBodyRowNames(container)).toEqual(['Alpha', 'Mid', 'Zeta'])
    })

    it('sorts by amount (descending) via the Amount column header', () => {
      const state: AppState = defaultState({ budgetExpenses: fixture })
      const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      fireEvent.click(screen.getAllByLabelText(/Sort by amount/)[0])
      expect(getBodyRowNames(container)).toEqual(['Alpha', 'Mid', 'Zeta'])
    })

    it('sorts by category (default) via the Category column header, and toggles direction on repeat click', () => {
      const state: AppState = defaultState({ budgetExpenses: fixture })
      const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      expect(getBodyRowNames(container)).toEqual(['Alpha', 'Mid', 'Zeta'])
      fireEvent.click(screen.getAllByLabelText('Sort by category')[0])
      expect(getBodyRowNames(container)).toEqual(['Zeta', 'Mid', 'Alpha'])
    })
  })

  describe('inline edit', () => {
    it('clicking Edit shows editable inputs; changing a field dispatches UPDATE_BUDGET_EXPENSE; Done exits edit mode', () => {
      const state: AppState = defaultState({
        budgetExpenses: [makeExpense({ id: 'e1', name: 'Rent', categoryId: 'cat-housing', amount: 1000 })],
      })
      const dispatch = vi.fn()
      render(<BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

      fireEvent.click(screen.getByLabelText('Edit expense'))

      const nameInput = screen.getByLabelText('Edit expense name') as HTMLInputElement
      expect(nameInput.value).toBe('Rent')

      fireEvent.change(nameInput, { target: { value: 'Rent 2' } })
      expect(dispatch).toHaveBeenCalledWith({
        type: 'UPDATE_BUDGET_EXPENSE',
        id: 'e1',
        patch: { name: 'Rent 2' },
      })

      fireEvent.click(screen.getByText('Done'))
      expect(screen.queryByLabelText('Edit expense name')).toBeFalsy()
    })

    it('selecting "+ Add new category…" dispatches ADD_CATEGORY and the new category id is used on Done; no UPSERT_CATEGORY_MAPPING', () => {
      const state: AppState = defaultState({
        budgetExpenses: [makeExpense({ id: 'e1', name: 'Rent', categoryId: 'cat-housing', amount: 1000 })],
      })
      const dispatch = vi.fn()
      const categoryDispatch = vi.fn()
      vi.spyOn(window, 'prompt').mockReturnValue('Subscriptions')
      render(<BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={categoryDispatch} />)

      fireEvent.click(screen.getByLabelText('Edit expense'))

      const categorySelect = screen.getByLabelText('Edit expense category') as HTMLSelectElement
      fireEvent.change(categorySelect, { target: { value: '__add_new' } })

      expect(window.prompt).toHaveBeenCalled()
      const addCategoryCall = categoryDispatch.mock.calls.find((c) => c[0].type === 'ADD_CATEGORY')
      expect(addCategoryCall).toBeTruthy()
      expect(addCategoryCall![0].name).toBe('Subscriptions')
      const newId = addCategoryCall![0].id

      fireEvent.click(screen.getByText('Done'))

      expect(dispatch).toHaveBeenCalledWith({
        type: 'UPDATE_BUDGET_EXPENSE',
        id: 'e1',
        patch: { categoryId: newId },
      })
      expect(categoryDispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UPSERT_CATEGORY_MAPPING' }))
    })
  })

  describe('delete', () => {
    it('does not dispatch DELETE_BUDGET_EXPENSE when confirm is cancelled', () => {
      const state: AppState = defaultState({
        budgetExpenses: [makeExpense({ id: 'e1' })],
      })
      const dispatch = vi.fn()
      vi.spyOn(window, 'confirm').mockReturnValue(false)
      render(<BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

      fireEvent.click(screen.getByLabelText('Delete expense'))

      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DELETE_BUDGET_EXPENSE' }))
    })

    it('dispatches DELETE_BUDGET_EXPENSE with the row id when confirm is accepted', () => {
      const state: AppState = defaultState({
        budgetExpenses: [makeExpense({ id: 'e1' })],
      })
      const dispatch = vi.fn()
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      render(<BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

      fireEvent.click(screen.getByLabelText('Delete expense'))

      expect(dispatch).toHaveBeenCalledWith({ type: 'DELETE_BUDGET_EXPENSE', id: 'e1' })
    })
  })

  describe('add expense dialog', () => {
    it('is closed by default; clicking the Add Expense button opens it', () => {
      render(<BudgetPage state={defaultState()} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

      expect(screen.queryByText('Add expense')).toBeFalsy()

      fireEvent.click(screen.getByText('Add Expense'))

      expect(screen.getByText('Add expense')).toBeTruthy()
    })

    it('filling the form and clicking Add dispatches ADD_BUDGET_EXPENSE, closes the dialog, and clears the fields', () => {
      const dispatch = vi.fn()
      render(<BudgetPage state={defaultState()} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

      fireEvent.click(screen.getByText('Add Expense'))
      fireEvent.change(screen.getByLabelText('Expense name'), { target: { value: 'Gym' } })
      fireEvent.change(screen.getByLabelText('Expense amount'), { target: { value: '50' } })
      fireEvent.change(screen.getByLabelText('Expense frequency'), { target: { value: 'yearly' } })

      fireEvent.click(screen.getByText('Add'))

      expect(dispatch).toHaveBeenCalledWith({
        type: 'ADD_BUDGET_EXPENSE',
        expense: { name: 'Gym', categoryId: 'cat-housing', amount: 50, frequency: 'yearly' },
      })

      expect(screen.queryByText('Add expense')).toBeFalsy()

      fireEvent.click(screen.getByText('Add Expense'))
      expect((screen.getByLabelText('Expense name') as HTMLInputElement).value).toBe('')
      expect((screen.getByLabelText('Expense amount') as HTMLInputElement).value).toBe('')
    })

    it('clicking the backdrop closes the dialog without dispatching', () => {
      const dispatch = vi.fn()
      const { container } = render(<BudgetPage state={defaultState()} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

      fireEvent.click(screen.getByText('Add Expense'))
      fireEvent.change(screen.getByLabelText('Expense name'), { target: { value: 'Gym' } })
      fireEvent.change(screen.getByLabelText('Expense amount'), { target: { value: '50' } })

      fireEvent.click(container.querySelector('.dialog-backdrop')!)

      expect(screen.queryByText('Add expense')).toBeFalsy()
      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_BUDGET_EXPENSE' }))
    })

    it('clicking Cancel closes the dialog without dispatching', () => {
      const dispatch = vi.fn()
      render(<BudgetPage state={defaultState()} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

      fireEvent.click(screen.getByText('Add Expense'))
      fireEvent.change(screen.getByLabelText('Expense name'), { target: { value: 'Gym' } })

      fireEvent.click(screen.getByText('Cancel'))

      expect(screen.queryByText('Add expense')).toBeFalsy()
      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_BUDGET_EXPENSE' }))
    })

    it('does not dispatch and keeps the dialog open when the name is empty', () => {
      const dispatch = vi.fn()
      render(<BudgetPage state={defaultState()} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

      fireEvent.click(screen.getByText('Add Expense'))
      fireEvent.change(screen.getByLabelText('Expense amount'), { target: { value: '50' } })

      fireEvent.click(screen.getByText('Add'))

      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_BUDGET_EXPENSE' }))
      expect(screen.getByText('Add expense')).toBeTruthy()
    })

    it('does not dispatch and keeps the dialog open when the amount is <= 0', () => {
      const dispatch = vi.fn()
      render(<BudgetPage state={defaultState()} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

      fireEvent.click(screen.getByText('Add Expense'))
      fireEvent.change(screen.getByLabelText('Expense name'), { target: { value: 'Gym' } })
      fireEvent.change(screen.getByLabelText('Expense amount'), { target: { value: '0' } })

      fireEvent.click(screen.getByText('Add'))

      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_BUDGET_EXPENSE' }))
      expect(screen.getByText('Add expense')).toBeTruthy()
    })

    it('the "+ Add new category…" flow dispatches ADD_CATEGORY and the new id flows into ADD_BUDGET_EXPENSE; no UPSERT_CATEGORY_MAPPING', () => {
      const dispatch = vi.fn()
      const categoryDispatch = vi.fn()
      vi.spyOn(window, 'prompt').mockReturnValue('Subscriptions')
      render(<BudgetPage state={defaultState()} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={categoryDispatch} />)

      fireEvent.click(screen.getByText('Add Expense'))

      const categorySelect = screen.getByLabelText('Expense category') as HTMLSelectElement
      fireEvent.change(categorySelect, { target: { value: '__add_new' } })

      expect(window.prompt).toHaveBeenCalled()
      const addCategoryCall = categoryDispatch.mock.calls.find((c) => c[0].type === 'ADD_CATEGORY')
      expect(addCategoryCall).toBeTruthy()
      expect(addCategoryCall![0].name).toBe('Subscriptions')
      const newId = addCategoryCall![0].id

      fireEvent.change(screen.getByLabelText('Expense name'), { target: { value: 'Netflix' } })
      fireEvent.change(screen.getByLabelText('Expense amount'), { target: { value: '15' } })

      fireEvent.click(screen.getByText('Add'))

      expect(dispatch).toHaveBeenCalledWith({
        type: 'ADD_BUDGET_EXPENSE',
        expense: { name: 'Netflix', categoryId: newId, amount: 15, frequency: 'monthly' },
      })
      expect(categoryDispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UPSERT_CATEGORY_MAPPING' }))
    })
  })

  describe('actual spend (T13)', () => {
    it('Budgeted card shows the same number the old Expenses card showed (regression)', () => {
      const state: AppState = defaultState({
        budgetExpenses: [
          makeExpense({ amount: 1000, frequency: 'monthly', categoryId: 'cat-housing' }),
          makeExpense({ amount: 2400, frequency: 'yearly', categoryId: 'cat-travel' }),
        ],
        budgetTransactions: [],
      })
      const expectedBudgeted = state.budgetExpenses.reduce(
        (sum, e) => sum + toPeriod(e.amount, e.frequency, 'monthly'),
        0
      )

      const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      fireEvent.click(within(container.querySelector('.seg')!).getByText('Monthly'))
      const summary = container.querySelector('[data-testid="summary-cards"]') as HTMLElement
      const budgetedLabel = within(summary).getByText('Budgeted (Monthly)')
      const budgetedValue = budgetedLabel.nextElementSibling as HTMLElement

      expect(budgetedValue.textContent).toBe(fmtUSD(expectedBudgeted))
    })

    it('expense table renders Actual/Variance columns; rows sharing a category show identical values', () => {
      const now = new Date()
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      const state: AppState = defaultState({
        budgetExpenses: [
          makeExpense({ id: 'e1', name: 'Rent', categoryId: 'cat-housing', amount: 1000, frequency: 'monthly' }),
          makeExpense({ id: 'e2', name: 'Repairs', categoryId: 'cat-housing', amount: 200, frequency: 'monthly' }),
        ],
        budgetTransactions: [makeTransaction({ date: `${currentMonth}-10`, categoryId: 'cat-housing', amount: 300 })],
      })

      const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      fireEvent.click(within(container.querySelector('.seg')!).getByText('Monthly'))
      const headerCells = Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent)
      expect(headerCells).toContain('Actual')
      expect(headerCells).toContain('Variance')

      // Scope to the Expenses table specifically — the Spend records table
      // (rendered above it on the page) also renders a row for this same
      // transaction elsewhere in the page.
      const bodyRows = container
        .querySelectorAll('table')[1]
        .querySelectorAll('tbody tr:not([data-testid="expenses-total-row"])')
      expect(bodyRows.length).toBe(2)

      // Both rows share category "Housing" -> actual is the same aggregate for both.
      const actualCells = Array.from(bodyRows).map((tr) => tr.querySelectorAll('td')[4].textContent)
      const varianceCells = Array.from(bodyRows).map((tr) => tr.querySelectorAll('td')[5].textContent)

      expect(actualCells[0]).toBe('$300.00')
      expect(actualCells[1]).toBe('$300.00')
      expect(actualCells[0]).toBe(actualCells[1])

      // row1 variance: 1000 - 300 = 700; row2 variance: 200 - 300 = -100 (NOT identical to actual)
      expect(varianceCells[0]).toBe('$700.00')
      expect(varianceCells[1]).toBe('-$100.00')
    })

    it('clicking the Add button opens the Add-Expense dialog (regression after repositioning)', () => {
      render(<BudgetPage state={defaultState()} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

      expect(screen.queryByText('Add expense')).toBeFalsy()
      fireEvent.click(screen.getByText('Add Expense'))
      expect(screen.getByText('Add expense')).toBeTruthy()
    })

    it('.dialog-backdrop has a z-index so overlays (e.g. Add expense) render above page controls', () => {
      const css = readFileSync(`${process.cwd()}/src/styles/styles.css`, 'utf-8')
      const rule = css.match(/\.dialog-backdrop\s*\{[^}]*\}/)?.[0] ?? ''
      expect(rule).toMatch(/z-index:\s*\d+/)
    })

    it('default year picker value matches the real current year (Yearly is the default period)', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-07-22T00:00:00'))

      render(<BudgetPage state={defaultState()} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      const yearSelect = screen.getByLabelText('Select year') as HTMLSelectElement
      expect(yearSelect.value).toBe('2025')

      vi.useRealTimers()
    })
  })

  describe('empty state', () => {
    it('shows "No expenses to show." when budgetExpenses is empty', () => {
      const state: AppState = defaultState({ budgetExpenses: [] })
      render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      expect(screen.getByText('No expenses to show.')).toBeTruthy()
    })

    it('shows "No expenses to show." when a filter matches nothing, even with other expenses present', () => {
      const state: AppState = defaultState({
        budgetExpenses: [makeExpense({ id: 'e1', categoryId: 'cat-housing' })],
      })
      render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

      fireEvent.change(screen.getByLabelText('Filter by category'), { target: { value: 'cat-entertainment' } })

      expect(screen.getByText('No expenses to show.')).toBeTruthy()
    })
  })

  describe('income click-to-edit', () => {
    function incomeState(overrides: Partial<AppState> = {}): AppState {
      return defaultState({
        budgetIncomeMonthly: 5000,
        budgetIncomeYearly: 1200,
        budgetExpenses: [],
        ...overrides,
      })
    }

    it('default view shows fmtUSD(totalIncome) for the default Yearly period and no input', () => {
      render(<BudgetPage state={incomeState()} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      // income: 5000*12 + 1200 = 61200 (Yearly is the default period)
      expect(screen.getAllByText('$61,200.00').length).toBeGreaterThan(0)
      expect(screen.queryByLabelText('Income amount')).toBeFalsy()
    })

    it('clicking Edit income shows an autofocused input prefilled with the current-period (Yearly) amount', () => {
      render(<BudgetPage state={incomeState()} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      fireEvent.click(screen.getByLabelText('Edit income'))

      const input = screen.getByLabelText('Income amount') as HTMLInputElement
      expect(input).toBeTruthy()
      expect(input.value).toBe('1200')
      expect(document.activeElement).toBe(input)
    })

    it('typing a new amount and pressing Enter dispatches SET_BUDGET_INCOME_FOR_PERIOD for the current (Monthly) period and returns to view mode', () => {
      const dispatch = vi.fn()
      render(<BudgetPage state={incomeState()} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      fireEvent.click(within(document.querySelector('.seg')!).getByText('Monthly'))
      fireEvent.click(screen.getByLabelText('Edit income'))

      const input = screen.getByLabelText('Income amount') as HTMLInputElement
      fireEvent.change(input, { target: { value: '6000' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(dispatch).toHaveBeenCalledWith({
        type: 'SET_BUDGET_INCOME_FOR_PERIOD',
        period: 'monthly',
        amount: 6000,
      })
      expect(screen.queryByLabelText('Income amount')).toBeFalsy()
    })

    it('toggling Monthly/Yearly while not editing changes the displayed total via the existing formula', () => {
      render(<BudgetPage state={incomeState()} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      // income: 5000*12 + 1200 = 61200 (default Yearly)
      expect(screen.getAllByText('$61,200.00').length).toBeGreaterThan(0)

      fireEvent.click(within(document.querySelector('.seg')!).getByText('Monthly'))

      // income: 5000 + 1200/12 = 5100
      expect(screen.getAllByText('$5,100.00').length).toBeGreaterThan(0)
    })

    it('pressing Enter with an empty/invalid amount dispatches amount 0 for the current (Monthly) period', () => {
      const dispatch = vi.fn()
      render(<BudgetPage state={incomeState()} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      fireEvent.click(within(document.querySelector('.seg')!).getByText('Monthly'))
      fireEvent.click(screen.getByLabelText('Edit income'))

      const input = screen.getByLabelText('Income amount') as HTMLInputElement
      fireEvent.change(input, { target: { value: '' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(dispatch).toHaveBeenCalledWith({
        type: 'SET_BUDGET_INCOME_FOR_PERIOD',
        period: 'monthly',
        amount: 0,
      })
    })
  })

  describe('Records (T14)', () => {
    function recordsState(overrides: Partial<AppState> = {}): AppState {
      return defaultState({
        budgetTransactions: [
          makeTransaction({ id: 't1', date: '2025-03-05', description: 'Groceries', categoryId: 'cat-food', amount: 60 }),
          makeTransaction({ id: 't2', date: '2025-03-20', description: 'Rent payment', categoryId: 'cat-housing', amount: 1000 }),
          makeTransaction({ id: 't3', date: '2025-04-01', description: 'Outside period', categoryId: 'cat-food', amount: 25 }),
        ],
        ...overrides,
      })
    }

    function selectYear2025() {
      fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '2025' } })
    }

    it('Monthly mode shows only transactions from the current calendar month', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-03-15T00:00:00'))
      const state = recordsState()
      render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      fireEvent.click(within(document.querySelector('.seg')!).getByText('Monthly'))

      expect(screen.getByText('Groceries')).toBeTruthy()
      expect(screen.getByText('Rent payment')).toBeTruthy()
      expect(screen.queryByText('Outside period')).toBeFalsy()
      vi.useRealTimers()
    })

    it('Yearly mode with a selected year shows all transactions in that year, across months', () => {
      const state = recordsState()
      render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      selectYear2025()

      expect(screen.getByText('Groceries')).toBeTruthy()
      expect(screen.getByText('Rent payment')).toBeTruthy()
      expect(screen.getByText('Outside period')).toBeTruthy()
    })

    it('category tags on the records table resolve to the category name via categoriesById, not the raw id', () => {
      const state = recordsState()
      render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      selectYear2025()

      const row = screen.getByText('Groceries').closest('tr')!
      expect(within(row).getByText('Food')).toBeTruthy()
      expect(within(row).queryByText('cat-food')).toBeFalsy()
    })

    it('table is titled "Spend records", not "Records"', () => {
      render(<BudgetPage state={recordsState()} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      expect(screen.getByText(/^Spend records \(/)).toBeTruthy()
      expect(screen.queryByText(/^Records \(/)).toBeFalsy()
    })

    it('renders the Spend records section above the Expenses section', () => {
      const { container } = render(<BudgetPage state={recordsState()} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      const cardTitles = Array.from(container.querySelectorAll('.card-title')).map((el) => el.textContent)
      const recordsIdx = cardTitles.findIndex((t) => t?.startsWith('Spend records'))
      const expensesIdx = cardTitles.indexOf('Expenses')
      expect(recordsIdx).toBeGreaterThanOrEqual(0)
      expect(expensesIdx).toBeGreaterThanOrEqual(0)
      expect(recordsIdx).toBeLessThan(expensesIdx)
    })

    it('the Spend records table and the page-level Actual spend card share the same period/selectedYear scoping', () => {
      // Spend Records no longer has its own independent Month filter — it now
      // reads the same period/selectedYear state as the Actual spend card, so
      // changing the Year selector changes both together.
      const state = recordsState()
      const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      const summary = container.querySelector('[data-testid="summary-cards"]') as HTMLElement

      selectYear2025()
      const actualCardText = within(summary).getByText(/Actual spend/).textContent
      expect(actualCardText).toContain('2025')
      // actual: 60 + 1000 + 25 = 1085 for all of 2025
      expect(within(summary).getByText('$1,085.00')).toBeTruthy()
      expect(screen.getByText('Outside period')).toBeTruthy()
    })

    it('editing the Description cell commits a single-field UPDATE_BUDGET_TRANSACTION patch on blur; no UPSERT_CATEGORY_MAPPING', () => {
      const state = recordsState()
      const dispatch = vi.fn()
      render(<BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      selectYear2025()

      fireEvent.click(screen.getByText('Groceries'))
      const descInput = screen.getByLabelText('Edit record description') as HTMLInputElement
      expect(descInput.value).toBe('Groceries')

      fireEvent.change(descInput, { target: { value: 'Groceries (updated)' } })
      fireEvent.blur(descInput)

      expect(dispatch).toHaveBeenCalledWith({
        type: 'UPDATE_BUDGET_TRANSACTION',
        id: 't1',
        patch: { description: 'Groceries (updated)' },
      })
      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UPSERT_CATEGORY_MAPPING' }))
      expect(screen.queryByLabelText('Edit record description')).toBeFalsy()
    })

    it('the Category cell <select> onChange dispatches both UPDATE_BUDGET_TRANSACTION and UPSERT_CATEGORY_MAPPING', () => {
      const state = recordsState()
      const dispatch = vi.fn()
      const categoryDispatch = vi.fn()
      render(<BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={categoryDispatch} />)
      selectYear2025()

      const row = screen.getByText('Groceries').closest('tr')!
      fireEvent.click(within(row).getByText('Food'))

      const categorySelect = screen.getByLabelText('Edit record category') as HTMLSelectElement
      fireEvent.change(categorySelect, { target: { value: 'cat-housing' } })

      expect(dispatch).toHaveBeenCalledWith({
        type: 'UPDATE_BUDGET_TRANSACTION',
        id: 't1',
        patch: { categoryId: 'cat-housing' },
      })
      expect(categoryDispatch).toHaveBeenCalledWith({
        type: 'UPSERT_CATEGORY_MAPPING',
        description: 'Groceries',
        categoryId: 'cat-housing',
      })
      expect(screen.queryByLabelText('Edit record category')).toBeFalsy()
    })

    describe('delete', () => {
      it('does nothing when confirm returns false', () => {
        const state = recordsState()
        const dispatch = vi.fn()
        vi.spyOn(window, 'confirm').mockReturnValue(false)
        render(<BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
        selectYear2025()

        const row = screen.getByText('Groceries').closest('tr')!
        fireEvent.click(within(row).getByLabelText('Delete record'))

        expect(window.confirm).toHaveBeenCalledWith('Delete "Groceries"? This cannot be undone.')
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DELETE_BUDGET_TRANSACTION' }))
      })

      it('dispatches DELETE_BUDGET_TRANSACTION when confirm returns true', () => {
        const state = recordsState()
        const dispatch = vi.fn()
        vi.spyOn(window, 'confirm').mockReturnValue(true)
        render(<BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
        selectYear2025()

        const row = screen.getByText('Groceries').closest('tr')!
        fireEvent.click(within(row).getByLabelText('Delete record'))

        expect(dispatch).toHaveBeenCalledWith({ type: 'DELETE_BUDGET_TRANSACTION', id: 't1' })
      })
    })

    describe('manual add row', () => {
      it('valid input dispatches ADD_BUDGET_TRANSACTION then UPSERT_CATEGORY_MAPPING, and clears description/amount fields', () => {
        const dispatch = vi.fn()
        const categoryDispatch = vi.fn()
        render(<BudgetPage state={defaultState()} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={categoryDispatch} />)

        fireEvent.change(screen.getByLabelText('Record date'), { target: { value: '2025-05-01' } })
        fireEvent.change(screen.getByLabelText('Record description'), { target: { value: 'Coffee' } })
        fireEvent.change(screen.getByLabelText('Record amount'), { target: { value: '4.5' } })

        fireEvent.click(screen.getByText('Add Record'))

        expect(dispatch).toHaveBeenCalledWith({
          type: 'ADD_BUDGET_TRANSACTION',
          tx: { date: '2025-05-01', description: 'Coffee', categoryId: 'cat-housing', amount: 4.5 },
        })
        expect(categoryDispatch).toHaveBeenCalledWith({
          type: 'UPSERT_CATEGORY_MAPPING',
          description: 'Coffee',
          categoryId: 'cat-housing',
        })

        expect((screen.getByLabelText('Record description') as HTMLInputElement).value).toBe('')
        expect((screen.getByLabelText('Record amount') as HTMLInputElement).value).toBe('')
      })

      it('blank description falls back to the selected category name as the dispatched description', () => {
        const dispatch = vi.fn()
        render(<BudgetPage state={defaultState()} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

        const categorySelect = screen.getByLabelText('Record category') as HTMLSelectElement
        fireEvent.change(categorySelect, { target: { value: 'cat-entertainment' } })

        fireEvent.change(screen.getByLabelText('Record date'), { target: { value: '2025-05-01' } })
        fireEvent.change(screen.getByLabelText('Record amount'), { target: { value: '20' } })

        fireEvent.click(screen.getByText('Add Record'))

        expect(dispatch).toHaveBeenNthCalledWith(1, {
          type: 'ADD_BUDGET_TRANSACTION',
          tx: { date: '2025-05-01', description: 'Entertainment', categoryId: 'cat-entertainment', amount: 20 },
        })
      })

      it('does not dispatch when date is missing', () => {
        const dispatch = vi.fn()
        render(<BudgetPage state={defaultState()} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

        fireEvent.change(screen.getByLabelText('Record amount'), { target: { value: '20' } })
        fireEvent.click(screen.getByText('Add Record'))

        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_BUDGET_TRANSACTION' }))
        expect(screen.getByText('Date is required.')).toBeTruthy()
      })

      it('does not dispatch when amount is <= 0', () => {
        const dispatch = vi.fn()
        render(<BudgetPage state={defaultState()} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

        fireEvent.change(screen.getByLabelText('Record date'), { target: { value: '2025-05-01' } })
        fireEvent.change(screen.getByLabelText('Record amount'), { target: { value: '0' } })
        fireEvent.click(screen.getByText('Add Record'))

        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_BUDGET_TRANSACTION' }))
        expect(screen.getByText('Amount must be greater than 0.')).toBeTruthy()
      })

      it('a record added for a year other than the currently selected Year filter switches the filter so the record is visible', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2025-03-15T00:00:00'))
        let state: AppState = defaultState({
          budgetTransactions: [makeTransaction({ date: '2025-03-10', description: 'Old rent', categoryId: 'cat-housing', amount: 900 })],
        })
        const dispatch = (action: any) => {
          state = appReducer(state, action)
        }
        const { rerender } = render(<BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

        // Default Year filter is 2025 (only existing year, matching the current year too); add a record for a later year.
        fireEvent.change(screen.getByLabelText('Record date'), { target: { value: '2027-07-15' } })
        fireEvent.change(screen.getByLabelText('Record description'), { target: { value: 'New rent' } })
        fireEvent.change(screen.getByLabelText('Record amount'), { target: { value: '950' } })
        fireEvent.click(screen.getByText('Add Record'))

        rerender(<BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

        expect(state.budgetTransactions.length).toBe(2)
        expect(screen.getByText('New rent')).toBeTruthy()
        vi.useRealTimers()
      })

      it('a record added for the current year appears in the Spend records table (end-to-end with real reducer)', () => {
        let state: AppState = defaultState()
        const dispatch = (action: any) => {
          state = appReducer(state, action)
        }
        const { rerender } = render(<BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

        const now = new Date()
        const todayValue = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

        fireEvent.change(screen.getByLabelText('Record date'), { target: { value: todayValue } })
        fireEvent.change(screen.getByLabelText('Record description'), { target: { value: 'Coffee' } })
        fireEvent.change(screen.getByLabelText('Record amount'), { target: { value: '4.5' } })
        fireEvent.click(screen.getByText('Add Record'))

        rerender(<BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

        expect(state.budgetTransactions.length).toBe(1)
        expect(screen.getByText('Coffee')).toBeTruthy()
      })

      it('"+ Add new category…" dispatches ADD_CATEGORY with a fresh id + prompted name, and submitting uses that id', () => {
        let state: AppState = defaultState()
        const dispatch = vi.fn((action: any) => {
          state = appReducer(state, action)
        })
        const categoryDispatch = vi.fn()
        vi.spyOn(window, 'prompt').mockReturnValue('Utilities')
        const { rerender } = render(<BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={categoryDispatch} />)

        const categorySelect = screen.getByLabelText('Record category') as HTMLSelectElement
        fireEvent.change(categorySelect, { target: { value: '__add_new' } })

        const addCategoryCall = categoryDispatch.mock.calls.find((c) => c[0].type === 'ADD_CATEGORY')
        expect(addCategoryCall).toBeTruthy()
        expect(addCategoryCall![0].name).toBe('Utilities')
        const newId = addCategoryCall![0].id

        rerender(<BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={categoryDispatch} />)

        fireEvent.change(screen.getByLabelText('Record date'), { target: { value: '2025-05-01' } })
        fireEvent.change(screen.getByLabelText('Record amount'), { target: { value: '20' } })
        fireEvent.click(screen.getByText('Add Record'))

        const addTxCall = dispatch.mock.calls.find((c) => c[0].type === 'ADD_BUDGET_TRANSACTION')
        expect(addTxCall).toBeTruthy()
        expect(addTxCall![0].tx.categoryId).toBe(newId)
      })

      it('typing a description matching an existing mapping auto-selects that mapping\'s category', () => {
        const mappings: CategoryMapping[] = [
          { id: 'map1', substring: 'coffee', categoryId: 'cat-food', updatedAt: '2025-01-01T00:00:00.000Z' },
        ]
        render(<BudgetPage state={defaultState()} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={mappings} categoryDispatch={vi.fn()} />)

        const descInput = screen.getByLabelText('Record description') as HTMLInputElement
        fireEvent.change(descInput, { target: { value: 'Coffee Shop' } })

        const categorySelect = screen.getByLabelText('Record category') as HTMLSelectElement
        expect(categorySelect.value).toBe('cat-food')
      })

      it('manually changing the category select after an auto-match prevents the next description edit from overwriting it', () => {
        const mappings: CategoryMapping[] = [
          { id: 'map1', substring: 'coffee', categoryId: 'cat-food', updatedAt: '2025-01-01T00:00:00.000Z' },
        ]
        render(<BudgetPage state={defaultState()} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={mappings} categoryDispatch={vi.fn()} />)

        const descInput = screen.getByLabelText('Record description') as HTMLInputElement
        fireEvent.change(descInput, { target: { value: 'Coffee Shop' } })

        const categorySelect = screen.getByLabelText('Record category') as HTMLSelectElement
        expect(categorySelect.value).toBe('cat-food')

        fireEvent.change(categorySelect, { target: { value: 'cat-travel' } })
        expect(categorySelect.value).toBe('cat-travel')

        fireEvent.change(descInput, { target: { value: 'Coffee Shop Extra' } })
        expect(categorySelect.value).toBe('cat-travel')
      })
    })

    describe('import dialog', () => {
      const VALID_OFX = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20250501120000
<TRNAMT>-4.50
<NAME>Coffee Shop
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20250502120000
<TRNAMT>-40.00
<NAME>Gas Station
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

      const EMPTY_OFX = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

      it('pasting CSV text and clicking Import dispatches IMPORT_BUDGET_TRANSACTIONS with parsed rows (no category field)', () => {
        const dispatch = vi.fn()
        render(<BudgetPage state={defaultState()} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

        fireEvent.click(screen.getByText('Import transactions…'))
        fireEvent.change(screen.getByLabelText('Import account name'), { target: { value: 'Checking' } })
        fireEvent.change(screen.getByLabelText('Paste CSV text'), {
          target: { value: '2025-05-01,Coffee,4.5\n2025-05-02,Gas,40' },
        })
        fireEvent.click(screen.getByText('Import'))

        expect(dispatch).toHaveBeenCalledWith({
          type: 'IMPORT_BUDGET_TRANSACTIONS',
          rows: [
            { date: '2025-05-01', description: 'Coffee', amount: 4.5, accountName: 'Checking' },
            { date: '2025-05-02', description: 'Gas', amount: 40, accountName: 'Checking' },
          ],
          categories: CATEGORIES,
          categoryMappings: [],
        })
        expect(screen.queryByText('Import transactions')).toBeFalsy()
      })

      it('a duplicate-of-an-existing-transaction row is not added (end-to-end with real reducer)', () => {
        let state: AppState = defaultState({
          budgetTransactions: [makeTransaction({ id: 't1', date: '2025-05-01', description: 'Coffee', categoryId: 'cat-food', amount: 4.5 })],
        })
        const dispatch = (action: any) => {
          state = appReducer(state, action)
        }
        const { rerender } = render(<BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

        fireEvent.click(screen.getByText('Import transactions…'))
        fireEvent.change(screen.getByLabelText('Import account name'), { target: { value: 'Checking' } })
        fireEvent.change(screen.getByLabelText('Paste CSV text'), {
          target: { value: '2025-05-01,Coffee,4.5\n2025-05-02,Gas,40' },
        })
        fireEvent.click(screen.getByText('Import'))

        rerender(<BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

        // The existing record has no accountName, so the pasted row with
        // accountName 'Checking' has a different natural key and is NOT a
        // duplicate — both rows are added, plus the original = 3.
        expect(state.budgetTransactions.length).toBe(3)
      })

      it('switching to the Upload-file tab and selecting a valid OFX file populates the textarea via csvText', async () => {
        const dispatch = vi.fn()
        render(<BudgetPage state={defaultState()} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

        fireEvent.click(screen.getByText('Import transactions…'))
        fireEvent.click(screen.getByText('Upload file'))

        const file = new File([VALID_OFX], 'transactions.ofx', { type: 'application/x-ofx' })
        const input = screen.getByLabelText('OFX/QFX file') as HTMLInputElement
        fireEvent.change(input, { target: { files: [file] } })

        await vi.waitFor(() => {
          fireEvent.click(screen.getByText('Copy-Paste'))
          expect((screen.getByLabelText('Paste CSV text') as HTMLTextAreaElement).value).toBe(VALID_OFX)
        })
      })

      it('import status text updates to reflect the parsed row count after a successful import', () => {
        const dispatch = vi.fn()
        render(<BudgetPage state={defaultState()} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

        expect(screen.getByText('Never imported')).toBeTruthy()

        fireEvent.click(screen.getByText('Import transactions…'))
        fireEvent.change(screen.getByLabelText('Import account name'), { target: { value: 'Checking' } })
        fireEvent.change(screen.getByLabelText('Paste CSV text'), {
          target: { value: '2025-05-01,Coffee,4.5\n2025-05-02,Gas,40' },
        })
        fireEvent.click(screen.getByText('Import'))

        expect(screen.getByText('2 row(s) detected')).toBeTruthy()
      })

      describe('account name gate', () => {
        it('Import is disabled with empty Account Name on the Copy-Paste tab; enabled once filled; disabled again after clearing', () => {
          render(<BudgetPage state={defaultState()} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
          fireEvent.click(screen.getByText('Import transactions…'))

          const importBtn = screen.getByText('Import') as HTMLButtonElement
          expect(importBtn.disabled).toBe(true)

          fireEvent.change(screen.getByLabelText('Import account name'), { target: { value: 'Checking' } })
          expect(importBtn.disabled).toBe(false)

          fireEvent.change(screen.getByLabelText('Import account name'), { target: { value: '' } })
          expect(importBtn.disabled).toBe(true)
        })

        it('Import is disabled with empty Account Name on the Upload tab; enabled once filled; disabled again after clearing', () => {
          render(<BudgetPage state={defaultState()} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
          fireEvent.click(screen.getByText('Import transactions…'))
          fireEvent.click(screen.getByText('Upload file'))

          const importBtn = screen.getByText('Import') as HTMLButtonElement
          expect(importBtn.disabled).toBe(true)

          fireEvent.change(screen.getByLabelText('Import account name'), { target: { value: 'Checking' } })
          expect(importBtn.disabled).toBe(false)

          fireEvent.change(screen.getByLabelText('Import account name'), { target: { value: '' } })
          expect(importBtn.disabled).toBe(true)
        })
      })

      describe('OFX upload', () => {
        it('happy path: dispatched IMPORT_BUDGET_TRANSACTIONS rows have the entered accountName and no category field', async () => {
          const dispatch = vi.fn()
          render(<BudgetPage state={defaultState()} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

          fireEvent.click(screen.getByText('Import transactions…'))
          fireEvent.click(screen.getByText('Upload file'))
          fireEvent.change(screen.getByLabelText('Import account name'), { target: { value: 'Checking' } })

          const file = new File([VALID_OFX], 'transactions.ofx', { type: 'application/x-ofx' })
          fireEvent.change(screen.getByLabelText('OFX/QFX file'), { target: { files: [file] } })

          // Wait for the async FileReader to finish populating csvText before
          // importing — confirmed via the Copy-Paste tab's textarea value.
          await vi.waitFor(() => {
            fireEvent.click(screen.getByText('Copy-Paste'))
            expect((screen.getByLabelText('Paste CSV text') as HTMLTextAreaElement).value).toBe(VALID_OFX)
          })
          fireEvent.click(screen.getByText('Upload file'))
          fireEvent.click(screen.getByText('Import'))

          expect(dispatch).toHaveBeenCalledWith({
            type: 'IMPORT_BUDGET_TRANSACTIONS',
            rows: [
              { date: '2025-05-01', description: 'Coffee Shop', amount: -4.5, accountName: 'Checking' },
              { date: '2025-05-02', description: 'Gas Station', amount: -40, accountName: 'Checking' },
            ],
            categories: CATEGORIES,
            categoryMappings: [],
          })
        })

        it('error path: a file with 0 STMTTRN blocks shows an inline error, disables Import, and dispatches nothing on click', async () => {
          const dispatch = vi.fn()
          render(<BudgetPage state={defaultState()} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

          fireEvent.click(screen.getByText('Import transactions…'))
          fireEvent.click(screen.getByText('Upload file'))
          fireEvent.change(screen.getByLabelText('Import account name'), { target: { value: 'Checking' } })

          const file = new File([EMPTY_OFX], 'empty.ofx', { type: 'application/x-ofx' })
          fireEvent.change(screen.getByLabelText('OFX/QFX file'), { target: { files: [file] } })

          await vi.waitFor(() => {
            fireEvent.click(screen.getByText('Copy-Paste'))
            expect((screen.getByLabelText('Paste CSV text') as HTMLTextAreaElement).value).toBe(EMPTY_OFX)
          })
          fireEvent.click(screen.getByText('Upload file'))

          const importBtn = screen.getByText('Import') as HTMLButtonElement
          fireEvent.click(importBtn)

          expect(
            await screen.findByText("No transactions found in file — check it's a valid OFX/QFX export")
          ).toBeTruthy()
          expect(importBtn.disabled).toBe(true)
          expect(dispatch).not.toHaveBeenCalled()
        })

        it('the error clears when a new valid file is selected after an error', async () => {
          const dispatch = vi.fn()
          render(<BudgetPage state={defaultState()} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)

          fireEvent.click(screen.getByText('Import transactions…'))
          fireEvent.click(screen.getByText('Upload file'))
          fireEvent.change(screen.getByLabelText('Import account name'), { target: { value: 'Checking' } })

          const emptyFile = new File([EMPTY_OFX], 'empty.ofx', { type: 'application/x-ofx' })
          fireEvent.change(screen.getByLabelText('OFX/QFX file'), { target: { files: [emptyFile] } })

          await vi.waitFor(() => {
            fireEvent.click(screen.getByText('Copy-Paste'))
            expect((screen.getByLabelText('Paste CSV text') as HTMLTextAreaElement).value).toBe(EMPTY_OFX)
          })
          fireEvent.click(screen.getByText('Upload file'))
          fireEvent.click(screen.getByText('Import'))

          expect(
            await screen.findByText("No transactions found in file — check it's a valid OFX/QFX export")
          ).toBeTruthy()

          const validFile = new File([VALID_OFX], 'transactions.ofx', { type: 'application/x-ofx' })
          fireEvent.change(screen.getByLabelText('OFX/QFX file'), { target: { files: [validFile] } })

          await vi.waitFor(() => {
            expect(
              screen.queryByText("No transactions found in file — check it's a valid OFX/QFX export")
            ).toBeFalsy()
          })
        })
      })
    })

    describe('empty state', () => {
      it('shows "No records for this period." when periodFilteredTransactions is empty', () => {
        render(<BudgetPage state={defaultState()} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
        expect(screen.getByText('No records for this period.')).toBeTruthy()
      })
    })
  })

  describe('Spend records Account column (T13)', () => {
    it('renders "—" for a row with no accountName', () => {
      const state: AppState = defaultState({
        budgetTransactions: [
          makeTransaction({ id: 't1', date: '2025-03-05', description: 'Groceries', categoryId: 'cat-food', amount: 60 }),
        ],
      })
      render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '2025' } })

      const row = screen.getByText('Groceries').closest('tr')!
      expect(within(row).getByText('—')).toBeTruthy()
    })

    it('per-cell edit round-trip: click Account cell -> type -> blur dispatches a single UPDATE_BUDGET_TRANSACTION with the new accountName', () => {
      const state: AppState = defaultState({
        budgetTransactions: [
          makeTransaction({ id: 't1', date: '2025-03-05', description: 'Groceries', categoryId: 'cat-food', amount: 60 }),
        ],
      })
      const dispatch = vi.fn()
      render(<BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '2025' } })

      const row = screen.getByText('Groceries').closest('tr')!
      fireEvent.click(within(row).getByText('—'))

      const accountInput = screen.getByLabelText('Edit record account') as HTMLInputElement
      fireEvent.change(accountInput, { target: { value: 'Checking' } })
      fireEvent.blur(accountInput)

      expect(dispatch).toHaveBeenCalledWith({
        type: 'UPDATE_BUDGET_TRANSACTION',
        id: 't1',
        patch: { accountName: 'Checking' },
      })
      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UPSERT_CATEGORY_MAPPING' }))
    })

    it('the Spend records total row leading cell has colSpan={4}', () => {
      const state: AppState = defaultState({
        budgetTransactions: [
          makeTransaction({ id: 't1', date: '2025-03-05', description: 'Groceries', categoryId: 'cat-food', amount: 60 }),
        ],
      })
      const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '2025' } })

      const totalRow = container.querySelector('[data-testid="records-total-row"]')!
      const leadCell = totalRow.querySelector('td')!
      expect(leadCell.getAttribute('colspan')).toBe('4')
    })
  })

  describe('Spend records search, sort, pagination, and per-cell Escape revert', () => {
    function scopedRecordsState(overrides: Partial<AppState> = {}): AppState {
      return defaultState({
        budgetTransactions: [
          makeTransaction({ id: 't1', date: '2025-03-05', description: 'Groceries', categoryId: 'cat-food', amount: 60, accountName: 'Checking' }),
          makeTransaction({ id: 't2', date: '2025-03-20', description: 'Rent payment', categoryId: 'cat-housing', amount: 1000, accountName: 'Savings' }),
          makeTransaction({ id: 't3', date: '2025-03-12', description: 'Zoo tickets', categoryId: 'cat-zoo', amount: 40, accountName: 'Checking' }),
        ],
        ...overrides,
      })
    }

    function renderInYear2025(overrides: Partial<AppState> = {}) {
      const state = scopedRecordsState(overrides)
      const utils = render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '2025' } })
      return utils
    }

    describe('search', () => {
      it('filters by description, case-insensitively', () => {
        renderInYear2025()

        fireEvent.change(screen.getByLabelText('Search records'), { target: { value: 'groc' } })
        expect(screen.getByText('Groceries')).toBeTruthy()
        expect(screen.queryByText('Rent payment')).toBeFalsy()
        expect(screen.queryByText('Zoo tickets')).toBeFalsy()
      })

      it('matches the resolved category name, not the raw category id', () => {
        renderInYear2025()
        fireEvent.change(screen.getByLabelText('Search records'), { target: { value: 'ZOO' } })
        expect(screen.getByText('Zoo tickets')).toBeTruthy()
        expect(screen.queryByText('Groceries')).toBeFalsy()
      })

      it('matches the account name, case-insensitively', () => {
        renderInYear2025()
        fireEvent.change(screen.getByLabelText('Search records'), { target: { value: 'savings' } })
        expect(screen.getByText('Rent payment')).toBeTruthy()
        expect(screen.queryByText('Groceries')).toBeFalsy()
      })

      it('shows the empty-state copy when nothing matches (the table, including its total row, is not rendered)', () => {
        renderInYear2025()
        fireEvent.change(screen.getByLabelText('Search records'), { target: { value: 'nonexistent-xyz' } })
        expect(screen.getByText('No records for this period.')).toBeTruthy()
        expect(screen.queryByTestId('records-total-row')).toBeFalsy()
      })
    })

    describe('sorting', () => {
      function recordsTable() {
        return document.querySelectorAll('table')[0]
      }
      function bodyRows() {
        return Array.from(recordsTable().querySelectorAll('tbody tr:not([data-testid="records-total-row"])'))
      }

      it('defaults to Date descending, and reverses on repeat click', () => {
        renderInYear2025()
        expect(bodyRows().map((tr) => tr.querySelector('td')!.textContent)).toEqual([
          '2025-03-20',
          '2025-03-12',
          '2025-03-05',
        ])

        fireEvent.click(screen.getByLabelText('Sort by date'))
        expect(bodyRows().map((tr) => tr.querySelector('td')!.textContent)).toEqual([
          '2025-03-05',
          '2025-03-12',
          '2025-03-20',
        ])
        expect(screen.getByLabelText('Sort by date').querySelector('svg')).toBeTruthy()
      })

      it('sorts by Description ascending, then reverses on repeat click', () => {
        renderInYear2025()
        fireEvent.click(screen.getByLabelText('Sort by description'))
        expect(bodyRows().map((tr) => tr.querySelectorAll('td')[1].textContent)).toEqual([
          'Groceries',
          'Rent payment',
          'Zoo tickets',
        ])

        fireEvent.click(screen.getByLabelText('Sort by description'))
        expect(bodyRows().map((tr) => tr.querySelectorAll('td')[1].textContent)).toEqual([
          'Zoo tickets',
          'Rent payment',
          'Groceries',
        ])
      })

      it('sorts by Category using the resolved category name, not the raw category id', () => {
        renderInYear2025()
        fireEvent.click(screen.getAllByLabelText('Sort by category')[0])
        // Resolved names: Food, Housing, Zoo -> ascending alphabetically.
        // (raw ids cat-food/cat-housing/cat-zoo would sort the same here by
        // coincidence, so this also checks against the id ordering below.)
        expect(bodyRows().map((tr) => tr.querySelectorAll('td')[2].textContent)).toEqual(['Food', 'Housing', 'Zoo'])
      })

      it('sorts by Account ascending, then reverses on repeat click', () => {
        renderInYear2025()
        fireEvent.click(screen.getByLabelText('Sort by account'))
        expect(bodyRows().map((tr) => tr.querySelectorAll('td')[3].textContent)).toEqual([
          'Checking',
          'Checking',
          'Savings',
        ])

        fireEvent.click(screen.getByLabelText('Sort by account'))
        expect(bodyRows().map((tr) => tr.querySelectorAll('td')[3].textContent)).toEqual([
          'Savings',
          'Checking',
          'Checking',
        ])
      })

      it('sorts by Amount and shows a chevron on the active column header', () => {
        renderInYear2025()
        const amountHeader = screen.getAllByLabelText(/Sort by amount/)[0]
        fireEvent.click(amountHeader)
        expect(bodyRows().map((tr) => tr.querySelectorAll('td')[4].textContent)).toEqual([
          '$40.00',
          '$60.00',
          '$1,000.00',
        ])
        expect(amountHeader.querySelector('svg')).toBeTruthy()

        fireEvent.click(amountHeader)
        expect(bodyRows().map((tr) => tr.querySelectorAll('td')[4].textContent)).toEqual([
          '$1,000.00',
          '$60.00',
          '$40.00',
        ])
      })
    })

    describe('pagination', () => {
      function manyTransactionsState(count: number): AppState {
        const txs: BudgetTransaction[] = Array.from({ length: count }, (_, i) =>
          makeTransaction({
            id: `tx-${i}`,
            date: `2025-01-${String((i % 28) + 1).padStart(2, '0')}`,
            description: `Item ${String(i).padStart(4, '0')}`,
            categoryId: 'cat-food',
            amount: 10 + i,
          })
        )
        return defaultState({ budgetTransactions: txs })
      }

      it('is hidden when the filtered row count is <= 500', () => {
        const state = manyTransactionsState(500)
        render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
        fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '2025' } })
        expect(screen.queryByTestId('records-pagination')).toBeFalsy()
      })

      it('appears when the filtered row count exceeds 500, with Prev disabled on page 1', () => {
        const state = manyTransactionsState(501)
        render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
        fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '2025' } })

        const pagination = screen.getByTestId('records-pagination')
        expect(pagination).toBeTruthy()
        expect(within(pagination).getByText('Page 1 of 6')).toBeTruthy()
        expect((within(pagination).getByText('Prev') as HTMLButtonElement).disabled).toBe(true)
        expect((within(pagination).getByText('Next') as HTMLButtonElement).disabled).toBe(false)
      })

      it('clicking Next advances the slice and disables Next on the last page', () => {
        const state = manyTransactionsState(501)
        render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
        fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '2025' } })

        const pagination = screen.getByTestId('records-pagination')
        fireEvent.click(within(pagination).getByText('Next'))
        expect(within(pagination).getByText('Page 2 of 6')).toBeTruthy()

        for (let i = 0; i < 4; i++) {
          fireEvent.click(within(pagination).getByText('Next'))
        }
        expect(within(pagination).getByText('Page 6 of 6')).toBeTruthy()
        expect((within(pagination).getByText('Next') as HTMLButtonElement).disabled).toBe(true)
      })

      it('changing the search text resets to page 1', () => {
        const state = manyTransactionsState(501)
        render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
        fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '2025' } })

        const pagination = screen.getByTestId('records-pagination')
        fireEvent.click(within(pagination).getByText('Next'))
        expect(within(screen.getByTestId('records-pagination')).getByText('Page 2 of 6')).toBeTruthy()

        // 'Item' matches every row, so the filtered set still exceeds 500 and pagination stays visible.
        fireEvent.change(screen.getByLabelText('Search records'), { target: { value: 'Item' } })
        expect(within(screen.getByTestId('records-pagination')).getByText('Page 1 of 6')).toBeTruthy()
      })

      it('switching the selected year resets to page 1', () => {
        const state = manyTransactionsState(501)
        render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
        fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '2025' } })

        const pagination = screen.getByTestId('records-pagination')
        fireEvent.click(within(pagination).getByText('Next'))
        expect(within(screen.getByTestId('records-pagination')).getByText('Page 2 of 6')).toBeTruthy()

        const currentYear = String(new Date().getFullYear())
        fireEvent.change(screen.getByLabelText('Select year'), { target: { value: currentYear } })
        fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '2025' } })
        expect(within(screen.getByTestId('records-pagination')).getByText('Page 1 of 6')).toBeTruthy()
      })
    })

    describe('per-cell Escape revert', () => {
      it('pressing Escape on the Amount cell reverts without dispatching', () => {
        const dispatch = vi.fn()
        const state = scopedRecordsState()
        render(<BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
        fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '2025' } })

        const row = screen.getByText('Groceries').closest('tr')!
        fireEvent.click(within(row).getByText('$60.00'))

        const amountInput = screen.getByLabelText('Edit record amount') as HTMLInputElement
        expect(amountInput.value).toBe('60')
        fireEvent.change(amountInput, { target: { value: '999' } })
        fireEvent.keyDown(amountInput, { key: 'Escape' })

        expect(dispatch).not.toHaveBeenCalled()
        expect(within(row).getByText('$60.00')).toBeTruthy()
        expect(screen.queryByLabelText('Edit record amount')).toBeFalsy()
      })
    })
  })

  describe('category breakdown (T15)', () => {
    function currentMonth(): string {
      const now = new Date()
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    }

    it('shows LOSS_COLOR overlay and "Over by $X" when actual exceeds budgeted amount', () => {
      const state: AppState = defaultState({
        budgetExpenses: [makeExpense({ categoryId: 'cat-housing', amount: 100, frequency: 'monthly' })],
        budgetTransactions: [
          makeTransaction({ date: `${currentMonth()}-10`, categoryId: 'cat-housing', amount: 150 }),
        ],
      })

      const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      fireEvent.click(within(container.querySelector('.seg')!).getByText('Monthly'))
      const fill = container.querySelector('[data-testid="category-bar-fill"]') as HTMLElement
      expect(fill.style.backgroundColor).toBe(hexToRgb(LOSS_COLOR))
      expect(screen.getByText(`Over by ${fmtUSD(50)}`)).toBeTruthy()
    })

    it('shows the under-budget blue overlay and "Under by $X" (GAIN_COLOR text) when actual is at/under budget', () => {
      const state: AppState = defaultState({
        budgetExpenses: [makeExpense({ categoryId: 'cat-housing', amount: 200, frequency: 'monthly' })],
        budgetTransactions: [
          makeTransaction({ date: `${currentMonth()}-10`, categoryId: 'cat-housing', amount: 120 }),
        ],
      })

      const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      fireEvent.click(within(container.querySelector('.seg')!).getByText('Monthly'))
      const fill = container.querySelector('[data-testid="category-bar-fill"]') as HTMLElement
      expect(fill.style.backgroundColor).toBe(hexToRgb('#3b6ef6'))

      const overLine = screen.getByText(`Under by ${fmtUSD(80)}`)
      expect(overLine).toBeTruthy()
      expect(overLine.style.color).toBe(hexToRgb(GAIN_COLOR))
    })

    it('renders no "×" delete-category button anywhere on the page', () => {
      const state: AppState = defaultState({
        budgetExpenses: [makeExpense({ categoryId: 'cat-housing', amount: 200, frequency: 'monthly' })],
        budgetTransactions: [
          makeTransaction({ date: `${currentMonth()}-10`, categoryId: 'cat-housing', amount: 120 }),
        ],
      })
      render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      expect(screen.queryByText('×')).toBeFalsy()
      expect(screen.queryByLabelText(/Delete category/)).toBeFalsy()
    })

    it('a category present only in budgetTransactions (no matching expense) produces no breakdown row', () => {
      const state: AppState = defaultState({
        budgetExpenses: [makeExpense({ categoryId: 'cat-housing', amount: 200, frequency: 'monthly' })],
        budgetTransactions: [
          makeTransaction({ date: `${currentMonth()}-10`, categoryId: 'cat-housing', amount: 120 }),
          makeTransaction({ date: `${currentMonth()}-12`, categoryId: 'cat-travel', amount: 75 }),
        ],
      })
      const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      const breakdownCard = screen.getByText('Category Breakdown').closest('.card') as HTMLElement
      expect(within(breakdownCard).queryByText('Travel')).toBeFalsy()
      const fills = container.querySelectorAll('[data-testid="category-bar-fill"]')
      expect(fills.length).toBe(1)
    })

    it('shows "Add expenses to see the breakdown." when budgetExpenses is empty', () => {
      render(<BudgetPage state={defaultState()} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      expect(screen.getByText('Add expenses to see the breakdown.')).toBeTruthy()
    })
  })

  describe('category select options (categoryId mapping)', () => {
    it('every category <select> renders state.categories as <option>s (name label, id value)', () => {
      const state = defaultState({
        budgetExpenses: [makeExpense({ id: 'e1', categoryId: 'cat-housing' })],
        budgetTransactions: [makeTransaction({ id: 't1', date: '2025-03-05', description: 'Groceries', categoryId: 'cat-food' })],
      })
      render(<BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />)
      fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '2025' } })

      fireEvent.click(screen.getByLabelText('Edit expense'))
      const row = screen.getByText('Groceries').closest('tr')!
      fireEvent.click(within(row).getByText('Food'))
      fireEvent.click(screen.getByText('Add Expense'))

      const selects: HTMLSelectElement[] = [
        screen.getByLabelText('Filter by category') as HTMLSelectElement,
        screen.getByLabelText('Record category') as HTMLSelectElement,
        screen.getByLabelText('Edit record category') as HTMLSelectElement,
        screen.getByLabelText('Edit expense category') as HTMLSelectElement,
        screen.getByLabelText('Expense category') as HTMLSelectElement,
      ]

      selects.forEach((select) => {
        const opts = Array.from(select.querySelectorAll('option')).filter(
          (o) => o.value !== '__all' && o.value !== '__add_new'
        )
        expect(opts.map((o) => o.value)).toEqual(CATEGORIES.map((c) => c.id))
        expect(opts.map((o) => o.textContent)).toEqual(CATEGORIES.map((c) => c.name))
      })
    })
  })
})
