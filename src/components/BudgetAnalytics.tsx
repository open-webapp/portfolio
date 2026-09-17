import type { AppState } from '../lib/state'
import type { Category } from '../lib/types'
import {
  availableBudgetYears,
  overBudgetConcern,
  spendTrendConcern,
  spikeMonthConcern,
  savingsRateShrinkingConcern,
  concentrationRiskConcern,
  savingsRateByYear,
  categoryShareOverTime,
  monthlySeasonality,
  budgetAccuracyByYear,
  categoryTrendsYoY,
  topMovers,
} from '../lib/selectors'
import { GAIN_COLOR, LOSS_COLOR, glColor } from '../lib/computations'

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

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function fmtWhole(n: number): string {
  return (n < 0 ? '-' : '') + '$' + Math.round(Math.abs(n)).toLocaleString()
}

function fmtWholePct(n: number): string {
  return (n >= 0 ? '+' : '') + Math.round(n) + '%'
}

function ConcernCard({
  kicker,
  value,
  detail,
  color,
}: {
  kicker: string
  value: string
  detail?: string
  color?: string
}) {
  return (
    <div>
      <div className="tag tag-neutral" style={{ marginBottom: 'var(--space-2)' }}>
        {kicker}
      </div>
      <div style={{ fontSize: '20px', fontWeight: 600, color }}>{value}</div>
      {detail && (
        <div className="text-muted" style={{ fontSize: '12px', marginTop: '2px' }}>
          {detail}
        </div>
      )}
    </div>
  )
}

function EmptyConcernCard({ kicker }: { kicker: string }) {
  return (
    <div>
      <div className="tag tag-neutral" style={{ marginBottom: 'var(--space-2)' }}>
        {kicker}
      </div>
      <div className="text-muted" style={{ fontSize: '12px' }}>
        {EMPTY_STATE_MESSAGE}
      </div>
    </div>
  )
}

export function BudgetAnalytics({ state, categories }: BudgetAnalyticsProps) {
  const years = availableBudgetYears(state.budgetTransactions, new Date()).slice(0, 8)
  const hasData = state.budgetTransactions.length > 0

  const overBudget = overBudgetConcern(years, state.budgetTransactions, categories, state.budgetExpensesByYear)
  const spendTrend = spendTrendConcern(years, state.budgetTransactions, categories)
  const spikeMonth = spikeMonthConcern(years, state.budgetTransactions, categories)
  const savingsShrinking = savingsRateShrinkingConcern(
    years,
    state.budgetTransactions,
    categories,
    state.budgetIncomeByYear
  )
  const concentrationRisk = concentrationRiskConcern(years, state.budgetTransactions, categories)
  const rateByYear = savingsRateByYear(years, state.budgetTransactions, categories, state.budgetIncomeByYear)
  const maxAbsPct = Math.max(1, ...rateByYear.map((r) => Math.abs(r.pct)))
  const categoryShare = categoryShareOverTime(years, state.budgetTransactions, categories)
  const seasonality = monthlySeasonality(years, state.budgetTransactions, categories)
  const maxAvgSpend = Math.max(0, ...seasonality.map((m) => m.avgSpend))
  const accuracyByYear = budgetAccuracyByYear(years, state.budgetTransactions, categories, state.budgetExpensesByYear)
  const trendsYoY = categoryTrendsYoY(years, state.budgetTransactions, categories, state.budgetExpensesByYear)
  const movers = topMovers(years, state.budgetTransactions, categories)

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
          {hasData && title === 'Areas of concern' && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 'var(--space-4)',
              }}
            >
              <ConcernCard
                kicker="Over budget"
                value={`${overBudget.count} categories`}
                detail={overBudget.count > 0 ? overBudget.categoryNames.join(', ') : 'None'}
              />

              {spendTrend === null ? (
                <EmptyConcernCard kicker="Spend trend" />
              ) : (
                <ConcernCard
                  kicker="Spend trend"
                  value={fmtWholePct(spendTrend.pctChange)}
                  color={glColor(-spendTrend.pctChange)}
                />
              )}

              {spikeMonth === null ? (
                <EmptyConcernCard kicker="Spike month" />
              ) : (
                <ConcernCard
                  kicker="Spike month"
                  value={`${MONTH_LABELS[spikeMonth.month - 1]} ${spikeMonth.year}`}
                  detail={`${fmtWhole(spikeMonth.total)} · z=${spikeMonth.zScore.toFixed(1)}`}
                />
              )}

              {savingsShrinking === null ? (
                <EmptyConcernCard kicker="Savings rate" />
              ) : (
                <ConcernCard
                  kicker="Savings rate"
                  value={fmtWholePct(savingsShrinking.lastRate)}
                  detail={`${savingsShrinking.drop >= 0 ? 'down' : 'up'} from ${Math.round(
                    savingsShrinking.firstRate
                  )}% in ${savingsShrinking.firstYear} to ${Math.round(savingsShrinking.lastRate)}% in ${
                    savingsShrinking.lastYear
                  }`}
                  color={glColor(-savingsShrinking.drop)}
                />
              )}

              {concentrationRisk !== null && (
                <ConcernCard
                  kicker="Concentration risk"
                  value={`${concentrationRisk.categoryName} — ${Math.round(concentrationRisk.topSharePct)}%`}
                  color={concentrationRisk.isHighRisk ? LOSS_COLOR : undefined}
                />
              )}
            </div>
          )}
          {hasData && title === 'Savings rate by year' && (
            <>
              {rateByYear.length === 0 ? (
                <div className="text-muted" style={{ fontSize: '12px', padding: 'var(--space-4) 0' }}>
                  {EMPTY_STATE_MESSAGE}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-3)', height: '140px' }}>
                  {rateByYear.map((r) => (
                    <div
                      key={r.year}
                      data-testid="savings-rate-bar"
                      data-year={r.year}
                      data-pct={r.pct}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        flex: 1,
                        height: '100%',
                      }}
                    >
                      <div className="text-muted" style={{ fontSize: '11px', marginBottom: '4px' }}>
                        {fmtWholePct(r.pct)}
                      </div>
                      <div
                        style={{
                          width: '100%',
                          maxWidth: '32px',
                          height: `${Math.max(6, Math.round((Math.abs(r.pct) / maxAbsPct) * 100))}%`,
                          background: glColor(r.pct),
                        }}
                      />
                      <div className="text-muted" style={{ fontSize: '11px', marginTop: '4px' }}>
                        {r.year}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {hasData && title === 'Category share of spend' && (
            <>
              {years.length === 0 ? (
                <div className="text-muted" style={{ fontSize: '12px', padding: 'var(--space-4) 0' }}>
                  {EMPTY_STATE_MESSAGE}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {categoryShare.rows.map((row) => (
                    <div key={row.year} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <div className="text-muted" style={{ fontSize: '11px', width: '36px', flexShrink: 0 }}>
                        {row.year}
                      </div>
                      <div
                        data-testid="category-share-row"
                        data-year={row.year}
                        style={{ display: 'flex', flex: 1, height: '18px', overflow: 'hidden', borderRadius: '4px' }}
                      >
                        {row.segments.map((seg) => (
                          <div
                            key={seg.categoryId}
                            data-testid="category-share-segment"
                            data-category-id={seg.categoryId}
                            data-pct={seg.pct}
                            title={`${seg.name}: ${Math.round(seg.pct)}%`}
                            style={{
                              width: `${seg.pct}%`,
                              height: '100%',
                              backgroundColor: seg.color,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
                    {categoryShare.legend.map((entry) => (
                      <div
                        key={entry.categoryId}
                        data-testid="category-share-legend-item"
                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        <span
                          style={{
                            display: 'inline-block',
                            width: '10px',
                            height: '10px',
                            borderRadius: '2px',
                            backgroundColor: entry.color,
                          }}
                        />
                        <span className="text-muted" style={{ fontSize: '11px' }}>
                          {entry.name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          {hasData && title === 'Monthly seasonality' && (
            <>
              {years.length === 0 ? (
                <div className="text-muted" style={{ fontSize: '12px', padding: 'var(--space-4) 0' }}>
                  {EMPTY_STATE_MESSAGE}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-2)', height: '140px' }}>
                  {seasonality.map((m) => (
                    <div
                      key={m.month}
                      data-testid="seasonality-bar"
                      data-month={m.month}
                      data-peak={m.isPeak}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        flex: 1,
                        height: '100%',
                      }}
                    >
                      <div
                        style={{
                          width: '100%',
                          maxWidth: '24px',
                          height: `${
                            maxAvgSpend === 0 ? 6 : Math.max(6, Math.round((m.avgSpend / maxAvgSpend) * 100))
                          }%`,
                          background: m.isPeak ? LOSS_COLOR : GAIN_COLOR,
                        }}
                      />
                      <div className="text-muted" style={{ fontSize: '11px', marginTop: '4px' }}>
                        {m.label}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {hasData && title === 'Budget accuracy by year' && (
            <>
              {accuracyByYear.length === 0 ? (
                <div className="text-muted" style={{ fontSize: '12px', padding: 'var(--space-4) 0' }}>
                  {EMPTY_STATE_MESSAGE}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {accuracyByYear.map((row) => {
                    const color = glColor(row.variance)
                    return (
                      <div key={row.year} data-testid="accuracy-row" data-year={row.year}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'baseline',
                            marginBottom: '4px',
                          }}
                        >
                          <div style={{ fontSize: '12px', fontWeight: 600 }}>{row.year}</div>
                          <div data-testid="accuracy-variance" style={{ fontSize: '12px', color }}>
                            {row.variance >= 0
                              ? `Under by ${fmtWhole(row.variance)}`
                              : `Over by ${fmtWhole(Math.abs(row.variance))}`}
                          </div>
                        </div>
                        <div
                          style={{
                            position: 'relative',
                            width: '100%',
                            height: '10px',
                            borderRadius: '4px',
                            overflow: 'hidden',
                            background: 'var(--border, #333)',
                          }}
                        >
                          <div
                            data-testid="accuracy-budget-bar"
                            style={{
                              position: 'absolute',
                              inset: 0,
                              width: `${row.budgetPct}%`,
                              height: '100%',
                              background: 'var(--text-muted, #888)',
                              opacity: 0.4,
                            }}
                          />
                          <div
                            data-testid="accuracy-actual-bar"
                            style={{
                              position: 'absolute',
                              inset: 0,
                              width: `${row.actualPct}%`,
                              height: '100%',
                              background: color,
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
          {hasData && title === 'Category trends year over year' && (
            <>
              {trendsYoY === null ? (
                <div className="text-muted" style={{ fontSize: '12px', padding: 'var(--space-4) 0' }}>
                  {EMPTY_STATE_MESSAGE}
                </div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Category</th>
                      {years.map((y) => (
                        <th key={y} style={{ textAlign: 'right' }}>
                          {y}
                        </th>
                      ))}
                      <th style={{ textAlign: 'right' }}>YoY &Delta;</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {trendsYoY.rows.map((row) => (
                      <tr key={row.categoryId} data-testid="trend-row" data-category-id={row.categoryId}>
                        <td>{row.name}</td>
                        {years.map((y) => (
                          <td key={y} style={{ textAlign: 'right' }}>
                            {fmtWhole(row.totalsByYear[y] ?? 0)}
                          </td>
                        ))}
                        <td style={{ textAlign: 'right', color: glColor(-row.delta) }}>{fmtWholePct(row.delta)}</td>
                        <td>
                          {row.overBudget && (
                            <span className="tag tag-accent" data-testid="over-budget-pill">
                              Over budget
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
          {hasData && title === 'Biggest movers' && (
            <>
              {movers === null ? (
                <div className="text-muted" style={{ fontSize: '12px', padding: 'var(--space-4) 0' }}>
                  {EMPTY_STATE_MESSAGE}
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: 'var(--space-4)',
                  }}
                >
                  <div>
                    <div className="text-muted" style={{ fontSize: '12px', marginBottom: 'var(--space-2)' }}>
                      Biggest increases
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                      {movers.increases.map((m) => (
                        <div
                          key={m.categoryId}
                          data-testid="mover-increase-row"
                          data-category-id={m.categoryId}
                          style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}
                        >
                          <span>{m.name}</span>
                          <span style={{ color: LOSS_COLOR }}>{'+' + fmtWhole(m.diff) + '/mo'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted" style={{ fontSize: '12px', marginBottom: 'var(--space-2)' }}>
                      Biggest decreases
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                      {movers.decreases.map((m) => (
                        <div
                          key={m.categoryId}
                          data-testid="mover-decrease-row"
                          data-category-id={m.categoryId}
                          style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}
                        >
                          <span>{m.name}</span>
                          <span style={{ color: GAIN_COLOR }}>{fmtWhole(m.diff) + '/mo'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  )
}
