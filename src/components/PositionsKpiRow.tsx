import { fmtPct, fmtUSD } from '../lib/computations'

export interface PositionsKpiRowProps {
  kpis: {
    marketValue: number
    unrealizedGL: number
    unrealizedGLPct: number
    realizedGL: number
    positionCount: number
    accountCount: number
    allocationBars: Array<{ label: string; value: string; pct: string; pctNum: number }>
  }
  closed?: boolean
}

export function PositionsKpiRow({ kpis, closed = false }: PositionsKpiRowProps) {
  const scopeLabel = `${kpis.positionCount} position${kpis.positionCount === 1 ? '' : 's'} · ${kpis.accountCount} account${kpis.accountCount === 1 ? '' : 's'}`
  const signedUSD = (value: number) => `${value >= 0 ? '+' : '-'}${fmtUSD(Math.abs(value))}`
  const glClass = (value: number) => value >= 0 ? 'kpi-gain' : 'kpi-loss'

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-4)' }}>
      <div className="card blueprint elev-sm" data-testid="positions-kpi-card">
        <div className="card-kicker">Market value</div>
        <div className="kpi-value">{fmtUSD(kpis.marketValue)}</div>
        <div className="kpi-context">{scopeLabel}</div>
      </div>
      <div className="card blueprint elev-sm" data-testid="positions-kpi-card">
        <div className="card-kicker">Unrealized G/L</div>
        <div className={`kpi-value ${glClass(kpis.unrealizedGL)}`}>{signedUSD(kpis.unrealizedGL)}</div>
        <div className={`kpi-context ${glClass(kpis.unrealizedGL)}`}>{fmtPct(kpis.unrealizedGLPct)}</div>
      </div>
      <div className="card blueprint elev-sm" data-testid="positions-kpi-card">
        <div className="card-kicker">Realized G/L</div>
        <div className={`kpi-value ${glClass(kpis.realizedGL)}`}>{signedUSD(kpis.realizedGL)}</div>
      </div>
      {!closed && (
        <div className="card blueprint elev-sm" data-testid="positions-kpi-card" style={{ gridColumn: 'span 2' }}>
          <div className="card-kicker" style={{ marginBottom: 'var(--space-3)' }}>Allocations</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--space-3) var(--space-6)' }}>
            {kpis.allocationBars.map((bar) => (
              <div key={bar.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '3px' }}>
                  <span>{bar.label} <span className="text-muted" style={{ fontSize: '11px' }}>{bar.value}</span></span>
                  <span className="text-muted">{bar.pct}</span>
                </div>
                <div style={{ height: '6px', border: '1px solid var(--color-divider)', background: 'transparent' }}>
                  <div style={{ height: '100%', width: `${bar.pctNum}%`, background: 'var(--color-accent)' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
