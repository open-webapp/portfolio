import { useEffect, useState } from 'react'
import type { AppState } from '../lib/state'
import { heldEquityEtfSymbols, heldMutualFundSymbols } from '../lib/selectors'
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
  }, [priceSync.lastRun?.at, state.mutualFundSync.lastRun?.at])

  const equityEtfSymbols = heldEquityEtfSymbols(state).sort((a, b) => a.localeCompare(b))
  const mutualFundSymbols = heldMutualFundSymbols(state).sort((a, b) => a.localeCompare(b))
  const barByTicker = new Map(allBars.map((b) => [b.ticker, b]))
  const overviewByTicker = new Map(allOverviews.map((o) => [o.ticker, o]))
  const notFoundSet = new Set(priceSync.lastRun?.notFound ?? [])
  const mfNotFoundSet = new Set(state.mutualFundSync.lastRun?.notFound ?? [])
  const today = new Date().toISOString().slice(0, 10)

  const equityEtfRows = equityEtfSymbols.map((symbol) => {
    const held = priceSync.heldPrices[symbol]
    const bar = barByTicker.get(symbol)
    const overview = overviewByTicker.get(symbol)
    const status = notFoundSet.has(symbol) ? 'Not found' : held ? 'OK' : 'Not found'
    const price = held?.price ?? bar?.close
    const position = state.positions.find((p) => p.symbol === symbol)
    const assetClass = position ? position.assetClassManualOverride || position.assetClass : '—'
    return {
      symbol,
      assetClass,
      name: overview?.name ?? '—',
      status,
      price: price !== undefined ? fmtUSD(price) : '—',
      held: 'Yes',
      lastUpdated:
        bar && Number.isFinite(bar.t)
          ? new Date(bar.t).toISOString().slice(0, 19).replace('T', ' ') + ' UTC'
          : '—',
      sicDescription: overview?.sicDescription || '—',
    }
  })

  const mutualFundRows = mutualFundSymbols.map((symbol) => {
    const mfHeld = state.mutualFundSync.heldPrices[symbol]
    const bar = barByTicker.get(symbol)
    const overview = overviewByTicker.get(symbol)
    const status = mfNotFoundSet.has(symbol)
      ? 'Not found'
      : mfHeld && mfHeld.fetchedAt.slice(0, 10) === today
        ? 'OK'
        : 'Pending'
    return {
      symbol,
      assetClass: 'Mutual Fund',
      name: overview?.name ?? '—',
      status,
      price: mfHeld?.price !== undefined ? fmtUSD(mfHeld.price) : '—',
      held: 'Yes',
      lastUpdated:
        bar && Number.isFinite(bar.t)
          ? new Date(bar.t).toISOString().slice(0, 19).replace('T', ' ') + ' UTC'
          : '—',
      sicDescription: overview?.sicDescription || '—',
    }
  })

  const rows = [...equityEtfRows, ...mutualFundRows].sort((a, b) => a.symbol.localeCompare(b.symbol))

  const q = search.trim().toLowerCase()
  const filteredRows = q
    ? rows.filter(
        (r) =>
          r.symbol.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          r.status.toLowerCase().includes(q) ||
          r.sicDescription.toLowerCase().includes(q) ||
          r.assetClass.toLowerCase().includes(q)
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
      {rows.length === 0 ? (
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
                  <th>Asset Class</th>
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
                    <td>{r.assetClass}</td>
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
