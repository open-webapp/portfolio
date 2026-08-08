import type { AppState } from '../lib/state'
import { fmtUSD } from '../lib/computations'
import { Trash } from 'lucide-react'

export interface ClosedPositionsTableProps {
  state: AppState
  dispatch: (action: any) => void
}

/**
 * ClosedPositionsTable component: displays closed positions with symbol, name, closed date, and realized G/L.
 * Per .dc.html lines 190-205.
 */
export function ClosedPositionsTable({ state, dispatch }: ClosedPositionsTableProps) {
  const handleDeleteClosedPosition = (id: string) => {
    const confirmed = window.confirm(
      'Delete this closed position? This permanently discards its realized G/L history.'
    )
    if (confirmed) {
      dispatch({ type: 'DELETE_CLOSED_POSITION', id })
    }
  }

  return (
    <table className="table" style={{ marginBottom: 'var(--space-2)' }}>
      <thead>
        <tr>
          <th>Security</th>
          <th>Closed</th>
          <th style={{ textAlign: 'right' }}>Realized G/L</th>
          <th style={{ width: '40px' }}></th>
        </tr>
      </thead>
      <tbody>
        {state.closedPositions.map((cp) => {
          const glColor = cp.realizedGL !== null && cp.realizedGL >= 0 ? 'var(--color-accent-700)' : '#8a3c2e'
          const glStr =
            cp.realizedGL === null
              ? cp.realizedGLBasis === 'unknown'
                ? 'unknown'
                : '—'
              : (cp.realizedGL >= 0 ? '+' : '') + fmtUSD(cp.realizedGL)
          const displayName = cp.name ?? cp.symbol

          return (
            <tr key={cp.id}>
              <td>
                <div style={{ fontWeight: '600' }}>{cp.symbol}</div>
                <div style={{ fontSize: '11px' }} className="text-muted">
                  {displayName}
                </div>
              </td>
              <td className="text-muted">{cp.closedDate}</td>
              <td style={{ textAlign: 'right', color: glColor, fontWeight: '600' }}>{glStr}</td>
              <td style={{ textAlign: 'center', paddingRight: '8px' }}>
                <button
                  onClick={() => handleDeleteClosedPosition(cp.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--color-text-secondary)',
                    transition: 'color 0.2s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#8a3c2e')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-secondary)')}
                  title="Delete this closed position"
                >
                  <Trash size={16} />
                </button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
