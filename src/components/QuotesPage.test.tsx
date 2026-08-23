import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QuotesPage } from './QuotesPage'
import { initialState, type AppState } from '../lib/state'
import type { Position } from '../lib/types'

const { getAllBarsMock, getAllTickerOverviewsMock } = vi.hoisted(() => ({
  getAllBarsMock: vi.fn(),
  getAllTickerOverviewsMock: vi.fn(),
}))

vi.mock('../lib/marketDataDb', () => ({
  getAllBars: getAllBarsMock,
  getAllTickerOverviews: getAllTickerOverviewsMock,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: overrides.id ?? `pos-${Math.random()}`,
    accountId: overrides.accountId ?? 'acc-1',
    symbol: overrides.symbol ?? 'AAPL',
    name: overrides.name ?? null,
    assetClass: overrides.assetClass ?? 'Equity',
    shares: overrides.shares ?? 10,
    avgCost: overrides.avgCost ?? 100,
    price: overrides.price ?? 150,
    lastImportedAt: overrides.lastImportedAt ?? '2024-01-01',
    ...overrides,
  }
}

async function renderQuotesPage(state: AppState, tickerOverviewErrors: Record<string, string> = {}) {
  const utils = render(<QuotesPage state={state} dispatch={vi.fn()} tickerOverviewErrors={tickerOverviewErrors} />)
  await waitFor(() => expect(getAllBarsMock).toHaveBeenCalled())
  return utils
}

describe('QuotesPage', () => {
  it('shows "No holdings to show." and no search/table when there are no held Equity/ETF positions', async () => {
    getAllBarsMock.mockResolvedValue([])
    getAllTickerOverviewsMock.mockResolvedValue([])
    const state = initialState()

    render(<QuotesPage state={state} dispatch={vi.fn()} tickerOverviewErrors={{}} />)

    expect(screen.getByText('No holdings to show.')).toBeTruthy()
    expect(screen.queryByPlaceholderText(/Search ticker/)).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('dedups same symbol across accounts, excludes non-Equity/ETF asset classes, and excludes not-currently-held symbols', async () => {
    getAllBarsMock.mockResolvedValue([])
    getAllTickerOverviewsMock.mockResolvedValue([])
    const state = initialState()
    state.positions.push(
      makePosition({ id: 'p1', accountId: 'acc-1', symbol: 'AAPL', assetClass: 'Equity' }),
      makePosition({ id: 'p2', accountId: 'acc-2', symbol: 'AAPL', assetClass: 'Equity' }),
      makePosition({ id: 'p3', accountId: 'acc-1', symbol: 'BND', assetClass: 'Fixed Income' }),
    )
    state.priceSync.lastRun = {
      at: '2024-01-01T00:00:00.000Z',
      updatedCount: 0,
      notFound: ['GHOST'],
      marketTickerCount: 100,
    }

    await renderQuotesPage(state)

    const table = screen.getByRole('table')
    const rows = table.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(1)
    expect(screen.getByText('AAPL')).toBeTruthy()
    expect(screen.queryByText('BND')).toBeNull()
    expect(screen.queryByText('GHOST')).toBeNull()
  })

  it('renders all columns with expected values from priceSync, bar cache, and overview cache', async () => {
    getAllBarsMock.mockResolvedValue([
      { ticker: 'AAPL', close: 190.5, high: 191, low: 189, date: '2026-08-21', t: 1755806400000 },
    ])
    getAllTickerOverviewsMock.mockResolvedValue([
      { ticker: 'AAPL', name: 'Apple Inc.', sicDescription: 'Electronic Computers', fetchedAt: '2026-08-21T00:00:00.000Z' },
    ])
    const state = initialState()
    state.positions.push(makePosition({ id: 'p1', accountId: 'acc-1', symbol: 'AAPL', assetClass: 'Equity' }))
    state.priceSync.heldPrices.AAPL = { price: 190.5, date: '2026-08-21', fetchedAt: '2026-08-21T00:00:00.000Z' }

    await renderQuotesPage(state)

    const table = screen.getByRole('table')
    const row = table.querySelector('tbody tr')!
    const cells = Array.from(row.querySelectorAll('td')).map((td) => td.textContent)

    const expectedLastUpdated = new Date(1755806400000).toISOString().slice(0, 19).replace('T', ' ') + ' UTC'

    expect(cells).toEqual([
      'AAPL',
      'Equity',
      'Apple Inc.',
      'OK',
      '$190.50',
      'Yes',
      expectedLastUpdated,
      'Electronic Computers',
    ])
  })

  it('renders "—" for Last Updated instead of crashing when the cached bar has a missing/invalid timestamp', async () => {
    getAllBarsMock.mockResolvedValue([
      { ticker: 'AAPL', close: 190.5, high: 191, low: 189, date: '2026-08-21', t: undefined },
    ])
    getAllTickerOverviewsMock.mockResolvedValue([])
    const state = initialState()
    state.positions.push(makePosition({ id: 'p1', symbol: 'AAPL', assetClass: 'Equity' }))

    await renderQuotesPage(state)

    const table = screen.getByRole('table')
    const row = table.querySelector('tbody tr')!
    const cells = Array.from(row.querySelectorAll('td')).map((td) => td.textContent)
    expect(cells[6]).toBe('—')
  })

  it('shows "Not found" status with Price "—" when symbol is in notFound and has no heldPrices entry', async () => {
    getAllBarsMock.mockResolvedValue([])
    getAllTickerOverviewsMock.mockResolvedValue([])
    const state = initialState()
    state.positions.push(makePosition({ id: 'p1', symbol: 'AAPL', assetClass: 'Equity' }))
    state.priceSync.lastRun = {
      at: '2024-01-01T00:00:00.000Z',
      updatedCount: 0,
      notFound: ['AAPL'],
      marketTickerCount: 100,
    }

    await renderQuotesPage(state)

    const table = screen.getByRole('table')
    const row = table.querySelector('tbody tr')!
    const cells = Array.from(row.querySelectorAll('td')).map((td) => td.textContent)
    expect(cells[0]).toBe('AAPL')
    expect(cells[3]).toBe('Not found')
    expect(cells[4]).toBe('—')
  })

  it('shows "Not found" status but still shows the stale price when a stale heldPrices entry exists despite being in notFound', async () => {
    getAllBarsMock.mockResolvedValue([])
    getAllTickerOverviewsMock.mockResolvedValue([])
    const state = initialState()
    state.positions.push(makePosition({ id: 'p1', symbol: 'AAPL', assetClass: 'Equity' }))
    state.priceSync.heldPrices.AAPL = { price: 180.25, date: '2024-01-01', fetchedAt: '2024-01-01T00:00:00.000Z' }
    state.priceSync.lastRun = {
      at: '2024-01-02T00:00:00.000Z',
      updatedCount: 0,
      notFound: ['AAPL'],
      marketTickerCount: 100,
    }

    await renderQuotesPage(state)

    const table = screen.getByRole('table')
    const row = table.querySelector('tbody tr')!
    const cells = Array.from(row.querySelectorAll('td')).map((td) => td.textContent)
    expect(cells[3]).toBe('Not found')
    expect(cells[4]).toBe('$180.25')
  })

  it('shows "Not found" status for a never-synced held symbol (no heldPrices entry, lastRun null)', async () => {
    getAllBarsMock.mockResolvedValue([])
    getAllTickerOverviewsMock.mockResolvedValue([])
    const state = initialState()
    state.positions.push(makePosition({ id: 'p1', symbol: 'AAPL', assetClass: 'Equity' }))
    expect(state.priceSync.lastRun).toBeNull()

    await renderQuotesPage(state)

    const table = screen.getByRole('table')
    const row = table.querySelector('tbody tr')!
    const cells = Array.from(row.querySelectorAll('td')).map((td) => td.textContent)
    expect(cells[3]).toBe('Not found')
  })

  it('Held column is always "Yes" for every rendered row', async () => {
    getAllBarsMock.mockResolvedValue([])
    getAllTickerOverviewsMock.mockResolvedValue([])
    const state = initialState()
    state.positions.push(
      makePosition({ id: 'p1', symbol: 'AAPL', assetClass: 'Equity' }),
      makePosition({ id: 'p2', symbol: 'MSFT', assetClass: 'Equity' }),
      makePosition({ id: 'p3', symbol: 'VTI', assetClass: 'ETF' }),
    )

    await renderQuotesPage(state)

    const table = screen.getByRole('table')
    const rows = Array.from(table.querySelectorAll('tbody tr'))
    expect(rows).toHaveLength(3)
    rows.forEach((row) => {
      const cells = Array.from(row.querySelectorAll('td')).map((td) => td.textContent)
      expect(cells[5]).toBe('Yes')
    })
  })

  describe('search filtering', () => {
    async function buildSearchState(): Promise<AppState> {
      getAllBarsMock.mockResolvedValue([])
      getAllTickerOverviewsMock.mockResolvedValue([
        { ticker: 'AAPL', name: 'Apple Inc.', sicDescription: 'Electronic Computers', fetchedAt: '2024-01-01' },
        { ticker: 'MSFT', name: 'Microsoft Corp.', sicDescription: 'Prepackaged Software', fetchedAt: '2024-01-01' },
      ])
      const state = initialState()
      state.positions.push(
        makePosition({ id: 'p1', symbol: 'AAPL', assetClass: 'Equity' }),
        makePosition({ id: 'p2', symbol: 'MSFT', assetClass: 'Equity' }),
      )
      state.priceSync.heldPrices.AAPL = { price: 190.5, date: '2024-01-01', fetchedAt: '2024-01-01T00:00:00.000Z' }
      state.priceSync.lastRun = {
        at: '2024-01-01T00:00:00.000Z',
        updatedCount: 0,
        notFound: ['MSFT'],
        marketTickerCount: 100,
      }
      return state
    }

    it('filters by partial ticker match, case-insensitively', async () => {
      const state = await buildSearchState()
      await renderQuotesPage(state)
      fireEvent.change(screen.getByPlaceholderText(/Search ticker/), { target: { value: 'aap' } })
      expect(screen.getByText('AAPL')).toBeTruthy()
      expect(screen.queryByText('MSFT')).toBeNull()
    })

    it('filters by partial name match, case-insensitively', async () => {
      const state = await buildSearchState()
      await renderQuotesPage(state)
      fireEvent.change(screen.getByPlaceholderText(/Search ticker/), { target: { value: 'microsoft' } })
      expect(screen.getByText('MSFT')).toBeTruthy()
      expect(screen.queryByText('AAPL')).toBeNull()
    })

    it('filters by partial SIC description match, case-insensitively', async () => {
      const state = await buildSearchState()
      await renderQuotesPage(state)
      fireEvent.change(screen.getByPlaceholderText(/Search ticker/), { target: { value: 'software' } })
      expect(screen.getByText('MSFT')).toBeTruthy()
      expect(screen.queryByText('AAPL')).toBeNull()
    })

    it('filters by status match, case-insensitively', async () => {
      const state = await buildSearchState()
      await renderQuotesPage(state)
      fireEvent.change(screen.getByPlaceholderText(/Search ticker/), { target: { value: 'not found' } })
      expect(screen.getByText('MSFT')).toBeTruthy()
      expect(screen.queryByText('AAPL')).toBeNull()
    })

    it('a non-matching search hides all rows', async () => {
      const state = await buildSearchState()
      await renderQuotesPage(state)
      fireEvent.change(screen.getByPlaceholderText(/Search ticker/), { target: { value: 'zzz-no-match' } })
      expect(screen.queryByText('AAPL')).toBeNull()
      expect(screen.queryByText('MSFT')).toBeNull()
    })
  })

  it('shows the failure banner when tickerOverviewErrors is non-empty', async () => {
    getAllBarsMock.mockResolvedValue([])
    getAllTickerOverviewsMock.mockResolvedValue([])
    const state = initialState()
    state.positions.push(makePosition({ id: 'p1', symbol: 'AAPL', assetClass: 'Equity' }))

    await renderQuotesPage(state, { XYZ: 'Polygon ticker overview error: 403' })

    expect(screen.getByText(/Could not fetch name for: XYZ/)).toBeTruthy()
  })

  it('does not show the failure banner when tickerOverviewErrors is empty', async () => {
    getAllBarsMock.mockResolvedValue([])
    getAllTickerOverviewsMock.mockResolvedValue([])
    const state = initialState()
    state.positions.push(makePosition({ id: 'p1', symbol: 'AAPL', assetClass: 'Equity' }))

    await renderQuotesPage(state, {})

    expect(screen.queryByText(/Could not fetch name for/)).toBeNull()
  })

  it('renders rows in alphabetical order regardless of fixture insertion order', async () => {
    getAllBarsMock.mockResolvedValue([])
    getAllTickerOverviewsMock.mockResolvedValue([])
    const state = initialState()
    state.positions.push(
      makePosition({ id: 'p1', symbol: 'MSFT', assetClass: 'Equity' }),
      makePosition({ id: 'p2', symbol: 'AAPL', assetClass: 'Equity' }),
      makePosition({ id: 'p3', symbol: 'VTI', assetClass: 'ETF' }),
    )

    await renderQuotesPage(state)

    const table = screen.getByRole('table')
    const symbols = Array.from(table.querySelectorAll('tbody tr td:first-child')).map((td) => td.textContent)
    expect(symbols).toEqual(['AAPL', 'MSFT', 'VTI'])
  })

  describe('mutual fund rows', () => {
    const today = new Date().toISOString().slice(0, 10)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    it('merges a held mutual fund symbol into the alphabetically sorted row list alongside Equity/ETF symbols', async () => {
      getAllBarsMock.mockResolvedValue([])
      getAllTickerOverviewsMock.mockResolvedValue([])
      const state = initialState()
      state.positions.push(
        makePosition({ id: 'p1', symbol: 'MSFT', assetClass: 'Equity' }),
        makePosition({ id: 'p2', symbol: 'VTSAX', assetClass: 'Mutual Fund' }),
        makePosition({ id: 'p3', symbol: 'AAPL', assetClass: 'Equity' }),
      )

      await renderQuotesPage(state)

      const table = screen.getByRole('table')
      const symbols = Array.from(table.querySelectorAll('tbody tr td:first-child')).map((td) => td.textContent)
      expect(symbols).toEqual(['AAPL', 'MSFT', 'VTSAX'])
    })

    it('shows the effective asset class per row: Equity, ETF, and Mutual Fund each shown correctly', async () => {
      getAllBarsMock.mockResolvedValue([])
      getAllTickerOverviewsMock.mockResolvedValue([])
      const state = initialState()
      state.positions.push(
        makePosition({ id: 'p1', symbol: 'AAPL', assetClass: 'Equity' }),
        makePosition({ id: 'p2', symbol: 'VTI', assetClass: 'ETF' }),
        makePosition({ id: 'p3', symbol: 'VTSAX', assetClass: 'Mutual Fund' }),
      )

      await renderQuotesPage(state)

      const table = screen.getByRole('table')
      const rows = Array.from(table.querySelectorAll('tbody tr'))
      const bySymbol = new Map(
        rows.map((row) => {
          const cells = Array.from(row.querySelectorAll('td')).map((td) => td.textContent)
          return [cells[0], cells[1]]
        })
      )
      expect(bySymbol.get('AAPL')).toBe('Equity')
      expect(bySymbol.get('VTI')).toBe('ETF')
      expect(bySymbol.get('VTSAX')).toBe('Mutual Fund')
    })

    it('shows "Pending" status, non-error styling, when there is no heldPrices entry and symbol is not in notFound', async () => {
      getAllBarsMock.mockResolvedValue([])
      getAllTickerOverviewsMock.mockResolvedValue([])
      const state = initialState()
      state.positions.push(makePosition({ id: 'p1', symbol: 'VTSAX', assetClass: 'Mutual Fund' }))

      await renderQuotesPage(state)

      const table = screen.getByRole('table')
      const row = table.querySelector('tbody tr')!
      const cells = row.querySelectorAll('td')
      expect(cells[3].textContent).toBe('Pending')
      expect((cells[3] as HTMLElement).style.color).not.toBe('rgb(138, 60, 46)')
    })

    it('shows "Pending" status (not "OK") when the cached heldPrices entry is stale (fetched yesterday)', async () => {
      getAllBarsMock.mockResolvedValue([])
      getAllTickerOverviewsMock.mockResolvedValue([])
      const state = initialState()
      state.positions.push(makePosition({ id: 'p1', symbol: 'VTSAX', assetClass: 'Mutual Fund' }))
      state.mutualFundSync.heldPrices.VTSAX = {
        price: 120.5,
        date: yesterday,
        fetchedAt: `${yesterday}T00:00:00.000Z`,
      }

      await renderQuotesPage(state)

      const table = screen.getByRole('table')
      const row = table.querySelector('tbody tr')!
      const cells = Array.from(row.querySelectorAll('td')).map((td) => td.textContent)
      expect(cells[3]).toBe('Pending')
    })

    it('shows "Not found" status, red styling, when symbol is in mutualFundSync.lastRun.notFound', async () => {
      getAllBarsMock.mockResolvedValue([])
      getAllTickerOverviewsMock.mockResolvedValue([])
      const state = initialState()
      state.positions.push(makePosition({ id: 'p1', symbol: 'VTSAX', assetClass: 'Mutual Fund' }))
      state.mutualFundSync.lastRun = {
        at: '2024-01-01T00:00:00.000Z',
        updatedCount: 0,
        notFound: ['VTSAX'],
        marketTickerCount: 50,
      }

      await renderQuotesPage(state)

      const table = screen.getByRole('table')
      const row = table.querySelector('tbody tr')!
      const cells = row.querySelectorAll('td')
      expect(cells[3].textContent).toBe('Not found')
      expect((cells[3] as HTMLElement).style.color).toBe('rgb(138, 60, 46)')
    })

    it('shows "OK" status with the fetched price when heldPrices.fetchedAt is today', async () => {
      getAllBarsMock.mockResolvedValue([])
      getAllTickerOverviewsMock.mockResolvedValue([])
      const state = initialState()
      state.positions.push(makePosition({ id: 'p1', symbol: 'VTSAX', assetClass: 'Mutual Fund' }))
      state.mutualFundSync.heldPrices.VTSAX = {
        price: 125.75,
        date: today,
        fetchedAt: `${today}T12:00:00.000Z`,
      }

      await renderQuotesPage(state)

      const table = screen.getByRole('table')
      const row = table.querySelector('tbody tr')!
      const cells = Array.from(row.querySelectorAll('td')).map((td) => td.textContent)
      expect(cells[3]).toBe('OK')
      expect(cells[4]).toBe('$125.75')
    })

    it('mutual fund row shows "—" SIC description (empty cached value), while an Equity/ETF row with a real SIC description still shows it', async () => {
      getAllBarsMock.mockResolvedValue([])
      getAllTickerOverviewsMock.mockResolvedValue([
        { ticker: 'AAPL', name: 'Apple Inc.', sicDescription: 'Electronic Computers', fetchedAt: '2024-01-01' },
        { ticker: 'VTSAX', name: 'Vanguard Total Stock Market Index Fund', sicDescription: '', fetchedAt: '2024-01-01' },
      ])
      const state = initialState()
      state.positions.push(
        makePosition({ id: 'p1', symbol: 'AAPL', assetClass: 'Equity' }),
        makePosition({ id: 'p2', symbol: 'VTSAX', assetClass: 'Mutual Fund' }),
      )

      await renderQuotesPage(state)

      const table = screen.getByRole('table')
      const rows = Array.from(table.querySelectorAll('tbody tr'))
      const bySymbol = new Map(
        rows.map((row) => {
          const cells = Array.from(row.querySelectorAll('td')).map((td) => td.textContent)
          return [cells[0], cells[7]]
        })
      )
      expect(bySymbol.get('AAPL')).toBe('Electronic Computers')
      expect(bySymbol.get('VTSAX')).toBe('—')
    })

    it('search for "mutual fund" (case-insensitive) matches the Asset Class column and shows only mutual fund rows', async () => {
      getAllBarsMock.mockResolvedValue([])
      getAllTickerOverviewsMock.mockResolvedValue([])
      const state = initialState()
      state.positions.push(
        makePosition({ id: 'p1', symbol: 'AAPL', assetClass: 'Equity' }),
        makePosition({ id: 'p2', symbol: 'VTI', assetClass: 'ETF' }),
        makePosition({ id: 'p3', symbol: 'VTSAX', assetClass: 'Mutual Fund' }),
      )

      await renderQuotesPage(state)

      fireEvent.change(screen.getByPlaceholderText(/Search ticker/), { target: { value: 'mutual fund' } })
      expect(screen.getByText('VTSAX')).toBeTruthy()
      expect(screen.queryByText('AAPL')).toBeNull()
      expect(screen.queryByText('VTI')).toBeNull()
    })
  })
})
