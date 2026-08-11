import type { AppState } from '../lib/state'
import { allocationBars } from '../lib/selectors'

export interface AllocationChartProps {
  state: AppState
}

/**
 * Renders asset allocation by asset class as a bar list.
 * Each bar shows: label (asset class) + USD value + percentage + visual indicator.
 * Structure matches .dc.html lines 80-94.
 */
export function AllocationChart({ state }: AllocationChartProps) {
  const bars = allocationBars(state)

  return (
    <div className="card blueprint elev-sm">
      <i className="corner tl"></i>
      <i className="corner tr"></i>
      <i className="corner bl"></i>
      <i className="corner br"></i>

      <div className="card-title" style={{ marginBottom: 'var(--space-3)' }}>
        Allocation
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-3) var(--space-6)' }}>
        {bars.map((bar, idx) => {
          // Extract numeric percentage value from formatted string (e.g., "+25.00%" -> 25)
          const numericPct = parseFloat(bar.pct.replace(/[^0-9.]/g, ''))

          return (
            <div key={idx}>
              {/* Label + value inline on one line, with percentage on right */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '12px',
                  marginBottom: '3px'
                }}
              >
                <span>
                  {bar.label} <span className="text-muted" style={{ fontSize: '11px' }}>{bar.value}</span>
                </span>
                <span className="text-muted">{bar.pct}</span>
              </div>

              {/* Visual bar indicator */}
              <div
                style={{
                  height: '6px',
                  border: '1px solid var(--color-divider)',
                  background: 'transparent'
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${numericPct}%`,
                    background: 'var(--color-accent)'
                  }}
                ></div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
