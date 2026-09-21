import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { AppState } from '../lib/state'
import { clearExpenseAmount, expenseDefinitionInUse, setExpenseAmount, updateExpenseDefinition } from '../lib/state'
import type { CategoryAction } from '../lib/categoryStore'
import type { Category } from '../lib/types'
import { fmtUSD, LOSS_COLOR } from '../lib/computations'
import { uid } from '../lib/seed'
import { categoryBreakdown, availableBudgetYears, expenseTableYears, overBudgetCategories, visibleExpenses } from '../lib/selectors'
import { parseExpensePaste } from '../lib/expensePasteImport'
import { planExpensePasteImport } from '../lib/state'
import { buildExpenseCsv } from '../lib/expenseExport'
import { downloadCsvAsFile } from '../lib/importExport'

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

function ChevronIcon({ direction }: { direction: 'right' | 'down' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
      {direction === 'right' ? <path d="m9 18 6-6-6-6"></path> : <path d="m6 9 6 6 6-6"></path>}
    </svg>
  )
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <path d="M14 2v6h6"></path>
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <circle cx="11" cy="11" r="6"></circle>
      <path d="m16 16 4 4"></path>
    </svg>
  )
}

function AlertTriangleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"></path>
      <path d="M12 9v4"></path>
      <path d="M12 17h.01"></path>
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <path d="m9 18 6-6-6-6"></path>
    </svg>
  )
}

type CellField = 'name' | 'category' | 'frequency' | `amount:${string}`

/**
 * Expenses tab: multi-year Expense table on top (one row per ExpenseDefinition, one Amount
 * column per year in the union-of-years set, always including the real
 * current calendar year), followed by Category Breakdown with its own year
 * selector and expandable per-category drilldown. Per-cell edit for Name/Category/Frequency mutates
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
  const [showImportExpensesDialog, setShowImportExpensesDialog] = useState(false)
  const [importYear, setImportYear] = useState(() => String(new Date().getFullYear()))
  const [importText, setImportText] = useState('')
  const [importResult, setImportResult] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formCategoryId, setFormCategoryId] = useState(categories[0]?.id ?? '')
  const [formAmount, setFormAmount] = useState('')
  const [formFrequency, setFormFrequency] = useState<'monthly' | 'yearly'>('monthly')
  const [newCategoryPrompt, setNewCategoryPrompt] = useState<NewCategoryPrompt | null>(null)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [editingCell, setEditingCell] = useState<{ rowId: string; field: CellField } | null>(null)
  const [cellDraft, setCellDraft] = useState('')
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null)
  const skipBlurCommitRef = useRef(false)
  const pendingCommitStateRef = useRef<{ before: AppState; after: AppState } | null>(null)

  const parsedExpensePaste = parseExpensePaste(importText)
  const hasValidImportYear = /^\d{4}$/.test(importYear)
  const uncategorizedCategoryId = categories.find((category) => category.name.trim().toLowerCase() === 'uncategorized')?.id
  const expensePastePlan = hasValidImportYear
    ? planExpensePasteImport(state, importYear, uncategorizedCategoryId ?? '', parsedExpensePaste.validRows)
    : null

  const closeImportExpensesDialog = () => {
    setShowImportExpensesDialog(false)
    setImportYear(String(new Date().getFullYear()))
    setImportText('')
    setImportResult(null)
  }

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
  const actionItems = overBudgetCategories(
    state.budgetExpenseDefinitions,
    state.budgetExpenseAmountsByYear,
    state.budgetTransactions,
    categories,
    breakdownYear
  )
  const summaryTransactions = breakdownTransactions.map((transaction) => ({
    ...transaction,
    magnitude: Math.abs(transaction.amount),
  }))
  const totalSpend = summaryTransactions.reduce((total, transaction) => total + transaction.magnitude, 0)
  const totalBudget = Object.values(state.budgetExpenseAmountsByYear[breakdownYear] ?? {}).reduce((total, amount) => total + Math.abs(amount), 0)
  const averageTransaction = summaryTransactions.length === 0 ? 0 : totalSpend / summaryTransactions.length
  const largestTransaction = summaryTransactions.reduce<typeof summaryTransactions[number] | null>(
    (largest, transaction) => largest === null || transaction.magnitude > largest.magnitude ? transaction : largest,
    null
  )
  const categoryTotals = new Map<string, number>()
  for (const transaction of summaryTransactions) {
    categoryTotals.set(transaction.categoryId, (categoryTotals.get(transaction.categoryId) ?? 0) + transaction.magnitude)
  }
  const topCategory = [...categoryTotals.entries()].reduce<[string, number] | null>(
    (top, entry) => top === null || entry[1] > top[1] ? entry : top,
    null
  )
  const percentOf = (value: number, total: number) => total === 0 ? 0 : Math.min(100, (value / total) * 100)

  const years = expenseTableYears(state.budgetTransactions, state.budgetExpenseAmountsByYear, new Date())

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
    let postCommitState = state
    if (field === 'name') {
      dispatch({ type: 'UPDATE_EXPENSE_DEFINITION', id: rowId, patch: { name: value } })
      postCommitState = updateExpenseDefinition(state, rowId, { name: value })
    } else if (field.startsWith('amount:')) {
      const year = field.slice('amount:'.length)
      const trimmed = value.trim()
      if (trimmed === '') {
        dispatch({ type: 'CLEAR_EXPENSE_AMOUNT', year, expenseId: rowId })
        postCommitState = clearExpenseAmount(state, year, rowId)
      } else {
        const amount = Number(trimmed)
        dispatch({ type: 'SET_EXPENSE_AMOUNT', year, expenseId: rowId, amount })
        postCommitState = setExpenseAmount(state, year, rowId, amount)
      }
    }
    pendingCommitStateRef.current = { before: state, after: postCommitState }
    setEditingCell(null)
    setCellDraft('')
    return postCommitState
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
        <div className="card-title" style={{ marginBottom: 'var(--space-3)' }}>Expense Summary</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-3)' }}>
          <div data-testid="expense-summary-spend">
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <span aria-hidden="true" style={{ width: '26px', height: '26px', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-accent-soft, #eef5ff)', color: 'var(--color-accent, #2563eb)' }}><FileIcon /></span>
              <div className="text-muted" style={{ fontSize: '12px' }}>Spend</div>
            </div>
            <div style={{ fontSize: '20px', marginTop: 'var(--space-2)' }}>{fmtUSD(totalSpend)}</div>
            <div style={{ position: 'relative', height: '6px', marginTop: 'var(--space-2)', background: 'var(--color-border, #e5e5e5)', borderRadius: '3px' }}><div data-testid="expense-summary-spend-bar" style={{ width: `${percentOf(totalSpend, totalBudget)}%`, height: '100%', borderRadius: '3px', background: 'var(--color-accent, #2563eb)' }} /></div>
            <div className="text-muted" style={{ fontSize: '11px', marginTop: 'var(--space-1)' }}>of {fmtUSD(totalBudget)} budget</div>
          </div>
          <div data-testid="expense-summary-average">
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <span aria-hidden="true" style={{ width: '26px', height: '26px', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-accent-soft, #eef5ff)', color: 'var(--color-accent, #2563eb)' }}><SearchIcon /></span>
              <div className="text-muted" style={{ fontSize: '12px' }}>Average transaction</div>
            </div>
            <div style={{ fontSize: '20px', marginTop: 'var(--space-2)' }}>{fmtUSD(averageTransaction)}</div>
            <div style={{ position: 'relative', height: '6px', marginTop: 'var(--space-2)', background: 'var(--color-border, #e5e5e5)', borderRadius: '3px' }}><div data-testid="expense-summary-average-bar" style={{ width: `${percentOf(averageTransaction, largestTransaction?.magnitude ?? 0)}%`, height: '100%', borderRadius: '3px', background: 'var(--color-accent, #2563eb)' }} /></div>
            <div className="text-muted" style={{ fontSize: '11px', marginTop: 'var(--space-1)' }}>vs largest transaction</div>
          </div>
          <div data-testid="expense-summary-largest">
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <span aria-hidden="true" style={{ width: '26px', height: '26px', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-warning-soft, #fff7ed)', color: 'var(--color-warning, #c2410c)' }}><AlertTriangleIcon /></span>
              <div className="text-muted" style={{ fontSize: '12px' }}>Largest transaction</div>
            </div>
            <div style={{ fontSize: '20px', marginTop: 'var(--space-2)' }}>{fmtUSD(largestTransaction?.magnitude ?? 0)}</div>
            {largestTransaction ? <div className="text-muted" style={{ fontSize: '11px', marginTop: 'var(--space-1)' }}><span className="tag tag-neutral">{categoriesById.get(largestTransaction.categoryId) ?? largestTransaction.categoryId}</span> {largestTransaction.description}</div> : <div className="text-muted" style={{ fontSize: '11px', marginTop: 'var(--space-1)' }}>No transactions</div>}
          </div>
          <div data-testid="expense-summary-top-category">
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <span aria-hidden="true" style={{ width: '26px', height: '26px', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-accent-soft, #eef5ff)', color: 'var(--color-accent, #2563eb)' }}><ChevronRightIcon /></span>
              <div className="text-muted" style={{ fontSize: '12px' }}>Top category by spend</div>
            </div>
            <div style={{ fontSize: '20px', marginTop: 'var(--space-2)' }}>{fmtUSD(topCategory?.[1] ?? 0)}</div>
            <div style={{ position: 'relative', height: '6px', marginTop: 'var(--space-2)', background: 'var(--color-border, #e5e5e5)', borderRadius: '3px' }}><div data-testid="expense-summary-top-category-bar" style={{ width: `${percentOf(topCategory?.[1] ?? 0, totalSpend)}%`, height: '100%', borderRadius: '3px', background: 'var(--color-accent, #2563eb)' }} /></div>
            <div className="text-muted" style={{ fontSize: '11px', marginTop: 'var(--space-1)' }}>{topCategory ? `${categoriesById.get(topCategory[0]) ?? topCategory[0]} · ${fmtUSD(topCategory[1])}` : 'No transactions'}</div>
          </div>
        </div>
      </div>
      <div className="card blueprint elev-sm" data-testid="category-breakdown" style={{ marginBottom: 'var(--space-4)' }}>
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
            {breakdown.map(({ categoryId, name, amount, actual, variance, budgetPct, actualPct, actualColor, varianceColor, drillLines, unlinkedActual }) => (
              <div key={categoryId} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                <div
                  style={{ cursor: 'pointer' }}
                  onClick={() => setExpandedCategoryId((id) => (id === categoryId ? null : categoryId))}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                      <ChevronIcon direction={expandedCategoryId === categoryId ? 'down' : 'right'} />
                      {name}
                    </div>
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
                {expandedCategoryId === categoryId && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-2) 0 0 var(--space-4)' }}>
                    {drillLines.map((line) => (
                      <div key={line.id} data-testid={`category-drill-line-${line.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: '12px' }}>
                          <div>{line.name} ({line.frequencyLabel})</div>
                          <div style={{ fontSize: '11px', color: line.varianceColor }}>
                            {line.variance < 0
                              ? `Over by ${fmtUSD(Math.abs(line.variance))}`
                              : `Under by ${fmtUSD(Math.abs(line.variance))}`}
                          </div>
                        </div>
                        <div style={{ position: 'relative', width: '100%', height: '6px' }}>
                          <div style={{ position: 'absolute', top: 0, left: 0, width: `${line.budgetPct}%`, height: '100%', borderRadius: '3px', background: 'var(--color-border, #e5e5e5)' }} />
                          <div style={{ position: 'absolute', top: 0, left: 0, width: `${line.actualPct}%`, height: '100%', borderRadius: '3px', background: line.actualColor }} />
                        </div>
                        <div className="text-muted" style={{ fontSize: '11px' }}>
                          Budget {fmtUSD(line.budget)} · Actual {fmtUSD(line.actual)}
                        </div>
                      </div>
                    ))}
                    {unlinkedActual !== null && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                        <div>Unlinked transactions</div>
                        <div>{fmtUSD(unlinkedActual)}</div>
                      </div>
                    )}
                    {drillLines.length === 0 && unlinkedActual === null && (
                      <div className="text-muted" style={{ fontSize: '12px' }}>
                        No budget lines in this category.
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card blueprint elev-sm" data-testid="expense-action-items" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="card-title" style={{ marginBottom: 'var(--space-3)' }}>Action items</div>
        {actionItems.length === 0 ? (
          <div className="text-muted" style={{ fontSize: '12px' }}>No categories over budget</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {actionItems.map((item) => (
              <div
                key={item.categoryId}
                data-testid="expense-action-item"
                style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', padding: 'var(--space-3)', borderRadius: 'var(--radius, 6px)', background: 'var(--color-warning-soft, #fff7ed)', color: 'var(--color-warning, #c2410c)' }}
              >
                <span aria-hidden="true"><AlertTriangleIcon /></span>
                <div>
                  <div>{item.label} is {fmtUSD(item.overageAmount)} over budget ({Number.isFinite(item.pctOver) ? item.pctOver.toFixed(1) : '∞'}%)</div>
                  <div className="text-muted" style={{ fontSize: '12px' }}>Review recent transactions in this category</div>
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

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              const exportState = editingCell && (editingCell.field === 'name' || editingCell.field.startsWith('amount:'))
                ? commitEdit(editingCell.rowId, editingCell.field, cellDraft)
                : pendingCommitStateRef.current?.before === state
                  ? pendingCommitStateRef.current.after
                  : state
              const exportDate = new Date()
              const csv = buildExpenseCsv(
                exportState.budgetExpenseDefinitions,
                exportState.budgetExpenseAmountsByYear,
                exportState.budgetTransactions,
                categories,
                exportDate
              )
              const filename = `expenses-${exportDate.getFullYear()}-${String(exportDate.getMonth() + 1).padStart(2, '0')}-${String(exportDate.getDate()).padStart(2, '0')}.csv`
              downloadCsvAsFile(csv, filename)
            }}
          >
            Download Expenses
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setShowImportExpensesDialog(true)}>
            Import expenses
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setShowAddExpenseDialog(true)}>
            Add Expense
          </button>
        </div>
      </div>


      {showImportExpensesDialog && (
        <div className="dialog-backdrop" onClick={closeImportExpensesDialog}>
          <div className="dialog blueprint" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">Import expenses</div>
            <div className="dialog-body">
              <div className="field">
                <label>Year</label>
                <input
                  type="text"
                  className="input"
                  aria-label="Import expense year"
                  value={importYear}
                  onChange={(e) => {
                    setImportYear(e.target.value)
                    setImportResult(null)
                  }}
                />
                {!hasValidImportYear && <div className="text-muted" style={{ fontSize: '12px' }}>Enter a four-digit year.</div>}
              </div>
              <div className="field">
                <label>Paste expenses</label>
                <textarea
                  className="input"
                  aria-label="Paste expenses"
                  rows={8}
                  value={importText}
                  onChange={(e) => {
                    setImportText(e.target.value)
                    setImportResult(null)
                  }}
                />
                <div className="text-muted" style={{ fontSize: '12px' }}>
                  Paste a header row followed by Name and Amount rows, separated by tabs or commas.
                </div>
              </div>
              <div className="text-muted" style={{ fontSize: '12px' }}>
                Total data lines: {parsedExpensePaste.totalDataLines} · Valid: {expensePastePlan?.stats.valid ?? parsedExpensePaste.validRows.length} · Imported: {expensePastePlan?.stats.imported ?? 0} · Skipped invalid: {parsedExpensePaste.errors.length} · Created: {expensePastePlan?.stats.created ?? 0} · Updated: {expensePastePlan?.stats.updated ?? 0} · Unchanged: {expensePastePlan?.stats.unchanged ?? 0}
              </div>
              {parsedExpensePaste.errors.length > 0 && (
                <ul className="text-muted" style={{ fontSize: '12px', margin: 'var(--space-2) 0 0', paddingLeft: 'var(--space-4)' }}>
                  {parsedExpensePaste.errors.map((error) => (
                    <li key={`${error.lineNumber}-${error.reason}`}>Line {error.lineNumber}: {error.reason}</li>
                  ))}
                </ul>
              )}
              {importResult && <div className="text-muted" style={{ fontSize: '12px' }}>{importResult}</div>}
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={closeImportExpensesDialog}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!hasValidImportYear || parsedExpensePaste.validRows.length === 0}
                onClick={() => {
                  if (!hasValidImportYear || parsedExpensePaste.validRows.length === 0) return
                  const categoryId = uncategorizedCategoryId ?? uid('category')
                  if (!uncategorizedCategoryId) {
                    categoryDispatch({ type: 'ADD_CATEGORY', id: categoryId, name: 'Uncategorized' })
                  }
                  const finalPlan = planExpensePasteImport(state, importYear, categoryId, parsedExpensePaste.validRows)
                  dispatch({
                    type: 'IMPORT_EXPENSE_PASTE',
                    year: importYear,
                    uncategorizedCategoryId: categoryId,
                    rows: parsedExpensePaste.validRows,
                  })
                  setImportResult(`Imported ${finalPlan.stats.imported} expense${finalPlan.stats.imported === 1 ? '' : 's'}: ${finalPlan.stats.created} created, ${finalPlan.stats.updated} updated, ${finalPlan.stats.unchanged} unchanged.`)
                }}
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}

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
