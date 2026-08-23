/**
 * Plain (unencrypted) local IndexedDB cache for daily market data bars.
 * Separate from the app's main persisted state (persist.ts) and from Drive backup.
 */

const DB_NAME = 'portfolio_market_data_v1'
const STORE_NAME = 'daily_bars'
const OVERVIEW_STORE_NAME = 'ticker_overviews'
const DB_VERSION = 2

export interface DailyBar {
  ticker: string
  close: number
  high: number
  low: number
  date: string
  t: number
}

export interface TickerOverview {
  ticker: string
  name: string
  sicDescription: string
  fetchedAt: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
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
}

export async function getCachedBar(ticker: string): Promise<DailyBar | null> {
  const db = await openDb()
  try {
    return await new Promise<DailyBar | null>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(ticker)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve((request.result as DailyBar | undefined) ?? null)
    })
  } finally {
    db.close()
  }
}

export async function getAllBars(): Promise<DailyBar[]> {
  const db = await openDb()
  try {
    return await new Promise<DailyBar[]>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.getAll()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result as DailyBar[])
    })
  } finally {
    db.close()
  }
}

export async function putBars(bars: DailyBar[]): Promise<void> {
  if (bars.length === 0) return

  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      transaction.onerror = () => reject(transaction.error)
      transaction.oncomplete = () => resolve()
      for (const bar of bars) {
        store.put(bar)
      }
    })
  } finally {
    db.close()
  }
}

export async function getTickerOverview(ticker: string): Promise<TickerOverview | null> {
  const db = await openDb()
  try {
    return await new Promise<TickerOverview | null>((resolve, reject) => {
      const transaction = db.transaction(OVERVIEW_STORE_NAME, 'readonly')
      const store = transaction.objectStore(OVERVIEW_STORE_NAME)
      const request = store.get(ticker)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve((request.result as TickerOverview | undefined) ?? null)
    })
  } finally {
    db.close()
  }
}

export async function putTickerOverview(overview: TickerOverview): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(OVERVIEW_STORE_NAME, 'readwrite')
      const store = transaction.objectStore(OVERVIEW_STORE_NAME)
      transaction.onerror = () => reject(transaction.error)
      transaction.oncomplete = () => resolve()
      store.put(overview)
    })
  } finally {
    db.close()
  }
}

export async function getAllTickerOverviews(): Promise<TickerOverview[]> {
  const db = await openDb()
  try {
    return await new Promise<TickerOverview[]>((resolve, reject) => {
      const transaction = db.transaction(OVERVIEW_STORE_NAME, 'readonly')
      const store = transaction.objectStore(OVERVIEW_STORE_NAME)
      const request = store.getAll()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result as TickerOverview[])
    })
  } finally {
    db.close()
  }
}

export async function clearAll(): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.clear()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } finally {
    db.close()
  }
}
