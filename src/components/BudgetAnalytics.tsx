import type { AppState } from '../lib/state'
import type { Category } from '../lib/types'
import { availableBudgetYears } from '../lib/selectors'

interface BudgetAnalyticsProps {
  state: AppState
  categories: Category[]
}

const EMPTY_STATE_MESSAGE = 'No records for this period.'

const SECTIONS = [
  'Areas of concern',
  'Savings rate by year',
  'Category share of spend',
  'Monthly seasonality',
  'Budget accuracy by year',
  'Category trends year over year',
  'Biggest movers',
] as const

export function BudgetAnalytics({ state, categories }: BudgetAnalyticsProps) {
  void categories
  const years = availableBudgetYears(state.budgetTransactions, new Date()).slice(0, 8)
  void years
  const hasData = state.budgetTransactions.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {SECTIONS.map((title) => (
        <div key={title} className="card blueprint elev-sm">
          <div className="card-title" style={{ marginBottom: 'var(--space-3)' }}>
            {title}
          </div>
          {!hasData && (
            <div className="text-muted" style={{ fontSize: '12px', padding: 'var(--space-4) 0' }}>
              {EMPTY_STATE_MESSAGE}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
