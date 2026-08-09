import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { PositionGroupOverlay } from './PositionGroupOverlay'
import type { Position, Account } from '../lib/types'
import type { AggregateRow } from './PositionsTable'

afterEach(cleanup)

describe('PositionGroupOverlay', () => {
  let mockDispatch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockDispatch = vi.fn()
  })

  const createTestPosition = (overrides?: Partial<Position>): Position => ({
    id: 'pos-1',
    importSessionId: 'sess-1',
    accountId: 'acc-1',
    symbol: 'AAPL',
    name: 'Apple Inc',
    assetClass: 'Equity',
    shares: 100,
    avgCost: 150,
    price: 180,
    taxes: 50,
    lastImportedAt: '2024-01-01',
    ...overrides,
  })

  const createTestAccount = (overrides?: Partial<Account>): Account => ({
    id: 'acc-1',
    accountNumber: '001',
    name: 'Brokerage A',
    institution: 'Test Institution',
    taxCategory: 'taxable',
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

  /**
   * Test 1: Clicking shares/avgCost/price/taxes values renders input pre-filled with current value
   */
  it('renders input pre-filled when clicking shares cell', () => {
    const position = createTestPosition({ shares: 100 })
    const group = createTestGroup([position])
    const account = createTestAccount()

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
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

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
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

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
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

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
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

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
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

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
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

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
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

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
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

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
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

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
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

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
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

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
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
   * Test 8: Computed columns (Amount Invested/Market Value/G/L/G/L%) have no click-to-edit
   */
  it('does not allow editing of computed columns', () => {
    const position = createTestPosition()
    const group = createTestGroup([position])
    const account = createTestAccount()

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
      />
    )

    // Click on Market Value cell (a computed column)
    const marketValueCell = screen.getByText('$18,000.00')
    fireEvent.click(marketValueCell)

    // Verify no input was created
    const inputs = screen.queryAllByRole('spinbutton')
    expect(inputs).toHaveLength(0)
  })

  /**
   * Test 3: Symbol cell is click-to-edit with text input
   */
  it('renders text input pre-filled when clicking symbol cell', () => {
    const position = createTestPosition({ symbol: 'TSLA' })
    const group = createTestGroup([position])
    const account = createTestAccount()

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
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

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
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

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
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

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account1, account2]}
        dispatch={mockDispatch}
        onClose={() => {}}
      />
    )

    // Find the account dropdown button by looking for the text that includes the account name
    // The button text will include the account name
    const buttons = screen.getAllByRole('button')
    const accountButton = buttons.find(b => b.textContent?.includes('Brokerage A'))
    expect(accountButton).toBeDefined()

    fireEvent.click(accountButton!)

    // Both accounts should be visible in the dropdown
    expect(screen.getByText('Brokerage B')).toBeDefined()
    // "Create new account" option should be visible
    expect(screen.getByText('+ Create new account')).toBeDefined()
  })

  it('Account dropdown selection dispatches UPDATE_POSITION', () => {
    const position = createTestPosition({ accountId: 'acc-1' })
    const group = createTestGroup([position])
    const account1 = createTestAccount({ id: 'acc-1', name: 'Brokerage A' })
    const account2 = createTestAccount({ id: 'acc-2', name: 'Brokerage B' })

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account1, account2]}
        dispatch={mockDispatch}
        onClose={() => {}}
      />
    )

    mockDispatch.mockClear()

    // Open the dropdown
    const buttons = screen.getAllByRole('button')
    const accountButton = buttons.find(b => b.textContent?.includes('Brokerage A'))
    fireEvent.click(accountButton!)

    // Click on the second account
    const account2Option = screen.getByText('Brokerage B')
    fireEvent.click(account2Option)

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_POSITION',
      positionId: position.id,
      patch: { accountId: 'acc-2' },
    })
  })

  /**
   * Test 12: Account dropdown new-account creation
   */
  it('Account dropdown "+ Create new account" reveals mini-form', () => {
    const position = createTestPosition()
    const group = createTestGroup([position])
    const account = createTestAccount()

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
      />
    )

    // Open the dropdown
    const buttons = screen.getAllByRole('button')
    const accountButton = buttons.find(b => b.textContent?.includes('Brokerage A'))
    fireEvent.click(accountButton!)

    // Click "+ Create new account"
    const createNewOption = screen.getByText('+ Create new account')
    fireEvent.click(createNewOption)

    // Mini-form fields should be visible
    expect(screen.getByPlaceholderText('e.g., Fidelity IRA')).toBeDefined() // Account name
    expect(screen.getByPlaceholderText('e.g., Fidelity')).toBeDefined() // Institution
    expect(screen.getByPlaceholderText('e.g., 12345678')).toBeDefined() // Account number
    expect(screen.getByLabelText('Retirement Account')).toBeDefined()
  })

  it('Account dropdown mini-form creates new account and reassigns position', () => {
    const position = createTestPosition()
    const group = createTestGroup([position])
    const account = createTestAccount()

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
      />
    )

    mockDispatch.mockClear()

    // Open the dropdown
    const buttons = screen.getAllByRole('button')
    const accountButton = buttons.find(b => b.textContent?.includes('Brokerage A'))
    fireEvent.click(accountButton!)

    // Click "+ Create new account"
    const createNewOption = screen.getByText('+ Create new account')
    fireEvent.click(createNewOption)

    // Fill in the form
    const nameInput = screen.getByPlaceholderText('e.g., Fidelity IRA') as HTMLInputElement
    const institutionInput = screen.getByPlaceholderText('e.g., Fidelity') as HTMLInputElement
    const numberInput = screen.getByPlaceholderText('e.g., 12345678') as HTMLInputElement
    const retirementCheckbox = screen.getByLabelText('Retirement Account') as HTMLInputElement

    fireEvent.change(nameInput, { target: { value: 'My New IRA' } })
    fireEvent.change(institutionInput, { target: { value: 'Fidelity' } })
    fireEvent.change(numberInput, { target: { value: 'NEW123' } })
    fireEvent.click(retirementCheckbox)

    // Click Create button
    const createButton = screen.getByText('Create')
    fireEvent.click(createButton)

    // Should have called ADD_ACCOUNT first, then UPDATE_POSITION
    const calls = mockDispatch.mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(2)

    // First call should be ADD_ACCOUNT
    const addAccountCall = calls.find(c => c[0].type === 'ADD_ACCOUNT')
    expect(addAccountCall).toBeDefined()
    expect(addAccountCall[0].account.name).toBe('My New IRA')
    expect(addAccountCall[0].account.institution).toBe('Fidelity')
    expect(addAccountCall[0].account.accountNumber).toBe('NEW123')
    expect(addAccountCall[0].account.retirement).toBe(true)

    // Second call should be UPDATE_POSITION with the new account ID
    const updatePositionCall = calls.find(c => c[0].type === 'UPDATE_POSITION')
    expect(updatePositionCall).toBeDefined()
    expect(updatePositionCall[0].patch.accountId).toBe(addAccountCall[0].account.id)
  })

  it('Account dropdown mini-form with empty name does not dispatch', () => {
    const position = createTestPosition()
    const group = createTestGroup([position])
    const account = createTestAccount()

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
      />
    )

    mockDispatch.mockClear()

    // Open the dropdown
    const buttons = screen.getAllByRole('button')
    const accountButton = buttons.find(b => b.textContent?.includes('Brokerage A'))
    fireEvent.click(accountButton!)

    // Click "+ Create new account"
    const createNewOption = screen.getByText('+ Create new account')
    fireEvent.click(createNewOption)

    // Click Create with empty name
    const createButton = screen.getByText('Create')
    fireEvent.click(createButton)

    // Should not have dispatched anything
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  /**
   * Test 9: Override/AssetClassOverrideSelect cell unchanged
   */
  it('preserves Override select element', () => {
    const position = createTestPosition()
    const group = createTestGroup([position])
    const account = createTestAccount()

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
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

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
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

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
      />
    )

    const taxesCells = screen.getAllByText('$0.00')
    expect(taxesCells.length).toBeGreaterThan(0)
  })
})
