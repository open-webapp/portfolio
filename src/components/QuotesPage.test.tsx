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

    expect(cells).toEqual(['AAPL', 'Apple Inc.', 'OK', '$190.50', 'Yes', expectedLastUpdated, 'Electronic Computers'])
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
    expect(cells[2]).toBe('Not found')
    expect(cells[3]).toBe('—')
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
    expect(cells[2]).toBe('Not found')
    expect(cells[3]).toBe('$180.25')
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
    expect(cells[2]).toBe('Not found')
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
      expect(cells[4]).toBe('Yes')
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
})
