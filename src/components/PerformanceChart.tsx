import type { AppState } from '../lib/state'
import { performanceLinePoints, totalValueSeries } from '../lib/selectors'

export interface PerformanceChartProps {
  state: AppState
}

/**
 * Renders an SVG polyline chart showing portfolio performance over time.
 * Displays portfolio value from PortfolioSnapshot history, normalized to fit chart space.
 * Structure matches .dc.html lines 64-78.
 */
export function PerformanceChart({ state }: PerformanceChartProps) {
  const linePoints = performanceLinePoints(state, state.range)
  const series = totalValueSeries(state)

  // Format date labels
  let startLabel = 'N/A'
  let endLabel = 'N/A'

  if (series.length > 0) {
    startLabel = series[0].date
    endLabel = series[series.length - 1].date
  }

  return (
    <div className="card blueprint elev-sm">
      <i className="corner tl"></i>
      <i className="corner tr"></i>
      <i className="corner bl"></i>
      <i className="corner br"></i>

      <div className="card-title" style={{ marginBottom: 'var(--space-3)' }}>
        Performance
      </div>

      <svg viewBox="0 0 100 500" style={{ width: '100%', height: '170px', display: 'block' }}>
        {/* Horizontal divider lines at quartile marks */}
        <line x1="0" y1="125" x2="100" y2="125" stroke="var(--color-divider)" strokeWidth="1"></line>
        <line x1="0" y1="250" x2="100" y2="250" stroke="var(--color-divider)" strokeWidth="1"></line>
        <line x1="0" y1="375" x2="100" y2="375" stroke="var(--color-divider)" strokeWidth="1"></line>

        {/* Polyline for performance data */}
        {linePoints && (
          <polyline
            points={linePoints}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          ></polyline>
        )}
      </svg>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '11px',
          marginTop: 'var(--space-2)'
        }}
        className="text-muted"
      >
        <span>{startLabel}</span>
        <span>{endLabel}</span>
      </div>
    </div>
  )
}
