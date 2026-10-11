import { fmtPct, fmtUSD } from '../lib/computations'
import type { positionsHero } from '../lib/selectors'

export interface PositionsHeroProps {
  kpis: ReturnType<typeof positionsHero>
  closed?: boolean
}

const signedUSD = (value: number) => `${value >= 0 ? '+' : '-'}${fmtUSD(Math.abs(value))}`
const glClass = (value: number) => value >= 0 ? 'kpi-gain' : 'kpi-loss'

export function PositionsHero({ kpis, closed = false }: PositionsHeroProps) {
  const scopeLabel = `${kpis.positionCount} position${kpis.positionCount === 1 ? '' : 's'} · ${kpis.accountCount} account${kpis.accountCount === 1 ? '' : 's'}`
  const realized = (
    <div>
      <div className="card-kicker">Realized G/L</div>
      <div className={`kpi-value ${glClass(kpis.realizedGL)}`} style={{ fontSize: closed ? '30px' : '19px', marginTop: closed ? 0 : '6px' }}>{signedUSD(kpis.realizedGL)}</div>
      <div className="kpi-context">{closed ? `${kpis.closedCount} closed position${kpis.closedCount === 1 ? '' : 's'}` : `${kpis.closedCount} closed`}</div>
    </div>
  )

  return (
    <div className="card blueprint elev-sm" style={{ padding: '20px 24px', display: closed ? 'flex' : 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: closed ? '40px' : '16px 48px', alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: '40px', flexWrap: 'wrap' }}>
        {closed ? realized : (
          <div>
            <div className="card-kicker">Market value</div>
            <div className="kpi-value" style={{ fontSize: '30px', lineHeight: 1.15 }}>{fmtUSD(kpis.marketValue)}</div>
            <div className="kpi-context">{scopeLabel}</div>
          </div>
        )}
        <div>
          <div className="card-kicker">Unrealized G/L</div>
          <div className={`kpi-value ${glClass(kpis.unrealizedGL)}`} style={{ fontSize: '19px', marginTop: '6px' }}>{signedUSD(kpis.unrealizedGL)}</div>
          <div className={`kpi-context ${closed ? 'text-muted' : glClass(kpis.unrealizedGL)}`}>{closed ? 'on open positions' : fmtPct(kpis.unrealizedGLPct)}</div>
        </div>
        {!closed && realized}
      </div>
      {!closed && (
        <div>
          <div className="text-muted" style={{ fontSize: '11px', marginBottom: '8px' }}>Allocation by asset class</div>
          <div role="img" aria-label="Asset allocation" style={{ display: 'flex', height: '12px', gap: '2px' }}>
            {kpis.allocationBars.map((bar, index) => (
              <div key={bar.label} title={`${bar.label} ${bar.pct} · ${bar.value}`} style={{ width: `${bar.pctNum}%`, background: 'var(--color-accent)', opacity: Math.max(0.3, 1 - index * 0.18) }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginTop: '8px', fontSize: '12px' }}>
            {kpis.allocationBars.map((bar, index) => (
              <span key={bar.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span aria-hidden="true" style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-accent)', opacity: Math.max(0.3, 1 - index * 0.18) }} />
                <span>{bar.label} {bar.pct} · {bar.value}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
