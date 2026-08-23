/**
 * Orchestration for syncing held Mutual Fund names + prices from
 * Alphavantage. Parallel to src/lib/priceSync.ts (Polygon, Equity/ETF).
 * See src/lib/marketDataDb.ts for the shared name cache (ticker_overviews,
 * reused here with sicDescription: '') and src/lib/types.ts for
 * MutualFundSyncState.
 */
import { getTickerOverview, putTickerOverview } from './marketDataDb'
import type { MutualFundSyncState, HeldSymbolPrice, PriceSyncLastRun, Position } from './types'

export const ALPHAVANTAGE_REQUEST_SPACING_MS = 12_500
export const ALPHAVANTAGE_RATE_LIMIT_BACKOFF_MS = 60_000
export const ALPHAVANTAGE_DAILY_CALL_CAP = 25 // must match selectors.ts's constant of the same name

const BASE_URL = 'https://www.alphavantage.co/query'

export class AlphavantageRateLimitError extends Error {
  constructor() {
    super('Alphavantage rate limited (Note/Information field present)')
  }
}

/** Alphavantage signals rate limiting via HTTP 200 with a truthy string
 *  "Note" or "Information" field in the JSON body — not a 429. */
function isRateLimitedBody(json: any): boolean {
  return typeof json?.Note === 'string' && json.Note.length > 0
    || typeof json?.Information === 'string' && json.Information.length > 0
}

/** Look up a symbol's name via SYMBOL_SEARCH. Case-insensitive match on
 *  "1. symbol"; first match wins if several match. Returns null if no
 *  match (retryable — caller must not cache this as permanent).
 *  Throws AlphavantageRateLimitError on rate-limit-body detection, plain
 *  Error on non-2xx/network/malformed. */
export async function fetchSymbolSearch(
  symbol: string,
  apiKey: string
): Promise<{ name: string } | null> {
  const res = await fetch(`${BASE_URL}?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(symbol)}&apikey=${apiKey}`)
  if (!res.ok) throw new Error(`Alphavantage SYMBOL_SEARCH error: ${res.status}`)
  const json = await res.json()
  if (isRateLimitedBody(json)) throw new AlphavantageRateLimitError()
  const matches: any[] = Array.isArray(json?.bestMatches) ? json.bestMatches : []
  const hit = matches.find((m) => typeof m?.['1. symbol'] === 'string' && m['1. symbol'].toUpperCase() === symbol.toUpperCase())
  if (!hit || typeof hit['2. name'] !== 'string') return null
  return { name: hit['2. name'] }
}

/** Look up a symbol's latest daily close via TIME_SERIES_DAILY. Picks the
 *  max date key present. Returns null if no time-series data (retryable).
 *  Same throw convention as fetchSymbolSearch. */
export async function fetchTimeSeriesDaily(
  symbol: string,
  apiKey: string
): Promise<{ price: number; date: string } | null> {
  const res = await fetch(`${BASE_URL}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=compact&apikey=${apiKey}`)
  if (!res.ok) throw new Error(`Alphavantage TIME_SERIES_DAILY error: ${res.status}`)
  const json = await res.json()
  if (isRateLimitedBody(json)) throw new AlphavantageRateLimitError()
  const series = json?.['Time Series (Daily)']
  if (!series || typeof series !== 'object') return null
  const dates = Object.keys(series)
  if (dates.length === 0) return null
  const maxDate = dates.reduce((a, b) => (a > b ? a : b))
  const closeStr = series[maxDate]?.['4. close']
  const price = Number(closeStr)
  if (!Number.isFinite(price)) return null
  return { price, date: maxDate }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Best-effort, budget-aware sync: for each held mutual fund symbol, fetches
 * a name (once ever, cached in ticker_overviews) and today's price (once
 * per calendar day, cached in mutualFundSync.heldPrices) via Alphavantage.
 * Stops (does not throw) once the daily call cap is spent, reporting how
 * many symbols are still pending. Does not touch Position.price — only
 * Position.name via UPDATE_POSITION, same as tickerOverview.ts.
 *
 * Budget is spent BEFORE the fetch call resolves (increment then call) so a
 * crash mid-fetch still counts against the day's cap — conservative, avoids
 * a crash loop re-spending the same call forever.
 */
export async function runMutualFundSync(
  mutualFundSync: MutualFundSyncState,
  heldSymbols: string[],
  positions: Position[],
  dispatch: (action: any) => void,
  onError: (symbol: string, message: string) => void,
  onSuccess?: (symbol: string) => void,
  sleep: (ms: number) => Promise<void> = defaultSleep
): Promise<{
  patch: {
    heldPrices?: Record<string, HeldSymbolPrice>
    lastRun: PriceSyncLastRun
    callBudget: { date: string; callsUsed: number }
  }
  pendingCount: number
}> {
  const now = new Date().toISOString()
  const today = todayStr()
  let budget = mutualFundSync.callBudget.date === today
    ? { ...mutualFundSync.callBudget }
    : { date: today, callsUsed: 0 }

  if (!mutualFundSync.apiKey) {
    return {
      patch: { lastRun: { at: now, updatedCount: 0, notFound: [], marketTickerCount: 0 }, callBudget: budget },
      pendingCount: heldSymbols.length,
    }
  }

  const newHeldPrices: Record<string, HeldSymbolPrice> = { ...mutualFundSync.heldPrices }
  const notFound: string[] = []
  let updatedCount = 0
  let needsSpacing = false
  let budgetExhausted = false

  for (let i = 0; i < heldSymbols.length; i++) {
    const symbol = heldSymbols[i]
    if (budgetExhausted) continue

    const cachedOverview = await getTickerOverview(symbol)
    if (cachedOverview?.notFound) notFound.push(symbol)
    const heldPrice = newHeldPrices[symbol]
    let needsName = !cachedOverview
    let needsPrice = !heldPrice || heldPrice.fetchedAt.slice(0, 10) !== today
    if (!needsName && !needsPrice) continue

    while (needsName) {
      if (budget.callsUsed >= ALPHAVANTAGE_DAILY_CALL_CAP) { budgetExhausted = true; break }
      if (needsSpacing) await sleep(ALPHAVANTAGE_REQUEST_SPACING_MS)
      needsSpacing = true
      try {
        budget.callsUsed++
        const result = await fetchSymbolSearch(symbol, mutualFundSync.apiKey)
        if (result) {
          await putTickerOverview({ ticker: symbol, name: result.name, sicDescription: '', fetchedAt: now })
          for (const p of positions.filter((p) => p.symbol === symbol)) {
            dispatch({ type: 'UPDATE_POSITION', positionId: p.id, patch: { name: result.name } })
          }
          onSuccess?.(symbol)
        } else {
          await putTickerOverview({ ticker: symbol, name: '', sicDescription: '', fetchedAt: now, notFound: true })
          notFound.push(symbol)
          onError(symbol, 'Not found')
        }
        needsName = false
      } catch (err) {
        if (err instanceof AlphavantageRateLimitError) {
          onError(symbol, err.message)
          await sleep(ALPHAVANTAGE_RATE_LIMIT_BACKOFF_MS)
          continue
        }
        onError(symbol, err instanceof Error ? err.message : 'Could not fetch name')
        needsName = false
      }
    }

    while (needsPrice && !budgetExhausted) {
      if (budget.callsUsed >= ALPHAVANTAGE_DAILY_CALL_CAP) { budgetExhausted = true; break }
      if (needsSpacing) await sleep(ALPHAVANTAGE_REQUEST_SPACING_MS)
      needsSpacing = true
      try {
        budget.callsUsed++
        const result = await fetchTimeSeriesDaily(symbol, mutualFundSync.apiKey)
        if (result) {
          newHeldPrices[symbol] = { price: result.price, date: result.date, fetchedAt: now }
          updatedCount++
          onSuccess?.(symbol)
        } else {
          onError(symbol, 'No price data returned')
        }
        needsPrice = false
      } catch (err) {
        if (err instanceof AlphavantageRateLimitError) {
          onError(symbol, err.message)
          await sleep(ALPHAVANTAGE_RATE_LIMIT_BACKOFF_MS)
          continue
        }
        onError(symbol, err instanceof Error ? err.message : 'Could not fetch price')
        needsPrice = false
      }
    }
  }

  const pendingCount = heldSymbols.filter((symbol) => {
    const heldPrice = newHeldPrices[symbol]
    const stalePrice = !heldPrice || heldPrice.fetchedAt.slice(0, 10) !== today
    return stalePrice
  }).length

  return {
    patch: {
      heldPrices: newHeldPrices,
      lastRun: { at: now, updatedCount, notFound, marketTickerCount: 0 },
      callBudget: budget,
    },
    pendingCount,
  }
}
