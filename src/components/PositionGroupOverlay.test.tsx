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
   * Test 9: Account cell and Override/AssetClassOverrideSelect cell unchanged
   */
  it('preserves Account cell and does not make it editable', () => {
    const position = createTestPosition()
    const group = createTestGroup([position])
    const account = createTestAccount({ name: 'Brokerage A' })

    render(
      <PositionGroupOverlay
        group={group}
        accounts={[account]}
        dispatch={mockDispatch}
        onClose={() => {}}
      />
    )

    const accountCell = screen.getByText('Brokerage A')
    fireEvent.click(accountCell)

    // Verify no input was created (account name should not be editable in overlay)
    const inputs = screen.queryAllByRole('spinbutton')
    expect(inputs).toHaveLength(0)
  })

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
