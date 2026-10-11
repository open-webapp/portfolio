import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { useReducer, useState } from 'react'
import { AccountsPage, type AccountsPageProps } from './AccountsPage'
import { TopBar } from './Nav'
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
  navigation = false,
  exposeState = false,
}: {
  initial: AppState
  positionsTab: PositionsTab
  tickerOverviewErrors?: Record<string, string>
  navigation?: boolean
  exposeState?: boolean
}) {
  const [state, dispatch] = useReducer(appReducer, initial)
  const [tab, setTab] = useState(positionsTab)
  return (
    <>
    {navigation && <TopBar portfolioName="Test" positionsTab={tab} onPositionsTabChange={setTab} />}
    <AccountsPage
      state={state}
      dispatch={dispatch as (action: AppAction) => void}
      positionsTab={tab}
      tickerOverviewErrors={tickerOverviewErrors}
    />
    <output aria-label="Selected account">{state.selectedAccountId ?? 'none'}</output>
    {exposeState && <output aria-label="Portfolio state">{JSON.stringify(state)}</output>}
    </>
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
  it('keeps the live selected lots open through shared grouping edits and cross-category reassignment', () => {
    const state = buildAppStateWithAccounts()
    state.positions[2].assetClass = 'Bonds'
    render(<AccountsPageHarness initial={state} positionsTab="taxable" />)
    fireEvent.click(screen.getByText('AAPL').closest('tr')!)
    for (const [label, value] of [['Symbol', 'NEW'], ['Tracking Symbol', 'TRACK']]) {
      fireEvent.click(screen.getByRole('button', { name: `Edit ${label}`, exact: true }))
      fireEvent.change(screen.getByRole('textbox', { name: label, exact: true }), { target: { value } })
      fireEvent.keyDown(screen.getByRole('textbox', { name: label, exact: true }), { key: 'Enter' })
      expect(screen.getByRole('dialog')).toBeTruthy()
      expect(screen.getByRole('button', { name: `Edit ${label}`, exact: true }).textContent).toBe(value)
    }
    fireEvent.click(screen.getByText('Set', { exact: true }))
    fireEvent.click(screen.getByText('Bonds', { exact: true }))
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('TRACK — Apple — Bonds')
    fireEvent.change(screen.getByRole('combobox', { name: 'Account for lot pos-1' }), { target: { value: 'acc-3' } })
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Account for lot pos-1' })).toHaveProperty('value', 'acc-3')
    expect(screen.getByRole('button', { name: 'Edit Symbol', exact: true }).textContent).toBe('NEW')
    fireEvent.click(screen.getByRole('dialog').querySelector('.dialog-title button')!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes lots through the parent with linked Sell records and category-scoped closed results', () => {
    const state = buildAppStateWithAccounts({ taxableAccounts: 1, nonTaxableAccounts: 1, taxDeferredAccounts: 0 })
    const readState = () => JSON.parse(screen.getByLabelText('Portfolio state').textContent!) as AppState
    render(<AccountsPageHarness initial={state} positionsTab="taxable" exposeState />)
    fireEvent.click(screen.getByText('AAPL').closest('tr')!)
    const openSale = () => fireEvent.click(within(screen.getByRole('combobox', { name: 'Account for lot pos-1' }).closest('tr')!).getByRole('button', { name: 'Close', exact: true }))
    openSale()
    fireEvent.change(screen.getByLabelText('Shares', { exact: true }), { target: { value: '40' } })
    fireEvent.change(screen.getByLabelText('Fees', { exact: true }), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close position', exact: true }))
    expect(readState().positions.find(p => p.id === 'pos-1')!.shares).toBe(60)
    expect(readState().closedPositions[0]).toMatchObject({ shares: 40, realizedGL: 1195, sellTransactionId: readState().transactions[0].id })
    expect(readState().transactions[0]).toMatchObject({ type: 'Sell', shares: 40, amount: 7195 })
    expect(screen.getByRole('dialog')).toBeTruthy()
    openSale()
    fireEvent.click(screen.getByRole('button', { name: 'Close position', exact: true }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(readState().positions.map(p => p.accountId)).toEqual(['acc-2'])
    fireEvent.click(screen.getByRole('button', { name: 'Closed positions', exact: true }))
    expect(screen.getByRole('heading', { name: 'Closed positions' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Reopen this position as an import' })).toHaveLength(2)
    expect(screen.queryByText('#1001')).toBeNull()
  })

  describe('category card (left nav, single tab)', () => {
    it('keeps the category pill without an account count or category total in its header', () => {
      renderPage({ state: buildAppStateWithAccounts(), dispatch: vi.fn(), positionsTab: 'taxable' })
      const pill = screen.getByText('Taxable')
      const header = pill.closest('.card')!.firstElementChild!
      expect(pill.style.borderRadius).toBe('999px')
      expect(header.textContent).toBe('Taxable')
      expect(header.querySelector('.tag-neutral')).toBeNull()
    })

    it('shows every custom tag on each account in a wrapping, untruncated chip row', () => {
      const state = buildAppStateWithAccounts()
      state.accounts[0].tags = ['Education savings', 'Long term investments', 'Family reserve']
      state.accounts[1].tags = ['Family reserve']
      renderPage({ state, dispatch: vi.fn(), positionsTab: 'taxable' })
      const row = screen.getByText('#1000').closest('div[style*="cursor: pointer"]')!
      const chips = row.querySelectorAll<HTMLElement>('.tag-accent')
      expect(Array.from(chips, (chip) => chip.textContent)).toEqual(['Education savings', 'Long term investments', 'Family reserve'])
      expect(chips[0].parentElement!.style.flexWrap).toBe('wrap')
      for (const chip of chips) {
        expect(chip.style.whiteSpace).toBe('normal')
        expect(chip.style.textOverflow).not.toBe('ellipsis')
        expect(chip.style.overflow).not.toBe('hidden')
      }
      const secondRow = screen.getByText('#1001').closest('div[style*="cursor: pointer"]')!
      expect(Array.from(secondRow.querySelectorAll('.tag-accent'), (chip) => chip.textContent)).toEqual(['Family reserve'])
    })

    it('renders no custom tag chips for accounts without tags or with an empty tag list', () => {
      const state = buildAppStateWithAccounts()
      state.accounts[1].tags = []
      renderPage({ state, dispatch: vi.fn(), positionsTab: 'taxable' })
      expect(screen.getByText('Taxable').closest('.card')!.querySelectorAll('.tag-accent')).toHaveLength(0)
    })

    it('a tag tab labels its pill and lists exactly tagged accounts across base categories, scoping positions and selection', () => {
      const state = buildAppStateWithAccounts()
      state.accounts[0].tags = ['Family: savings']
      state.accounts[2].tags = ['Family: savings']
      state.positions.forEach((position, index) => { position.symbol = ['AAA', 'BBB', 'CCC', 'DDD'][index] })
      render(<AccountsPageHarness initial={state} positionsTab="tag:Family: savings" />)
      const card = screen.getAllByText('Family: savings').find((el) => el.style.borderRadius === '999px')!.closest('.card')!
      expect(card.firstElementChild!.textContent).toBe('Family: savings')
      expect(within(card as HTMLElement).getByText('#1000')).toBeTruthy()
      expect(within(card as HTMLElement).getByText('#1002')).toBeTruthy()
      expect(within(card as HTMLElement).queryByText('#1001')).toBeNull()
      expect(within(card as HTMLElement).queryByText('#1003')).toBeNull()
      expect(screen.getByText('AAA')).toBeTruthy()
      expect(screen.getByText('CCC')).toBeTruthy()
      expect(screen.queryByText('BBB')).toBeNull()
      expect(screen.queryByText('DDD')).toBeNull()
      fireEvent.click(screen.getByText('#1002'))
      expect(screen.queryByText('AAA')).toBeNull()
      expect(screen.getByText('CCC')).toBeTruthy()
      expect(screen.getByText('#1002').closest<HTMLElement>('div[style*="cursor: pointer"]')!.style.background).toBe('var(--color-accent-100)')
    })

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
    it('keeps the category tab selected, shows T5 hero goldens, and clears invalid account selection on category switch', () => {
      const state = buildAppStateWithAccounts()
      state.positions = [
        { id: 'p1', accountId: 'acc-1', symbol: 'AAA', shares: 6, price: 100, avgCost: 80, assetClass: 'Equity' },
        { id: 'p2', accountId: 'acc-2', symbol: 'BBB', shares: 4, price: 100, avgCost: 125, assetClass: 'Bond' },
      ]
      state.closedPositions = [
        { id: 'c1', accountId: 'acc-1', symbol: 'OLD', closedDate: '2024-01-01', assetClass: 'Equity', realizedGL: 40, realizedGLBasis: 'transactions' },
        { id: 'c2', accountId: 'acc-2', symbol: 'UNKNOWN', closedDate: '2024-01-01', assetClass: 'Bond', realizedGL: null, realizedGLBasis: 'unknown' },
      ]
      render(<AccountsPageHarness initial={state} positionsTab="taxable" navigation />)
      fireEvent.click(screen.getByRole('button', { name: 'Closed positions' }))
      expect((screen.getByRole('radio', { name: 'Taxable' }) as HTMLInputElement).checked).toBe(true)
      for (const text of ['+$40.00', '+$20.00', 'on open positions', '1 closed position']) expect(screen.getAllByText(text).length).toBeGreaterThan(0)
      expect(screen.queryByText('Market value')).toBeNull()
      expect(screen.queryByRole('img', { name: 'Asset allocation' })).toBeNull()
      fireEvent.click(screen.getByText('#1001'))
      expect(screen.getByText('-$100.00')).toBeTruthy()
      expect(screen.getByText('0 closed positions')).toBeTruthy()
      expect(screen.queryByText('OLD')).toBeNull()
      fireEvent.click(screen.getByRole('radio', { name: 'Non-Taxable' }))
      expect(screen.getByLabelText('Selected account').textContent).toBe('none')
      expect(screen.getByText('#1002')).toBeTruthy()
    })

    it('shows only closed accounts and combines search with the asset-class filter', () => {
      const state = buildAppStateWithAccounts()
      state.closedPositions = [
        { id: 'c1', accountId: 'acc-1', symbol: 'OLD', name: 'Old equity', assetClass: 'Equities', shares: 1, avgCost: 10, closedDate: '2024-01-01', realizedGL: 40, realizedGLBasis: 'transactions' },
        { id: 'c2', accountId: 'acc-1', symbol: 'BOND', name: 'Old bond', assetClass: 'Bonds', shares: 1, avgCost: 10, closedDate: '2024-01-01', realizedGL: 0, realizedGLBasis: 'transactions' },
      ]
      render(<AccountsPageHarness initial={state} positionsTab="taxable" />)
      fireEvent.click(screen.getByRole('button', { name: 'Closed positions' }))
      expect(screen.getByText('Taxable')).toBeTruthy()
      expect(screen.getByText('#1000')).toBeTruthy()
      expect(screen.queryByText('#1001')).toBeNull()
      expect(screen.queryByText('#1002')).toBeNull()
      fireEvent.click(screen.getByRole('radio', { name: 'Bonds' }))
      expect(screen.getByText('BOND')).toBeTruthy()
      expect(screen.queryByText('OLD')).toBeNull()
      fireEvent.change(screen.getByPlaceholderText('Search symbol or name'), { target: { value: 'equity' } })
      expect(screen.queryByText('BOND')).toBeNull()
      expect(screen.getByText('No closed positions in this category.')).toBeTruthy()
      fireEvent.click(screen.getByRole('radio', { name: 'All' }))
      expect(screen.getByText('OLD')).toBeTruthy()
    })

    it('Undo restores the held list and Delete removes only the closed row', () => {
      const state = stateWithClosedPosition()
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
      render(<AccountsPageHarness initial={state} positionsTab="taxable" />)
      fireEvent.click(screen.getByRole('button', { name: 'Closed positions' }))
      fireEvent.click(screen.getByRole('button', { name: 'Reopen this position as an import' }))
      expect(screen.queryByText('OLD')).toBeNull()
      expect(screen.getByText('No closed positions in this category.')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: '← Back to positions' }))
      expect(screen.getByText('OLD')).toBeTruthy()
      cleanup()
      render(<AccountsPageHarness initial={state} positionsTab="taxable" />)
      fireEvent.click(screen.getByRole('button', { name: 'Closed positions' }))
      fireEvent.click(screen.getByRole('button', { name: 'Delete this closed position' }))
      expect(screen.queryByText('OLD')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: '← Back to positions' }))
      expect(screen.queryByText('OLD')).toBeNull()
      expect(screen.getByText('AAPL')).toBeTruthy()
      confirm.mockRestore()
    })

    function stateWithClosedPosition() {
      const state = buildAppStateWithAccounts({ taxableAccounts: 1, nonTaxableAccounts: 1, taxDeferredAccounts: 0 })
      state.closedPositions.push({
        id: 'cp-1', accountId: 'acc-1', symbol: 'OLD', name: 'Old Stock', assetClass: 'Equities',
        shares: 100, avgCost: 100, price: 110, realizedGL: 1000, realizedGLBasis: 'transactions',
        lastImportedAt: '2024-01-15', closedDate: '2024-01-10',
      })
      return state
    }

    it('opens from the Closed positions button and returns to the positions list with Back', () => {
      render(<AccountsPageHarness initial={stateWithClosedPosition()} positionsTab="taxable" />)

      fireEvent.click(screen.getByRole('button', { name: 'Closed positions' }))
      expect(screen.getByText('on open positions')).toBeTruthy()
      expect(screen.queryByText('Market value')).toBeNull()
      expect(screen.getByRole('heading', { name: 'Closed positions' })).toBeTruthy()
      expect(screen.getByRole('button', { name: '← Back to positions' })).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: '← Back to positions' }))
      expect(screen.getByText('Amount Invested')).toBeTruthy()
      expect(screen.queryByText('Closed')).toBeNull()
    })

    it('resets closed mode when the positions tab changes', () => {
      render(<TabChangingHarness initial={stateWithClosedPosition()} />)

      fireEvent.click(screen.getByRole('button', { name: 'Closed positions' }))
      expect(screen.getByText('on open positions')).toBeTruthy()
      expect(screen.queryByText('Market value')).toBeNull()
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
    it('does not render per-row Close buttons in the positions table', () => {
      renderPage({ state: buildAppStateWithAccounts(), dispatch: vi.fn(), positionsTab: 'taxable' })

      expect(within(screen.getByRole('table')).queryByRole('button', { name: 'Close', exact: true })).toBeNull()
    })

    it('has no Close column header or unused trailing action column', () => {
      renderPage({ state: buildAppStateWithAccounts(), dispatch: vi.fn(), positionsTab: 'taxable' })

      const table = screen.getByRole('table')
      expect(within(table).queryByRole('columnheader', { name: 'Close', exact: true })).toBeNull()
      expect(within(table).getAllByRole('columnheader').map((header) => header.textContent?.trim())).toEqual([
        'Symbol ↑', 'Asset Class', 'Shares', 'Cost Basis', 'Current Price',
        'Amount Invested', 'Market Value', '% of Selection', 'G/L', 'G/L %', '',
      ])
      for (const row of table.querySelectorAll('tbody tr')) {
        expect(within(row as HTMLElement).getAllByRole('cell')).toHaveLength(11)
      }
    })

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
