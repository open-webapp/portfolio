import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { getCachedBar, putBars, clearAll, type DailyBar } from './marketDataDb'

const DB_NAME = 'portfolio_market_data_v1'
const STORE_NAME = 'daily_bars'

describe('marketDataDb', () => {
  // Note: fake-indexeddb requires explicit cleanup between tests
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

  beforeEach(async () => {
    await clearDatabase()
  })

  it('putBars then getCachedBar returns the stored row', async () => {
    const bar: DailyBar = { ticker: 'AAPL', close: 190, high: 191, low: 189, date: '2026-08-21' }
    await putBars([bar])

    const result = await getCachedBar('AAPL')

    expect(result).toEqual(bar)
  })

  it('overwrites previous data for the same ticker on second putBars call', async () => {
    await putBars([{ ticker: 'AAPL', close: 190, high: 191, low: 189, date: '2026-08-21' }])
    await putBars([{ ticker: 'AAPL', close: 200, high: 201, low: 199, date: '2026-08-22' }])

    const result = await getCachedBar('AAPL')

    expect(result).toEqual({ ticker: 'AAPL', close: 200, high: 201, low: 199, date: '2026-08-22' })
  })

  it('getCachedBar returns null for a ticker never written', async () => {
    const result = await getCachedBar('NOPE')

    expect(result).toBeNull()
  })

  it('putBars with an empty array is a no-op and does not throw', async () => {
    await expect(putBars([])).resolves.toBeUndefined()
  })

  it('clearAll removes previously written rows', async () => {
    await putBars([{ ticker: 'AAPL', close: 190, high: 191, low: 189, date: '2026-08-21' }])

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
    }))

    await putBars(bars)

    for (const bar of bars) {
      const result = await getCachedBar(bar.ticker)
      expect(result).toEqual(bar)
    }
  })
})
