import type { Position } from './types'
import { getTickerOverview, putTickerOverview } from './marketDataDb'

/** Polygon free tier allows ~5 req/min for this endpoint. Space requests out
 *  under that limit so the sync loop doesn't draw 429s in the first place. */
export const REQUEST_SPACING_MS = 12_500

/** If a 429 slips through anyway (e.g. the key is also in use elsewhere),
 *  wait a full rate-limit window before retrying the same ticker. */
export const RATE_LIMIT_BACKOFF_MS = 60_000

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Thrown when Polygon rate-limits the ticker overview request (429) —
 *  the caller backs off and retries the same ticker rather than treating
 *  it like a per-ticker failure to skip past. */
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
 * every matching held position. Never throws — non-rate-limit per-ticker
 * failures are reported via onError and otherwise ignored (retried
 * automatically on a future call, since a failed ticker is never cached).
 *
 * Requests are spaced by REQUEST_SPACING_MS to stay under Polygon's rate
 * limit. If a 429 happens anyway, the same ticker is retried on a
 * RATE_LIMIT_BACKOFF_MS timer — still within the rate limit — until it
 * succeeds (or fails for a non-rate-limit reason), so one call to this
 * function drives every held symbol to completion rather than stopping
 * at the first rate-limited ticker.
 */
export async function syncTickerOverviews(
  heldSymbols: string[],
  apiKey: string,
  positions: Position[],
  dispatch: (action: any) => void,
  onError: (ticker: string, message: string) => void,
  onSuccess?: (ticker: string) => void,
  sleep: (ms: number) => Promise<void> = defaultSleep
): Promise<void> {
  let needsSpacing = false
  for (const ticker of heldSymbols) {
    const cached = await getTickerOverview(ticker)
    if (cached) continue

    if (needsSpacing) await sleep(REQUEST_SPACING_MS)
    needsSpacing = true

    for (;;) {
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
        break
      } catch (err) {
        if (err instanceof TickerOverviewRateLimitError) {
          onError(ticker, err.message)
          await sleep(RATE_LIMIT_BACKOFF_MS)
          continue
        }
        onError(ticker, err instanceof Error ? err.message : 'Could not fetch name')
        break
      }
    }
  }
}
