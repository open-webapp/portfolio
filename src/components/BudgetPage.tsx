import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import type { AppState } from '../lib/state'
import { resolveBudgetExpensesForYear, resolveBudgetIncomeForYear, currentBudgetYear, resolveBudgetImportRows } from '../lib/state'
import { resolveCategoryIdForDescription, type CategoryAction } from '../lib/categoryStore'
import type { Category, CategoryMapping } from '../lib/types'
import { uid } from '../lib/seed'
import { BudgetAnalytics } from './BudgetAnalytics'
import { SpendCategoryPicker } from './SpendCategoryPicker'
import { fmtUSD, toPeriod, GAIN_COLOR, LOSS_COLOR, parseBudgetTransactionsCsv, parseOfxTransactions, countBudgetCsvDataRows } from '../lib/computations'
import {
  visibleExpenses,
  categoryBreakdown,
  budgetTransactionsForPeriod,
  actualByCategory,
  availableBudgetMonths,
  availableBudgetYears,
  excludedCategoryIdSet,
  effectiveCategoryId,
} from '../lib/selectors'

export interface BudgetPageProps {
  state: AppState
  dispatch: (action: any) => void
  categories: Category[]
  categoryMappings: CategoryMapping[]
  categoryDispatch: (action: CategoryAction) => void
}

/**
 * Selecting the "+ Add new category…" sentinel from any category <select> in
 * this component opens the new-category dialog instead of `apply`ing
 * directly; any other selection is passed straight through to `apply`.
 * `apply` decides what to do with the resulting category value (e.g. set
 * local field state, dispatch, etc.).
 *
 * window.prompt() doesn't render in a standalone-display installed PWA
 * window (silently no-ops), so new-category entry can't rely on it — hence
 * the in-app dialog.
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
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set())
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null)
  const selectionCellRefs = useRef<Record<string, HTMLTableCellElement | null>>({})
  const [bulkCategoryId, setBulkCategoryId] = useState('')
  const [bulkExpenseId, setBulkExpenseId] = useState('')
  const [formName, setFormName] = useState('')
  const categoriesById = new Map(categories.map((c) => [c.id, c.name]))
  const [formCategoryId, setFormCategoryId] = useState(categories[0]?.id ?? '')
  const [formAmount, setFormAmount] = useState('')
  const [formFrequency, setFormFrequency] = useState<'monthly' | 'yearly'>('monthly')
  const [newCategoryPrompt, setNewCategoryPrompt] = useState<NewCategoryPrompt | null>(null)
  const [newCategoryName, setNewCategoryName] = useState('')
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
  const [editingExpenseCell, setEditingExpenseCell] = useState<{
    rowId: string
    field: 'name' | 'category' | 'frequency' | 'amount'
  } | null>(null)
  const [expenseCellDraft, setExpenseCellDraft] = useState('')
  // Shared by both the Spend records and Expenses per-cell edit flows below.
  const skipBlurCommitRef = useRef(false)
  const [recDate, setRecDate] = useState('')
  const [recDescription, setRecDescription] = useState('')
  const [recCategoryId, setRecCategoryId] = useState(categories[0]?.id ?? '')
  const [recCategoryTouchedManually, setRecCategoryTouchedManually] = useState(false)
  const [recExpenseId, setRecExpenseId] = useState('')
  const [recAmount, setRecAmount] = useState('')
  const [recError, setRecError] = useState('')
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [importTab, setImportTab] = useState<'paste' | 'upload'>('paste')
  const [csvText, setCsvText] = useState('')
  const [importFileName, setImportFileName] = useState('')
  const [importAccountName, setImportAccountName] = useState('')
  const [importStatus, setImportStatus] = useState('Never imported')
  const [importError, setImportError] = useState<string | null>(null)
  const [importFileKind, setImportFileKind] = useState<'csv' | 'ofx' | null>(null)
  const [importResult, setImportResult] = useState<{ detected: number; failed: number; imported: number; duplicates: number } | null>(null)
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
    (t) => !excludedCategoryIds.has(effectiveCategoryId(t, state.budgetExpensesByYear))
  )
  const totalActual = nonExcludedTransactions.reduce((sum, t) => sum + t.amount, 0)
  const actualByCategoryForPeriod = actualByCategory(nonExcludedTransactions, state.budgetExpensesByYear)
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
  const breakdown = categoryBreakdown(
    activeYearExpenses,
    periodFilteredTransactions,
    effectivePeriod,
    categories,
    state.budgetExpensesByYear
  )

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
    : periodFilteredTransactions.filter(
        (t) => !excludedCategoryIds.has(effectiveCategoryId(t, state.budgetExpensesByYear))
      )
  const filteredRecords = recordSearch.trim()
    ? recordSourceTransactions.filter((t) => {
        const searchLower = recordSearch.toLowerCase()
        const categoryName =
          categoriesById.get(effectiveCategoryId(t, state.budgetExpensesByYear)) ??
          effectiveCategoryId(t, state.budgetExpensesByYear)
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
        const catA = effectiveCategoryId(a, state.budgetExpensesByYear)
        const catB = effectiveCategoryId(b, state.budgetExpensesByYear)
        const nameA = categoriesById.get(catA) ?? catA
        const nameB = categoriesById.get(catB) ?? catB
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
  const RECORDS_PAGE_SIZE = 50
  const recPaginationActive = searchedRecords.length > RECORDS_PAGE_SIZE
  const recPageCount = Math.ceil(searchedRecords.length / RECORDS_PAGE_SIZE)
  const pagedRecords = searchedRecords.slice(recPage * RECORDS_PAGE_SIZE, recPage * RECORDS_PAGE_SIZE + RECORDS_PAGE_SIZE)

  // Clears row selection whenever the visible set/order of Spend records can
  // change out from under it (paging, sorting, searching, or switching
  // period/year) so stale selections never point at rows no longer shown.
  useEffect(() => {
    setSelectedRowIds(new Set())
    setSelectionAnchorId(null)
    setBulkCategoryId('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recPage, recSortBy, recSortDir, recordSearch, period, selectedYear])

  const selectionRangeIds = (anchorId: string, targetIdx: number): Set<string> => {
    const anchorIdx = pagedRecords.findIndex((r) => r.id === anchorId)
    if (anchorIdx === -1) return new Set([pagedRecords[targetIdx]?.id].filter(Boolean) as string[])
    const [lo, hi] = anchorIdx <= targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx]
    return new Set(pagedRecords.slice(lo, hi + 1).map((r) => r.id))
  }

  const handleSelectionCellClick = (e: MouseEvent<HTMLTableCellElement>, rowId: string, idx: number) => {
    if (e.shiftKey && selectionAnchorId) {
      setSelectedRowIds(selectionRangeIds(selectionAnchorId, idx))
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedRowIds((prev) => {
        const next = new Set(prev)
        if (next.has(rowId)) next.delete(rowId)
        else next.add(rowId)
        return next
      })
    } else {
      setSelectedRowIds(new Set([rowId]))
      setSelectionAnchorId(rowId)
    }
    e.currentTarget.focus()
  }

  const handleSelectionCellKeyDown = (e: KeyboardEvent<HTMLTableCellElement>) => {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || !e.shiftKey) return
    if (!selectionAnchorId) return
    e.preventDefault()
    const anchorIdx = pagedRecords.findIndex((r) => r.id === selectionAnchorId)
    if (anchorIdx === -1) return
    let currentEndIdx = anchorIdx
    for (const id of selectedRowIds) {
      const idx = pagedRecords.findIndex((r) => r.id === id)
      if (idx === -1) continue
      if (Math.abs(idx - anchorIdx) > Math.abs(currentEndIdx - anchorIdx)) currentEndIdx = idx
    }
    const delta = e.key === 'ArrowDown' ? 1 : -1
    const newEndIdx = Math.max(0, Math.min(pagedRecords.length - 1, currentEndIdx + delta))
    setSelectedRowIds(selectionRangeIds(selectionAnchorId, newEndIdx))
    const targetId = pagedRecords[newEndIdx]?.id
    if (targetId) selectionCellRefs.current[targetId]?.focus()
  }

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

  const isEditingExpenseCell = (rowId: string, field: 'name' | 'category' | 'frequency' | 'amount') =>
    editingExpenseCell?.rowId === rowId && editingExpenseCell.field === field

  const startExpenseCellEdit = (
    rowId: string,
    field: 'name' | 'category' | 'frequency' | 'amount',
    currentValue: string
  ) => {
    if (isEditingExpenseCell(rowId, field)) return
    setEditingExpenseCell({ rowId, field })
    setExpenseCellDraft(currentValue)
  }

  const commitExpenseCellEdit = (
    rowId: string,
    field: 'name' | 'category' | 'frequency' | 'amount',
    value: string
  ) => {
    let patch: Record<string, unknown> = {}
    switch (field) {
      case 'name':
        patch = { name: value }
        break
      case 'amount':
        patch = { amount: Number(value) }
        break
      case 'frequency':
        patch = { frequency: value }
        break
      case 'category':
        patch = { categoryId: value }
        break
    }
    dispatch({ type: 'UPDATE_BUDGET_EXPENSE', year: activeYear, id: rowId, patch })
    setEditingExpenseCell(null)
    setExpenseCellDraft('')
  }

  const handleExpenseCellInputBlur = (rowId: string, field: 'name' | 'category' | 'frequency' | 'amount') => {
    if (!editingExpenseCell) return
    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false
      setEditingExpenseCell(null)
      setExpenseCellDraft('')
      return
    }
    commitExpenseCellEdit(rowId, field, expenseCellDraft)
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
      tx: {
        date: recDate,
        description,
        categoryId: recCategoryId,
        amount,
        spendExpenseId: recExpenseId || undefined,
      },
    })
    categoryDispatch({ type: 'UPSERT_CATEGORY_MAPPING', description, categoryId: recCategoryId })
    const recordYear = recDate.slice(0, 4)
    setSelectedYear(recordYear)
    if (!state.budgetExpensesByYear[recordYear]) {
      dispatch({ type: 'ENSURE_BUDGET_YEAR_SNAPSHOT', year: recordYear })
    }
    setRecError('')
    setRecDate('')
    setRecDescription('')
    setRecAmount('')
    setRecCategoryTouchedManually(false)
    setRecExpenseId('')
  }

  // csvText holds raw text for parsing — CSV or OFX/QFX depending on importTab.
  // importFileKind (derived from the uploaded file's extension) drives which upload parser runs.
  const handleImportFileSelect = (file: File | null) => {
    setImportError(null)
    setImportResult(null)
    if (!file) return
    const lower = file.name.toLowerCase()
    setImportFileKind(lower.endsWith('.csv') ? 'csv' : 'ofx')
    const reader = new FileReader()
    reader.onload = () => {
      setCsvText(String(reader.result ?? ''))
    }
    reader.readAsText(file)
    setImportFileName(file.name)
  }

  const reportImport = (parsed: Array<{ date: string; description: string; amount: number }>, detected: number) => {
    const withAccount = parsed.map((r) => ({ ...r, accountName: importAccountName.trim() }))
    const { duplicateCount } = resolveBudgetImportRows(
      state.budgetTransactions,
      withAccount,
      categories,
      categoryMappings,
      state.budgetExpensesByYear
    )
    dispatch({ type: 'IMPORT_BUDGET_TRANSACTIONS', rows: withAccount, categories, categoryMappings })
    setImportResult({ detected, failed: detected - parsed.length, imported: parsed.length - duplicateCount, duplicates: duplicateCount })
    setImportStatus(`${parsed.length} row(s) detected`)
  }

  const handleImport = () => {
    if (importTab === 'paste') {
      reportImport(parseBudgetTransactionsCsv(csvText), countBudgetCsvDataRows(csvText))
    } else if (importFileKind === 'csv') {
      const parsed = parseBudgetTransactionsCsv(csvText)
      if (parsed.length === 0) {
        setImportError('No transactions found in file — check it has date/description/amount columns')
        return
      }
      setImportError(null)
      reportImport(parsed, countBudgetCsvDataRows(csvText))
    } else {
      const parsed = parseOfxTransactions(csvText)
      if (parsed.length === 0) {
        setImportError("No transactions found in file — check it's a valid OFX/QFX export")
        return
      }
      setImportError(null)
      reportImport(parsed, parsed.length)
    }
  }

  const closeImportDialog = () => {
    setShowImportDialog(false)
    setCsvText('')
    setImportAccountName('')
    setImportError(null)
    setImportFileKind(null)
    setImportResult(null)
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

        {period === 'yearly' && (
          <div className="field" style={{ maxWidth: '220px' }}>
            <label>Year</label>
            <select
              className="input"
              aria-label="Select year"
              value={selectedYear}
              onChange={(e) => {
                setSelectedYear(e.target.value)
                if (!state.budgetExpensesByYear[e.target.value]) {
                  dispatch({ type: 'ENSURE_BUDGET_YEAR_SNAPSHOT', year: e.target.value })
                }
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
        )}
      </div>

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

        {selectedRowIds.size > 0 && (
          <div
            data-testid="bulk-action-bar"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              marginBottom: 'var(--space-3)',
            }}
          >
            <span style={{ fontSize: '12px' }}>{`${selectedRowIds.size} selected`}</span>
            <SpendCategoryPicker
              expenses={activeYearExpenses}
              categoriesById={categoriesById}
              value={bulkExpenseId}
              ariaLabel="Bulk edit spend category"
              onChange={(expenseId, categoryId) => {
                setBulkExpenseId(expenseId)
                setBulkCategoryId(categoryId)
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={!bulkCategoryId}
              onClick={() => {
                dispatch({
                  type: 'UPDATE_BUDGET_TRANSACTIONS_BULK',
                  ids: Array.from(selectedRowIds),
                  categoryId: bulkCategoryId,
                  spendExpenseId: bulkExpenseId,
                })
                setSelectedRowIds(new Set())
                setSelectionAnchorId(null)
                setBulkCategoryId('')
                setBulkExpenseId('')
              }}
            >
              Apply
            </button>
          </div>
        )}

        {searchedRecords.length === 0 ? (
          <div className="text-muted" style={{ fontSize: '12px', padding: 'var(--space-4) 0' }}>
            No records for this period.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '28px' }}></th>
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
                    Spend Category
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
              {pagedRecords.map((row, idx) => {
                const isSelected = selectedRowIds.has(row.id)
                return (
                  <tr key={row.id}>
                    <td
                      ref={(el) => {
                        selectionCellRefs.current[row.id] = el
                      }}
                      data-testid={`row-select-${row.id}`}
                      tabIndex={0}
                      aria-selected={isSelected}
                      style={{
                        cursor: 'pointer',
                        background: isSelected ? 'var(--color-accent-2-100)' : undefined,
                      }}
                      onClick={(e) => handleSelectionCellClick(e, row.id, idx)}
                      onKeyDown={handleSelectionCellKeyDown}
                    ></td>
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
                    <td onClick={() => startCellEdit(row.id, 'category', row.spendExpenseId ?? '')}>
                      {isEditingCell(row.id, 'category') ? (
                        <SpendCategoryPicker
                          expenses={resolveBudgetExpensesForYear(state.budgetExpensesByYear, row.date.slice(0, 4))}
                          categoriesById={categoriesById}
                          value={cellDraft}
                          ariaLabel="Edit record spend category"
                          onChange={(expenseId, categoryId) => {
                            dispatch({
                              type: 'UPDATE_BUDGET_TRANSACTION',
                              id: row.id,
                              patch: { spendExpenseId: expenseId, categoryId },
                            })
                            categoryDispatch({
                              type: 'UPSERT_CATEGORY_MAPPING',
                              description: row.description,
                              categoryId,
                            })
                            setEditingCell(null)
                            setCellDraft('')
                          }}
                        />
                      ) : (
                        <span className="tag tag-neutral">
                          {categoriesById.get(effectiveCategoryId(row, state.budgetExpensesByYear)) ??
                            effectiveCategoryId(row, state.budgetExpensesByYear)}
                        </span>
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
                <td colSpan={5} style={{ borderTop: '2px solid var(--color-divider)', fontWeight: 600 }}>
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
            <label>Spend Category</label>
            <SpendCategoryPicker
              expenses={activeYearExpenses}
              categoriesById={categoriesById}
              value={recExpenseId}
              ariaLabel="Record spend category"
              onChange={(expenseId, categoryId) => {
                setRecExpenseId(expenseId)
                setRecCategoryId(categoryId)
                setRecCategoryTouchedManually(true)
              }}
            />
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
              return (
                <tr key={row.id}>
                  <td onClick={() => startExpenseCellEdit(row.id, 'name', row.name)}>
                    {isEditingExpenseCell(row.id, 'name') ? (
                      <input
                        type="text"
                        className="input"
                        aria-label="Edit expense name"
                        autoFocus
                        value={expenseCellDraft}
                        onChange={(e) => setExpenseCellDraft(e.target.value)}
                        onKeyDown={handleCellInputKeyDown}
                        onBlur={() => handleExpenseCellInputBlur(row.id, 'name')}
                      />
                    ) : (
                      row.name
                    )}
                  </td>
                  <td onClick={() => startExpenseCellEdit(row.id, 'category', row.categoryId)}>
                    {isEditingExpenseCell(row.id, 'category') ? (
                      <select
                        className="input"
                        aria-label="Edit expense category"
                        autoFocus
                        value={expenseCellDraft}
                        onChange={(e) =>
                          handleCategorySelectChange(e.target.value, setNewCategoryPrompt, (categoryId) => {
                            // Unlike spend-records' category cell, this does NOT upsert a
                            // CategoryMapping — mapping upsert is only for transaction-description
                            // auto-categorization, which doesn't apply to expense names.
                            dispatch({
                              type: 'UPDATE_BUDGET_EXPENSE',
                              year: activeYear,
                              id: row.id,
                              patch: { categoryId },
                            })
                            setEditingExpenseCell(null)
                            setExpenseCellDraft('')
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
                  <td onClick={() => startExpenseCellEdit(row.id, 'frequency', row.frequency)}>
                    {isEditingExpenseCell(row.id, 'frequency') ? (
                      <select
                        className="input"
                        aria-label="Edit expense frequency"
                        autoFocus
                        value={row.frequency}
                        onChange={(e) => commitExpenseCellEdit(row.id, 'frequency', e.target.value)}
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
                  <td style={{ textAlign: 'right' }} onClick={() => startExpenseCellEdit(row.id, 'amount', String(row.amount))}>
                    {isEditingExpenseCell(row.id, 'amount') ? (
                      <input
                        type="number"
                        className="input"
                        aria-label="Edit expense amount"
                        autoFocus
                        value={expenseCellDraft}
                        onChange={(e) => setExpenseCellDraft(e.target.value)}
                        onKeyDown={handleCellInputKeyDown}
                        onBlur={() => handleExpenseCellInputBlur(row.id, 'amount')}
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
                    <button
                      type="button"
                      style={{ ...iconBtn, color: LOSS_COLOR }}
                      aria-label="Delete expense"
                      title="Delete expense"
                      onClick={() => {
                        const referencingCount = state.budgetTransactions.filter(
                          (t) => t.date.slice(0, 4) === activeYear && t.spendExpenseId === row.id
                        ).length
                        if (referencingCount > 0) {
                          window.alert(
                            `Cannot delete: ${referencingCount} spend record(s) use this expense as their Spend Category.`
                          )
                          return
                        }
                        if (window.confirm('Delete this expense? This cannot be undone.')) {
                          dispatch({ type: 'DELETE_BUDGET_EXPENSE', year: activeYear, id: row.id })
                        }
                      }}
                    >
                      <TrashIcon />
                    </button>
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
                    onChange={(e) => {
                      setCsvText(e.target.value)
                      setImportResult(null)
                    }}
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
                      accept=".csv,.ofx,.qfx"
                      aria-label="CSV, OFX, or QFX file"
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

              {importResult && (
                <div
                  className="text-muted"
                  style={{ marginTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: '2px' }}
                >
                  <div>{importResult.detected} row(s) detected</div>
                  <div style={{ color: GAIN_COLOR }}>{importResult.imported} imported</div>
                  {importResult.duplicates > 0 && <div>{importResult.duplicates} skipped (already imported)</div>}
                  {importResult.failed > 0 && (
                    <div style={{ color: 'var(--color-danger)' }}>
                      {importResult.failed} row(s) failed to parse (check date/description/amount columns)
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={closeImportDialog}>
                {importResult ? 'Close' : 'Cancel'}
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
