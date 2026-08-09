import { useEffect } from 'react'
import type { Account } from '../lib/types'
import type { AggregateRow } from './PositionsTable'
import { computePosition, fmtUSD, fmtPct } from '../lib/computations'
import { AssetClassOverrideSelect } from './AssetClassOverrideSelect'

export interface PositionGroupOverlayProps {
  group: AggregateRow
  accounts: Account[]
  dispatch: (action: any) => void
  onClose: () => void
}

/**
 * PositionGroupOverlay: displays positions in a group within a dialog.
 * Shows a table of underlying positions sorted by account name.
 */
export const PositionGroupOverlay: React.FC<PositionGroupOverlayProps> = ({
  group,
  accounts,
  dispatch,
  onClose,
}) => {
  // Escape key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Sort positions by account name ascending (fallback to accountNumber)
  const sortedPositions = [...group.positions].sort((a, b) => {
    const accountA = accounts.find((ac) => ac.id === a.accountId)
    const accountB = accounts.find((ac) => ac.id === b.accountId)

    const nameA = accountA?.name?.trim() || accountA?.accountNumber || ''
    const nameB = accountB?.name?.trim() || accountB?.accountNumber || ''

    return nameA.localeCompare(nameB)
  })

  // Compute derived fields for each position
  const computedPositions = sortedPositions.map((p) => {
    const computed = computePosition(p)
    return {
      ...computed,
      glColor: computed.gl >= 0 ? 'var(--color-accent-700)' : '#8a3c2e',
      glStr: (computed.gl >= 0 ? '+' : '') + fmtUSD(computed.gl),
      glPctStr: fmtPct(computed.glPct),
      sharesStr: computed.shares.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      avgCostStr: fmtUSD(computed.avgCost),
      costBasisStr: fmtUSD(computed.costBasis),
      priceStr: fmtUSD(computed.price),
      marketValueStr: fmtUSD(computed.marketValue),
      accountName:
        accounts.find((ac) => ac.id === p.accountId)?.name?.trim() ||
        accounts.find((ac) => ac.id === p.accountId)?.accountNumber ||
        'Unknown Account',
    }
  })

  return (
    <div className="dialog-backdrop" onClick={onClose} style={{ zIndex: 1001 }}>
      <div
        className="dialog blueprint"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(96vw, 1200px)',
          maxWidth: '96vw',
          maxHeight: '88vh',
          overflow: 'auto',
          background: 'var(--color-bg)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <i className="corner tl"></i>
        <i className="corner tr"></i>
        <i className="corner bl"></i>
        <i className="corner br"></i>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="dialog-title">
            {group.symbol} — {group.displayName} — {group.effectiveAssetClass}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: 'var(--color-text)',
              opacity: 0.6,
              padding: '4px',
              lineHeight: 0,
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              width="18"
              height="18"
            >
              <path d="M18 6 6 18"></path>
              <path d="m6 6 12 12"></path>
            </svg>
          </button>
        </div>

        <div className="dialog-body">
          <table className="table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Account</th>
                <th style={{ textAlign: 'right' }}>Shares</th>
                <th style={{ textAlign: 'right' }}>Cost Basis</th>
                <th style={{ textAlign: 'right' }}>Current Price</th>
                <th style={{ textAlign: 'right' }}>Amount Invested</th>
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
                    <div style={{ fontWeight: '600' }}>{p.accountName}</div>
                  </td>
                  <td style={{ textAlign: 'right' }}>{p.sharesStr}</td>
                  <td style={{ textAlign: 'right' }}>{p.avgCostStr}</td>
                  <td style={{ textAlign: 'right' }}>{p.priceStr}</td>
                  <td style={{ textAlign: 'right' }}>{p.costBasisStr}</td>
                  <td style={{ textAlign: 'right', fontWeight: '600' }}>{p.marketValueStr}</td>
                  <td style={{ textAlign: 'right', color: p.glColor, fontWeight: '600' }}>
                    {p.glStr}
                  </td>
                  <td style={{ textAlign: 'right', color: p.glColor }}>{p.glPctStr}</td>
                  <td style={{ textAlign: 'center' }}>
                    <AssetClassOverrideSelect position={p} dispatch={dispatch} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
