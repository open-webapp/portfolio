import { useState } from 'react'
import type { AppState } from '../lib/state'
import { registerCategoryCards, registerAllAccountsTotal } from '../lib/selectors'
import { accountLedger, scopeLedger, registerChartSeries } from '../lib/register'
import { fmtUSD, GAIN_COLOR, LOSS_COLOR } from '../lib/computations'
import { RegisterBalanceDialog } from './RegisterBalanceDialog'

export interface RegisterPageProps {
  state: AppState
  dispatch: (action: any) => void
}

const fmtSigned = (n: number): string => (n >= 0 ? '+' : '') + fmtUSD(n)

const fmtDate = (dateStr: string): string => {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Register page: left column scope selector (All Accounts + expandable tax-category
 * cards with per-account rows), right column with a stats strip, a balance-over-time
 * SVG line chart, an activity filter, and the balance-entry activity table.
 * "Record Balances" opens RegisterBalanceDialog to add/replace balance entries.
 */
export function RegisterPage({ state, dispatch }: RegisterPageProps) {
  const [balanceDialogOpen, setBalanceDialogOpen] = useState(false)
  const categoryCards = registerCategoryCards(state)
  const allTotalStr = registerAllAccountsTotal(state)

  const scopeAccountIds = state.regAccountId ? [state.regAccountId] : state.accounts.map((a) => a.id)

  let fullLedger: ReturnType<typeof accountLedger> = []
  scopeAccountIds.forEach((id) => {
    fullLedger = fullLedger.concat(accountLedger(state.balanceEntries, id))
  })

  const currentBalance = scopeAccountIds.reduce((sum, id) => {
    const rows = state.balanceEntries
      .filter((e) => e.accountId === id)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
    return sum + (rows.length ? rows[rows.length - 1].balance : 0)
  }, 0)
  const netChange = fullLedger.reduce((sum, r) => sum + (r.change === null ? 0 : r.change), 0)
  const fromActivity = fullLedger.reduce((sum, r) => sum + r.attributed, 0)
  const unexplained = fullLedger.reduce((sum, r) => sum + (r.unexplained === null ? 0 : r.unexplained), 0)

  const chart = registerChartSeries(state.balanceEntries, scopeAccountIds)
  const rows = scopeLedger(state.balanceEntries, scopeAccountIds, state.regActivityFilter)

  const scopeAccount = state.regAccountId ? state.accounts.find((a) => a.id === state.regAccountId) : null
  const scopeTitle = scopeAccount ? `${scopeAccount.institution} — ${scopeAccount.name}` : 'All Accounts — Balance History'

  const handleDelete = (id: string) => {
    const confirmed = window.confirm('Delete this balance entry? This cannot be undone.')
    if (confirmed) {
      dispatch({ type: 'DELETE_BALANCE_ENTRY', id })
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 'var(--space-6)', alignItems: 'start' }}>
      {/* Scope: all accounts, then category cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div
          className="card blueprint elev-sm"
          onClick={() => dispatch({ type: 'SET_REG_ACCOUNT', accountId: null })}
          style={{
            padding: 'var(--space-4)',
            cursor: 'pointer',
            background: state.regAccountId ? undefined : 'var(--color-accent-100)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
            <span
              style={{
                fontFamily: 'var(--font-heading)',
                fontWeight: 600,
                fontSize: '13px',
                padding: '6px 14px',
                borderRadius: '999px',
                background: 'var(--color-accent)',
                color: '#fff',
              }}
            >
              All Accounts
            </span>
            <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: '15px', whiteSpace: 'nowrap' }}>
              {allTotalStr}
            </span>
          </div>
        </div>

        {categoryCards.map((cat) => (
          <div key={cat.key} className="card blueprint elev-sm" style={{ padding: 0 }}>
            <div
              onClick={() => dispatch({ type: 'TOGGLE_REG_CATEGORY_EXPANDED', categoryKey: cat.key })}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-3)',
                padding: 'var(--space-4)',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  width="14"
                  height="14"
                  style={{
                    flexShrink: 0,
                    transform: cat.expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                    transition: 'transform 0.15s',
                  }}
                >
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
                <span
                  style={{
                    fontFamily: 'var(--font-heading)',
                    fontWeight: 600,
                    fontSize: '13px',
                    whiteSpace: 'nowrap',
                    padding: '6px 14px',
                    borderRadius: '999px',
                    background: 'var(--color-accent)',
                    color: '#fff',
                  }}
                >
                  {cat.label}
                </span>
                <span className="tag tag-neutral">{cat.accountCount}</span>
              </div>
              <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: '15px', whiteSpace: 'nowrap' }}>
                {cat.totalStr}
              </span>
            </div>

            {cat.expanded && (
              <div style={{ borderTop: '1px solid var(--color-divider)' }}>
                {cat.hasAccounts ? (
                  cat.accounts.map((acc) => (
                    <div
                      key={acc.id}
                      onClick={() => dispatch({ type: 'SET_REG_ACCOUNT', accountId: acc.id })}
                      style={{
                        padding: 'var(--space-3) var(--space-4)',
                        borderBottom: '1px solid var(--color-divider)',
                        cursor: 'pointer',
                        background: acc.selected ? 'var(--color-accent-100)' : undefined,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
                        <div
                          style={{
                            fontSize: '13px',
                            fontWeight: 600,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {acc.institution} <span className="text-muted" style={{ fontWeight: 400 }}>—</span> {acc.name}
                        </div>
                        <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap' }}>
                          {acc.totalStr}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                        <span className="tag tag-outline" style={{ fontSize: '10px' }}>{acc.entryCount} entries</span>
                        <span className="tag tag-outline" style={{ fontSize: '10px' }}>As of {acc.asOfStr}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-muted" style={{ fontSize: '12px', padding: 'var(--space-3) var(--space-4)' }}>
                    No accounts in this category.
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Balance history */}
      <div>
        <div className="card blueprint elev-sm" style={{ marginBottom: 'var(--space-5)' }}>
          <div className="card-title" style={{ marginBottom: 'var(--space-4)', fontSize: '14px' }}>
            {scopeTitle}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 'var(--space-5)' }}>
            <div>
              <div
                className="text-muted"
                style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '6px' }}
              >
                Current balance
              </div>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: '15px', fontWeight: 600 }}>
                {fmtUSD(currentBalance)}
              </div>
            </div>
            <div>
              <div
                className="text-muted"
                style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '6px' }}
              >
                Net change recorded
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-heading)',
                  fontSize: '15px',
                  fontWeight: 600,
                  color: netChange >= 0 ? GAIN_COLOR : LOSS_COLOR,
                }}
              >
                {fmtSigned(netChange)}
              </div>
            </div>
            <div>
              <div
                className="text-muted"
                style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '6px' }}
              >
                From activity
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-heading)',
                  fontSize: '15px',
                  fontWeight: 600,
                  color: fromActivity >= 0 ? GAIN_COLOR : LOSS_COLOR,
                }}
              >
                {fmtSigned(fromActivity)}
              </div>
            </div>
            <div>
              <div
                className="text-muted"
                style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '6px' }}
              >
                Unexplained
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-heading)',
                  fontSize: '15px',
                  fontWeight: 600,
                  color: unexplained >= 0 ? GAIN_COLOR : LOSS_COLOR,
                }}
              >
                {fmtSigned(unexplained)}
              </div>
            </div>
          </div>
        </div>

        <div className="card blueprint elev-sm" style={{ marginBottom: 'var(--space-5)' }}>
          <div className="card-title" style={{ marginBottom: 'var(--space-4)', fontSize: '14px' }}>
            Balance over time
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <div style={{ position: 'relative', width: '70px', height: '200px', flex: 'none' }}>
              {chart.yLabels.map((y, i) => (
                <div
                  key={i}
                  className="text-muted"
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: `${y.topPct}%`,
                    transform: 'translateY(-50%)',
                    fontSize: '10px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {y.label}
                </div>
              ))}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  position: 'relative',
                  height: '200px',
                  borderLeft: '1px solid var(--color-divider)',
                  borderBottom: '1px solid var(--color-divider)',
                }}
              >
                <svg
                  viewBox="0 0 1000 200"
                  preserveAspectRatio="none"
                  style={{ width: '100%', height: '100%', display: 'block', overflow: 'visible' }}
                >
                  {chart.yLabels.map((y, i) => (
                    <line
                      key={i}
                      x1="0"
                      x2="1000"
                      y1={y.y}
                      y2={y.y}
                      stroke="var(--color-divider)"
                      strokeWidth="1"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  <polygon points={chart.area} fill="var(--color-accent-100)" />
                  <polyline
                    points={chart.points}
                    fill="none"
                    stroke="var(--color-accent)"
                    strokeWidth="2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  {chart.dots.map((d, i) => (
                    <circle
                      key={i}
                      cx={d.x}
                      cy={d.y}
                      r="3.5"
                      fill="var(--color-bg)"
                      stroke="var(--color-accent)"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    >
                      <title>{d.title}</title>
                    </circle>
                  ))}
                </svg>
              </div>
              <div style={{ position: 'relative', height: '18px', marginTop: '6px' }}>
                {chart.xLabels.map((x, i) => (
                  <div
                    key={i}
                    className="text-muted"
                    style={{
                      position: 'absolute',
                      left: `${x.leftPct}%`,
                      transform: 'translateX(-50%)',
                      fontSize: '10px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {x.label}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-4)',
            flexWrap: 'wrap',
          }}
        >
          <div className="seg">
            {(['All', 'With Activity'] as const).map((opt) => (
              <label key={opt} className="seg-opt" onClick={() => dispatch({ type: 'SET_REG_ACTIVITY_FILTER', filter: opt })}>
                <input type="radio" name="regActivityFilter" checked={state.regActivityFilter === opt} readOnly />
                <span>{opt}</span>
              </label>
            ))}
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setBalanceDialogOpen(true)}>
            Record Balances
          </button>
        </div>

        {balanceDialogOpen && (
          <RegisterBalanceDialog state={state} dispatch={dispatch} onClose={() => setBalanceDialogOpen(false)} />
        )}

        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Account</th>
              <th style={{ textAlign: 'right' }}>Balance</th>
              <th style={{ textAlign: 'right' }}>Change</th>
              <th>Attributed activity</th>
              <th style={{ textAlign: 'right' }}>Unexplained</th>
              <th style={{ width: '40px' }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const acct = state.accounts.find((a) => a.id === r.accountId)
              const hasActivity = r.activityType !== 'None' && r.activityAmount > 0
              return (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.date)}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{acct ? acct.name : '—'}</div>
                    <div style={{ fontSize: '11px' }} className="text-muted">
                      {acct ? acct.institution : ''}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtUSD(r.balance)}</td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontWeight: 600,
                      color: r.change === null ? 'var(--color-text-secondary)' : r.change >= 0 ? GAIN_COLOR : LOSS_COLOR,
                    }}
                  >
                    {r.change === null ? 'Opening' : fmtSigned(r.change)}
                  </td>
                  <td>
                    {hasActivity ? (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span className="tag tag-accent" style={{ fontSize: '10px' }}>
                            {r.activityType}
                          </span>
                          <span style={{ fontSize: '12px' }}>{fmtSigned(r.attributed)}</span>
                        </div>
                        {r.note && (
                          <div className="text-muted" style={{ fontSize: '11px', marginTop: '4px' }}>
                            {r.note}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-muted" style={{ fontSize: '11px' }}>
                        Not attributed
                      </span>
                    )}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      color: r.unexplained === null ? 'var(--color-text-secondary)' : r.unexplained >= 0 ? GAIN_COLOR : LOSS_COLOR,
                    }}
                  >
                    {r.unexplained === null ? '—' : fmtSigned(r.unexplained)}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      type="button"
                      className="btn-icon"
                      title="Delete entry"
                      onClick={() => handleDelete(r.id)}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text)', opacity: 0.6, padding: '4px' }}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        width="15"
                        height="15"
                      >
                        <path d="M3 6h18"></path>
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
                        <path d="M10 11v6"></path>
                        <path d="M14 11v6"></path>
                      </svg>
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="text-muted" style={{ fontSize: '12px', padding: 'var(--space-4) 0' }}>
            No balance entries recorded for this scope yet.
          </div>
        )}
      </div>
    </div>
  )
}
