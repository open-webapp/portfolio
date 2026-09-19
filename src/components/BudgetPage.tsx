import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import type { AppState } from '../lib/state'
import { resolveBudgetImportRows } from '../lib/state'
import {
  deleteCategoryMapping,
  resolveSpendExpenseIdForDescription,
  updateCategoryMapping,
  upsertCategoryMapping,
  type CategoryAction,
} from '../lib/categoryStore'
import type { Category, CategoryMapping } from '../lib/types'
import { BudgetAnalytics } from './BudgetAnalytics'
import { BudgetExpensesTab } from './BudgetExpensesTab'
import { CategoryMappingTab } from './CategoryMappingTab'
import { SpendCategoryPicker } from './SpendCategoryPicker'
import { fmtUSD, GAIN_COLOR, LOSS_COLOR, parseBudgetTransactionsCsv, parseOfxTransactions, countBudgetCsvDataRows } from '../lib/computations'
import {
  budgetTransactionsForPeriod,
  availableBudgetYears,
  budgetedIncomeForYear,
  actualIncomeForYear,
  excludedCategoryIdSet,
  isIncomeOrExcludedTransaction,
  effectiveCategoryId,
  formatSpendCategoryLabel,
} from '../lib/selectors'

export interface BudgetPageProps {
  state: AppState
  dispatch: (action: any) => void
  categories: Category[]
  categoryMappings: CategoryMapping[]
  categoryDispatch: (action: CategoryAction) => void
  categoriesHydrated: boolean
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

function MappingIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <path d="M10 13a5 5 0 0 0 7.07.07l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15"></path>
      <path d="M14 11a5 5 0 0 0-7.07-.07l-2 2A5 5 0 0 0 12 20l1.15-1.15"></path>
    </svg>
  )
}

/**
 * Budget page: Expenses/Spend/Analytics tab toggle.
 * - Expenses tab (BudgetExpensesTab): Category Breakdown (own independent
 *   year selector) + a multi-year Expense table of global ExpenseDefinitions.
 * - Spend tab: year selector, 4 summary cards, and the Spend records table
 *   for `selectedYear`, re-pointed at budgetExpenseDefinitions +
 *   budgetExpenseAmountsByYear[selectedYear].
 * - Analytics tab: unchanged, delegates to BudgetAnalytics.
 */
export function BudgetPage({ state, dispatch, categories, categoryMappings, categoryDispatch, categoriesHydrated }: BudgetPageProps) {
  const [period, setPeriod] = useState<'expenses' | 'spend' | 'analytics' | 'categoryMapping'>('spend')
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
  const categoriesById = new Map(categories.map((c) => [c.id, c.name]))
  const [selectedYear, setSelectedYear] = useState(
    () => availableBudgetYears(state.budgetTransactions, new Date())[0]
  )
  const [editingCell, setEditingCell] = useState<{
    rowId: string
    field: 'date' | 'description' | 'category' | 'account' | 'amount'
  } | null>(null)
  const [editingMappingId, setEditingMappingId] = useState<string | null>(null)
  const [editingMappingSubstringId, setEditingMappingSubstringId] = useState<string | null>(null)
  const [mappingSubstringDraft, setMappingSubstringDraft] = useState('')
  const [cellDraft, setCellDraft] = useState('')
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

  const totalBudgetedIncome = budgetedIncomeForYear(
    state.budgetExpenseDefinitions,
    state.budgetExpenseAmountsByYear,
    categories,
    selectedYear
  )
  const totalActualIncome = actualIncomeForYear(
    state.budgetTransactions,
    categories,
    state.budgetExpenseDefinitions,
    selectedYear
  )
  const amountsForYear = state.budgetExpenseAmountsByYear[selectedYear] ?? {}
  const excludedCategoryIds = excludedCategoryIdSet(categories)
  const totalExpense = state.budgetExpenseDefinitions.reduce(
    (sum, definition) => excludedCategoryIds.has(definition.categoryId) ? sum : sum + (amountsForYear[definition.id] ?? 0),
    0
  )

  const availableYears = availableBudgetYears(state.budgetTransactions, new Date())
  const currentMonthValue = new Date().toISOString().slice(0, 7)

  const periodFilteredTransactions = budgetTransactionsForPeriod(
    state.budgetTransactions,
    'yearly',
    currentMonthValue,
    selectedYear
  )
  const nonExcludedTransactions = periodFilteredTransactions.filter(
    (t) => !isIncomeOrExcludedTransaction(t, categories, state.budgetExpenseDefinitions)
  )
  const totalActual = nonExcludedTransactions.reduce((sum, t) => sum + t.amount, 0)
  const variance = totalExpense - totalActual
  const rangeLabel = selectedYear

  const recordSourceTransactions = showExcludedRecords
    ? periodFilteredTransactions
    : periodFilteredTransactions.filter(
        (t) => !isIncomeOrExcludedTransaction(t, categories, state.budgetExpenseDefinitions)
      )
  const filteredRecords = recordSearch.trim()
    ? recordSourceTransactions.filter((t) => {
        const searchLower = recordSearch.toLowerCase()
        const categoryLabel = formatSpendCategoryLabel(
          t.spendExpenseId,
          effectiveCategoryId(t, state.budgetExpenseDefinitions),
          state.budgetExpenseDefinitions,
          categoriesById
        )
        return (
          t.description.toLowerCase().includes(searchLower) ||
          categoryLabel.toLowerCase().includes(searchLower) ||
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
        const catA = effectiveCategoryId(a, state.budgetExpenseDefinitions)
        const catB = effectiveCategoryId(b, state.budgetExpenseDefinitions)
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
  const mappingsForExpense = (expenseId: string) =>
    categoryMappings.filter((mapping) => {
      const mappingStatus = mapping as CategoryMapping & {
        tombstoned?: boolean
        deleted?: boolean
        deletedAt?: string | null
      }
      return mapping.spendExpenseId === expenseId && !mappingStatus.tombstoned && !mappingStatus.deleted && !mappingStatus.deletedAt
    })
  const editingMappingRow = editingMappingId
    ? state.budgetTransactions.find((transaction) => transaction.id === editingMappingId)
    : undefined
  const editingMappingExpense = editingMappingRow?.spendExpenseId
    ? state.budgetExpenseDefinitions.find((definition) => definition.id === editingMappingRow.spendExpenseId)
    : undefined
  const editingMappings = editingMappingExpense
    ? mappingsForExpense(editingMappingExpense.id)
    : []

  useEffect(() => {
    if (!editingMappingId) return
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (editingMappingSubstringId) {
          setEditingMappingSubstringId(null)
          setMappingSubstringDraft('')
        } else {
          setEditingMappingId(null)
          setMappingSubstringDraft('')
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editingMappingId, editingMappingSubstringId])

  const saveMappingSubstring = (mapping: CategoryMapping) => {
    const substring = mappingSubstringDraft.trim()
    if (!substring || substring === mapping.substring) return
    categoryDispatch({ type: 'UPDATE_CATEGORY_MAPPING', id: mapping.id, patch: { substring } })
    const nextMappings = updateCategoryMapping({ categories, categoryMappings }, mapping.id, { substring }).categoryMappings
    dispatch({ type: 'REAPPLY_CATEGORY_MAPPINGS', categoryMappings: nextMappings })
    setEditingMappingSubstringId(null)
    setMappingSubstringDraft('')
  }

  const deleteMapping = (mapping: CategoryMapping) => {
    if (!window.confirm('Delete this mapping? This cannot be undone.')) return
    categoryDispatch({ type: 'DELETE_CATEGORY_MAPPING', id: mapping.id })
    const nextMappings = deleteCategoryMapping({ categories, categoryMappings }, mapping.id).categoryMappings
    dispatch({ type: 'REAPPLY_CATEGORY_MAPPINGS', categoryMappings: nextMappings })
  }

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
    categoryDispatch({ type: 'UPSERT_CATEGORY_MAPPING', description, spendExpenseId: recExpenseId })
    {
      const nextMappings = upsertCategoryMapping({ categories, categoryMappings }, description, recExpenseId).categoryMappings
      dispatch({ type: 'REAPPLY_CATEGORY_MAPPINGS', categoryMappings: nextMappings })
    }
    const recordYear = recDate.slice(0, 4)
    setSelectedYear(recordYear)
    if (!state.budgetExpenseAmountsByYear[recordYear]) {
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
      state.budgetExpenseDefinitions
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
          {(['expenses', 'spend', 'analytics', 'categoryMapping'] as const).map((opt) => (
            <label
              key={opt}
              className="seg-opt"
              onClick={() => {
                setPeriod(opt)
                setRecPage(0)
              }}
            >
              <input type="radio" name="budgetPeriod" checked={period === opt} readOnly />
              <span>{opt === 'expenses' ? 'Expenses' : opt === 'spend' ? 'Spend' : opt === 'analytics' ? 'Analytics' : 'Category Mapping'}</span>
            </label>
          ))}
        </div>

        {period === 'spend' && (
          <div className="field" style={{ maxWidth: '220px' }}>
            <label>Year</label>
            <select
              className="input"
              aria-label="Select year"
              value={selectedYear}
              onChange={(e) => {
                setSelectedYear(e.target.value)
                if (!state.budgetExpenseAmountsByYear[e.target.value]) {
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

      {period === 'categoryMapping' ? (
        <CategoryMappingTab
          state={state}
          dispatch={dispatch}
          categories={categories}
          categoryMappings={categoryMappings}
          categoryDispatch={categoryDispatch}
          categoriesHydrated={categoriesHydrated}
        />
      ) : period === 'analytics' ? (
        <BudgetAnalytics state={state} categories={categories} />
      ) : period === 'expenses' ? (
        <BudgetExpensesTab state={state} dispatch={dispatch} categories={categories} categoryDispatch={categoryDispatch} />
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
          <div className="text-muted">Budgeted income</div>
          <div style={{ fontSize: '1.5rem' }}>{fmtUSD(totalBudgetedIncome)}</div>
        </div>
        <div className="card blueprint elev-sm">
          <div className="text-muted">Actual income ({rangeLabel})</div>
          <div style={{ fontSize: '1.5rem' }}>{fmtUSD(totalActualIncome)}</div>
        </div>
        <div className="card blueprint elev-sm">
          <div className="text-muted">Budgeted spending</div>
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
              definitions={state.budgetExpenseDefinitions}
              categoriesById={categoriesById}
              value={bulkExpenseId}
              fallbackCategoryId={bulkCategoryId}
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
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                          {row.description}
                          {row.spendExpenseId &&
                            state.budgetExpenseDefinitions.some((definition) => definition.id === row.spendExpenseId) &&
                            mappingsForExpense(row.spendExpenseId).length > 0 && (
                              <button
                                type="button"
                                style={iconBtn}
                                aria-label={`Edit category mappings for ${row.description}`}
                                title="Edit category mappings"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  setEditingMappingId(row.id)
                                  setEditingMappingSubstringId(null)
                                  setMappingSubstringDraft('')
                                }}
                              >
                                <MappingIcon />
                              </button>
                            )}
                        </span>
                      )}
                    </td>
                    <td onClick={() => startCellEdit(row.id, 'category', row.spendExpenseId ?? '')}>
                      {isEditingCell(row.id, 'category') ? (
                        <SpendCategoryPicker
                          definitions={state.budgetExpenseDefinitions}
                          categoriesById={categoriesById}
                          value={cellDraft}
                          fallbackCategoryId={effectiveCategoryId(row, state.budgetExpenseDefinitions)}
                          ariaLabel="Edit record spend category"
                          onChange={(expenseId, categoryId) => {
                            dispatch({
                              type: 'UPDATE_BUDGET_TRANSACTION',
                              id: row.id,
                              patch: { spendExpenseId: expenseId || undefined, categoryId },
                            })
                            categoryDispatch({
                              type: 'UPSERT_CATEGORY_MAPPING',
                              description: row.description,
                              spendExpenseId: expenseId,
                            })
                            {
                              const nextMappings = upsertCategoryMapping(
                                { categories, categoryMappings },
                                row.description,
                                expenseId
                              ).categoryMappings
                              dispatch({ type: 'REAPPLY_CATEGORY_MAPPINGS', categoryMappings: nextMappings })
                            }
                            setEditingCell(null)
                            setCellDraft('')
                          }}
                        />
                      ) : (
                        <span className="tag tag-neutral">
                          {formatSpendCategoryLabel(
                            row.spendExpenseId,
                            effectiveCategoryId(row, state.budgetExpenseDefinitions),
                            state.budgetExpenseDefinitions,
                            categoriesById
                          )}
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
                  const match = resolveSpendExpenseIdForDescription(categoryMappings, e.target.value)
                  if (match) {
                    const foundExpense = state.budgetExpenseDefinitions.find((d) => d.id === match)
                    if (foundExpense) {
                      setRecExpenseId(match)
                      setRecCategoryId(foundExpense.categoryId)
                    }
                  }
                }
              }}
            />
          </div>
          <div className="field">
            <label>Spend Category</label>
            <SpendCategoryPicker
              definitions={state.budgetExpenseDefinitions}
              categoriesById={categoriesById}
              value={recExpenseId}
              fallbackCategoryId={recCategoryId}
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

      {editingMappingId && (
        <div className="dialog-backdrop">
          <div
            className="dialog blueprint"
            role="dialog"
            aria-modal="true"
            aria-label="Category mappings"
            data-mapping-substring-draft={mappingSubstringDraft}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="dialog-title">Category mappings</div>
              <button
                type="button"
                style={iconBtn}
                aria-label="Close"
                onClick={() => {
                  setEditingMappingId(null)
                  setEditingMappingSubstringId(null)
                  setMappingSubstringDraft('')
                }}
              >
                ×
              </button>
            </div>
            <div className="dialog-body">
              {editingMappings.length === 0 ? (
                <div className="text-muted">No category mappings.</div>
              ) : (
                editingMappings.map((mapping) => (
                  <div key={mapping.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    {editingMappingSubstringId === mapping.id ? (
                      <input
                        type="text"
                        className="input"
                        aria-label="Edit category mapping substring"
                        autoFocus
                        value={mappingSubstringDraft}
                        onChange={(event) => setMappingSubstringDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') saveMappingSubstring(mapping)
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        style={{ ...textBtnAccent, color: 'inherit', fontWeight: 400 }}
                        aria-label={`Edit category mapping ${mapping.substring}`}
                        onClick={() => {
                          setEditingMappingSubstringId(mapping.id)
                          setMappingSubstringDraft(mapping.substring)
                        }}
                      >
                        {mapping.substring}
                      </button>
                    )}
                    <button
                      type="button"
                      style={{ ...iconBtn, color: LOSS_COLOR }}
                      aria-label={`Delete category mapping ${mapping.substring}`}
                      title="Delete category mapping"
                      onClick={() => deleteMapping(mapping)}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
