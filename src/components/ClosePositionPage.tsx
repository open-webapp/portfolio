import { useEffect, useState } from 'react'
import type { Account, Position } from '../lib/types'
import { fmtUSD } from '../lib/computations'
import { closePositionSalePreview } from '../lib/selectors'

export interface ClosePositionPageProps {
  positions: Position[]
  accounts: Account[]
  dispatch: (action: any) => void
  onCancel: () => void
  onClosed: () => void
}

const today = () => new Date().toISOString().slice(0, 10)

export function ClosePositionPage({ positions, accounts, dispatch, onCancel, onClosed }: ClosePositionPageProps) {
  const [positionId, setPositionId] = useState(positions[0]?.id ?? '')
  const position = positions.find((lot) => lot.id === positionId) ?? positions[0]
  const [shares, setShares] = useState(position ? String(position.shares) : '')
  const [price, setPrice] = useState(position ? String(position.price) : '')
  const [date, setDate] = useState(today)
  const [fees, setFees] = useState('0')

  useEffect(() => {
    const next = positions.find((lot) => lot.id === positionId) ?? positions[0]
    setPositionId(next?.id ?? '')
    setShares(next ? String(next.shares) : '')
    setPrice(next ? String(next.price) : '')
  }, [positionId, positions])

  if (!position) return null

  const preview = closePositionSalePreview(position, { shares, price, date, fees })
  const account = accounts.find((item) => item.id === position.accountId)
  const changeLot = (nextId: string) => {
    const next = positions.find((lot) => lot.id === nextId)
    setPositionId(nextId)
    setShares(next ? String(next.shares) : '')
    setPrice(next ? String(next.price) : '')
  }
  const close = () => {
    if (!preview.valid) return
    dispatch({ type: 'CLOSE_POSITION_WITH_SALE', positionId: position.id, shares: Number(shares), price: Number(price), date, fees: Number(fees) })
    onClosed()
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 340px)', gap: 'var(--space-6)', alignItems: 'start' }}>
      <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
        <div className="card blueprint elev-sm">
          <div className="card-title">1. Position</div>
          {positions.length > 1 && (
            <label className="field">
              <span>Position lot</span>
              <select className="input" aria-label="Position lot" value={position.id} onChange={(event) => changeLot(event.target.value)}>
                {positions.map((lot) => {
                  const lotAccount = accounts.find((item) => item.id === lot.accountId)
                  return <option key={lot.id} value={lot.id}>{lotAccount?.name ?? lot.accountId} | {lot.shares} shares | {fmtUSD(lot.avgCost)} avg cost</option>
                })}
              </select>
            </label>
          )}
          <div className="text-muted" style={{ fontSize: '13px' }}>
            {account?.institution} {account?.name ? `- ${account.name}` : ''} | {position.shares.toLocaleString('en-US')} shares | {fmtUSD(position.avgCost)} avg cost
          </div>
        </div>

        <div className="card blueprint elev-sm">
          <div className="card-title">2. Sale</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--space-4)' }}>
            <label className="field"><span>Shares</span><input aria-label="Shares" className="input" type="number" min="0" value={shares} onChange={(event) => setShares(event.target.value)} /></label>
            <label className="field"><span>Sale price</span><input aria-label="Sale price" className="input" type="number" min="0" value={price} onChange={(event) => setPrice(event.target.value)} /></label>
            <label className="field"><span>Sale date</span><input aria-label="Sale date" className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
            <label className="field"><span>Fees</span><input aria-label="Fees" className="input" type="number" min="0" value={fees} onChange={(event) => setFees(event.target.value)} /></label>
          </div>
          {preview.error && <div role="alert" className="text-muted" style={{ fontSize: '12px' }}>{preview.error}</div>}
        </div>
      </div>

      <div className="card blueprint elev-sm" style={{ position: 'sticky', top: 'var(--space-4)' }}>
        <div className="card-title">Result</div>
        <div style={{ display: 'grid', gap: 'var(--space-3)', fontSize: '13px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Realized G/L</span><strong>{fmtUSD(preview.realizedGL)}</strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Proceeds</span><strong>{fmtUSD(preview.proceeds)}</strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Cost basis</span><strong>{fmtUSD(preview.costBasis)}</strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Remaining</span><strong>{preview.remaining.toFixed(2)} shares</strong></div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-5)' }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={close} disabled={!preview.valid}>Close position</button>
        </div>
      </div>
    </div>
  )
}
