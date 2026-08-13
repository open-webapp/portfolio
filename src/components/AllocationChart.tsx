import type { Position } from '../lib/types'
import { allocationBars } from '../lib/selectors'

export interface AllocationChartProps {
  positions: Position[]
}

/**
 * Renders asset allocation by asset class as a bar list.
 * Each bar shows: label (asset class) + USD value + percentage + visual indicator.
 * Structure matches .dc.html lines 80-94.
 */
export function AllocationChart({ positions }: AllocationChartProps) {
  const bars = allocationBars(positions)

  return (
    <div className="card blueprint elev-sm">
      <div className="card-title" style={{ marginBottom: 'var(--space-3)' }}>
        Allocation
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-3) var(--space-6)' }}>
        {bars.map((bar, idx) => (
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
                  width: `${bar.pctNum}%`,
                  background: 'var(--color-accent)'
                }}
              ></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
