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

    for (const period of ['expenses', 'analytics', 'categoryMapping'] as const) {
      rerender(<BudgetPage {...props} period={period} />)
      expect(screen.queryByTestId('summary-cards')).toBeNull()
      contents.add(container.textContent ?? '')
    }

    expect(contents.size).toBe(4)
  })

  it('renders the category-plus-substring mapping table on the categoryMapping tab', () => {
    render(
      <BudgetPage
        {...props}
        period="categoryMapping"
        state={{
          ...initialState(),
          budgetExpenseDefinitions: [{ id: 'groceries', name: 'Groceries', categoryId: 'food', frequency: 'yearly' as const }],
          budgetTransactions: [],
        }}
        dispatch={vi.fn()}
        categories={[{ id: 'food', name: 'Food', updatedAt: '' }]}
        categoryMappings={[{ id: 'm1', substring: 'WHOLEFDS', spendExpenseId: 'groceries', updatedAt: '' }]}
      />
    )

    expect(screen.getByText('Groceries (Food)')).toBeTruthy()
    expect(screen.getByText('WHOLEFDS')).toBeTruthy()
    expect(screen.getByLabelText('Add substring to Groceries (Food)')).toBeTruthy()
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

  // Drives the tag-filter combobox: types a query, then picks a suggestion.
  const selectTagFilter = (query: string, suggestionKey?: string) => {
    fireEvent.change(screen.getByLabelText('Filter tags'), { target: { value: query } })
    fireEvent.click(screen.getByTestId(`tag-filter-suggestion-${(suggestionKey ?? query).toLowerCase()}`))
  }

  const renderTagSpend = (budgetTransactions: TagRow[], categories = tagCategories) => {
    const dispatch = vi.fn()
    render(
      <BudgetPage
        state={{ ...initialState(), budgetTransactions }}
        dispatch={dispatch}
        categories={categories}
        categoryMappings={[]}
        categoryDispatch={vi.fn()}
        categoriesHydrated
        {...periodProps}
      />
    )
    return dispatch
  }

  it('narrows the table to rows tagged work, matching case-insensitively', () => {
    renderTagSpend([
      { id: 'a', date: '2025-01-01', description: 'Office supplies', categoryId: 'food', amount: 10, tags: ['Work'] },
      { id: 'b', date: '2025-01-02', description: 'Client dinner', categoryId: 'food', amount: 12, tags: ['WORK'] },
      { id: 'c', date: '2025-01-03', description: 'Lunch', categoryId: 'food', amount: 8, tags: ['personal'] },
    ])

    expect(screen.getByText('Office supplies')).toBeTruthy()
    expect(screen.getByText('Client dinner')).toBeTruthy()
    expect(screen.getByText('Lunch')).toBeTruthy()

    // Typing filters the suggestions but does not filter the table.
    fireEvent.change(screen.getByLabelText('Filter tags'), { target: { value: 'wor' } })
    expect(screen.getByTestId('tag-filter-suggestion-work')).toBeTruthy()
    expect(screen.queryByTestId('tag-filter-suggestion-personal')).toBeNull()
    expect(screen.getByText('Lunch')).toBeTruthy()

    fireEvent.click(screen.getByTestId('tag-filter-suggestion-work'))

    expect(screen.getByText('Office supplies')).toBeTruthy()
    expect(screen.getByText('Client dinner')).toBeTruthy()
    expect(screen.queryByText('Lunch')).toBeNull()
    expect(screen.getByLabelText('Remove tag filter Work')).toBeTruthy()
  })

  it('requires every selected tag (AND semantics)', () => {
    renderTagSpend([
      { id: 'a', date: '2025-01-01', description: 'Urgent work bill', categoryId: 'food', amount: 10, tags: ['work', 'urgent'] },
      { id: 'b', date: '2025-01-02', description: 'Routine work', categoryId: 'food', amount: 12, tags: ['work'] },
      { id: 'c', date: '2025-01-03', description: 'Urgent personal', categoryId: 'food', amount: 8, tags: ['urgent'] },
    ])

    selectTagFilter('work')
    expect(screen.getByText('Urgent work bill')).toBeTruthy()
    expect(screen.getByText('Routine work')).toBeTruthy()
    expect(screen.queryByText('Urgent personal')).toBeNull()

    selectTagFilter('urgent')
    expect(screen.getByText('Urgent work bill')).toBeTruthy()
    expect(screen.queryByText('Routine work')).toBeNull()
    expect(screen.queryByText('Urgent personal')).toBeNull()
  })

  it('narrows together with search text and the Show excluded toggle', () => {
    const categories = [
      { id: 'food', name: 'Food', updatedAt: '' },
      { id: 'excluded', name: 'Excluded', updatedAt: '', excludeFromSpend: true },
    ]
    renderTagSpend(
      [
        { id: 'a', date: '2025-01-01', description: 'Alpha office', categoryId: 'food', amount: 10, tags: ['work'] },
        { id: 'b', date: '2025-01-02', description: 'Alpha lunch', categoryId: 'food', amount: 12, tags: ['personal'] },
        { id: 'c', date: '2025-01-03', description: 'Alpha retreat', categoryId: 'excluded', amount: 8, tags: ['work'] },
      ],
      categories
    )

    fireEvent.change(screen.getByLabelText('Search records'), { target: { value: 'alpha' } })
    expect(screen.getByText('Alpha office')).toBeTruthy()
    expect(screen.getByText('Alpha lunch')).toBeTruthy()
    expect(screen.queryByText('Alpha retreat')).toBeNull()

    selectTagFilter('work')
    expect(screen.getByText('Alpha office')).toBeTruthy()
    expect(screen.queryByText('Alpha lunch')).toBeNull()
    expect(screen.queryByText('Alpha retreat')).toBeNull()

    fireEvent.click(screen.getByLabelText('Show excluded'))
    expect(screen.getByText('Alpha office')).toBeTruthy()
    expect(screen.getByText('Alpha retreat')).toBeTruthy()
    expect(screen.queryByText('Alpha lunch')).toBeNull()
  })

  it('dedupes distinct tags case-insensitively keeping first-seen casing', () => {
    renderTagSpend([
      { id: 'a', date: '2025-01-01', description: 'Groceries', categoryId: 'food', amount: 10, tags: ['Food'] },
      { id: 'b', date: '2025-01-02', description: 'Takeout', categoryId: 'food', amount: 12, tags: ['food', 'travel'] },
    ])

    expect(screen.getAllByTestId('tag-filter-suggestion-food')).toHaveLength(1)
    expect(screen.getByTestId('tag-filter-suggestion-food').textContent).toBe('Food')
    expect(screen.getByTestId('tag-filter-suggestion-travel')).toBeTruthy()
  })

  it('resets to page 1 and clears row selection when the tag filter changes', () => {
    const rows: TagRow[] = [
      ...Array.from({ length: 52 }, (_, index) => ({
        id: `work-${index}`,
        date: '2025-06-01',
        description: `Work ${String(index).padStart(2, '0')}`,
        categoryId: 'food',
        amount: index + 1,
        tags: ['work'],
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        id: `other-${index}`,
        date: '2025-06-01',
        description: `Other ${index}`,
        categoryId: 'food',
        amount: 100 + index,
        tags: ['other'],
      })),
    ]
    renderTagSpend(rows)

    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByTestId('records-pagination').textContent).toContain('Page 2 of 2')

    fireEvent.click(screen.getAllByTestId(/^row-select-/)[0]!)
    expect(screen.getByTestId('bulk-action-bar')).toBeTruthy()

    selectTagFilter('other')

    expect(screen.getByText('Other 0')).toBeTruthy()
    expect(screen.getByText('Other 2')).toBeTruthy()
    expect(screen.queryByText('Work 00')).toBeNull()
    expect(screen.queryByTestId('bulk-action-bar')).toBeNull()
    expect(screen.queryByTestId('records-pagination')).toBeNull()
  })
})

describe('BudgetPage tag filter combobox', () => {
  const comboCategories = [{ id: 'food', name: 'Food', updatedAt: '' }]

  type ComboRow = {
    id: string
    date: string
    description: string
    categoryId: string
    amount: number
    tags?: string[]
  }

  const comboRows: ComboRow[] = [
    { id: 'a', date: '2025-01-01', description: 'Office supplies', categoryId: 'food', amount: 10, tags: ['work'] },
    { id: 'b', date: '2025-01-02', description: 'Team lunch', categoryId: 'food', amount: 12, tags: ['personal'] },
  ]

  const renderComboSpend = (budgetTransactions: ComboRow[]) => {
    const dispatch = vi.fn()
    render(
      <BudgetPage
        state={{ ...initialState(), budgetTransactions }}
        dispatch={dispatch}
        categories={comboCategories}
        categoryMappings={[]}
        categoryDispatch={vi.fn()}
        categoriesHydrated
        {...periodProps}
      />
    )
    return dispatch
  }

  it('shows matching suggestions as you type and filters the table on select', () => {
    renderComboSpend(comboRows)

    const input = screen.getByLabelText('Filter tags') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'wo' } })

    expect(screen.getByTestId('tag-filter-suggestion-work')).toBeTruthy()
    expect(screen.queryByTestId('tag-filter-suggestion-personal')).toBeNull()
    // Typing alone never filters rows or creates tags.
    expect(screen.getByText('Office supplies')).toBeTruthy()
    expect(screen.getByText('Team lunch')).toBeTruthy()
    expect(screen.queryByTestId('tag-filter-selected')).toBeNull()

    fireEvent.click(screen.getByTestId('tag-filter-suggestion-work'))

    expect(screen.getByText('Office supplies')).toBeTruthy()
    expect(screen.queryByText('Team lunch')).toBeNull()
    // Selected tag renders as a removable chip and the query clears.
    expect(screen.getByLabelText('Remove tag filter work')).toBeTruthy()
    expect(input.value).toBe('')

    // Removing the chip lifts the filter again.
    fireEvent.click(screen.getByLabelText('Remove tag filter work'))
    expect(screen.getByText('Office supplies')).toBeTruthy()
    expect(screen.getByText('Team lunch')).toBeTruthy()

    // Enter picks the first matching suggestion.
    fireEvent.change(input, { target: { value: 'pers' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.queryByText('Office supplies')).toBeNull()
    expect(screen.getByText('Team lunch')).toBeTruthy()
  })

  it('clears the tag filter selection when the selected year changes', () => {
    renderComboSpend([
      { id: 'a', date: '2025-01-01', description: 'Work lunch 2025', categoryId: 'food', amount: 10, tags: ['work'] },
      { id: 'b', date: '2025-01-02', description: 'Personal 2025', categoryId: 'food', amount: 12, tags: ['personal'] },
      { id: 'c', date: '2024-01-01', description: 'Work lunch 2024', categoryId: 'food', amount: 8, tags: ['work'] },
      { id: 'd', date: '2024-01-02', description: 'Personal 2024', categoryId: 'food', amount: 9, tags: ['personal'] },
    ])

    fireEvent.change(screen.getByLabelText('Filter tags'), { target: { value: 'wor' } })
    fireEvent.click(screen.getByTestId('tag-filter-suggestion-work'))
    expect(screen.getByText('Work lunch 2025')).toBeTruthy()
    expect(screen.queryByText('Personal 2025')).toBeNull()
    expect(screen.getByLabelText('Remove tag filter work')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Select year'), { target: { value: '2024' } })

    expect(screen.queryByLabelText('Remove tag filter work')).toBeNull()
    expect(screen.getByText('Work lunch 2024')).toBeTruthy()
    expect(screen.getByText('Personal 2024')).toBeTruthy()
    expect(screen.queryByText('Work lunch 2025')).toBeNull()
  })

  it('clears the tag filter selection when the sort column changes', () => {
    renderComboSpend(comboRows)

    fireEvent.change(screen.getByLabelText('Filter tags'), { target: { value: 'wor' } })
    fireEvent.click(screen.getByTestId('tag-filter-suggestion-work'))
    expect(screen.queryByText('Team lunch')).toBeNull()
    expect(screen.getByLabelText('Remove tag filter work')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Sort by description'))

    expect(screen.queryByLabelText('Remove tag filter work')).toBeNull()
    expect(screen.getByText('Office supplies')).toBeTruthy()
    expect(screen.getByText('Team lunch')).toBeTruthy()
  })

  it('shows an empty dropdown without error when nothing matches', () => {
    renderComboSpend(comboRows)

    const input = screen.getByLabelText('Filter tags') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'zzz-no-such-tag' } })

    expect(screen.getByTestId('tag-filter-no-match')).toBeTruthy()
    const suggestionsBox = screen.getByTestId('tag-filter-suggestions')
    expect(suggestionsBox.textContent).toBe('No matching tags')
    expect(suggestionsBox.querySelector('[role="option"]')).toBeNull()
    // No error, no filtering, no selection.
    expect(screen.getByText('Office supplies')).toBeTruthy()
    expect(screen.getByText('Team lunch')).toBeTruthy()
    expect(screen.queryByTestId('tag-filter-selected')).toBeNull()

    // Enter with no match is a no-op — typing never creates tags.
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.queryByTestId('tag-filter-selected')).toBeNull()
    expect(screen.getByText('Office supplies')).toBeTruthy()
    expect(screen.getByText('Team lunch')).toBeTruthy()
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
        categoryMappings={[]}
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
        categoryMappings={[]}
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
        categoryMappings={[]}
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
    const cell = screen.getByText(description).closest('tr')!.querySelectorAll('td')[5]!
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
    const tagsCell = screen.getByText('Tagged row').closest('tr')!.querySelectorAll('td')[5]!
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
    const tagsCell = screen.getByText('Escape row').closest('tr')!.querySelectorAll('td')[5]!
    expect(tagsCell.textContent).toContain('food')
    expect(tagsCell.textContent).not.toContain('scratch')
  })

  it('renders an empty state (not "undefined" text) for rows with no tags', () => {
    renderTagCells([
      { id: 'a', date: '2025-01-01', description: 'Untagged row', categoryId: 'food', amount: 10 },
    ])

    const cell = screen.getByText('Untagged row').closest('tr')!.querySelectorAll('td')[5]!
    expect(cell.textContent).not.toContain('undefined')
    expect(cell.textContent?.trim()).not.toBe('')
  })
})
