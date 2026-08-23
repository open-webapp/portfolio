import type { Position } from './types'
import { getTickerOverview, putTickerOverview } from './marketDataDb'

/** Thrown when Polygon rate-limits the ticker overview request (429) — the
 *  caller stops the sync loop entirely rather than treating it like a
 *  per-ticker failure, since continuing would just draw more 429s. */
export class TickerOverviewRateLimitError extends Error {
  constructor() {
    super('Polygon ticker overview error: 429 (rate limited)')
  }
}

/** Fetch one ticker's name + SIC description from Polygon's Ticker Overview
 *  endpoint. Throws on network error, non-2xx, or a malformed/missing
 *  results.name / results.sic_description — caller catches. */
export async function fetchTickerOverview(
  ticker: string,
  apiKey: string
): Promise<{ name: string; sicDescription: string }> {
  const res = await fetch(
    `https://api.polygon.io/v3/reference/tickers/${ticker}?apiKey=${apiKey}`
  )
  if (res.status === 429) throw new TickerOverviewRateLimitError()
  if (!res.ok) throw new Error(`Polygon ticker overview error: ${res.status}`)
  const json = await res.json()
  const name = json?.results?.name
  const sicDescription = json?.results?.sic_description
  if (typeof name !== 'string' || typeof sicDescription !== 'string') {
    throw new Error('Malformed ticker overview response')
  }
  return { name, sicDescription }
}

/**
 * Best-effort, cache-aware enrichment: for each held symbol not already
 * cached, fetches its overview, caches it, and syncs Position.name for
 * every matching held position. Never throws — per-ticker failures are
 * reported via onError and otherwise ignored (retried automatically on
 * a future call, since a failed ticker is never cached).
 */
export async function syncTickerOverviews(
  heldSymbols: string[],
  apiKey: string,
  positions: Position[],
  dispatch: (action: any) => void,
  onError: (ticker: string, message: string) => void,
  onSuccess?: (ticker: string) => void
): Promise<void> {
  for (const ticker of heldSymbols) {
    const cached = await getTickerOverview(ticker)
    if (cached) continue
    try {
      const overview = await fetchTickerOverview(ticker, apiKey)
      await putTickerOverview({
        ticker,
        name: overview.name,
        sicDescription: overview.sicDescription,
        fetchedAt: new Date().toISOString(),
      })
      for (const p of positions.filter((p) => p.symbol === ticker)) {
        dispatch({ type: 'UPDATE_POSITION', positionId: p.id, patch: { name: overview.name } })
      }
      onSuccess?.(ticker)
    } catch (err) {
      if (err instanceof TickerOverviewRateLimitError) {
        // Rate-limited: stop hammering Polygon for the remaining held symbols.
        // A failed ticker is never cached, so it's retried on the next trigger.
        onError(ticker, err.message)
        break
      }
      onError(ticker, err instanceof Error ? err.message : 'Could not fetch name')
    }
  }
}
