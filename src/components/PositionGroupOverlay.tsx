import { useEffect, useMemo, useState } from 'react'
import type { Account, Position } from '../lib/types'
import type { AppState } from '../lib/state'
import type { AggregateRow } from '../lib/aggregateRows'
import { computePosition, fmtUSD, fmtPortfolioPercent } from '../lib/computations'
import { filteredPortfolioTotal } from '../lib/selectors'
import { AssetClassOverrideSelect } from './AssetClassOverrideSelect'
import { Trash, X } from 'lucide-react'
import { ClosePanel } from './ClosePanel'

function EditableCell({ label, value, numeric, display, allowEmpty, onCommit }: {
  label: string
  value: string | number
  numeric?: boolean
  display?: string
  allowEmpty?: boolean
  onCommit: (value: string | number | undefined) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const commit = () => {
    const trimmed = draft.trim()
    const parsed = numeric ? Number(trimmed) : (trimmed || undefined)
    if (numeric ? trimmed !== '' && Number.isFinite(parsed) && Number(parsed) >= 0 : trimmed !== '' || allowEmpty) {
      if (parsed !== (value === '' ? undefined : value)) onCommit(parsed)
    }
    setEditing(false)
  }
  return editing ? <input className="input" aria-label={label} type={numeric ? 'number' : 'text'} value={draft}
    autoFocus onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => {
      if (e.key === 'Enter') { e.preventDefault(); commit() }
      if (e.key === 'Escape') { e.stopPropagation(); setEditing(false) }
    }} /> : <button type="button" className="btn btn-ghost" aria-label={`Edit ${label}`} onClick={() => {
      setDraft(String(value)); setEditing(true)
    }}>{display ?? (value || (allowEmpty ? '(none)' : '(no name)'))}</button>
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

export function PositionGroupOverlay({ group, positions: positionsParam, title: titleParam, accounts, dispatch,
  onClose, existingAssetClasses, state, sortPositions }: PositionGroupOverlayProps) {
  const [closingLotId, setClosingLotId] = useState<string | null>(null)
  const positions = group?.positions ?? positionsParam ?? []
  const first = positions[0]
  const closingLot = positions.find(p => p.id === closingLotId)
  const title = group ? `${group.symbol} — ${group.displayName} — ${group.effectiveAssetClass}` : (titleParam ?? 'Position lots')
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])
  useEffect(() => { if (positions.length === 0) onClose() }, [positions.length, onClose])
  const portfolioTotal = filteredPortfolioTotal(state)
  const sortedPositions = useMemo(() => {
    const accountMap = new Map(accounts.map(a => [a.id, a]))
    return [...positions].sort((a, b) => {
      if (sortPositions) return sortPositions(a, b, accounts)
      const aa = accountMap.get(a.accountId), bb = accountMap.get(b.accountId)
      if (!aa || !bb) return 0
      return aa.institution.localeCompare(bb.institution) || (aa.name.trim() || aa.accountNumber).localeCompare(bb.name.trim() || bb.accountNumber)
    })
  }, [positions, accounts, sortPositions])
  const updateShared = (field: string, value: string | number | undefined) => {
    positions.forEach(p => dispatch({ type: 'UPDATE_POSITION', positionId: p.id, patch: { [field]: value } }))
  }
  const overrideShared = (action: any) => {
    positions.forEach(p => dispatch({ ...action, positionId: p.id }))
  }
  if (!first) return null
  return <div className="dialog-backdrop" onClick={onClose}>
    <div className="dialog blueprint" role="dialog" aria-modal="true" aria-label={title} style={{ width: 'min(96vw, 1200px)', maxHeight: '88vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
      <div className="dialog-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>{title}<button type="button" className="btn btn-icon" aria-label="Close" onClick={onClose}><X size={18} /></button></div>
      <div className="dialog-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
          <div className="field"><label>Symbol</label><EditableCell label="Symbol" value={first.symbol} onCommit={v => updateShared('symbol', v)} /></div>
          <div className="field"><label>Tracking Symbol</label><EditableCell label="Tracking Symbol" value={first.trackingSymbol ?? ''} allowEmpty onCommit={v => updateShared('trackingSymbol', v)} /></div>
          <div className="field"><label>Name</label><EditableCell label="Name" value={first.name ?? ''} onCommit={v => updateShared('name', v)} /></div>
          <div className="field"><label>Current Price</label><EditableCell label="Current Price" value={first.price} numeric display={fmtUSD(first.price)} onCommit={v => updateShared('price', v)} /></div>
          <div className="field"><label>Override</label><AssetClassOverrideSelect position={first} dispatch={overrideShared} existingAssetClasses={existingAssetClasses} /></div>
        </div>
        <table className="table">
          <thead><tr>{['Account', 'Shares', 'Avg Cost', 'Market Value', '% of Portfolio', 'Close', 'Delete'].map(label => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{sortedPositions.map(p => {
            const account = accounts.find(a => a.id === p.accountId)
            const computed = computePosition(p)
            return <tr key={p.id}>
              <td><select className="input" aria-label={`Account for lot ${p.id}`} value={p.accountId} onChange={e => dispatch({ type: 'UPDATE_POSITION', positionId: p.id, patch: { accountId: e.target.value } })}>
                {!account && <option value={p.accountId}>Unknown Account</option>}
                {accounts.map(a => <option key={a.id} value={a.id}>{a.institution ? `${a.institution} — ` : ''}{a.name.trim() || a.accountNumber}</option>)}
              </select><div className="text-muted">{account && `${({ taxable: 'Taxable', nonTaxable: 'Non-Taxable', taxDeferred: 'Tax-Deferred' } as Record<string, string>)[account.taxCategory] ?? ''} • ${account.retirement ? 'Retirement' : 'Non-Retirement'} • #${account.accountNumber}`}</div></td>
              <td><EditableCell label={`Shares for lot ${p.id}`} value={p.shares} numeric display={p.shares.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} onCommit={v => dispatch({ type: 'UPDATE_POSITION', positionId: p.id, patch: { shares: v } })} /></td>
              <td><EditableCell label={`Avg Cost for lot ${p.id}`} value={p.avgCost} numeric display={fmtUSD(p.avgCost)} onCommit={v => dispatch({ type: 'UPDATE_POSITION', positionId: p.id, patch: { avgCost: v } })} /></td>
              <td>{fmtUSD(computed.marketValue)}</td><td>{fmtPortfolioPercent(computed.marketValue, portfolioTotal)}</td>
              <td><button type="button" className="btn btn-ghost" onClick={() => setClosingLotId(p.id)}>Close</button></td>
              <td><button type="button" className="btn btn-icon" aria-label="Delete this position" title="Delete this position" onClick={() => {
                if (window.confirm('Delete this position? It will be moved to Closed Positions.')) {
                  dispatch({ type: 'CLOSE_POSITION', positionId: p.id })
                  if (positions.length === 1) onClose()
                }
              }}><Trash size={16} /></button></td>
            </tr>
          })}</tbody>
        </table>
        {closingLot && <ClosePanel key={closingLot.id} position={closingLot} account={accounts.find(a => a.id === closingLot.accountId)} dispatch={dispatch}
          onCancel={() => setClosingLotId(null)} onClosed={() => {
            setClosingLotId(null)
          }} />}
      </div>
    </div>
  </div>
}
