import { useCallback, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { AppState } from '../lib/state'
import type { Category, CategoryMapping } from '../lib/types'
import type { CategoryAction } from '../lib/categoryStore'
import { addCategoryMapping, deleteCategoryMapping, updateCategoryMapping } from '../lib/categoryStore'
import { mergeCategoryState } from '../lib/categoryMerge'
import {
  CategoryMappingImportError,
  downloadJsonAsFile,
  parseCategoryMappingImportFile,
} from '../lib/importExport'
import { LOSS_COLOR } from '../lib/computations'
import { mappingsForExpense } from '../lib/selectors'

const iconBtn: CSSProperties = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  padding: '4px',
  display: 'inline-flex',
  alignItems: 'center',
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

export interface CategoryMappingTabProps {
  state: AppState
  dispatch: (action: any) => void
  categories: Category[]
  categoryMappings: CategoryMapping[]
  categoryDispatch: (action: CategoryAction) => void
  categoriesHydrated: boolean
}

export function CategoryMappingTab({
  state,
  dispatch,
  categories,
  categoryMappings,
  categoryDispatch,
  categoriesHydrated,
}: CategoryMappingTabProps) {
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [categoryNameDraft, setCategoryNameDraft] = useState('')
  const [newSubstringDraftByExpense, setNewSubstringDraftByExpense] = useState<Record<string, string>>({})
  const [editingMappingId, setEditingMappingId] = useState<string | null>(null)
  const [mappingSubstringDraft, setMappingSubstringDraft] = useState('')
  const categoryImportFileInputRef = useRef<HTMLInputElement>(null)
  const [categoryImportError, setCategoryImportError] = useState<string | null>(null)

  const handleCategoryImportFileSelect = useCallback(
    (file: File | null) => {
      setCategoryImportError(null)
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const imported = parseCategoryMappingImportFile(String(reader.result ?? ''), state.budgetExpenseDefinitions)
          categoryDispatch({ type: '__MERGE_IMPORTED', imported })
          const nextMappings = mergeCategoryState({ categories, categoryMappings }, imported).categoryMappings
          dispatch({ type: 'REAPPLY_CATEGORY_MAPPINGS', categoryMappings: nextMappings })
        } catch (error) {
          if (error instanceof CategoryMappingImportError) {
            setCategoryImportError(error.message)
          } else {
            throw error
          }
        }
      }
      reader.readAsText(file)
    },
    [categoryDispatch, dispatch, categories, categoryMappings, state.budgetExpenseDefinitions]
  )

  if (!categoriesHydrated) {
    return <section className="card blueprint elev-sm">Loading category mappings...</section>
  }

  return (
    <section className="card blueprint elev-sm" style={{ marginBottom: 'var(--space-5)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <button
          className="btn btn-primary blueprint"
          onClick={() => {
            const now = new Date()
            const yyyy = now.getFullYear()
            const mm = String(now.getMonth() + 1).padStart(2, '0')
            const dd = String(now.getDate()).padStart(2, '0')
            downloadJsonAsFile({ categories, categoryMappings }, `category-mappings-${yyyy}-${mm}-${dd}.json`)
          }}
        >
          Download Category Mapping
        </button>
        <button className="btn btn-secondary blueprint" onClick={() => categoryImportFileInputRef.current?.click()}>
          Import Category Mapping
        </button>
        <input
          ref={categoryImportFileInputRef}
          type="file"
          accept="application/json"
          aria-label="Import Category Mapping file"
          style={{ display: 'none' }}
          onChange={(e) => {
            handleCategoryImportFileSelect(e.target.files?.[0] || null)
            e.target.value = ''
          }}
        />
      </div>
      {categoryImportError && (
        <p style={{ marginTop: 'var(--space-3)', marginBottom: 0, color: '#8a3c2e' }}>{categoryImportError}</p>
      )}
      <div className="card-title" style={{ marginBottom: 'var(--space-4)' }}>Category Mapping</div>
      {categories.map((category) => {
        const isEditingCategory = editingCategoryId === category.id
        const expenses = state.budgetExpenseDefinitions.filter((e) => e.categoryId === category.id)
        return (
          <div key={category.id} style={{ marginBottom: 'var(--space-4)', paddingBottom: 'var(--space-3)', borderBottom: '1px solid var(--border-color, #ddd)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              {isEditingCategory ? (
                <>
                  <input className="input" aria-label="Edit category name" value={categoryNameDraft} onChange={(e) => setCategoryNameDraft(e.target.value)} autoFocus />
                  <button type="button" style={textBtnAccent} onClick={() => {
                    categoryDispatch({ type: 'RENAME_CATEGORY', id: category.id, name: categoryNameDraft.trim() })
                    setEditingCategoryId(null)
                  }}>Done</button>
                </>
              ) : (
                <>
                  <span style={{ fontWeight: 600 }}>{category.name}</span>
                  <button type="button" style={{ ...iconBtn, color: 'var(--color-accent)' }} aria-label={`Edit category ${category.name}`} title="Edit category" onClick={() => {
                    setEditingCategoryId(category.id)
                    setCategoryNameDraft(category.name)
                  }}><PencilIcon /></button>
                </>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', marginLeft: 'var(--space-2)' }}>
                <input type="checkbox" aria-label={`Exclude ${category.name} from spend tracking`} checked={category.excludeFromSpend ?? false} onChange={(e) => categoryDispatch({ type: 'SET_CATEGORY_EXCLUDE_FROM_SPEND', id: category.id, exclude: e.target.checked })} />
                Exclude from spend tracking
              </label>
            </div>
            <div style={{ marginLeft: 'var(--space-5)', marginTop: 'var(--space-2)' }}>
              {expenses.map((expense) => {
                const mappings = mappingsForExpense(categoryMappings, expense.id)
                const newSubstringDraft = newSubstringDraftByExpense[expense.id] ?? ''
                const expenseLabel = `${expense.name} (${category.name})`
                return (
                  <div key={expense.id} style={{ marginBottom: 'var(--space-2)' }}>
                    <div style={{ fontWeight: 600 }}>{expenseLabel}</div>
                    {mappings.map((mapping) => {
                      const isEditingMapping = editingMappingId === mapping.id
                      return (
                        <div key={mapping.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
                          {isEditingMapping ? (
                            <>
                              <input className="input" aria-label="Edit mapping substring" value={mappingSubstringDraft} onChange={(e) => setMappingSubstringDraft(e.target.value)} autoFocus />
                              <button type="button" style={textBtnAccent} onClick={() => {
                                const patch = { substring: mappingSubstringDraft.trim() }
                                categoryDispatch({ type: 'UPDATE_CATEGORY_MAPPING', id: mapping.id, patch })
                                const nextMappings = updateCategoryMapping({ categories, categoryMappings }, mapping.id, patch).categoryMappings
                                dispatch({ type: 'REAPPLY_CATEGORY_MAPPINGS', categoryMappings: nextMappings })
                                setEditingMappingId(null)
                              }}>Done</button>
                            </>
                          ) : (
                            <>
                              <button type="button" style={{ ...iconBtn, color: 'var(--color-accent)' }} aria-label={`Edit substring ${mapping.substring}`} title="Edit substring" onClick={() => {
                                setEditingMappingId(mapping.id)
                                setMappingSubstringDraft(mapping.substring)
                              }}><PencilIcon /></button>
                              <span>{mapping.substring}</span>
                              <button type="button" style={{ ...iconBtn, color: LOSS_COLOR }} aria-label={`Delete substring ${mapping.substring}`} title="Delete substring" onClick={() => {
                                if (!window.confirm('Delete this mapping? This cannot be undone.')) return
                                categoryDispatch({ type: 'DELETE_CATEGORY_MAPPING', id: mapping.id })
                                const nextMappings = deleteCategoryMapping({ categories, categoryMappings }, mapping.id).categoryMappings
                                dispatch({ type: 'REAPPLY_CATEGORY_MAPPINGS', categoryMappings: nextMappings })
                              }}><TrashIcon /></button>
                            </>
                          )}
                        </div>
                      )
                    })}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                      <input className="input" placeholder="+ add substring" aria-label={`Add substring to ${expenseLabel}`} value={newSubstringDraft} onChange={(e) => setNewSubstringDraftByExpense((prev) => ({ ...prev, [expense.id]: e.target.value }))} onKeyDown={(e) => {
                        if (e.key === 'Enter' && newSubstringDraft.trim()) {
                          const substring = newSubstringDraft.trim()
                          categoryDispatch({ type: 'ADD_CATEGORY_MAPPING', spendExpenseId: expense.id, substring })
                          const nextMappings = addCategoryMapping({ categories, categoryMappings }, expense.id, substring).categoryMappings
                          dispatch({ type: 'REAPPLY_CATEGORY_MAPPINGS', categoryMappings: nextMappings })
                          setNewSubstringDraftByExpense((prev) => ({ ...prev, [expense.id]: '' }))
                        }
                      }} />
                      <button type="button" style={textBtnAccent} aria-label={`Add substring button ${expenseLabel}`} disabled={!newSubstringDraft.trim()} onClick={() => {
                        const substring = newSubstringDraft.trim()
                        categoryDispatch({ type: 'ADD_CATEGORY_MAPPING', spendExpenseId: expense.id, substring })
                        const nextMappings = addCategoryMapping({ categories, categoryMappings }, expense.id, substring).categoryMappings
                        dispatch({ type: 'REAPPLY_CATEGORY_MAPPINGS', categoryMappings: nextMappings })
                        setNewSubstringDraftByExpense((prev) => ({ ...prev, [expense.id]: '' }))
                      }}>Add</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </section>
  )
}
