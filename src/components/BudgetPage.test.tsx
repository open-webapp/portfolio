import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { BudgetPage } from './BudgetPage'
import { initialState, type AppState } from '../lib/state'
import type { ExpenseDefinition, BudgetTransaction, Category, CategoryMapping } from '../lib/types'
import { GAIN_COLOR, LOSS_COLOR, fmtUSD } from '../lib/computations'

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
]

function defaultState(overrides: Partial<AppState> = {}): AppState {
  return { ...initialState(), ...overrides }
}

function makeDefinition(overrides: Partial<ExpenseDefinition> = {}): ExpenseDefinition {
  return {
    id: overrides.id ?? `exp-${Math.random()}`,
    name: overrides.name ?? 'Rent',
    categoryId: overrides.categoryId ?? 'cat-housing',
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

function switchTab(container: HTMLElement, label: 'Expenses' | 'Spend' | 'Analytics') {
  fireEvent.click(within(container.querySelector('.seg')!).getByText(label))
}

describe('BudgetPage', () => {
  describe('tab plumbing', () => {
    it('renders 3 tabs labelled Expenses/Spend/Analytics, Spend checked by default', () => {
      const { container } = renderBudgetPage()
      const seg = container.querySelector('.seg')!
      const radios = seg.querySelectorAll('input[type="radio"]')
      expect(radios.length).toBe(3)
      expect(within(seg).getByText('Expenses')).toBeTruthy()
      expect(within(seg).getByText('Spend')).toBeTruthy()
      expect(within(seg).getByText('Analytics')).toBeTruthy()
      expect((radios[1] as HTMLInputElement).checked).toBe(true) // Spend is default
    })

    it('clicking Expenses switches to the Expenses tab', () => {
      const { container } = renderBudgetPage()
      switchTab(container, 'Expenses')
      expect(screen.getByText('Category Breakdown')).toBeTruthy()
    })

    it('no Monthly option exists anywhere in the tab toggle', () => {
      const { container } = renderBudgetPage()
      const seg = container.querySelector('.seg')!
      expect(within(seg).queryByText('Monthly')).toBeFalsy()
    })
  })

  describe('Spend tab', () => {
    it('renders 4 summary cards computed from budgetExpenseAmountsByYear/budgetIncomeByYear/collapsed income', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-03-15T00:00:00'))
      const state = defaultState({
        budgetExpenseDefinitions: [
          makeDefinition({ id: 'e1', categoryId: 'cat-housing' }),
          makeDefinition({ id: 'e2', categoryId: 'cat-food' }),
        ],
        budgetExpenseAmountsByYear: { '2025': { e1: 1000, e2: 400 } },
        budgetIncomeByYear: { '2025': 6000 },
        budgetTransactions: [
          makeTransaction({ date: '2025-03-05', categoryId: 'cat-housing', amount: 300 }),
          makeTransaction({ date: '2025-03-20', categoryId: 'cat-housing', amount: 150 }),
        ],
      })
      const { container } = render(
        <BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />
      )
      const summary = container.querySelector('[data-testid="summary-cards"]') as HTMLElement
      expect(within(summary).getByText('Income')).toBeTruthy()
      expect(within(summary).getByText('$6,000.00')).toBeTruthy()
      expect(within(summary).getByText('Budgeted')).toBeTruthy()
      expect(within(summary).getByText('$1,400.00')).toBeTruthy()
      expect(within(summary).getByText('Actual spend (2025)')).toBeTruthy()
      expect(within(summary).getByText('$450.00')).toBeTruthy()
      expect(within(summary).getByText('Variance')).toBeTruthy()
      expect(within(summary).getByText('$950.00')).toBeTruthy()
      vi.useRealTimers()
    })

    it('shows GAIN_COLOR when budgeted >= actual and LOSS_COLOR when budgeted < actual', () => {
      const state = defaultState({
        budgetExpenseDefinitions: [makeDefinition({ id: 'e1' })],
        budgetExpenseAmountsByYear: { '2025': { e1: 1000 } },
        budgetTransactions: [],
      })
      const { container } = render(
        <BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />
      )
      fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '2025' } })
      const summary = container.querySelector('[data-testid="summary-cards"]') as HTMLElement
      const varianceValue = within(summary).getByText('Variance').nextElementSibling as HTMLElement
      expect(varianceValue.style.color).toBe(hexToRgb(GAIN_COLOR))

      const stateLoss = defaultState({
        budgetExpenseDefinitions: [makeDefinition({ id: 'e1' })],
        budgetExpenseAmountsByYear: { '2025': { e1: 100 } },
        budgetTransactions: [makeTransaction({ date: '2025-03-05', amount: 500 })],
      })
      cleanup()
      const { container: container2 } = render(
        <BudgetPage state={stateLoss} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />
      )
      fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '2025' } })
      const summary2 = container2.querySelector('[data-testid="summary-cards"]') as HTMLElement
      const varianceValue2 = within(summary2).getByText('Variance').nextElementSibling as HTMLElement
      expect(varianceValue2.style.color).toBe(hexToRgb(LOSS_COLOR))
    })

    it('has no Category Breakdown / Expense table', () => {
      renderBudgetPage()
      expect(screen.queryByText('Category Breakdown')).toBeFalsy()
      expect(screen.queryByText('Add Expense')).toBeFalsy()
    })

    it('SpendCategoryPicker shows all definitions including ones with no amount set for the selected year', () => {
      const state = defaultState({
        budgetExpenseDefinitions: [makeDefinition({ id: 'e1', name: 'Rent', categoryId: 'cat-housing' })],
        budgetExpenseAmountsByYear: {}, // no amount set for any year
        budgetTransactions: [makeTransaction({ date: '2025-03-05' })],
      })
      renderBudgetPage({ state })
      fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '2025' } })
      const picker = screen.getByLabelText('Record spend category') as HTMLSelectElement
      expect(within(picker).getByText('Rent (Housing)')).toBeTruthy()
    })

    it('editing income dispatches SET_BUDGET_INCOME with a plain amount (no monthly/yearly patch)', () => {
      const dispatch = vi.fn()
      const state = defaultState({ budgetTransactions: [makeTransaction({ date: '2025-03-05' })] })
      renderBudgetPage({ state, dispatch })
      fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '2025' } })
      fireEvent.click(screen.getByLabelText('Edit income'))
      const incomeInput = screen.getByLabelText('Income amount')
      fireEvent.change(incomeInput, { target: { value: '5000' } })
      fireEvent.keyDown(incomeInput, { key: 'Enter' })
      expect(dispatch).toHaveBeenCalledWith({ type: 'SET_BUDGET_INCOME', year: '2025', amount: 5000 })
    })

    it('switching to a year with no amounts snapshot dispatches ENSURE_BUDGET_YEAR_SNAPSHOT', () => {
      const dispatch = vi.fn()
      const state = defaultState({
        budgetExpenseAmountsByYear: { '2024': { e1: 100 } },
        budgetTransactions: [makeTransaction({ date: '2026-01-01' })],
      })
      renderBudgetPage({ state, dispatch })
      fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '2026' } })
      expect(dispatch).toHaveBeenCalledWith({ type: 'ENSURE_BUDGET_YEAR_SNAPSHOT', year: '2026' })
    })
  })

  describe('Expenses tab', () => {
    it('renders Category Breakdown above the Expense table', () => {
      const state = defaultState({
        budgetExpenseDefinitions: [makeDefinition({ id: 'e1', name: 'Rent' })],
        budgetExpenseAmountsByYear: { '2025': { e1: 1000 } },
      })
      const { container } = render(
        <BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />
      )
      switchTab(container, 'Expenses')
      const cards = container.querySelectorAll('.card.blueprint')
      const breakdownIdx = Array.from(cards).findIndex((c) => c.textContent?.includes('Category Breakdown'))
      const expensesIdx = Array.from(cards).findIndex((c) => c.textContent?.includes('Add Expense'))
      expect(breakdownIdx).toBeGreaterThanOrEqual(0)
      expect(expensesIdx).toBeGreaterThan(breakdownIdx)
    })

    it('Breakdown year selector is independent from the Spend tab year', () => {
      const state = defaultState({
        budgetExpenseDefinitions: [makeDefinition({ id: 'e1' })],
        budgetExpenseAmountsByYear: { '2024': { e1: 500 }, '2025': { e1: 1000 } },
        budgetTransactions: [makeTransaction({ date: '2024-01-01' }), makeTransaction({ date: '2025-01-01' })],
      })
      const { container } = render(
        <BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />
      )
      // Spend tab year selector defaults independent of breakdown year.
      fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '2024' } })
      switchTab(container, 'Expenses')
      const breakdownSelect = screen.getByLabelText('Select breakdown year') as HTMLSelectElement
      fireEvent.change(breakdownSelect, { target: { value: '2025' } })
      expect(breakdownSelect.value).toBe('2025')
      switchTab(container, 'Spend')
      expect((screen.getByLabelText('Select year') as HTMLSelectElement).value).toBe('2024')
    })

    it('Expense table shows a column per year in the union set, including the current year even with no data', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-01T00:00:00'))
      const state = defaultState({
        budgetExpenseDefinitions: [makeDefinition({ id: 'e1', name: 'Rent' })],
        budgetExpenseAmountsByYear: { '2024': { e1: 500 } },
        budgetTransactions: [makeTransaction({ date: '2023-01-01' })],
      })
      const { container } = render(
        <BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />
      )
      switchTab(container, 'Expenses')
      const headers = Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent)
      expect(headers).toContain('2023')
      expect(headers).toContain('2024')
      expect(headers).toContain('2026') // real current year, always present
      vi.useRealTimers()
    })

    it('editing an Amount cell in year Y only changes that year (SET_EXPENSE_AMOUNT scoped to one year)', () => {
      const dispatch = vi.fn()
      const state = defaultState({
        budgetExpenseDefinitions: [makeDefinition({ id: 'e1', name: 'Rent' })],
        budgetExpenseAmountsByYear: { '2024': { e1: 500 }, '2025': { e1: 1000 } },
        budgetTransactions: [makeTransaction({ date: '2024-01-01' }), makeTransaction({ date: '2025-01-01' })],
      })
      const { container } = render(
        <BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />
      )
      switchTab(container, 'Expenses')
      const row = screen.getByText('Rent').closest('tr')!
      fireEvent.click(within(row).getByText(fmtUSD(500)))
      const input = screen.getByLabelText('Edit expense amount 2024') as HTMLInputElement
      expect(input.value).toBe('500')
      fireEvent.change(input, { target: { value: '600' } })
      fireEvent.blur(input)
      expect(dispatch).toHaveBeenCalledWith({ type: 'SET_EXPENSE_AMOUNT', year: '2024', expenseId: 'e1', amount: 600 })
      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ year: '2025', type: 'SET_EXPENSE_AMOUNT' }))
    })

    it('clearing an Amount cell (blank on commit) dispatches CLEAR_EXPENSE_AMOUNT for just that year', () => {
      const dispatch = vi.fn()
      const state = defaultState({
        budgetExpenseDefinitions: [makeDefinition({ id: 'e1', name: 'Rent' })],
        budgetExpenseAmountsByYear: { '2024': { e1: 500 } },
        budgetTransactions: [makeTransaction({ date: '2024-01-01' })],
      })
      const { container } = render(
        <BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />
      )
      switchTab(container, 'Expenses')
      const row = screen.getByText('Rent').closest('tr')!
      fireEvent.click(within(row).getByText(fmtUSD(500)))
      const input = screen.getByLabelText('Edit expense amount 2024') as HTMLInputElement
      fireEvent.change(input, { target: { value: '' } })
      fireEvent.blur(input)
      expect(dispatch).toHaveBeenCalledWith({ type: 'CLEAR_EXPENSE_AMOUNT', year: '2024', expenseId: 'e1' })
    })

    it('pressing Escape on an Amount cell reverts without dispatching', () => {
      const dispatch = vi.fn()
      const state = defaultState({
        budgetExpenseDefinitions: [makeDefinition({ id: 'e1', name: 'Rent' })],
        budgetExpenseAmountsByYear: { '2024': { e1: 500 } },
        budgetTransactions: [makeTransaction({ date: '2024-01-01' })],
      })
      const { container } = render(
        <BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />
      )
      switchTab(container, 'Expenses')
      const row = screen.getByText('Rent').closest('tr')!
      fireEvent.click(within(row).getByText(fmtUSD(500)))
      const input = screen.getByLabelText('Edit expense amount 2024') as HTMLInputElement
      fireEvent.change(input, { target: { value: '9999' } })
      fireEvent.keyDown(input, { key: 'Escape' })
      expect(dispatch).not.toHaveBeenCalled()
    })

    it('editing Name changes the value visible under every year column (shared definition)', () => {
      const dispatch = vi.fn()
      const state = defaultState({
        budgetExpenseDefinitions: [makeDefinition({ id: 'e1', name: 'Rent' })],
        budgetExpenseAmountsByYear: { '2024': { e1: 500 }, '2025': { e1: 1000 } },
        budgetTransactions: [makeTransaction({ date: '2024-01-01' }), makeTransaction({ date: '2025-01-01' })],
      })
      const { container } = render(
        <BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />
      )
      switchTab(container, 'Expenses')
      fireEvent.click(screen.getByText('Rent'))
      const nameInput = screen.getByLabelText('Edit expense name') as HTMLInputElement
      fireEvent.change(nameInput, { target: { value: 'Rent 2' } })
      fireEvent.blur(nameInput)
      expect(dispatch).toHaveBeenCalledWith({ type: 'UPDATE_EXPENSE_DEFINITION', id: 'e1', patch: { name: 'Rent 2' } })
    })

    it('editing Category/Frequency dispatches UPDATE_EXPENSE_DEFINITION (affects all years)', () => {
      const dispatch = vi.fn()
      const state = defaultState({
        budgetExpenseDefinitions: [makeDefinition({ id: 'e1', name: 'Rent', categoryId: 'cat-housing', frequency: 'monthly' })],
        budgetExpenseAmountsByYear: { '2025': { e1: 1000 } },
      })
      const { container } = render(
        <BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />
      )
      switchTab(container, 'Expenses')
      const row = screen.getByText('Rent').closest('tr')!
      fireEvent.click(within(row).getByText('Housing'))
      const categorySelect = screen.getByLabelText('Edit expense category') as HTMLSelectElement
      fireEvent.change(categorySelect, { target: { value: 'cat-food' } })
      expect(dispatch).toHaveBeenCalledWith({ type: 'UPDATE_EXPENSE_DEFINITION', id: 'e1', patch: { categoryId: 'cat-food' } })

      fireEvent.click(within(row).getByText('Monthly', { selector: 'td' }))
      const freqSelect = screen.getByLabelText('Edit expense frequency') as HTMLSelectElement
      fireEvent.change(freqSelect, { target: { value: 'yearly' } })
      expect(dispatch).toHaveBeenCalledWith({ type: 'UPDATE_EXPENSE_DEFINITION', id: 'e1', patch: { frequency: 'yearly' } })
    })

    it('Add Expense dispatches ADD_EXPENSE_DEFINITION, seeding only the current real year', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-05-01T00:00:00'))
      const dispatch = vi.fn()
      const { container } = renderBudgetPage({ dispatch })
      switchTab(container, 'Expenses')
      fireEvent.click(screen.getByText('Add Expense'))
      fireEvent.change(screen.getByLabelText('Expense name'), { target: { value: 'Gym' } })
      fireEvent.change(screen.getByLabelText('Expense amount'), { target: { value: '50' } })
      fireEvent.change(screen.getByLabelText('Expense frequency'), { target: { value: 'yearly' } })
      fireEvent.click(screen.getByText('Add'))
      expect(dispatch).toHaveBeenCalledWith({
        type: 'ADD_EXPENSE_DEFINITION',
        definition: { name: 'Gym', categoryId: 'cat-housing', frequency: 'yearly' },
        amount: 50,
      })
      vi.useRealTimers()
    })

    it('Delete is blocked with an alert when a transaction in a DIFFERENT year references the expense', () => {
      const dispatch = vi.fn()
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      const state = defaultState({
        budgetExpenseDefinitions: [makeDefinition({ id: 'e1', name: 'Rent' })],
        budgetExpenseAmountsByYear: { '2025': { e1: 1000 } },
        budgetTransactions: [makeTransaction({ id: 't1', date: '2020-01-01', spendExpenseId: 'e1' })],
      })
      const { container } = render(
        <BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />
      )
      switchTab(container, 'Expenses')
      fireEvent.click(screen.getByLabelText('Delete expense'))
      expect(alertSpy).toHaveBeenCalledWith('Cannot delete: this expense is used by a Spend record in at least one year.')
      expect(confirmSpy).not.toHaveBeenCalled()
      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DELETE_EXPENSE_DEFINITION' }))
    })

    it('Delete succeeds and removes all years amounts when unreferenced', () => {
      const dispatch = vi.fn()
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      const state = defaultState({
        budgetExpenseDefinitions: [makeDefinition({ id: 'e1', name: 'Rent' })],
        budgetExpenseAmountsByYear: { '2025': { e1: 1000 } },
        budgetTransactions: [],
      })
      const { container } = render(
        <BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />
      )
      switchTab(container, 'Expenses')
      fireEvent.click(screen.getByLabelText('Delete expense'))
      expect(dispatch).toHaveBeenCalledWith({ type: 'DELETE_EXPENSE_DEFINITION', id: 'e1' })
    })

    it('Deleting an ExpenseDefinition with linked CategoryMappings dispatches both deletes', () => {
      const dispatch = vi.fn()
      const categoryDispatch = vi.fn()
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      const state = defaultState({
        budgetExpenseDefinitions: [makeDefinition({ id: 'e1', name: 'Rent' })],
        budgetExpenseAmountsByYear: { '2025': { e1: 1000 } },
        budgetTransactions: [],
      })
      const categoryMappings: CategoryMapping[] = [
        { id: 'm1', substring: 'rent', spendExpenseId: 'e1', updatedAt: CATEGORY_UPDATED_AT },
        { id: 'm2', substring: 'landlord', spendExpenseId: 'e1', updatedAt: CATEGORY_UPDATED_AT },
      ]
      const { container } = render(
        <BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={categoryMappings} categoryDispatch={categoryDispatch} />
      )
      switchTab(container, 'Expenses')
      fireEvent.click(screen.getByLabelText('Delete expense'))
      expect(dispatch).toHaveBeenCalledWith({ type: 'DELETE_EXPENSE_DEFINITION', id: 'e1' })
      expect(categoryDispatch).toHaveBeenCalledWith({ type: 'DELETE_CATEGORY_MAPPINGS_FOR_EXPENSE', spendExpenseId: 'e1' })
    })

    it('Deleting an ExpenseDefinition with zero linked mappings still dispatches the cleanup harmlessly', () => {
      const dispatch = vi.fn()
      const categoryDispatch = vi.fn()
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      const state = defaultState({
        budgetExpenseDefinitions: [makeDefinition({ id: 'e1', name: 'Rent' })],
        budgetExpenseAmountsByYear: { '2025': { e1: 1000 } },
        budgetTransactions: [],
      })
      const { container } = render(
        <BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={categoryDispatch} />
      )
      switchTab(container, 'Expenses')
      fireEvent.click(screen.getByLabelText('Delete expense'))
      expect(dispatch).toHaveBeenCalledWith({ type: 'DELETE_EXPENSE_DEFINITION', id: 'e1' })
      expect(categoryDispatch).toHaveBeenCalledWith({ type: 'DELETE_CATEGORY_MAPPINGS_FOR_EXPENSE', spendExpenseId: 'e1' })
    })

    it('Deletion blocked by expenseDefinitionInUse never dispatches either action', () => {
      const dispatch = vi.fn()
      const categoryDispatch = vi.fn()
      vi.spyOn(window, 'alert').mockImplementation(() => {})
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      const state = defaultState({
        budgetExpenseDefinitions: [makeDefinition({ id: 'e1', name: 'Rent' })],
        budgetExpenseAmountsByYear: { '2025': { e1: 1000 } },
        budgetTransactions: [makeTransaction({ id: 't1', date: '2020-01-01', spendExpenseId: 'e1' })],
      })
      const { container } = render(
        <BudgetPage state={state} dispatch={dispatch} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={categoryDispatch} />
      )
      switchTab(container, 'Expenses')
      fireEvent.click(screen.getByLabelText('Delete expense'))
      expect(confirmSpy).not.toHaveBeenCalled()
      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DELETE_EXPENSE_DEFINITION' }))
      expect(categoryDispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DELETE_CATEGORY_MAPPINGS_FOR_EXPENSE' }))
      expect(categoryDispatch).not.toHaveBeenCalled()
    })

    it('default sort is Category ascending', () => {
      const state = defaultState({
        budgetExpenseDefinitions: [
          makeDefinition({ id: 'a', name: 'Netflix', categoryId: 'cat-entertainment' }),
          makeDefinition({ id: 'b', name: 'Rent', categoryId: 'cat-housing' }),
        ],
        budgetExpenseAmountsByYear: {},
      })
      const { container } = render(
        <BudgetPage state={state} dispatch={vi.fn()} categories={CATEGORIES} categoryMappings={[]} categoryDispatch={vi.fn()} />
      )
      switchTab(container, 'Expenses')
      const bodyRows = container.querySelectorAll('table')[0].querySelectorAll('tbody tr')
      const names = Array.from(bodyRows).map((tr) => tr.querySelector('td')!.textContent)
      // Entertainment < Housing alphabetically
      expect(names).toEqual(['Netflix', 'Rent'])
    })
  })

  describe('Spend category-mapping rekey (T8)', () => {
    it('Add Record dispatches UPSERT_CATEGORY_MAPPING keyed by spendExpenseId (no categoryId)', () => {
      const dispatch = vi.fn()
      const categoryDispatch = vi.fn()
      const state = defaultState({
        budgetExpenseDefinitions: [makeDefinition({ id: 'e1', name: 'Rent', categoryId: 'cat-housing' })],
        budgetTransactions: [],
      })
      renderBudgetPage({ state, dispatch, categoryDispatch })
      fireEvent.change(screen.getByLabelText('Record date'), { target: { value: '2025-03-10' } })
      fireEvent.change(screen.getByLabelText('Record description'), { target: { value: 'Whole Foods' } })
      fireEvent.change(screen.getByLabelText('Record spend category'), { target: { value: 'e1' } })
      fireEvent.change(screen.getByLabelText('Record amount'), { target: { value: '42' } })
      fireEvent.click(screen.getByText('Add Record'))
      expect(dispatch).toHaveBeenCalledWith({
        type: 'ADD_BUDGET_TRANSACTION',
        tx: expect.objectContaining({ description: 'Whole Foods', spendExpenseId: 'e1' }),
      })
      expect(categoryDispatch).toHaveBeenCalledWith({
        type: 'UPSERT_CATEGORY_MAPPING',
        description: 'Whole Foods',
        spendExpenseId: 'e1',
      })
      for (const call of categoryDispatch.mock.calls) {
        if (call[0]?.type === 'UPSERT_CATEGORY_MAPPING') {
          expect(call[0]).not.toHaveProperty('categoryId')
        }
      }
      expect(dispatch).toHaveBeenCalledWith({
        type: 'REAPPLY_CATEGORY_MAPPINGS',
        categoryMappings: expect.any(Array),
      })
    })

    it('per-cell spend-category edit dispatches UPSERT_CATEGORY_MAPPING keyed by spendExpenseId plus REAPPLY', () => {
      const dispatch = vi.fn()
      const categoryDispatch = vi.fn()
      const state = defaultState({
        budgetExpenseDefinitions: [
          makeDefinition({ id: 'e1', name: 'Rent', categoryId: 'cat-housing' }),
          makeDefinition({ id: 'e2', name: 'Groceries', categoryId: 'cat-food' }),
        ],
        budgetTransactions: [
          makeTransaction({ id: 't1', date: '2025-03-10', description: 'Store', categoryId: 'cat-housing', spendExpenseId: 'e1' }),
        ],
      })
      renderBudgetPage({ state, dispatch, categoryDispatch })
      fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '2025' } })
      const row = screen.getByText('Store').closest('tr')!
      fireEvent.click(within(row).getByText('Rent (Housing)'))
      fireEvent.change(screen.getByLabelText('Edit record spend category'), { target: { value: 'e2' } })
      expect(dispatch).toHaveBeenCalledWith({
        type: 'UPDATE_BUDGET_TRANSACTION',
        id: 't1',
        patch: { spendExpenseId: 'e2', categoryId: 'cat-food' },
      })
      expect(categoryDispatch).toHaveBeenCalledWith({
        type: 'UPSERT_CATEGORY_MAPPING',
        description: 'Store',
        spendExpenseId: 'e2',
      })
      for (const call of categoryDispatch.mock.calls) {
        if (call[0]?.type === 'UPSERT_CATEGORY_MAPPING') {
          expect(call[0]).not.toHaveProperty('categoryId')
        }
      }
      expect(dispatch).toHaveBeenCalledWith({
        type: 'REAPPLY_CATEGORY_MAPPINGS',
        categoryMappings: expect.any(Array),
      })
    })

    it('Add Record prefill resolves a matching description to the linked expense (spendExpenseId path)', () => {
      const state = defaultState({
        budgetExpenseDefinitions: [makeDefinition({ id: 'e1', name: 'Groceries', categoryId: 'cat-food' })],
        budgetTransactions: [],
      })
      const categoryMappings: CategoryMapping[] = [
        { id: 'm1', substring: 'whole foods', spendExpenseId: 'e1', updatedAt: CATEGORY_UPDATED_AT },
      ]
      renderBudgetPage({ state, categoryMappings })
      fireEvent.change(screen.getByLabelText('Record description'), { target: { value: 'Whole Foods Market' } })
      expect((screen.getByLabelText('Record spend category') as HTMLSelectElement).value).toBe('e1')
    })

    it('typing a description whose mapped expense was deleted falls back gracefully (no crash, stays uncategorized)', () => {
      const state = defaultState({
        budgetExpenseDefinitions: [makeDefinition({ id: 'e1', name: 'Rent', categoryId: 'cat-housing' })],
        budgetTransactions: [],
      })
      const categoryMappings: CategoryMapping[] = [
        { id: 'm1', substring: 'landlord', spendExpenseId: 'e-deleted', updatedAt: CATEGORY_UPDATED_AT },
      ]
      expect(() => {
        renderBudgetPage({ state, categoryMappings })
        fireEvent.change(screen.getByLabelText('Record description'), { target: { value: 'Pay landlord' } })
      }).not.toThrow()
      // Dangling spendExpenseId: prefill leaves the picker untouched (no crash, no bogus category).
      expect((screen.getByLabelText('Record spend category') as HTMLSelectElement).value).toBe('')
    })
  })
})
