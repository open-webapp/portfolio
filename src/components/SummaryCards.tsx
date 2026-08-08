import type { AppState } from '../lib/state'
import { summaryCards } from '../lib/selectors'

export interface SummaryCardsProps {
  state: AppState
}

/**
 * Renders 4 summary cards using design system styling.
 * Each card displays: label + formatted value + optional change indicator.
 * Structure matches .dc.html lines 50-61.
 */
export function SummaryCards({ state }: SummaryCardsProps) {
  const cards = summaryCards(state)

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 'var(--space-4)',
        marginBottom: 'var(--space-6)'
      }}
    >
      {cards.map((card, idx) => (
        <div key={idx} className="card blueprint elev-sm">
          <i className="corner tl"></i>
          <i className="corner tr"></i>
          <i className="corner bl"></i>
          <i className="corner br"></i>
          <div className="card-kicker">{card.label}</div>
          <div
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: '28px',
              fontWeight: '600',
              color: card.color
            }}
          >
            {card.value}
          </div>
          {card.sub && (
            <div
              className="card-meta"
              style={{
                color: card.color
              }}
            >
              {card.sub}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
