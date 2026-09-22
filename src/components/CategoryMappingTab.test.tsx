import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CategoryMappingTab } from './CategoryMappingTab'
import { initialState } from '../lib/state'
import { appReducer } from '../lib/reducer'
import type { Category, CategoryMapping } from '../lib/types'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function fixture() {
  const state = initialState()
  state.budgetExpenseDefinitions = [
    { id: 'fresh', name: 'Fresh Groceries', categoryId: 'grocery', frequency: 'monthly' },
    { id: 'pantry', name: 'Pantry Groceries', categoryId: 'grocery', frequency: 'monthly' },
    { id: 'dining', name: 'Dining Out', categoryId: 'dining', frequency: 'monthly' },
  ]
  state.budgetTransactions = [
    { id: 'direct-grocery', date: '2024-01-01', description: 'MARKET', categoryId: 'grocery', amount: 10 },
    { id: 'linked-grocery', date: '2025-01-01', description: 'WHOLE FOODS', categoryId: 'other', amount: 20, spendExpenseId: 'fresh' },
    { id: 'stale-grocery', date: '2026-01-01', description: 'RESTAURANT', categoryId: 'grocery', amount: 30, spendExpenseId: 'dining' },
    { id: 'unrelated', date: '2023-01-01', description: 'TRANSFER', categoryId: 'other', amount: 40 },
  ]
  const categories: Category[] = [
    { id: 'grocery', name: 'Groceries', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'dining', name: 'Dining', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'unused', name: 'Unused Category', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'other', name: 'Other', updatedAt: '2026-01-01T00:00:00.000Z' },
  ]
  const categoryMappings: CategoryMapping[] = [
    { id: 'whole-foods', substring: 'WHOLE FOODS', spendExpenseId: 'fresh', updatedAt: '2026-01-01T00:00:00.000Z' },
  ]
  return { state, categories, categoryMappings }
}

function renderTab(overrides: Partial<React.ComponentProps<typeof CategoryMappingTab>> = {}) {
  const data = fixture()
  return render(<CategoryMappingTab {...data} dispatch={vi.fn()} categoryDispatch={vi.fn()} categoriesHydrated {...overrides} />)
}

describe('CategoryMappingTab', () => {
  it('loads independently until global categories hydrate', () => {
    const { rerender } = renderTab({ categoriesHydrated: false })
    expect(screen.getByText('Loading category mappings...')).toBeTruthy()
    const data = fixture()
    rerender(<CategoryMappingTab {...data} dispatch={vi.fn()} categoryDispatch={vi.fn()} categoriesHydrated />)
    expect(screen.getByText('Category Mapping')).toBeTruthy()
  })

  it('does not render relocated category mapping import and export controls', () => {
    renderTab()
    expect(screen.queryByRole('button', { name: 'Download Category Mapping' })).toBeFalsy()
    expect(screen.queryByRole('button', { name: 'Import Category Mapping' })).toBeFalsy()
  })

  it('groups mappings by definition, keeps unused categories mapping-free, and offers deletion except for Other', () => {
    renderTab()
    expect(screen.getByText('Fresh Groceries (Groceries)')).toBeTruthy()
    expect(screen.getByText('Pantry Groceries (Groceries)')).toBeTruthy()
    expect(screen.getAllByPlaceholderText('+ add substring')).toHaveLength(3)
    const unused = screen.getByText('Unused Category').closest('div')!.parentElement!
    expect(unused.querySelector('input[placeholder="+ add substring"]')).toBeNull()
    expect(screen.getByLabelText('Delete category Unused Category')).toBeTruthy()
    expect(screen.queryByLabelText('Delete category Other')).toBeNull()
  })

  it('shows effective spend-record counts for every category header', () => {
    renderTab()
    expect(screen.getByText('0 spend records')).toBeTruthy()
    expect(screen.getAllByText('1 spend record')).toHaveLength(2)
    expect(screen.getByText('2 spend records')).toBeTruthy()
  })

  it('deletes a category after confirming the irreversible action', () => {
    const categoryDispatch = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderTab({ categoryDispatch })
    fireEvent.click(screen.getByLabelText('Delete category Unused Category'))
    expect(window.confirm).toHaveBeenCalledWith('Delete category "Unused Category"? This cannot be undone.')
    expect(categoryDispatch).toHaveBeenCalledWith({ type: 'DELETE_CATEGORY', id: 'unused' })
  })

  it('does not delete a category when confirmation is declined', () => {
    const categoryDispatch = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderTab({ categoryDispatch })
    fireEvent.click(screen.getByLabelText('Delete category Unused Category'))
    expect(categoryDispatch).not.toHaveBeenCalled()
  })

  it('blocks deletion when spend records use the category', () => {
    const data = fixture()
    data.state.budgetExpenseDefinitions = []
    data.state.budgetTransactions = [{ id: 'spend', date: '2026-01-01', description: 'MARKET', categoryId: 'grocery', amount: 10 }]
    const categoryDispatch = vi.fn()
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderTab({ ...data, categoryDispatch })
    fireEvent.click(screen.getByLabelText('Delete category Groceries'))
    expect(alert).toHaveBeenCalledWith('Cannot delete category "Groceries": 1 Spend record uses it.')
    expect(confirm).not.toHaveBeenCalled()
    expect(categoryDispatch).not.toHaveBeenCalled()
  })

  it('blocks deletion when expense definitions use the category', () => {
    const data = fixture()
    data.state.budgetTransactions = []
    const categoryDispatch = vi.fn()
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderTab({ ...data, categoryDispatch })
    fireEvent.click(screen.getByLabelText('Delete category Groceries'))
    expect(alert).toHaveBeenCalledWith('Cannot delete category "Groceries": 2 Expense definitions use it.')
    expect(confirm).not.toHaveBeenCalled()
    expect(categoryDispatch).not.toHaveBeenCalled()
  })

  it('reports both blockers in one alert when both spend records and definitions use the category', () => {
    const categoryDispatch = vi.fn()
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderTab({ categoryDispatch })
    fireEvent.click(screen.getByLabelText('Delete category Groceries'))
    expect(alert).toHaveBeenCalledWith('Cannot delete category "Groceries": 2 Spend records and 2 Expense definitions use it.')
    expect(alert).toHaveBeenCalledTimes(1)
    expect(confirm).not.toHaveBeenCalled()
    expect(categoryDispatch).not.toHaveBeenCalled()
  })

  it('updates header counts and deletion blocks when records and definitions change', () => {
    const data = fixture()
    data.state.budgetTransactions = []
    data.state.budgetExpenseDefinitions = []
    const categoryDispatch = vi.fn()
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { rerender } = renderTab({ ...data, categoryDispatch })
    expect(screen.getByLabelText('Delete category Groceries').parentElement!.textContent).toContain('0 spend records')
    fireEvent.click(screen.getByLabelText('Delete category Groceries'))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(categoryDispatch).toHaveBeenCalledWith({ type: 'DELETE_CATEGORY', id: 'grocery' })

    const changed = fixture()
    changed.state.budgetTransactions = [{ id: 'spend', date: '2026-01-01', description: 'MARKET', categoryId: 'grocery', amount: 10 }]
    changed.state.budgetExpenseDefinitions = [{ id: 'definition', name: 'Market', categoryId: 'grocery', frequency: 'monthly' }]
    changed.categories = changed.categories.map((category) => category.id === 'grocery' ? { ...category, name: 'Food' } : category)
    rerender(<CategoryMappingTab {...changed} dispatch={vi.fn()} categoryDispatch={categoryDispatch} categoriesHydrated />)
    expect(screen.getByText('1 spend record')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Delete category Food'))
    expect(alert).toHaveBeenLastCalledWith('Cannot delete category "Food": 1 Spend record and 1 Expense definition use it.')
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(categoryDispatch).toHaveBeenCalledTimes(1)
  })

  it('places mapping edit before text and delete after it, and confirms deletion', () => {
    const dispatch = vi.fn()
    renderTab({ dispatch })
    const text = screen.getByText('WHOLE FOODS')
    const row = text.parentElement!
    expect(Array.from(row.children).indexOf(screen.getByLabelText('Edit substring WHOLE FOODS'))).toBeLessThan(Array.from(row.children).indexOf(text))
    expect(Array.from(row.children).indexOf(text)).toBeLessThan(Array.from(row.children).indexOf(screen.getByLabelText('Delete substring WHOLE FOODS')))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByLabelText('Delete substring WHOLE FOODS'))
    expect(window.confirm).toHaveBeenCalledWith('Delete this mapping? This cannot be undone.')
    expect(dispatch).toHaveBeenCalledWith({ type: 'DELETE_CATEGORY_MAPPING', id: 'whole-foods' })
  })

  it('does not delete a mapping when confirmation is declined', () => {
    const dispatch = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderTab({ dispatch })
    fireEvent.click(screen.getByLabelText('Delete substring WHOLE FOODS'))
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('adds definition-scoped substrings by button and Enter', () => {
    const dispatch = vi.fn()
    renderTab({ dispatch })
    const fresh = screen.getByLabelText('Add substring to Fresh Groceries (Groceries)')
    fireEvent.change(fresh, { target: { value: 'COSTCO' } })
    fireEvent.click(screen.getByLabelText('Add substring button Fresh Groceries (Groceries)'))
    const pantry = screen.getByLabelText('Add substring to Pantry Groceries (Groceries)')
    fireEvent.change(pantry, { target: { value: 'BULK MART' } })
    fireEvent.keyDown(pantry, { key: 'Enter' })
    expect(dispatch).toHaveBeenCalledWith({ type: 'ADD_CATEGORY_MAPPING', spendExpenseId: 'fresh', substring: 'COSTCO' })
    expect(dispatch).toHaveBeenCalledWith({ type: 'ADD_CATEGORY_MAPPING', spendExpenseId: 'pantry', substring: 'BULK MART' })
  })

  it('saves an edited substring and exits edit mode on Enter', () => {
    const dispatch = vi.fn()
    renderTab({ dispatch })
    fireEvent.click(screen.getByLabelText('Edit substring WHOLE FOODS'))
    const input = screen.getByLabelText('Edit mapping substring')
    fireEvent.change(input, { target: { value: 'TRADER JOES' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(dispatch).toHaveBeenCalledWith({ type: 'UPDATE_CATEGORY_MAPPING', id: 'whole-foods', patch: { substring: 'TRADER JOES' } })
    expect(screen.queryByLabelText('Edit mapping substring')).toBeNull()
  })

  it('reflects exclusion state and dispatches its next value', () => {
    const data = fixture()
    data.categories[0] = { ...data.categories[0], excludeFromSpend: true }
    const categoryDispatch = vi.fn()
    renderTab({ ...data, categoryDispatch })
    const checkbox = screen.getByLabelText('Exclude Groceries from spend tracking') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    fireEvent.click(checkbox)
    expect(categoryDispatch).toHaveBeenCalledWith({ type: 'SET_CATEGORY_EXCLUDE_FROM_SPEND', id: 'grocery', exclude: false })
  })

})

describe('CategoryMappingTab automatic reapply', () => {
  function Harness({ initialMappings }: { initialMappings: CategoryMapping[] }) {
    const data = fixture()
    const initial = { ...data.state, categoryMappings: initialMappings }
    initial.budgetTransactions = [{ id: 'tx', date: '2026-01-01', description: 'TRADER JOES', categoryId: 'other', amount: 10, spendExpenseId: 'old' }]
    const [state, setState] = useState(initial)
    return (
      <>
        <pre data-testid="transaction">{JSON.stringify(state.budgetTransactions[0])}</pre>
        <pre data-testid="mappings">{JSON.stringify(state.categoryMappings)}</pre>
        <CategoryMappingTab
          state={state}
          dispatch={(a) => setState((s) => appReducer(s, a))}
          categories={data.categories}
          categoryMappings={state.categoryMappings}
          categoryDispatch={vi.fn()}
          categoriesHydrated
        />
      </>
    )
  }

  function run(operation: 'add' | 'edit' | 'delete') {
    const categoryMappings = operation === 'add' ? [] : [
      { id: 'target', substring: operation === 'edit' ? 'SAFEWAY' : 'TRADER JOES', spendExpenseId: 'fresh', updatedAt: '2026-01-01T00:00:00.000Z' },
      ...(operation === 'delete' ? [{ id: 'fallback', substring: 'JOES', spendExpenseId: 'pantry', updatedAt: '2025-01-01T00:00:00.000Z' }] : []),
    ]
    render(<Harness initialMappings={categoryMappings} />)
  }

  it('add, edit, and delete each reapply matching transactions through the reducer', () => {
    run('add')
    const add = screen.getByLabelText('Add substring to Fresh Groceries (Groceries)')
    fireEvent.change(add, { target: { value: 'TRADER JOES' } }); fireEvent.keyDown(add, { key: 'Enter' })
    expect(JSON.parse(screen.getByTestId('mappings').textContent!)).toEqual([expect.objectContaining({ substring: 'TRADER JOES' })])
    expect(JSON.parse(screen.getByTestId('transaction').textContent!).spendExpenseId).toBe('fresh')
    cleanup(); run('edit')
    fireEvent.click(screen.getByLabelText('Edit substring SAFEWAY')); fireEvent.change(screen.getByLabelText('Edit mapping substring'), { target: { value: 'TRADER JOES' } }); fireEvent.click(screen.getByText('Done'))
    expect(JSON.parse(screen.getByTestId('mappings').textContent!)).toEqual([expect.objectContaining({ substring: 'TRADER JOES' })])
    expect(JSON.parse(screen.getByTestId('transaction').textContent!).spendExpenseId).toBe('fresh')
    cleanup(); run('delete'); vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByLabelText('Delete substring TRADER JOES'))
    expect(JSON.parse(screen.getByTestId('mappings').textContent!).map((m: CategoryMapping) => m.id)).toEqual(['fallback'])
  })
})
