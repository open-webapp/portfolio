import { useEffect, useRef, useState, type CSSProperties, type Dispatch, type KeyboardEvent, type MouseEvent, type SetStateAction } from 'react'
import type { AppState } from '../lib/state'
import { resolveBudgetImportRows } from '../lib/state'
import {
  resolveSpendExpenseIdForDescription,
  type CategoryAction,
} from '../lib/categoryStore'
import type { BudgetAccountRule, Category, CategoryMapping } from '../lib/types'
import {
  budgetAccountViewRows,
  canonicalBudgetAccountName,
  convertBudgetAccountImportRows,
  desiredBudgetAccountConvention,
} from '../lib/budgetAccountRules'
import { BudgetAnalytics } from './BudgetAnalytics'
import { BudgetSankey } from './BudgetSankey'
import { BudgetExpensesTab } from './BudgetExpensesTab'
import { CategoryMappingTab } from './CategoryMappingTab'
import { SpendCategoryPicker } from './SpendCategoryPicker'
import { TagInput } from './TagInput'
import { fmtUSD, GAIN_COLOR, LOSS_COLOR, parseBudgetTransactionsCsv, parseOfxTransactions, countBudgetCsvDataRows } from '../lib/computations'
import { applyAutoTags } from '../lib/autoTag'
import {
  isIncomeOrExcludedTransaction,
  effectiveCategoryId,
  computeRecurringSpendIds,
  formatSpendCategoryLabel,
  SPEND_ALL_YEARS,
  spendBudgetYears,
  spendTransactionsForScope,
  spendCardTotals,
  projectedSpendForScope,
  savingsRateByYear,
  sankeyFlowData,
  incomeCategoryIdSet,
  type SpendScope,
} from '../lib/selectors'

export interface BudgetPageProps {
  state: AppState
  dispatch: (action: any) => void
  categories: Category[]
  categoryMappings: CategoryMapping[]
  categoryDispatch: (action: CategoryAction) => void
  categoriesHydrated: boolean
  budgetAccountRules?: BudgetAccountRule[]
  period: 'expenses' | 'spend' | 'analytics' | 'categoryMapping'
  setPeriod: (period: 'expenses' | 'spend' | 'analytics' | 'categoryMapping') => void
  selectedScope: SpendScope
  setSelectedScope: Dispatch<SetStateAction<SpendScope>>
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

/**
 * Auto tags visible on a spend record: auto-first order with cross-dupe
 * suppression — an auto chip whose lowercase matches any user chip on the
 * same record is hidden (the red user chip wins).
 */
function visibleAutoTags(row: { tags?: string[]; autoTags?: string[] }): string[] {
  const userLower = new Set((row.tags ?? []).map((t) => t.toLowerCase()))
  return (row.autoTags ?? []).filter((auto) => !userLower.has(auto.toLowerCase()))
}

export interface CategoryMappingsDialogProps {
  mappings: CategoryMapping[]
  onUpdate: (mapping: CategoryMapping, substring: string) => void | Promise<void>
  onDelete: (mapping: CategoryMapping) => void | Promise<void>
  onClose: () => void
}

export function CategoryMappingsDialog({ mappings, onUpdate, onDelete, onClose }: CategoryMappingsDialogProps) {
  const [editingMappingSubstringId, setEditingMappingSubstringId] = useState<string | null>(null)
  const [mappingSubstringDraft, setMappingSubstringDraft] = useState('')

  const close = () => {
    setEditingMappingSubstringId(null)
    setMappingSubstringDraft('')
    onClose()
  }

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (editingMappingSubstringId) {
        setEditingMappingSubstringId(null)
        setMappingSubstringDraft('')
      } else {
        close()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editingMappingSubstringId])

  const save = (mapping: CategoryMapping) => {
    const substring = mappingSubstringDraft.trim()
    if (!substring || substring === mapping.substring) return
    void onUpdate(mapping, substring)
    setEditingMappingSubstringId(null)
    setMappingSubstringDraft('')
  }

  const remove = (mapping: CategoryMapping) => {
    if (!window.confirm('Delete this mapping? This cannot be undone.')) return
    void onDelete(mapping)
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog blueprint category-mapping-dialog" role="dialog" aria-modal="true" aria-label="Category mappings" data-mapping-substring-draft={mappingSubstringDraft}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="dialog-title">Category mappings</div>
          <button type="button" style={iconBtn} aria-label="Close" onClick={close}>×</button>
        </div>
        <div className="dialog-body">
          {mappings.length === 0 ? (
            <div className="text-muted">No category mappings.</div>
          ) : (
            mappings.map((mapping) => (
              <div key={mapping.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                {editingMappingSubstringId === mapping.id ? (
                  <input type="text" className="input" aria-label="Edit category mapping substring" autoFocus value={mappingSubstringDraft} onChange={(event) => setMappingSubstringDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') save(mapping) }} />
                ) : (
                  <button type="button" style={{ ...textBtnAccent, color: 'inherit', fontWeight: 400 }} aria-label={`Edit category mapping ${mapping.substring}`} onClick={() => { setEditingMappingSubstringId(mapping.id); setMappingSubstringDraft(mapping.substring) }}>
                    {mapping.substring}
                  </button>
                )}
                <button type="button" style={{ ...iconBtn, color: LOSS_COLOR }} aria-label={`Delete category mapping ${mapping.substring}`} title="Delete category mapping" onClick={() => remove(mapping)}>
                  <TrashIcon />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function RepeatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <path d="M17 2l4 4-4 4"></path>
      <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
      <path d="M7 22l-4-4 4-4"></path>
      <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path>
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
 * Budget page: Expenses/Spend/Analytics/Category Mapping tab toggle.
 * - Expenses tab (BudgetExpensesTab): Category Breakdown (own independent
 *   year selector) + a multi-year Expense table of global ExpenseDefinitions.
 * - Spend tab: scope selector, summary cards, and the Spend records table.
 * - Analytics tab: unchanged, delegates to BudgetAnalytics.
 * - Category Mapping tab (CategoryMappingTab): category CRUD plus every
 *   portfolio-scoped expense-name + category -> substring mapping,
 *   grouped by category and expense definition.
 */
export function BudgetPage({ state, dispatch, categories, categoryMappings, categoryDispatch, categoriesHydrated, budgetAccountRules = [], period, selectedScope, setSelectedScope }: BudgetPageProps) {
  const [recordSearch, setRecordSearch] = useState('')
  const [recSortBy, setRecSortBy] = useState<'date' | 'description' | 'category' | 'account' | 'amount'>('date')
  const [recSortDir, setRecSortDir] = useState<'asc' | 'desc'>('desc')
  const [recPage, setRecPage] = useState(0)
  const [showExcludedRecords, setShowExcludedRecords] = useState(false)
  const [showRecurringOnly, setShowRecurringOnly] = useState(false)
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set())
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null)
  const selectionCellRefs = useRef<Record<string, HTMLTableCellElement | null>>({})
  const [bulkCategoryId, setBulkCategoryId] = useState('')
  const [bulkExpenseId, setBulkExpenseId] = useState('')
  const [bulkTags, setBulkTags] = useState<string[]>([])
  const categoriesById = new Map(categories.map((c) => [c.id, c.name]))
  const recurringIds = computeRecurringSpendIds(state.budgetTransactions, categories, state.budgetExpenseDefinitions)
  const [editingCell, setEditingCell] = useState<{
    rowId: string
    field: 'date' | 'description' | 'category' | 'account' | 'amount' | 'tags'
  } | null>(null)
  const [editingMappingId, setEditingMappingId] = useState<string | null>(null)
  const [cellDraft, setCellDraft] = useState('')
  const [cellTagsDraft, setCellTagsDraft] = useState<string[]>([])
  const skipBlurCommitRef = useRef(false)
  const [recDate, setRecDate] = useState('')
  const [recDescription, setRecDescription] = useState('')
  const [recCategoryId, setRecCategoryId] = useState(categories[0]?.id ?? '')
  const [recCategoryTouchedManually, setRecCategoryTouchedManually] = useState(false)
  const [recExpenseId, setRecExpenseId] = useState('')
  const [recTags, setRecTags] = useState<string[]>([])
  const [recAmount, setRecAmount] = useState('')
  const [recError, setRecError] = useState('')
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [importTab, setImportTab] = useState<'paste' | 'upload'>('paste')
  const [csvText, setCsvText] = useState('')
  const [importFileName, setImportFileName] = useState('')
  const [importAccountSelection, setImportAccountSelection] = useState('')
  const [importAccountName, setImportAccountName] = useState('')
  const [importStatus, setImportStatus] = useState('Never imported')
  const [importError, setImportError] = useState<string | null>(null)
  const [importFileKind, setImportFileKind] = useState<'csv' | 'ofx' | null>(null)
  const [importResult, setImportResult] = useState<{ detected: number; converted: number; failed: number; imported: number; duplicates: number } | null>(null)
  const importFileInputRef = useRef<HTMLInputElement>(null)
  const [isEditingIncome, setIsEditingIncome] = useState(false)
  const [incomeDraft, setIncomeDraft] = useState('')
  const [autoTagFeedback, setAutoTagFeedback] = useState<string | null>(null)
  const autoTagFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [clearScope, setClearScope] = useState<'user' | 'auto' | 'both' | null>(null)

  const { budgetedSpend: totalExpense, actualSpend: totalActual } = spendCardTotals(
    state.budgetExpenseDefinitions,
    state.budgetExpenseAmountsByYear,
    state.budgetTransactions,
    categories,
    selectedScope
  )

  const availableYears = spendBudgetYears(state.budgetTransactions)
  const incomeCategoryIds = incomeCategoryIdSet(categories)
  const incomeDefinition = state.budgetExpenseDefinitions.find((definition) => incomeCategoryIds.has(definition.categoryId))
  const incomeCategoryId = categories.find((category) => incomeCategoryIds.has(category.id))?.id
  const projectedSpend = projectedSpendForScope(
    state.budgetExpenseDefinitions,
    state.budgetExpenseAmountsByYear,
    state.budgetTransactions,
    categories,
    selectedScope,
    new Date()
  )
  const savingsRate = selectedScope === SPEND_ALL_YEARS
    ? null
    : savingsRateByYear([selectedScope], state.budgetTransactions, categories, state.budgetExpenseDefinitions)[0]
  const spendPct = totalExpense > 0 ? (totalActual / totalExpense) * 100 : 0
  const importAccounts = budgetAccountViewRows(budgetAccountRules, state.budgetTransactions)
  const selectedImportAccountName = importAccountSelection === '__new__'
    ? importAccountName.trim()
    : canonicalBudgetAccountName(budgetAccountRules, importAccountSelection) ?? importAccountSelection.trim()

  useEffect(() => {
    if (selectedScope !== SPEND_ALL_YEARS && !availableYears.includes(selectedScope)) {
      setSelectedScope(SPEND_ALL_YEARS)
    }
  }, [availableYears, selectedScope])

  useEffect(() => {
    setRecPage(0)
  }, [selectedScope])

  useEffect(() => {
    return () => {
      if (autoTagFeedbackTimer.current) clearTimeout(autoTagFeedbackTimer.current)
    }
  }, [])

  const periodFilteredTransactions = spendTransactionsForScope(state.budgetTransactions, selectedScope)
  const rangeLabel = selectedScope === SPEND_ALL_YEARS ? 'All years' : selectedScope
  const sankey = sankeyFlowData(
    state.budgetExpenseDefinitions,
    state.budgetExpenseAmountsByYear,
    state.budgetTransactions,
    categories,
    selectedScope
  )

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
          (t.accountName ?? '').toLowerCase().includes(searchLower) ||
          (t.tags ?? []).some((tag) => tag.toLowerCase().includes(searchLower)) ||
          (t.autoTags ?? []).some((tag) => tag.toLowerCase().includes(searchLower))
        )
      })
    : recordSourceTransactions
  const recurringFilteredRecords = showRecurringOnly ? filteredRecords.filter((t) => recurringIds.has(t.id)) : filteredRecords
  const toggleRecSort = (field: 'date' | 'description' | 'category' | 'account' | 'amount') => {
    if (recSortBy === field) {
      setRecSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setRecSortBy(field)
      setRecSortDir(field === 'date' ? 'desc' : 'asc')
    }
  }
  const searchedRecords = [...recurringFilteredRecords].sort((a, b) => {
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
    categoryMappings.filter((mapping) => mapping.spendExpenseId === expenseId)
  const editingMappingRow = editingMappingId
    ? state.budgetTransactions.find((transaction) => transaction.id === editingMappingId)
    : undefined
  const editingMappingExpense = editingMappingRow?.spendExpenseId
    ? state.budgetExpenseDefinitions.find((definition) => definition.id === editingMappingRow.spendExpenseId)
    : undefined
  const editingMappings = editingMappingExpense
    ? mappingsForExpense(editingMappingExpense.id)
    : []

  const saveMappingSubstring = (mapping: CategoryMapping, substring: string) => {
    dispatch({ type: 'UPDATE_CATEGORY_MAPPING', id: mapping.id, patch: { substring } })
  }

  const deleteMapping = (mapping: CategoryMapping) => {
    if (!window.confirm('Delete this mapping? This cannot be undone.')) return
    dispatch({ type: 'DELETE_CATEGORY_MAPPING', id: mapping.id })
  }

  const handleAutoTag = () => {
    const { taggedCount } = applyAutoTags(state.budgetTransactions)
    dispatch({ type: 'AUTO_TAG_BUDGET_TRANSACTIONS' })
    setAutoTagFeedback(taggedCount >= 1 ? `Tagged ${taggedCount} record(s)` : 'No new tags found')
    if (autoTagFeedbackTimer.current) clearTimeout(autoTagFeedbackTimer.current)
    autoTagFeedbackTimer.current = setTimeout(() => setAutoTagFeedback(null), 4000)
  }

  const userTaggedCount = state.budgetTransactions.filter((t) => (t.tags ?? []).length > 0).length
  const autoTaggedCount = state.budgetTransactions.filter((t) => (t.autoTags ?? []).length > 0).length
  const anyTaggedCount = state.budgetTransactions.filter(
    (t) => (t.tags ?? []).length > 0 || (t.autoTags ?? []).length > 0
  ).length
  const flashAutoTagFeedback = (text: string) => {
    setAutoTagFeedback(text)
    if (autoTagFeedbackTimer.current) clearTimeout(autoTagFeedbackTimer.current)
    autoTagFeedbackTimer.current = setTimeout(() => setAutoTagFeedback(null), 4000)
  }

  const handleClearTags = () => {
    if (anyTaggedCount === 0) {
      flashAutoTagFeedback('No tags to clear')
      return
    }
    setClearScope('user')
  }

  const confirmClearScope = () => {
    const scope = clearScope
    setClearScope(null)
    if (scope === 'user') {
      if (userTaggedCount === 0) {
        flashAutoTagFeedback('No user tags to clear')
        return
      }
      dispatch({ type: 'CLEAR_BUDGET_TRANSACTION_TAGS' })
      flashAutoTagFeedback(`Cleared user tags from ${userTaggedCount} record(s)`)
    } else if (scope === 'auto') {
      if (autoTaggedCount === 0) {
        flashAutoTagFeedback('No auto-tags to clear')
        return
      }
      dispatch({ type: 'CLEAR_BUDGET_TRANSACTION_AUTO_TAGS' })
      flashAutoTagFeedback(`Cleared auto-tags from ${autoTaggedCount} record(s)`)
    } else if (scope === 'both') {
      if (anyTaggedCount === 0) {
        flashAutoTagFeedback('No tags to clear')
        return
      }
      dispatch({ type: 'CLEAR_BUDGET_TRANSACTION_TAGS' })
      dispatch({ type: 'CLEAR_BUDGET_TRANSACTION_AUTO_TAGS' })
      flashAutoTagFeedback(`Cleared all tags from ${anyTaggedCount} record(s)`)
    }
  }

  const clearConfirmCopy =
    clearScope === 'user'
      ? `Remove user tags from ${userTaggedCount} record(s)? This cannot be undone.`
      : clearScope === 'auto'
        ? `Remove auto-tags from ${autoTaggedCount} record(s)? This cannot be undone.`
        : `Remove all tags from ${anyTaggedCount} record(s)? This cannot be undone.`

  // Clears row selection whenever the visible set/order of Spend records can
  // change out from under it (paging, sorting, searching, or switching
  // period/year) so stale selections never point at rows no longer shown.
  const prevSpendResetKeys = useRef<{
    recPage: number
    recSortBy: string
    recSortDir: string
    recordSearch: string
    showRecurringOnly: boolean
    period: string
    selectedScope: SpendScope
  } | null>(null)
  useEffect(() => {
    setSelectedRowIds(new Set())
    setSelectionAnchorId(null)
    setBulkCategoryId('')
    const prev = prevSpendResetKeys.current
    prevSpendResetKeys.current = { recPage, recSortBy, recSortDir, recordSearch, showRecurringOnly, period, selectedScope }
    if (!prev) return
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recPage, recSortBy, recSortDir, recordSearch, showRecurringOnly, period, selectedScope])

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

  const isEditingCell = (rowId: string, field: 'date' | 'description' | 'category' | 'account' | 'amount' | 'tags') =>
    editingCell?.rowId === rowId && editingCell.field === field

  const startCellEdit = (
    rowId: string,
    field: 'date' | 'description' | 'category' | 'account' | 'amount' | 'tags',
    currentValue: string | string[]
  ) => {
    if (isEditingCell(rowId, field)) return
    setEditingCell({ rowId, field })
    if (field === 'tags') {
      setCellTagsDraft(Array.isArray(currentValue) ? [...currentValue] : [])
    } else {
      setCellDraft(currentValue as string)
    }
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
        if (!Number.isFinite(Number(value))) {
          setEditingCell(null)
          setCellDraft('')
          return
        }
        patch = { amount: Number(value) }
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

  const commitTagsEdit = (rowId: string, tags: string[]) => {
    dispatch({ type: 'UPDATE_BUDGET_TRANSACTION', id: rowId, patch: { tags: tags.length ? tags : undefined } })
    setEditingCell(null)
    setCellTagsDraft([])
  }

  const handleTagsCellBlur = (rowId: string) => {
    if (!editingCell) {
      if (skipBlurCommitRef.current) skipBlurCommitRef.current = false
      return
    }
    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false
      setEditingCell(null)
      setCellTagsDraft([])
      return
    }
    commitTagsEdit(rowId, cellTagsDraft)
  }

  const handleTagsCellKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape') return
    skipBlurCommitRef.current = true
    setEditingCell(null)
    setCellTagsDraft([])
  }

  const handleAddRecord = () => {
    const amount = Number(recAmount)
    if (!recDate) {
      setRecError('Date is required.')
      return
    }
    if (!Number.isFinite(amount) || amount === 0) {
      setRecError('Amount must be a nonzero number.')
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
        tags: recTags.length ? recTags : undefined,
      },
    })
    dispatch({ type: 'UPSERT_CATEGORY_MAPPING', description, spendExpenseId: recExpenseId })
    const recordYear = recDate.slice(0, 4)
    if (selectedScope !== SPEND_ALL_YEARS) {
      setSelectedScope(recordYear)
      if (!state.budgetExpenseAmountsByYear[recordYear]) {
        dispatch({ type: 'ENSURE_BUDGET_YEAR_SNAPSHOT', year: recordYear })
      }
    }
    setRecError('')
    setRecDate('')
    setRecDescription('')
    setRecAmount('')
    setRecCategoryTouchedManually(false)
    setRecExpenseId('')
    setRecTags([])
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
    if (!selectedImportAccountName || parsed.length === 0) return
    const withAccount = parsed.map((r) => ({ ...r, accountName: selectedImportAccountName }))
    const convertedRows = convertBudgetAccountImportRows(withAccount, budgetAccountRules)
    const { duplicateCount } = resolveBudgetImportRows(
      state.budgetTransactions,
      convertedRows,
      categories,
      categoryMappings,
      state.budgetExpenseDefinitions
    )
    dispatch({
      type: 'IMPORT_BUDGET_TRANSACTIONS',
      rows: convertedRows,
      categories,
      categoryMappings,
      appliedConvention: {
        accountName: selectedImportAccountName,
        statementConvention: desiredBudgetAccountConvention(budgetAccountRules, selectedImportAccountName),
      },
    })
    setImportResult({ detected, converted: parsed.length, failed: detected - parsed.length, imported: parsed.length - duplicateCount, duplicates: duplicateCount })
    setImportStatus(`${parsed.length} row(s) converted`)
  }

  const handleImport = () => {
    if (importTab === 'paste') {
      const parsed = parseBudgetTransactionsCsv(csvText)
      if (parsed.length === 0) {
        setImportError('No transactions found in CSV — check it has date/description/amount columns')
        return
      }
      setImportError(null)
      reportImport(parsed, countBudgetCsvDataRows(csvText))
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
    setImportAccountSelection('')
    setImportAccountName('')
    setImportError(null)
    setImportFileKind(null)
    setImportResult(null)
  }

  const commitIncome = () => {
    if (selectedScope === SPEND_ALL_YEARS || !incomeCategoryId) return
    const parsed = Number(incomeDraft)
    const amount = Number.isFinite(parsed) ? Math.max(0, parsed) : 0
    if (incomeDefinition) {
      dispatch({ type: 'SET_EXPENSE_AMOUNT', year: selectedScope, expenseId: incomeDefinition.id, amount })
    } else {
      dispatch({
        type: 'ADD_EXPENSE_DEFINITION',
        definition: { name: 'Income', categoryId: incomeCategoryId, frequency: 'yearly' },
        amount,
      })
    }
    setIsEditingIncome(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
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
          <div className="text-muted">Spend vs budget ({rangeLabel})</div>
          <div style={{ fontSize: '1.5rem' }}>{spendPct.toFixed(1)}%</div>
          <div style={{ height: '6px', background: 'var(--color-divider)', marginTop: 'var(--space-2)' }}>
            <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, spendPct))}%`, background: totalActual <= totalExpense ? GAIN_COLOR : LOSS_COLOR }} />
          </div>
          <div className="text-muted" style={{ fontSize: '12px', marginTop: 'var(--space-2)' }}>
            Spent {fmtUSD(totalActual)} of {fmtUSD(totalExpense)} budget
          </div>
        </div>
        <div className="card blueprint elev-sm">
          <div className="text-muted">Projected spend</div>
          {projectedSpend ? (
            <>
              <div style={{ fontSize: '1.5rem' }}>{fmtUSD(projectedSpend.projectedTotal)}</div>
              <div style={{ color: projectedSpend.isOverBudget ? LOSS_COLOR : GAIN_COLOR, fontSize: '12px', marginTop: 'var(--space-2)' }}>
                {Math.abs(projectedSpend.pctOver).toFixed(1)}% {projectedSpend.isOverBudget ? 'over' : 'under'} budget
              </div>
            </>
          ) : (
            <div className="text-muted" style={{ fontSize: '1.5rem' }}>N/A</div>
          )}
        </div>
        <div className="card blueprint elev-sm">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="text-muted">Savings rate</div>
            {selectedScope !== SPEND_ALL_YEARS && incomeCategoryId && !isEditingIncome && (
              <button
                type="button"
                style={iconBtn}
                aria-label="Edit income"
                onClick={() => {
                  setIncomeDraft(String(state.budgetExpenseAmountsByYear[selectedScope]?.[incomeDefinition?.id ?? ''] ?? 0))
                  setIsEditingIncome(true)
                }}
              >
                <PencilIcon />
              </button>
            )}
          </div>
          {isEditingIncome ? (
            <input
              type="number"
              className="input"
              aria-label="Income amount"
              autoFocus
              value={incomeDraft}
              onChange={(e) => setIncomeDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setIsEditingIncome(false)
              }}
              onBlur={commitIncome}
            />
          ) : (
            <div style={{ fontSize: '1.5rem', color: savingsRate?.isPositive ? GAIN_COLOR : LOSS_COLOR }}>
              {savingsRate ? `${savingsRate.pct.toFixed(1)}%` : 'N/A'}
            </div>
          )}
        </div>
       </div>

       <BudgetSankey nodes={sankey.nodes} links={sankey.links} />

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <div className="card-title">Spend records ({rangeLabel})</div>
            <button type="button" className="btn" onClick={handleAutoTag}>
              Auto-tag records
            </button>
            <button type="button" className="btn" onClick={handleClearTags}>
              Clear all tags
            </button>
            {autoTagFeedback && (
              <span className="text-muted" style={{ fontSize: '12px' }}>
                {autoTagFeedback}
              </span>
            )}
          </div>
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
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '12px' }}>
              <input
                type="checkbox"
                checked={showRecurringOnly}
                onChange={(e) => {
                  setShowRecurringOnly(e.target.checked)
                  setRecPage(0)
                }}
              />
              Show recurring only
            </label>
            <div className="field" style={{ margin: 0, width: '220px', flex: 1 }}>
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
        <div className="text-muted" style={{ fontSize: '12px', marginBottom: 'var(--space-3)' }}>
          Gray = auto-tag, red = your tag
        </div>
        {clearScope !== null && (
          <div className="dialog-backdrop">
            <div className="dialog blueprint" role="dialog" aria-modal="true" aria-label="Clear tags">
              <div className="dialog-title">Clear tags</div>
              <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '12px' }}>
                  <input
                    type="radio"
                    name="clear-scope"
                    checked={clearScope === 'user'}
                    onChange={() => setClearScope('user')}
                  />
                  User tags ({userTaggedCount})
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '12px' }}>
                  <input
                    type="radio"
                    name="clear-scope"
                    checked={clearScope === 'auto'}
                    onChange={() => setClearScope('auto')}
                  />
                  Auto-tags ({autoTaggedCount})
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '12px' }}>
                  <input
                    type="radio"
                    name="clear-scope"
                    checked={clearScope === 'both'}
                    onChange={() => setClearScope('both')}
                  />
                  Both ({anyTaggedCount})
                </label>
                <div className="text-muted" style={{ fontSize: '12px' }}>
                  {clearConfirmCopy}
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn" onClick={() => setClearScope(null)}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn-primary" onClick={confirmClearScope}>
                    Clear
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

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
            <TagInput value={bulkTags} onChange={setBulkTags} ariaLabel="Bulk edit tags" />
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
                  tagsToAdd: bulkTags.length ? bulkTags : undefined,
                })
                setSelectedRowIds(new Set())
                setSelectionAnchorId(null)
                setBulkCategoryId('')
                setBulkExpenseId('')
                setBulkTags([])
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
                <th>Tags</th>
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
                            dispatch({
                              type: 'UPSERT_CATEGORY_MAPPING',
                              description: row.description,
                              spendExpenseId: expenseId,
                            })
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
                    <td onClick={() => startCellEdit(row.id, 'tags', row.tags ?? [])} onBlur={() => handleTagsCellBlur(row.id)} onKeyDown={handleTagsCellKeyDown}>
                      {isEditingCell(row.id, 'tags') ? (
                        <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '2px', alignItems: 'center' }}>
                          {visibleAutoTags(row).map((tag, i) => (
                            <span key={`auto-${tag.toLowerCase()}-${i}`} className="tag tag-neutral" title="Auto-tag">
                              {tag}
                            </span>
                          ))}
                          <TagInput
                            value={cellTagsDraft}
                            onChange={setCellTagsDraft}
                            onRemove={(tags) => {
                              // × persists immediately: removing the chip unmounts the
                              // focused button, so this cell's blur-commit never fires
                              // and navigating away would drop the removal. The editor
                              // stays open so multiple tags can be removed in one pass.
                              dispatch({ type: 'UPDATE_BUDGET_TRANSACTION', id: row.id, patch: { tags: tags.length ? tags : undefined } })
                              setCellTagsDraft(tags)
                            }}
                            ariaLabel="Edit record tags"
                            blockedTags={row.autoTags}
                          />
                        </span>
                      ) : visibleAutoTags(row).length === 0 && (row.tags ?? []).length === 0 ? (
                        '—'
                      ) : (
                        <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '2px' }}>
                          {visibleAutoTags(row).map((tag, i) => (
                            <span key={`auto-${tag.toLowerCase()}-${i}`} className="tag tag-neutral" title="Auto-tag">
                              {tag}
                            </span>
                          ))}
                          {(row.tags ?? []).map((tag, i) => (
                            <span key={`user-${tag.toLowerCase()}-${i}`} className="tag tag-outline">
                              {tag}
                            </span>
                          ))}
                        </span>
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
                      {recurringIds.has(row.id) && (
                        <span style={{ ...iconBtn, cursor: 'default' }} title="Recurring spend">
                          <RepeatIcon />
                        </span>
                      )}
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
                <td colSpan={6} style={{ borderTop: '2px solid var(--color-divider)', fontWeight: 600 }}>
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
            <label>Amount (signed)</label>
            <input
              type="number"
              className="input"
              aria-label="Record amount"
              placeholder="Use - for refunds or credits"
              value={recAmount}
              onChange={(e) => setRecAmount(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Tags</label>
            <TagInput value={recTags} onChange={setRecTags} ariaLabel="Record tags" />
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
                <label>Import account</label>
                <select
                  className="input"
                  aria-label="Import account"
                  value={importAccountSelection}
                  onChange={(e) => setImportAccountSelection(e.target.value)}
                >
                  <option value="">Select an account</option>
                  {importAccounts.map((account) => (
                    <option key={account.accountName} value={account.accountName}>
                      {account.accountName}
                    </option>
                  ))}
                  <option value="__new__">New account</option>
                </select>
                {importAccountSelection === '__new__' && (
                  <input
                    type="text"
                    className="input"
                    aria-label="New import account name"
                    value={importAccountName}
                    onChange={(e) => setImportAccountName(e.target.value)}
                    style={{ marginTop: 'var(--space-2)' }}
                  />
                )}
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
                  <div>{importResult.converted} row(s) converted</div>
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
                disabled={!selectedImportAccountName || (importTab === 'upload' && !!importError)}
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {editingMappingId && <CategoryMappingsDialog mappings={editingMappings} onUpdate={saveMappingSubstring} onDelete={deleteMapping} onClose={() => setEditingMappingId(null)} />}
    </div>
  )
}
