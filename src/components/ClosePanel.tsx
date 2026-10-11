import { useState } from 'react'
import type { Position } from '../lib/types'
import { fmtUSD } from '../lib/computations'
import { closePositionSalePreview } from '../lib/selectors'

export function ClosePanel({ position, dispatch, onCancel, onClosed }: {
  position: Position
  dispatch: (action: any) => void
  onCancel: () => void
  onClosed: () => void
}) {
  const [shares, setShares] = useState(String(position.shares))
  const [price, setPrice] = useState(String(position.price))
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [fees, setFees] = useState('0')
  const preview = closePositionSalePreview(position, { shares, price, date, fees })
  // Keep the existing sale selector/reducer contract; the inline form requires
  // a positive price and presents net (after-fee) proceeds.
  const error = Number(shares) > position.shares ? `You only hold ${position.shares} shares`
    : price.trim() && Number(price) === 0 ? 'Enter a sale price greater than 0.' : preview.error
  const valid = preview.valid && !error
  const realizedPct = preview.costBasis > 0 ? preview.realizedGL / preview.costBasis * 100 : 0
  return <section className="card blueprint elev-sm" aria-label={`Close lot ${position.id}`}>
    <div className="card-title">Close {position.symbol} · {position.shares} shares</div>
    <label className="field"><span>Shares sold</span><input className="input" aria-label="Shares" type="number" min="0" value={shares} onChange={e => setShares(e.target.value)} /></label>
    <label className="field"><span>Sale price</span><input className="input" aria-label="Sale price" type="number" min="0" value={price} onChange={e => setPrice(e.target.value)} /></label>
    <label className="field"><span>Sale date</span><input className="input" aria-label="Sale date" type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
    <label className="field"><span>Fees</span><input className="input" aria-label="Fees" type="number" min="0" value={fees} onChange={e => setFees(e.target.value)} /></label>
    {error && <div role="alert" className="text-muted">{error}</div>}
    <dl>
      <dt>Realized G/L</dt><dd><strong>{fmtUSD(preview.realizedGL)}</strong> <span>{realizedPct.toFixed(2)}%</span></dd>
      <dt>Proceeds</dt><dd>{fmtUSD(preview.valid ? preview.proceeds - Number(fees) : 0)}</dd>
      <dt>Cost basis</dt><dd>{fmtUSD(preview.costBasis)}</dd>
      <dt>Shares remaining</dt><dd>{preview.remaining.toFixed(2)} shares</dd>
    </dl>
    <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
    <button type="button" className="btn btn-primary" disabled={!valid} onClick={() => {
      if (!valid) return
      dispatch({ type: 'CLOSE_POSITION_WITH_SALE', positionId: position.id, shares: Number(shares), price: Number(price), date, fees: Number(fees) })
      onClosed()
    }}>Close position</button>
  </section>
}
