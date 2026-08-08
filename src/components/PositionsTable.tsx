import { useCallback, useMemo } from 'react'
import type { AppState } from '../lib/state'
import type { Position } from '../lib/types'
import { visiblePositions } from '../lib/selectors'
import { computePosition, fmtUSD, fmtPct } from '../lib/computations'
import { ClosedPositionsTable } from './ClosedPositionsTable'
import { AssetClassOverrideSelect } from './AssetClassOverrideSelect'

export interface PositionsTableProps {
  state: AppState
  dispatch: (action: any) => void
}

/**
 * PositionsTable component: displays sortable positions with filters, search, and closed-positions toggle.
 * Per .dc.html lines 133-206.
 */
export function PositionsTable({ state, dispatch }: PositionsTableProps) {
  const positions = useMemo(() => visiblePositions(state), [state])

  // Get unique asset classes for filter tags
  const assetClassOptions = useMemo(() => {
    const classes = new Set(state.positions.map((p) => p.assetClassManualOverride || p.assetClass))
    return Array.from(classes).sort()
  }, [state.positions])

  const handleAssetClassFilterClick = useCallback(
    (assetClass: string) => {
      dispatch({
        type: 'SET_ASSET_CLASS_FILTER',
        filter: state.assetClassFilter === assetClass ? 'All' : assetClass,
      })
    },
    [dispatch, state.assetClassFilter]
  )

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
    { key: 'symbol', label: 'Security', align: 'left' },
    { key: 'assetClass', label: 'Asset Class', align: 'left' },
    { key: 'shares', label: 'Shares', align: 'right' },
    { key: 'avgCost', label: 'Avg Cost', align: 'right' },
    { key: 'price', label: 'Price', align: 'right' },
  ]

  // Sort arrow indicator
  const getSortArrow = (colKey: keyof Position): string => {
    if (state.sortKey !== colKey) return ''
    return state.sortDir === 'asc' ? ' ↑' : ' ↓'
  }

  // Compute derived fields for display
  const computedPositions = positions.map((p) => {
    const computed = computePosition(p)
    return {
      ...computed,
      glColor: computed.gl >= 0 ? 'var(--color-accent-700)' : '#8a3c2e',
      glStr: (computed.gl >= 0 ? '+' : '') + fmtUSD(computed.gl),
      glPctStr: fmtPct(computed.glPct),
      sharesStr: computed.shares.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      avgCostStr: fmtUSD(computed.avgCost),
      costBasisStr: fmtUSD(computed.costBasis),
      priceStr: fmtUSD(computed.price),
      marketValueStr: fmtUSD(computed.marketValue),
    }
  })

  return (
    <div style={{ marginBottom: 'var(--space-6)' }}>
      {/* Asset class filter tags + search */}
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
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {/* 'All' filter tag */}
          <span
            onClick={() =>
              dispatch({
                type: 'SET_ASSET_CLASS_FILTER',
                filter: 'All',
              })
            }
            className={`tag ${state.assetClassFilter === 'All' ? 'tag-accent' : ''}`}
            style={{ cursor: 'pointer' }}
          >
            All
          </span>

          {/* Asset class filter tags */}
          {assetClassOptions.map((assetClass) => (
            <span
              key={assetClass}
              onClick={() => handleAssetClassFilterClick(assetClass)}
              className={`tag ${state.assetClassFilter === assetClass ? 'tag-accent' : ''}`}
              style={{ cursor: 'pointer' }}
            >
              {assetClass}
            </span>
          ))}
        </div>

        {/* Search input */}
        <div
          className="field"
          style={{
            margin: 0,
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
            <th style={{ textAlign: 'right' }}>Cost Basis</th>
            <th style={{ textAlign: 'right' }}>Market Value</th>
            <th style={{ textAlign: 'right' }}>G/L</th>
            <th style={{ textAlign: 'right' }}>G/L %</th>
            <th style={{ textAlign: 'center' }}>Override</th>
          </tr>
        </thead>
        <tbody>
          {computedPositions.map((p) => (
            <tr key={p.id}>
              <td>
                <div style={{ fontWeight: '600', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span>{p.symbol}</span>
                </div>
                <div style={{ fontSize: '11px' }} className="text-muted">
                  {p.name}
                </div>
              </td>
              <td className="text-muted">{p.assetClassManualOverride || p.assetClass}</td>
              <td style={{ textAlign: 'right' }}>{p.sharesStr}</td>
              <td style={{ textAlign: 'right' }}>{p.avgCostStr}</td>
              <td style={{ textAlign: 'right' }}>{p.priceStr}</td>
              <td style={{ textAlign: 'right' }}>{p.costBasisStr}</td>
              <td style={{ textAlign: 'right', fontWeight: '600' }}>{p.marketValueStr}</td>
              <td style={{ textAlign: 'right', color: p.glColor, fontWeight: '600' }}>{p.glStr}</td>
              <td style={{ textAlign: 'right', color: p.glColor }}>{p.glPctStr}</td>
              <td style={{ textAlign: 'center' }}>
                <AssetClassOverrideSelect position={p} dispatch={dispatch} />
              </td>
            </tr>
          ))}
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
        <ClosedPositionsTable state={state} dispatch={dispatch} />
      )}
    </div>
  )
}
