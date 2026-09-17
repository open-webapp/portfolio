import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { AppState } from '../lib/state'
import { resolveBudgetExpensesForYear, resolveBudgetIncomeForYear, currentBudgetYear } from '../lib/state'
import { resolveCategoryIdForDescription, type CategoryAction } from '../lib/categoryStore'
import type { Category, CategoryMapping } from '../lib/types'
import { uid } from '../lib/seed'
import { BudgetAnalytics } from './BudgetAnalytics'
import { fmtUSD, toPeriod, GAIN_COLOR, LOSS_COLOR, parseBudgetTransactionsCsv, parseOfxTransactions } from '../lib/computations'
import {
  visibleExpenses,
  categoryBreakdown,
  budgetTransactionsForPeriod,
  actualByCategory,
  availableBudgetMonths,
  availableBudgetYears,
  excludedCategoryIdSet,
} from '../lib/selectors'

export interface BudgetPageProps {
  state: AppState
  dispatch: (action: any) => void
  categories: Category[]
  categoryMappings: CategoryMapping[]
  categoryDispatch: (action: CategoryAction) => void
}

/**
 * Shared onChange handler for every category <select> in this component.
 * Selecting the "+ Add new category…" sentinel prompts for a new category
 * name and, if one is entered, hands it to `apply`; any other selection is
 * passed straight through to `apply`. `apply` decides what to do with the
 * resulting category value (e.g. set local field state, dispatch, etc.) —
 * this helper never dispatches itself.
 */
function handleCategorySelectChange(
  value: string,
  categoryDispatch: (action: CategoryAction) => void,
  apply: (categoryId: string) => void
) {
  if (value === '__add_new') {
    const result = window.prompt('New category name')
    if (result && result.trim()) {
      const id = uid('category')
      categoryDispatch({ type: 'ADD_CATEGORY', id, name: result.trim() })
      apply(id)
    }
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
export function BudgetPage({ state, dispatch, categories, categoryMappings, categoryDispatch }: BudgetPageProps) {
  const [period, setPeriod] = useState<'monthly' | 'yearly' | 'analytics'>('yearly')
  const [filterCategoryId, setFilterCategoryId] = useState('__all')
  const [sortBy, setSortBy] = useState<'category' | 'name' | 'amount'>('category')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [showAddExpenseDialog, setShowAddExpenseDialog] = useState(false)
  const [recordSearch, setRecordSearch] = useState('')
  const [recSortBy, setRecSortBy] = useState<'date' | 'description' | 'category' | 'account' | 'amount'>('date')
  const [recSortDir, setRecSortDir] = useState<'asc' | 'desc'>('desc')
  const [recPage, setRecPage] = useState(0)
  const [showExcludedRecords, setShowExcludedRecords] = useState(false)
  const [formName, setFormName] = useState('')
  const categoriesById = new Map(categories.map((c) => [c.id, c.name]))
  const [formCategoryId, setFormCategoryId] = useState(categories[0]?.id ?? '')
  const [formAmount, setFormAmount] = useState('')
  const [formFrequency, setFormFrequency] = useState<'monthly' | 'yearly'>('monthly')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editCategoryIdDraft, setEditCategoryIdDraft] = useState<string | null>(null)
  const [editingIncome, setEditingIncome] = useState(false)
  const [incomeEditAmount, setIncomeEditAmount] = useState('')
  const [selectedYear, setSelectedYear] = useState(
    () => availableBudgetYears(state.budgetTransactions, new Date())[0]
  )
  const [editingCell, setEditingCell] = useState<{
    rowId: string
    field: 'date' | 'description' | 'category' | 'account' | 'amount'
  } | null>(null)
  const [cellDraft, setCellDraft] = useState('')
  const skipBlurCommitRef = useRef(false)
  const [recDate, setRecDate] = useState('')
  const [recDescription, setRecDescription] = useState('')
  const [recCategoryId, setRecCategoryId] = useState(categories[0]?.id ?? '')
  const [recCategoryTouchedManually, setRecCategoryTouchedManually] = useState(false)
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

  // Monthly/Yearly-only computations below take a strict 'monthly' | 'yearly'
  // period; when the Analytics tab is active these values aren't rendered, so
  // fall back to 'yearly' just to keep them well-typed and side-effect-free.
  const effectivePeriod: 'monthly' | 'yearly' = period === 'monthly' ? 'monthly' : 'yearly'
  const activeYear = period === 'monthly' ? currentBudgetYear() : selectedYear
  const activeYearExpenses = resolveBudgetExpensesForYear(state.budgetExpensesByYear, activeYear)
  const activeYearIncome = resolveBudgetIncomeForYear(state.budgetIncomeByYear, activeYear)

  const totalIncome =
    period === 'monthly'
      ? activeYearIncome.monthly + activeYearIncome.yearly / 12
      : activeYearIncome.monthly * 12 + activeYearIncome.yearly

  const totalExpense = activeYearExpenses.reduce(
    (sum, e) => sum + toPeriod(e.amount, e.frequency, effectivePeriod),
    0
  )

  const availableMonths = availableBudgetMonths(state.budgetTransactions, new Date())
  const availableYears = availableBudgetYears(state.budgetTransactions, new Date())
  const currentMonthValue = new Date().toISOString().slice(0, 7)

  // Income/Budgeted are month-agnostic; Actual spend/Variance/Category Breakdown
  // and the Spend records table below always reflect the current month
  // (Monthly) or the selected Year (Yearly).
  const periodFilteredTransactions = budgetTransactionsForPeriod(
    state.budgetTransactions,
    effectivePeriod,
    currentMonthValue,
    selectedYear
  )
  const excludedCategoryIds = excludedCategoryIdSet(categories)
  const nonExcludedTransactions = periodFilteredTransactions.filter(
    (t) => !excludedCategoryIds.has(t.categoryId)
  )
  const totalActual = nonExcludedTransactions.reduce((sum, t) => sum + t.amount, 0)
  const actualByCategoryForPeriod = actualByCategory(nonExcludedTransactions)
  const variance = totalExpense - totalActual
  const rangeLabel =
    period === 'monthly'
      ? availableMonths.find((m) => m.value === currentMonthValue)?.label ?? currentMonthValue
      : selectedYear

  const sortedRows = visibleExpenses(activeYearExpenses, filterCategoryId, sortBy, effectivePeriod, categoriesById)
  const rows = sortDir === 'desc' ? [...sortedRows].reverse() : sortedRows
  const toggleSort = (field: 'category' | 'name' | 'amount') => {
    if (sortBy === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(field)
      setSortDir('asc')
    }
  }
  const breakdown = categoryBreakdown(activeYearExpenses, periodFilteredTransactions, effectivePeriod, categories)

  const saveIncomeEdit = () => {
    const amount = parseFloat(incomeEditAmount) || 0
    dispatch({
      type: 'SET_BUDGET_INCOME',
      year: activeYear,
      patch: period === 'monthly' ? { monthly: amount } : { yearly: amount },
    })
    setEditingIncome(false)
  }

  const recordSourceTransactions = showExcludedRecords
    ? periodFilteredTransactions
    : periodFilteredTransactions.filter((t) => !excludedCategoryIds.has(t.categoryId))
  const filteredRecords = recordSearch.trim()
    ? recordSourceTransactions.filter((t) => {
        const searchLower = recordSearch.toLowerCase()
        const categoryName = categoriesById.get(t.categoryId) ?? t.categoryId
        return (
          t.description.toLowerCase().includes(searchLower) ||
          categoryName.toLowerCase().includes(searchLower) ||
          (t.accountName ?? '').toLowerCase().includes(searchLower)
        )
      })
    : recordSourceTransactions
  const toggleRecSort = (field: 'date' | 'description' | 'category' | 'account' | 'amount') => {
    if (recSortBy === field) {
      setRecSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setRecSortBy(field)
      setRecSortDir(field === 'date' ? 'desc' : 'asc')
    }
  }
  const searchedRecords = [...filteredRecords].sort((a, b) => {
    let cmp = 0
    switch (recSortBy) {
      case 'date':
        cmp = a.date.localeCompare(b.date)
        break
      case 'description':
        cmp = a.description.localeCompare(b.description)
        break
      case 'category': {
        const nameA = categoriesById.get(a.categoryId) ?? a.categoryId
        const nameB = categoriesById.get(b.categoryId) ?? b.categoryId
        cmp = nameA.localeCompare(nameB)
        break
      }
      case 'account':
        cmp = (a.accountName ?? '').localeCompare(b.accountName ?? '')
        break
      case 'amount':
        cmp = a.amount - b.amount
        break
    }
    return recSortDir === 'asc' ? cmp : -cmp
  })
  const recPaginationActive = searchedRecords.length > 500
  const recPageCount = Math.ceil(searchedRecords.length / 100)
  const pagedRecords = recPaginationActive
    ? searchedRecords.slice(recPage * 100, recPage * 100 + 100)
    : searchedRecords

  const isEditingCell = (rowId: string, field: 'date' | 'description' | 'category' | 'account' | 'amount') =>
    editingCell?.rowId === rowId && editingCell.field === field

  const startCellEdit = (
    rowId: string,
    field: 'date' | 'description' | 'category' | 'account' | 'amount',
    currentValue: string
  ) => {
    if (isEditingCell(rowId, field)) return
    setEditingCell({ rowId, field })
    setCellDraft(currentValue)
  }

  const commitCellEdit = (
    rowId: string,
    field: 'date' | 'description' | 'account' | 'amount',
    value: string
  ) => {
    let patch: Record<string, unknown> = {}
    switch (field) {
      case 'date':
        patch = { date: value }
        break
      case 'description':
        patch = { description: value }
        break
      case 'account':
        patch = { accountName: value.trim() || undefined }
        break
      case 'amount':
        patch = { amount: parseFloat(value) || 0 }
        break
    }
    dispatch({ type: 'UPDATE_BUDGET_TRANSACTION', id: rowId, patch })
    setEditingCell(null)
    setCellDraft('')
  }

  const handleCellInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      skipBlurCommitRef.current = true
      e.currentTarget.blur()
    }
  }

  const handleCellInputBlur = (
    rowId: string,
    field: 'date' | 'description' | 'account' | 'amount'
  ) => {
    if (!editingCell) return
    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false
      setEditingCell(null)
      setCellDraft('')
      return
    }
    commitCellEdit(rowId, field, cellDraft)
  }

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
    const description = recDescription.trim() || (categoriesById.get(recCategoryId) ?? recCategoryId)
    dispatch({
      type: 'ADD_BUDGET_TRANSACTION',
      tx: { date: recDate, description, categoryId: recCategoryId, amount },
    })
    categoryDispatch({ type: 'UPSERT_CATEGORY_MAPPING', description, categoryId: recCategoryId })
    setSelectedYear(recDate.slice(0, 4))
    setRecError('')
    setRecDate('')
    setRecDescription('')
    setRecAmount('')
    setRecCategoryTouchedManually(false)
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
      dispatch({ type: 'IMPORT_BUDGET_TRANSACTIONS', rows: parsed, categories, categoryMappings })
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
      dispatch({ type: 'IMPORT_BUDGET_TRANSACTIONS', rows: withAccount, categories, categoryMappings })
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
          {(['monthly', 'yearly', 'analytics'] as const).map((opt) => (
            <label
              key={opt}
              className="seg-opt"
              onClick={() => {
                setPeriod(opt)
                setRecPage(0)
              }}
            >
              <input type="radio" name="budgetPeriod" checked={period === opt} readOnly />
              <span>{opt === 'monthly' ? 'Monthly' : opt === 'yearly' ? 'Yearly' : 'Analytics'}</span>
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
              onChange={(e) => {
                setSelectedYear(e.target.value)
                setRecPage(0)
              }}
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

      {period === 'analytics' ? (
        <BudgetAnalytics state={state} categories={categories} />
      ) : (
      <>
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
                    String(period === 'monthly' ? activeYearIncome.monthly : activeYearIncome.yearly)
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
          <div className="card-title">Spend records ({rangeLabel})</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '12px' }}
            >
              <input
                type="checkbox"
                checked={showExcludedRecords}
                onChange={(e) => {
                  setShowExcludedRecords(e.target.checked)
                  setRecPage(0)
                }}
              />
              Show excluded
            </label>
            <div className="field" style={{ margin: 0, width: '220px' }}>
              <input
                className="input"
                aria-label="Search records"
                placeholder="Search records"
                value={recordSearch}
                onChange={(e) => {
                  setRecordSearch(e.target.value)
                  setRecPage(0)
                }}
              />
            </div>
          </div>
        </div>

        {searchedRecords.length === 0 ? (
          <div className="text-muted" style={{ fontSize: '12px', padding: 'var(--space-4) 0' }}>
            No records for this period.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th
                  aria-label="Sort by date"
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggleRecSort('date')}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                    Date
                    {recSortBy === 'date' && <SortIcon dir={recSortDir} />}
                  </span>
                </th>
                <th
                  aria-label="Sort by description"
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggleRecSort('description')}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                    Description
                    {recSortBy === 'description' && <SortIcon dir={recSortDir} />}
                  </span>
                </th>
                <th
                  aria-label="Sort by category"
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggleRecSort('category')}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                    Category
                    {recSortBy === 'category' && <SortIcon dir={recSortDir} />}
                  </span>
                </th>
                <th
                  aria-label="Sort by account"
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggleRecSort('account')}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                    Account
                    {recSortBy === 'account' && <SortIcon dir={recSortDir} />}
                  </span>
                </th>
                <th
                  aria-label="Sort by amount"
                  style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggleRecSort('amount')}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: '2px' }}>
                    Amount
                    {recSortBy === 'amount' && <SortIcon dir={recSortDir} />}
                  </span>
                </th>
                <th style={{ width: '110px' }}></th>
              </tr>
            </thead>
            <tbody>
              {pagedRecords.map((row) => {
                return (
                  <tr key={row.id}>
                    <td onClick={() => startCellEdit(row.id, 'date', row.date)}>
                      {isEditingCell(row.id, 'date') ? (
                        <input
                          type="date"
                          className="input"
                          aria-label="Edit record date"
                          autoFocus
                          value={cellDraft}
                          onChange={(e) => setCellDraft(e.target.value)}
                          onKeyDown={handleCellInputKeyDown}
                          onBlur={() => handleCellInputBlur(row.id, 'date')}
                        />
                      ) : (
                        row.date
                      )}
                    </td>
                    <td onClick={() => startCellEdit(row.id, 'description', row.description)}>
                      {isEditingCell(row.id, 'description') ? (
                        <input
                          type="text"
                          className="input"
                          aria-label="Edit record description"
                          autoFocus
                          value={cellDraft}
                          onChange={(e) => setCellDraft(e.target.value)}
                          onKeyDown={handleCellInputKeyDown}
                          onBlur={() => handleCellInputBlur(row.id, 'description')}
                        />
                      ) : (
                        row.description
                      )}
                    </td>
                    <td onClick={() => startCellEdit(row.id, 'category', row.categoryId)}>
                      {isEditingCell(row.id, 'category') ? (
                        <select
                          className="input"
                          aria-label="Edit record category"
                          autoFocus
                          value={cellDraft}
                          onChange={(e) =>
                            handleCategorySelectChange(e.target.value, categoryDispatch, (categoryId) => {
                              dispatch({
                                type: 'UPDATE_BUDGET_TRANSACTION',
                                id: row.id,
                                patch: { categoryId },
                              })
                              categoryDispatch({
                                type: 'UPSERT_CATEGORY_MAPPING',
                                description: row.description,
                                categoryId,
                              })
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
                    <td onClick={() => startCellEdit(row.id, 'account', row.accountName ?? '')}>
                      {isEditingCell(row.id, 'account') ? (
                        <input
                          type="text"
                          className="input"
                          aria-label="Edit record account"
                          autoFocus
                          value={cellDraft}
                          onChange={(e) => setCellDraft(e.target.value)}
                          onKeyDown={handleCellInputKeyDown}
                          onBlur={() => handleCellInputBlur(row.id, 'account')}
                        />
                      ) : (
                        row.accountName || '—'
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }} onClick={() => startCellEdit(row.id, 'amount', String(row.amount))}>
                      {isEditingCell(row.id, 'amount') ? (
                        <input
                          type="number"
                          className="input"
                          aria-label="Edit record amount"
                          autoFocus
                          value={cellDraft}
                          onChange={(e) => setCellDraft(e.target.value)}
                          onKeyDown={handleCellInputKeyDown}
                          onBlur={() => handleCellInputBlur(row.id, 'amount')}
                        />
                      ) : (
                        fmtUSD(row.amount)
                      )}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
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
                    </td>
                  </tr>
                )
              })}
              <tr data-testid="records-total-row">
                <td colSpan={4} style={{ borderTop: '2px solid var(--color-divider)', fontWeight: 600 }}>
                  Total
                </td>
                <td style={{ textAlign: 'right', borderTop: '2px solid var(--color-divider)', fontWeight: 600 }}>
                  {fmtUSD(searchedRecords.reduce((sum, r) => sum + r.amount, 0))}
                </td>
                <td style={{ borderTop: '2px solid var(--color-divider)' }}></td>
              </tr>
            </tbody>
          </table>
        )}

        {recPaginationActive && (
          <div
            data-testid="records-pagination"
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 'var(--space-3)',
              marginTop: 'var(--space-3)',
            }}
          >
            <button
              type="button"
              className="btn"
              disabled={recPage === 0}
              onClick={() => setRecPage((p) => Math.max(0, p - 1))}
            >
              Prev
            </button>
            <span className="text-muted" style={{ fontSize: '12px' }}>
              Page {recPage + 1} of {recPageCount}
            </span>
            <button
              type="button"
              className="btn"
              disabled={recPage >= recPageCount - 1}
              onClick={() => setRecPage((p) => Math.min(recPageCount - 1, p + 1))}
            >
              Next
            </button>
          </div>
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
              onChange={(e) => {
                setRecDescription(e.target.value)
                setRecCategoryTouchedManually(false)
                if (!recCategoryTouchedManually) {
                  const match = resolveCategoryIdForDescription(categoryMappings, e.target.value)
                  if (match) setRecCategoryId(match)
                }
              }}
            />
          </div>
          <div className="field">
            <label>Category</label>
            <select
              className="input"
              aria-label="Record category"
              value={recCategoryId}
              onChange={(e) =>
                handleCategorySelectChange(e.target.value, categoryDispatch, (categoryId) => {
                  setRecCategoryId(categoryId)
                  setRecCategoryTouchedManually(true)
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
                  onChange={(e) => handleCategorySelectChange(e.target.value, categoryDispatch, setFormCategoryId)}
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
                    type: 'ADD_BUDGET_EXPENSE',
                    year: activeYear,
                    expense: { name: formName.trim(), categoryId: formCategoryId, amount, frequency: formFrequency },
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
                          dispatch({ type: 'UPDATE_BUDGET_EXPENSE', year: activeYear, id: row.id, patch: { name: e.target.value } })
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
                        value={editCategoryIdDraft ?? row.categoryId}
                        onChange={(e) =>
                          handleCategorySelectChange(e.target.value, categoryDispatch, (categoryId) => setEditCategoryIdDraft(categoryId))
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
                  <td>
                    {isEditing ? (
                      <select
                        className="input"
                        aria-label="Edit expense frequency"
                        value={row.frequency}
                        onChange={(e) =>
                          dispatch({
                            type: 'UPDATE_BUDGET_EXPENSE',
                            year: activeYear,
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
                            year: activeYear,
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
                    {fmtUSD(actualByCategoryForPeriod[row.categoryId] ?? 0)}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      color:
                        toPeriod(row.amount, row.frequency, period) - (actualByCategoryForPeriod[row.categoryId] ?? 0) >= 0
                          ? GAIN_COLOR
                          : LOSS_COLOR,
                    }}
                  >
                    {fmtUSD(toPeriod(row.amount, row.frequency, period) - (actualByCategoryForPeriod[row.categoryId] ?? 0))}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {isEditing ? (
                      <button
                        type="button"
                        style={textBtnAccent}
                        onClick={() => {
                          if (editCategoryIdDraft && editCategoryIdDraft !== row.categoryId) {
                            dispatch({
                              type: 'UPDATE_BUDGET_EXPENSE',
                              year: activeYear,
                              id: row.id,
                              patch: { categoryId: editCategoryIdDraft },
                            })
                          }
                          setEditCategoryIdDraft(null)
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
                            setEditCategoryIdDraft(null)
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
                              dispatch({ type: 'DELETE_BUDGET_EXPENSE', year: activeYear, id: row.id })
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
              const rowsTotalActual = [...new Set(rows.map((r) => r.categoryId))].reduce(
                (sum, catId) => sum + (actualByCategoryForPeriod[catId] ?? 0),
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
        {activeYearExpenses.length === 0 ? (
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
      </>
      )}

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
