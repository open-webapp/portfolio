/**
 * Orchestration for syncing held Equity/ETF prices from Polygon's grouped daily bars endpoint.
 * See src/lib/marketDataDb.ts for the local bar cache and src/lib/types.ts for PriceSyncState.
 */

import type { HeldSymbolPrice, PriceSyncLastRun, PriceSyncState } from './types'
import { putBars, type DailyBar } from './marketDataDb'

/** Next business day after `dateStr` (YYYY-MM-DD), skipping Sat/Sun only. */
export function nextBusinessDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + 1)
  const day = date.getUTCDay()
  if (day === 6) date.setUTCDate(date.getUTCDate() + 2) // Saturday -> Monday
  else if (day === 0) date.setUTCDate(date.getUTCDate() + 1) // Sunday -> Monday
  return date.toISOString().slice(0, 10)
}

/** Seed for first-ever run: yesterday (today - 1 business day), YYYY-MM-DD. */
export function seedLastFetchedDate(today: Date = new Date()): string {
  const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  date.setUTCDate(date.getUTCDate() - 1)
  const day = date.getUTCDay()
  if (day === 0) date.setUTCDate(date.getUTCDate() - 2) // Sunday -> Friday
  else if (day === 6) date.setUTCDate(date.getUTCDate() - 1) // Saturday -> Friday
  return date.toISOString().slice(0, 10)
}

/** Raw Polygon response shape (subset used). */
export interface PolygonGroupedBarsResponse {
  results?: { T: string; c: number; h: number; l: number }[]
  resultsCount?: number
  status?: string
}

/** Fetch one grouped-daily-bars day. Returns null on non-2xx/network error
 *  or a malformed/missing `results` field (treated identically to "no data
 *  for this date" by the caller — do not advance lastFetchedDate). */
export async function fetchGroupedDailyBars(
  date: string,
  apiKey: string
): Promise<PolygonGroupedBarsResponse['results'] | null> {
  let res: Response
  try {
    res = await fetch(
      `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}?apiKey=${apiKey}`
    )
  } catch {
    return null
  }

  if (!res.ok) return null

  let json: PolygonGroupedBarsResponse
  try {
    json = await res.json()
  } catch {
    return null
  }

  if (!Array.isArray(json.results)) return null

  return json.results
}

/**
 * Orchestration: given current AppState.priceSync + held Equity/ETF symbols,
 * runs one fetch attempt for the next business day after lastFetchedDate
 * (or the seeded date if lastFetchedDate is null), writes ALL returned bars
 * to marketDataDb, and returns a RECORD_PRICE_SYNC_RUN-shaped patch plus the
 * updated Position[] (price-overwritten for held symbols found in the
 * response) — does NOT dispatch itself, caller dispatches the result.
 */
export async function runPriceSync(
  priceSync: PriceSyncState,
  heldEquityEtfSymbols: string[]
): Promise<{
  patch: { lastFetchedDate?: string; heldPrices?: Record<string, HeldSymbolPrice>; lastRun: PriceSyncLastRun }
  updatedPrices: Record<string, number> // symbol -> new price, for caller to apply to Position[]
}> {
  const now = new Date().toISOString()

  if (!priceSync.apiKey) {
    return {
      patch: { lastRun: { at: now, updatedCount: 0, notFound: [] } },
      updatedPrices: {},
    }
  }

  const targetDate =
    priceSync.lastFetchedDate === null
      ? nextBusinessDay(seedLastFetchedDate())
      : nextBusinessDay(priceSync.lastFetchedDate)

  const results = await fetchGroupedDailyBars(targetDate, priceSync.apiKey)

  // Empty/null/malformed response: no data for this date. Chosen semantics —
  // every held symbol is reported "not found" for this run rather than silently
  // skipped, so the caller/UI can surface that nothing was updated.
  if (!results || results.length === 0) {
    return {
      patch: { lastRun: { at: now, updatedCount: 0, notFound: [...heldEquityEtfSymbols] } },
      updatedPrices: {},
    }
  }

  const bars: DailyBar[] = results.map((r) => ({
    ticker: r.T,
    close: r.c,
    high: r.h,
    low: r.l,
    date: targetDate,
  }))
  await putBars(bars)

  const byTicker = new Map(results.map((r) => [r.T, r]))
  const newHeldPrices: Record<string, HeldSymbolPrice> = {}
  const updatedPrices: Record<string, number> = {}
  const notFound: string[] = []

  for (const symbol of heldEquityEtfSymbols) {
    const bar = byTicker.get(symbol)
    if (bar) {
      newHeldPrices[symbol] = { price: bar.c, date: targetDate, fetchedAt: now }
      updatedPrices[symbol] = bar.c
    } else {
      notFound.push(symbol)
    }
  }

  return {
    patch: {
      lastFetchedDate: targetDate,
      heldPrices: { ...priceSync.heldPrices, ...newHeldPrices },
      lastRun: { at: now, updatedCount: Object.keys(newHeldPrices).length, notFound },
    },
    updatedPrices,
  }
}
