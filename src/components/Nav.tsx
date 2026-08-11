import { useCallback } from 'react'
import type { AppState } from '../lib/state'

export interface NavProps {
  state: AppState
  dispatch: (action: any) => void
}

/**
 * Nav component: category tabs and settings button.
 */
export function Nav({ state, dispatch }: NavProps) {
  const categoryTabs = [
    { value: 'all', label: 'All' },
    { value: 'taxable', label: 'Taxable' },
    { value: 'nonTaxable', label: 'Non-Taxable' },
    { value: 'taxDeferred', label: 'Tax-Deferred' },
  ]

  const handleCategoryChange = useCallback(
    (category: 'all' | 'taxable' | 'nonTaxable' | 'taxDeferred') => {
      dispatch({
        type: 'SET_CATEGORY',
        category,
      })
    },
    [dispatch]
  )

  return (
    <div
      className="nav"
      style={{
        borderBottom: '1px solid var(--color-divider)',
        background: 'var(--color-surface)',
        padding: 'var(--space-3) var(--space-6)',
      }}
    >
      <div className="nav-brand" style={{ marginRight: 'var(--space-5)' }}>Ledger</div>

      {/* Category tabs */}
      <div className="seg">
        {categoryTabs.map((tab) => (
          <label
            key={tab.value}
            className="seg-opt"
            onClick={() =>
              handleCategoryChange(
                tab.value as 'all' | 'taxable' | 'nonTaxable' | 'taxDeferred'
              )
            }
          >
            <input
              type="radio"
              name="category"
              checked={state.category === tab.value}
              readOnly
            />
            <span>{tab.label}</span>
          </label>
        ))}
      </div>

      {/* Settings button */}
      <button
        onClick={() => dispatch({ type: 'SET_VIEW', view: 'settings' })}
        title="Settings"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontSize: '20px',
          padding: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-secondary)',
          transition: 'color 0.2s',
          marginLeft: 'auto',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-secondary)')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      </button>
    </div>
  )
}
