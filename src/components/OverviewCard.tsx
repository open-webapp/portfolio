import type { AppState } from '../lib/state'
import { summaryCards, segmentSummaryCards } from '../lib/selectors'

export interface OverviewCardProps {
  state: AppState
}

/**
 * Renders a 3-column overview card with All Together, Retirement, and Non-Retirement clusters.
 * Each cluster displays summary cards (Total Value, Total Gain/Loss, Amount Invested).
 * Only cluster 1 ("All Together") displays the sub field (GL percentage).
 */
export function OverviewCard({ state }: OverviewCardProps) {
  const allCards = summaryCards(state)
  const retirementCards = segmentSummaryCards(state, true)
  const nonRetirementCards = segmentSummaryCards(state, false)

  const renderCluster = (label: string, cards: typeof allCards, showSub: boolean = false) => (
    <div>
      <div
        className="text-muted"
        style={{
          fontSize: '10px',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: '6px'
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-4)'
        }}
      >
        {cards.map((card, idx) => (
          <div key={idx}>
            <div className="card-kicker">{card.label}</div>
            <div
              style={{
                fontFamily: 'var(--font-heading)',
                fontSize: '15px',
                fontWeight: '600',
                color: card.color
              }}
            >
              {card.value}
              {showSub && card.sub && (
                <span className="card-meta" style={{ fontSize: '10px', marginLeft: '4px' }}>
                  {card.sub}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="card blueprint elev-sm">
      <i className="corner tl"></i>
      <i className="corner tr"></i>
      <i className="corner bl"></i>
      <i className="corner br"></i>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 'var(--space-5)'
        }}
      >
        {renderCluster('All Together', allCards, true)}
        {renderCluster('Retirement', retirementCards, false)}
        {renderCluster('Non-Retirement', nonRetirementCards, false)}
      </div>
    </div>
  )
}
