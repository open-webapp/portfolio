import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import {
  fetchTickerOverview,
  syncTickerOverviews,
  REQUEST_SPACING_MS,
  RATE_LIMIT_BACKOFF_MS,
  TickerOverviewNotFoundError,
} from './tickerOverview'
import { getTickerOverview, putTickerOverview } from './marketDataDb'
import type { Position } from './types'

/** No-op sleep for tests: resolves immediately but still records timing calls,
 *  so tests never wait out the real REQUEST_SPACING_MS/RATE_LIMIT_BACKOFF_MS delays. */
function fastSleep() {
  return vi.fn().mockResolvedValue(undefined)
}

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

function makePosition(overrides: Partial<Position>): Position {
  return {
    id: 'pos-1',
    accountId: 'acct-1',
    symbol: 'AAPL',
    name: null,
    assetClass: 'Equity',
    shares: 10,
    avgCost: 100,
    price: 190,
    lastImportedAt: '2026-08-22T00:00:00.000Z',
    ...overrides,
  }
}

describe('tickerOverview', () => {
  beforeEach(async () => {
    await clearDatabase()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('fetchTickerOverview', () => {
    it('happy path returns mapped name + sicDescription', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse({ results: { name: 'Apple Inc.', sic_description: 'Electronic Computers' } })
        )
      )

      const result = await fetchTickerOverview('AAPL', 'key')

      expect(result).toEqual({ name: 'Apple Inc.', sicDescription: 'Electronic Computers' })
    })

    it('non-2xx response throws', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 403)))

      await expect(fetchTickerOverview('AAPL', 'key')).rejects.toThrow()
    })

    it('network error throws', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

      await expect(fetchTickerOverview('AAPL', 'key')).rejects.toThrow()
    })

    it('malformed response (missing results.name) throws', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ results: { sic_description: 'Electronic Computers' } }))
      )

      await expect(fetchTickerOverview('AAPL', 'key')).rejects.toThrow()
    })

    it('ETF response missing sic_description (e.g. SCHD) does not throw, defaults sicDescription to empty string', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse({
            request_id: 'e86e497b16bac0cbe538a39989d308ff',
            results: {
              ticker: 'SCHD',
              name: 'Schwab US Dividend Equity ETF',
              market: 'stocks',
              locale: 'us',
              primary_exchange: 'ARCX',
              type: 'ETF',
              active: true,
              currency_name: 'usd',
              cik: '0001454889',
              composite_figi: 'BBG0025RWKW5',
              share_class_figi: 'BBG0025RWLM4',
              ticker_root: 'SCHD',
              list_date: '2011-10-20',
              share_class_shares_outstanding: 3184200000,
              round_lot: 100,
            },
            status: 'OK',
          })
        )
      )

      const result = await fetchTickerOverview('SCHD', 'key')

      expect(result).toEqual({ name: 'Schwab US Dividend Equity ETF', sicDescription: '' })
    })

    it('status NOT_FOUND throws TickerOverviewNotFoundError', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse({
            status: 'NOT_FOUND',
            request_id: '9277c7578bd29619724469ab42b87ca5',
            message: 'Ticker not found.',
          })
        )
      )

      await expect(fetchTickerOverview('BOGUS', 'key')).rejects.toThrow(TickerOverviewNotFoundError)
    })

    it('status NOT_FOUND on a non-2xx HTTP response still throws TickerOverviewNotFoundError, not a generic Error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse(
            {
              status: 'NOT_FOUND',
              request_id: '9277c7578bd29619724469ab42b87ca5',
              message: 'Ticker not found.',
            },
            false,
            404
          )
        )
      )

      await expect(fetchTickerOverview('BOGUS', 'key')).rejects.toThrow(TickerOverviewNotFoundError)
    })
  })

  describe('syncTickerOverviews', () => {
    it('cache hit: does not refetch, does not dispatch, does not error', async () => {
      await putTickerOverview({
        ticker: 'AAPL',
        name: 'Apple Inc.',
        sicDescription: 'Electronic Computers',
        fetchedAt: '2026-08-22T00:00:00.000Z',
      })
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const dispatch = vi.fn()
      const onError = vi.fn()

      await syncTickerOverviews(['AAPL'], 'key', [makePosition({})], dispatch, onError)

      expect(fetchMock).not.toHaveBeenCalled()
      expect(dispatch).not.toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
    })

    it('cache miss: fetches, caches, dispatches UPDATE_POSITION for every matching position, calls onSuccess', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse({ results: { name: 'Apple Inc.', sic_description: 'Electronic Computers' } })
        )
      )
      const dispatch = vi.fn()
      const onError = vi.fn()
      const onSuccess = vi.fn()
      const positions = [
        makePosition({ id: 'pos-1', accountId: 'acct-1', symbol: 'AAPL' }),
        makePosition({ id: 'pos-2', accountId: 'acct-2', symbol: 'AAPL' }),
      ]

      await syncTickerOverviews(['AAPL'], 'key', positions, dispatch, onError, onSuccess)

      const cached = await getTickerOverview('AAPL')
      expect(cached).toMatchObject({
        ticker: 'AAPL',
        name: 'Apple Inc.',
        sicDescription: 'Electronic Computers',
      })
      expect(dispatch).toHaveBeenCalledTimes(2)
      expect(dispatch).toHaveBeenCalledWith({
        type: 'UPDATE_POSITION',
        positionId: 'pos-1',
        patch: { name: 'Apple Inc.' },
      })
      expect(dispatch).toHaveBeenCalledWith({
        type: 'UPDATE_POSITION',
        positionId: 'pos-2',
        patch: { name: 'Apple Inc.' },
      })
      expect(onError).not.toHaveBeenCalled()
      expect(onSuccess).toHaveBeenCalledWith('AAPL')
    })

    it('failure handling: reports onError, does not dispatch, does not cache, no priceSync-related dispatch', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
      const dispatch = vi.fn()
      const onError = vi.fn()

      await syncTickerOverviews(['AAPL'], 'key', [makePosition({})], dispatch, onError)

      expect(onError).toHaveBeenCalledWith('AAPL', expect.any(String))
      expect(dispatch).not.toHaveBeenCalled()
      const cached = await getTickerOverview('AAPL')
      expect(cached).toBeNull()

      const dispatchedTypes = dispatch.mock.calls.map((call) => call[0]?.type)
      expect(dispatchedTypes).not.toContain('RECORD_PRICE_SYNC_RUN')
      expect(dispatchedTypes.some((t) => typeof t === 'string' && /priceSync/i.test(t))).toBe(false)
    })

    it('429 rate limit: backs off and retries the same ticker on a timer until it succeeds', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({}, false, 429))
        .mockResolvedValueOnce(jsonResponse({}, false, 429))
        .mockResolvedValueOnce(
          jsonResponse({ results: { name: 'Apple Inc.', sic_description: 'Electronic Computers' } })
        )
      vi.stubGlobal('fetch', fetchMock)
      const dispatch = vi.fn()
      const onError = vi.fn()
      const onSuccess = vi.fn()
      const sleep = fastSleep()

      await syncTickerOverviews(['AAPL'], 'key', [makePosition({})], dispatch, onError, onSuccess, sleep)

      // Retried the same ticker across both 429s until the third attempt succeeded.
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(onError).toHaveBeenCalledTimes(2)
      expect(onError).toHaveBeenNthCalledWith(1, 'AAPL', expect.stringMatching(/429/))
      expect(onSuccess).toHaveBeenCalledWith('AAPL')
      const cached = await getTickerOverview('AAPL')
      expect(cached).toMatchObject({ ticker: 'AAPL', name: 'Apple Inc.' })

      // Backed off a full rate-limit window before each retry, not the tight
      // between-ticker spacing.
      expect(sleep).toHaveBeenCalledTimes(2)
      expect(sleep).toHaveBeenCalledWith(RATE_LIMIT_BACKOFF_MS)
    })

    it('paces successive tickers by REQUEST_SPACING_MS to stay under the rate limit proactively', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({ results: { name: 'Corp.', sic_description: 'Widgets' } })
      )
      vi.stubGlobal('fetch', fetchMock)
      const dispatch = vi.fn()
      const onError = vi.fn()
      const sleep = fastSleep()
      const positions = [makePosition({ id: 'pos-a', symbol: 'AAA' }), makePosition({ id: 'pos-b', symbol: 'BBB' })]

      await syncTickerOverviews(['AAA', 'BBB'], 'key', positions, dispatch, onError, undefined, sleep)

      expect(fetchMock).toHaveBeenCalledTimes(2)
      // One spacing sleep between the two tickers, none before the first.
      expect(sleep).toHaveBeenCalledTimes(1)
      expect(sleep).toHaveBeenCalledWith(REQUEST_SPACING_MS)
      expect(onError).not.toHaveBeenCalled()
    })

    it('NOT_FOUND: caches a notFound marker, reports onError once, does not dispatch, and does not retry on a later call', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({ status: 'NOT_FOUND', message: 'Ticker not found.' })
      )
      vi.stubGlobal('fetch', fetchMock)
      const dispatch = vi.fn()
      const onError = vi.fn()
      const onSuccess = vi.fn()

      await syncTickerOverviews(['BOGUS'], 'key', [makePosition({ symbol: 'BOGUS' })], dispatch, onError, onSuccess)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith('BOGUS', expect.any(String))
      expect(onSuccess).not.toHaveBeenCalled()
      expect(dispatch).not.toHaveBeenCalled()
      const cached = await getTickerOverview('BOGUS')
      expect(cached).toMatchObject({ ticker: 'BOGUS', notFound: true })

      // A later call must skip it entirely (cache hit) rather than refetching.
      fetchMock.mockClear()
      onError.mockClear()
      await syncTickerOverviews(['BOGUS'], 'key', [makePosition({ symbol: 'BOGUS' })], dispatch, onError, onSuccess)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
    })

    it('handles multiple symbols with mixed cache-hit/cache-miss/failure independently', async () => {
      await putTickerOverview({
        ticker: 'CACHED',
        name: 'Cached Co.',
        sicDescription: 'Something',
        fetchedAt: '2026-08-22T00:00:00.000Z',
      })

      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/OK')) {
          return Promise.resolve(
            jsonResponse({ results: { name: 'OK Corp.', sic_description: 'Widgets' } })
          )
        }
        if (url.includes('/FAIL')) {
          return Promise.reject(new Error('boom'))
        }
        return Promise.resolve(jsonResponse({}, false, 500))
      })
      vi.stubGlobal('fetch', fetchMock)

      const dispatch = vi.fn()
      const onError = vi.fn()
      const onSuccess = vi.fn()
      const positions = [
        makePosition({ id: 'pos-ok', symbol: 'OK' }),
        makePosition({ id: 'pos-fail', symbol: 'FAIL' }),
        makePosition({ id: 'pos-cached', symbol: 'CACHED' }),
      ]

      await syncTickerOverviews(['CACHED', 'OK', 'FAIL'], 'key', positions, dispatch, onError, onSuccess, fastSleep())

      // cached ticker: no fetch, no dispatch for it
      expect(fetchMock).toHaveBeenCalledTimes(2)

      // OK ticker succeeded
      expect(dispatch).toHaveBeenCalledWith({
        type: 'UPDATE_POSITION',
        positionId: 'pos-ok',
        patch: { name: 'OK Corp.' },
      })
      expect(onSuccess).toHaveBeenCalledWith('OK')
      const okCached = await getTickerOverview('OK')
      expect(okCached).toMatchObject({ ticker: 'OK', name: 'OK Corp.' })

      // FAIL ticker errored, did not block processing of OK
      expect(onError).toHaveBeenCalledWith('FAIL', expect.any(String))
      const failCached = await getTickerOverview('FAIL')
      expect(failCached).toBeNull()

      // dispatch only called once total (for OK), never for FAIL or CACHED
      expect(dispatch).toHaveBeenCalledTimes(1)
    })
  })
})
