import { useCallback } from 'react'
import type { AppState } from '../lib/state'

export interface NavProps {
  state: AppState
  dispatch: (action: any) => void
}

/**
 * Nav component: date range select.
 */
export function Nav({ state, dispatch }: NavProps) {
  const rangeOptions = [
    { value: '6m', label: '6 Months' },
    { value: '1y', label: '1 Year' },
    { value: 'ytd', label: 'YTD' },
    { value: 'all', label: 'All' },
  ]

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
