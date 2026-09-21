import { fmtUSD } from '../lib/computations'
import { expenseStreamBands } from '../lib/selectors'
import type { BudgetTransaction, Category, ExpenseDefinition } from '../lib/types'

export interface BudgetStreamChartProps {
  transactions: BudgetTransaction[]
  categories: Category[]
  definitions: ExpenseDefinition[]
}

export function BudgetStreamChart({ transactions, categories, definitions }: BudgetStreamChartProps) {
  const { years, bands, legend } = expenseStreamBands(transactions, categories, definitions)
  const hasData = years.length > 0 && bands.length > 0

  return (
    <div className="card blueprint elev-sm" style={{ marginBottom: 'var(--space-4)' }} data-testid="expense-stream-chart">
      <div className="card-title" style={{ marginBottom: 'var(--space-3)' }}>Expense by category</div>
      {!hasData ? (
        <div className="text-muted" style={{ fontSize: '12px' }}>No expense activity to chart.</div>
      ) : (
        <>
          <div style={{ position: 'relative', height: '220px', marginBottom: 'var(--space-4)' }}>
            <svg viewBox="0 0 1120 220" width="100%" height="100%" role="img" aria-label="Expense by category over time" preserveAspectRatio="none">
              {bands.map((band) => (
                <path key={band.categoryId} data-testid="expense-stream-band" d={band.d} fill={band.color} />
              ))}
            </svg>
            {years.map((year, index) => (
              <div
                key={year}
                data-testid="expense-stream-year"
                className="text-muted"
                style={{
                  position: 'absolute',
                  bottom: '-18px',
                  left: `${years.length === 1 ? 50 : (index * 100) / (years.length - 1)}%`,
                  transform: 'translateX(-50%)',
                  fontSize: '11px',
                }}
              >
                {year}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }} aria-label="Expense by category legend">
            {legend.map((entry) => (
              <div key={entry.categoryId} data-testid="expense-stream-legend" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: '12px' }}>
                <span data-testid="expense-stream-swatch" aria-hidden="true" style={{ width: '10px', height: '10px', background: entry.color }} />
                <span>{entry.label}</span>
                <span className="text-muted">{fmtUSD(entry.total)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
