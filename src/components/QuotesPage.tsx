import { useEffect, useState } from 'react'
import type { AppState } from '../lib/state'
import { heldEquityEtfSymbols } from '../lib/selectors'
import { fmtUSD } from '../lib/computations'
import { getAllBars, getAllTickerOverviews, type DailyBar, type TickerOverview } from '../lib/marketDataDb'

export interface QuotesPageProps {
  state: AppState
  dispatch: (action: any) => void
  tickerOverviewErrors: Record<string, string>
}

/**
 * Read-only Quotes page: table of held Equity/ETF symbols with cached
 * price-sync price, ticker overview (name, SIC description), and last-updated
 * bar timestamp. Search filters across symbol/name/status/SIC description.
 */
export function QuotesPage({ state, dispatch: _dispatch, tickerOverviewErrors }: QuotesPageProps) {
  const [allBars, setAllBars] = useState<DailyBar[]>([])
  const [allOverviews, setAllOverviews] = useState<TickerOverview[]>([])
  const [search, setSearch] = useState('')
  const priceSync = state.priceSync

  useEffect(() => {
    let cancelled = false
    Promise.all([getAllBars(), getAllTickerOverviews()]).then(([bars, overviews]) => {
      if (!cancelled) {
        setAllBars(bars)
        setAllOverviews(overviews)
      }
    })
    return () => {
      cancelled = true
    }
  }, [priceSync.lastRun?.at])

  const symbols = heldEquityEtfSymbols(state).sort((a, b) => a.localeCompare(b))
  const barByTicker = new Map(allBars.map((b) => [b.ticker, b]))
  const overviewByTicker = new Map(allOverviews.map((o) => [o.ticker, o]))
  const notFoundSet = new Set(priceSync.lastRun?.notFound ?? [])

  const rows = symbols.map((symbol) => {
    const held = priceSync.heldPrices[symbol]
    const bar = barByTicker.get(symbol)
    const overview = overviewByTicker.get(symbol)
    const status = notFoundSet.has(symbol) ? 'Not found' : held ? 'OK' : 'Not found'
    const price = held?.price ?? bar?.close
    return {
      symbol,
      name: overview?.name ?? '—',
      status,
      price: price !== undefined ? fmtUSD(price) : '—',
      held: 'Yes',
      lastUpdated:
        bar && Number.isFinite(bar.t)
          ? new Date(bar.t).toISOString().slice(0, 19).replace('T', ' ') + ' UTC'
          : '—',
      sicDescription: overview?.sicDescription ?? '—',
    }
  })

  const q = search.trim().toLowerCase()
  const filteredRows = q
    ? rows.filter(
        (r) =>
          r.symbol.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          r.status.toLowerCase().includes(q) ||
          r.sicDescription.toLowerCase().includes(q)
      )
    : rows

  const failedTickers = Object.keys(tickerOverviewErrors)

  return (
    <section className="card blueprint elev-sm">
      <div className="card-title" style={{ marginBottom: 'var(--space-4)' }}>
        Quotes
      </div>
      {failedTickers.length > 0 && (
        <p style={{ color: '#8a3c2e' }}>Could not fetch name for: {failedTickers.join(', ')}</p>
      )}
      {symbols.length === 0 ? (
        <p>No holdings to show.</p>
      ) : (
        <>
          <div className="field">
            <input
              type="text"
              className="input"
              placeholder="Search ticker, name, status, or SIC..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 320px)', marginTop: 'var(--space-3)' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Price</th>
                  <th>Held</th>
                  <th>Last Updated (UTC)</th>
                  <th>SIC Description</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => (
                  <tr key={r.symbol}>
                    <td>{r.symbol}</td>
                    <td>{r.name}</td>
                    <td style={r.status === 'Not found' ? { color: '#8a3c2e' } : undefined}>{r.status}</td>
                    <td>{r.price}</td>
                    <td>{r.held}</td>
                    <td>{r.lastUpdated}</td>
                    <td>{r.sicDescription}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
