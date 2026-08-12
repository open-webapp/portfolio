import { useEffect, useMemo, useState } from 'react'
import type { Account, Position } from '../lib/types'
import type { AppState } from '../lib/state'
import type { AggregateRow } from './PositionsTable'
import { computePosition, fmtUSD, fmtPct, fmtPortfolioPercent } from '../lib/computations'
import { filteredPortfolioTotal } from '../lib/selectors'
import { AssetClassOverrideSelect } from './AssetClassOverrideSelect'
import { Trash } from 'lucide-react'

function parseNonNegative(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = Number(raw)
  if (Number.isNaN(n) || n < 0) return null
  return n
}

function EditableCell({
  value,
  positionId,
  field,
  dispatch,
}: {
  value: number
  positionId: string
  field: 'shares' | 'avgCost' | 'price'
  dispatch: (action: any) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))

  const formatDisplay = () => {
    if (field === 'shares') {
      return value.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    }
    return fmtUSD(value)
  }

  const commit = () => {
    const parsed = parseNonNegative(draft)
    if (parsed === null) {
      setIsEditing(false)
      return
    }

    dispatch({
      type: 'UPDATE_POSITION',
      positionId,
      patch: { [field]: parsed },
    })
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commit()
    } else if (e.key === 'Escape') {
      setIsEditing(false)
    }
  }

  if (isEditing) {
    return (
      <input
        type="number"
        className="input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        autoFocus
        style={{ width: '100%' }}
      />
    )
  }

  return (
    <span
      onClick={() => {
        setDraft(String(value))
        setIsEditing(true)
      }}
    >
      {formatDisplay()}
    </span>
  )
}

function EditableTextCell({
  value,
  positionId,
  dispatch,
  field = 'symbol',
}: {
  value: string
  positionId: string
  dispatch: (action: any) => void
  field?: 'symbol' | 'name'
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed === '') {
      setIsEditing(false)
      return
    }

    if (trimmed !== value) {
      dispatch({
        type: 'UPDATE_POSITION',
        positionId,
        patch: { [field]: trimmed },
      })
    }
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commit()
    } else if (e.key === 'Escape') {
      setIsEditing(false)
    }
  }

  if (isEditing) {
    return (
      <input
        type="text"
        className="input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        autoFocus
        style={{ width: '100%' }}
      />
    )
  }

  return (
    <span
      onClick={() => {
        setDraft(value)
        setIsEditing(true)
      }}
      style={{
        display: 'block',
        minHeight: '1.5em',
        cursor: 'pointer',
        color: value ? 'inherit' : 'var(--text-muted)',
      }}
    >
      {value || '(no name)'}
    </span>
  )
}

function AccountDropdown({
  position,
  accounts,
  dispatch,
}: {
  position: Position
  accounts: Account[]
  dispatch: (action: any) => void
}) {
  const [isOpen, setIsOpen] = useState(false)

  const currentAccount = accounts.find((a) => a.id === position.accountId)

  // Helper to format tax category label
  const getTaxCategoryLabel = (taxCategory: string): string => {
    switch (taxCategory) {
      case 'taxable':
        return 'Taxable'
      case 'nonTaxable':
        return 'Non-Taxable'
      case 'taxDeferred':
        return 'Tax-Deferred'
      default:
        return ''
    }
  }

  // Helper to format retirement label
  const getRetirementLabel = (retirement: boolean): string => {
    return retirement ? 'Retirement' : 'Non-Retirement'
  }

  // Render two-line account display
  const renderAccountDisplay = (account: Account) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <div>{account.institution} — {account.name}</div>
      <div style={{ fontSize: '0.875em', color: 'var(--text-muted)' }}>
        {getTaxCategoryLabel(account.taxCategory)} • {getRetirementLabel(account.retirement)}
      </div>
    </div>
  )

  const handleSelectAccount = (account: Account) => {
    dispatch({
      type: 'UPDATE_POSITION',
      positionId: position.id,
      patch: { accountId: account.id },
    })
    setIsOpen(false)
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: '4px',
          padding: '6px 10px',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
          cursor: 'pointer',
          fontSize: '0.9em',
          width: '100%',
          textAlign: 'left',
        }}
      >
        {currentAccount ? renderAccountDisplay(currentAccount) : 'Unknown Account'}
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            minWidth: '300px',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: '4px',
            marginTop: '4px',
            zIndex: 1002,
            boxShadow: 'var(--shadow-md)',
            maxHeight: '250px',
            overflowY: 'auto',
          }}
        >
          {accounts.map((account) => (
            <div
              key={account.id}
              onClick={() => handleSelectAccount(account)}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--color-hover-bg, rgba(0,0,0,0.05))'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                borderBottom: '1px solid var(--color-border)',
                background: currentAccount?.id === account.id ? 'var(--color-hover-bg, rgba(0,0,0,0.05))' : 'transparent',
              }}
            >
              {renderAccountDisplay(account)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export interface PositionGroupOverlayProps {
  group?: AggregateRow
  positions?: Position[]
  title?: string
  accounts: Account[]
  dispatch: (action: any) => void
  onClose: () => void
  existingAssetClasses: string[]
  state: AppState
  sortPositions?: (a: Position, b: Position, accounts: Account[]) => number
}

/**
 * PositionGroupOverlay: displays positions in a group within a dialog.
 * Shows a table of underlying positions sorted by account name.
 */
export const PositionGroupOverlay: React.FC<PositionGroupOverlayProps> = ({
  group,
  positions: positionsParam,
  title: titleParam,
  accounts,
  dispatch,
  onClose,
  existingAssetClasses,
  state,
  sortPositions,
}) => {
  // Support both APIs: group OR positions+title
  const positions = group?.positions || positionsParam || []
  const title = group ? `${group.symbol} — ${group.displayName} — ${group.effectiveAssetClass}` : (titleParam || '')
  // Escape key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Calculate portfolio total for percentage calculations
  const portfolioTotal = filteredPortfolioTotal(state)

  // Sort positions by account institution ascending, then account name ascending (fallback to accountNumber)
  const sortedPositions = useMemo(() => {
    const accountMap = new Map(accounts.map(a => [a.id, a]))
    return [...positions].sort((a, b) => {
      if (sortPositions) {
        return sortPositions(a, b, accounts)
      }
      const accA = accountMap.get(a.accountId)
      const accB = accountMap.get(b.accountId)
      if (!accA || !accB) return 0
      const instComp = (accA.institution || '').localeCompare(accB.institution || '')
      if (instComp !== 0) return instComp
      const nameComp = (accA.name.trim() || accA.accountNumber).localeCompare(
        accB.name.trim() || accB.accountNumber
      )
      return nameComp
    })
  }, [positions, accounts, sortPositions])

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

  const handleDeletePosition = (positionId: string) => {
    const confirmed = window.confirm(
      'Delete this position? It will be moved to Closed Positions.'
    )
    if (confirmed) {
      dispatch({ type: 'CLOSE_POSITION', positionId })
    }
  }

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
            {title}
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
                <th style={{ textAlign: 'left' }}>Symbol</th>
                <th style={{ textAlign: 'left' }}>Name</th>
                <th style={{ textAlign: 'right' }}>Shares</th>
                <th style={{ textAlign: 'right' }}>Avg Cost</th>
                <th style={{ textAlign: 'right' }}>Current Price</th>
                <th style={{ textAlign: 'right' }}>% of Portfolio</th>
                <th style={{ textAlign: 'center' }}>Override</th>
                <th style={{ textAlign: 'center' }}></th>
              </tr>
            </thead>
            <tbody>
              {computedPositions.map((p) => (
                <tr key={p.id}>
                  <td>
                    <AccountDropdown
                      position={p}
                      accounts={accounts}
                      dispatch={dispatch}
                    />
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <EditableTextCell
                      value={p.symbol}
                      positionId={p.id}
                      dispatch={dispatch}
                    />
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <EditableTextCell
                      value={p.name ?? ''}
                      positionId={p.id}
                      field="name"
                      dispatch={dispatch}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <EditableCell
                      value={p.shares}
                      positionId={p.id}
                      field="shares"
                      dispatch={dispatch}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <EditableCell
                      value={p.avgCost}
                      positionId={p.id}
                      field="avgCost"
                      dispatch={dispatch}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <EditableCell
                      value={p.price}
                      positionId={p.id}
                      field="price"
                      dispatch={dispatch}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {fmtPortfolioPercent(computePosition(p).marketValue, portfolioTotal)}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <AssetClassOverrideSelect position={p} dispatch={dispatch} existingAssetClasses={existingAssetClasses} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      onClick={() => handleDeletePosition(p.id)}
                      className="btn-icon"
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--color-text-secondary)',
                        transition: 'color 0.2s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = '#8a3c2e')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-secondary)')}
                      title="Delete this position"
                    >
                      <Trash size={16} />
                    </button>
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
