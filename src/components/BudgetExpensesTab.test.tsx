import { useReducer } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
]

function renderTab(state: AppState, actions: AppAction[] = []) {
  function Harness() {
    const [currentState, reducerDispatch] = useReducer(appReducer, state)
    const dispatch = (action: AppAction) => {
      actions.push(action)
      reducerDispatch(action)
    }

    return <BudgetExpensesTab state={currentState} dispatch={dispatch} categories={categories} categoryDispatch={() => undefined} />
  }

  return render(<Harness />)
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
