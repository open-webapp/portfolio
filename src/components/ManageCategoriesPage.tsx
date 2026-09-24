import { useState } from 'react'
import type { Category } from '../lib/types'
import { type CategoryAction, visibleCategories } from '../lib/categoryStore'
import { uid } from '../lib/seed'
import { navigateToPicker } from '../lib/router'

interface ManageCategoriesPageProps {
  categories: Category[]
  categoryDispatch: (action: CategoryAction) => void
  categoriesHydrated: boolean
}

export function ManageCategoriesPage({
  categories,
  categoryDispatch,
  categoriesHydrated,
}: ManageCategoriesPageProps) {
  const [newCategoryName, setNewCategoryName] = useState('')
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  function addCategory() {
    const name = newCategoryName.trim()
    if (!name) return
    categoryDispatch({ type: 'ADD_CATEGORY', id: uid('category'), name })
    setNewCategoryName('')
  }

  function saveRename(category: Category) {
    const name = editingName.trim()
    if (name) categoryDispatch({ type: 'RENAME_CATEGORY', id: category.id, name })
    setEditingCategoryId(null)
  }

  if (!categoriesHydrated) {
    return (
      <main className="page" style={{ display: 'flex', justifyContent: 'center', padding: '64px var(--space-4)' }}>
        <div style={{ width: '100%', maxWidth: 520, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          <div className="card blueprint elev-sm" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <button type="button" className="btn btn-ghost" onClick={navigateToPicker}>Back</button>
            <h1>Budget Categories</h1>
            <p>Loading categories...</p>
          </div>
        </div>
      </main>
    )
  }

  const visible = visibleCategories({ categories, budgetAccountRules: [] })

  return (
    <main className="page" style={{ display: 'flex', justifyContent: 'center', padding: '64px var(--space-4)' }}>
      <div style={{ width: '100%', maxWidth: 520, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        <div className="card blueprint elev-sm" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <button type="button" className="btn btn-ghost" onClick={navigateToPicker}>Back</button>
      <h1>Budget Categories</h1>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Exclude from spend</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((category) => (
            <tr key={category.id}>
              <td>
                {editingCategoryId === category.id ? (
                  <div className="field">
                    <input
                      className="input"
                      aria-label={`Category name for ${category.name}`}
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                    />
                    <button type="button" onClick={() => saveRename(category)}>Done</button>
                  </div>
                ) : (
                  <span>{category.name}</span>
                )}
              </td>
              <td>
                <label>
                  <input
                    type="checkbox"
                    checked={category.excludeFromSpend ?? false}
                    onChange={(event) => categoryDispatch({
                      type: 'SET_CATEGORY_EXCLUDE_FROM_SPEND',
                      id: category.id,
                      exclude: event.target.checked,
                    })}
                  />
                </label>
              </td>
              <td>
                {editingCategoryId !== category.id && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-icon"
                    aria-label={`Rename ${category.name}`}
                    title={`Rename ${category.name}`}
                    onClick={() => {
                      setEditingCategoryId(category.id)
                      setEditingName(category.name)
                    }}
                  >
                    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-secondary btn-icon"
                  aria-label={`Delete ${category.name}`}
                  title={`Delete ${category.name}`}
                  onClick={() => {
                    if (category.name === 'Other') {
                      window.alert('The "Other" category cannot be deleted.')
                      return
                    }
                    if (window.confirm(`Delete category "${category.name}"? This cannot be undone.`)) {
                      categoryDispatch({ type: 'DELETE_CATEGORY', id: category.id })
                    }
                  }}
                >
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hr" />
      <div className="field" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 'var(--space-3)' }}>
        <input
          className="input"
          aria-label="New category name"
          value={newCategoryName}
          onChange={(event) => setNewCategoryName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addCategory()
          }}
        />
        <button type="button" className="btn btn-primary" onClick={addCategory}>Add</button>
      </div>
        </div>
      </div>
    </main>
  )
}
