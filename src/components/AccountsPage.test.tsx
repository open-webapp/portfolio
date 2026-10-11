import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { useReducer, useState } from 'react'
import { AccountsPage, type AccountsPageProps } from './AccountsPage'
import { appReducer, type AppAction } from '../lib/reducer'
import { initialState, type AppState, type PositionsTab } from '../lib/state'

vi.mock('../lib/marketDataDb', () => ({
  getAllBars: vi.fn().mockResolvedValue([]),
  getAllTickerOverviews: vi.fn().mockResolvedValue([]),
}))

afterEach(cleanup)

/**
 * Renders AccountsPage wired to a real reducer, so clicks that dispatch
 * actions (select account, filter, search) actually update the rendered UI.
 */
function AccountsPageHarness({
  initial,
  positionsTab,
  tickerOverviewErrors = {},
}: {
  initial: AppState
  positionsTab: PositionsTab
  tickerOverviewErrors?: Record<string, string>
}) {
  const [state, dispatch] = useReducer(appReducer, initial)
  return (
    <AccountsPage
      state={state}
      dispatch={dispatch as (action: AppAction) => void}
      positionsTab={positionsTab}
      tickerOverviewErrors={tickerOverviewErrors}
    />
  )
}

function renderPage(props: Omit<AccountsPageProps, 'tickerOverviewErrors'> & { tickerOverviewErrors?: Record<string, string> }) {
  return render(<AccountsPage tickerOverviewErrors={{}} {...props} />)
}

function TabChangingHarness({ initial }: { initial: AppState }) {
  const [positionsTab, setPositionsTab] = useState<PositionsTab>('taxable')
  return (
    <>
      <button type="button" onClick={() => setPositionsTab('nonTaxable')}>Change tab</button>
      <AccountsPage state={initial} dispatch={vi.fn()} positionsTab={positionsTab} tickerOverviewErrors={{}} />
    </>
  )
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
  describe('category card (left nav, single tab)', () => {
    it('renders only the Taxable category block when positionsTab is taxable, and its accounts are always visible', () => {
      const state = buildAppStateWithAccounts({ taxableAccounts: 1, nonTaxableAccounts: 1, taxDeferredAccounts: 1 })
      renderPage({ state, dispatch: vi.fn(), positionsTab: 'taxable' })

      expect(screen.getByText('Taxable')).toBeTruthy()
      expect(screen.queryByText('Non-Taxable')).toBeNull()
      expect(screen.queryByText('Tax-Deferred')).toBeNull()

      // Accounts always show, no expand click needed
      expect(screen.getByText(/Brokerage Account 1/)).toBeTruthy()
    })

    it('renders only the Non-Taxable category block when positionsTab is nonTaxable', () => {
      const state = buildAppStateWithAccounts({ taxableAccounts: 1, nonTaxableAccounts: 1, taxDeferredAccounts: 1 })
      renderPage({ state, dispatch: vi.fn(), positionsTab: 'nonTaxable' })

      expect(screen.getByText('Non-Taxable')).toBeTruthy()
      expect(screen.queryByText('Taxable')).toBeNull()
      expect(screen.getByText(/HSA Account 1/)).toBeTruthy()
    })

    it('renders only the Tax-Deferred category block when positionsTab is taxDeferred', () => {
      const state = buildAppStateWithAccounts({ taxableAccounts: 1, nonTaxableAccounts: 1, taxDeferredAccounts: 1 })
      renderPage({ state, dispatch: vi.fn(), positionsTab: 'taxDeferred' })

      expect(screen.getByText('Tax-Deferred')).toBeTruthy()
      expect(screen.queryByText('Taxable')).toBeNull()
      expect(screen.getByText(/IRA Account 1/)).toBeTruthy()
    })

    it('a category with 0 accounts shows "No accounts in this category."', () => {
      const state = buildAppStateWithAccounts({ taxableAccounts: 0, nonTaxableAccounts: 0, taxDeferredAccounts: 0 })
      renderPage({ state, dispatch: vi.fn(), positionsTab: 'taxable' })

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
      renderPage({ state, dispatch: vi.fn(), positionsTab: 'taxable' })
      expect(screen.getByText('Updated —')).toBeTruthy()
    })

    it('clicking an account row dispatches SELECT_ACCOUNT and highlights it, clicking again deselects it', () => {
      const state = buildAppStateWithAccounts({ taxableAccounts: 1, nonTaxableAccounts: 0, taxDeferredAccounts: 0 })
      render(<AccountsPageHarness initial={state} positionsTab="taxable" />)

      // Selecting scopes the KPI row to the account.
      fireEvent.click(screen.getByText('#1000').closest('div[style*="cursor: pointer"]')!)
      expect(screen.getByText('1 position · 1 account')).toBeTruthy()

      // Clicking again deselects
      fireEvent.click(screen.getByText('#1000').closest('div[style*="cursor: pointer"]')!)
      expect(screen.getByText('1 position · 1 account')).toBeTruthy()
    })
  })

  describe('closed positions mode', () => {
    function stateWithClosedPosition() {
      const state = buildAppStateWithAccounts({ taxableAccounts: 1, nonTaxableAccounts: 1, taxDeferredAccounts: 0 })
      state.closedPositions.push({
        id: 'cp-1', accountId: 'acc-1', symbol: 'OLD', name: 'Old Stock', assetClass: 'Equities',
        shares: 100, avgCost: 100, realizedGL: 1000, realizedGLBasis: 'known',
        lastImportedAt: '2024-01-15', closedDate: '2024-01-10',
      })
      return state
    }

    it('opens from the Closed positions button and returns to the positions list with Back', () => {
      render(<AccountsPageHarness initial={stateWithClosedPosition()} positionsTab="taxable" />)

      fireEvent.click(screen.getByRole('button', { name: 'Closed positions' }))
      expect(screen.getAllByTestId('positions-kpi-card')).toHaveLength(3)
      expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: 'Back' }))
      expect(screen.getByText('Amount Invested')).toBeTruthy()
      expect(screen.queryByText('Closed')).toBeNull()
    })

    it('resets closed mode when the positions tab changes', () => {
      render(<TabChangingHarness initial={stateWithClosedPosition()} />)

      fireEvent.click(screen.getByRole('button', { name: 'Closed positions' }))
      expect(screen.getAllByTestId('positions-kpi-card')).toHaveLength(3)
      fireEvent.click(screen.getByRole('button', { name: 'Change tab' }))

      expect(screen.getByText('Non-Taxable')).toBeTruthy()
      expect(screen.getByText('Amount Invested')).toBeTruthy()
    })

    it('shows the closed account list, search, and undo/delete table controls without a close-position button', () => {
      render(<AccountsPageHarness initial={stateWithClosedPosition()} positionsTab="taxable" />)

      fireEvent.click(screen.getByRole('button', { name: 'Closed positions' }))

      expect(screen.getByText(/Brokerage Account 1/)).toBeTruthy()
      expect(screen.queryByText(/HSA Account 1/)).toBeNull()
      expect(screen.getByPlaceholderText('Search symbol or name')).toBeTruthy()
      expect(screen.getByText('OLD')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Reopen this position as an import' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Delete this closed position' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Close a position' })).toBeNull()
    })
  })

  describe('allocation, filter, search, table', () => {
    it('no account selected: title includes tab label, table shows all positions scoped to that tab', () => {
      const state = buildAppStateWithAccounts({ taxableAccounts: 1, nonTaxableAccounts: 1, taxDeferredAccounts: 0 })
      renderPage({ state, dispatch: vi.fn(), positionsTab: 'taxable' })

      expect(screen.getByText('% of Selection')).toBeTruthy()
      expect(screen.queryByText('% of Portfolio')).toBeNull()

      const table = screen.getByRole('table')
      const bodyRows = table.querySelectorAll('tbody tr')
      // Only the taxable account's AAPL position is in scope
      expect(bodyRows).toHaveLength(1)
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
      render(<AccountsPageHarness initial={state} positionsTab="taxable" />)

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
      render(<AccountsPageHarness initial={state} positionsTab="taxable" />)

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
      render(<AccountsPageHarness initial={state} positionsTab="taxable" />)

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
      renderPage({ state, dispatch: vi.fn(), positionsTab: 'taxable' })

      fireEvent.click(screen.getByText('AAPL').closest('tr')!)

      expect(await screen.findByText('AAPL — Apple Inc. — Tech')).toBeTruthy()
    })
  })

  describe('quotes tab', () => {
    it('renders QuotesPage full-width with no left nav when positionsTab is quotes', () => {
      const state = buildAppStateWithAccounts({ taxableAccounts: 1, nonTaxableAccounts: 1, taxDeferredAccounts: 1 })
      renderPage({ state, dispatch: vi.fn(), positionsTab: 'quotes' })

      // No category labels from the left nav
      expect(screen.queryByText('Taxable')).toBeNull()
      expect(screen.queryByText('Non-Taxable')).toBeNull()
      expect(screen.queryByText('Tax-Deferred')).toBeNull()
      expect(screen.queryByText('Closed Positions')).toBeNull()
    })

    it('passes tickerOverviewErrors through to QuotesPage without crashing', () => {
      const state = buildAppStateWithAccounts({ taxableAccounts: 1, nonTaxableAccounts: 0, taxDeferredAccounts: 0 })
      renderPage({ state, dispatch: vi.fn(), positionsTab: 'quotes', tickerOverviewErrors: { AAPL: 'Quote fetch failed' } })

      // No crash; left-nav categories still absent
      expect(screen.queryByText('Taxable')).toBeNull()
    })
  })
})
