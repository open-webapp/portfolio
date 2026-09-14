import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { BudgetPage } from './BudgetPage'
import { initialState, type AppState } from '../lib/state'
import type { Expense } from '../lib/types'
import { GAIN_COLOR, LOSS_COLOR, fmtUSD, toPeriod } from '../lib/computations'
import type { BudgetTransaction } from '../lib/types'
import { appReducer } from '../lib/reducer'

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: overrides.id ?? `exp-${Math.random()}`,
    name: overrides.name ?? 'Rent',
    category: overrides.category ?? 'Housing',
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
    category: overrides.category ?? 'Housing',
    amount: overrides.amount ?? 100,
    ...overrides,
  }
}

describe('BudgetPage', () => {
  it('renders 4 summary cards with correct labels and values at default monthly period', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-03-15T00:00:00'))
    const state: AppState = {
      ...initialState(),
      budgetIncomeMonthly: 5000,
      budgetIncomeYearly: 1200, // 100/mo
      budgetExpenses: [makeExpense({ amount: 1000, frequency: 'monthly' }), makeExpense({ amount: 2400, frequency: 'yearly' })], // 200/mo -> total 1200
      budgetTransactions: [
        makeTransaction({ date: '2025-03-05', category: 'Housing', amount: 300 }),
        makeTransaction({ date: '2025-03-20', category: 'Housing', amount: 150 }),
      ],
    }

    const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} />)
    const summary = container.querySelector('[data-testid="summary-cards"]') as HTMLElement
    const cards = summary.querySelectorAll(':scope > div')
    expect(cards.length).toBe(4)

    expect(within(summary).getByText('Income')).toBeTruthy()
    // income: 5000 + 1200/12 = 5100
    expect(within(summary).getByText('$5,100.00')).toBeTruthy()

    expect(within(summary).getByText('Budgeted (Monthly)')).toBeTruthy()
    // expenses: 1000 + 2400/12 = 1200
    expect(within(summary).getByText('$1,200.00')).toBeTruthy()

    expect(within(summary).getByText('Actual spend (March 2025)')).toBeTruthy()
    // actual: 300 + 150 = 450
    expect(within(summary).getByText('$450.00')).toBeTruthy()

    expect(within(summary).getByText('Variance')).toBeTruthy()
    // variance: 1200 - 450 = 750
    expect(within(summary).getByText('$750.00')).toBeTruthy()

    vi.useRealTimers()
  })

  it('toggling to Yearly recomputes summary values per yearly formulas', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-03-15T00:00:00'))
    const state: AppState = {
      ...initialState(),
      budgetIncomeMonthly: 5000,
      budgetIncomeYearly: 1200,
      budgetExpenses: [makeExpense({ amount: 1000, frequency: 'monthly' }), makeExpense({ amount: 2400, frequency: 'yearly' })],
      budgetTransactions: [makeTransaction({ date: '2025-06-01', category: 'Housing', amount: 500 })],
    }

    const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} />)

    fireEvent.click(within(container.querySelector('.seg')!).getByText('Yearly'))
    const summary = container.querySelector('[data-testid="summary-cards"]') as HTMLElement

    // income: 5000*12 + 1200 = 61200
    expect(within(summary).getByText('$61,200.00')).toBeTruthy()
    // expenses: 1000*12 + 2400 = 14400
    expect(within(summary).getByText('$14,400.00')).toBeTruthy()
    // actual: 500 (transaction falls within 2025)
    expect(within(summary).getByText('$500.00')).toBeTruthy()
    // variance: 14400 - 500 = 13900
    expect(within(summary).getByText('$13,900.00')).toBeTruthy()

    vi.useRealTimers()
  })

  it('renders period toggle as .seg/.seg-opt radio markup with correct checked state', () => {
    const state: AppState = { ...initialState() }
    const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} />)

    const seg = container.querySelector('.seg')
    expect(seg).toBeTruthy()
    const radios = seg!.querySelectorAll('input[type="radio"]')
    expect(radios.length).toBe(2)
    expect((radios[0] as HTMLInputElement).checked).toBe(true) // Monthly is default
    expect((radios[1] as HTMLInputElement).checked).toBe(false)

    fireEvent.click(within(seg!).getByText('Yearly'))
    const radiosAfter = seg!.querySelectorAll('input[type="radio"]')
    expect((radiosAfter[0] as HTMLInputElement).checked).toBe(false)
    expect((radiosAfter[1] as HTMLInputElement).checked).toBe(true)
  })

  it('shows GAIN_COLOR for the Variance card when budgeted >= actual', () => {
    const state: AppState = {
      ...initialState(),
      budgetExpenses: [makeExpense({ amount: 1000, frequency: 'monthly', category: 'Housing' })],
      budgetTransactions: [],
    }
    const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} />)
    const summary = container.querySelector('[data-testid="summary-cards"]') as HTMLElement
    const varianceLabel = within(summary).getByText('Variance')
    // variance: 1000 - 0 = 1000
    const varianceValue = varianceLabel.nextElementSibling as HTMLElement
    expect(varianceValue.textContent).toBe('$1,000.00')
    expect(varianceValue.style.color).toBe(hexToRgb(GAIN_COLOR))
  })

  it('shows LOSS_COLOR for the Variance card when budgeted < actual', () => {
    const now = new Date()
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const state: AppState = {
      ...initialState(),
      budgetExpenses: [makeExpense({ amount: 100, frequency: 'monthly', category: 'Housing' })],
      budgetTransactions: [makeTransaction({ date: `${currentMonth}-05`, category: 'Housing', amount: 500 })],
    }
    const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} />)
    const summary = container.querySelector('[data-testid="summary-cards"]') as HTMLElement
    // variance: 100 - 500 = -400
    const varianceValue = within(summary).getByText('-$400.00')
    expect(varianceValue.style.color).toBe(hexToRgb(LOSS_COLOR))
  })

  it('filtering by category shows only matching rows', () => {
    const state: AppState = {
      ...initialState(),
      budgetExpenses: [
        makeExpense({ id: 'e1', name: 'Rent', category: 'Housing' }),
        makeExpense({ id: 'e2', name: 'Netflix', category: 'Entertainment' }),
      ],
    }
    render(<BudgetPage state={state} dispatch={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Filter by category'), { target: { value: 'Entertainment' } })

    expect(screen.queryByText('Rent')).toBeFalsy()
    expect(screen.getByText('Netflix')).toBeTruthy()
  })

  describe('sorting', () => {
    const fixture = [
      makeExpense({ id: 'a', name: 'Zeta', category: 'Zoo', amount: 10, frequency: 'monthly' }),
      makeExpense({ id: 'b', name: 'Alpha', category: 'Alpha Cat', amount: 500, frequency: 'monthly' }),
      makeExpense({ id: 'c', name: 'Mid', category: 'Mid Cat', amount: 100, frequency: 'monthly' }),
    ]

    function getBodyRowNames(container: HTMLElement): string[] {
      return Array.from(container.querySelectorAll('tbody tr:not([data-testid="expenses-total-row"])')).map(
        (tr) => tr.querySelector('td')!.textContent
      ) as string[]
    }

    it('sorts by name via the Name column header', () => {
      const state: AppState = { ...initialState(), budgetExpenses: fixture }
      const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} />)
      fireEvent.click(screen.getByLabelText('Sort by name'))
      expect(getBodyRowNames(container)).toEqual(['Alpha', 'Mid', 'Zeta'])
    })

    it('sorts by amount (descending) via the Amount column header', () => {
      const state: AppState = { ...initialState(), budgetExpenses: fixture }
      const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} />)
      fireEvent.click(screen.getByLabelText(/Sort by amount/))
      expect(getBodyRowNames(container)).toEqual(['Alpha', 'Mid', 'Zeta'])
    })

    it('sorts by category (default) via the Category column header, and toggles direction on repeat click', () => {
      const state: AppState = { ...initialState(), budgetExpenses: fixture }
      const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} />)
      expect(getBodyRowNames(container)).toEqual(['Alpha', 'Mid', 'Zeta'])
      fireEvent.click(screen.getByLabelText('Sort by category'))
      expect(getBodyRowNames(container)).toEqual(['Zeta', 'Mid', 'Alpha'])
    })
  })

  describe('inline edit', () => {
    it('clicking Edit shows editable inputs; changing a field dispatches UPDATE_BUDGET_EXPENSE; Done exits edit mode', () => {
      const state: AppState = {
        ...initialState(),
        budgetExpenses: [makeExpense({ id: 'e1', name: 'Rent', category: 'Housing', amount: 1000 })],
      }
      const dispatch = vi.fn()
      render(<BudgetPage state={state} dispatch={dispatch} />)

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

    it('selecting "+ Add new category…" prompts for a name and selects it locally without dispatching', () => {
      const state: AppState = {
        ...initialState(),
        budgetExpenses: [makeExpense({ id: 'e1', name: 'Rent', category: 'Housing', amount: 1000 })],
      }
      const dispatch = vi.fn()
      vi.spyOn(window, 'prompt').mockReturnValue('Subscriptions')
      render(<BudgetPage state={state} dispatch={dispatch} />)

      fireEvent.click(screen.getByLabelText('Edit expense'))

      const categorySelect = screen.getByLabelText('Edit expense category') as HTMLSelectElement
      fireEvent.change(categorySelect, { target: { value: '__add_new' } })

      expect(window.prompt).toHaveBeenCalled()
      expect(categorySelect.value).toBe('Subscriptions')
      expect(dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'UPDATE_BUDGET_EXPENSE', patch: expect.objectContaining({ category: expect.anything() }) })
      )
    })
  })

  describe('delete', () => {
    it('does not dispatch DELETE_BUDGET_EXPENSE when confirm is cancelled', () => {
      const state: AppState = {
        ...initialState(),
        budgetExpenses: [makeExpense({ id: 'e1' })],
      }
      const dispatch = vi.fn()
      vi.spyOn(window, 'confirm').mockReturnValue(false)
      render(<BudgetPage state={state} dispatch={dispatch} />)

      fireEvent.click(screen.getByLabelText('Delete expense'))

      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DELETE_BUDGET_EXPENSE' }))
    })

    it('dispatches DELETE_BUDGET_EXPENSE with the row id when confirm is accepted', () => {
      const state: AppState = {
        ...initialState(),
        budgetExpenses: [makeExpense({ id: 'e1' })],
      }
      const dispatch = vi.fn()
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      render(<BudgetPage state={state} dispatch={dispatch} />)

      fireEvent.click(screen.getByLabelText('Delete expense'))

      expect(dispatch).toHaveBeenCalledWith({ type: 'DELETE_BUDGET_EXPENSE', id: 'e1' })
    })
  })

  describe('add expense dialog', () => {
    it('is closed by default; clicking the Add Expense button opens it', () => {
      render(<BudgetPage state={initialState()} dispatch={vi.fn()} />)

      expect(screen.queryByText('Add expense')).toBeFalsy()

      fireEvent.click(screen.getByText('Add Expense'))

      expect(screen.getByText('Add expense')).toBeTruthy()
    })

    it('filling the form and clicking Add dispatches ADD_BUDGET_EXPENSE, closes the dialog, and clears the fields', () => {
      const dispatch = vi.fn()
      render(<BudgetPage state={initialState()} dispatch={dispatch} />)

      fireEvent.click(screen.getByText('Add Expense'))
      fireEvent.change(screen.getByLabelText('Expense name'), { target: { value: 'Gym' } })
      fireEvent.change(screen.getByLabelText('Expense amount'), { target: { value: '50' } })
      fireEvent.change(screen.getByLabelText('Expense frequency'), { target: { value: 'yearly' } })

      fireEvent.click(screen.getByText('Add'))

      expect(dispatch).toHaveBeenCalledWith({
        type: 'ADD_BUDGET_EXPENSE',
        expense: { name: 'Gym', category: expect.any(String), amount: 50, frequency: 'yearly' },
      })

      expect(screen.queryByText('Add expense')).toBeFalsy()

      fireEvent.click(screen.getByText('Add Expense'))
      expect((screen.getByLabelText('Expense name') as HTMLInputElement).value).toBe('')
      expect((screen.getByLabelText('Expense amount') as HTMLInputElement).value).toBe('')
    })

    it('clicking the backdrop closes the dialog without dispatching', () => {
      const dispatch = vi.fn()
      const { container } = render(<BudgetPage state={initialState()} dispatch={dispatch} />)

      fireEvent.click(screen.getByText('Add Expense'))
      fireEvent.change(screen.getByLabelText('Expense name'), { target: { value: 'Gym' } })
      fireEvent.change(screen.getByLabelText('Expense amount'), { target: { value: '50' } })

      fireEvent.click(container.querySelector('.dialog-backdrop')!)

      expect(screen.queryByText('Add expense')).toBeFalsy()
      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_BUDGET_EXPENSE' }))
    })

    it('clicking Cancel closes the dialog without dispatching', () => {
      const dispatch = vi.fn()
      render(<BudgetPage state={initialState()} dispatch={dispatch} />)

      fireEvent.click(screen.getByText('Add Expense'))
      fireEvent.change(screen.getByLabelText('Expense name'), { target: { value: 'Gym' } })

      fireEvent.click(screen.getByText('Cancel'))

      expect(screen.queryByText('Add expense')).toBeFalsy()
      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_BUDGET_EXPENSE' }))
    })

    it('does not dispatch and keeps the dialog open when the name is empty', () => {
      const dispatch = vi.fn()
      render(<BudgetPage state={initialState()} dispatch={dispatch} />)

      fireEvent.click(screen.getByText('Add Expense'))
      fireEvent.change(screen.getByLabelText('Expense amount'), { target: { value: '50' } })

      fireEvent.click(screen.getByText('Add'))

      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_BUDGET_EXPENSE' }))
      expect(screen.getByText('Add expense')).toBeTruthy()
    })

    it('does not dispatch and keeps the dialog open when the amount is <= 0', () => {
      const dispatch = vi.fn()
      render(<BudgetPage state={initialState()} dispatch={dispatch} />)

      fireEvent.click(screen.getByText('Add Expense'))
      fireEvent.change(screen.getByLabelText('Expense name'), { target: { value: 'Gym' } })
      fireEvent.change(screen.getByLabelText('Expense amount'), { target: { value: '0' } })

      fireEvent.click(screen.getByText('Add'))

      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_BUDGET_EXPENSE' }))
      expect(screen.getByText('Add expense')).toBeTruthy()
    })

    it('the "+ Add new category…" flow works inside the dialog and the new category is included in the dispatched payload', () => {
      const dispatch = vi.fn()
      vi.spyOn(window, 'prompt').mockReturnValue('Subscriptions')
      render(<BudgetPage state={initialState()} dispatch={dispatch} />)

      fireEvent.click(screen.getByText('Add Expense'))

      const categorySelect = screen.getByLabelText('Expense category') as HTMLSelectElement
      fireEvent.change(categorySelect, { target: { value: '__add_new' } })

      expect(window.prompt).toHaveBeenCalled()
      expect(categorySelect.value).toBe('Subscriptions')

      fireEvent.change(screen.getByLabelText('Expense name'), { target: { value: 'Netflix' } })
      fireEvent.change(screen.getByLabelText('Expense amount'), { target: { value: '15' } })

      fireEvent.click(screen.getByText('Add'))

      expect(dispatch).toHaveBeenCalledWith({
        type: 'ADD_BUDGET_EXPENSE',
        expense: { name: 'Netflix', category: 'Subscriptions', amount: 15, frequency: 'monthly' },
      })
    })
  })

  describe('actual spend (T13)', () => {
    it('Budgeted card shows the same number the old Expenses card showed (regression)', () => {
      const state: AppState = {
        ...initialState(),
        budgetExpenses: [
          makeExpense({ amount: 1000, frequency: 'monthly', category: 'Housing' }),
          makeExpense({ amount: 2400, frequency: 'yearly', category: 'Travel' }),
        ],
        budgetTransactions: [],
      }
      const expectedBudgeted = state.budgetExpenses.reduce(
        (sum, e) => sum + toPeriod(e.amount, e.frequency, 'monthly'),
        0
      )

      const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} />)
      const summary = container.querySelector('[data-testid="summary-cards"]') as HTMLElement
      const budgetedLabel = within(summary).getByText('Budgeted (Monthly)')
      const budgetedValue = budgetedLabel.nextElementSibling as HTMLElement

      expect(budgetedValue.textContent).toBe(fmtUSD(expectedBudgeted))
    })

    it('expense table renders Actual/Variance columns; rows sharing a category show identical values', () => {
      const now = new Date()
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      const state: AppState = {
        ...initialState(),
        budgetExpenses: [
          makeExpense({ id: 'e1', name: 'Rent', category: 'Housing', amount: 1000, frequency: 'monthly' }),
          makeExpense({ id: 'e2', name: 'Repairs', category: 'Housing', amount: 200, frequency: 'monthly' }),
        ],
        budgetTransactions: [makeTransaction({ date: `${currentMonth}-10`, category: 'Housing', amount: 300 })],
      }

      const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} />)
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
      render(<BudgetPage state={initialState()} dispatch={vi.fn()} />)

      expect(screen.queryByText('Add expense')).toBeFalsy()
      fireEvent.click(screen.getByText('Add Expense'))
      expect(screen.getByText('Add expense')).toBeTruthy()
    })

    it('.dialog-backdrop has a z-index so overlays (e.g. Add expense) render above page controls', () => {
      const css = readFileSync(`${process.cwd()}/src/styles/styles.css`, 'utf-8')
      const rule = css.match(/\.dialog-backdrop\s*\{[^}]*\}/)?.[0] ?? ''
      expect(rule).toMatch(/z-index:\s*\d+/)
    })

    it('default month/year picker value matches the real current month/year', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-07-22T00:00:00'))

      render(<BudgetPage state={initialState()} dispatch={vi.fn()} />)
      const monthSelect = screen.getByLabelText('Select month') as HTMLSelectElement
      expect(monthSelect.value).toBe('2025-07')

      fireEvent.click(within(document.querySelector('.seg')!).getByText('Yearly'))
      const yearSelect = screen.getByLabelText('Select year') as HTMLSelectElement
      expect(yearSelect.value).toBe('2025')

      vi.useRealTimers()
    })
  })

  describe('empty state', () => {
    it('shows "No expenses to show." when budgetExpenses is empty', () => {
      const state: AppState = { ...initialState(), budgetExpenses: [] }
      render(<BudgetPage state={state} dispatch={vi.fn()} />)
      expect(screen.getByText('No expenses to show.')).toBeTruthy()
    })

    it('shows "No expenses to show." when a filter matches nothing, even with other expenses present', () => {
      const state: AppState = {
        ...initialState(),
        budgetExpenses: [makeExpense({ id: 'e1', category: 'Housing' })],
      }
      render(<BudgetPage state={state} dispatch={vi.fn()} />)

      fireEvent.change(screen.getByLabelText('Filter by category'), { target: { value: 'Entertainment' } })

      expect(screen.getByText('No expenses to show.')).toBeTruthy()
    })
  })

  describe('income click-to-edit', () => {
    function incomeState(overrides: Partial<AppState> = {}): AppState {
      return {
        ...initialState(),
        budgetIncomeMonthly: 5000,
        budgetIncomeYearly: 1200,
        budgetExpenses: [],
        ...overrides,
      }
    }

    it('default view shows fmtUSD(totalIncome) and no input', () => {
      render(<BudgetPage state={incomeState()} dispatch={vi.fn()} />)
      expect(screen.getAllByText('$5,100.00').length).toBeGreaterThan(0)
      expect(screen.queryByLabelText('Income amount')).toBeFalsy()
    })

    it('clicking Edit income shows an autofocused input prefilled with the current-period amount', () => {
      render(<BudgetPage state={incomeState()} dispatch={vi.fn()} />)
      fireEvent.click(screen.getByLabelText('Edit income'))

      const input = screen.getByLabelText('Income amount') as HTMLInputElement
      expect(input).toBeTruthy()
      expect(input.value).toBe('5000')
      expect(document.activeElement).toBe(input)
    })

    it('typing a new amount and pressing Enter dispatches SET_BUDGET_INCOME_FOR_PERIOD and returns to view mode', () => {
      const dispatch = vi.fn()
      render(<BudgetPage state={incomeState()} dispatch={dispatch} />)
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
      render(<BudgetPage state={incomeState()} dispatch={vi.fn()} />)
      expect(screen.getAllByText('$5,100.00').length).toBeGreaterThan(0)

      fireEvent.click(within(document.querySelector('.seg')!).getByText('Yearly'))

      // income: 5000*12 + 1200 = 61200
      expect(screen.getAllByText('$61,200.00').length).toBeGreaterThan(0)
    })

    it('pressing Enter with an empty/invalid amount dispatches amount 0', () => {
      const dispatch = vi.fn()
      render(<BudgetPage state={incomeState()} dispatch={dispatch} />)
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
      return {
        ...initialState(),
        budgetTransactions: [
          makeTransaction({ id: 't1', date: '2025-03-05', description: 'Groceries', category: 'Food', amount: 60 }),
          makeTransaction({ id: 't2', date: '2025-03-20', description: 'Rent payment', category: 'Housing', amount: 1000 }),
          makeTransaction({ id: 't3', date: '2025-04-01', description: 'Outside period', category: 'Food', amount: 25 }),
        ],
        ...overrides,
      }
    }

    function selectMarch2025(container: HTMLElement) {
      fireEvent.change(screen.getByLabelText('Select month'), { target: { value: '2025-03' } })
      void container
    }

    it('records table shows only transactions matching selectedMonth/selectedYear', () => {
      const state = recordsState()
      const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} />)
      selectMarch2025(container)

      expect(screen.getByText('Groceries')).toBeTruthy()
      expect(screen.getByText('Rent payment')).toBeTruthy()
      expect(screen.queryByText('Outside period')).toBeFalsy()
    })

    it('table is titled "Spend records", not "Records"', () => {
      render(<BudgetPage state={recordsState()} dispatch={vi.fn()} />)
      expect(screen.getByText(/^Spend records \(/)).toBeTruthy()
      expect(screen.queryByText(/^Records \(/)).toBeFalsy()
    })

    it('renders the Spend records section above the Expenses section', () => {
      const { container } = render(<BudgetPage state={recordsState()} dispatch={vi.fn()} />)
      const cardTitles = Array.from(container.querySelectorAll('.card-title')).map((el) => el.textContent)
      const recordsIdx = cardTitles.findIndex((t) => t?.startsWith('Spend records'))
      const expensesIdx = cardTitles.indexOf('Expenses')
      expect(recordsIdx).toBeGreaterThanOrEqual(0)
      expect(expensesIdx).toBeGreaterThanOrEqual(0)
      expect(recordsIdx).toBeLessThan(expensesIdx)
    })

    it('the Spend records month filter does not affect the page-level Actual spend summary', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-03-15T00:00:00'))
      const state = recordsState()
      const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} />)
      const summary = container.querySelector('[data-testid="summary-cards"]') as HTMLElement
      const before = within(summary).getByText(/Actual spend/).textContent

      // Selecting a different month in the Spend records filter must not
      // change the page-level Actual spend card (that always tracks the
      // current month, independent of this table's filter).
      fireEvent.change(screen.getByLabelText('Select month'), { target: { value: '2025-04' } })

      const after = within(summary).getByText(/Actual spend/).textContent
      expect(after).toBe(before)
      vi.useRealTimers()
    })

    it('editing a row and clicking Done dispatches UPDATE_BUDGET_TRANSACTION with the correct patch', () => {
      const state = recordsState()
      const dispatch = vi.fn()
      render(<BudgetPage state={state} dispatch={dispatch} />)
      fireEvent.change(screen.getByLabelText('Select month'), { target: { value: '2025-03' } })

      const row = screen.getByText('Groceries').closest('tr')!
      fireEvent.click(within(row).getByLabelText('Edit record'))

      const descInput = screen.getByLabelText('Edit record description') as HTMLInputElement
      fireEvent.change(descInput, { target: { value: 'Groceries (updated)' } })
      const amountInput = screen.getByLabelText('Edit record amount') as HTMLInputElement
      fireEvent.change(amountInput, { target: { value: '75' } })

      fireEvent.click(screen.getByText('Done'))

      expect(dispatch).toHaveBeenCalledWith({
        type: 'UPDATE_BUDGET_TRANSACTION',
        id: 't1',
        patch: { date: '2025-03-05', description: 'Groceries (updated)', category: 'Food', amount: 75 },
      })
    })

    describe('delete', () => {
      it('does nothing when confirm returns false', () => {
        const state = recordsState()
        const dispatch = vi.fn()
        vi.spyOn(window, 'confirm').mockReturnValue(false)
        render(<BudgetPage state={state} dispatch={dispatch} />)
        fireEvent.change(screen.getByLabelText('Select month'), { target: { value: '2025-03' } })

        const row = screen.getByText('Groceries').closest('tr')!
        fireEvent.click(within(row).getByLabelText('Delete record'))

        expect(window.confirm).toHaveBeenCalledWith('Delete "Groceries"? This cannot be undone.')
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DELETE_BUDGET_TRANSACTION' }))
      })

      it('dispatches DELETE_BUDGET_TRANSACTION when confirm returns true', () => {
        const state = recordsState()
        const dispatch = vi.fn()
        vi.spyOn(window, 'confirm').mockReturnValue(true)
        render(<BudgetPage state={state} dispatch={dispatch} />)
        fireEvent.change(screen.getByLabelText('Select month'), { target: { value: '2025-03' } })

        const row = screen.getByText('Groceries').closest('tr')!
        fireEvent.click(within(row).getByLabelText('Delete record'))

        expect(dispatch).toHaveBeenCalledWith({ type: 'DELETE_BUDGET_TRANSACTION', id: 't1' })
      })
    })

    describe('manual add row', () => {
      it('valid input dispatches ADD_BUDGET_TRANSACTION and clears description/amount fields', () => {
        const dispatch = vi.fn()
        render(<BudgetPage state={initialState()} dispatch={dispatch} />)

        fireEvent.change(screen.getByLabelText('Record date'), { target: { value: '2025-05-01' } })
        fireEvent.change(screen.getByLabelText('Record description'), { target: { value: 'Coffee' } })
        fireEvent.change(screen.getByLabelText('Record amount'), { target: { value: '4.5' } })

        fireEvent.click(screen.getByText('Add Record'))

        expect(dispatch).toHaveBeenCalledWith({
          type: 'ADD_BUDGET_TRANSACTION',
          tx: { date: '2025-05-01', description: 'Coffee', category: expect.any(String), amount: 4.5 },
        })

        expect((screen.getByLabelText('Record description') as HTMLInputElement).value).toBe('')
        expect((screen.getByLabelText('Record amount') as HTMLInputElement).value).toBe('')
      })

      it('blank description falls back to the selected category as the dispatched description', () => {
        const dispatch = vi.fn()
        vi.spyOn(window, 'prompt').mockReturnValue('Utilities')
        render(<BudgetPage state={initialState()} dispatch={dispatch} />)

        const categorySelect = screen.getByLabelText('Record category') as HTMLSelectElement
        fireEvent.change(categorySelect, { target: { value: '__add_new' } })
        expect(categorySelect.value).toBe('Utilities')

        fireEvent.change(screen.getByLabelText('Record date'), { target: { value: '2025-05-01' } })
        fireEvent.change(screen.getByLabelText('Record amount'), { target: { value: '20' } })

        fireEvent.click(screen.getByText('Add Record'))

        expect(dispatch).toHaveBeenCalledWith({
          type: 'ADD_BUDGET_TRANSACTION',
          tx: { date: '2025-05-01', description: 'Utilities', category: 'Utilities', amount: 20 },
        })
      })

      it('does not dispatch when date is missing', () => {
        const dispatch = vi.fn()
        render(<BudgetPage state={initialState()} dispatch={dispatch} />)

        fireEvent.change(screen.getByLabelText('Record amount'), { target: { value: '20' } })
        fireEvent.click(screen.getByText('Add Record'))

        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_BUDGET_TRANSACTION' }))
      })

      it('does not dispatch when amount is <= 0', () => {
        const dispatch = vi.fn()
        render(<BudgetPage state={initialState()} dispatch={dispatch} />)

        fireEvent.change(screen.getByLabelText('Record date'), { target: { value: '2025-05-01' } })
        fireEvent.change(screen.getByLabelText('Record amount'), { target: { value: '0' } })
        fireEvent.click(screen.getByText('Add Record'))

        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_BUDGET_TRANSACTION' }))
      })
    })

    describe('import dialog', () => {
      it('pasting CSV text and clicking Import dispatches IMPORT_BUDGET_TRANSACTIONS with parsed rows', () => {
        const dispatch = vi.fn()
        render(<BudgetPage state={initialState()} dispatch={dispatch} />)

        fireEvent.click(screen.getByText('Import transactions…'))
        fireEvent.change(screen.getByLabelText('Paste CSV text'), {
          target: { value: '2025-05-01,Coffee,Food,4.5\n2025-05-02,Gas,Auto,40' },
        })
        fireEvent.click(screen.getByText('Import'))

        expect(dispatch).toHaveBeenCalledWith({
          type: 'IMPORT_BUDGET_TRANSACTIONS',
          rows: [
            { date: '2025-05-01', description: 'Coffee', category: 'Food', amount: 4.5 },
            { date: '2025-05-02', description: 'Gas', category: 'Auto', amount: 40 },
          ],
        })
        expect(screen.queryByText('Import transactions')).toBeFalsy()
      })

      it('a duplicate-of-an-existing-transaction row is not added (end-to-end with real reducer)', () => {
        let state: AppState = {
          ...initialState(),
          budgetTransactions: [makeTransaction({ id: 't1', date: '2025-05-01', description: 'Coffee', category: 'Food', amount: 4.5 })],
        }
        const dispatch = (action: any) => {
          state = appReducer(state, action)
        }
        const { rerender } = render(<BudgetPage state={state} dispatch={dispatch} />)

        fireEvent.click(screen.getByText('Import transactions…'))
        fireEvent.change(screen.getByLabelText('Paste CSV text'), {
          target: { value: '2025-05-01,Coffee,Food,4.5\n2025-05-02,Gas,Auto,40' },
        })
        fireEvent.click(screen.getByText('Import'))

        rerender(<BudgetPage state={state} dispatch={dispatch} />)

        expect(state.budgetTransactions.length).toBe(2)
      })

      it('switching to the Upload-file tab and selecting a file populates the textarea via csvText', async () => {
        const dispatch = vi.fn()
        render(<BudgetPage state={initialState()} dispatch={dispatch} />)

        fireEvent.click(screen.getByText('Import transactions…'))
        fireEvent.click(screen.getByText('Upload file'))

        const file = new File(['2025-05-01,Coffee,Food,4.5'], 'transactions.csv', { type: 'text/csv' })
        const input = screen.getByLabelText('CSV file') as HTMLInputElement
        fireEvent.change(input, { target: { files: [file] } })

        await vi.waitFor(() => {
          fireEvent.click(screen.getByText('Copy-Paste'))
          expect((screen.getByLabelText('Paste CSV text') as HTMLTextAreaElement).value).toBe(
            '2025-05-01,Coffee,Food,4.5'
          )
        })
      })

      it('import status text updates to reflect the parsed row count after a successful import', () => {
        const dispatch = vi.fn()
        render(<BudgetPage state={initialState()} dispatch={dispatch} />)

        expect(screen.getByText('Never imported')).toBeTruthy()

        fireEvent.click(screen.getByText('Import transactions…'))
        fireEvent.change(screen.getByLabelText('Paste CSV text'), {
          target: { value: '2025-05-01,Coffee,Food,4.5\n2025-05-02,Gas,Auto,40' },
        })
        fireEvent.click(screen.getByText('Import'))

        expect(screen.getByText('2 row(s) detected')).toBeTruthy()
      })
    })

    describe('empty state', () => {
      it('shows "No records for this period." when periodFilteredTransactions is empty', () => {
        render(<BudgetPage state={initialState()} dispatch={vi.fn()} />)
        expect(screen.getByText('No records for this period.')).toBeTruthy()
      })
    })
  })

  describe('category breakdown (T15)', () => {
    function currentMonth(): string {
      const now = new Date()
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    }

    it('shows LOSS_COLOR overlay and "Over by $X" when actual exceeds budgeted amount', () => {
      const state: AppState = {
        ...initialState(),
        budgetExpenses: [makeExpense({ category: 'Housing', amount: 100, frequency: 'monthly' })],
        budgetTransactions: [
          makeTransaction({ date: `${currentMonth()}-10`, category: 'Housing', amount: 150 }),
        ],
      }

      const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} />)
      const fill = container.querySelector('[data-testid="category-bar-fill"]') as HTMLElement
      expect(fill.style.backgroundColor).toBe(hexToRgb(LOSS_COLOR))
      expect(screen.getByText(`Over by ${fmtUSD(50)}`)).toBeTruthy()
    })

    it('shows the under-budget blue overlay and "Under by $X" (GAIN_COLOR text) when actual is at/under budget', () => {
      const state: AppState = {
        ...initialState(),
        budgetExpenses: [makeExpense({ category: 'Housing', amount: 200, frequency: 'monthly' })],
        budgetTransactions: [
          makeTransaction({ date: `${currentMonth()}-10`, category: 'Housing', amount: 120 }),
        ],
      }

      const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} />)
      const fill = container.querySelector('[data-testid="category-bar-fill"]') as HTMLElement
      expect(fill.style.backgroundColor).toBe(hexToRgb('#3b6ef6'))

      const overLine = screen.getByText(`Under by ${fmtUSD(80)}`)
      expect(overLine).toBeTruthy()
      expect(overLine.style.color).toBe(hexToRgb(GAIN_COLOR))
    })

    it('renders no "×" delete-category button anywhere on the page', () => {
      const state: AppState = {
        ...initialState(),
        budgetExpenses: [makeExpense({ category: 'Housing', amount: 200, frequency: 'monthly' })],
        budgetTransactions: [
          makeTransaction({ date: `${currentMonth()}-10`, category: 'Housing', amount: 120 }),
        ],
      }
      render(<BudgetPage state={state} dispatch={vi.fn()} />)
      expect(screen.queryByText('×')).toBeFalsy()
      expect(screen.queryByLabelText(/Delete category/)).toBeFalsy()
    })

    it('a category present only in budgetTransactions (no matching expense) produces no breakdown row', () => {
      const state: AppState = {
        ...initialState(),
        budgetExpenses: [makeExpense({ category: 'Housing', amount: 200, frequency: 'monthly' })],
        budgetTransactions: [
          makeTransaction({ date: `${currentMonth()}-10`, category: 'Housing', amount: 120 }),
          makeTransaction({ date: `${currentMonth()}-12`, category: 'Travel', amount: 75 }),
        ],
      }
      const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} />)
      const breakdownCard = screen.getByText('Category Breakdown').closest('.card') as HTMLElement
      expect(within(breakdownCard).queryByText('Travel')).toBeFalsy()
      const fills = container.querySelectorAll('[data-testid="category-bar-fill"]')
      expect(fills.length).toBe(1)
    })

    it('shows "Add expenses to see the breakdown." when budgetExpenses is empty', () => {
      render(<BudgetPage state={initialState()} dispatch={vi.fn()} />)
      expect(screen.getByText('Add expenses to see the breakdown.')).toBeTruthy()
    })
  })
})
