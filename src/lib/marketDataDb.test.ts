import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import {
  getCachedBar,
  putBars,
  clearAll,
  getTickerOverview,
  putTickerOverview,
  getAllTickerOverviews,
  type DailyBar,
  type TickerOverview,
} from './marketDataDb'

const DB_NAME = 'portfolio_market_data_v1'
const STORE_NAME = 'daily_bars'
const OVERVIEW_STORE_NAME = 'ticker_overviews'

describe('marketDataDb', () => {
  // Note: fake-indexeddb requires explicit cleanup between tests
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

  beforeEach(async () => {
    await clearDatabase()
  })

  it('putBars then getCachedBar returns the stored row', async () => {
    const bar: DailyBar = { ticker: 'AAPL', close: 190, high: 191, low: 189, date: '2026-08-21', t: 1755806400000 }
    await putBars([bar])

    const result = await getCachedBar('AAPL')

    expect(result).toEqual(bar)
  })

  it('overwrites previous data for the same ticker on second putBars call', async () => {
    await putBars([{ ticker: 'AAPL', close: 190, high: 191, low: 189, date: '2026-08-21', t: 1755806400000 }])
    await putBars([{ ticker: 'AAPL', close: 200, high: 201, low: 199, date: '2026-08-22', t: 1755892800000 }])

    const result = await getCachedBar('AAPL')

    expect(result).toEqual({ ticker: 'AAPL', close: 200, high: 201, low: 199, date: '2026-08-22', t: 1755892800000 })
  })

  it('getCachedBar returns null for a ticker never written', async () => {
    const result = await getCachedBar('NOPE')

    expect(result).toBeNull()
  })

  it('putBars with an empty array is a no-op and does not throw', async () => {
    await expect(putBars([])).resolves.toBeUndefined()
  })

  it('clearAll removes previously written rows', async () => {
    await putBars([{ ticker: 'AAPL', close: 190, high: 191, low: 189, date: '2026-08-21', t: 1755806400000 }])

    await clearAll()

    const result = await getCachedBar('AAPL')
    expect(result).toBeNull()
  })

  it('bulk write of 500+ entries succeeds and all are individually retrievable', async () => {
    const bars: DailyBar[] = Array.from({ length: 500 }, (_, i) => ({
      ticker: `TICK${i}`,
      close: 100 + i,
      high: 101 + i,
      low: 99 + i,
      date: '2026-08-21',
      t: 1755806400000 + i,
    }))

    await putBars(bars)

    for (const bar of bars) {
      const result = await getCachedBar(bar.ticker)
      expect(result).toEqual(bar)
    }
  })

  it('putTickerOverview then getTickerOverview returns the stored row', async () => {
    const overview: TickerOverview = {
      ticker: 'AAPL',
      name: 'Apple Inc.',
      sicDescription: 'Electronic Computers',
      fetchedAt: '2026-08-22T00:00:00.000Z',
    }
    await putTickerOverview(overview)

    const result = await getTickerOverview('AAPL')

    expect(result).toEqual(overview)
  })

  it('overwrites previous data for the same ticker on second putTickerOverview call', async () => {
    await putTickerOverview({
      ticker: 'AAPL',
      name: 'Apple Inc.',
      sicDescription: 'Electronic Computers',
      fetchedAt: '2026-08-22T00:00:00.000Z',
    })
    await putTickerOverview({
      ticker: 'AAPL',
      name: 'Apple Incorporated',
      sicDescription: 'Computer Hardware',
      fetchedAt: '2026-08-22T12:00:00.000Z',
    })

    const result = await getTickerOverview('AAPL')

    expect(result).toEqual({
      ticker: 'AAPL',
      name: 'Apple Incorporated',
      sicDescription: 'Computer Hardware',
      fetchedAt: '2026-08-22T12:00:00.000Z',
    })
  })

  it('getTickerOverview returns null for a ticker never written', async () => {
    const result = await getTickerOverview('NOPE')

    expect(result).toBeNull()
  })

  it('getAllTickerOverviews returns all written overviews', async () => {
    const aapl: TickerOverview = {
      ticker: 'AAPL',
      name: 'Apple Inc.',
      sicDescription: 'Electronic Computers',
      fetchedAt: '2026-08-22T00:00:00.000Z',
    }
    const msft: TickerOverview = {
      ticker: 'MSFT',
      name: 'Microsoft Corporation',
      sicDescription: 'Prepackaged Software',
      fetchedAt: '2026-08-22T00:00:00.000Z',
    }
    await putTickerOverview(aapl)
    await putTickerOverview(msft)

    const result = await getAllTickerOverviews()

    expect(result).toHaveLength(2)
    expect(result).toEqual(expect.arrayContaining([aapl, msft]))
  })

  it('daily_bars and ticker_overviews stores do not cross-contaminate', async () => {
    await putBars([{ ticker: 'AAPL', close: 190, high: 191, low: 189, date: '2026-08-21', t: 1755806400000 }])
    await putTickerOverview({
      ticker: 'AAPL',
      name: 'Apple Inc.',
      sicDescription: 'Electronic Computers',
      fetchedAt: '2026-08-22T00:00:00.000Z',
    })

    const bar = await getCachedBar('AAPL')
    const overview = await getTickerOverview('AAPL')

    expect(bar).toEqual({ ticker: 'AAPL', close: 190, high: 191, low: 189, date: '2026-08-21', t: 1755806400000 })
    expect(overview).toEqual({
      ticker: 'AAPL',
      name: 'Apple Inc.',
      sicDescription: 'Electronic Computers',
      fetchedAt: '2026-08-22T00:00:00.000Z',
    })
    expect(bar).not.toHaveProperty('name')
    expect(overview).not.toHaveProperty('close')
  })
})
