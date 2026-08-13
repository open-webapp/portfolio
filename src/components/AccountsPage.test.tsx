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
})
