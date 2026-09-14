import { useRef, useState, type CSSProperties } from 'react'
import type { AppState } from '../lib/state'
import { fmtUSD, toPeriod, GAIN_COLOR, LOSS_COLOR, parseBudgetTransactionsCsv, parseOfxTransactions } from '../lib/computations'
import {
  visibleExpenses,
  categoryBreakdown,
  allBudgetCategories,
  budgetTransactionsForPeriod,
  actualByCategory,
  availableBudgetMonths,
  availableBudgetYears,
} from '../lib/selectors'

export interface BudgetPageProps {
  state: AppState
  dispatch: (action: any) => void
}

/**
 * Shared onChange handler for every category <select> in this component.
 * Selecting the "+ Add new category…" sentinel prompts for a new category
 * name and, if one is entered, hands it to `apply`; any other selection is
 * passed straight through to `apply`. `apply` decides what to do with the
 * resulting category value (e.g. set local field state, dispatch, etc.) —
 * this helper never dispatches itself.
 */
function handleCategorySelectChange(value: string, apply: (category: string) => void) {
  if (value === '__add_new') {
    const result = window.prompt('New category name')
    if (result && result.trim()) apply(result.trim())
    return
  }
  apply(value)
}

const textBtnAccent: CSSProperties = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  color: 'var(--color-accent)',
  fontSize: '12px',
  fontWeight: 600,
  padding: 0,
}

const iconBtn: CSSProperties = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  padding: '4px',
  display: 'inline-flex',
  alignItems: 'center',
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path>
    </svg>
  )
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

/**
 * Budget page: Monthly/Yearly period toggle, income/expense/net summary
 * cards, an income editor, an add-expense form, filter/sort controls, and
 * the expense table (inline edit/delete). Category management is added by
 * a later task extending this same component.
 */
export function BudgetPage({ state, dispatch }: BudgetPageProps) {
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly')
  const [filterCategory, setFilterCategory] = useState('__all')
  const [sortBy, setSortBy] = useState<'category' | 'name' | 'amount'>('category')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [showAddExpenseDialog, setShowAddExpenseDialog] = useState(false)
  const [formName, setFormName] = useState('')
  const categories = allBudgetCategories(state.budgetExpenses, state.budgetTransactions)
  const [formCategory, setFormCategory] = useState(categories[0] ?? '')
  const [formAmount, setFormAmount] = useState('')
  const [formFrequency, setFormFrequency] = useState<'monthly' | 'yearly'>('monthly')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editCategoryDraft, setEditCategoryDraft] = useState<string | null>(null)
  const [editingIncome, setEditingIncome] = useState(false)
  const [incomeEditAmount, setIncomeEditAmount] = useState('')
  const [selectedMonth, setSelectedMonth] = useState(
    () => availableBudgetMonths(state.budgetTransactions, new Date())[0].value
  )
  const [selectedYear, setSelectedYear] = useState(
    () => availableBudgetYears(state.budgetTransactions, new Date())[0]
  )
  const [recordDraft, setRecordDraft] = useState<{
    id: string
    date: string
    description: string
    category: string
    accountName: string
    amount: string
  } | null>(null)
  const [recDate, setRecDate] = useState('')
  const [recDescription, setRecDescription] = useState('')
  const [recCategory, setRecCategory] = useState(categories[0] ?? '')
  const [recAmount, setRecAmount] = useState('')
  const [recError, setRecError] = useState('')
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [importTab, setImportTab] = useState<'paste' | 'upload'>('paste')
  const [csvText, setCsvText] = useState('')
  const [importFileName, setImportFileName] = useState('')
  const [importAccountName, setImportAccountName] = useState('')
  const [importStatus, setImportStatus] = useState('Never imported')
  const [importError, setImportError] = useState<string | null>(null)
  const importFileInputRef = useRef<HTMLInputElement>(null)

  const totalIncome =
    period === 'monthly'
      ? state.budgetIncomeMonthly + state.budgetIncomeYearly / 12
      : state.budgetIncomeMonthly * 12 + state.budgetIncomeYearly

  const totalExpense = state.budgetExpenses.reduce(
    (sum, e) => sum + toPeriod(e.amount, e.frequency, period),
    0
  )

  const availableMonths = availableBudgetMonths(state.budgetTransactions, new Date())
  const availableYears = availableBudgetYears(state.budgetTransactions, new Date())
  const currentMonthValue = new Date().toISOString().slice(0, 7)

  // Income/Budgeted are month-agnostic; Actual spend/Variance/Category Breakdown
  // always reflect the current month (Monthly) or the selected Year (Yearly) —
  // never a user-picked month. Only the Spend records table below lets the user
  // browse by an arbitrary month (see `selectedMonth` / recordsForSelectedMonth).
  const periodFilteredTransactions = budgetTransactionsForPeriod(
    state.budgetTransactions,
    period,
    currentMonthValue,
    selectedYear
  )
  const totalActual = periodFilteredTransactions.reduce((sum, t) => sum + t.amount, 0)
  const actualByCategoryForPeriod = actualByCategory(periodFilteredTransactions)
  const variance = totalExpense - totalActual
  const rangeLabel =
    period === 'monthly'
      ? availableMonths.find((m) => m.value === currentMonthValue)?.label ?? currentMonthValue
      : selectedYear

  const sortedRows = visibleExpenses(state.budgetExpenses, filterCategory, sortBy, period)
  const rows = sortDir === 'desc' ? [...sortedRows].reverse() : sortedRows
  const toggleSort = (field: 'category' | 'name' | 'amount') => {
    if (sortBy === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(field)
      setSortDir('asc')
    }
  }
  const breakdown = categoryBreakdown(state.budgetExpenses, periodFilteredTransactions, period)

  const saveIncomeEdit = () => {
    dispatch({
      type: 'SET_BUDGET_INCOME_FOR_PERIOD',
      period,
      amount: parseFloat(incomeEditAmount) || 0,
    })
    setEditingIncome(false)
  }

  const recordsRangeLabel = availableMonths.find((m) => m.value === selectedMonth)?.label ?? selectedMonth
  const recordsForSelectedMonth = budgetTransactionsForPeriod(
    state.budgetTransactions,
    'monthly',
    selectedMonth,
    selectedYear
  )
  const sortedRecords = [...recordsForSelectedMonth].sort((a, b) => b.date.localeCompare(a.date))

  const handleAddRecord = () => {
    const amount = parseFloat(recAmount)
    if (!recDate) {
      setRecError('Date is required.')
      return
    }
    if (!amount || amount <= 0) {
      setRecError('Amount must be greater than 0.')
      return
    }
    const description = recDescription.trim() || recCategory
    dispatch({
      type: 'ADD_BUDGET_TRANSACTION',
      tx: { date: recDate, description, category: recCategory, amount },
    })
    setSelectedMonth(recDate.slice(0, 7))
    setSelectedYear(recDate.slice(0, 4))
    setRecError('')
    setRecDate('')
    setRecDescription('')
    setRecAmount('')
  }

  // csvText holds raw text for parsing — CSV or OFX/QFX depending on importTab.
  const handleImportFileSelect = (file: File | null) => {
    setImportError(null)
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setCsvText(String(reader.result ?? ''))
    }
    reader.readAsText(file)
    setImportFileName(file.name)
  }

  const handleImport = () => {
    if (importTab === 'paste') {
      const parsed = parseBudgetTransactionsCsv(csvText).map((r) => ({ ...r, accountName: importAccountName.trim() }))
      dispatch({ type: 'IMPORT_BUDGET_TRANSACTIONS', rows: parsed })
      setImportStatus(`${parsed.length} row(s) detected`)
      setShowImportDialog(false)
      setCsvText('')
      setImportAccountName('')
    } else {
      const parsed = parseOfxTransactions(csvText)
      if (parsed.length === 0) {
        setImportError("No transactions found in file — check it's a valid OFX/QFX export")
        return
      }
      const withAccount = parsed.map((r) => ({ ...r, accountName: importAccountName.trim() }))
      dispatch({ type: 'IMPORT_BUDGET_TRANSACTIONS', rows: withAccount })
      setImportStatus(`${withAccount.length} row(s) detected`)
      setShowImportDialog(false)
      setCsvText('')
      setImportAccountName('')
      setImportError(null)
    }
  }

  const closeImportDialog = () => {
    setShowImportDialog(false)
    setCsvText('')
    setImportAccountName('')
    setImportError(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--space-3)',
          flexWrap: 'wrap',
        }}
      >
        <div className="card-title">Budget</div>
        <div className="seg">
          {(['monthly', 'yearly'] as const).map((opt) => (
            <label key={opt} className="seg-opt" onClick={() => setPeriod(opt)}>
              <input type="radio" name="budgetPeriod" checked={period === opt} readOnly />
              <span>{opt === 'monthly' ? 'Monthly' : 'Yearly'}</span>
            </label>
          ))}
        </div>
      </div>

      {period === 'yearly' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div className="field" style={{ maxWidth: '220px' }}>
            <label>Year</label>
            <select
              className="input"
              aria-label="Select year"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
            >
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div
        data-testid="summary-cards"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)',
        }}
      >
        <div className="card blueprint elev-sm">
          <div className="text-muted">Income</div>
          {editingIncome ? (
            <input
              type="number"
              className="input"
              aria-label="Income amount"
              autoFocus
              value={incomeEditAmount}
              onChange={(e) => setIncomeEditAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveIncomeEdit()
              }}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <div style={{ fontSize: '1.5rem' }}>{fmtUSD(totalIncome)}</div>
              <button
                type="button"
                style={{ ...iconBtn, color: 'var(--color-accent)' }}
                aria-label="Edit income"
                title="Edit income"
                onClick={() => {
                  setIncomeEditAmount(
                    String(period === 'monthly' ? state.budgetIncomeMonthly : state.budgetIncomeYearly)
                  )
                  setEditingIncome(true)
                }}
              >
                <PencilIcon />
              </button>
            </div>
          )}
        </div>
        <div className="card blueprint elev-sm">
          <div className="text-muted">Budgeted ({period === 'monthly' ? 'Monthly' : 'Yearly'})</div>
          <div style={{ fontSize: '1.5rem' }}>{fmtUSD(totalExpense)}</div>
        </div>
        <div className="card blueprint elev-sm">
          <div className="text-muted">Actual spend ({rangeLabel})</div>
          <div style={{ fontSize: '1.5rem' }}>{fmtUSD(totalActual)}</div>
        </div>
        <div className="card blueprint elev-sm">
          <div className="text-muted">Variance</div>
          <div style={{ fontSize: '1.5rem', color: totalExpense >= totalActual ? GAIN_COLOR : LOSS_COLOR }}>
            {fmtUSD(variance)}
          </div>
        </div>
      </div>

      <div className="card blueprint elev-sm">
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
          <div className="card-title">Spend records ({recordsRangeLabel})</div>
          <div className="field" style={{ maxWidth: '220px' }}>
            <label>Month</label>
            <select
              className="input"
              aria-label="Select month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            >
              {availableMonths.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {sortedRecords.length === 0 ? (
          <div className="text-muted" style={{ fontSize: '12px', padding: 'var(--space-4) 0' }}>
            No records for this period.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th>Account</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th style={{ width: '110px' }}></th>
              </tr>
            </thead>
            <tbody>
              {sortedRecords.map((row) => {
                const isEditing = recordDraft?.id === row.id
                return (
                  <tr key={row.id}>
                    <td>
                      {isEditing ? (
                        <input
                          type="date"
                          className="input"
                          aria-label="Edit record date"
                          value={recordDraft!.date}
                          onChange={(e) =>
                            setRecordDraft((d) => (d ? { ...d, date: e.target.value } : d))
                          }
                        />
                      ) : (
                        row.date
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          type="text"
                          className="input"
                          aria-label="Edit record description"
                          value={recordDraft!.description}
                          onChange={(e) =>
                            setRecordDraft((d) => (d ? { ...d, description: e.target.value } : d))
                          }
                        />
                      ) : (
                        row.description
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <select
                          className="input"
                          aria-label="Edit record category"
                          value={recordDraft!.category}
                          onChange={(e) =>
                            handleCategorySelectChange(e.target.value, (cat) =>
                              setRecordDraft((d) => (d ? { ...d, category: cat } : d))
                            )
                          }
                        >
                          {categories.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                          {recordDraft && !categories.includes(recordDraft.category) && (
                            <option value={recordDraft.category}>{recordDraft.category}</option>
                          )}
                          <option value="__add_new">+ Add new category…</option>
                        </select>
                      ) : (
                        <span className="tag tag-neutral">{row.category}</span>
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          type="text"
                          className="input"
                          aria-label="Edit record account"
                          value={recordDraft!.accountName}
                          onChange={(e) =>
                            setRecordDraft((d) => (d ? { ...d, accountName: e.target.value } : d))
                          }
                        />
                      ) : (
                        row.accountName || '—'
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {isEditing ? (
                        <input
                          type="number"
                          className="input"
                          aria-label="Edit record amount"
                          value={recordDraft!.amount}
                          onChange={(e) =>
                            setRecordDraft((d) => (d ? { ...d, amount: e.target.value } : d))
                          }
                        />
                      ) : (
                        fmtUSD(row.amount)
                      )}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {isEditing ? (
                        <button
                          type="button"
                          style={textBtnAccent}
                          onClick={() => {
                            dispatch({
                              type: 'UPDATE_BUDGET_TRANSACTION',
                              id: row.id,
                              patch: {
                                date: recordDraft!.date,
                                description: recordDraft!.description,
                                category: recordDraft!.category,
                                accountName: recordDraft!.accountName.trim() || undefined,
                                amount: parseFloat(recordDraft!.amount) || 0,
                              },
                            })
                            setRecordDraft(null)
                          }}
                        >
                          Done
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            style={{ ...iconBtn, color: 'var(--color-accent)', marginRight: 'var(--space-2)' }}
                            aria-label="Edit record"
                            title="Edit record"
                            onClick={() =>
                              setRecordDraft({
                                id: row.id,
                                date: row.date,
                                description: row.description,
                                category: row.category,
                                accountName: row.accountName ?? '',
                                amount: String(row.amount),
                              })
                            }
                          >
                            <PencilIcon />
                          </button>
                          <button
                            type="button"
                            style={{ ...iconBtn, color: LOSS_COLOR }}
                            aria-label="Delete record"
                            title="Delete record"
                            onClick={() => {
                              if (
                                window.confirm(`Delete "${row.description}"? This cannot be undone.`)
                              ) {
                                dispatch({ type: 'DELETE_BUDGET_TRANSACTION', id: row.id })
                              }
                            }}
                          >
                            <TrashIcon />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
              <tr data-testid="records-total-row">
                <td colSpan={4} style={{ borderTop: '2px solid var(--color-divider)', fontWeight: 600 }}>
                  Total
                </td>
                <td style={{ textAlign: 'right', borderTop: '2px solid var(--color-divider)', fontWeight: 600 }}>
                  {fmtUSD(sortedRecords.reduce((sum, r) => sum + r.amount, 0))}
                </td>
                <td style={{ borderTop: '2px solid var(--color-divider)' }}></td>
              </tr>
            </tbody>
          </table>
        )}

        <div
          style={{
            display: 'flex',
            gap: 'var(--space-3)',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            marginTop: 'var(--space-4)',
          }}
        >
          <div className="field">
            <label>Date</label>
            <input
              type="date"
              className="input"
              aria-label="Record date"
              value={recDate}
              onChange={(e) => setRecDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Description</label>
            <input
              type="text"
              className="input"
              aria-label="Record description"
              value={recDescription}
              onChange={(e) => setRecDescription(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Category</label>
            <select
              className="input"
              aria-label="Record category"
              value={recCategory}
              onChange={(e) => handleCategorySelectChange(e.target.value, setRecCategory)}
            >
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
              {!categories.includes(recCategory) && recCategory !== '__add_new' && (
                <option value={recCategory}>{recCategory}</option>
              )}
              <option value="__add_new">+ Add new category…</option>
            </select>
          </div>
          <div className="field">
            <label>Amount</label>
            <input
              type="number"
              className="input"
              aria-label="Record amount"
              value={recAmount}
              onChange={(e) => setRecAmount(e.target.value)}
            />
          </div>
          <button type="button" className="btn btn-primary" onClick={handleAddRecord}>
            Add Record
          </button>
        </div>
        {recError && (
          <div style={{ color: LOSS_COLOR, fontSize: '12px', marginTop: 'var(--space-2)' }}>{recError}</div>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            marginTop: 'var(--space-4)',
          }}
        >
          <button type="button" style={textBtnAccent} onClick={() => setShowImportDialog(true)}>
            Import transactions…
          </button>
          <span className="text-muted" style={{ fontSize: '12px' }}>
            {importStatus}
          </span>
        </div>
      </div>

      {showAddExpenseDialog && (
        <div
          className="dialog-backdrop"
          onClick={() => {
            setShowAddExpenseDialog(false)
            setFormName('')
            setFormCategory(categories[0] ?? '')
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
                  value={formCategory}
                  onChange={(e) => handleCategorySelectChange(e.target.value, setFormCategory)}
                >
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                  {!categories.includes(formCategory) && formCategory !== '__add_new' && (
                    <option value={formCategory}>{formCategory}</option>
                  )}
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
                  setFormCategory(categories[0] ?? '')
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
                    type: 'ADD_BUDGET_EXPENSE',
                    expense: { name: formName.trim(), category: formCategory, amount, frequency: formFrequency },
                  })
                  setShowAddExpenseDialog(false)
                  setFormName('')
                  setFormCategory(categories[0] ?? '')
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

      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 'var(--space-4)', alignItems: 'start' }}>
      <div className="card blueprint elev-sm">
        <div className="card-title" style={{ marginBottom: 'var(--space-3)' }}>
          Expenses
        </div>

      <div
        style={{
          display: 'flex',
          gap: 'var(--space-3)',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          marginBottom: 'var(--space-4)',
        }}
      >
        <div className="field">
          <label>Filter by category</label>
          <select
            className="input"
            aria-label="Filter by category"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
          >
            <option value="__all">All categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
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
              <th
                aria-label="Sort by name"
                style={{ cursor: 'pointer', userSelect: 'none' }}
                onClick={() => toggleSort('name')}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                  Name
                  {sortBy === 'name' && <SortIcon dir={sortDir} />}
                </span>
              </th>
              <th
                aria-label="Sort by category"
                style={{ cursor: 'pointer', userSelect: 'none' }}
                onClick={() => toggleSort('category')}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                  Category
                  {sortBy === 'category' && <SortIcon dir={sortDir} />}
                </span>
              </th>
              <th>Frequency</th>
              <th
                aria-label="Sort by amount"
                style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => toggleSort('amount')}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: '2px' }}>
                  Amount ({period === 'monthly' ? 'Monthly' : 'Yearly'})
                  {sortBy === 'amount' && <SortIcon dir={sortDir} />}
                </span>
              </th>
              <th style={{ textAlign: 'right' }}>Actual</th>
              <th style={{ textAlign: 'right' }}>Variance</th>
              <th style={{ width: '110px' }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isEditing = editingId === row.id
              return (
                <tr key={row.id}>
                  <td>
                    {isEditing ? (
                      <input
                        type="text"
                        className="input"
                        aria-label="Edit expense name"
                        value={row.name}
                        onChange={(e) =>
                          dispatch({ type: 'UPDATE_BUDGET_EXPENSE', id: row.id, patch: { name: e.target.value } })
                        }
                      />
                    ) : (
                      row.name
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <select
                        className="input"
                        aria-label="Edit expense category"
                        value={editCategoryDraft ?? row.category}
                        onChange={(e) =>
                          handleCategorySelectChange(e.target.value, (cat) => setEditCategoryDraft(cat))
                        }
                      >
                        {categories.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                        {editCategoryDraft && !categories.includes(editCategoryDraft) && (
                          <option value={editCategoryDraft}>{editCategoryDraft}</option>
                        )}
                        <option value="__add_new">+ Add new category…</option>
                      </select>
                    ) : (
                      <span className="tag tag-neutral">{row.category}</span>
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <select
                        className="input"
                        aria-label="Edit expense frequency"
                        value={row.frequency}
                        onChange={(e) =>
                          dispatch({
                            type: 'UPDATE_BUDGET_EXPENSE',
                            id: row.id,
                            patch: { frequency: e.target.value as 'monthly' | 'yearly' },
                          })
                        }
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
                  <td style={{ textAlign: 'right' }}>
                    {isEditing ? (
                      <input
                        type="number"
                        className="input"
                        aria-label="Edit expense amount"
                        value={row.amount}
                        onChange={(e) =>
                          dispatch({
                            type: 'UPDATE_BUDGET_EXPENSE',
                            id: row.id,
                            patch: { amount: parseFloat(e.target.value) || 0 },
                          })
                        }
                      />
                    ) : (
                      fmtUSD(toPeriod(row.amount, row.frequency, period))
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {fmtUSD(actualByCategoryForPeriod[row.category] ?? 0)}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      color:
                        toPeriod(row.amount, row.frequency, period) - (actualByCategoryForPeriod[row.category] ?? 0) >= 0
                          ? GAIN_COLOR
                          : LOSS_COLOR,
                    }}
                  >
                    {fmtUSD(toPeriod(row.amount, row.frequency, period) - (actualByCategoryForPeriod[row.category] ?? 0))}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {isEditing ? (
                      <button
                        type="button"
                        style={textBtnAccent}
                        onClick={() => {
                          if (editCategoryDraft && editCategoryDraft !== row.category) {
                            dispatch({
                              type: 'UPDATE_BUDGET_EXPENSE',
                              id: row.id,
                              patch: { category: editCategoryDraft },
                            })
                          }
                          setEditCategoryDraft(null)
                          setEditingId(null)
                        }}
                      >
                        Done
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          style={{ ...iconBtn, color: 'var(--color-accent)', marginRight: 'var(--space-2)' }}
                          aria-label="Edit expense"
                          title="Edit expense"
                          onClick={() => {
                            setEditCategoryDraft(null)
                            setEditingId(row.id)
                          }}
                        >
                          <PencilIcon />
                        </button>
                        <button
                          type="button"
                          style={{ ...iconBtn, color: LOSS_COLOR }}
                          aria-label="Delete expense"
                          title="Delete expense"
                          onClick={() => {
                            if (window.confirm('Delete this expense? This cannot be undone.')) {
                              dispatch({ type: 'DELETE_BUDGET_EXPENSE', id: row.id })
                            }
                          }}
                        >
                          <TrashIcon />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
            {(() => {
              const rowsTotalAmount = rows.reduce((sum, r) => sum + toPeriod(r.amount, r.frequency, period), 0)
              const rowsTotalActual = [...new Set(rows.map((r) => r.category))].reduce(
                (sum, cat) => sum + (actualByCategoryForPeriod[cat] ?? 0),
                0
              )
              const rowsTotalVariance = rowsTotalAmount - rowsTotalActual
              return (
                <tr data-testid="expenses-total-row">
                  <td colSpan={3} style={{ borderTop: '2px solid var(--color-divider)', fontWeight: 600 }}>
                    Total
                  </td>
                  <td style={{ textAlign: 'right', borderTop: '2px solid var(--color-divider)', fontWeight: 600 }}>
                    {fmtUSD(rowsTotalAmount)}
                  </td>
                  <td style={{ textAlign: 'right', borderTop: '2px solid var(--color-divider)', fontWeight: 600 }}>
                    {fmtUSD(rowsTotalActual)}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      borderTop: '2px solid var(--color-divider)',
                      fontWeight: 600,
                      color: rowsTotalVariance >= 0 ? GAIN_COLOR : LOSS_COLOR,
                    }}
                  >
                    {fmtUSD(rowsTotalVariance)}
                  </td>
                  <td style={{ borderTop: '2px solid var(--color-divider)' }}></td>
                </tr>
              )
            })()}
          </tbody>
        </table>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-3)' }}>
        <button type="button" className="btn btn-primary" onClick={() => setShowAddExpenseDialog(true)}>
          Add Expense
        </button>
      </div>
      </div>

      <div className="card blueprint elev-sm">
        <div className="card-title" style={{ marginBottom: 'var(--space-3)' }}>
          Category Breakdown
        </div>
        {state.budgetExpenses.length === 0 ? (
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
                <div
                  style={{
                    position: 'relative',
                    width: '100%',
                    height: '8px',
                  }}
                >
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
      </div>


      {showImportDialog && (
        <div className="dialog-backdrop" onClick={closeImportDialog}>
          <div className="dialog blueprint" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">Import transactions</div>
            <div className="dialog-body">
              <div className="field" style={{ marginBottom: 'var(--space-3)' }}>
                <label>Account name</label>
                <input
                  type="text"
                  className="input"
                  aria-label="Import account name"
                  value={importAccountName}
                  onChange={(e) => setImportAccountName(e.target.value)}
                />
              </div>

              <div className="seg" style={{ marginBottom: 'var(--space-3)' }}>
                <label className="seg-opt" onClick={() => setImportTab('paste')}>
                  <input type="radio" name="importTab" checked={importTab === 'paste'} readOnly />
                  <span>Copy-Paste</span>
                </label>
                <label className="seg-opt" onClick={() => setImportTab('upload')}>
                  <input type="radio" name="importTab" checked={importTab === 'upload'} readOnly />
                  <span>Upload file</span>
                </label>
              </div>

              {importTab === 'paste' ? (
                <div className="field">
                  <label>Paste CSV</label>
                  <textarea
                    className="input"
                    aria-label="Paste CSV text"
                    rows={8}
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                  />
                </div>
              ) : (
                <div className="field">
                  <label>OFX/QFX file</label>
                  <div
                    onClick={() => importFileInputRef.current?.click()}
                    onDrop={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      handleImportFileSelect(e.dataTransfer.files?.[0] || null)
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                    }}
                    style={{
                      border: '1px dashed var(--color-divider)',
                      padding: 'var(--space-6)',
                      textAlign: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      ref={importFileInputRef}
                      type="file"
                      accept=".ofx,.qfx"
                      aria-label="OFX/QFX file"
                      onChange={(e) => handleImportFileSelect(e.target.files?.[0] || null)}
                      style={{ display: 'none' }}
                    />
                    <div>{importFileName || 'No file selected'}</div>
                    <div className="text-muted" style={{ fontSize: '11px', marginTop: '4px' }}>
                      Drag and drop, or click to browse
                    </div>
                  </div>
                </div>
              )}

              {importError && (
                <div className="text-muted" style={{ color: 'var(--color-danger)', marginTop: 'var(--space-2)' }}>
                  {importError}
                </div>
              )}
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={closeImportDialog}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleImport}
                disabled={!importAccountName.trim() || (importTab === 'upload' && !!importError)}
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
