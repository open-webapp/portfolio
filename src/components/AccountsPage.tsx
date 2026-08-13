import { useState } from 'react'
import type { AppState } from '../lib/state'
import type { Position } from '../lib/types'
import {
  categoryCards,
  acctScopedPositions,
  acctFilteredPositions,
  acctAssetClassOptions,
  acctAllocationTitle,
  assetClassOptions,
} from '../lib/selectors'
import { buildAggregateRows, AGGREGATE_SORT_FIELD, type AggregateRow } from '../lib/aggregateRows'
import { sortBy } from '../lib/sort'
import { fmtUSD, fmtPct, fmtPortfolioPercent, glColor } from '../lib/computations'
import { AllocationChart } from './AllocationChart'
import { ImportDialog } from './import/ImportDialog'
import { PositionGroupOverlay } from './PositionGroupOverlay'

export interface AccountsPageProps {
  state: AppState
  dispatch: (action: any) => void
}

/**
 * Two-column Accounts page: left column of expandable category cards for
 * account selection, right column with allocation, asset-class filter,
 * search, and an aggregate positions table scoped to the selection.
 */
export function AccountsPage({ state, dispatch }: AccountsPageProps) {
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null)

  const cards = categoryCards(state)
  const scopedPositions = acctScopedPositions(state)
  const filteredPositions = acctFilteredPositions(state)
  const acctPortfolioTotal = filteredPositions.reduce((s, p) => s + p.shares * p.price, 0)

  const aggregateRows = buildAggregateRows(filteredPositions)
  const selectedGroup = aggregateRows.find((r) => r.key === selectedGroupKey) ?? null
  const sortedRows = sortBy(
    aggregateRows,
    AGGREGATE_SORT_FIELD[state.sortKey] ?? (state.sortKey as keyof AggregateRow),
    state.sortDir
  )

  const columns: Array<{ key: keyof Position; label: string; align: 'left' | 'right' }> = [
    { key: 'symbol', label: 'Symbol', align: 'left' },
    { key: 'assetClass', label: 'Asset Class', align: 'left' },
    { key: 'shares', label: 'Shares', align: 'right' },
    { key: 'avgCost', label: 'Cost Basis', align: 'right' },
    { key: 'price', label: 'Current Price', align: 'right' },
  ]

  const getSortArrow = (colKey: keyof Position): string => {
    if (state.sortKey !== colKey) return ''
    return state.sortDir === 'asc' ? ' ↑' : ' ↓'
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 'var(--space-6)', alignItems: 'start' }}>
      {/* Category cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {cards.map((cat) => (
          <div key={cat.key} className="card blueprint elev-sm" style={{ padding: 0 }}>
            <div
              onClick={() => dispatch({ type: 'TOGGLE_CATEGORY_EXPANDED', categoryKey: cat.key })}
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
                      onClick={() => dispatch({ type: 'SELECT_ACCOUNT', accountId: acc.id })}
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
                        <span className="tag tag-outline" style={{ fontSize: '10px' }}>#{acc.accountNumber}</span>
                        <span className="tag tag-outline" style={{ fontSize: '10px' }}>Updated {acc.updatedStr}</span>
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

      {/* Positions for selection */}
      <div>
        <div style={{ marginBottom: 'var(--space-5)' }}>
          <AllocationChart positions={scopedPositions} title={acctAllocationTitle(state)} />
        </div>

        <div style={{ background: 'var(--color-divider)', margin: 'var(--space-6) 0' }} />

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
            {['All', ...acctAssetClassOptions(scopedPositions)].map((opt) => (
              <label key={opt} className="seg-opt" onClick={() => dispatch({ type: 'SET_ACCT_ASSET_CLASS_FILTER', filter: opt })}>
                <input type="radio" name="acctAssetClassFilter" checked={state.acctAssetClassFilter === opt} readOnly />
                <span>{opt}</span>
              </label>
            ))}
          </div>

          <ImportDialog state={state} dispatch={dispatch} onClose={() => {}} />
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-3)',
            flexWrap: 'wrap',
          }}
        >
          <div className="field" style={{ margin: 0, width: '220px', position: 'relative' }}>
            <input
              className="input"
              placeholder="Search symbol or name"
              value={state.acctPosSearch}
              onChange={(e) => dispatch({ type: 'SET_ACCT_POS_SEARCH', search: e.target.value })}
              style={{ paddingLeft: '30px' }}
            />
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              width="14"
              height="14"
              style={{ position: 'absolute', left: '9px', top: '11px', opacity: 0.55 }}
            >
              <circle cx="11" cy="11" r="8"></circle>
              <path d="m21 21-4.3-4.3"></path>
            </svg>
          </div>
        </div>

        <table className="table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => dispatch({ type: 'TOGGLE_SORT', sortKey: col.key })}
                  style={{ textAlign: col.align, cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  {col.label}
                  {getSortArrow(col.key)}
                </th>
              ))}
              <th style={{ textAlign: 'right' }}>Amount Invested</th>
              <th style={{ textAlign: 'right' }}>Market Value</th>
              <th style={{ textAlign: 'right' }}>% of Selection</th>
              <th style={{ textAlign: 'right' }}>G/L</th>
              <th style={{ textAlign: 'right' }}>G/L %</th>
              <th style={{ textAlign: 'right' }}></th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const glColorVal = glColor(row.gl)
              const glStr = (row.gl >= 0 ? '+' : '') + fmtUSD(row.gl)
              const glPctStr = fmtPct(row.glPct)
              const sharesStr = row.shares.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

              return (
                <tr key={row.key} style={{ cursor: 'pointer' }} onClick={() => setSelectedGroupKey(row.key)}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{row.symbol}</div>
                    <div style={{ fontSize: '11px' }} className="text-muted">{row.displayName}</div>
                  </td>
                  <td className="text-muted">{row.effectiveAssetClass}</td>
                  <td style={{ textAlign: 'right' }}>{sharesStr}</td>
                  <td style={{ textAlign: 'right' }}>{fmtUSD(row.avgCost)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtUSD(row.price)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtUSD(row.costBasis)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtUSD(row.marketValue)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtPortfolioPercent(row.marketValue, acctPortfolioTotal)}</td>
                  <td style={{ textAlign: 'right', color: glColorVal, fontWeight: 600 }}>{glStr}</td>
                  <td style={{ textAlign: 'right', color: glColorVal }}>{glPctStr}</td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="tag tag-neutral">{row.rowCount}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {sortedRows.length === 0 && (
          <div className="text-muted" style={{ fontSize: '12px', padding: 'var(--space-4) 0' }}>
            No positions to show.
          </div>
        )}

        {selectedGroup && (() => {
          const title = `${selectedGroup.symbol} — ${selectedGroup.displayName} — ${selectedGroup.effectiveAssetClass}`
          return (
            <PositionGroupOverlay
              positions={selectedGroup.positions}
              title={title}
              accounts={state.accounts}
              dispatch={dispatch}
              onClose={() => setSelectedGroupKey(null)}
              existingAssetClasses={assetClassOptions(state)}
              state={state}
            />
          )
        })()}
      </div>
    </div>
  )
}
