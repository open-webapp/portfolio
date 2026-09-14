import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { BudgetPage } from './BudgetPage'
import { initialState, type AppState } from '../lib/state'
import type { Expense } from '../lib/types'
import { GAIN_COLOR, LOSS_COLOR } from '../lib/computations'

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

describe('BudgetPage', () => {
  it('renders 3 summary cards with correct values at default monthly period', () => {
    const state: AppState = {
      ...initialState(),
      budgetIncomeMonthly: 5000,
      budgetIncomeYearly: 1200, // 100/mo
      budgetExpenses: [makeExpense({ amount: 1000, frequency: 'monthly' }), makeExpense({ amount: 2400, frequency: 'yearly' })], // 200/mo
    }

    const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} />)
    const summary = container.querySelector('[data-testid="summary-cards"]') as HTMLElement

    // income: 5000 + 1200/12 = 5100
    expect(within(summary).getByText('$5,100.00')).toBeTruthy()
    // expenses: 1000 + 2400/12 = 1200
    expect(within(summary).getByText('$1,200.00')).toBeTruthy()
    // net: 5100 - 1200 = 3900
    expect(within(summary).getByText('$3,900.00')).toBeTruthy()
  })

  it('toggling to Yearly recomputes all 3 summary values per yearly formulas', () => {
    const state: AppState = {
      ...initialState(),
      budgetIncomeMonthly: 5000,
      budgetIncomeYearly: 1200,
      budgetExpenses: [makeExpense({ amount: 1000, frequency: 'monthly' }), makeExpense({ amount: 2400, frequency: 'yearly' })],
    }

    const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} />)

    fireEvent.click(within(container.querySelector('.seg')!).getByText('Yearly'))
    const summary = container.querySelector('[data-testid="summary-cards"]') as HTMLElement

    // income: 5000*12 + 1200 = 61200
    expect(within(summary).getByText('$61,200.00')).toBeTruthy()
    // expenses: 1000*12 + 2400 = 14400
    expect(within(summary).getByText('$14,400.00')).toBeTruthy()
    // net: 61200 - 14400 = 46800
    expect(within(summary).getByText('$46,800.00')).toBeTruthy()
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

  it('shows GAIN_COLOR for net >= 0 and LOSS_COLOR for net < 0', () => {
    const positiveState: AppState = {
      ...initialState(),
      budgetIncomeMonthly: 5000,
      budgetExpenses: [makeExpense({ amount: 1000, frequency: 'monthly' })],
    }
    const { unmount } = render(<BudgetPage state={positiveState} dispatch={vi.fn()} />)
    const netValuePositive = screen.getByText('$4,000.00')
    expect(netValuePositive.style.color).toBe(hexToRgb(GAIN_COLOR))
    unmount()

    const negativeState: AppState = {
      ...initialState(),
      budgetIncomeMonthly: 1000,
      budgetExpenses: [makeExpense({ amount: 5000, frequency: 'monthly' })],
    }
    render(<BudgetPage state={negativeState} dispatch={vi.fn()} />)
    const netValueNegative = screen.getByText('-$4,000.00')
    expect(netValueNegative.style.color).toBe(hexToRgb(LOSS_COLOR))
  })

  it('changing the Monthly income input dispatches SET_BUDGET_INCOME_MONTHLY with a parsed number', () => {
    const state: AppState = { ...initialState() }
    const dispatch = vi.fn()
    render(<BudgetPage state={state} dispatch={dispatch} />)

    const input = screen.getByLabelText('Monthly income') as HTMLInputElement
    fireEvent.change(input, { target: { value: '2500' } })
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_BUDGET_INCOME_MONTHLY', amount: 2500 })
  })

  it('changing the Yearly income input dispatches SET_BUDGET_INCOME_YEARLY with a parsed number', () => {
    const state: AppState = { ...initialState() }
    const dispatch = vi.fn()
    render(<BudgetPage state={state} dispatch={dispatch} />)

    const input = screen.getByLabelText('Yearly income') as HTMLInputElement
    fireEvent.change(input, { target: { value: '12000' } })
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_BUDGET_INCOME_YEARLY', amount: 12000 })
  })

  it('non-numeric income input dispatches amount: 0', () => {
    const state: AppState = { ...initialState() }
    const dispatch = vi.fn()
    render(<BudgetPage state={state} dispatch={dispatch} />)

    const input = screen.getByLabelText('Monthly income') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'abc' } })
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_BUDGET_INCOME_MONTHLY', amount: 0 })
  })

  describe('add-expense form', () => {
    it('does not dispatch ADD_BUDGET_EXPENSE when name is empty', () => {
      const state: AppState = { ...initialState() }
      const dispatch = vi.fn()
      render(<BudgetPage state={state} dispatch={dispatch} />)

      fireEvent.change(screen.getByLabelText('Expense amount'), { target: { value: '50' } })
      fireEvent.click(screen.getByText('Add'))

      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_BUDGET_EXPENSE' }))
    })

    it.each([['0'], ['-5'], ['abc']])('does not dispatch ADD_BUDGET_EXPENSE for amount %s', (amountStr) => {
      const state: AppState = { ...initialState() }
      const dispatch = vi.fn()
      render(<BudgetPage state={state} dispatch={dispatch} />)

      fireEvent.change(screen.getByLabelText('Expense name'), { target: { value: 'Gym' } })
      fireEvent.change(screen.getByLabelText('Expense amount'), { target: { value: amountStr } })
      fireEvent.click(screen.getByText('Add'))

      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_BUDGET_EXPENSE' }))
    })

    it('dispatches ADD_BUDGET_EXPENSE with correctly-typed fields and clears name/amount on valid input', () => {
      const state: AppState = { ...initialState() }
      const dispatch = vi.fn()
      render(<BudgetPage state={state} dispatch={dispatch} />)

      const nameInput = screen.getByLabelText('Expense name') as HTMLInputElement
      const amountInput = screen.getByLabelText('Expense amount') as HTMLInputElement
      const categorySelect = screen.getByLabelText('Expense category') as HTMLSelectElement
      const freqSelect = screen.getByLabelText('Expense frequency') as HTMLSelectElement

      fireEvent.change(nameInput, { target: { value: '  Gym  ' } })
      fireEvent.change(amountInput, { target: { value: '45.5' } })
      fireEvent.change(freqSelect, { target: { value: 'yearly' } })
      fireEvent.click(screen.getByText('Add'))

      expect(dispatch).toHaveBeenCalledWith({
        type: 'ADD_BUDGET_EXPENSE',
        expense: { name: 'Gym', category: categorySelect.value, amount: 45.5, frequency: 'yearly' },
      })
      const call = dispatch.mock.calls.find((c) => c[0].type === 'ADD_BUDGET_EXPENSE')
      expect(call![0].expense).not.toHaveProperty('id')

      expect(nameInput.value).toBe('')
      expect(amountInput.value).toBe('')
    })
  })

  it('populates the add-expense category select from state.budgetCategories', () => {
    const state: AppState = {
      ...initialState(),
      budgetCategories: ['Housing', 'My Custom Category'],
    }
    render(<BudgetPage state={state} dispatch={vi.fn()} />)

    const select = screen.getByLabelText('Expense category') as HTMLSelectElement
    const optionLabels = Array.from(select.options).map((o) => o.value)
    expect(optionLabels).toEqual(['Housing', 'My Custom Category', '__add_new'])
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
      return Array.from(container.querySelectorAll('tbody tr')).map(
        (tr) => tr.querySelector('td')!.textContent
      ) as string[]
    }

    it('sorts by name', () => {
      const state: AppState = { ...initialState(), budgetExpenses: fixture }
      const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} />)
      fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'name' } })
      expect(getBodyRowNames(container)).toEqual(['Alpha', 'Mid', 'Zeta'])
    })

    it('sorts by amount (descending)', () => {
      const state: AppState = { ...initialState(), budgetExpenses: fixture }
      const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} />)
      fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'amount' } })
      expect(getBodyRowNames(container)).toEqual(['Alpha', 'Mid', 'Zeta'])
    })

    it('sorts by category', () => {
      const state: AppState = { ...initialState(), budgetExpenses: fixture }
      const { container } = render(<BudgetPage state={state} dispatch={vi.fn()} />)
      fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'category' } })
      expect(getBodyRowNames(container)).toEqual(['Alpha', 'Mid', 'Zeta'])
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

      fireEvent.click(screen.getByText('Edit'))

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

      fireEvent.click(screen.getByText('Delete'))

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

      fireEvent.click(screen.getByText('Delete'))

      expect(dispatch).toHaveBeenCalledWith({ type: 'DELETE_BUDGET_EXPENSE', id: 'e1' })
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

  describe('add category', () => {
    it('selecting "+ Add category…" prompts, dispatches ADD_BUDGET_CATEGORY, and selects the new category', () => {
      const state: AppState = {
        ...initialState(),
        budgetCategories: ['Housing', 'Entertainment'],
      }
      const dispatch = vi.fn()
      render(<BudgetPage state={state} dispatch={dispatch} />)

      vi.spyOn(window, 'prompt').mockReturnValue('Travel')

      const select = screen.getByLabelText('Expense category') as HTMLSelectElement
      fireEvent.change(select, { target: { value: '__add_new' } })

      expect(window.prompt).toHaveBeenCalledWith('New category name:')
      expect(dispatch).toHaveBeenCalledWith({ type: 'ADD_BUDGET_CATEGORY', name: 'Travel' })
      expect(select.value).toBe('Travel')
    })

    it('cancelling the prompt (null) does not dispatch and select reverts, not stuck on placeholder', () => {
      const state: AppState = {
        ...initialState(),
        budgetCategories: ['Housing', 'Entertainment'],
      }
      const dispatch = vi.fn()
      render(<BudgetPage state={state} dispatch={dispatch} />)

      vi.spyOn(window, 'prompt').mockReturnValue(null)

      const select = screen.getByLabelText('Expense category') as HTMLSelectElement
      const prevValue = select.value
      fireEvent.change(select, { target: { value: '__add_new' } })

      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_BUDGET_CATEGORY' }))
      expect(select.value).toBe(prevValue)
      expect(select.value).not.toBe('__add_new')
    })

    it('entering whitespace-only name does not dispatch', () => {
      const state: AppState = {
        ...initialState(),
        budgetCategories: ['Housing', 'Entertainment'],
      }
      const dispatch = vi.fn()
      render(<BudgetPage state={state} dispatch={dispatch} />)

      vi.spyOn(window, 'prompt').mockReturnValue('   ')

      const select = screen.getByLabelText('Expense category') as HTMLSelectElement
      const prevValue = select.value
      fireEvent.change(select, { target: { value: '__add_new' } })

      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_BUDGET_CATEGORY' }))
      expect(select.value).toBe(prevValue)
    })
  })

  describe('category breakdown', () => {
    it('is unaffected by the expense table filterCategory (shows filtered-out categories too)', () => {
      const state: AppState = {
        ...initialState(),
        budgetExpenses: [
          makeExpense({ id: 'e1', name: 'Rent', category: 'Housing', amount: 1000 }),
          makeExpense({ id: 'e2', name: 'Netflix', category: 'Entertainment', amount: 20 }),
        ],
      }
      render(<BudgetPage state={state} dispatch={vi.fn()} />)

      fireEvent.change(screen.getByLabelText('Filter by category'), { target: { value: 'Housing' } })

      // table shows only Housing
      expect(screen.queryByText('Netflix')).toBeFalsy()

      // breakdown panel still shows both categories
      const breakdownCard = screen.getByText('Category Breakdown').closest('.card')!
      expect(within(breakdownCard as HTMLElement).getByText('Entertainment')).toBeTruthy()
      expect(within(breakdownCard as HTMLElement).getByText('Housing')).toBeTruthy()
    })

    it('bar widths are relative to the MAX category, not the total', () => {
      const state: AppState = {
        ...initialState(),
        budgetExpenses: [
          makeExpense({ id: 'e1', name: 'A', category: 'CatA', amount: 100 }),
          makeExpense({ id: 'e2', name: 'B', category: 'CatB', amount: 100 }),
          makeExpense({ id: 'e3', name: 'C', category: 'CatC', amount: 200 }),
        ],
      }
      render(<BudgetPage state={state} dispatch={vi.fn()} />)

      const breakdownCard = screen.getByText('Category Breakdown').closest('.card')!
      const bars = within(breakdownCard as HTMLElement).getAllByTestId('category-bar-fill')

      const widths = bars.map((el) => (el as HTMLElement).style.width).filter((w) => w !== '0%')
      expect(widths.sort()).toEqual(['100%', '50%', '50%'])
    })

    it('deleting a category with 0 referencing expenses does not call window.confirm and dispatches immediately', () => {
      const state: AppState = {
        ...initialState(),
        budgetCategories: ['Housing', 'Unused'],
        budgetExpenses: [makeExpense({ id: 'e1', category: 'Housing', amount: 500 })],
      }
      const dispatch = vi.fn()
      const confirmSpy = vi.spyOn(window, 'confirm')
      render(<BudgetPage state={state} dispatch={dispatch} />)

      const breakdownCard = screen.getByText('Category Breakdown').closest('.card')!
      const deleteBtn = within(breakdownCard as HTMLElement).getByLabelText('Delete category Unused')

      fireEvent.click(deleteBtn)

      expect(confirmSpy).not.toHaveBeenCalled()
      expect(dispatch).toHaveBeenCalledWith({ type: 'DELETE_BUDGET_CATEGORY', name: 'Unused' })
    })

    it('deleting a category with N referencing expenses: confirm=false does not dispatch, confirm=true dispatches', () => {
      const state: AppState = {
        ...initialState(),
        budgetExpenses: [
          makeExpense({ id: 'e1', category: 'Housing', amount: 500 }),
          makeExpense({ id: 'e2', category: 'Housing', amount: 300 }),
        ],
      }
      const dispatch = vi.fn()
      render(<BudgetPage state={state} dispatch={dispatch} />)

      const breakdownCard = screen.getByText('Category Breakdown').closest('.card')!
      const deleteBtn = within(breakdownCard as HTMLElement).getByLabelText('Delete category Housing')

      vi.spyOn(window, 'confirm').mockReturnValue(false)
      fireEvent.click(deleteBtn)
      expect(window.confirm).toHaveBeenCalledWith('Delete category "Housing"? 2 expense(s) will be moved to "Other".')
      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DELETE_BUDGET_CATEGORY' }))

      vi.spyOn(window, 'confirm').mockReturnValue(true)
      fireEvent.click(deleteBtn)
      expect(dispatch).toHaveBeenCalledWith({ type: 'DELETE_BUDGET_CATEGORY', name: 'Housing' })
    })

    it('the "Other" category breakdown row has no delete affordance', () => {
      const state: AppState = {
        ...initialState(),
        budgetExpenses: [makeExpense({ id: 'e1', category: 'Other', amount: 200 })],
      }
      render(<BudgetPage state={state} dispatch={vi.fn()} />)

      const breakdownCard = screen.getByText('Category Breakdown').closest('.card')!
      expect(within(breakdownCard as HTMLElement).queryByLabelText('Delete category Other')).toBeFalsy()
    })

    it('shows "Add expenses to see the breakdown." when budgetExpenses is empty', () => {
      const state: AppState = { ...initialState(), budgetExpenses: [] }
      render(<BudgetPage state={state} dispatch={vi.fn()} />)
      expect(screen.getByText('Add expenses to see the breakdown.')).toBeTruthy()
    })

    it('places the Expenses table and Category Breakdown as side-by-side columns in a shared grid, not stacked', () => {
      const state: AppState = {
        ...initialState(),
        budgetExpenses: [makeExpense({ id: 'e1', category: 'Housing', amount: 1000 })],
      }
      render(<BudgetPage state={state} dispatch={vi.fn()} />)

      const expensesCard = screen.getByText('Expenses', { selector: '.card-title' }).closest('.card')!
      const breakdownCard = screen.getByText('Category Breakdown').closest('.card')!
      const grid = expensesCard.parentElement!

      expect(grid).toBe(breakdownCard.parentElement)
      expect(grid.style.display).toBe('grid')
      expect(grid.style.gridTemplateColumns).toBe('1.6fr 1fr')
    })
  })
})
