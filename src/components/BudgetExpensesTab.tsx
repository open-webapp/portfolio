import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { AppState } from '../lib/state'
import { expenseDefinitionInUse } from '../lib/state'
import type { CategoryAction } from '../lib/categoryStore'
import type { Category } from '../lib/types'
import { fmtUSD, LOSS_COLOR } from '../lib/computations'
import { uid } from '../lib/seed'
import { categoryBreakdown, availableBudgetYears, visibleExpenses } from '../lib/selectors'

export interface BudgetExpensesTabProps {
  state: AppState
  dispatch: (action: any) => void
  categories: Category[]
  categoryDispatch: (action: CategoryAction) => void
}

/**
 * Selecting the "+ Add new category…" sentinel from any category <select> in
 * this component opens the new-category dialog instead of `apply`ing
 * directly; any other selection is passed straight through to `apply`.
 */
type NewCategoryPrompt = { apply: (categoryId: string) => void }

function handleCategorySelectChange(
  value: string,
  openNewCategoryDialog: (prompt: NewCategoryPrompt) => void,
  apply: (categoryId: string) => void
) {
  if (value === '__add_new') {
    openNewCategoryDialog({ apply })
    return
  }
  apply(value)
}

const iconBtn: CSSProperties = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  padding: '4px',
  display: 'inline-flex',
  alignItems: 'center',
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
      <path d="M3 6h18"></path>
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
      <path d="M10 11v6"></path>
      <path d="M14 11v6"></path>
    </svg>
  )
}

function SortIcon({ dir }: { dir: 'asc' | 'desc' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="11" height="11">
      {dir === 'asc' ? <path d="M12 19V5M5 12l7-7 7 7"></path> : <path d="M12 5v14M5 12l7 7 7-7"></path>}
    </svg>
  )
}

type CellField = 'name' | 'category' | 'frequency' | `amount:${string}`

/**
 * Expenses tab: Category Breakdown (own independent year selector) on top,
 * multi-year Expense table below (one row per ExpenseDefinition, one Amount
 * column per year in the union-of-years set, always including the real
 * current calendar year). Per-cell edit for Name/Category/Frequency mutates
 * the shared ExpenseDefinition (visible under every year); per-cell edit for
 * an Amount cell dispatches SET_EXPENSE_AMOUNT/CLEAR_EXPENSE_AMOUNT scoped to
 * that one (year, expenseId) pair only.
 */
export function BudgetExpensesTab({ state, dispatch, categories, categoryDispatch }: BudgetExpensesTabProps) {
  const categoriesById = new Map(categories.map((c) => [c.id, c.name]))
  const [breakdownYear, setBreakdownYear] = useState(
    () => availableBudgetYears(state.budgetTransactions, new Date())[0]
  )
  const [filterCategoryId, setFilterCategoryId] = useState('__all')
  const [sortBy, setSortBy] = useState<'category' | 'name'>('category')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [showAddExpenseDialog, setShowAddExpenseDialog] = useState(false)
  const [formName, setFormName] = useState('')
  const [formCategoryId, setFormCategoryId] = useState(categories[0]?.id ?? '')
  const [formAmount, setFormAmount] = useState('')
  const [formFrequency, setFormFrequency] = useState<'monthly' | 'yearly'>('monthly')
  const [newCategoryPrompt, setNewCategoryPrompt] = useState<NewCategoryPrompt | null>(null)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [editingCell, setEditingCell] = useState<{ rowId: string; field: CellField } | null>(null)
  const [cellDraft, setCellDraft] = useState('')
  const skipBlurCommitRef = useRef(false)

  const submitNewCategory = () => {
    if (!newCategoryPrompt) return
    const name = newCategoryName.trim()
    if (!name) return
    const id = uid('category')
    categoryDispatch({ type: 'ADD_CATEGORY', id, name })
    newCategoryPrompt.apply(id)
    setNewCategoryPrompt(null)
    setNewCategoryName('')
  }

  const breakdownTransactions = state.budgetTransactions.filter((t) => t.date.slice(0, 4) === breakdownYear)
  const breakdown = categoryBreakdown(
    state.budgetExpenseDefinitions,
    state.budgetExpenseAmountsByYear[breakdownYear] ?? {},
    breakdownTransactions,
    categories
  )

  // Union of years in budgetTransactions + budgetIncomeByYear + budgetExpenseAmountsByYear,
  // plus always the real current calendar year, ascending, uncapped.
  const years = (() => {
    const set = new Set<string>([String(new Date().getFullYear())])
    state.budgetTransactions.forEach((t) => set.add(t.date.slice(0, 4)))
    Object.keys(state.budgetIncomeByYear).forEach((y) => set.add(y))
    Object.keys(state.budgetExpenseAmountsByYear).forEach((y) => set.add(y))
    return [...set].sort()
  })()

  const sortedDefinitions = visibleExpenses(state.budgetExpenseDefinitions, {}, filterCategoryId, sortBy, categoriesById)
  const rows = sortDir === 'desc' ? [...sortedDefinitions].reverse() : sortedDefinitions
  const toggleSort = (field: 'category' | 'name') => {
    if (sortBy === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(field)
      setSortDir('asc')
    }
  }

  const isEditing = (rowId: string, field: CellField) => editingCell?.rowId === rowId && editingCell.field === field

  const startEdit = (rowId: string, field: CellField, currentValue: string) => {
    if (isEditing(rowId, field)) return
    setEditingCell({ rowId, field })
    setCellDraft(currentValue)
  }

  const commitEdit = (rowId: string, field: CellField, value: string) => {
    if (field === 'name') {
      dispatch({ type: 'UPDATE_EXPENSE_DEFINITION', id: rowId, patch: { name: value } })
    } else if (field.startsWith('amount:')) {
      const year = field.slice('amount:'.length)
      const trimmed = value.trim()
      if (trimmed === '') {
        dispatch({ type: 'CLEAR_EXPENSE_AMOUNT', year, expenseId: rowId })
      } else {
        dispatch({ type: 'SET_EXPENSE_AMOUNT', year, expenseId: rowId, amount: Number(trimmed) })
      }
    }
    setEditingCell(null)
    setCellDraft('')
  }

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      skipBlurCommitRef.current = true
      e.currentTarget.blur()
    }
  }

  const handleInputBlur = (rowId: string, field: CellField) => {
    if (!editingCell) return
    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false
      setEditingCell(null)
      setCellDraft('')
      return
    }
    commitEdit(rowId, field, cellDraft)
  }

  return (
    <>
      <div className="card blueprint elev-sm" style={{ marginBottom: 'var(--space-4)' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-3)',
          }}
        >
          <div className="card-title">Category Breakdown</div>
          <div className="field" style={{ maxWidth: '160px', margin: 0 }}>
            <label>Year</label>
            <select
              className="input"
              aria-label="Select breakdown year"
              value={breakdownYear}
              onChange={(e) => setBreakdownYear(e.target.value)}
            >
              {availableBudgetYears(state.budgetTransactions, new Date()).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>
        {breakdown.length === 0 ? (
          <div className="text-muted" style={{ fontSize: '12px' }}>
            Add expenses to see the breakdown.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {breakdown.map(({ name, amount, actual, variance, budgetPct, actualPct, actualColor, varianceColor }) => (
              <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div>{name}</div>
                  <div style={{ fontSize: '12px', color: varianceColor }}>
                    {variance < 0
                      ? `Over by ${fmtUSD(Math.abs(variance))}`
                      : `Under by ${fmtUSD(Math.abs(variance))}`}
                  </div>
                </div>
                <div style={{ position: 'relative', width: '100%', height: '8px' }}>
                  <div
                    data-testid="category-bar-budget"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: `${budgetPct}%`,
                      height: '100%',
                      borderRadius: '4px',
                      background: 'var(--color-border, #e5e5e5)',
                    }}
                  />
                  <div
                    data-testid="category-bar-fill"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: `${actualPct}%`,
                      height: '100%',
                      borderRadius: '4px',
                      background: actualColor,
                    }}
                  />
                </div>
                <div className="text-muted" style={{ fontSize: '12px' }}>
                  Budget {fmtUSD(amount)} · Actual {fmtUSD(actual)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card blueprint elev-sm">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-4)',
          }}
        >
          <div className="card-title">Expenses</div>
          <div className="field" style={{ margin: 0 }}>
            <label>Filter by category</label>
            <select
              className="input"
              aria-label="Filter by category"
              value={filterCategoryId}
              onChange={(e) => setFilterCategoryId(e.target.value)}
            >
              <option value="__all">All categories</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="text-muted" style={{ fontSize: '12px', padding: 'var(--space-4) 0' }}>
            No expenses to show.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th aria-label="Sort by name" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('name')}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                    Name
                    {sortBy === 'name' && <SortIcon dir={sortDir} />}
                  </span>
                </th>
                <th aria-label="Sort by category" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('category')}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                    Category
                    {sortBy === 'category' && <SortIcon dir={sortDir} />}
                  </span>
                </th>
                <th>Frequency</th>
                {years.map((y) => (
                  <th key={y} style={{ textAlign: 'right' }}>
                    {y}
                  </th>
                ))}
                <th style={{ width: '110px' }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td onClick={() => startEdit(row.id, 'name', row.name)}>
                    {isEditing(row.id, 'name') ? (
                      <input
                        type="text"
                        className="input"
                        aria-label="Edit expense name"
                        autoFocus
                        value={cellDraft}
                        onChange={(e) => setCellDraft(e.target.value)}
                        onKeyDown={handleInputKeyDown}
                        onBlur={() => handleInputBlur(row.id, 'name')}
                      />
                    ) : (
                      row.name
                    )}
                  </td>
                  <td onClick={() => startEdit(row.id, 'category', row.categoryId)}>
                    {isEditing(row.id, 'category') ? (
                      <select
                        className="input"
                        aria-label="Edit expense category"
                        autoFocus
                        value={cellDraft}
                        onChange={(e) =>
                          handleCategorySelectChange(e.target.value, setNewCategoryPrompt, (categoryId) => {
                            dispatch({ type: 'UPDATE_EXPENSE_DEFINITION', id: row.id, patch: { categoryId } })
                            setEditingCell(null)
                            setCellDraft('')
                          })
                        }
                      >
                        {categories.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.name}
                          </option>
                        ))}
                        <option value="__add_new">+ Add new category…</option>
                      </select>
                    ) : (
                      <span className="tag tag-neutral">{categoriesById.get(row.categoryId) ?? row.categoryId}</span>
                    )}
                  </td>
                  <td onClick={() => startEdit(row.id, 'frequency', row.frequency)}>
                    {isEditing(row.id, 'frequency') ? (
                      <select
                        className="input"
                        aria-label="Edit expense frequency"
                        autoFocus
                        value={row.frequency}
                        onChange={(e) => {
                          dispatch({
                            type: 'UPDATE_EXPENSE_DEFINITION',
                            id: row.id,
                            patch: { frequency: e.target.value as 'monthly' | 'yearly' },
                          })
                          setEditingCell(null)
                          setCellDraft('')
                        }}
                      >
                        <option value="monthly">Monthly</option>
                        <option value="yearly">Yearly</option>
                      </select>
                    ) : row.frequency === 'monthly' ? (
                      'Monthly'
                    ) : (
                      'Yearly'
                    )}
                  </td>
                  {years.map((y) => {
                    const field: CellField = `amount:${y}`
                    const amount = state.budgetExpenseAmountsByYear[y]?.[row.id]
                    return (
                      <td
                        key={y}
                        style={{ textAlign: 'right' }}
                        onClick={() => startEdit(row.id, field, amount !== undefined ? String(amount) : '')}
                      >
                        {isEditing(row.id, field) ? (
                          <input
                            type="number"
                            className="input"
                            aria-label={`Edit expense amount ${y}`}
                            autoFocus
                            value={cellDraft}
                            onChange={(e) => setCellDraft(e.target.value)}
                            onKeyDown={handleInputKeyDown}
                            onBlur={() => handleInputBlur(row.id, field)}
                          />
                        ) : amount !== undefined ? (
                          fmtUSD(amount)
                        ) : (
                          '—'
                        )}
                      </td>
                    )
                  })}
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      style={{ ...iconBtn, color: LOSS_COLOR }}
                      aria-label="Delete expense"
                      title="Delete expense"
                      onClick={() => {
                        if (expenseDefinitionInUse(state, row.id)) {
                          window.alert('Cannot delete: this expense is used by a Spend record in at least one year.')
                          return
                        }
                        if (window.confirm('Delete this expense? This cannot be undone.')) {
                          dispatch({ type: 'DELETE_EXPENSE_DEFINITION', id: row.id })
                          categoryDispatch({ type: 'DELETE_CATEGORY_MAPPINGS_FOR_EXPENSE', spendExpenseId: row.id })
                        }
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-3)' }}>
          <button type="button" className="btn btn-primary" onClick={() => setShowAddExpenseDialog(true)}>
            Add Expense
          </button>
        </div>
      </div>

      {showAddExpenseDialog && (
        <div
          className="dialog-backdrop"
          onClick={() => {
            setShowAddExpenseDialog(false)
            setFormName('')
            setFormCategoryId(categories[0]?.id ?? '')
            setFormAmount('')
            setFormFrequency('monthly')
          }}
        >
          <div className="dialog blueprint" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">Add expense</div>
            <div className="dialog-body">
              <div className="field">
                <label>Name</label>
                <input
                  type="text"
                  className="input"
                  aria-label="Expense name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Category</label>
                <select
                  className="input"
                  aria-label="Expense category"
                  value={formCategoryId}
                  onChange={(e) => handleCategorySelectChange(e.target.value, setNewCategoryPrompt, setFormCategoryId)}
                >
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                  <option value="__add_new">+ Add new category…</option>
                </select>
              </div>
              <div className="field">
                <label>Amount</label>
                <input
                  type="number"
                  className="input"
                  aria-label="Expense amount"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Frequency</label>
                <select
                  className="input"
                  aria-label="Expense frequency"
                  value={formFrequency}
                  onChange={(e) => setFormFrequency(e.target.value as 'monthly' | 'yearly')}
                >
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
            </div>
            <div className="dialog-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setShowAddExpenseDialog(false)
                  setFormName('')
                  setFormCategoryId(categories[0]?.id ?? '')
                  setFormAmount('')
                  setFormFrequency('monthly')
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const amount = parseFloat(formAmount)
                  if (!formName.trim() || !amount || amount <= 0) return
                  dispatch({
                    type: 'ADD_EXPENSE_DEFINITION',
                    definition: { name: formName.trim(), categoryId: formCategoryId, frequency: formFrequency },
                    amount,
                  })
                  setShowAddExpenseDialog(false)
                  setFormName('')
                  setFormCategoryId(categories[0]?.id ?? '')
                  setFormAmount('')
                  setFormFrequency('monthly')
                }}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {newCategoryPrompt && (
        <div
          className="dialog-backdrop"
          onClick={() => {
            setNewCategoryPrompt(null)
            setNewCategoryName('')
          }}
        >
          <div className="dialog blueprint" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">New category</div>
            <div className="dialog-body">
              <div className="field">
                <label>Name</label>
                <input
                  type="text"
                  className="input"
                  aria-label="New category name"
                  autoFocus
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitNewCategory()
                  }}
                />
              </div>
            </div>
            <div className="dialog-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setNewCategoryPrompt(null)
                  setNewCategoryName('')
                }}
              >
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={submitNewCategory}>
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
