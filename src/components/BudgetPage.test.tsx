import { useReducer, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BudgetPage as BudgetPageUnderTest, type BudgetPageProps } from './BudgetPage'
import { initialState } from '../lib/state'
import { appReducer } from '../lib/reducer'
import { sankeyFlowData, SPEND_ALL_YEARS, spendBudgetYears, type SpendScope } from '../lib/selectors'

afterEach(() => cleanup())

const periodProps = { period: 'spend' as const, setPeriod: vi.fn() }

// BudgetPage's production owner is App. This host supplies the controlled
// scope and retains the legacy test suite's direct-page interaction coverage.
function BudgetPage(props: Omit<BudgetPageProps, 'selectedScope' | 'setSelectedScope'>) {
  const [selectedScope, setSelectedScope] = useState<SpendScope>(
    () => spendBudgetYears(props.state.budgetTransactions)[0] ?? SPEND_ALL_YEARS
  )
  const availableYears = spendBudgetYears(props.state.budgetTransactions)
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
      <BudgetPageUnderTest {...props} selectedScope={selectedScope} setSelectedScope={setSelectedScope} />
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
        categoryMappings={[]}
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
    render(<BudgetPage state={initialState()} dispatch={vi.fn()} categories={[]} categoryMappings={[]} categoryDispatch={vi.fn()} {...periodProps} />)

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
        categoryMappings={[]}
        categoryDispatch={vi.fn()}
        {...periodProps}
      />
    )

    const chart = screen.getByTestId('budget-sankey')
    expect(chart.querySelector('svg')).toBeTruthy()
    expect(chart.querySelectorAll('rect')).toHaveLength(4)
    expect(chart.querySelectorAll('path')).toHaveLength(3)
  })

  it('renders three summary cards with spend progress and a savings-rate income editor', () => {
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
    render(<BudgetPage state={state} dispatch={vi.fn()} categories={[{ id: 'income', name: 'Income', updatedAt: '' }, { id: 'housing', name: 'Housing', updatedAt: '' }]} categoryMappings={[]} categoryDispatch={vi.fn()} {...periodProps} />)
    const cards = screen.getByTestId('summary-cards')
    expect(cards.querySelectorAll('.card')).toHaveLength(3)
    expect(screen.getByText(`Spend vs budget (${new Date().getFullYear()})`)).toBeTruthy()
    expect(cards.textContent).toContain('-100.0%')
    expect(cards.textContent).toContain('Spent -$500.00 of $500.00 budget')
    expect(screen.getByText('Savings rate')).toBeTruthy()
    expect(screen.getByLabelText('Edit income')).toBeTruthy()
  })

  it('uses the projected-spend over-budget color and the configured gain color when under budget', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-12-31T12:00:00'))
    const state = {
      ...initialState(),
      budgetExpenseDefinitions: [{ id: 'rent', name: 'Rent', categoryId: 'housing', frequency: 'yearly' as const }],
      budgetExpenseAmountsByYear: { '2026': { rent: 200 } },
      budgetTransactions: [{ id: 'rent', date: '2026-01-02', description: 'Rent', categoryId: 'housing', amount: -100 }],
    }
    const { rerender } = render(<BudgetPage state={state} dispatch={vi.fn()} categories={[{ id: 'housing', name: 'Housing', updatedAt: '' }]} categoryMappings={[]} categoryDispatch={vi.fn()} {...periodProps} />)

    expect((screen.getByText('49.9% under budget') as HTMLElement).style.color).toBe('rgb(31, 169, 113)')

    vi.setSystemTime(new Date('2026-01-02T12:00:00'))
    rerender(<BudgetPage state={state} dispatch={vi.fn()} categories={[{ id: 'housing', name: 'Housing', updatedAt: '' }]} categoryMappings={[]} categoryDispatch={vi.fn()} {...periodProps} />)
    expect((screen.getByText('18150.0% over budget') as HTMLElement).style.color).toBe('rgb(226, 87, 76)')
    vi.useRealTimers()
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
    render(<BudgetPage state={state} dispatch={dispatch} categories={[{ id: 'income-category', name: 'Income', updatedAt: '' }, { id: 'housing', name: 'Housing', updatedAt: '' }]} categoryMappings={[]} categoryDispatch={vi.fn()} {...periodProps} />)

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
    render(<BudgetPage state={state} dispatch={dispatch} categories={[{ id: 'income-category', name: 'Income', updatedAt: '' }, { id: 'housing', name: 'Housing', updatedAt: '' }]} categoryMappings={[]} categoryDispatch={vi.fn()} {...periodProps} />)

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
        categoryMappings={[]}
        categoryDispatch={vi.fn()}
        {...periodProps}
      />
    )

    fireEvent.change(screen.getAllByLabelText('Search records').at(-1)!, { target: { value: 'Uncategorized' } })

    expect(screen.getByText('Market run')).toBeTruthy()
    expect(screen.getByText('Uncategorized (Food)')).toBeTruthy()
  })
})

describe('BudgetPage period props', () => {
  const props = {
    state: initialState(),
    dispatch: vi.fn(),
    categories: [],
    categoryMappings: [],
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
    render(<BudgetPageUnderTest {...props} period="spend" selectedScope="2025" setSelectedScope={vi.fn()} />)

    expect(screen.queryByLabelText('Select year')).toBeNull()
  })
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
    render(<BudgetPage state={state} dispatch={dispatch} categories={categories} categoryMappings={[]} categoryDispatch={vi.fn()} categoriesHydrated {...periodProps} />)
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
        categoryMappings={[]}
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
    expect(screen.getByTestId('summary-cards').querySelectorAll('.card')).toHaveLength(3)
    expect(screen.getAllByText('N/A')).toHaveLength(2)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('aggregates exact transaction years and renders rows from both years under All', () => {
    renderSpend()

    fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '__spend_all_years__' } })

    expect(screen.getByText('Spend vs budget (All years)')).toBeTruthy()
    expect(screen.getByTestId('summary-cards').textContent).toContain('Spent -$100.00 of $50.00 budget')
    expect(screen.getByTestId('summary-cards').textContent).toContain('N/A')
    expect(screen.getByText('Alpha spend')).toBeTruthy()
    expect(screen.getByText('Zulu spend')).toBeTruthy()
    expect(screen.getByTestId('records-total-row').textContent).toContain('$100.00')
  })

  it('uses parent-supplied All and concrete scopes on rerender', () => {
    const props = {
      state: spendState(),
      dispatch: vi.fn(),
      categories,
      categoryMappings: [],
      categoryDispatch: vi.fn(),
      categoriesHydrated: true,
      ...periodProps,
      setSelectedScope: vi.fn(),
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
    expect(screen.getByTestId('summary-cards').textContent).toContain('Spent -$75.00 of $0.00 budget')
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
    expect(screen.getByText('Concrete scope add')).toBeTruthy()
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
        categoryMappings={[]}
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
      return <BudgetPage state={appState} dispatch={(action) => { actions(action); dispatch(action) }} categories={categories} categoryMappings={[]} categoryDispatch={vi.fn()} categoriesHydrated budgetAccountRules={[positiveRule]} {...periodProps} />
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
        categoryMappings={[]}
        categoryDispatch={vi.fn()}
        categoriesHydrated
        {...periodProps}
      />,
    )

    expect(document.querySelector('input[name="budgetPeriod"]')).toBeNull()
    expect(screen.queryByText('Accounts')).toBeNull()
  })
})

describe('BudgetPage category mapping overlay', () => {
  const year = new Date().getFullYear()
  const categories = [{ id: 'food', name: 'Food', updatedAt: '' }]
  const mappings = [{ id: 'market', substring: 'Market', spendExpenseId: 'groceries', updatedAt: '' }]
  const state = {
    ...initialState(),
    budgetExpenseDefinitions: [{ id: 'groceries', name: 'Groceries', categoryId: 'food', frequency: 'monthly' as const }],
    budgetTransactions: [{ id: 'market-row', date: `${year}-01-01`, description: 'Market run', categoryId: 'food', amount: 42, spendExpenseId: 'groceries' }],
  }

  const renderOverlay = () => {
    const dispatch = vi.fn()
    const categoryDispatch = vi.fn()
    const view = render(<BudgetPage state={state} dispatch={dispatch} categories={categories} categoryMappings={mappings} categoryDispatch={categoryDispatch} categoriesHydrated {...periodProps} />)
    fireEvent.click(screen.getByLabelText('Edit category mappings for Market run'))
    return { ...view, dispatch, categoryDispatch }
  }

  it('uses the scrollable dialog variant for category mappings', () => {
    renderOverlay()

    expect(screen.getByRole('dialog', { name: 'Category mappings' }).className).toContain('category-mapping-dialog')
  })

  const ReapplyHarness = ({ mappings: initialMappings }: { mappings: typeof mappings }) => {
    const [appState, dispatch] = useReducer(appReducer, {
      ...state,
      budgetExpenseDefinitions: [
        { id: 'expense-a', name: 'Expense A', categoryId: 'food', frequency: 'monthly' as const },
        { id: 'expense-b', name: 'Expense B', categoryId: 'food', frequency: 'monthly' as const },
      ],
      budgetTransactions: [{ id: 'market-row', date: `${year}-01-01`, description: 'Market run', categoryId: 'food', amount: 42, spendExpenseId: 'expense-a' }],
      categoryMappings: initialMappings,
    })

    return <BudgetPage state={appState} dispatch={dispatch} categories={categories} categoryMappings={appState.categoryMappings} categoryDispatch={vi.fn()} categoriesHydrated {...periodProps} />
  }

  it('edits a mapping substring on Enter with one main-state action', () => {
    const { dispatch, categoryDispatch } = renderOverlay()

    fireEvent.click(screen.getByText('Market'))
    const input = screen.getByLabelText('Edit category mapping substring')
    fireEvent.change(input, { target: { value: ' Grocery ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(categoryDispatch).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({ type: 'UPDATE_CATEGORY_MAPPING', id: 'market', patch: { substring: 'Grocery' } })
    expect(screen.queryByLabelText('Edit category mapping substring')).toBeNull()
    expect(screen.getByText('Market')).toBeTruthy()
  })

  it('keeps invalid mapping edits open, cancels them before closing the dialog, and ignores declined deletion', () => {
    const { dispatch, categoryDispatch } = renderOverlay()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    fireEvent.click(screen.getByText('Market'))
    const input = screen.getByLabelText('Edit category mapping substring')
    fireEvent.blur(input)
    expect(screen.getByLabelText('Edit category mapping substring')).toBeTruthy()
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(categoryDispatch).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Edit category mapping substring')).toBeTruthy()

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByLabelText('Edit category mapping substring')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Category mappings' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Category mappings' })).toBeNull()

    fireEvent.click(screen.getByLabelText('Edit category mappings for Market run'))
    fireEvent.click(screen.getByLabelText('Delete category mapping Market'))
    expect(confirm).toHaveBeenCalledWith('Delete this mapping? This cannot be undone.')
    expect(categoryDispatch).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('deletes a confirmed mapping with one main-state action and leaves the empty dialog open', () => {
    const { dispatch, categoryDispatch, rerender } = renderOverlay()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    fireEvent.click(screen.getByLabelText('Delete category mapping Market'))

    expect(categoryDispatch).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({ type: 'DELETE_CATEGORY_MAPPING', id: 'market' })
    rerender(<BudgetPage state={state} dispatch={dispatch} categories={categories} categoryMappings={[]} categoryDispatch={categoryDispatch} categoriesHydrated {...periodProps} />)
    expect(screen.getByRole('dialog', { name: 'Category mappings' })).toBeTruthy()
    expect(screen.getByText('No category mappings.')).toBeTruthy()
    confirm.mockRestore()
  })

  it('updates the open dialog to the row’s live expense scope after reapplying an edited mapping', () => {
    render(<ReapplyHarness mappings={[
      { id: 'expense-b-map', substring: 'Market', spendExpenseId: 'expense-b', updatedAt: '' },
      { id: 'expense-a-map', substring: 'Market run', spendExpenseId: 'expense-a', updatedAt: '' },
    ]} />)

    fireEvent.click(screen.getByLabelText('Edit category mappings for Market run'))
    expect(screen.getByLabelText('Edit category mapping Market run')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Edit category mapping Market run'))
    const input = screen.getByLabelText('Edit category mapping substring')
    fireEvent.change(input, { target: { value: 'Market run again' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByRole('dialog', { name: 'Category mappings' })).toBeTruthy()
    expect(screen.getByText('Market')).toBeTruthy()
    expect(screen.getAllByLabelText(/^Edit category mapping /)).toHaveLength(1)
    expect(screen.queryByText('Market run again')).toBeNull()
  })

  it('keeps the dialog open on only the new scope mappings when deletion reapplies the row', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ReapplyHarness mappings={[
      { id: 'expense-b-map', substring: 'Market', spendExpenseId: 'expense-b', updatedAt: '' },
      { id: 'expense-a-map', substring: 'Market run', spendExpenseId: 'expense-a', updatedAt: '' },
    ]} />)

    fireEvent.click(screen.getByLabelText('Edit category mappings for Market run'))
    fireEvent.click(screen.getByLabelText('Delete category mapping Market run'))

    expect(screen.getByRole('dialog', { name: 'Category mappings' })).toBeTruthy()
    expect(screen.getByText('Market')).toBeTruthy()
    expect(screen.getAllByLabelText(/^Edit category mapping /)).toHaveLength(1)
    expect(screen.queryByLabelText('Delete category mapping Market run')).toBeNull()
    confirm.mockRestore()
  })

  it('leaves ordinary Description inline edits able to commit or cancel', () => {
    render(<ReapplyHarness mappings={[]} />)

    fireEvent.click(screen.getByText('Market run', { selector: 'span' }))
    const input = screen.getByDisplayValue('Market run')
    fireEvent.change(input, { target: { value: 'Fresh market run' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('Fresh market run')).toBeTruthy()

    fireEvent.click(screen.getByText('Fresh market run', { selector: 'span' }))
    const secondInput = screen.getByDisplayValue('Fresh market run')
    fireEvent.change(secondInput, { target: { value: 'Discarded market run' } })
    fireEvent.keyDown(secondInput, { key: 'Escape' })
    expect(screen.getByText('Fresh market run')).toBeTruthy()
    expect(screen.queryByText('Discarded market run')).toBeNull()
  })
})
