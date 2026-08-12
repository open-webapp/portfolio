import { useCallback, useState } from 'react'
import type { AppState } from '../lib/state'
import type { Position, ClosedPosition } from '../lib/types'
import { visiblePositions, filteredPortfolioTotal, assetClassOptions } from '../lib/selectors'
import { computePosition, fmtUSD, fmtPct, fmtPortfolioPercent } from '../lib/computations'
import { sortBy } from '../lib/sort'
import { ClosedPositionsTable } from './ClosedPositionsTable'
import { PositionGroupOverlay } from './PositionGroupOverlay'

export interface PositionsTableProps {
  state: AppState
  dispatch: (action: any) => void
  onUndoClick?: (closedPosition: ClosedPosition) => void
}

/**
 * Build a grouping key from a position and accounts array.
 * Key format: `${symbol}|${effectiveAssetClass}`
 *
 * Tax category and retirement status are ignored in grouping.
 */
function buildGroupKey(position: Position): string {
  const effectiveAssetClass = position.assetClassManualOverride || position.assetClass
  return `${position.symbol}|${effectiveAssetClass}`
}

/**
 * Aggregated position row: multiple positions grouped by symbol, asset class, and account attributes.
 */
export interface AggregateRow {
  key: string
  symbol: string
  displayName: string
  effectiveAssetClass: string
  shares: number
  costBasis: number
  marketValue: number
  price: number
  avgCost: number
  gl: number
  glPct: number
  rowCount: number
  positions: Position[]
}

/**
 * Mapping from Position column keys to AggregateRow sort fields.
 * Used when sorting aggregate rows to translate the position key to the corresponding aggregate field.
 * Example: assetClass (Position key) maps to effectiveAssetClass (AggregateRow field).
 */
const AGGREGATE_SORT_FIELD: Record<string, keyof AggregateRow> = {
  assetClass: 'effectiveAssetClass',
  // All other sortable keys (symbol, shares, avgCost, price) have identity mapping
}

/**
 * Group positions by their aggregation key and compute aggregate values.
 * Returns sorted list of AggregateRow objects.
 */
function buildAggregateRows(positions: Position[]): AggregateRow[] {
  // Group positions by key
  const groups: Record<string, Position[]> = {}

  positions.forEach((p) => {
    const key = buildGroupKey(p)
    if (!groups[key]) {
      groups[key] = []
    }
    groups[key].push(p)
  })

  // Convert groups to AggregateRow objects
  return Object.entries(groups).map(([key, groupPositions]) => {
    // Compute each position and sum values
    let totalShares = 0
    let totalCostBasis = 0
    let totalMarketValue = 0

    groupPositions.forEach((p) => {
      const computed = computePosition(p)
      totalShares += computed.shares
      totalCostBasis += computed.costBasis
      totalMarketValue += computed.marketValue
    })

    // Derive aggregate values
    const price = totalShares === 0 ? 0 : totalMarketValue / totalShares
    const avgCost = totalShares === 0 ? 0 : totalCostBasis / totalShares
    const gl = totalMarketValue - totalCostBasis
    const glPct = totalCostBasis === 0 ? 0 : (gl / totalCostBasis) * 100

    // Get displayName from first position
    const displayName = groupPositions[0].name ?? groupPositions[0].symbol

    // Count total positions in group
    const rowCount = groupPositions.length

    return {
      key,
      symbol: groupPositions[0].symbol,
      displayName,
      effectiveAssetClass: groupPositions[0].assetClassManualOverride || groupPositions[0].assetClass,
      shares: totalShares,
      costBasis: totalCostBasis,
      marketValue: totalMarketValue,
      price,
      avgCost,
      gl,
      glPct,
      rowCount,
      positions: groupPositions,
    }
  })
}

/**
 * PositionsTable component: displays sortable positions with filters, search, and closed-positions toggle.
 * Per .dc.html lines 133-206.
 */
export function PositionsTable({ state, dispatch, onUndoClick }: PositionsTableProps) {
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);

  const positions = visiblePositions(state);
  const portfolioTotal = filteredPortfolioTotal(state);
  const aggregateRows = buildAggregateRows(positions);
  const selectedGroup = aggregateRows.find(r => r.key === selectedGroupKey) ?? null;
  const sortedRows = sortBy(aggregateRows, AGGREGATE_SORT_FIELD[state.sortKey] ?? state.sortKey as keyof AggregateRow, state.sortDir);

  // Get existing asset classes from selector
  const existingAssetClasses = assetClassOptions(state)

  const handleHeaderClick = useCallback(
    (sortKey: keyof Position) => {
      dispatch({
        type: 'TOGGLE_SORT',
        sortKey,
      })
    },
    [dispatch]
  )

  const handlePosSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      dispatch({
        type: 'SET_POSITIONS_SEARCH',
        search: e.target.value,
      })
    },
    [dispatch]
  )

  const handleToggleClosed = useCallback(() => {
    dispatch({
      type: 'TOGGLE_SHOW_CLOSED',
    })
  }, [dispatch])

  // Column definitions for sortable headers
  const columns: Array<{
    key: keyof Position
    label: string
    align: 'left' | 'center' | 'right'
  }> = [
    { key: 'symbol', label: 'Symbol', align: 'left' },
    { key: 'assetClass', label: 'Asset Class', align: 'left' },
    { key: 'shares', label: 'Shares', align: 'right' },
    { key: 'avgCost', label: 'Cost Basis', align: 'right' },
    { key: 'price', label: 'Current Price', align: 'right' },
  ]

  // Sort arrow indicator
  const getSortArrow = (colKey: keyof Position): string => {
    if (state.sortKey !== colKey) return ''
    return state.sortDir === 'asc' ? ' ↑' : ' ↓'
  }


  return (
    <div style={{ marginBottom: 'var(--space-6)' }}>
      {/* Search input */}
      <div
        className="field"
        style={{
          margin: 0,
          marginBottom: 'var(--space-3)',
          width: '220px',
          position: 'relative',
        }}
      >
        <input
          className="input"
          placeholder="Search symbol or name"
          value={state.posSearch}
          onChange={handlePosSearchChange}
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
          style={{
            position: 'absolute',
            left: '9px',
            top: '11px',
            opacity: 0.55,
          }}
        >
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.3-4.3"></path>
        </svg>
      </div>

      {/* Positions table */}
      <table className="table" style={{ marginBottom: 'var(--space-4)' }}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                onClick={() => handleHeaderClick(col.key)}
                style={{
                  textAlign: col.align,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {col.label}
                {getSortArrow(col.key)}
              </th>
            ))}
            <th style={{ textAlign: 'right' }}>Amount Invested</th>
            <th style={{ textAlign: 'right' }}>Market Value</th>
            <th style={{ textAlign: 'right' }}>% of Portfolio</th>
            <th style={{ textAlign: 'right' }}>G/L</th>
            <th style={{ textAlign: 'right' }}>G/L %</th>
            <th style={{ textAlign: 'right' }}></th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => {
            const glColor = row.gl >= 0 ? 'var(--color-accent-700)' : '#8a3c2e'
            const glStr = (row.gl >= 0 ? '+' : '') + fmtUSD(row.gl)
            const glPctStr = fmtPct(row.glPct)
            const sharesStr = row.shares.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

            return (
              <tr key={row.key} style={{ cursor: 'pointer' }} onClick={() => setSelectedGroupKey(row.key)}>
                <td>
                  <div style={{ fontWeight: '600', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span>{row.symbol}</span>
                  </div>
                  <div style={{ fontSize: '11px' }} className="text-muted">
                    {row.displayName}
                  </div>
                </td>
                <td className="text-muted">{row.effectiveAssetClass}</td>
                <td style={{ textAlign: 'right' }}>{sharesStr}</td>
                <td style={{ textAlign: 'right' }}>{fmtUSD(row.avgCost)}</td>
                <td style={{ textAlign: 'right' }}>{fmtUSD(row.price)}</td>
                <td style={{ textAlign: 'right' }}>{fmtUSD(row.costBasis)}</td>
                <td style={{ textAlign: 'right', fontWeight: '600' }}>{fmtUSD(row.marketValue)}</td>
                <td style={{ textAlign: 'right' }}>{fmtPortfolioPercent(row.marketValue, portfolioTotal)}</td>
                <td style={{ textAlign: 'right', color: glColor, fontWeight: '600' }}>{glStr}</td>
                <td style={{ textAlign: 'right', color: glColor }}>{glPctStr}</td>
                <td style={{ textAlign: 'right' }}>
                  <span className="tag tag-neutral">{row.rowCount}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Closed positions toggle */}
      <div
        onClick={handleToggleClosed}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          cursor: 'pointer',
          marginBottom: 'var(--space-3)',
          userSelect: 'none',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-heading)',
            fontWeight: '600',
            fontSize: '14px',
          }}
        >
          {state.showClosed ? 'Hide Closed Positions' : 'Show Closed Positions'}
        </span>
        <span className="tag tag-neutral">{state.closedPositions.length}</span>
      </div>

      {/* Closed positions table */}
      {state.showClosed && (
        <ClosedPositionsTable state={state} dispatch={dispatch} onUndoClick={onUndoClick} />
      )}

      {/* Position group overlay */}
      {selectedGroup && (() => {
        const title = `${selectedGroup.symbol} — ${selectedGroup.displayName} — ${selectedGroup.effectiveAssetClass}`
        return (
          <PositionGroupOverlay
            positions={selectedGroup.positions}
            title={title}
            accounts={state.accounts}
            dispatch={dispatch}
            onClose={() => setSelectedGroupKey(null)}
            existingAssetClasses={existingAssetClasses}
            state={state}
          />
        )
      })()}
    </div>
  )
}
