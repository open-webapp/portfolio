import { useCallback } from 'react'
import type { AppState } from '../lib/state'

export interface NavProps {
  state: AppState
  dispatch: (action: any) => void
}

/**
 * Nav component: category tabs and date range select.
 */
export function Nav({ state, dispatch }: NavProps) {
  const categoryTabs = [
    { value: 'all', label: 'All' },
    { value: 'taxable', label: 'Taxable' },
    { value: 'nonTaxable', label: 'Non-Taxable' },
    { value: 'taxDeferred', label: 'Tax-Deferred' },
  ]

  const rangeOptions = [
    { value: '6m', label: '6 Months' },
    { value: '1y', label: '1 Year' },
    { value: 'ytd', label: 'YTD' },
    { value: 'all', label: 'All' },
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

  const handleRangeChange = useCallback(
    (range: string) => {
      dispatch({
        type: 'SET_RANGE',
        range,
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
      <div className="nav-brand">Ledger</div>

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

      {/* Date range select */}
      <select
        className="input"
        onChange={(e) => handleRangeChange(e.target.value)}
        value={state.range}
        style={{ width: 'auto', marginLeft: 'var(--space-4)' }}
      >
        {rangeOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

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
        ⚙️
      </button>
    </div>
  )
}
