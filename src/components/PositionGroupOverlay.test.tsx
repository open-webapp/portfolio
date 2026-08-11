import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { PositionGroupOverlay } from './PositionGroupOverlay'
import type { Position, Account } from '../lib/types'
import type { AppState } from '../lib/state'
import type { AggregateRow } from './PositionsTable'

afterEach(cleanup)

describe('PositionGroupOverlay', () => {
  let mockDispatch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockDispatch = vi.fn()
  })

  const createTestPosition = (overrides?: Partial<Position>): Position => ({
    id: 'pos-1',
    accountId: 'acc-1',
    symbol: 'AAPL',
    name: 'Apple Inc',
    assetClass: 'Equity',
    shares: 100,
    avgCost: 150,
    price: 180,
    lastImportedAt: '2024-01-01',
    ...overrides,
  })

  const createTestAccount = (overrides?: Partial<Account>): Account => ({
    id: 'acc-1',
    accountNumber: '001',
    name: 'Brokerage A',
    institution: 'Test Institution',
    retirement: false,
    createdAt: '2024-01-01',
    ...overrides,
  })

  const createTestGroup = (positions: Position[]): AggregateRow => ({
    symbol: 'AAPL',
    displayName: 'Apple Inc',
    effectiveAssetClass: 'Equity',
    positions,
    totalShares: positions.reduce((sum, p) => sum + p.shares, 0),
    totalCostBasis: positions.reduce((sum, p) => sum + p.shares * p.avgCost, 0),
    totalMarketValue: positions.reduce((sum, p) => sum + p.shares * p.price, 0),
    totalGL: 0,
  })

  const createTestState = (positions: Position[] = [], accounts: Account[] = []): AppState => ({
    accounts,
    positions,
    closedPositions: [],
    transactions: [],
    snapshots: [],
    csvMappings: [],
    customInstitutions: [],
    category: 'all',
    range: '1y',
    tab: 'positions',
    view: 'dashboard',
    sortKey: 'symbol',
    sortDir: 'asc',
    assetClassFilter: 'All',
    retirementFilter: 'All',
    posSearch: '',
    txTypeFilter: 'All',
    txSearch: '',
    showClosed: false,
  })

  /**
   * Test 1: Clicking shares/avgCost/price/taxes values renders input pre-filled with current value
   */
  it('renders input pre-filled when clicking shares cell', () => {
    const position = createTestPosition({ shares: 100 })
    const group = createTestGroup([position])
    const account = createTestAccount()
    const testState = createTestState([position], [account])

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const sharesCell = screen.getByText('100.00')
    fireEvent.click(sharesCell)

    const input = screen.getByDisplayValue('100') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.type).toBe('number')
  })

  it('renders input pre-filled when clicking avgCost cell', () => {
    const position = createTestPosition({ avgCost: 150 })
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const avgCostCells = screen.getAllByText('$150.00')
    const avgCostCell = avgCostCells[0]
    fireEvent.click(avgCostCell)

    const input = screen.getByDisplayValue('150') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.type).toBe('number')
  })

  it('renders input pre-filled when clicking price cell', () => {
    const position = createTestPosition({ price: 180 })
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const priceCells = screen.getAllByText('$180.00')
    const priceCell = priceCells[priceCells.length - 1]
    fireEvent.click(priceCell)

    const input = screen.getByDisplayValue('180') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.type).toBe('number')
  })

  it('renders input pre-filled when clicking taxes cell', () => {
    const position = createTestPosition({ taxes: 50 })
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const taxesCells = screen.getAllByText('$50.00')
    const taxesCell = taxesCells[taxesCells.length - 1]
    fireEvent.click(taxesCell)

    const input = screen.getByDisplayValue('50') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.type).toBe('number')
  })

  /**
   * Test 2: Valid new value + Enter dispatches UPDATE_POSITION with correct patch
   */
  it('dispatches UPDATE_POSITION when pressing Enter with valid shares value', () => {
    const position = createTestPosition({ shares: 100 })
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const sharesCell = screen.getByText('100.00')
    fireEvent.click(sharesCell)

    const input = screen.getByDisplayValue('100')
    fireEvent.change(input, { target: { value: '150' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_POSITION',
      positionId: 'pos-1',
      patch: { shares: 150 },
    })
  })

  /**
   * Test 3: Valid new value + blur dispatches UPDATE_POSITION
   */
  it('dispatches UPDATE_POSITION when blurring with valid avgCost value', () => {
    const position = createTestPosition({ avgCost: 150 })
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const avgCostCells = screen.getAllByText('$150.00')
    fireEvent.click(avgCostCells[0])

    const input = screen.getByDisplayValue('150')
    fireEvent.change(input, { target: { value: '200' } })
    fireEvent.blur(input)

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_POSITION',
      positionId: 'pos-1',
      patch: { avgCost: 200 },
    })
  })

  /**
   * Test 4: Escape while editing reverts to previous value, no dispatch
   */
  it('reverts to previous value on Escape without dispatching', () => {
    const position = createTestPosition({ shares: 100 })
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const sharesCell = screen.getByText('100.00')
    fireEvent.click(sharesCell)

    const input = screen.getByDisplayValue('100')
    fireEvent.change(input, { target: { value: '999' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(mockDispatch).not.toHaveBeenCalled()

    // After Escape, input should be gone (display mode returns)
    expect(screen.queryByDisplayValue('999')).toBeNull()
  })

  /**
   * Test 5: Invalid (negative) value on shares/avgCost/price/taxes + blur reverts silently
   */
  it('reverts silently on negative shares value', () => {
    const position = createTestPosition({ shares: 100 })
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const sharesCell = screen.getByText('100.00')
    fireEvent.click(sharesCell)

    const input = screen.getByDisplayValue('100')
    fireEvent.change(input, { target: { value: '-5' } })
    fireEvent.blur(input)

    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('reverts silently on negative price value', () => {
    const position = createTestPosition({ price: 180 })
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const priceCells = screen.getAllByText('$180.00')
    const priceCell = priceCells[priceCells.length - 1]
    fireEvent.click(priceCell)

    const input = screen.getByDisplayValue('180')
    fireEvent.change(input, { target: { value: '-10' } })
    fireEvent.blur(input)

    expect(mockDispatch).not.toHaveBeenCalled()
  })

  /**
   * Test 6: Empty value + blur on shares/avgCost/price reverts silently (does NOT save as 0)
   */
  it('reverts silently on empty shares value', () => {
    const position = createTestPosition({ shares: 100 })
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const sharesCell = screen.getByText('100.00')
    fireEvent.click(sharesCell)

    const input = screen.getByDisplayValue('100')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)

    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('reverts silently on empty avgCost value', () => {
    const position = createTestPosition({ avgCost: 150 })
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const avgCostCells = screen.getAllByText('$150.00')
    fireEvent.click(avgCostCells[0])

    const input = screen.getByDisplayValue('150')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)

    expect(mockDispatch).not.toHaveBeenCalled()
  })

  /**
   * Test 7: Empty value + blur on taxes specifically dispatches { patch: { taxes: 0 } }
   * (the point-4 exception)
   */
  it('dispatches taxes: 0 when blurring with empty taxes value', () => {
    const position = createTestPosition({ taxes: 50 })
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const taxesCells = screen.getAllByText('$50.00')
    const taxesCell = taxesCells[taxesCells.length - 1]
    fireEvent.click(taxesCell)

    const input = screen.getByDisplayValue('50')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_POSITION',
      positionId: 'pos-1',
      patch: { taxes: 0 },
    })
  })

  /**
   * Test 3: Symbol cell is click-to-edit with text input
   */
  it('renders text input pre-filled when clicking symbol cell', () => {
    const position = createTestPosition({ symbol: 'TSLA' })
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const symbolCell = screen.getByText('TSLA')
    fireEvent.click(symbolCell)

    const input = screen.getByDisplayValue('TSLA') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.type).toBe('text')
  })

  it('dispatches UPDATE_POSITION with new symbol on Enter', () => {
    const position = createTestPosition({ symbol: 'AAPL' })
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const symbolCell = screen.getByText('AAPL')
    fireEvent.click(symbolCell)

    const input = screen.getByDisplayValue('AAPL') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'MSFT' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_POSITION',
      positionId: position.id,
      patch: { symbol: 'MSFT' },
    })
  })

  it('reverts symbol on Escape without dispatching', () => {
    const position = createTestPosition({ symbol: 'AAPL' })
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    mockDispatch.mockClear()

    const symbolCell = screen.getByText('AAPL')
    fireEvent.click(symbolCell)

    const input = screen.getByDisplayValue('AAPL') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'MSFT' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(mockDispatch).not.toHaveBeenCalled()
  })

  /**
   * Test 8, 11: Account dropdown allows selecting existing accounts
   */
  it('Account dropdown opens on click and lists all accounts', () => {
    const position = createTestPosition()
    const group = createTestGroup([position])
    const account1 = createTestAccount({ id: 'acc-1', name: 'Brokerage A' })
    const account2 = createTestAccount({ id: 'acc-2', name: 'Brokerage B', accountNumber: '002' })

    const testState = createTestState([position], [account1, account2])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account1, account2]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    // Find the account dropdown button by looking for the text that includes the account name
    const buttons = screen.getAllByRole('button')
    const accountButton = buttons.find(b => b.textContent?.includes('Brokerage A'))
    expect(accountButton).toBeDefined()

    fireEvent.click(accountButton!)

    // Both accounts should be visible in the dropdown (checking for institution—name format)
    expect(screen.getByText(/Test Institution — Brokerage B/)).toBeDefined()
  })

  it('Account dropdown selection dispatches UPDATE_POSITION', () => {
    const position = createTestPosition({ accountId: 'acc-1' })
    const group = createTestGroup([position])
    const account1 = createTestAccount({ id: 'acc-1', name: 'Brokerage A' })
    const account2 = createTestAccount({ id: 'acc-2', name: 'Brokerage B' })

    const testState = createTestState([position], [account1, account2])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account1, account2]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    mockDispatch.mockClear()

    // Open the dropdown
    const buttons = screen.getAllByRole('button')
    const accountButton = buttons.find(b => b.textContent?.includes('Brokerage A'))
    fireEvent.click(accountButton!)

    // Click on the second account (using regex to match the two-line format)
    const account2Option = screen.getByText(/Test Institution — Brokerage B/)
    fireEvent.click(account2Option)

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_POSITION',
      positionId: position.id,
      patch: { accountId: 'acc-2' },
    })
  })

  /**
   * Test 9: Override/AssetClassOverrideSelect cell unchanged
   */
  it('preserves Override select element', () => {
    const position = createTestPosition()
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    // Verify the override button exists (from AssetClassOverrideSelect)
    const overrideButtons = screen.queryAllByText(/^(Set|Override)$/)
    expect(overrideButtons.length).toBeGreaterThan(0)
  })

  /**
   * Test: Taxes column exists in header
   */
  it('renders Taxes column header', () => {
    const position = createTestPosition()
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const taxesHeader = screen.getByText('Taxes')
    expect(taxesHeader).toBeTruthy()
  })

  /**
   * Test: Null taxes displays as $0.00
   */
  it('displays null taxes as $0.00', () => {
    const position = createTestPosition({ taxes: null })
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const taxesCells = screen.getAllByText('$0.00')
    expect(taxesCells.length).toBeGreaterThan(0)
  })

  /**
   * Test 1: Column count and headers (v2 layout)
   */
  it('renders exactly 10 column headers in correct order', () => {
    const position = createTestPosition()
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const headers = screen.getAllByRole('columnheader')
    expect(headers).toHaveLength(10)

    const headerTexts = headers.map(h => h.textContent)
    expect(headerTexts).toEqual([
      'Account',
      'Symbol',
      'Name',
      'Shares',
      'Avg Cost',
      'Current Price',
      '% of Portfolio',
      'Taxes',
      'Override',
      '',
    ])
  })

  /**
   * Test 2: Account display (two-line format)
   * Tests all 6 combinations: 3 tax categories × 2 retirement states
   */
  it('renders two-line account format: taxable + non-retirement', () => {
    const position = createTestPosition()
    const account = createTestAccount({
      institution: 'Fidelity',
      name: 'Brokerage',
      retirement: false,
    })

    const group = createTestGroup([position])

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    expect(screen.getByText('Fidelity — Brokerage')).toBeTruthy()
    expect(screen.getByText('Taxable • Non-Retirement')).toBeTruthy()
  })

  it('renders two-line account format: taxable + retirement', () => {
    const position = createTestPosition()
    const account = createTestAccount({
      institution: 'Vanguard',
      name: 'IRA',
      retirement: true,
    })

    const group = createTestGroup([position])

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    expect(screen.getByText('Vanguard — IRA')).toBeTruthy()
    expect(screen.getByText('Taxable • Retirement')).toBeTruthy()
  })

  it('renders two-line account format: non-taxable + non-retirement', () => {
    const position = createTestPosition()
    const account = createTestAccount({
      institution: 'Charles Schwab',
      name: 'HSA',
      retirement: false,
    })

    const group = createTestGroup([position])

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    expect(screen.getByText('Charles Schwab — HSA')).toBeTruthy()
    expect(screen.getByText('Non-Taxable • Non-Retirement')).toBeTruthy()
  })

  it('renders two-line account format: non-taxable + retirement', () => {
    const position = createTestPosition()
    const account = createTestAccount({
      institution: 'Fidelity',
      name: 'Roth IRA',
      retirement: true,
    })

    const group = createTestGroup([position])

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    expect(screen.getByText('Fidelity — Roth IRA')).toBeTruthy()
    expect(screen.getByText('Non-Taxable • Retirement')).toBeTruthy()
  })

  it('renders two-line account format: tax-deferred + non-retirement', () => {
    const position = createTestPosition()
    const account = createTestAccount({
      institution: 'E*TRADE',
      name: 'SEP IRA',
      retirement: false,
    })

    const group = createTestGroup([position])

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    expect(screen.getByText('E*TRADE — SEP IRA')).toBeTruthy()
    expect(screen.getByText('Tax-Deferred • Non-Retirement')).toBeTruthy()
  })

  it('renders two-line account format: tax-deferred + retirement', () => {
    const position = createTestPosition()
    const account = createTestAccount({
      institution: 'Schwab',
      name: '401(k)',
      retirement: true,
    })

    const group = createTestGroup([position])

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    expect(screen.getByText('Schwab — 401(k)')).toBeTruthy()
    expect(screen.getByText('Tax-Deferred • Retirement')).toBeTruthy()
  })

  /**
   * Test 3: Name column editable
   */
  it('renders Name column cell with initial value', () => {
    const position = createTestPosition({ name: 'Tech Holdings' })
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    expect(screen.getByText('Tech Holdings')).toBeTruthy()
  })

  it('Name column: clicking cell enters edit mode', () => {
    const position = createTestPosition({ name: 'Tech Holdings' })
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const nameCell = screen.getByText('Tech Holdings')
    fireEvent.click(nameCell)

    const input = screen.getByDisplayValue('Tech Holdings') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.type).toBe('text')
  })

  it('Name column: pressing Enter commits non-empty value', () => {
    const position = createTestPosition({ name: 'Tech Holdings' })
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const nameCell = screen.getByText('Tech Holdings')
    fireEvent.click(nameCell)

    const input = screen.getByDisplayValue('Tech Holdings') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Updated Name' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_POSITION',
      positionId: position.id,
      patch: { name: 'Updated Name' },
    })
  })

  it('Name column: blurring with non-empty value commits', () => {
    const position = createTestPosition({ name: 'Tech Holdings' })
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const nameCell = screen.getByText('Tech Holdings')
    fireEvent.click(nameCell)

    const input = screen.getByDisplayValue('Tech Holdings') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'New Name' } })
    fireEvent.blur(input)

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_POSITION',
      positionId: position.id,
      patch: { name: 'New Name' },
    })
  })

  it('Name column: blurring with empty value reverts silently', () => {
    const position = createTestPosition({ name: 'Tech Holdings' })
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const nameCell = screen.getByText('Tech Holdings')
    fireEvent.click(nameCell)

    const input = screen.getByDisplayValue('Tech Holdings') as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)

    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('Name column: pressing Escape reverts without dispatching', () => {
    const position = createTestPosition({ name: 'Tech Holdings' })
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    mockDispatch.mockClear()

    const nameCell = screen.getByText('Tech Holdings')
    fireEvent.click(nameCell)

    const input = screen.getByDisplayValue('Tech Holdings') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Will be reverted' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('Name column: empty name shows placeholder and is editable', () => {
    const position = createTestPosition({ name: '' })
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const nameCell = screen.getByText('(no name)')
    fireEvent.click(nameCell)

    const input = screen.getByDisplayValue('') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.type).toBe('text')
  })

  it('Name column: null name shows placeholder and is editable', () => {
    const position = createTestPosition({ name: null as any })
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const nameCell = screen.getByText('(no name)')
    fireEvent.click(nameCell)

    const input = screen.getByDisplayValue('') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.type).toBe('text')
  })

  /**
   * Test 4: Sort order (institution→name)
   */
  it('renders positions sorted by institution then account name', () => {
    // Create 3 positions across 2 institutions, varying account name/tax status
    const pos1 = createTestPosition({ id: 'pos-1', symbol: 'AAPL', accountId: 'acc-fid-taxable' })
    const pos2 = createTestPosition({ id: 'pos-2', symbol: 'MSFT', accountId: 'acc-schwab-taxable' })
    const pos3 = createTestPosition({ id: 'pos-3', symbol: 'GOOG', accountId: 'acc-fid-deferred' })

    const accFidTaxable = createTestAccount({
      id: 'acc-fid-taxable',
      institution: 'Fidelity',
      name: 'Brokerage',
      retirement: false,
    })

    const accSchwabTaxable = createTestAccount({
      id: 'acc-schwab-taxable',
      institution: 'Charles Schwab',
      name: 'Brokerage',
      retirement: false,
    })

    const accFidDeferred = createTestAccount({
      id: 'acc-fid-deferred',
      institution: 'Fidelity',
      name: 'IRA',
      retirement: true,
    })

    // Render with positions in random order to test sorting
    const group = createTestGroup([pos2, pos1, pos3])

    const testState = createTestState([pos1, pos2, pos3], [accFidTaxable, accSchwabTaxable, accFidDeferred])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[accFidTaxable, accSchwabTaxable, accFidDeferred]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    // Find all rows in the table body
    const rows = screen.getAllByRole('row')
    // rows[0] is thead, rows[1..n] are tbody
    const bodyRows = rows.slice(1)

    // Expected sort order (alphabetical by institution, then by account name):
    // 1. Charles Schwab → Brokerage (pos2: MSFT)
    // 2. Fidelity → Brokerage (pos1: AAPL)
    // 3. Fidelity → IRA (pos3: GOOG)

    expect(bodyRows[0].textContent).toContain('Charles Schwab — Brokerage')
    expect(bodyRows[0].textContent).toContain('MSFT')

    expect(bodyRows[1].textContent).toContain('Fidelity — Brokerage')
    expect(bodyRows[1].textContent).toContain('AAPL')

    expect(bodyRows[2].textContent).toContain('Fidelity — IRA')
    expect(bodyRows[2].textContent).toContain('GOOG')
  })

  /**
   * Test 5: Regression tests (old columns must not exist)
   */
  it('does not render Cost Basis header', () => {
    const position = createTestPosition()
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    expect(screen.queryByText('Cost Basis')).toBeNull()
  })

  it('does not render Amount Invested header', () => {
    const position = createTestPosition()
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    expect(screen.queryByText('Amount Invested')).toBeNull()
  })

  it('does not render Market Value header', () => {
    const position = createTestPosition()
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    expect(screen.queryByText('Market Value')).toBeNull()
  })

  it('does not render G/L header', () => {
    const position = createTestPosition()
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    expect(screen.queryByText(/^G\/L$/)).toBeNull()
  })

  it('does not render G/L% header', () => {
    const position = createTestPosition()
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    expect(screen.queryByText(/^G\/L%$/)).toBeNull()
  })

  /**
   * Test: Delete column (10th column)
   */
  it('renders exactly 10 column headers with empty 10th column', () => {
    const position = createTestPosition()
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const headers = screen.getAllByRole('columnheader')
    expect(headers).toHaveLength(10)

    // The 10th column (last one) should have empty textContent
    expect(headers[9].textContent).toBe('')
  })

  it('renders a trash-icon delete button in each row', () => {
    const pos1 = createTestPosition({ id: 'pos-1' })
    const pos2 = createTestPosition({ id: 'pos-2' })
    const group = createTestGroup([pos1, pos2])
    const account = createTestAccount()

    const testState = createTestState([pos1, pos2], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    // Should have 2 delete buttons (one per position in the group)
    const deleteButtons = screen.getAllByTitle('Delete this position')
    expect(deleteButtons).toHaveLength(2)
  })

  it('clicking delete + confirming dispatches CLOSE_POSITION exactly once', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const position = createTestPosition({ id: 'pos-123' })
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const deleteButton = screen.getByTitle('Delete this position')
    fireEvent.click(deleteButton)

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'CLOSE_POSITION',
      positionId: 'pos-123',
    })
    expect(mockDispatch).toHaveBeenCalledTimes(1)
  })

  it('clicking delete + cancelling does not dispatch anything', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    const position = createTestPosition({ id: 'pos-456' })
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const deleteButton = screen.getByTitle('Delete this position')
    fireEvent.click(deleteButton)

    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('multi-row group: deleting one row only dispatches with that row\'s positionId', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const pos1 = createTestPosition({ id: 'pos-first' })
    const pos2 = createTestPosition({ id: 'pos-second' })
    const group = createTestGroup([pos1, pos2])
    const account = createTestAccount()

    const testState = createTestState([pos1, pos2], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    const deleteButtons = screen.getAllByTitle('Delete this position')
    fireEvent.click(deleteButtons[1]) // Click the second delete button

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'CLOSE_POSITION',
      positionId: 'pos-second',
    })
  })

  /**
   * Test: "% of Portfolio" column displays in overlay
   */
  it('renders "% of Portfolio" column header in overlay table', () => {
    const position = createTestPosition()
    const group = createTestGroup([position])
    const account = createTestAccount()

    const testState = createTestState([position], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    // Check for the column header
    const headers = screen.getAllByRole('columnheader')
    const portfolioPercentHeader = Array.from(headers).find(h =>
      h.textContent?.includes('% of Portfolio')
    )
    expect(portfolioPercentHeader).toBeDefined()
  })

  /**
   * Test: "% of Portfolio" shows individual position percentage
   */
  it('shows individual position percentage in overlay', () => {
    // Create two positions with different market values
    const pos1 = createTestPosition({ id: 'pos-1', shares: 10, price: 200 }) // marketValue = 2000
    const pos2 = createTestPosition({ id: 'pos-2', symbol: 'MSFT', shares: 15, price: 200 }) // marketValue = 3000
    const group = createTestGroup([pos1, pos2])
    const account = createTestAccount()

    const testState = createTestState([pos1, pos2], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    // Total = 2000 + 3000 = 5000
    // pos1: 2000 / 5000 = 40.0%
    // pos2: 3000 / 5000 = 60.0%
    expect(screen.getByText('40.0%')).toBeDefined()
    expect(screen.getByText('60.0%')).toBeDefined()
  })

  /**
   * Test: "% of Portfolio" with category filter changes percentages in overlay
   */
  it('overlay percentages reflect category filter', () => {
    const pos1 = createTestPosition({ id: 'pos-1', accountId: 'acc-1', shares: 10, price: 200 }) // marketValue = 2000
    const pos2 = createTestPosition({ id: 'pos-2', accountId: 'acc-2', shares: 15, price: 200 }) // marketValue = 3000
    const group = createTestGroup([pos1])

    const account1 = createTestAccount({ id: 'acc-1', taxCategory: 'taxable' })
    const account2 = createTestAccount({ id: 'acc-2', taxCategory: 'nonTaxable' })

    // Render with category filter set to 'taxable'
    // In this case, portfolio total should only include positions from taxable accounts
    const testState = createTestState([pos1, pos2], [account1, account2])
    testState.category = 'taxable'

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account1, account2]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    // With taxable filter: portfolio total = 2000 (only pos1)
    // pos1: 2000 / 2000 = 100.0%
    expect(screen.getByText('100.0%')).toBeDefined()
  })

  /**
   * Test: "% of Portfolio" with retirement filter changes percentages in overlay
   */
  it('overlay percentages reflect retirement filter', () => {
    const pos1 = createTestPosition({ id: 'pos-1', accountId: 'acc-1', shares: 10, price: 200 }) // marketValue = 2000
    const pos2 = createTestPosition({ id: 'pos-2', accountId: 'acc-2', shares: 15, price: 200 }) // marketValue = 3000
    const group = createTestGroup([pos1])

    const account1 = createTestAccount({ id: 'acc-1', retirement: false })
    const account2 = createTestAccount({ id: 'acc-2', retirement: true })

    // Render with retirement filter set to 'Non-Retirement'
    const testState = createTestState([pos1, pos2], [account1, account2])
    testState.retirementFilter = 'Non-Retirement'

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account1, account2]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    // With non-retirement filter: portfolio total = 2000 (only pos1)
    // pos1: 2000 / 2000 = 100.0%
    expect(screen.getByText('100.0%')).toBeDefined()
  })

  /**
   * Test: Negative position value shows negative percentage
   */
  it('negative position market value shows negative percentage', () => {
    const pos1 = createTestPosition({ id: 'pos-1', shares: 10, price: 200 }) // marketValue = 2000
    const pos2 = createTestPosition({ id: 'pos-2', symbol: 'SHORT', shares: -5, price: 200 }) // marketValue = -1000
    const group = createTestGroup([pos1, pos2])
    const account = createTestAccount()

    const testState = createTestState([pos1, pos2], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    // Total = 2000 - 1000 = 1000
    // pos1: 2000 / 1000 = 200.0%
    // pos2: -1000 / 1000 = -100.0%
    expect(screen.getByText('200.0%')).toBeDefined()
    expect(screen.getByText('-100.0%')).toBeDefined()
  })

  /**
   * Test: Overlay percentages match selector-computed percentages
   */
  it('overlay percentages match filteredPortfolioTotal calculation', () => {
    // This test verifies that the percentages shown in the overlay
    // match what would be computed from filteredPortfolioTotal selector
    const pos1 = createTestPosition({ id: 'pos-1', shares: 5, avgCost: 100, price: 100 }) // marketValue = 500
    const pos2 = createTestPosition({ id: 'pos-2', symbol: 'AAPL2', shares: 10, avgCost: 150, price: 200 }) // marketValue = 2000
    const group = createTestGroup([pos1, pos2])
    const account = createTestAccount()

    const testState = createTestState([pos1, pos2], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    // Total = 500 + 2000 = 2500
    // pos1: 500 / 2500 = 20.0%
    // pos2: 2000 / 2500 = 80.0%
    expect(screen.getByText('20.0%')).toBeDefined()
    expect(screen.getByText('80.0%')).toBeDefined()
  })

  /**
   * Test: Zero total edge case (all positions have zero market value)
   */
  it('overlay shows dash for percentage when portfolio total is zero', () => {
    const pos1 = createTestPosition({ id: 'pos-1', shares: 0, price: 0 }) // marketValue = 0
    const group = createTestGroup([pos1])
    const account = createTestAccount()

    const testState = createTestState([pos1], [account])
    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
        existingAssetClasses={["Equity", "Crypto"]}
        state={testState}
      />
    )

    // When total is 0, fmtPortfolioPercent returns '—'
    expect(screen.getByText('—')).toBeDefined()
  })
})
