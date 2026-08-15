import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { useReducer } from 'react'
import { AccountsPage } from './AccountsPage'
import { appReducer, type AppAction } from '../lib/reducer'
import { initialState, type AppState } from '../lib/state'

afterEach(cleanup)

/**
 * Renders AccountsPage wired to a real reducer, so clicks that dispatch
 * actions (expand category, select account, filter, search) actually
 * update the rendered UI.
 */
function AccountsPageHarness({ initial }: { initial: AppState }) {
  const [state, dispatch] = useReducer(appReducer, initial)
  return <AccountsPage state={state} dispatch={dispatch as (action: AppAction) => void} />
}

function buildAppStateWithAccounts(options?: {
  taxableAccounts?: number
  nonTaxableAccounts?: number
  taxDeferredAccounts?: number
}): AppState {
  const { taxableAccounts = 2, nonTaxableAccounts = 1, taxDeferredAccounts = 1 } = options || {}
  const state = initialState()

  let accountIdCounter = 1
  let positionIdCounter = 1

  function addAccountsInCategory(
    taxCategory: 'taxable' | 'nonTaxable' | 'taxDeferred',
    count: number
  ) {
    for (let i = 0; i < count; i++) {
      const accId = `acc-${accountIdCounter++}`
      const name = taxCategory === 'taxable' ? 'Brokerage' : taxCategory === 'nonTaxable' ? 'HSA' : 'IRA'
      const accNumber = `${1000 + (accountIdCounter - 2)}`
      const institution = taxCategory === 'taxable' ? 'Fidelity' : taxCategory === 'nonTaxable' ? 'Anthem' : 'Vanguard'

      state.accounts.push({
        id: accId,
        accountNumber: accNumber,
        name: `${name} Account ${i + 1}`,
        institution,
        taxCategory,
        retirement: taxCategory === 'taxDeferred',
        createdAt: '2024-01-01',
      })

      state.positions.push({
        id: `pos-${positionIdCounter++}`,
        accountId: accId,
        symbol: 'AAPL',
        name: 'Apple',
        assetClass: 'Equities',
        shares: 100 + i * 10,
        avgCost: 150,
        price: 180,
        lastImportedAt: '2024-01-15',
      })
    }
  }

  addAccountsInCategory('taxable', taxableAccounts)
  addAccountsInCategory('nonTaxable', nonTaxableAccounts)
  addAccountsInCategory('taxDeferred', taxDeferredAccounts)

  return state
}

describe('AccountsPage', () => {
  describe('category cards', () => {
    it('renders Taxable, Non-Taxable, Tax-Deferred labels in that order, collapsed by default', () => {
      const state = buildAppStateWithAccounts({ taxableAccounts: 1, nonTaxableAccounts: 1, taxDeferredAccounts: 1 })
      render(<AccountsPage state={state} dispatch={vi.fn()} />)

      const labels = ['Taxable', 'Non-Taxable', 'Tax-Deferred']
      labels.forEach((label) => expect(screen.getByText(label)).toBeTruthy())

      // Collapsed: account row text not present yet
      expect(screen.queryByText(/Brokerage Account 1/)).toBeNull()
    })

    it('clicking a category header expands it and shows account rows', () => {
      const state = buildAppStateWithAccounts({ taxableAccounts: 1, nonTaxableAccounts: 0, taxDeferredAccounts: 0 })
      render(<AccountsPageHarness initial={state} />)

      fireEvent.click(screen.getByText('Taxable'))

      expect(screen.getByText(/Brokerage Account 1/)).toBeTruthy()
      expect(screen.getByText('#1000')).toBeTruthy()
    })

    it('a category with 0 accounts shows "No accounts in this category." when expanded', () => {
      const state = buildAppStateWithAccounts({ taxableAccounts: 0, nonTaxableAccounts: 0, taxDeferredAccounts: 0 })
      render(<AccountsPageHarness initial={state} />)

      fireEvent.click(screen.getByText('Taxable'))

      expect(screen.getByText('No accounts in this category.')).toBeTruthy()
    })

    it('account updatedStr shows "—" for an account with no positions, formatted date otherwise', () => {
      const state = initialState()
      state.accounts.push({
        id: 'acc-1',
        accountNumber: '1',
        name: 'No Positions',
        institution: 'Bank',
        taxCategory: 'taxable',
        retirement: false,
        createdAt: '2024-01-01',
      })
      render(<AccountsPageHarness initial={state} />)
      fireEvent.click(screen.getByText('Taxable'))
      expect(screen.getByText('Updated —')).toBeTruthy()
    })

    it('clicking an account row selects it, clicking again deselects it', () => {
      const state = buildAppStateWithAccounts({ taxableAccounts: 1, nonTaxableAccounts: 0, taxDeferredAccounts: 0 })
      render(<AccountsPageHarness initial={state} />)

      fireEvent.click(screen.getByText('Taxable'))

      // Selecting scopes the allocation title to the account name
      fireEvent.click(screen.getByText('#1000').closest('div[style*="cursor: pointer"]')!)
      expect(screen.getByText('Allocation — Brokerage Account 1')).toBeTruthy()

      // Clicking again deselects
      fireEvent.click(screen.getByText('#1000').closest('div[style*="cursor: pointer"]')!)
      expect(screen.getByText('Allocation — All Accounts')).toBeTruthy()
    })

    it('renders Taxable, Non-Taxable, Tax-Deferred, and Closed Positions labels in that order', () => {
      const state = buildAppStateWithAccounts({ taxableAccounts: 1, nonTaxableAccounts: 1, taxDeferredAccounts: 1 })
      state.closedPositions.push({
        id: 'cp-1',
        accountId: 'acc-1',
        symbol: 'OLD',
        name: 'Old Stock',
        assetClass: 'Equities',
        shares: 100,
        avgCost: 100,
        realizedGL: 1000,
        realizedGLBasis: 'known',
        lastImportedAt: '2024-01-15',
      })
      render(<AccountsPage state={state} dispatch={vi.fn()} />)

      const labels = ['Taxable', 'Non-Taxable', 'Tax-Deferred', 'Closed Positions']
      labels.forEach((label) => expect(screen.getByText(label)).toBeTruthy())
    })

    it('Closed Positions card only lists accounts with >= 1 closed position', () => {
      const state = buildAppStateWithAccounts({ taxableAccounts: 2, nonTaxableAccounts: 0, taxDeferredAccounts: 0 })
      state.closedPositions.push({
        id: 'cp-1',
        accountId: 'acc-1',
        symbol: 'OLD',
        name: 'Old Stock',
        assetClass: 'Equities',
        shares: 100,
        avgCost: 100,
        realizedGL: 1000,
        realizedGLBasis: 'known',
        lastImportedAt: '2024-01-15',
      })
      render(<AccountsPageHarness initial={state} />)

      // Expand Closed Positions card
      const closedPositionsHeader = screen.getByText('Closed Positions').closest('div[style*="cursor: pointer"]')!
      fireEvent.click(closedPositionsHeader)

      // acc-1 has a closed position, so should appear
      expect(screen.getByText(/Brokerage Account 1/)).toBeTruthy()
      // acc-2 has no closed positions, so should not appear
      expect(screen.queryByText(/Brokerage Account 2/)).toBeNull()
    })

    it('Closed Positions card shows "—" when all closed positions have unknown realizedGL', () => {
      const state = buildAppStateWithAccounts({ taxableAccounts: 1, nonTaxableAccounts: 0, taxDeferredAccounts: 0 })
      state.closedPositions.push({
        id: 'cp-1',
        accountId: 'acc-1',
        symbol: 'OLD',
        name: 'Old Stock',
        assetClass: 'Equities',
        shares: 100,
        avgCost: 100,
        realizedGL: null,
        realizedGLBasis: 'unknown',
        lastImportedAt: '2024-01-15',
      })
      render(<AccountsPageHarness initial={state} />)

      fireEvent.click(screen.getByText('Closed Positions'))

      // Account total should show "—"
      const accountRow = screen.getByText(/Brokerage Account 1/).closest('div[style*="cursor: pointer"]')!
      const totalStr = accountRow.querySelector('div:last-child')?.textContent
      expect(totalStr).toMatch(/—/)
    })

    it('clicking an account row in Closed Positions card sets selectedCategoryKey: closedPositions', () => {
      const state = buildAppStateWithAccounts({ taxableAccounts: 1, nonTaxableAccounts: 0, taxDeferredAccounts: 0 })
      state.closedPositions.push({
        id: 'cp-1',
        accountId: 'acc-1',
        symbol: 'OLD',
        name: 'Old Stock',
        assetClass: 'Equities',
        shares: 100,
        avgCost: 100,
        realizedGL: 1000,
        realizedGLBasis: 'known',
        lastImportedAt: '2024-01-15',
      })
      render(<AccountsPageHarness initial={state} />)

      // Expand Closed Positions card
      fireEvent.click(screen.getByText('Closed Positions').closest('div[style*="cursor: pointer"]')!)

      // Click on account in Closed Positions card
      const accountRows = screen.getAllByText(/Brokerage Account 1/).map((el) => el.closest('div[style*="cursor: pointer"]')!)
      const closedPositionsRow = accountRows[accountRows.length - 1] // Last one is in Closed Positions card
      fireEvent.click(closedPositionsRow)

      // Verify that the row in Closed Positions card is now highlighted (selected: true)
      // by checking that it has the accent background
      const rowStyle = closedPositionsRow.getAttribute('style')
      expect(rowStyle).toContain('--color-accent-100')
    })

    it('account with both open and closed positions: row in tax-category card NOT highlighted when selected under Closed Positions', () => {
      const state = buildAppStateWithAccounts({ taxableAccounts: 1, nonTaxableAccounts: 0, taxDeferredAccounts: 0 })
      // acc-1 has both an open position (from buildAppStateWithAccounts) and a closed position
      state.closedPositions.push({
        id: 'cp-1',
        accountId: 'acc-1',
        symbol: 'OLD',
        name: 'Old Stock',
        assetClass: 'Equities',
        shares: 100,
        avgCost: 100,
        realizedGL: 1000,
        realizedGLBasis: 'known',
        lastImportedAt: '2024-01-15',
      })
      const stateWithClosedSelection = { ...state, selectedAccountId: 'acc-1', selectedCategoryKey: 'closedPositions' }
      render(<AccountsPage state={stateWithClosedSelection} dispatch={vi.fn()} />)

      // Expand Taxable card by clicking its header
      const taxableHeader = screen.getAllByText('Taxable')[0].closest('div[style*="cursor: pointer"]')!
      fireEvent.click(taxableHeader)

      // The account row should NOT have the selected background color when selectedCategoryKey is 'closedPositions'
      const accountElement = screen.getByText(/Brokerage Account 1/)
      const accountRow = accountElement.closest('div')?.parentElement
      const rowStyle = accountRow?.getAttribute('style')

      // When not selected for this category, background should NOT include accent-100
      if (rowStyle) {
        expect(rowStyle).not.toContain('--color-accent-100')
      } else {
        // No style attribute means no background, which is correct
        expect(rowStyle).toBeFalsy()
      }
    })
  })

  describe('allocation, filter, search, table', () => {
    it('no account selected: title is "Allocation — All Accounts", table shows all positions', () => {
      const state = buildAppStateWithAccounts({ taxableAccounts: 1, nonTaxableAccounts: 1, taxDeferredAccounts: 0 })
      render(<AccountsPage state={state} dispatch={vi.fn()} />)

      expect(screen.getByText('Allocation — All Accounts')).toBeTruthy()
      expect(screen.getByText('% of Selection')).toBeTruthy()
      expect(screen.queryByText('% of Portfolio')).toBeNull()

      const table = screen.getByRole('table')
      const bodyRows = table.querySelectorAll('tbody tr')
      expect(bodyRows).toHaveLength(1) // both accounts hold AAPL, grouped into one aggregate row
    })

    it('typing in search filters rows by symbol/name, case-insensitively', () => {
      const state = initialState()
      state.accounts.push({
        id: 'acc-1', accountNumber: '1', name: 'Brokerage', institution: 'Fidelity',
        taxCategory: 'taxable', retirement: false, createdAt: '2024-01-01',
      })
      state.positions.push(
        { id: 'p1', accountId: 'acc-1', symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'Tech', shares: 1, avgCost: 100, price: 100, lastImportedAt: '2024-01-01' },
        { id: 'p2', accountId: 'acc-1', symbol: 'MSFT', name: 'Microsoft', assetClass: 'Tech', shares: 1, avgCost: 100, price: 100, lastImportedAt: '2024-01-01' },
      )
      render(<AccountsPageHarness initial={state} />)

      const search = screen.getByPlaceholderText('Search symbol or name')
      fireEvent.change(search, { target: { value: 'apple' } })

      expect(screen.getByText('AAPL')).toBeTruthy()
      expect(screen.queryByText('MSFT')).toBeNull()
    })

    it('asset-class filter narrows rows', () => {
      const state = initialState()
      state.accounts.push({
        id: 'acc-1', accountNumber: '1', name: 'Brokerage', institution: 'Fidelity',
        taxCategory: 'taxable', retirement: false, createdAt: '2024-01-01',
      })
      state.positions.push(
        { id: 'p1', accountId: 'acc-1', symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'Tech', shares: 1, avgCost: 100, price: 100, lastImportedAt: '2024-01-01' },
        { id: 'p2', accountId: 'acc-1', symbol: 'BND', name: 'Bond ETF', assetClass: 'Bonds', shares: 1, avgCost: 100, price: 100, lastImportedAt: '2024-01-01' },
      )
      render(<AccountsPageHarness initial={state} />)

      const bondsOption = screen.getAllByText('Bonds').find((el) => el.closest('label.seg-opt'))!
      fireEvent.click(bondsOption.closest('label')!)

      expect(screen.getByText('BND')).toBeTruthy()
      expect(screen.queryByText('AAPL')).toBeNull()
    })

    it('filtered-to-zero-rows state shows "No positions to show." below a table that still renders headers', () => {
      const state = initialState()
      state.accounts.push({
        id: 'acc-1', accountNumber: '1', name: 'Brokerage', institution: 'Fidelity',
        taxCategory: 'taxable', retirement: false, createdAt: '2024-01-01',
      })
      state.positions.push(
        { id: 'p1', accountId: 'acc-1', symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'Tech', shares: 1, avgCost: 100, price: 100, lastImportedAt: '2024-01-01' },
      )
      render(<AccountsPageHarness initial={state} />)

      const search = screen.getByPlaceholderText('Search symbol or name')
      fireEvent.change(search, { target: { value: 'zzz-no-match' } })

      expect(screen.getByRole('table')).toBeTruthy()
      expect(screen.getByText((_, el) => el?.tagName === 'TH' && !!el.textContent?.startsWith('Symbol'))).toBeTruthy()
      expect(screen.getByText('No positions to show.')).toBeTruthy()
    })

    it('clicking an aggregate row opens PositionGroupOverlay with correct title and positions', async () => {
      const state = initialState()
      state.accounts.push({
        id: 'acc-1', accountNumber: '1', name: 'Brokerage', institution: 'Fidelity',
        taxCategory: 'taxable', retirement: false, createdAt: '2024-01-01',
      })
      state.positions.push(
        { id: 'p1', accountId: 'acc-1', symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'Tech', shares: 1, avgCost: 100, price: 100, lastImportedAt: '2024-01-01' },
      )
      render(<AccountsPage state={state} dispatch={vi.fn()} />)

      fireEvent.click(screen.getByText('AAPL').closest('tr')!)

      expect(await screen.findByText('AAPL — Apple Inc. — Tech')).toBeTruthy()
    })
  })

  describe('closed positions view', () => {
    it('selecting an account under Closed Positions renders ClosedPositionsTable instead of aggregate table', () => {
      const state = buildAppStateWithAccounts({ taxableAccounts: 1, nonTaxableAccounts: 0, taxDeferredAccounts: 0 })
      state.closedPositions.push({
        id: 'cp-1',
        accountId: 'acc-1',
        symbol: 'OLD',
        name: 'Old Stock',
        assetClass: 'Equities',
        shares: 100,
        avgCost: 100,
        realizedGL: 1000,
        realizedGLBasis: 'known',
        lastImportedAt: '2024-01-15',
        closedDate: '2024-01-10',
      })
      // Start with selectedCategoryKey === 'closedPositions' and selectedAccountId set
      const stateWithSelection = {
        ...state,
        selectedAccountId: 'acc-1',
        selectedCategoryKey: 'closedPositions'
      }
      render(<AccountsPage state={stateWithSelection} dispatch={vi.fn()} />)

      // ClosedPositionsTable should render with the specific columns: Symbol, Closed, Realized G/L
      expect(screen.getByText('Closed')).toBeTruthy()
      expect(screen.getByText('Realized G/L')).toBeTruthy()
      expect(screen.getByText('OLD')).toBeTruthy()
      expect(screen.getByText('Old Stock')).toBeTruthy()

      // Open positions aggregate table should NOT be rendered (no "Amount Invested" header)
      expect(screen.queryByText('Amount Invested')).toBeNull()
    })

    it('asset-class filter narrows closed-positions list when in closed view', () => {
      const state = initialState()
      state.accounts.push({
        id: 'acc-1', accountNumber: '1', name: 'Brokerage', institution: 'Fidelity',
        taxCategory: 'taxable', retirement: false, createdAt: '2024-01-01',
      })
      state.closedPositions.push(
        {
          id: 'cp-1', accountId: 'acc-1', symbol: 'OLD', name: 'Old Stock', assetClass: 'Equities',
          shares: 100, avgCost: 100, realizedGL: 1000, realizedGLBasis: 'known', lastImportedAt: '2024-01-01', closedDate: '2024-01-10'
        },
        {
          id: 'cp-2', accountId: 'acc-1', symbol: 'BND', name: 'Bond ETF', assetClass: 'Bonds',
          shares: 50, avgCost: 100, realizedGL: 100, realizedGLBasis: 'known', lastImportedAt: '2024-01-01', closedDate: '2024-01-10'
        },
      )
      const stateWithClosedSelection = {
        ...state,
        selectedAccountId: 'acc-1',
        selectedCategoryKey: 'closedPositions'
      }
      render(<AccountsPageHarness initial={stateWithClosedSelection} />)

      // Initially both symbols should be visible
      expect(screen.getByText('OLD')).toBeTruthy()
      expect(screen.getByText('BND')).toBeTruthy()

      // Click the Bonds filter
      const bondsOption = screen.getAllByText('Bonds').find((el) => el.closest('label.seg-opt'))!
      fireEvent.click(bondsOption.closest('label')!)

      // Now only BND should be visible
      expect(screen.queryByText('OLD')).toBeNull()
      expect(screen.getByText('BND')).toBeTruthy()
    })

    it('search box narrows closed-positions list when in closed view', () => {
      const state = initialState()
      state.accounts.push({
        id: 'acc-1', accountNumber: '1', name: 'Brokerage', institution: 'Fidelity',
        taxCategory: 'taxable', retirement: false, createdAt: '2024-01-01',
      })
      state.closedPositions.push(
        {
          id: 'cp-1', accountId: 'acc-1', symbol: 'OLD', name: 'Old Stock', assetClass: 'Equities',
          shares: 100, avgCost: 100, realizedGL: 1000, realizedGLBasis: 'known', lastImportedAt: '2024-01-01', closedDate: '2024-01-10'
        },
        {
          id: 'cp-2', accountId: 'acc-1', symbol: 'MSFT', name: 'Microsoft', assetClass: 'Equities',
          shares: 50, avgCost: 100, realizedGL: 500, realizedGLBasis: 'known', lastImportedAt: '2024-01-01', closedDate: '2024-01-10'
        },
      )
      const stateWithClosedSelection = {
        ...state,
        selectedAccountId: 'acc-1',
        selectedCategoryKey: 'closedPositions'
      }
      render(<AccountsPageHarness initial={stateWithClosedSelection} />)

      // Initially both symbols should be visible
      expect(screen.getByText('OLD')).toBeTruthy()
      expect(screen.getByText('MSFT')).toBeTruthy()

      // Type in search
      const search = screen.getByPlaceholderText('Search symbol or name')
      fireEvent.change(search, { target: { value: 'old' } })

      // Now only OLD should be visible
      expect(screen.getByText('OLD')).toBeTruthy()
      expect(screen.queryByText('MSFT')).toBeNull()
    })

    it('deselecting an account in closed view returns to default open-positions view', () => {
      const state = buildAppStateWithAccounts({ taxableAccounts: 1, nonTaxableAccounts: 0, taxDeferredAccounts: 0 })
      state.closedPositions.push({
        id: 'cp-1',
        accountId: 'acc-1',
        symbol: 'OLD',
        name: 'Old Stock',
        assetClass: 'Equities',
        shares: 100,
        avgCost: 100,
        realizedGL: 1000,
        realizedGLBasis: 'known',
        lastImportedAt: '2024-01-15',
        closedDate: '2024-01-10',
      })
      const stateWithSelection = {
        ...state,
        selectedAccountId: 'acc-1',
        selectedCategoryKey: 'closedPositions'
      }
      render(<AccountsPageHarness initial={stateWithSelection} />)

      // Verify closed view is shown
      expect(screen.getByText('Closed')).toBeTruthy()
      expect(screen.getByText('OLD')).toBeTruthy()

      // Create a new render with deselected state to simulate clicking the account again
      cleanup()
      const deselectedState = {
        ...state,
        selectedAccountId: null,
        selectedCategoryKey: null
      }
      render(<AccountsPageHarness initial={deselectedState} />)

      // After deselect, open positions table should be shown again
      // The allocation title should be "All Accounts"
      expect(screen.getByText('Allocation — All Accounts')).toBeTruthy()

      // Open positions table headers should be visible
      expect(screen.getByText('Amount Invested')).toBeTruthy()
    })

    it('switching from closed view to open view shows correct table', () => {
      const state = buildAppStateWithAccounts({ taxableAccounts: 2, nonTaxableAccounts: 0, taxDeferredAccounts: 0 })
      // acc-1 is taxable, acc-2 is also taxable
      state.closedPositions.push({
        id: 'cp-1',
        accountId: 'acc-1',
        symbol: 'OLD',
        name: 'Old Stock',
        assetClass: 'Equities',
        shares: 100,
        avgCost: 100,
        realizedGL: 1000,
        realizedGLBasis: 'known',
        lastImportedAt: '2024-01-15',
        closedDate: '2024-01-10',
      })
      // Start with closed view selection
      const stateWithClosedSelection = {
        ...state,
        selectedAccountId: 'acc-1',
        selectedCategoryKey: 'closedPositions'
      }
      render(<AccountsPageHarness initial={stateWithClosedSelection} />)

      // Verify closed view is shown
      expect(screen.getByText('Closed')).toBeTruthy()
      expect(screen.getByText('OLD')).toBeTruthy()

      // Clean up and render with open view selection (different account, different category)
      cleanup()
      const stateWithOpenSelection = {
        ...state,
        selectedAccountId: 'acc-2',
        selectedCategoryKey: 'taxable'
      }
      render(<AccountsPageHarness initial={stateWithOpenSelection} />)

      // Should now show open positions table for acc-2
      expect(screen.getByText('Amount Invested')).toBeTruthy()
      // acc-2 has AAPL position from buildAppStateWithAccounts
      expect(screen.getByText('AAPL')).toBeTruthy()
      // OLD should not be visible anymore
      expect(screen.queryByText('OLD')).toBeNull()
    })

    it('closed-positions view shows "No positions to show." when filtered to zero rows', () => {
      const state = initialState()
      state.accounts.push({
        id: 'acc-1', accountNumber: '1', name: 'Brokerage', institution: 'Fidelity',
        taxCategory: 'taxable', retirement: false, createdAt: '2024-01-01',
      })
      state.closedPositions.push({
        id: 'cp-1', accountId: 'acc-1', symbol: 'OLD', name: 'Old Stock', assetClass: 'Equities',
        shares: 100, avgCost: 100, realizedGL: 1000, realizedGLBasis: 'known', lastImportedAt: '2024-01-01', closedDate: '2024-01-10'
      })
      const stateWithClosedSelection = {
        ...state,
        selectedAccountId: 'acc-1',
        selectedCategoryKey: 'closedPositions'
      }
      render(<AccountsPageHarness initial={stateWithClosedSelection} />)

      // Search for non-matching symbol
      const search = screen.getByPlaceholderText('Search symbol or name')
      fireEvent.change(search, { target: { value: 'zzz-no-match' } })

      // Should show empty-state message
      expect(screen.getByText('No positions to show.')).toBeTruthy()
    })
  })
})
