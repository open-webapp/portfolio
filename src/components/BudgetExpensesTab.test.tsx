import { useReducer } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { BudgetExpensesTab } from './BudgetExpensesTab'
import { initialState, type AppState } from '../lib/state'
import { appReducer, type AppAction } from '../lib/reducer'
import type { Category } from '../lib/types'
import * as importExportModule from '../lib/importExport'

vi.mock('../lib/importExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/importExport')>()),
  downloadCsvAsFile: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const categories: Category[] = [
  { id: 'bills', name: 'Bills', updatedAt: '' },
  { id: 'housing', name: 'Housing', updatedAt: '' },
  { id: 'food', name: 'Food', updatedAt: '' },
  { id: 'travel', name: 'Travel', updatedAt: '' },
]

function renderTab(state: AppState, actions: AppAction[] = []) {
  let currentState = state

  function Harness() {
    const [renderedState, reducerDispatch] = useReducer(appReducer, state)
    currentState = renderedState
    const dispatch = (action: AppAction) => {
      actions.push(action)
      reducerDispatch(action)
    }

    return <BudgetExpensesTab state={renderedState} dispatch={dispatch} categories={categories} categoryDispatch={() => undefined} />
  }

  return { ...render(<Harness />), getState: () => currentState }
}

function downloaded() {
  return vi.mocked(importExportModule.downloadCsvAsFile)
}

describe('BudgetExpensesTab expense downloads', () => {
  it('keeps the action group ordered and the Add Expense primary class unchanged', () => {
    renderTab(initialState())

    const download = screen.getByRole('button', { name: 'Download Expenses' })
    const group = download.parentElement!
    expect(Array.from(group.querySelectorAll('button')).map((button) => button.textContent)).toEqual([
      'Download Expenses',
      'Import expenses',
      'Add Expense',
    ])
    expect(screen.getByRole('button', { name: 'Add Expense' }).className).toBe('btn btn-primary')
  })

  it('exports every definition in canonical order despite the visible filter and sort, with no transaction rows', () => {
    const currentYear = String(new Date().getFullYear())
    const state = {
      ...initialState(),
      budgetExpenseDefinitions: [
        { id: 'rent', name: 'Rent', categoryId: 'housing', frequency: 'yearly' as const },
        { id: 'guarded', name: '=HYPERLINK("bad")', categoryId: '+missing', frequency: 'monthly' as const },
      ],
      budgetExpenseAmountsByYear: {
        '2003': { rent: 100, guarded: -12 },
        '2005': { rent: 250 },
      },
      budgetTransactions: [
        { id: 'actual', date: '2001-01-01', description: 'Private actual transaction', categoryId: 'bills', amount: 9999 },
      ],
    }
    renderTab(state)

    fireEvent.change(screen.getByLabelText('Filter by category'), { target: { value: 'housing' } })
    fireEvent.click(screen.getByLabelText('Sort by category'))
    fireEvent.click(screen.getByRole('button', { name: 'Download Expenses' }))

    expect(downloaded()).toHaveBeenCalledTimes(1)
    expect(downloaded()).toHaveBeenCalledWith(
      `Name,Category,Frequency,2001,2003,2005,${currentYear}\r\n` +
        "\"'=HYPERLINK(\"\"bad\"\")\",'+missing,Monthly,,-12,,\r\n" +
        'Rent,Housing,Yearly,,100,250,\r\n',
      `expenses-${currentYear}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}.csv`
    )
    expect(downloaded().mock.calls[0][0]).not.toContain('Private actual transaction')
    expect(downloaded().mock.calls[0][0]).not.toContain('9999')
  })

  it('downloads a header-only CSV when there are no definitions', () => {
    const currentYear = String(new Date().getFullYear())
    renderTab({
      ...initialState(),
      budgetTransactions: [{ id: 'old', date: '2002-12-31', description: 'ignored', categoryId: 'bills', amount: 1 }],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Download Expenses' }))

    expect(downloaded()).toHaveBeenCalledTimes(1)
    expect(downloaded()).toHaveBeenCalledWith(
      `Name,Category,Frequency,2002,${currentYear}\r\n`,
      `expenses-${currentYear}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}.csv`
    )
  })

  it('commits focused name and amount edits before exporting them', () => {
    const year = String(new Date().getFullYear())
    const actions: AppAction[] = []
    renderTab({
      ...initialState(),
      budgetExpenseDefinitions: [{ id: 'utility', name: 'Utility', categoryId: 'bills', frequency: 'monthly' }],
      budgetExpenseAmountsByYear: { [year]: { utility: 10 } },
    }, actions)

    fireEvent.click(screen.getByText('Utility'))
    fireEvent.change(screen.getByLabelText('Edit expense name'), { target: { value: 'Committed utility' } })
    fireEvent.click(screen.getByRole('button', { name: 'Download Expenses' }))

    expect(actions).toContainEqual({ type: 'UPDATE_EXPENSE_DEFINITION', id: 'utility', patch: { name: 'Committed utility' } })
    expect(downloaded()).toHaveBeenCalledTimes(1)
    expect(downloaded()).toHaveBeenLastCalledWith(
      expect.stringContaining('Committed utility,Bills,Monthly,10\r\n'),
      expect.stringMatching(/^expenses-\d{4}-\d{2}-\d{2}\.csv$/)
    )

    downloaded().mockClear()
    fireEvent.click(screen.getByText('$10.00'))
    fireEvent.change(screen.getByLabelText(`Edit expense amount ${year}`), { target: { value: '-25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Download Expenses' }))

    expect(actions).toContainEqual({ type: 'SET_EXPENSE_AMOUNT', year, expenseId: 'utility', amount: -25 })
    expect(downloaded()).toHaveBeenCalledTimes(1)
    expect(downloaded()).toHaveBeenLastCalledWith(
      expect.stringContaining('Committed utility,Bills,Monthly,-25\r\n'),
      expect.stringMatching(/^expenses-\d{4}-\d{2}-\d{2}\.csv$/)
    )
  })

  it('does not export an Escape-cancelled inline draft', () => {
    const year = String(new Date().getFullYear())
    const actions: AppAction[] = []
    renderTab({
      ...initialState(),
      budgetExpenseDefinitions: [{ id: 'utility', name: 'Utility', categoryId: 'bills', frequency: 'monthly' }],
      budgetExpenseAmountsByYear: { [year]: { utility: 10 } },
    }, actions)

    fireEvent.click(screen.getByText('Utility'))
    fireEvent.change(screen.getByLabelText('Edit expense name'), { target: { value: '=draft formula' } })
    fireEvent.keyDown(screen.getByLabelText('Edit expense name'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Download Expenses' }))

    expect(actions).not.toContainEqual(expect.objectContaining({ type: 'UPDATE_EXPENSE_DEFINITION' }))
    expect(downloaded()).toHaveBeenCalledTimes(1)
    expect(downloaded()).toHaveBeenCalledWith(
      `Name,Category,Frequency,${year}\r\nUtility,Bills,Monthly,10\r\n`,
      expect.stringMatching(/^expenses-\d{4}-\d{2}-\d{2}\.csv$/)
    )
  })
})

describe('BudgetExpensesTab expense deletion', () => {
  it('dispatches once and removes the definition plus its amounts only', () => {
    const actions: AppAction[] = []
    const view = renderTab({
      ...initialState(),
      budgetExpenseDefinitions: [{ id: 'rent', name: 'Rent', categoryId: 'housing', frequency: 'monthly' }],
      budgetExpenseAmountsByYear: { '2024': { rent: 100 }, '2025': { rent: 200 } },
    }, actions)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    fireEvent.click(screen.getByRole('button', { name: 'Delete expense' }))

    expect(actions).toEqual([{ type: 'DELETE_EXPENSE_DEFINITION', id: 'rent' }])
    expect(view.getState().budgetExpenseDefinitions).toEqual([])
    expect(view.getState().budgetExpenseAmountsByYear).toEqual({ '2024': {}, '2025': {} })
  })

  it('dispatches once when the definition has no category mappings', () => {
    const actions: AppAction[] = []
    renderTab({
      ...initialState(),
      budgetExpenseDefinitions: [{ id: 'rent', name: 'Rent', categoryId: 'housing', frequency: 'monthly' }],
    }, actions)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    fireEvent.click(screen.getByRole('button', { name: 'Delete expense' }))

    expect(actions).toEqual([{ type: 'DELETE_EXPENSE_DEFINITION', id: 'rent' }])
  })
})

describe('BudgetExpensesTab expense summary', () => {
  const year = String(new Date().getFullYear())
  const transaction = (id: string, categoryId: string, amount: number, description = id) => ({
    id,
    date: `${year}-01-01`,
    description,
    categoryId,
    amount,
  })

  it('shows spend, average, largest transaction, and top category for the selected period', () => {
    renderTab({
      ...initialState(),
      budgetExpenseAmountsByYear: { [year]: { rent: 500 } },
      budgetTransactions: [
        transaction('rent', 'housing', -300, 'September rent'),
        transaction('groceries', 'food', -100, 'Market'),
        transaction('dining', 'food', -50, 'Lunch'),
      ],
    })

    expect(screen.getByTestId('expense-summary-spend').textContent).toContain('$450.00')
    expect(screen.getByTestId('expense-summary-average').textContent).toContain('$150.00')
    expect(screen.getByTestId('expense-summary-largest').textContent).toContain('$300.00')
    expect(screen.getByTestId('expense-summary-largest').textContent).toContain('Housing')
    expect(screen.getByTestId('expense-summary-largest').textContent).toContain('September rent')
    expect(screen.getByTestId('expense-summary-top-category').textContent).toContain('Housing · $300.00')
    expect(screen.getByTestId('expense-summary-spend-bar').style.width).toBe('90%')
    expect(screen.getByTestId('expense-summary-average-bar').style.width).toBe('50%')
    expect(screen.getByTestId('expense-summary-top-category-bar').style.width).toBe('66.66666666666666%')
  })

  it('shows zero values and empty details when the selected period has no transactions', () => {
    renderTab(initialState())

    expect(screen.getByTestId('expense-summary-spend').textContent).toContain('$0.00')
    expect(screen.getByTestId('expense-summary-average').textContent).toContain('$0.00')
    expect(screen.getByTestId('expense-summary-largest').textContent).toContain('$0.00')
    expect(screen.getAllByText('No transactions')).toHaveLength(2)
    expect(screen.getByTestId('expense-summary-average-bar').style.width).toBe('0%')
  })

  it('uses the single transaction as both the average and largest transaction', () => {
    renderTab({ ...initialState(), budgetTransactions: [transaction('coffee', 'food', -12, 'Coffee')] })

    expect(screen.getByTestId('expense-summary-average').textContent).toContain('$12.00')
    expect(screen.getByTestId('expense-summary-largest').textContent).toContain('$12.00')
    expect(screen.getByTestId('expense-summary-average-bar').style.width).toBe('100%')
  })

  it('uses absolute transaction magnitude for refunds and expenses', () => {
    renderTab({
      ...initialState(),
      budgetTransactions: [transaction('refund', 'food', 75, 'Refund'), transaction('meal', 'food', -50, 'Meal')],
    })

    expect(screen.getByTestId('expense-summary-spend').textContent).toContain('$125.00')
    expect(screen.getByTestId('expense-summary-average').textContent).toContain('$62.50')
    expect(screen.getByTestId('expense-summary-largest').textContent).toContain('$75.00')
    expect(screen.getByTestId('expense-summary-largest').textContent).toContain('Refund')
  })
})

describe('BudgetExpensesTab action items', () => {
  const year = String(new Date().getFullYear())
  const transaction = (id: string, categoryId: string, amount: number) => ({
    id,
    date: `${year}-01-01`,
    description: id,
    categoryId,
    amount,
  })

  it('shows one warning row per over-budget category with its overage and percentage', () => {
    renderTab({
      ...initialState(),
      budgetExpenseDefinitions: [
        { id: 'groceries', name: 'Groceries', categoryId: 'food', frequency: 'yearly' },
        { id: 'rent', name: 'Rent', categoryId: 'housing', frequency: 'yearly' },
      ],
      budgetExpenseAmountsByYear: { [year]: { groceries: 100, rent: 200 } },
      budgetTransactions: [
        transaction('groceries-actual', 'food', -125),
        transaction('rent-actual', 'housing', -250),
      ],
    })

    const rows = screen.getAllByTestId('expense-action-item')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('Housing is $50.00 over budget (25.0%)')
    expect(rows[0].textContent).toContain('Review recent transactions in this category')
    expect(rows[1].textContent).toContain('Food is $25.00 over budget (25.0%)')
  })

  it('orders rows by overage descending', () => {
    renderTab({
      ...initialState(),
      budgetExpenseDefinitions: [
        { id: 'groceries', name: 'Groceries', categoryId: 'food', frequency: 'yearly' },
        { id: 'rent', name: 'Rent', categoryId: 'housing', frequency: 'yearly' },
      ],
      budgetExpenseAmountsByYear: { [year]: { groceries: 100, rent: 200 } },
      budgetTransactions: [
        transaction('groceries-actual', 'food', -125),
        transaction('rent-actual', 'housing', -275),
      ],
    })

    expect(screen.getAllByTestId('expense-action-item').map((row) => row.textContent)).toEqual([
      expect.stringContaining('Housing is $75.00 over budget'),
      expect.stringContaining('Food is $25.00 over budget'),
    ])
  })

  it('shows an empty state when no category is over budget', () => {
    renderTab(initialState())

    expect(screen.getByTestId('expense-action-items').textContent).toContain('No categories over budget')
    expect(screen.queryByTestId('expense-action-item')).toBeNull()
  })
})

describe('BudgetExpensesTab category breakdown drilldown', () => {
  const year = String(new Date().getFullYear())
  const transaction = (id: string, categoryId: string, amount: number, spendExpenseId?: string) => ({
    id,
    date: `${year}-01-01`,
    description: id,
    categoryId,
    amount,
    ...(spendExpenseId ? { spendExpenseId } : {}),
  })
  const categoryRow = (name: string) => within(screen.getByTestId('category-breakdown')).getByText(name)

  it('shows linked expense lines with their budget and actual amounts', () => {
    renderTab({
      ...initialState(),
      budgetExpenseDefinitions: [
        { id: 'groceries', name: 'Groceries', categoryId: 'food', frequency: 'yearly' },
        { id: 'dining', name: 'Dining', categoryId: 'food', frequency: 'yearly' },
      ],
      budgetExpenseAmountsByYear: { [year]: { groceries: 120, dining: 80 } },
      budgetTransactions: [
        transaction('grocery-actual', 'food', -100, 'groceries'),
        transaction('dining-actual', 'food', -60, 'dining'),
      ],
    })

    fireEvent.click(categoryRow('Food'))

    expect(screen.getByText('Groceries (Yearly)')).toBeTruthy()
    expect(screen.getByText('Dining (Yearly)')).toBeTruthy()
    expect(screen.getByTestId('category-drill-line-groceries').textContent).toContain('Budget $120.00 · Actual $100.00')
    expect(screen.getByTestId('category-drill-line-dining').textContent).toContain('Budget $80.00 · Actual $60.00')
  })

  it('keeps only one category panel expanded', () => {
    renderTab({
      ...initialState(),
      budgetExpenseDefinitions: [
        { id: 'groceries', name: 'Groceries', categoryId: 'food', frequency: 'yearly' },
        { id: 'flight', name: 'Flight', categoryId: 'travel', frequency: 'yearly' },
      ],
      budgetExpenseAmountsByYear: { [year]: { groceries: 120, flight: 300 } },
    })

    fireEvent.click(categoryRow('Food'))
    expect(screen.getByText('Groceries (Yearly)')).toBeTruthy()
    fireEvent.click(categoryRow('Travel'))

    expect(screen.queryByText('Groceries (Yearly)')).toBeNull()
    expect(screen.getByText('Flight (Yearly)')).toBeTruthy()
  })

  it('collapses an expanded category when clicked again', () => {
    renderTab({
      ...initialState(),
      budgetExpenseDefinitions: [{ id: 'groceries', name: 'Groceries', categoryId: 'food', frequency: 'yearly' }],
      budgetExpenseAmountsByYear: { [year]: { groceries: 120 } },
    })

    fireEvent.click(categoryRow('Food'))
    expect(screen.getByText('Groceries (Yearly)')).toBeTruthy()
    fireEvent.click(categoryRow('Food'))
    expect(screen.queryByText('Groceries (Yearly)')).toBeNull()
  })

  it('shows unlinked transactions only for categories that have them', () => {
    renderTab({
      ...initialState(),
      budgetExpenseDefinitions: [
        { id: 'groceries', name: 'Groceries', categoryId: 'food', frequency: 'yearly' },
        { id: 'flight', name: 'Flight', categoryId: 'travel', frequency: 'yearly' },
      ],
      budgetExpenseAmountsByYear: { [year]: { groceries: 120, flight: 300 } },
      budgetTransactions: [
        transaction('grocery-actual', 'food', -100, 'groceries'),
        transaction('food-unlinked', 'food', -25),
        transaction('flight-actual', 'travel', -200, 'flight'),
      ],
    })

    fireEvent.click(categoryRow('Food'))
    expect(screen.getByText('Unlinked transactions')).toBeTruthy()
    expect(screen.getByText('$25.00')).toBeTruthy()
    fireEvent.click(categoryRow('Travel'))
    expect(screen.queryByText('Unlinked transactions')).toBeNull()
  })

  it('shows unlinked actuals instead of the empty drilldown message when no definitions exist', () => {
    renderTab({
      ...initialState(),
      budgetTransactions: [transaction('food-unlinked', 'food', -45)],
    })

    fireEvent.click(categoryRow('Food'))

    expect(screen.getByText('Unlinked transactions')).toBeTruthy()
    expect(screen.getByText('Unlinked transactions').parentElement!.textContent).toContain('$45.00')
    expect(screen.queryByText('No budget lines in this category.')).toBeNull()
  })

  it('shows the empty drilldown message when a category has no definitions or actuals', () => {
    renderTab(initialState())

    fireEvent.click(categoryRow('Food'))

    expect(screen.getByText('No budget lines in this category.')).toBeTruthy()
    expect(screen.queryByText('Unlinked transactions')).toBeNull()
  })

  it('renders Category Breakdown above action items and the Expenses table without the expense stream chart', () => {
    renderTab(initialState())

    expect(Array.from(document.querySelectorAll('.card-title')).map((element) => element.textContent)).toEqual([
      'Expense Summary',
      'Category Breakdown',
      'Action items',
      'Expenses',
    ])
    expect(screen.queryByText('Expense by category')).toBeNull()
  })
})
