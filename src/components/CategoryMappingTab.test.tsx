import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CategoryMappingTab } from './CategoryMappingTab'
import { initialState } from '../lib/state'
import { appReducer } from '../lib/reducer'
import { categoryStoreReducer, type GlobalCategoryState } from '../lib/categoryStore'
import type { Category, CategoryMapping } from '../lib/types'
import * as importExportModule from '../lib/importExport'

vi.mock('../lib/importExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/importExport')>()),
  downloadJsonAsFile: vi.fn(),
}))

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
    const categoryDispatch = vi.fn()
    renderTab({ categoryDispatch })
    const text = screen.getByText('WHOLE FOODS')
    const row = text.parentElement!
    expect(Array.from(row.children).indexOf(screen.getByLabelText('Edit substring WHOLE FOODS'))).toBeLessThan(Array.from(row.children).indexOf(text))
    expect(Array.from(row.children).indexOf(text)).toBeLessThan(Array.from(row.children).indexOf(screen.getByLabelText('Delete substring WHOLE FOODS')))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByLabelText('Delete substring WHOLE FOODS'))
    expect(window.confirm).toHaveBeenCalledWith('Delete this mapping? This cannot be undone.')
    expect(categoryDispatch).toHaveBeenCalledWith({ type: 'DELETE_CATEGORY_MAPPING', id: 'whole-foods' })
  })

  it('does not delete a mapping when confirmation is declined', () => {
    const categoryDispatch = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderTab({ categoryDispatch })
    fireEvent.click(screen.getByLabelText('Delete substring WHOLE FOODS'))
    expect(categoryDispatch).not.toHaveBeenCalled()
  })

  it('does not show tombstoned mappings', () => {
    const data = fixture()
    data.categoryMappings.push({ id: 'deleted', substring: 'OLD MARKET', spendExpenseId: 'fresh', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: '2026-01-02T00:00:00.000Z' })
    renderTab(data)
    expect(screen.getByText('WHOLE FOODS')).toBeTruthy()
    expect(screen.queryByText('OLD MARKET')).toBeNull()
  })

  it('adds definition-scoped substrings by button and Enter', () => {
    const categoryDispatch = vi.fn()
    renderTab({ categoryDispatch })
    const fresh = screen.getByLabelText('Add substring to Fresh Groceries (Groceries)')
    fireEvent.change(fresh, { target: { value: 'COSTCO' } })
    fireEvent.click(screen.getByLabelText('Add substring button Fresh Groceries (Groceries)'))
    const pantry = screen.getByLabelText('Add substring to Pantry Groceries (Groceries)')
    fireEvent.change(pantry, { target: { value: 'BULK MART' } })
    fireEvent.keyDown(pantry, { key: 'Enter' })
    expect(categoryDispatch).toHaveBeenCalledWith({ type: 'ADD_CATEGORY_MAPPING', spendExpenseId: 'fresh', substring: 'COSTCO' })
    expect(categoryDispatch).toHaveBeenCalledWith({ type: 'ADD_CATEGORY_MAPPING', spendExpenseId: 'pantry', substring: 'BULK MART' })
  })

  it('saves an edited substring and exits edit mode on Enter', () => {
    const categoryDispatch = vi.fn()
    const dispatch = vi.fn()
    renderTab({ categoryDispatch, dispatch })
    fireEvent.click(screen.getByLabelText('Edit substring WHOLE FOODS'))
    const input = screen.getByLabelText('Edit mapping substring')
    fireEvent.change(input, { target: { value: 'TRADER JOES' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(categoryDispatch).toHaveBeenCalledWith({ type: 'UPDATE_CATEGORY_MAPPING', id: 'whole-foods', patch: { substring: 'TRADER JOES' } })
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'REAPPLY_CATEGORY_MAPPINGS' }))
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

  it('exports a dated mapping file and resets the file input after every selection', async () => {
    const data = fixture()
    const categoryDispatch = vi.fn()
    renderTab({ ...data, categoryDispatch })
    fireEvent.click(screen.getByRole('button', { name: 'Download Category Mapping' }))
    expect(importExportModule.downloadJsonAsFile).toHaveBeenCalledWith({ categories: data.categories, categoryMappings: data.categoryMappings, budgetAccountRules: [] }, expect.stringMatching(/^category-mappings-\d{4}-\d{2}-\d{2}\.json$/))
    const input = screen.getByLabelText('Import Category Mapping file') as HTMLInputElement
    const file = new File([JSON.stringify({ categories: [], categoryMappings: [] })], 'mapping.json', { type: 'application/json' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(categoryDispatch).toHaveBeenCalledWith({ type: '__MERGE_IMPORTED', imported: { categories: [], categoryMappings: [], budgetAccountRules: [] } }))
    expect(input.value).toBe('')
  })

  it('shows parser errors without dispatching', async () => {
    const categoryDispatch = vi.fn()
    renderTab({ categoryDispatch })
    fireEvent.change(screen.getByLabelText('Import Category Mapping file'), { target: { files: [new File(['bad'], 'bad.json')] } })
    await waitFor(() => expect(screen.getByText('Import file is not valid JSON.')).toBeTruthy())
    expect(categoryDispatch).not.toHaveBeenCalled()
  })
})

describe('CategoryMappingTab automatic reapply', () => {
  function Harness({ initialCategoryState, operation }: { initialCategoryState: GlobalCategoryState; operation: 'add' | 'edit' | 'delete' | 'import' }) {
    const initial = fixture().state
    initial.budgetTransactions = [{ id: 'tx', date: '2026-01-01', description: 'TRADER JOES', categoryId: 'other', amount: 10, spendExpenseId: 'old' }]
    const [state, setState] = useState(initial)
    const [categoryState, setCategoryState] = useState(initialCategoryState)
    const actions = (window as any).__mappingActions ?? ((window as any).__mappingActions = [])
    return <><pre data-testid="transaction">{JSON.stringify(state.budgetTransactions[0])}</pre><CategoryMappingTab state={state} dispatch={(a) => { actions.push(a); setState((s) => appReducer(s, a)) }} categories={categoryState.categories} categoryMappings={categoryState.categoryMappings} categoryDispatch={(a) => setCategoryState((s) => categoryStoreReducer(s, a))} categoriesHydrated /></>
  }

  function run(operation: 'add' | 'edit' | 'delete' | 'import') {
    ;(window as any).__mappingActions = []
    const data = fixture()
    const categoryMappings = operation === 'add' || operation === 'import' ? [] : [
      { id: 'target', substring: operation === 'edit' ? 'SAFEWAY' : 'TRADER JOES', spendExpenseId: 'fresh', updatedAt: '2026-01-01T00:00:00.000Z' },
      ...(operation === 'delete' ? [{ id: 'fallback', substring: 'JOES', spendExpenseId: 'pantry', updatedAt: '2025-01-01T00:00:00.000Z' }] : []),
    ]
    render(<Harness initialCategoryState={{ categories: data.categories, categoryMappings }} operation={operation} />)
    return data
  }

  it('add, edit, delete, and import each dispatch immediate next mappings and reapply matching transactions', async () => {
    run('add')
    const add = screen.getByLabelText('Add substring to Fresh Groceries (Groceries)')
    fireEvent.change(add, { target: { value: 'TRADER JOES' } }); fireEvent.keyDown(add, { key: 'Enter' })
    expect((window as any).__mappingActions.at(-1)).toMatchObject({ type: 'REAPPLY_CATEGORY_MAPPINGS', categoryMappings: [expect.objectContaining({ substring: 'TRADER JOES' })] })
    expect(JSON.parse(screen.getByTestId('transaction').textContent!).spendExpenseId).toBe('fresh')
    cleanup(); run('edit')
    fireEvent.click(screen.getByLabelText('Edit substring SAFEWAY')); fireEvent.change(screen.getByLabelText('Edit mapping substring'), { target: { value: 'TRADER JOES' } }); fireEvent.click(screen.getByText('Done'))
    expect((window as any).__mappingActions.at(-1)).toMatchObject({ type: 'REAPPLY_CATEGORY_MAPPINGS', categoryMappings: [expect.objectContaining({ substring: 'TRADER JOES' })] })
    expect(JSON.parse(screen.getByTestId('transaction').textContent!).spendExpenseId).toBe('fresh')
    cleanup(); run('delete'); vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByLabelText('Delete substring TRADER JOES'))
    expect((window as any).__mappingActions.at(-1)).toMatchObject({ type: 'REAPPLY_CATEGORY_MAPPINGS', categoryMappings: expect.any(Array) })
    cleanup(); run('import')
    fireEvent.change(screen.getByLabelText('Import Category Mapping file'), { target: { files: [new File([JSON.stringify({ categories: [], categoryMappings: [{ id: 'import', substring: 'TRADER JOES', spendExpenseId: 'fresh', updatedAt: '2026-01-01T00:00:00.000Z' }] })], 'mapping.json')] } })
    await waitFor(() => expect((window as any).__mappingActions.at(-1)).toMatchObject({ type: 'REAPPLY_CATEGORY_MAPPINGS', categoryMappings: [expect.objectContaining({ id: 'import' })] }))
    expect(JSON.parse(screen.getByTestId('transaction').textContent!).spendExpenseId).toBe('fresh')
  })
})
