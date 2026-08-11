import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SegmentSummaryCards } from './SegmentSummaryCards'
import type { Position, Account } from '../lib/types'
import type { AppState } from '../lib/state'

afterEach(cleanup)

describe('SegmentSummaryCards', () => {
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

  const createTestState = (positions: Position[] = [], accounts: Account[] = []): AppState => ({
    accounts,
    positions,
    closedPositions: [],
    transactions: [],
    snapshots: [],
    csvMappings: [],
    customInstitutions: [],
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
   * Test 1: Renders the row label as a heading/kicker
   */
  it('renders the row label as a heading/kicker', () => {
    const position = createTestPosition()
    const account = createTestAccount()
    const state = createTestState([position], [account])

    render(
      <SegmentSummaryCards
        state={state}
        retirement={false}
        label="Non-Retirement"
      />
    )

    const label = screen.getByText('Non-Retirement')
    expect(label).toBeTruthy()
    expect(label.className).toContain('text-muted')
  })

  /**
   * Test 2: Renders exactly 3 card values (Total Value, Total Gain/Loss with %, Amount Invested)
   * and no Day Change card
   */
  it('renders exactly 3 card values with no Day Change card', () => {
    const position = createTestPosition({ shares: 100, avgCost: 150, price: 180 })
    const account = createTestAccount()
    const state = createTestState([position], [account])

    const { container } = render(
      <SegmentSummaryCards
        state={state}
        retirement={false}
        label="Non-Retirement"
      />
    )

    // Check for the 3 expected card labels (card-kicker elements)
    const cardKickers = container.querySelectorAll('.card-kicker')
    expect(cardKickers).toHaveLength(3)

    const labels = Array.from(cardKickers).map((el) => el.textContent)
    expect(labels).toContain('Total Value')
    expect(labels).toContain('Total Gain/Loss')
    expect(labels).toContain('Amount Invested')

    // Verify no Day Change card
    expect(labels).not.toContain('Day Change')
  })

  /**
   * Test 3: With retirement={true}, shows only retirement-account positions
   */
  it('with retirement={true} shows only retirement-account positions', () => {
    const retirementPos = createTestPosition({
      id: 'pos-retire',
      accountId: 'acc-retire',
      shares: 100,
      avgCost: 150,
      price: 180,
    })

    const nonRetirementPos = createTestPosition({
      id: 'pos-non-retire',
      accountId: 'acc-non-retire',
      shares: 50,
      avgCost: 100,
      price: 120,
    })

    const retirementAccount = createTestAccount({
      id: 'acc-retire',
      retirement: true,
    })

    const nonRetirementAccount = createTestAccount({
      id: 'acc-non-retire',
      retirement: false,
    })

    const state = createTestState(
      [retirementPos, nonRetirementPos],
      [retirementAccount, nonRetirementAccount]
    )

    render(
      <SegmentSummaryCards
        state={state}
        retirement={true}
        label="Retirement"
      />
    )

    // For retirement position: 100 shares @ $150 cost = $15,000 invested, @ $180 price = $18,000 value
    // GL = $18,000 - $15,000 = $3,000
    screen.getByText('$18,000.00')  // Total Value for retirement only
    screen.getByText('+$3,000.00')  // Total Gain/Loss for retirement only
    screen.getByText('$15,000.00')  // Amount Invested for retirement only

    // Non-retirement position values should NOT appear
    // Non-retirement: 50 @ $100 = $5,000 invested, @ $120 = $6,000 value
    // These specific amounts should not appear
    expect(screen.queryByText('$6,000.00')).toBeFalsy()
    expect(screen.queryByText('$5,000.00')).toBeFalsy()
  })

  /**
   * Test 4: With retirement={false}, shows only non-retirement-account positions
   */
  it('with retirement={false} shows only non-retirement-account positions', () => {
    const retirementPos = createTestPosition({
      id: 'pos-retire',
      accountId: 'acc-retire',
      shares: 100,
      avgCost: 150,
      price: 180,
    })

    const nonRetirementPos = createTestPosition({
      id: 'pos-non-retire',
      accountId: 'acc-non-retire',
      shares: 50,
      avgCost: 100,
      price: 120,
    })

    const retirementAccount = createTestAccount({
      id: 'acc-retire',
      retirement: true,
    })

    const nonRetirementAccount = createTestAccount({
      id: 'acc-non-retire',
      retirement: false,
    })

    const state = createTestState(
      [retirementPos, nonRetirementPos],
      [retirementAccount, nonRetirementAccount]
    )

    render(
      <SegmentSummaryCards
        state={state}
        retirement={false}
        label="Non-Retirement"
      />
    )

    // For non-retirement position: 50 shares @ $100 cost = $5,000 invested, @ $120 price = $6,000 value
    // GL = $6,000 - $5,000 = $1,000
    screen.getByText('$6,000.00')  // Total Value for non-retirement only
    screen.getByText('+$1,000.00')  // Total Gain/Loss for non-retirement only
    screen.getByText('$5,000.00')  // Amount Invested for non-retirement only

    // Retirement position values should NOT appear
    // Retirement: 100 @ $150 = $15,000 invested, @ $180 = $18,000 value
    expect(screen.queryByText('$18,000.00')).toBeFalsy()
    expect(screen.queryByText('$15,000.00')).toBeFalsy()
  })

  /**
   * Test 5: Renders gain/loss percentage sub-value
   */
  it('renders gain/loss percentage as sub-value on Total Gain/Loss card', () => {
    const position = createTestPosition({ shares: 100, avgCost: 150, price: 180 })
    const account = createTestAccount()
    const state = createTestState([position], [account])

    const { container } = render(
      <SegmentSummaryCards
        state={state}
        retirement={false}
        label="Non-Retirement"
      />
    )

    // GL% = (18000 - 15000) / 15000 = 3000/15000 = 20%
    const meta = container.querySelectorAll('.card-meta')
    const percentageFound = Array.from(meta).some((el) => el.textContent?.includes('20.00%'))
    expect(percentageFound).toBeTruthy()
  })

  /**
   * Test 6: With zero matching positions, renders zero-value cards
   */
  it('with zero matching positions, renders zero-value cards', () => {
    const position = createTestPosition({
      id: 'pos-retire',
      accountId: 'acc-retire',
    })

    const retirementAccount = createTestAccount({
      id: 'acc-retire',
      retirement: true,
    })

    // State has a retirement position but we render with retirement={false}
    const state = createTestState([position], [retirementAccount])

    render(
      <SegmentSummaryCards
        state={state}
        retirement={false}
        label="Non-Retirement"
      />
    )

    // Should still render 3 cards with zero values
    const zeroValues = screen.getAllByText('$0.00')
    expect(zeroValues.length).toBeGreaterThanOrEqual(2)  // At least Total Value and Amount Invested
    screen.getByText('+$0.00') // Total Gain/Loss
  })
})
