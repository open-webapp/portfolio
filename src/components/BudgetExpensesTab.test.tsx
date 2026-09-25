import { useReducer } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { BudgetExpensesTab } from './BudgetExpensesTab'
import { initialState, type AppState } from '../lib/state'
import { appReducer, type AppAction } from '../lib/reducer'
import type { Category } from '../lib/types'
import * as importExportModule from '../lib/importExport'
import { expenseBudgetYears } from '../lib/selectors'
import { GAIN_COLOR, LOSS_COLOR } from '../lib/computations'

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
  { id: 'income', name: 'Income', updatedAt: '' },
]

function renderTab(state: AppState, actions: AppAction[] = [], selectedYear: string = String(new Date().getFullYear())) {
  let currentState = state

  function Harness() {
    const [renderedState, reducerDispatch] = useReducer(appReducer, state)
    currentState = renderedState
    const dispatch = (action: AppAction) => {
      actions.push(action)
      reducerDispatch(action)
    }

    return (
      <BudgetExpensesTab
        state={renderedState}
        dispatch={dispatch}
        categories={categories}
        categoryDispatch={() => undefined}
        selectedYear={selectedYear}
      />
    )
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

    fireEvent.click(screen.getByText('Utility', { selector: 'td' }))
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

    fireEvent.click(screen.getByText('Utility', { selector: 'td' }))
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

describe('BudgetExpensesTab 3 fixed year columns', () => {
  it('shows exactly the selected year +/- 1 as header columns, ignoring far-off data years', () => {
    renderTab(
      {
        ...initialState(),
        budgetExpenseDefinitions: [{ id: 'rent', name: 'Rent', categoryId: 'housing', frequency: 'monthly' }],
        budgetExpenseAmountsByYear: { '2020': { rent: 5 }, '2030': { rent: 6 } },
      },
      [],
      '2026'
    )

    const headerRow = screen.getAllByRole('columnheader')
    const headerTexts = headerRow.map((cell) => cell.textContent)
    expect(headerTexts).toContain('2025')
    expect(headerTexts).toContain('2026')
    expect(headerTexts).toContain('2027')
    expect(headerTexts).not.toContain('2020')
    expect(headerTexts).not.toContain('2030')
    const yearHeaders = headerTexts.filter((text) => /^\d{4}$/.test(text ?? ''))
    expect(yearHeaders).toEqual(['2025', '2026', '2027'])
  })

  it('renders exactly 3 amount columns of dashes when there is no expense data anywhere', () => {
    renderTab({ ...initialState(), budgetExpenseDefinitions: [{ id: 'rent', name: 'Rent', categoryId: 'housing', frequency: 'monthly' }] }, [], '2026')

    const dashCells = screen.getAllByText('—')
    expect(dashCells).toHaveLength(3)
  })

  it('edits the 2027 amount cell for the selected year 2026 and dispatches SET_EXPENSE_AMOUNT for 2027', () => {
    const actions: AppAction[] = []
    const view = renderTab(
      {
        ...initialState(),
        budgetExpenseDefinitions: [{ id: 'rent', name: 'Rent', categoryId: 'housing', frequency: 'monthly' }],
      },
      actions,
      '2026'
    )

    const dashCells = screen.getAllByText('—')
    fireEvent.click(dashCells[2])
    fireEvent.change(screen.getByLabelText('Edit expense amount 2027'), { target: { value: '50' } })
    fireEvent.keyDown(screen.getByLabelText('Edit expense amount 2027'), { key: 'Enter' })

    expect(actions).toContainEqual({ type: 'SET_EXPENSE_AMOUNT', year: '2027', expenseId: 'rent', amount: 50 })
    expect(view.getState().budgetExpenseAmountsByYear['2027']).toEqual({ rent: 50 })
    expect(expenseBudgetYears(view.getState().budgetExpenseAmountsByYear, new Date('2026-06-01'))).toContain('2027')
  })

  it('clears a 2027 amount cell back to blank and dispatches CLEAR_EXPENSE_AMOUNT for 2027', () => {
    const actions: AppAction[] = []
    renderTab(
      {
        ...initialState(),
        budgetExpenseDefinitions: [{ id: 'rent', name: 'Rent', categoryId: 'housing', frequency: 'monthly' }],
        budgetExpenseAmountsByYear: { '2027': { rent: 75 } },
      },
      actions,
      '2026'
    )

    fireEvent.click(screen.getByText('$75.00'))
    fireEvent.change(screen.getByLabelText('Edit expense amount 2027'), { target: { value: '' } })
    fireEvent.keyDown(screen.getByLabelText('Edit expense amount 2027'), { key: 'Enter' })

    expect(actions).toContainEqual({ type: 'CLEAR_EXPENSE_AMOUNT', year: '2027', expenseId: 'rent' })
  })
})

describe('BudgetExpensesTab plan stat cards', () => {
  const spendDefs = [
    { id: 'rent', name: 'Rent', categoryId: 'housing', frequency: 'yearly' as const },
    { id: 'internet', name: 'Internet', categoryId: 'bills', frequency: 'monthly' as const },
  ]

  it('shows exact planned spend annual/monthly totals and a colored YoY delta vs the prior year', () => {
    renderTab(
      {
        ...initialState(),
        budgetExpenseDefinitions: spendDefs,
        budgetExpenseAmountsByYear: {
          '2026': { rent: 1200, internet: 50 },
          '2025': { rent: 1000, internet: 40 },
        },
      },
      [],
      '2026'
    )

    const card = screen.getByTestId('plan-stat-spend')
    expect(card.textContent).toContain('Planned spend')
    expect(card.textContent).toContain('$1,800.00/yr')
    expect(card.textContent).toContain('$150.00/mo')
    expect(card.textContent).toContain('+$320.00 (+21.62%) vs 2025')
    expect(card.querySelector('button')).toBeNull()
  })

  it('colors the spend delta green when planned spend decreased vs the prior year', () => {
    renderTab(
      {
        ...initialState(),
        budgetExpenseDefinitions: spendDefs,
        budgetExpenseAmountsByYear: {
          '2026': { rent: 800, internet: 40 },
          '2025': { rent: 1200, internet: 50 },
        },
      },
      [],
      '2026'
    )

    const card = screen.getByTestId('plan-stat-spend')
    expect(card.textContent).toContain('-$520.00 (-28.89%) vs 2025')
  })

  it('shows "No prior-year plan" with no $/% delta when there is no prior-year data', () => {
    renderTab(
      {
        ...initialState(),
        budgetExpenseDefinitions: spendDefs,
        budgetExpenseAmountsByYear: { '2026': { rent: 1200, internet: 50 } },
      },
      [],
      '2026'
    )

    const card = screen.getByTestId('plan-stat-spend')
    expect(card.textContent).toContain('No prior-year plan')
    expect(card.textContent).not.toContain('vs 2025')
    expect(card.textContent).not.toMatch(/[+-]\$/)
  })

  it('shows a $ delta with no percentage when the prior year annual total was zero', () => {
    renderTab(
      {
        ...initialState(),
        budgetExpenseDefinitions: spendDefs,
        budgetExpenseAmountsByYear: {
          '2026': { rent: 1200, internet: 50 },
          '2025': { rent: 0, internet: 0 },
        },
      },
      [],
      '2026'
    )

    const card = screen.getByTestId('plan-stat-spend')
    expect(card.textContent).toContain('+$1,800.00 vs 2025')
    expect(card.textContent).not.toContain('%')
  })

  it('shows exact planned savings rate, income and spend, plus a bar with the clamped width', () => {
    renderTab(
      {
        ...initialState(),
        budgetExpenseDefinitions: [...spendDefs, { id: 'salary', name: 'Salary', categoryId: 'income', frequency: 'monthly' as const }],
        budgetExpenseAmountsByYear: {
          '2026': { rent: 1200, internet: 50, salary: 5000 },
        },
      },
      [],
      '2026'
    )

    const card = screen.getByTestId('plan-stat-savings')
    expect(card.textContent).toContain('Planned savings rate')
    expect(card.textContent).toContain('97.0%')
    expect(card.textContent).toContain('$60,000.00 income')
    expect(card.textContent).toContain('$1,800.00 spend')
    const bar = screen.getByTestId('plan-stat-savings-bar')
    expect(bar.style.width).toBe('97%')
    expect(card.querySelector('button')).toBeNull()
  })

  it('shows "No income planned" and renders no bar when there is no income planned', () => {
    renderTab(
      {
        ...initialState(),
        budgetExpenseDefinitions: spendDefs,
        budgetExpenseAmountsByYear: { '2026': { rent: 1200, internet: 50 } },
      },
      [],
      '2026'
    )

    const card = screen.getByTestId('plan-stat-savings')
    expect(card.textContent).toContain('No income planned')
    expect(screen.queryByTestId('plan-stat-savings-bar')).toBeNull()
  })

  it('re-derives both cards when selectedYear changes, rather than staying stale', () => {
    const state = {
      ...initialState(),
      budgetExpenseDefinitions: [...spendDefs, { id: 'salary', name: 'Salary', categoryId: 'income', frequency: 'monthly' as const }],
      budgetExpenseAmountsByYear: {
        '2026': { rent: 1200, internet: 50, salary: 5000 },
        '2027': { rent: 2400, internet: 100, salary: 1000 },
      },
    }

    function Wrapper({ year }: { year: string }) {
      return (
        <BudgetExpensesTab
          state={state}
          dispatch={() => undefined}
          categories={categories}
          categoryDispatch={() => undefined}
          selectedYear={year}
        />
      )
    }

    const { rerender } = render(<Wrapper year="2026" />)
    expect(screen.getByTestId('plan-stat-spend').textContent).toContain('$1,800.00/yr')
    expect(screen.getByTestId('plan-stat-savings').textContent).toContain('97.0%')

    rerender(<Wrapper year="2027" />)
    expect(screen.getByTestId('plan-stat-spend').textContent).toContain('$3,600.00/yr')
    expect(screen.getByTestId('plan-stat-savings').textContent).not.toContain('97.0%')
  })

  it('renders no plan-stats-cards testid collision with the Spend tab summary-cards testid', () => {
    renderTab(initialState())
    expect(screen.getByTestId('plan-stats-cards')).toBeTruthy()
    expect(screen.queryByTestId('summary-cards')).toBeNull()
  })

  it('does not dispatch anything from rendering the stat cards', () => {
    const actions: AppAction[] = []
    renderTab(
      {
        ...initialState(),
        budgetExpenseDefinitions: [...spendDefs, { id: 'salary', name: 'Salary', categoryId: 'income', frequency: 'monthly' as const }],
        budgetExpenseAmountsByYear: { '2026': { rent: 1200, internet: 50, salary: 5000 } },
      },
      actions,
      '2026'
    )

    expect(actions).toHaveLength(0)
  })
})

describe('BudgetExpensesTab plan stat cards 3-4 (frequency split, plan changes)', () => {
  it('shows exact monthly/yearly/set-aside totals for card 3', () => {
    renderTab(
      {
        ...initialState(),
        budgetExpenseDefinitions: [
          { id: 'internet', name: 'Internet', categoryId: 'bills', frequency: 'monthly' as const },
          { id: 'insurance', name: 'Insurance', categoryId: 'housing', frequency: 'yearly' as const },
        ],
        budgetExpenseAmountsByYear: { '2026': { internet: 60, insurance: 1200 } },
      },
      [],
      '2026'
    )

    const card = screen.getByTestId('plan-stat-frequency')
    expect(card.textContent).toContain('Monthly vs yearly')
    expect(card.textContent).toContain('$60.00/mo')
    expect(card.textContent).toContain('$1,200.00/yr')
    expect(card.textContent).toContain('$100.00/mo')
  })

  it('renders only the top 3 increase rows, largest delta first', () => {
    renderTab(
      {
        ...initialState(),
        budgetExpenseDefinitions: [
          { id: 'a', name: 'Alpha', categoryId: 'bills', frequency: 'monthly' as const },
          { id: 'b', name: 'Bravo', categoryId: 'bills', frequency: 'monthly' as const },
          { id: 'c', name: 'Charlie', categoryId: 'bills', frequency: 'monthly' as const },
          { id: 'd', name: 'Delta', categoryId: 'bills', frequency: 'monthly' as const },
          { id: 'e', name: 'Echo', categoryId: 'bills', frequency: 'monthly' as const },
        ],
        budgetExpenseAmountsByYear: {
          '2025': { a: 10, b: 10, c: 10, d: 10, e: 10 },
          '2026': { a: 100, b: 90, c: 80, d: 70, e: 60 },
        },
      },
      [],
      '2026'
    )

    const rows = screen.getAllByTestId('plan-change-increase')
    expect(rows).toHaveLength(3)
    expect(rows[0].textContent).toContain('Alpha')
    expect(rows[1].textContent).toContain('Bravo')
    expect(rows[2].textContent).toContain('Charlie')
  })

  it('tags a brand-new line as "new" and a fully-dropped line as "dropped"', () => {
    renderTab(
      {
        ...initialState(),
        budgetExpenseDefinitions: [
          { id: 'newone', name: 'New One', categoryId: 'bills', frequency: 'monthly' as const },
          { id: 'droppedone', name: 'Dropped One', categoryId: 'bills', frequency: 'monthly' as const },
        ],
        budgetExpenseAmountsByYear: {
          '2025': { droppedone: 50 },
          '2026': { newone: 40 },
        },
      },
      [],
      '2026'
    )

    const increaseRow = screen.getByTestId('plan-change-increase')
    expect(increaseRow.textContent).toContain('New One')
    expect(increaseRow.textContent).toContain('new')

    const decreaseRow = screen.getByTestId('plan-change-decrease')
    expect(decreaseRow.textContent).toContain('Dropped One')
    expect(decreaseRow.textContent).toContain('dropped')
  })

  it('shows notCarriedOver text with names listed when count > 0, and "All lines carried over" when count is 0', () => {
    const { rerender } = renderTab(
      {
        ...initialState(),
        budgetExpenseDefinitions: [{ id: 'gone', name: 'Gone Expense', categoryId: 'bills', frequency: 'monthly' as const }],
        budgetExpenseAmountsByYear: { '2025': { gone: 20 } },
      },
      [],
      '2026'
    )
    expect(screen.getByTestId('plan-stat-not-carried').textContent).toBe('1 lines not carried over: Gone Expense')

    rerender(
      <BudgetExpensesTab
        state={{
          ...initialState(),
          budgetExpenseDefinitions: [{ id: 'gone', name: 'Gone Expense', categoryId: 'bills', frequency: 'monthly' as const }],
          budgetExpenseAmountsByYear: { '2025': { gone: 20 }, '2026': { gone: 25 } },
        }}
        dispatch={() => undefined}
        categories={categories}
        categoryDispatch={() => undefined}
        selectedYear="2026"
      />
    )
    expect(screen.getByTestId('plan-stat-not-carried').textContent).toBe('All lines carried over')
  })

  it('never lists an income-category definition in card 4, even if it qualifies numerically', () => {
    renderTab(
      {
        ...initialState(),
        budgetExpenseDefinitions: [{ id: 'salary', name: 'Salary', categoryId: 'income', frequency: 'monthly' as const }],
        budgetExpenseAmountsByYear: { '2025': { salary: 1000 }, '2026': { salary: 5000 } },
      },
      [],
      '2026'
    )

    const changesCard = screen.getByTestId('plan-stat-changes')
    expect(changesCard.textContent).not.toContain('Salary')
    expect(changesCard.textContent).toContain('No changes')
    expect(changesCard.textContent).toContain('All lines carried over')
  })

  it('still lists an excludeFromSpend-category definition in card 4 (planned figures unaffected by excludeFromSpend)', () => {
    const excludeCategories: Category[] = [...categories, { id: 'excl', name: 'Excluded', updatedAt: '', excludeFromSpend: true }]

    function Wrapper() {
      return (
        <BudgetExpensesTab
          state={{
            ...initialState(),
            budgetExpenseDefinitions: [{ id: 'transfer', name: 'Transfer Out', categoryId: 'excl', frequency: 'monthly' as const }],
            budgetExpenseAmountsByYear: { '2025': { transfer: 10 }, '2026': { transfer: 50 } },
          }}
          dispatch={() => undefined}
          categories={excludeCategories}
          categoryDispatch={() => undefined}
          selectedYear="2026"
        />
      )
    }

    render(<Wrapper />)
    const changesCard = screen.getByTestId('plan-stat-changes')
    expect(changesCard.textContent).toContain('Transfer Out')
  })

  it('renders exactly 4 stat cards total inside plan-stats-cards', () => {
    renderTab(initialState())
    const grid = screen.getByTestId('plan-stats-cards')
    expect(grid.querySelectorAll('.card')).toHaveLength(4)
  })

  it('colors increase rows with LOSS_COLOR and decrease rows with GAIN_COLOR', () => {
    renderTab(
      {
        ...initialState(),
        budgetExpenseDefinitions: [
          { id: 'up', name: 'Up Expense', categoryId: 'bills', frequency: 'monthly' as const },
          { id: 'down', name: 'Down Expense', categoryId: 'bills', frequency: 'monthly' as const },
        ],
        budgetExpenseAmountsByYear: {
          '2025': { up: 10, down: 50 },
          '2026': { up: 30, down: 20 },
        },
      },
      [],
      '2026'
    )

    const normalize = (hex: string) => {
      const probe = document.createElement('div')
      probe.style.color = hex
      return probe.style.color
    }

    const increaseRow = screen.getByTestId('plan-change-increase')
    const decreaseRow = screen.getByTestId('plan-change-decrease')
    const increaseSpan = Array.from(increaseRow.querySelectorAll('span')).find((el) => (el as HTMLElement).style.color)
    const decreaseSpan = Array.from(decreaseRow.querySelectorAll('span')).find((el) => (el as HTMLElement).style.color)
    expect(increaseSpan && (increaseSpan as HTMLElement).style.color).toBe(normalize(LOSS_COLOR))
    expect(decreaseSpan && (decreaseSpan as HTMLElement).style.color).toBe(normalize(GAIN_COLOR))
  })
})

describe('BudgetExpensesTab regression guards', () => {
  const transaction = (id: string, categoryId: string, amount: number, spendExpenseId?: string) => ({
    id,
    date: `${String(new Date().getFullYear())}-01-01`,
    description: id,
    categoryId,
    amount,
    ...(spendExpenseId ? { spendExpenseId } : {}),
  })

  it('does not render Category Breakdown', () => {
    renderTab(initialState())

    expect(screen.queryByTestId('category-breakdown')).toBeNull()
    expect(screen.queryByText('Category Breakdown')).toBeNull()
    expect(screen.queryByLabelText('Select breakdown year')).toBeNull()
  })

  it('never renders the Expense Summary or Action items cards, even with data that would previously populate them', () => {
    const year = String(new Date().getFullYear())
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

    expect(screen.queryByTestId('summary-cards')).toBeNull()
  })
})
