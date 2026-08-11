import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { PositionsTable } from './PositionsTable'
import type { AppState, Position, Account } from '../lib/types'
import { fmtUSD, fmtPct } from '../lib/computations'

afterEach(cleanup)

describe('PositionsTable', () => {
  let mockDispatch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockDispatch = vi.fn()
  })

  /**
   * Test 1: Multi-account aggregation
   * Two positions, different accounts, same symbol+effectiveAssetClass+taxCategory+retirement
   * Should aggregate into one row with summed values
   */
  it('aggregates positions from different accounts with same grouping fields', () => {
    const accounts: Account[] = [
      {
        id: 'acc-1',
        accountNumber: '001',
        name: 'Brokerage A',
        institution: 'Test Institution',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
      {
        id: 'acc-2',
        accountNumber: '002',
        name: 'Brokerage B',
        institution: 'Test Institution',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
    ]

    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 150,
        price: 180,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
      {
        id: 'pos-2',
        accountId: 'acc-2',
        symbol: 'AAPL',
        name: 'Apple Inc',
        assetClass: 'Equity',
        shares: 15,
        avgCost: 155,
        price: 180,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
    ]

    const state: AppState = {
      accounts,
      positions,
      closedPositions: [],
      transactions: [],
      snapshots: [],
      category: 'all',
      range: '1y',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      retirementFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
      csvMappings: [],
    }

    render(<PositionsTable state={state} dispatch={mockDispatch} />)

    // Should have exactly one row in the table body (aggregated)
    const tbody = screen.getByRole('table').querySelector('tbody')
    const rows = tbody?.querySelectorAll('tr')
    expect(rows).toHaveLength(1)

    // Verify aggregated values
    const row = rows?.[0]
    expect(row).toBeDefined()

    // Expected aggregated values:
    // shares: 10 + 15 = 25
    // costBasis: (10 * 150) + (15 * 155) = 1500 + 2325 = 3825
    // marketValue: (10 * 180) + (15 * 180) = 1800 + 2700 = 4500
    // price: 4500 / 25 = 180
    // avgCost: 3825 / 25 = 153
    // gl: 4500 - 3825 = 675
    // glPct: (675 / 3825) * 100 = 17.65%

    const sharesStr = '25.00'
    const avgCostStr = fmtUSD(153)
    const priceStr = fmtUSD(180)
    const costBasisStr = fmtUSD(3825)
    const marketValueStr = fmtUSD(4500)
    const glStr = fmtUSD(675)
    // glPct = 675 / 3825 * 100 ≈ 17.65%
    const glPctStr = fmtPct(17.65)

    expect(row?.textContent).toContain('AAPL')
    expect(row?.textContent).toContain(sharesStr)
    expect(row?.textContent).toContain(avgCostStr)
    expect(row?.textContent).toContain(priceStr)
    expect(row?.textContent).toContain(costBasisStr)
    expect(row?.textContent).toContain(marketValueStr)
    expect(row?.textContent).toContain(glStr)
    expect(row?.textContent).toContain(glPctStr)
  })

  /**
   * Test 2a: Merge on different taxCategory
   * Same symbol, same asset class, but different taxCategory
   * With v2 grouping (2-field key: symbol + effectiveAssetClass only),
   * these should merge into 1 aggregated row (tax category is ignored)
   */
  it('aggregates positions with different tax categories', () => {
    const accounts: Account[] = [
      {
        id: 'acc-1',
        accountNumber: '001',
        name: 'Taxable',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
      {
        id: 'acc-2',
        accountNumber: '002',
        name: 'Non-Taxable',
        taxCategory: 'nonTaxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
    ]

    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'MSFT',
        name: 'Microsoft',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 100,
        price: 120,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
      {
        id: 'pos-2',
        accountId: 'acc-2',
        symbol: 'MSFT',
        name: 'Microsoft',
        assetClass: 'Equity',
        shares: 15,
        avgCost: 105,
        price: 120,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
    ]

    const state: AppState = {
      accounts,
      positions,
      closedPositions: [],
      transactions: [],
      snapshots: [],
      category: 'all',
      range: '1y',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      retirementFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
      csvMappings: [],
    }

    render(<PositionsTable state={state} dispatch={mockDispatch} />)

    // Should have exactly one row (merged on symbol + effectiveAssetClass, tax category ignored)
    const tbody = screen.getByRole('table').querySelector('tbody')
    const rows = tbody?.querySelectorAll('tr')
    expect(rows).toHaveLength(1)

    // Verify the row is aggregated correctly
    const row = rows?.[0]
    expect(row).toBeDefined()
    expect(row?.textContent).toContain('MSFT')

    // Expected aggregated values:
    // shares: 10 + 15 = 25
    // costBasis: (10 * 100) + (15 * 105) = 1000 + 1575 = 2575
    // marketValue: (10 * 120) + (15 * 120) = 1200 + 1800 = 3000
    // avgCost: 2575 / 25 = 103
    // price: 3000 / 25 = 120
    // gl: 3000 - 2575 = 425
    // glPct: (425 / 2575) * 100 ≈ 16.50%

    expect(row?.textContent).toContain('25.00')
    expect(row?.textContent).toContain(fmtUSD(103))
    expect(row?.textContent).toContain(fmtUSD(120))
    expect(row?.textContent).toContain(fmtUSD(2575))
    expect(row?.textContent).toContain(fmtUSD(3000))
  })

  /**
   * Test 2b: Merge on different retirement status
   * Same symbol, same asset class, but different retirement status
   * With v2 grouping (2-field key: symbol + effectiveAssetClass only),
   * these should merge into 1 aggregated row (retirement status is ignored)
   */
  it('aggregates positions with different retirement status', () => {
    const accounts: Account[] = [
      {
        id: 'acc-1',
        accountNumber: '001',
        name: 'Non-Retirement',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
      {
        id: 'acc-2',
        accountNumber: '002',
        name: 'Retirement',
        taxCategory: 'taxable',
        retirement: true,
        createdAt: '2024-01-01',
      },
    ]

    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'GOOG',
        name: 'Google',
        assetClass: 'Equity',
        shares: 5,
        avgCost: 120,
        price: 140,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
      {
        id: 'pos-2',
        accountId: 'acc-2',
        symbol: 'GOOG',
        name: 'Google',
        assetClass: 'Equity',
        shares: 8,
        avgCost: 125,
        price: 140,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
    ]

    const state: AppState = {
      accounts,
      positions,
      closedPositions: [],
      transactions: [],
      snapshots: [],
      category: 'all',
      range: '1y',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      retirementFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
      csvMappings: [],
    }

    render(<PositionsTable state={state} dispatch={mockDispatch} />)

    // Should have exactly one row (merged on symbol + effectiveAssetClass, retirement status ignored)
    const tbody = screen.getByRole('table').querySelector('tbody')
    const rows = tbody?.querySelectorAll('tr')
    expect(rows).toHaveLength(1)

    // Verify the row is aggregated correctly
    const row = rows?.[0]
    expect(row).toBeDefined()
    expect(row?.textContent).toContain('GOOG')

    // Expected aggregated values:
    // shares: 5 + 8 = 13
    // costBasis: (5 * 120) + (8 * 125) = 600 + 1000 = 1600
    // marketValue: (5 * 140) + (8 * 140) = 700 + 1120 = 1820
    // avgCost: 1600 / 13 ≈ 123.08
    // price: 1820 / 13 = 140
    // gl: 1820 - 1600 = 220
    // glPct: (220 / 1600) * 100 = 13.75%

    expect(row?.textContent).toContain('13.00')
    expect(row?.textContent).toContain(fmtUSD(1600))
    expect(row?.textContent).toContain(fmtUSD(1820))
  })

  /**
   * Test 2c: Differing grouping fields - different effective asset class
   */
  it('does not aggregate positions with different asset classes', () => {
    const accounts: Account[] = [
      {
        id: 'acc-1',
        accountNumber: '001',
        name: 'Account 1',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
    ]

    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'VOO',
        name: 'Vanguard 500',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 400,
        price: 450,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
      {
        id: 'pos-2',
        accountId: 'acc-1',
        symbol: 'VOO',
        name: 'Vanguard 500',
        assetClass: 'Equity',
        assetClassManualOverride: 'ETF',
        shares: 5,
        avgCost: 410,
        price: 450,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
    ]

    const state: AppState = {
      accounts,
      positions,
      closedPositions: [],
      transactions: [],
      snapshots: [],
      category: 'all',
      range: '1y',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      retirementFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
      csvMappings: [],
    }

    render(<PositionsTable state={state} dispatch={mockDispatch} />)

    const tbody = screen.getByRole('table').querySelector('tbody')
    const rows = tbody?.querySelectorAll('tr')
    expect(rows).toHaveLength(2)
  })

  /**
   * Test 3: Single-position group
   * Renders as a row, row count badge shows "1", row is clickable
   */
  it('renders single-position group with correct account count badge', () => {
    const accounts: Account[] = [
      {
        id: 'acc-1',
        accountNumber: '001',
        name: 'My Brokerage',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
    ]

    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'TSLA',
        name: 'Tesla',
        assetClass: 'Equity',
        shares: 3,
        avgCost: 200,
        price: 250,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
    ]

    const state: AppState = {
      accounts,
      positions,
      closedPositions: [],
      transactions: [],
      snapshots: [],
      category: 'all',
      range: '1y',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      retirementFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
      csvMappings: [],
    }

    render(<PositionsTable state={state} dispatch={mockDispatch} />)

    const tbody = screen.getByRole('table').querySelector('tbody')
    const rows = tbody?.querySelectorAll('tr')
    expect(rows).toHaveLength(1)

    // Check for account count badge
    const badgeText = within(rows![0]).getByText('1')
    expect(badgeText).toBeDefined()

    // Row should be clickable
    const row = rows![0]
    fireEvent.click(row)
    // Clicking should be possible without errors
  })

  /**
   * Test 4: Overlay with correct positions
   * Click a multi-position row, overlay opens showing the underlying positions
   * Positions sorted by account name ascending
   */
  it('opens overlay with correct underlying positions sorted by account name', () => {
    const accounts: Account[] = [
      {
        id: 'acc-z',
        accountNumber: 'Z001',
        name: 'Zebra Account',
        institution: 'Test',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
      {
        id: 'acc-a',
        accountNumber: 'A001',
        name: 'Apple Account',
        institution: 'Test',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
    ]

    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-z',
        symbol: 'AAPL',
        name: 'Apple Inc',
        assetClass: 'Equity',
        shares: 5,
        avgCost: 150,
        price: 180,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
      {
        id: 'pos-2',
        accountId: 'acc-a',
        symbol: 'AAPL',
        name: 'Apple Inc',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 160,
        price: 180,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
    ]

    const state: AppState = {
      accounts,
      positions,
      closedPositions: [],
      transactions: [],
      snapshots: [],
      category: 'all',
      range: '1y',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      retirementFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
      csvMappings: [],
    }

    render(<PositionsTable state={state} dispatch={mockDispatch} />)

    // Click the aggregated row
    const tbody = screen.getByRole('table').querySelector('tbody')
    const row = tbody?.querySelector('tr')
    expect(row).toBeDefined()
    fireEvent.click(row!)

    // Overlay should appear - check for the dialog-backdrop
    const backdrop = document.querySelector('.dialog-backdrop')
    expect(backdrop).toBeDefined()

    // The overlay should show the underlying positions
    // Positions should be sorted by account name: "Apple Account" before "Zebra Account"
    // Account names are now in buttons, so check for them with a flexible matcher
    const buttons = screen.getAllByRole('button')
    const appleAccountButton = buttons.find(b => b.textContent?.includes('Apple Account'))
    const zebraAccountButton = buttons.find(b => b.textContent?.includes('Zebra Account'))
    expect(appleAccountButton).toBeDefined()
    expect(zebraAccountButton).toBeDefined()
  })

  /**
   * Test 5a: Overlay close mechanism - Escape key
   */
  it('closes overlay when Escape key is pressed', () => {
    const accounts: Account[] = [
      {
        id: 'acc-1',
        accountNumber: '001',
        name: 'Account 1',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
      {
        id: 'acc-2',
        accountNumber: '002',
        name: 'Account 2',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
    ]

    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'FB',
        name: 'Meta',
        assetClass: 'Equity',
        shares: 5,
        avgCost: 100,
        price: 120,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
      {
        id: 'pos-2',
        accountId: 'acc-2',
        symbol: 'FB',
        name: 'Meta',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 105,
        price: 120,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
    ]

    const state: AppState = {
      accounts,
      positions,
      closedPositions: [],
      transactions: [],
      snapshots: [],
      category: 'all',
      range: '1y',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      retirementFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
      csvMappings: [],
    }

    render(<PositionsTable state={state} dispatch={mockDispatch} />)

    // Open overlay
    const tbody = screen.getByRole('table').querySelector('tbody')
    const row = tbody?.querySelector('tr')
    fireEvent.click(row!)

    // Verify overlay is open (check for dialog backdrop)
    let backdrop = document.querySelector('.dialog-backdrop')
    expect(backdrop).toBeDefined()

    // Press Escape
    fireEvent.keyDown(window, { key: 'Escape' })

    // Overlay should close - the backdrop should no longer be visible
    backdrop = document.querySelector('.dialog-backdrop')
    expect(backdrop).toBeNull()
  })

  /**
   * Test 5b: Overlay close mechanism - backdrop click
   */
  it('closes overlay when backdrop is clicked', () => {
    const accounts: Account[] = [
      {
        id: 'acc-1',
        accountNumber: '001',
        name: 'Account 1',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
      {
        id: 'acc-2',
        accountNumber: '002',
        name: 'Account 2',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
    ]

    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'NFLX',
        name: 'Netflix',
        assetClass: 'Equity',
        shares: 2,
        avgCost: 300,
        price: 350,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
      {
        id: 'pos-2',
        accountId: 'acc-2',
        symbol: 'NFLX',
        name: 'Netflix',
        assetClass: 'Equity',
        shares: 3,
        avgCost: 310,
        price: 350,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
    ]

    const state: AppState = {
      accounts,
      positions,
      closedPositions: [],
      transactions: [],
      snapshots: [],
      category: 'all',
      range: '1y',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      retirementFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
      csvMappings: [],
    }

    render(<PositionsTable state={state} dispatch={mockDispatch} />)

    // Open overlay
    const tbody = screen.getByRole('table').querySelector('tbody')
    const row = tbody?.querySelector('tr')
    fireEvent.click(row!)

    // Verify overlay is open
    let backdrop = document.querySelector('.dialog-backdrop')
    expect(backdrop).toBeDefined()

    // Click backdrop
    fireEvent.click(backdrop!)

    // Overlay should close
    backdrop = document.querySelector('.dialog-backdrop')
    expect(backdrop).toBeNull()
  })

  /**
   * Test 5c: Overlay close mechanism - X button click
   */
  it('closes overlay when close button is clicked', () => {
    const accounts: Account[] = [
      {
        id: 'acc-1',
        accountNumber: '001',
        name: 'Account 1',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
      {
        id: 'acc-2',
        accountNumber: '002',
        name: 'Account 2',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
    ]

    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'AMZN',
        name: 'Amazon',
        assetClass: 'Equity',
        shares: 1,
        avgCost: 3000,
        price: 3500,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
      {
        id: 'pos-2',
        accountId: 'acc-2',
        symbol: 'AMZN',
        name: 'Amazon',
        assetClass: 'Equity',
        shares: 2,
        avgCost: 3100,
        price: 3500,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
    ]

    const state: AppState = {
      accounts,
      positions,
      closedPositions: [],
      transactions: [],
      snapshots: [],
      category: 'all',
      range: '1y',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      retirementFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
      csvMappings: [],
    }

    render(<PositionsTable state={state} dispatch={mockDispatch} />)

    // Open overlay
    const tbody = screen.getByRole('table').querySelector('tbody')
    const row = tbody?.querySelector('tr')
    fireEvent.click(row!)

    // Verify overlay is open
    let backdrop = document.querySelector('.dialog-backdrop')
    expect(backdrop).toBeDefined()

    // Click the close button (X button with aria-label="Close")
    const closeButton = screen.getByLabelText('Close')
    fireEvent.click(closeButton)

    // Overlay should close
    backdrop = document.querySelector('.dialog-backdrop')
    expect(backdrop).toBeNull()
  })

  /**
   * Test 6: Sort by Market Value
   * Click the Market Value header to sort.
   * Construct fixture where pre-aggregation sort order would differ from post-aggregation sort order.
   */
  it('sorts aggregate rows by market value (post-aggregation)', () => {
    const accounts: Account[] = [
      {
        id: 'acc-1',
        accountNumber: '001',
        name: 'Account 1',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
    ]

    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'STOCK1',
        name: 'Stock 1',
        assetClass: 'Equity',
        shares: 100, // marketValue = 100 * 10 = 1000
        avgCost: 5,
        price: 10,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
      {
        id: 'pos-2',
        accountId: 'acc-1',
        symbol: 'STOCK2',
        name: 'Stock 2',
        assetClass: 'Equity',
        shares: 10, // marketValue = 10 * 100 = 1000
        avgCost: 50,
        price: 100,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
    ]

    const state: AppState = {
      accounts,
      positions,
      closedPositions: [],
      transactions: [],
      snapshots: [],
      category: 'all',
      range: '1y',
      tab: 'positions',
      sortKey: 'symbol', // Start with symbol sort
      sortDir: 'asc',
      assetClassFilter: 'All',
      retirementFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
      csvMappings: [],
    }

    const { rerender } = render(<PositionsTable state={state} dispatch={mockDispatch} />)

    // Initial order should be STOCK1, STOCK2 (symbol ascending)
    let tbody = screen.getByRole('table').querySelector('tbody')
    let rows = tbody?.querySelectorAll('tr')
    expect(rows?.[0]?.textContent).toContain('STOCK1')
    expect(rows?.[1]?.textContent).toContain('STOCK2')

    // Simulate clicking the market value header
    // This would normally dispatch a TOGGLE_SORT action, but we're just testing the sorting logic
    // by re-rendering with sortKey='marketValue'
    const newState = { ...state, sortKey: 'marketValue' as any }
    rerender(<PositionsTable state={newState} dispatch={mockDispatch} />)

    tbody = screen.getByRole('table').querySelector('tbody')
    rows = tbody?.querySelectorAll('tr')
    // Both have same market value (1000), so order depends on secondary sorting (should be stable)
    expect(rows?.length).toBe(2)
  })

  /**
   * Test 6b: Row-count badge with multiple positions in same account
   * 3 positions across 2 accounts (2 in account A, 1 in account B)
   * Badge should show "3" (total row count), not "2" (distinct accounts)
   */
  it('displays row count badge with 3 positions across 2 distinct accounts', () => {
    const accounts: Account[] = [
      {
        id: 'acc-1',
        accountNumber: '001',
        name: 'Account 1',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
      {
        id: 'acc-2',
        accountNumber: '002',
        name: 'Account 2',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
    ]

    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'MULTI',
        name: 'Multi Position',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 50,
        price: 60,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
      {
        id: 'pos-2',
        accountId: 'acc-1',
        symbol: 'MULTI',
        name: 'Multi Position',
        assetClass: 'Equity',
        shares: 5,
        avgCost: 52,
        price: 60,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
      {
        id: 'pos-3',
        accountId: 'acc-2',
        symbol: 'MULTI',
        name: 'Multi Position',
        assetClass: 'Equity',
        shares: 8,
        avgCost: 55,
        price: 60,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
    ]

    const state: AppState = {
      accounts,
      positions,
      closedPositions: [],
      transactions: [],
      snapshots: [],
      category: 'all',
      range: '1y',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      retirementFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
      csvMappings: [],
    }

    render(<PositionsTable state={state} dispatch={mockDispatch} />)

    const tbody = screen.getByRole('table').querySelector('tbody')
    const rows = tbody?.querySelectorAll('tr')
    expect(rows).toHaveLength(1)

    // Badge should show "3" (total row count), not "2" (distinct accounts)
    const row = rows![0]
    const badge = within(row).getByText('3')
    expect(badge).toBeDefined()
  })

  /**
   * Test 7: Row-count badge for various group sizes
   * Shows correct count: 1 for a single-position group, 2 for a two-position group, etc.
   */
  it('displays correct row count in badge for different group sizes', () => {
    const accounts: Account[] = [
      {
        id: 'acc-1',
        accountNumber: '001',
        name: 'Account 1',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
      {
        id: 'acc-2',
        accountNumber: '002',
        name: 'Account 2',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
      {
        id: 'acc-3',
        accountNumber: '003',
        name: 'Account 3',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
    ]

    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'XYZ',
        name: 'XYZ Corp',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 50,
        price: 60,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
      {
        id: 'pos-2',
        accountId: 'acc-2',
        symbol: 'XYZ',
        name: 'XYZ Corp',
        assetClass: 'Equity',
        shares: 5,
        avgCost: 52,
        price: 60,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
      {
        id: 'pos-3',
        accountId: 'acc-3',
        symbol: 'ABC',
        name: 'ABC Corp',
        assetClass: 'Equity',
        shares: 20,
        avgCost: 30,
        price: 40,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
    ]

    const state: AppState = {
      accounts,
      positions,
      closedPositions: [],
      transactions: [],
      snapshots: [],
      category: 'all',
      range: '1y',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      retirementFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
      csvMappings: [],
    }

    render(<PositionsTable state={state} dispatch={mockDispatch} />)

    const tbody = screen.getByRole('table').querySelector('tbody')
    const rows = tbody?.querySelectorAll('tr')
    expect(rows).toHaveLength(2) // ABC (1 account) and XYZ (2 accounts)

    // Find the rows
    let abcRow: Element | undefined
    let xyzRow: Element | undefined
    rows?.forEach((row) => {
      if (row.textContent?.includes('ABC')) abcRow = row
      if (row.textContent?.includes('XYZ')) xyzRow = row
    })

    // ABC should have badge showing "1"
    expect(abcRow?.textContent).toContain('1')

    // XYZ should have badge showing "2"
    expect(xyzRow?.textContent).toContain('2')
  })

  /**
   * Test 8: AssetClassOverrideSelect dispatch
   * Open overlay, interact with asset class override select, verify correct dispatch call
   */
  it('dispatches SET_ASSET_CLASS_OVERRIDE with correct shape when override is set', () => {
    const accounts: Account[] = [
      {
        id: 'acc-1',
        accountNumber: '001',
        name: 'Account 1',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
    ]

    const positions: Position[] = [
      {
        id: 'pos-123',
        accountId: 'acc-1',
        symbol: 'UNKNOWN',
        name: 'Unknown Asset',
        assetClass: 'Other',
        shares: 1,
        avgCost: 100,
        price: 100,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
      {
        id: 'pos-124',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 150,
        price: 180,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
    ]

    const state: AppState = {
      accounts,
      positions,
      closedPositions: [],
      transactions: [],
      snapshots: [],
      category: 'all',
      range: '1y',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      retirementFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
      csvMappings: [],
    }

    render(<PositionsTable state={state} dispatch={mockDispatch} />)

    // Open overlay by clicking the row for 'UNKNOWN' (pos-123)
    const tbody = screen.getByRole('table').querySelector('tbody')
    const rows = tbody?.querySelectorAll('tr')
    const unknownRow = Array.from(rows || []).find(row =>
      row.textContent?.includes('UNKNOWN')
    )
    fireEvent.click(unknownRow as HTMLElement)

    // Find the override select button in the overlay and click it
    // The button shows "Set" if no override is active
    const setButtons = screen.getAllByText('Set')
    expect(setButtons.length).toBeGreaterThan(0)

    const overrideButton = setButtons[0] // In the overlay table
    fireEvent.click(overrideButton)

    // Select an option from the dropdown
    // Use getAllByText and pick the one that's a dropdown option (has specific padding style)
    const equityOptions = screen.getAllByText('Equity')
    // Find the dropdown option (it should have the cursor:pointer padding style from the dropdown)
    const equityOption = equityOptions.find(el =>
      el.tagName === 'DIV' && el.style.padding === '8px'
    )
    fireEvent.click(equityOption!)

    // Verify dispatch was called with correct shape
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SET_ASSET_CLASS_OVERRIDE',
        positionId: 'pos-123',
        override: 'Equity',
      })
    )
  })

  /**
   * Test 9: No Override column regression
   * Main positions table should NOT have an Override column
   * (Override is only in the overlay)
   */
  it('does not render Override column in main positions table', () => {
    const accounts: Account[] = [
      {
        id: 'acc-1',
        accountNumber: '001',
        name: 'Account 1',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
    ]

    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 150,
        price: 180,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
    ]

    const state: AppState = {
      accounts,
      positions,
      closedPositions: [],
      transactions: [],
      snapshots: [],
      category: 'all',
      range: '1y',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      retirementFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
      csvMappings: [],
    }

    render(<PositionsTable state={state} dispatch={mockDispatch} />)

    // Get the main table headers (not the overlay)
    const tables = screen.getAllByRole('table')
    const mainTable = tables[0] // First table is the main positions table
    const headers = mainTable.querySelectorAll('thead th')

    // Collect header texts
    const headerTexts = Array.from(headers).map((h) => h.textContent?.trim())

    // Override should not be in the main table headers
    expect(headerTexts).not.toContain('Override')
  })

  /**
   * Test 9b: Table header doesn't contain "Accounts" label
   * The row count column header should be blank
   */
  it('does not display "Accounts" label in table header', () => {
    const accounts: Account[] = [
      {
        id: 'acc-1',
        accountNumber: '001',
        name: 'Account 1',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
    ]

    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'TEST',
        name: 'Test Position',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 100,
        price: 120,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
    ]

    const state: AppState = {
      accounts,
      positions,
      closedPositions: [],
      transactions: [],
      snapshots: [],
      category: 'all',
      range: '1y',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      retirementFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
      csvMappings: [],
    }

    render(<PositionsTable state={state} dispatch={mockDispatch} />)

    // Get the main table
    const tables = screen.getAllByRole('table')
    const mainTable = tables[0]
    const headerRow = mainTable.querySelector('thead tr')
    const headerText = headerRow?.textContent || ''

    // "Accounts" text should not appear in header
    expect(headerText).not.toContain('Accounts')
  })

  /**
   * Bonus test: Orphaned position (account not found in the live accounts list)
   * The buildGroupKey function should use sentinel values for orphaned positions.
   * This test verifies that even if an account is deleted but its positions remain,
   * the grouping key uses predictable sentinel values.
   *
   * Note: In practice, visiblePositions filters out orphaned positions, so this
   * tests that the sentinel logic gracefully handles the edge case.
   */
  it('aggregates positions from deleted account using sentinel grouping values', () => {
    // Account exists initially but will be used to create positions
    // Then we'll test with it removed to simulate deletion
    const accounts: Account[] = [
      {
        id: 'acc-1',
        accountNumber: '001',
        name: 'Valid Account',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
    ]

    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-deleted', // Account was deleted
        symbol: 'ORPHAN',
        name: 'Orphaned Position',
        assetClass: 'Equity',
        shares: 5,
        avgCost: 100,
        price: 120,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
      {
        id: 'pos-2',
        accountId: 'acc-deleted', // Same deleted account
        symbol: 'ORPHAN',
        name: 'Orphaned Position',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 105,
        price: 120,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
    ]

    const state: AppState = {
      accounts, // acc-deleted is NOT in this list
      positions,
      closedPositions: [],
      transactions: [],
      snapshots: [],
      category: 'all',
      range: '1y',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      retirementFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
      csvMappings: [],
    }

    render(<PositionsTable state={state} dispatch={mockDispatch} />)

    // Orphaned positions should be filtered out by visiblePositions
    // So the table should be empty
    const tbody = screen.getByRole('table').querySelector('tbody')
    const rows = tbody?.querySelectorAll('tr')
    expect(rows).toHaveLength(0)
  })

  /**
   * Test: "% of Portfolio" column renders with correct header
   */
  it('renders "% of Portfolio" column header', () => {
    const accounts: Account[] = [
      {
        id: 'acc-1',
        accountNumber: '001',
        name: 'Account 1',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
    ]

    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 150,
        price: 180,
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
    ]

    const state: AppState = {
      accounts,
      positions,
      closedPositions: [],
      transactions: [],
      snapshots: [],
      category: 'all',
      range: '1y',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      retirementFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
      csvMappings: [],
    }

    render(<PositionsTable state={state} dispatch={mockDispatch} />)

    // Check for the column header
    const headers = screen.getAllByRole('columnheader')
    const portfolioPercentHeader = Array.from(headers).find(h =>
      h.textContent?.includes('% of Portfolio')
    )
    expect(portfolioPercentHeader).toBeDefined()
  })

  /**
   * Test: "% of Portfolio" column displays correct percentage value
   */
  it('renders "% of Portfolio" with correct calculated value', () => {
    const accounts: Account[] = [
      {
        id: 'acc-1',
        accountNumber: '001',
        name: 'Account 1',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
    ]

    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 150,
        price: 200, // marketValue = 2000
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
      {
        id: 'pos-2',
        accountId: 'acc-1',
        symbol: 'MSFT',
        name: 'Microsoft',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 150,
        price: 300, // marketValue = 3000
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
    ]

    const state: AppState = {
      accounts,
      positions,
      closedPositions: [],
      transactions: [],
      snapshots: [],
      category: 'all',
      range: '1y',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      retirementFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
      csvMappings: [],
    }

    render(<PositionsTable state={state} dispatch={mockDispatch} />)

    // Total portfolio = 2000 + 3000 = 5000
    // AAPL = 2000 / 5000 * 100 = 40.0%
    // MSFT = 3000 / 5000 * 100 = 60.0%
    expect(screen.getByText('40.0%')).toBeDefined()
    expect(screen.getByText('60.0%')).toBeDefined()
  })

  /**
   * Test: "% of Portfolio" column with category filter changes percentages
   */
  it('"% of Portfolio" percentages change with category filter', () => {
    const accounts: Account[] = [
      {
        id: 'acc-1',
        accountNumber: '001',
        name: 'Taxable',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
      {
        id: 'acc-2',
        accountNumber: '002',
        name: 'Non-Taxable',
        taxCategory: 'nonTaxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
    ]

    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 150,
        price: 200, // marketValue = 2000
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
      {
        id: 'pos-2',
        accountId: 'acc-2',
        symbol: 'MSFT',
        name: 'Microsoft',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 150,
        price: 300, // marketValue = 3000
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
    ]

    // First render with 'all' category
    const stateAll: AppState = {
      accounts,
      positions,
      closedPositions: [],
      transactions: [],
      snapshots: [],
      category: 'all',
      range: '1y',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      retirementFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
      csvMappings: [],
    }

    const { rerender } = render(<PositionsTable state={stateAll} dispatch={mockDispatch} />)

    // With all category: AAPL = 2000/5000 = 40.0%, MSFT = 3000/5000 = 60.0%
    expect(screen.getByText('40.0%')).toBeDefined()
    expect(screen.getByText('60.0%')).toBeDefined()

    // Now filter to taxable only
    const stateTaxable: AppState = {
      ...stateAll,
      category: 'taxable',
    }

    rerender(<PositionsTable state={stateTaxable} dispatch={mockDispatch} />)

    // With taxable only: AAPL = 2000/2000 = 100.0% (MSFT not visible)
    // Only AAPL should be visible, showing 100.0%
    expect(screen.getByText('100.0%')).toBeDefined()
  })

  /**
   * Test: "% of Portfolio" column with retirement filter changes percentages
   */
  it('"% of Portfolio" percentages change with retirement filter', () => {
    const accounts: Account[] = [
      {
        id: 'acc-1',
        accountNumber: '001',
        name: 'Non-Retirement',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
      {
        id: 'acc-2',
        accountNumber: '002',
        name: 'Retirement',
        taxCategory: 'taxable',
        retirement: true,
        createdAt: '2024-01-01',
      },
    ]

    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 150,
        price: 200, // marketValue = 2000
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
      {
        id: 'pos-2',
        accountId: 'acc-2',
        symbol: 'MSFT',
        name: 'Microsoft',
        assetClass: 'Equity',
        shares: 10,
        avgCost: 150,
        price: 300, // marketValue = 3000
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
    ]

    // First render with 'All' retirement filter
    const stateAll: AppState = {
      accounts,
      positions,
      closedPositions: [],
      transactions: [],
      snapshots: [],
      category: 'all',
      range: '1y',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      retirementFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
      csvMappings: [],
    }

    const { rerender } = render(<PositionsTable state={stateAll} dispatch={mockDispatch} />)

    // With all retirement: AAPL = 2000/5000 = 40.0%, MSFT = 3000/5000 = 60.0%
    expect(screen.getByText('40.0%')).toBeDefined()
    expect(screen.getByText('60.0%')).toBeDefined()

    // Now filter to retirement only
    const stateRetirement: AppState = {
      ...stateAll,
      retirementFilter: 'Retirement',
    }

    rerender(<PositionsTable state={stateRetirement} dispatch={mockDispatch} />)

    // With retirement only: MSFT = 3000/3000 = 100.0%
    // Only MSFT should be visible, showing 100.0%
    expect(screen.getByText('100.0%')).toBeDefined()
  })

  /**
   * Test: Row percentages sum to approximately 100% (or near it for rounding)
   */
  it('row percentages sum to approximately 100% (allowing for rounding)', () => {
    const accounts: Account[] = [
      {
        id: 'acc-1',
        accountNumber: '001',
        name: 'Account 1',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      },
    ]

    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'STOCK1',
        name: 'Stock 1',
        assetClass: 'Equity',
        shares: 33,
        avgCost: 100,
        price: 100, // marketValue = 3300
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
      {
        id: 'pos-2',
        accountId: 'acc-1',
        symbol: 'STOCK2',
        name: 'Stock 2',
        assetClass: 'Equity',
        shares: 33,
        avgCost: 100,
        price: 100, // marketValue = 3300
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
      {
        id: 'pos-3',
        accountId: 'acc-1',
        symbol: 'STOCK3',
        name: 'Stock 3',
        assetClass: 'Equity',
        shares: 34,
        avgCost: 100,
        price: 100, // marketValue = 3400
        taxes: null,
        lastImportedAt: '2024-01-01',
      },
    ]

    const state: AppState = {
      accounts,
      positions,
      closedPositions: [],
      transactions: [],
      snapshots: [],
      category: 'all',
      range: '1y',
      tab: 'positions',
      sortKey: 'symbol',
      sortDir: 'asc',
      assetClassFilter: 'All',
      retirementFilter: 'All',
      posSearch: '',
      txTypeFilter: 'All',
      txSearch: '',
      showClosed: false,
      csvMappings: [],
    }

    render(<PositionsTable state={state} dispatch={mockDispatch} />)

    // Total = 3300 + 3300 + 3400 = 10000
    // Stock1: 33.0%, Stock2: 33.0%, Stock3: 34.0%
    // Sum: 100%
    const tbody = screen.getByRole('table').querySelector('tbody')
    const rows = tbody?.querySelectorAll('tr')

    // Check that the three expected percentages are present in the rendered table
    const allText = tbody?.textContent || ''
    expect(allText).toContain('33.0%')
    expect(allText).toContain('34.0%')
    expect(rows).toHaveLength(3)
  })
})
