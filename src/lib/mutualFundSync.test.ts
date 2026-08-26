import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import {
  fetchSymbolSearch,
  fetchTimeSeriesDaily,
  runMutualFundSync,
  AlphavantageRateLimitError,
  ALPHAVANTAGE_REQUEST_SPACING_MS,
  ALPHAVANTAGE_DAILY_CALL_CAP,
} from './mutualFundSync'
import { getTickerOverview, putTickerOverview } from './marketDataDb'
import type { MutualFundSyncState, Position } from './types'

const DB_NAME = 'portfolio_market_data_v1'
const STORE_NAME = 'daily_bars'
const OVERVIEW_STORE_NAME = 'ticker_overviews'

async function clearDatabase() {
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 2)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'ticker' })
        }
        if (!db.objectStoreNames.contains(OVERVIEW_STORE_NAME)) {
          db.createObjectStore(OVERVIEW_STORE_NAME, { keyPath: 'ticker' })
        }
      }
    })

    const transaction = db.transaction([STORE_NAME, OVERVIEW_STORE_NAME], 'readwrite')
    await new Promise<void>((resolve, reject) => {
      transaction.objectStore(STORE_NAME).clear()
      transaction.objectStore(OVERVIEW_STORE_NAME).clear()
      transaction.onerror = () => reject(transaction.error)
      transaction.oncomplete = () => resolve()
    })
    db.close()
  } catch {
    // Ignore errors
  }
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function makeMutualFundSync(overrides: Partial<MutualFundSyncState> = {}): MutualFundSyncState {
  return {
    apiKey: 'key',
    heldPrices: {},
    lastRun: null,
    callBudget: { date: todayStr(), callsUsed: 0 },
    ...overrides,
  }
}

function makePosition(symbol: string, overrides: Partial<Position> = {}): Position {
  return {
    id: `pos-${symbol}`,
    accountId: 'acct-1',
    symbol,
    name: null,
    assetClass: 'Mutual Fund',
    shares: 10,
    avgCost: 50,
    price: 0,
    lastImportedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/** Generic fetch mock: routes by `function=` query param, returns a
 *  successful SYMBOL_SEARCH/TIME_SERIES_DAILY body for any symbol. */
function makeSuccessFetchMock() {
  return vi.fn().mockImplementation(async (url: string) => {
    if (url.includes('function=SYMBOL_SEARCH')) {
      return jsonResponse({
        bestMatches: [{ '1. symbol': 'VTSAX', '2. name': 'Vanguard Total Stock Market Index Fund' }],
      })
    }
    if (url.includes('function=TIME_SERIES_DAILY')) {
      return jsonResponse({
        'Time Series (Daily)': { '2026-08-21': { '4. close': '111.11' } },
      })
    }
    throw new Error(`unexpected url: ${url}`)
  })
}

describe('mutualFundSync', () => {
  beforeEach(async () => {
    await clearDatabase()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('fetchSymbolSearch', () => {
    it('happy path returns matched name', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse({
            bestMatches: [{ '1. symbol': 'VTSAX', '2. name': 'Vanguard Total Stock Market Index Fund' }],
          })
        )
      )

      const out = await fetchSymbolSearch('VTSAX', 'key')

      expect(out).toEqual({ name: 'Vanguard Total Stock Market Index Fund' })
    })

    it('case-insensitive match on symbol', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse({
            bestMatches: [{ '1. symbol': 'VTSAX', '2. name': 'Vanguard Total Stock Market Index Fund' }],
          })
        )
      )

      const out = await fetchSymbolSearch('vtsax', 'key')

      expect(out).toEqual({ name: 'Vanguard Total Stock Market Index Fund' })
    })

    it('multiple matches: first one wins', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse({
            bestMatches: [
              { '1. symbol': 'vtsax', '2. name': 'First Match Fund' },
              { '1. symbol': 'VTSAX', '2. name': 'Second Match Fund' },
            ],
          })
        )
      )

      const out = await fetchSymbolSearch('VTSAX', 'key')

      expect(out).toEqual({ name: 'First Match Fund' })
    })

    it('no match in bestMatches returns null', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse({
            bestMatches: [{ '1. symbol': 'OTHER', '2. name': 'Other Fund' }],
          })
        )
      )

      const out = await fetchSymbolSearch('VTSAX', 'key')

      expect(out).toBeNull()
    })

    it('empty bestMatches array returns null', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ bestMatches: [] })))

      const out = await fetchSymbolSearch('VTSAX', 'key')

      expect(out).toBeNull()
    })

    it('rate-limit body via Note field throws AlphavantageRateLimitError', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ Note: 'Thank you for using Alpha Vantage...' }))
      )

      await expect(fetchSymbolSearch('VTSAX', 'key')).rejects.toBeInstanceOf(AlphavantageRateLimitError)
    })

    it('rate-limit body via Information field throws AlphavantageRateLimitError', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ Information: 'rate limit reached' }))
      )

      await expect(fetchSymbolSearch('VTSAX', 'key')).rejects.toBeInstanceOf(AlphavantageRateLimitError)
    })

    it('non-2xx response throws plain Error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 403)))

      await expect(fetchSymbolSearch('VTSAX', 'key')).rejects.toThrow()
    })

    it('network error propagates', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

      await expect(fetchSymbolSearch('VTSAX', 'key')).rejects.toThrow('network down')
    })
  })

  describe('fetchTimeSeriesDaily', () => {
    it('happy path with multiple dates picks max date and parses close', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse({
            'Time Series (Daily)': {
              '2026-08-20': { '4. close': '10.00' },
              '2026-08-21': { '4. close': '10.50' },
              '2026-08-19': { '4. close': '9.75' },
            },
          })
        )
      )

      const out = await fetchTimeSeriesDaily('VTSAX', 'key')

      expect(out).toEqual({ price: 10.5, date: '2026-08-21' })
    })

    it('single date returns that date/price', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse({
            'Time Series (Daily)': {
              '2026-08-21': { '4. close': '42.13' },
            },
          })
        )
      )

      const out = await fetchTimeSeriesDaily('VTSAX', 'key')

      expect(out).toEqual({ price: 42.13, date: '2026-08-21' })
    })

    it('missing Time Series (Daily) key returns null', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ status: 'OK' })))

      const out = await fetchTimeSeriesDaily('VTSAX', 'key')

      expect(out).toBeNull()
    })

    it('empty Time Series (Daily) object returns null', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ 'Time Series (Daily)': {} }))
      )

      const out = await fetchTimeSeriesDaily('VTSAX', 'key')

      expect(out).toBeNull()
    })

    it('rate-limit body via Note field throws AlphavantageRateLimitError', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ Note: 'Thank you for using Alpha Vantage...' }))
      )

      await expect(fetchTimeSeriesDaily('VTSAX', 'key')).rejects.toBeInstanceOf(AlphavantageRateLimitError)
    })

    it('rate-limit body via Information field throws AlphavantageRateLimitError', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ Information: 'rate limit reached' }))
      )

      await expect(fetchTimeSeriesDaily('VTSAX', 'key')).rejects.toBeInstanceOf(AlphavantageRateLimitError)
    })

    it('non-2xx response throws', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 403)))

      await expect(fetchTimeSeriesDaily('VTSAX', 'key')).rejects.toThrow()
    })

    it('non-numeric close returns null instead of crashing', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse({
            'Time Series (Daily)': {
              '2026-08-21': { '4. close': 'not-a-number' },
            },
          })
        )
      )

      const out = await fetchTimeSeriesDaily('VTSAX', 'key')

      expect(out).toBeNull()
    })
  })

  describe('runMutualFundSync', () => {
    const today = todayStr()

    it('skips entirely if name already cached and price fresh today', async () => {
      await putTickerOverview({
        ticker: 'VTSAX',
        name: 'Vanguard Total Stock Market Index Fund',
        sicDescription: '',
        fetchedAt: new Date().toISOString(),
      })
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const dispatch = vi.fn()
      const onError = vi.fn()

      const state = makeMutualFundSync({
        heldPrices: { VTSAX: { price: 10, date: today, fetchedAt: new Date().toISOString() } },
      })

      const { pendingCount } = await runMutualFundSync(
        state,
        ['VTSAX'],
        [makePosition('VTSAX')],
        dispatch,
        onError
      )

      expect(fetchMock).not.toHaveBeenCalled()
      expect(pendingCount).toBe(0)
    })

    it('skips price fetch if priced today but still fetches missing name', async () => {
      const fetchMock = makeSuccessFetchMock()
      vi.stubGlobal('fetch', fetchMock)
      const dispatch = vi.fn()
      const onError = vi.fn()

      const state = makeMutualFundSync({
        heldPrices: { VTSAX: { price: 10, date: today, fetchedAt: new Date().toISOString() } },
      })

      await runMutualFundSync(state, ['VTSAX'], [makePosition('VTSAX')], dispatch, onError)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain('function=SYMBOL_SEARCH')
      expect(fetchMock.mock.calls.some((c) => (c[0] as string).includes('function=TIME_SERIES_DAILY'))).toBe(false)
    })

    it('cold symbol: fetches both name and price, dispatches name update, bumps call budget by 2', async () => {
      const fetchMock = makeSuccessFetchMock()
      vi.stubGlobal('fetch', fetchMock)
      const dispatch = vi.fn()
      const onError = vi.fn()
      const sleep = vi.fn().mockResolvedValue(undefined)

      const state = makeMutualFundSync()

      const { patch, pendingCount } = await runMutualFundSync(
        state,
        ['VTSAX'],
        [makePosition('VTSAX')],
        dispatch,
        onError,
        undefined,
        sleep
      )

      expect(fetchMock).toHaveBeenCalledTimes(2)
      const urls = fetchMock.mock.calls.map((c) => c[0] as string)
      expect(urls.some((u) => u.includes('function=SYMBOL_SEARCH'))).toBe(true)
      expect(urls.some((u) => u.includes('function=TIME_SERIES_DAILY'))).toBe(true)

      expect(patch.heldPrices?.VTSAX).toEqual({
        price: 111.11,
        date: '2026-08-21',
        fetchedAt: expect.any(String),
      })
      expect(patch.callBudget.callsUsed).toBe(2)
      expect(pendingCount).toBe(0)
      expect(sleep).toHaveBeenCalledWith(ALPHAVANTAGE_REQUEST_SPACING_MS)

      expect(dispatch).toHaveBeenCalledWith({
        type: 'UPDATE_POSITION',
        positionId: 'pos-VTSAX',
        patch: { name: 'Vanguard Total Stock Market Index Fund' },
      })
    })

    it('not-found name: reported in lastRun.notFound, cached permanently, never retried again', async () => {
      const fetchMock = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('function=SYMBOL_SEARCH')) {
          return jsonResponse({ bestMatches: [] })
        }
        throw new Error(`unexpected url: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)
      const dispatch = vi.fn()
      const onError = vi.fn()

      // Price already fresh so only the name fetch happens this run.
      const state = makeMutualFundSync({
        heldPrices: { VTSAX: { price: 10, date: today, fetchedAt: new Date().toISOString() } },
      })

      const { patch } = await runMutualFundSync(state, ['VTSAX'], [makePosition('VTSAX')], dispatch, onError)

      expect(patch.lastRun.notFound).toContain('VTSAX')
      expect(await getTickerOverview('VTSAX')).toMatchObject({ ticker: 'VTSAX', notFound: true })
      expect(onError).toHaveBeenCalledWith('VTSAX', 'Not found')

      // A later run must not re-fetch the name — cache hit skips it, and the
      // cached not-found status still surfaces in this run's notFound list.
      fetchMock.mockClear()
      const { patch: patch2 } = await runMutualFundSync(
        { ...state, heldPrices: patch.heldPrices },
        ['VTSAX'],
        [makePosition('VTSAX')],
        dispatch,
        onError
      )
      expect(fetchMock).not.toHaveBeenCalled()
      expect(patch2.lastRun.notFound).toContain('VTSAX')
    })

    it('rate limit on name fetch: bails out of the run instead of retry-looping in place', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ Note: 'Thank you for using Alpha Vantage...' }))
        .mockResolvedValueOnce(
          jsonResponse({
            bestMatches: [{ '1. symbol': 'VTSAX', '2. name': 'Vanguard Total Stock Market Index Fund' }],
          })
        )
      vi.stubGlobal('fetch', fetchMock)
      const dispatch = vi.fn()
      const onError = vi.fn()
      const sleep = vi.fn().mockResolvedValue(undefined)

      // Price already fresh so only the name fetch path is exercised.
      const state = makeMutualFundSync({
        heldPrices: { VTSAX: { price: 10, date: today, fetchedAt: new Date().toISOString() } },
      })

      const { patch } = await runMutualFundSync(
        state,
        ['VTSAX'],
        [makePosition('VTSAX')],
        dispatch,
        onError,
        undefined,
        sleep
      )

      // Bails immediately on the rate-limit response — one call spent, no
      // in-place retry/backoff sleep, and the name is left unresolved for
      // the next scheduled retry rather than looping here.
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(sleep).not.toHaveBeenCalled()
      expect(patch.callBudget.callsUsed).toBe(1)
      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError.mock.calls[0][0]).toBe('VTSAX')
      expect(onError.mock.calls[0][1]).toMatch(/rate limited/i)
      expect(await getTickerOverview('VTSAX')).toBeNull()
    })

    it('rate limit on one symbol does not starve the rest of the run', async () => {
      const fetchMock = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('VTSAX')) return jsonResponse({ Note: 'Thank you for using Alpha Vantage...' })
        if (url.includes('function=SYMBOL_SEARCH')) {
          return jsonResponse({
            bestMatches: [{ '1. symbol': 'VBTLX', '2. name': 'Vanguard Total Bond Market Index Fund' }],
          })
        }
        return jsonResponse({ 'Time Series (Daily)': { '2026-08-21': { '4. close': '55.55' } } })
      })
      vi.stubGlobal('fetch', fetchMock)
      const dispatch = vi.fn()
      const onError = vi.fn()
      const sleep = vi.fn().mockResolvedValue(undefined)

      const { patch } = await runMutualFundSync(
        makeMutualFundSync(),
        ['VTSAX', 'VBTLX'],
        [makePosition('VTSAX'), makePosition('VBTLX')],
        dispatch,
        onError,
        undefined,
        sleep
      )

      // VTSAX's rate limit consumed exactly one budget unit and didn't block
      // VBTLX from being fetched (name + price) in the same run.
      expect(await getTickerOverview('VBTLX')).toMatchObject({ name: 'Vanguard Total Bond Market Index Fund' })
      expect(patch.heldPrices.VBTLX).toMatchObject({ price: 55.55 })
    })

    it('daily cap enforcement: stops mid-run, resumes from persisted callBudget on a simulated reload', async () => {
      const fetchMock = makeSuccessFetchMock()
      vi.stubGlobal('fetch', fetchMock)
      const dispatch = vi.fn()
      const onError = vi.fn()
      const sleep = vi.fn().mockResolvedValue(undefined)

      const positions = [makePosition('VTSAX'), makePosition('VBTLX')]
      const state = makeMutualFundSync({ callBudget: { date: today, callsUsed: 24 } })

      const first = await runMutualFundSync(
        state,
        ['VTSAX', 'VBTLX'],
        positions,
        dispatch,
        onError,
        undefined,
        sleep
      )

      expect(first.patch.callBudget.callsUsed).toBe(ALPHAVANTAGE_DAILY_CALL_CAP)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(first.pendingCount).toBeGreaterThan(0)

      // Simulate a page reload: persisted callBudget from the first run is
      // fed back in as the new starting state, same calendar day.
      fetchMock.mockClear()
      const second = await runMutualFundSync(
        makeMutualFundSync({ callBudget: first.patch.callBudget, heldPrices: first.patch.heldPrices }),
        ['VTSAX', 'VBTLX'],
        positions,
        dispatch,
        onError,
        undefined,
        sleep
      )

      // Budget was NOT reset to 0 on "reload" — it stayed at/above the cap
      // reached in the first run, so no further calls could fire.
      expect(second.patch.callBudget.callsUsed).toBeGreaterThanOrEqual(ALPHAVANTAGE_DAILY_CALL_CAP)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('calendar rollover: stale callBudget.date resets callsUsed to 0 and proceeds normally', async () => {
      const fetchMock = makeSuccessFetchMock()
      vi.stubGlobal('fetch', fetchMock)
      const dispatch = vi.fn()
      const onError = vi.fn()
      const sleep = vi.fn().mockResolvedValue(undefined)

      const state = makeMutualFundSync({ callBudget: { date: '2000-01-01', callsUsed: 25 } })

      const { patch } = await runMutualFundSync(
        state,
        ['VTSAX'],
        [makePosition('VTSAX')],
        dispatch,
        onError,
        undefined,
        sleep
      )

      expect(fetchMock).toHaveBeenCalled()
      expect(patch.callBudget.date).toBe(today)
      expect(patch.callBudget.callsUsed).toBeGreaterThan(0)
      expect(patch.callBudget.callsUsed).toBeLessThanOrEqual(ALPHAVANTAGE_DAILY_CALL_CAP)
    })

    it('budget exhausted mid-run: pendingCount counts all symbols still needing a fresh price', async () => {
      const fetchMock = makeSuccessFetchMock()
      vi.stubGlobal('fetch', fetchMock)
      const dispatch = vi.fn()
      const onError = vi.fn()
      const sleep = vi.fn().mockResolvedValue(undefined)

      const symbols = ['VTSAX', 'VBTLX', 'VGTSX']
      const positions = symbols.map((s) => makePosition(s))
      // Only 1 more call can fire before hitting the cap.
      const state = makeMutualFundSync({ callBudget: { date: today, callsUsed: ALPHAVANTAGE_DAILY_CALL_CAP - 1 } })

      const { pendingCount } = await runMutualFundSync(state, symbols, positions, dispatch, onError, undefined, sleep)

      expect(pendingCount).toBe(3)
    })

    it('never mutates Position.price: dispatched patches only ever contain name', async () => {
      const fetchMock = makeSuccessFetchMock()
      vi.stubGlobal('fetch', fetchMock)
      const dispatch = vi.fn()
      const onError = vi.fn()
      const sleep = vi.fn().mockResolvedValue(undefined)

      const state = makeMutualFundSync()

      await runMutualFundSync(state, ['VTSAX'], [makePosition('VTSAX')], dispatch, onError, undefined, sleep)

      expect(dispatch).toHaveBeenCalled()
      for (const call of dispatch.mock.calls) {
        const action = call[0]
        expect(action.patch).not.toHaveProperty('price')
      }
    })
  })
})
