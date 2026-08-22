import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import {
  nextBusinessDay,
  seedLastFetchedDate,
  fetchGroupedDailyBars,
  runPriceSync,
} from './priceSync'
import { getCachedBar } from './marketDataDb'
import type { PriceSyncState } from './types'

const DB_NAME = 'portfolio_market_data_v1'
const STORE_NAME = 'daily_bars'

async function clearDatabase() {
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'ticker' })
        }
      }
    })

    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    await new Promise<void>((resolve, reject) => {
      const request = store.clear()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
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

describe('priceSync', () => {
  beforeEach(async () => {
    await clearDatabase()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('nextBusinessDay', () => {
    it('skips Sat/Sun: Friday -> Monday', () => {
      expect(nextBusinessDay('2026-08-21')).toBe('2026-08-24')
    })

    it('no skip needed: Thursday -> Friday', () => {
      expect(nextBusinessDay('2026-08-20')).toBe('2026-08-21')
    })
  })

  describe('seedLastFetchedDate', () => {
    it('returns prior business day for a known mocked today', () => {
      // 2026-08-24 is a Monday -> prior business day is Friday 2026-08-21
      const today = new Date(Date.UTC(2026, 7, 24))
      expect(seedLastFetchedDate(today)).toBe('2026-08-21')
    })
  })

  describe('fetchGroupedDailyBars', () => {
    it('happy path returns results array unchanged', async () => {
      const results = [{ T: 'AAPL', c: 190, h: 191, l: 189 }]
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ results })))

      const out = await fetchGroupedDailyBars('2026-08-21', 'key')

      expect(out).toEqual(results)
    })

    it('non-2xx response returns null', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 500)))

      const out = await fetchGroupedDailyBars('2026-08-21', 'key')

      expect(out).toBeNull()
    })

    it('network error returns null without throwing', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

      await expect(fetchGroupedDailyBars('2026-08-21', 'key')).resolves.toBeNull()
    })

    it('malformed response (results missing) returns null', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ status: 'OK' })))

      const out = await fetchGroupedDailyBars('2026-08-21', 'key')

      expect(out).toBeNull()
    })

    it('malformed response (results not an array) returns null', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ results: 'nope' })))

      const out = await fetchGroupedDailyBars('2026-08-21', 'key')

      expect(out).toBeNull()
    })

    it('empty results array returns [] (distinct from null)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ results: [] })))

      const out = await fetchGroupedDailyBars('2026-08-21', 'key')

      expect(out).toEqual([])
    })
  })

  describe('runPriceSync', () => {
    it('no-ops when apiKey is empty', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      const priceSync: PriceSyncState = {
        apiKey: '',
        lastFetchedDate: '2026-08-20',
        heldPrices: {},
        lastRun: null,
      }

      const { patch, updatedPrices } = await runPriceSync(priceSync, ['AAPL'])

      expect(fetchMock).not.toHaveBeenCalled()
      expect(patch.lastRun.updatedCount).toBe(0)
      expect(patch.lastFetchedDate).toBeUndefined()
      expect(patch.heldPrices).toBeUndefined()
      expect(updatedPrices).toEqual({})
    })

    it('happy path updates found symbol, reports not-found, writes all bars to marketDataDb', async () => {
      const results = [
        { T: 'AAPL', c: 195.5, h: 196, l: 194, T2: undefined },
        { T: 'GOOG', c: 150, h: 151, l: 149 },
      ]
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ results })))

      const priceSync: PriceSyncState = {
        apiKey: 'key',
        lastFetchedDate: '2026-08-20',
        heldPrices: {},
        lastRun: null,
      }

      const { patch, updatedPrices } = await runPriceSync(priceSync, ['AAPL', 'MSFT'])

      expect(patch.lastFetchedDate).toBe('2026-08-21')
      expect(patch.heldPrices?.AAPL).toEqual({
        price: 195.5,
        date: '2026-08-21',
        fetchedAt: expect.any(String),
      })
      expect(patch.lastRun.updatedCount).toBe(1)
      expect(patch.lastRun.notFound).toEqual(['MSFT'])
      expect(patch.lastRun.at).toEqual(expect.any(String))
      expect(updatedPrices).toEqual({ AAPL: 195.5 })

      // ALL bars from the response were written, not just held symbols
      const aapl = await getCachedBar('AAPL')
      const goog = await getCachedBar('GOOG')
      expect(aapl).toEqual({ ticker: 'AAPL', close: 195.5, high: 196, low: 194, date: '2026-08-21' })
      expect(goog).toEqual({ ticker: 'GOOG', close: 150, high: 151, low: 149, date: '2026-08-21' })
    })

    it('empty/error response leaves lastFetchedDate/heldPrices unchanged, all symbols not found', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ results: [] })))

      const priceSync: PriceSyncState = {
        apiKey: 'key',
        lastFetchedDate: '2026-08-20',
        heldPrices: { XYZ: { price: 1, date: '2026-08-19', fetchedAt: 'x' } },
        lastRun: null,
      }

      const { patch, updatedPrices } = await runPriceSync(priceSync, ['AAPL', 'MSFT'])

      expect(patch.lastFetchedDate).toBeUndefined()
      expect(patch.heldPrices).toBeUndefined()
      expect(patch.lastRun.updatedCount).toBe(0)
      expect(patch.lastRun.notFound).toEqual(['AAPL', 'MSFT'])
      expect(updatedPrices).toEqual({})
    })

    it('first-ever run (lastFetchedDate null) requests next business day after seeded "today"', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [] }))
      vi.stubGlobal('fetch', fetchMock)

      const priceSync: PriceSyncState = {
        apiKey: 'key',
        lastFetchedDate: null,
        heldPrices: {},
        lastRun: null,
      }

      await runPriceSync(priceSync, ['AAPL'])

      const expectedDate = nextBusinessDay(seedLastFetchedDate())
      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain(`/${expectedDate}?`)
    })
  })
})
