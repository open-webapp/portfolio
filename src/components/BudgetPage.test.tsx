import { useReducer } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BudgetPage } from './BudgetPage'
import { initialState } from '../lib/state'
import { appReducer } from '../lib/reducer'
import { categoryStoreReducer } from '../lib/categoryStore'

afterEach(() => cleanup())

describe('BudgetPage derived income', () => {
  it('renders five read-only cards from Income definitions and transactions', () => {
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
    render(<BudgetPage state={state} dispatch={vi.fn()} categories={[{ id: 'income', name: 'Income', updatedAt: '' }, { id: 'housing', name: 'Housing', updatedAt: '' }]} categoryMappings={[]} categoryDispatch={vi.fn()} />)
    expect(screen.getByText('Budgeted income')).toBeTruthy()
    expect(screen.getByText(`Actual income (${new Date().getFullYear()})`)).toBeTruthy()
    expect(screen.getAllByText('$12,000.00')).toHaveLength(1)
    expect(screen.queryByLabelText('Edit income')).toBeNull()
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
      />
    )

    fireEvent.change(screen.getAllByLabelText('Search records').at(-1)!, { target: { value: 'Uncategorized' } })

    expect(screen.getByText('Market run')).toBeTruthy()
    expect(screen.getByText('Uncategorized (Food)')).toBeTruthy()
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
    const view = render(<BudgetPage state={state} dispatch={dispatch} categories={categories} categoryMappings={mappings} categoryDispatch={categoryDispatch} categoriesHydrated />)
    fireEvent.click(screen.getByLabelText('Edit category mappings for Market run'))
    return { ...view, dispatch, categoryDispatch }
  }

  const ReapplyHarness = ({ mappings: initialMappings }: { mappings: typeof mappings }) => {
    const [appState, dispatch] = useReducer(appReducer, {
      ...state,
      budgetExpenseDefinitions: [
        { id: 'expense-a', name: 'Expense A', categoryId: 'food', frequency: 'monthly' as const },
        { id: 'expense-b', name: 'Expense B', categoryId: 'food', frequency: 'monthly' as const },
      ],
      budgetTransactions: [{ id: 'market-row', date: `${year}-01-01`, description: 'Market run', categoryId: 'food', amount: 42, spendExpenseId: 'expense-a' }],
    })
    const [categoryState, categoryDispatch] = useReducer(categoryStoreReducer, {
      categories,
      categoryMappings: initialMappings,
    })

    return <BudgetPage state={appState} dispatch={dispatch} categories={categoryState.categories} categoryMappings={categoryState.categoryMappings} categoryDispatch={categoryDispatch} categoriesHydrated />
  }

  it('edits a mapping substring on Enter and reapplies the updated mappings', () => {
    const { dispatch, categoryDispatch } = renderOverlay()

    fireEvent.click(screen.getByText('Market'))
    const input = screen.getByLabelText('Edit category mapping substring')
    fireEvent.change(input, { target: { value: ' Grocery ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(categoryDispatch).toHaveBeenCalledWith({ type: 'UPDATE_CATEGORY_MAPPING', id: 'market', patch: { substring: 'Grocery' } })
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'REAPPLY_CATEGORY_MAPPINGS',
      categoryMappings: [expect.objectContaining({ id: 'market', substring: 'Grocery' })],
    }))
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

  it('deletes a confirmed mapping, reapplies the tombstoned list, and leaves the empty dialog open', () => {
    const { dispatch, categoryDispatch, rerender } = renderOverlay()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    fireEvent.click(screen.getByLabelText('Delete category mapping Market'))

    expect(categoryDispatch).toHaveBeenCalledWith({ type: 'DELETE_CATEGORY_MAPPING', id: 'market' })
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'REAPPLY_CATEGORY_MAPPINGS',
      categoryMappings: [expect.objectContaining({ id: 'market', deletedAt: expect.any(String) })],
    }))
    rerender(<BudgetPage state={state} dispatch={dispatch} categories={categories} categoryMappings={[]} categoryDispatch={categoryDispatch} categoriesHydrated />)
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
