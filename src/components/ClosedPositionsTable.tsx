import type { AppState } from '../lib/state'
import { findMatchingOpenPosition, isExactLotMatch } from '../lib/state'
import type { ClosedPosition } from '../lib/types'
import { fmtUSD, glColor, LOSS_COLOR } from '../lib/computations'
import { Trash, RotateCcw } from 'lucide-react'

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

  const handleUndoClosedPosition = (cp: ClosedPosition) => {
    const match = findMatchingOpenPosition(state, cp)
    if (!match) {
      dispatch({ type: 'RESTORE_CLOSED_POSITION', closedPositionId: cp.id })
      return
    }
    if (isExactLotMatch(match, cp)) {
      const confirmed = window.confirm(
        `An open position already exists for ${cp.symbol} with the same shares and cost basis. Restore this closed position and replace the existing one?`
      )
      if (!confirmed) return
      dispatch({
        type: 'RESTORE_CLOSED_POSITION',
        closedPositionId: cp.id,
        replaceExistingPositionId: match.id,
      })
      return
    }
    dispatch({ type: 'RESTORE_CLOSED_POSITION', closedPositionId: cp.id })
  }

  return (
    <table className="table" style={{ marginBottom: 'var(--space-2)' }}>
      <thead>
        <tr>
          <th>Security</th>
          <th>Closed</th>
          <th style={{ textAlign: 'right' }}>Realized G/L</th>
          <th style={{ textAlign: 'center', width: '40px' }}></th>
        </tr>
      </thead>
      <tbody>
        {state.closedPositions.map((cp) => {
          const glColorVal = cp.realizedGL !== null ? glColor(cp.realizedGL) : LOSS_COLOR
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
              <td style={{ textAlign: 'right', color: glColorVal, fontWeight: '600' }}>{glStr}</td>
              <td style={{ textAlign: 'center', display: 'flex', gap: '8px', justifyContent: 'center' }}>
                <button
                  onClick={() => handleUndoClosedPosition(cp)}
                  className="btn-icon"
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
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-accent-700)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-secondary)')}
                  title="Reopen this position as an import"
                >
                  <RotateCcw size={16} />
                </button>
                <button
                  onClick={() => handleDeleteClosedPosition(cp.id)}
                  className="btn-icon"
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
