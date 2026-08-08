import type { AppState } from '../lib/state'
import { fmtUSD } from '../lib/computations'

export interface ClosedPositionsTableProps {
  state: AppState
  dispatch: (action: any) => void
}

/**
 * ClosedPositionsTable component: displays closed positions with symbol, name, closed date, and realized G/L.
 * Per .dc.html lines 190-205.
 */
export function ClosedPositionsTable({ state }: ClosedPositionsTableProps) {
  return (
    <table className="table" style={{ marginBottom: 'var(--space-2)' }}>
      <thead>
        <tr>
          <th>Security</th>
          <th>Closed</th>
          <th style={{ textAlign: 'right' }}>Realized G/L</th>
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

          return (
            <tr key={cp.id}>
              <td>
                <div style={{ fontWeight: '600' }}>{cp.symbol}</div>
                <div style={{ fontSize: '11px' }} className="text-muted">
                  {cp.name}
                </div>
              </td>
              <td className="text-muted">{cp.closedDate}</td>
              <td style={{ textAlign: 'right', color: glColor, fontWeight: '600' }}>{glStr}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
