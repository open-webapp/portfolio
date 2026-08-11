import type { AppState } from '../lib/state'
import { segmentSummaryCards } from '../lib/selectors'

export interface SegmentSummaryCardsProps {
  state: AppState
  retirement: boolean
  label: string
}

/**
 * Renders a set of three summary cards for a portfolio segment (e.g., taxable vs. retirement).
 * The outer container uses design system card styling (.card.blueprint.elev-sm + corners).
 * Inside: a kicker label and a 3-column grid of card cells without individual card wrappers.
 */
export function SegmentSummaryCards({ state, retirement, label }: SegmentSummaryCardsProps) {
  const cards = segmentSummaryCards(state, retirement)

  // Helper to render a single card's inner content (without wrapper)
  const renderCard = (card: typeof cards[0], idx: number) => (
    <div key={idx}>
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
  )

  return (
    <div className="card blueprint elev-sm">
      <i className="corner tl"></i>
      <i className="corner tr"></i>
      <i className="corner bl"></i>
      <i className="corner br"></i>

      <div
        className="text-muted"
        style={{
          fontSize: '11px',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 'var(--space-3)'
        }}
      >
        {label}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 'var(--space-4)'
        }}
      >
        {cards.map((card, idx) => renderCard(card, idx))}
      </div>
    </div>
  )
}
