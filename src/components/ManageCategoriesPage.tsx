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
      <main className="page">
        <button type="button" onClick={navigateToPicker}>Back</button>
        <h1>Manage categories</h1>
        <p>Loading categories...</p>
      </main>
    )
  }

  const visible = visibleCategories({ categories, categoryMappings: [], budgetAccountRules: [] })

  return (
    <main className="page">
      <button type="button" onClick={navigateToPicker}>Back</button>
      <h1>Manage categories</h1>
      <div>
        {visible.map((category) => (
          <div key={category.id}>
            {editingCategoryId === category.id ? (
              <>
                <input
                  aria-label={`Category name for ${category.name}`}
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                />
                <button type="button" onClick={() => saveRename(category)}>Done</button>
              </>
            ) : (
              <>
                <span>{category.name}</span>
                <button
                  type="button"
                  aria-label={`Rename ${category.name}`}
                  onClick={() => {
                    setEditingCategoryId(category.id)
                    setEditingName(category.name)
                  }}
                >
                  Pencil
                </button>
              </>
            )}
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
              Exclude from spend
            </label>
            <button
              type="button"
              aria-label={`Delete ${category.name}`}
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
              Trash
            </button>
          </div>
        ))}
      </div>
      <div>
        <input
          aria-label="New category name"
          value={newCategoryName}
          onChange={(event) => setNewCategoryName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addCategory()
          }}
        />
        <button type="button" onClick={addCategory}>Add</button>
      </div>
    </main>
  )
}
