import type { AppState } from '../lib/state'
import { segmentCards } from '../lib/selectors'

export interface OverviewCardProps {
  state: AppState
}

/**
 * Renders a 2-column overview card with Retirement and Non-Retirement segments.
 * Each segment displays total value and gain/loss in a single value block.
 */
export function OverviewCard({ state }: OverviewCardProps) {
  const retirementSummary = segmentCards(state, true)
  const nonRetirementSummary = segmentCards(state, false)

  const renderSegment = (label: string, summary: typeof retirementSummary) => (
    <div>
      <div
        style={{
          textAlign: 'center',
          fontSize: '10px',
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: '6px'
        }}
      >
        {label}
      </div>
      <div className="card blueprint elev-sm">
        <div
          style={{
            fontFamily: 'var(--font-heading)',
            fontSize: '15px',
            fontWeight: '600',
            color: 'var(--color-text)'
          }}
        >
          {summary.totalValueStr}
          <span
            className="tag"
            style={{
              marginTop: '4px',
              fontSize: '10px',
              color: summary.glColor,
              borderColor: summary.glColor,
              display: 'block'
            }}
          >
            {summary.glStr}
          </span>
        </div>
      </div>
    </div>
  )

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 'var(--space-5)'
      }}
    >
      {renderSegment('Retirement', retirementSummary)}
      {renderSegment('Non-Retirement', nonRetirementSummary)}
    </div>
  )
}
