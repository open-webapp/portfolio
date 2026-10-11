import { useState } from 'react'
import type { Account, Position } from '../lib/types'
import { fmtUSD } from '../lib/computations'
import { closePositionSalePreview } from '../lib/selectors'

export function ClosePanel({ position, account, dispatch, onCancel, onClosed }: {
  position: Position
  account?: Account
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
  return <section aria-label={`Close lot ${position.id}`} style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
    <div className="card-title">Close position</div>
    <div className="text-muted">Record a sale. Ledger moves the shares to Closed positions and keeps the realized G/L.</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 360px)', gap: 24, alignItems: 'start' }}>
    <div className="card blueprint elev-sm" style={{ padding: 16, gap: 16 }}>
      <div>{account ? `${account.institution ? `${account.institution} — ` : ''}${account.name.trim() || account.accountNumber}` : 'Unknown Account'} <span className="text-muted">· {position.symbol} · {position.shares} shares{account && ` · #${account.accountNumber}`}</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
    <label className="field"><span>Shares sold</span><input className="input" aria-label="Shares" type="number" min="0" value={shares} onChange={e => setShares(e.target.value)} /></label>
    <label className="field"><span>Sale price</span><input className="input" aria-label="Sale price" type="number" min="0" value={price} onChange={e => setPrice(e.target.value)} /></label>
    <label className="field"><span>Sale date</span><input className="input" aria-label="Sale date" type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
    <label className="field"><span>Fees</span><input className="input" aria-label="Fees" type="number" min="0" value={fees} onChange={e => setFees(e.target.value)} /></label>
      </div>
      {error && <div role="alert" className="text-muted">{error}</div>}
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <div className="card blueprint elev-sm" style={{ padding: 16, gap: 12 }}>
      <div style={{ color: 'var(--color-accent)', fontSize: 10, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase' }}>Result</div>
      <div className="card-title">Realized G/L</div>
      <strong className={preview.realizedGL < 0 ? 'kpi-loss' : 'kpi-gain'} style={{ fontSize: 30, lineHeight: 1.15 }}>{fmtUSD(preview.realizedGL)}</strong>
      <div><span>{realizedPct.toFixed(2)}%</span> <span className="text-muted">on cost basis</span></div>
      <dl style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 12, margin: 0, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><dt className="text-muted">Proceeds (shares × price − fees)</dt><dd style={{ margin: 0 }}>{fmtUSD(preview.valid ? preview.proceeds - Number(fees) : 0)}</dd></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><dt className="text-muted">Cost basis (shares × avg cost)</dt><dd style={{ margin: 0 }}>{fmtUSD(preview.costBasis)}</dd></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><dt className="text-muted">Shares remaining</dt><dd style={{ margin: 0 }}>{preview.remaining.toFixed(2)} shares</dd></div>
      </dl>
    </div>
    <div className="text-muted" style={{ fontSize: 12 }}>Fees are subtracted from proceeds. Realized G/L uses this lot’s average cost.</div>
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
    <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
    <button type="button" className="btn btn-primary" disabled={!valid} onClick={() => {
      if (!valid) return
      dispatch({ type: 'CLOSE_POSITION_WITH_SALE', positionId: position.id, shares: Number(shares), price: Number(price), date, fees: Number(fees) })
      onClosed()
    }}>Close position</button>
    </div>
    </div>
    </div>
  </section>
}
