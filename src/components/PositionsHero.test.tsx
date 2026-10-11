import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { initialState } from '../lib/state'
import { positionsHero } from '../lib/selectors'
import { PositionsHero } from './PositionsHero'

afterEach(cleanup)

function fixture() {
  const state = initialState()
  state.accounts = ['a1', 'a2', 'a3'].map((id) => ({
    id, accountNumber: id, name: id, institution: 'Bank',
    taxCategory: id === 'a3' ? 'taxDeferred' : 'taxable', retirement: false,
    createdAt: '2025-01-01', tags: [id === 'a3' ? 'Other' : 'Family'],
  }))
  state.positions = [
    { id: 'p1', accountId: 'a1', symbol: 'AAPL', shares: 6, price: 100, avgCost: 80, assetClass: 'Equity' },
    { id: 'p2', accountId: 'a2', symbol: 'BND', shares: 4, price: 100, avgCost: 125, assetClass: 'Bond' },
    { id: 'p3', accountId: 'a3', symbol: 'MSFT', shares: 10, price: 100, avgCost: 50, assetClass: 'Equity' },
    { id: 'no-price', accountId: 'a1', symbol: 'CASH', shares: 10, price: null, avgCost: 1, assetClass: 'Cash' },
  ] as typeof state.positions
  state.closedPositions = [
    { id: 'c1', accountId: 'a1', realizedGL: 40, realizedGLBasis: 'transactions' },
    { id: 'c2', accountId: 'a2', realizedGL: null, realizedGLBasis: 'unknown' },
    { id: 'c3', accountId: 'a3', realizedGL: 90, realizedGLBasis: 'transactions' },
  ] as typeof state.closedPositions
  return state
}

describe('PositionsHero', () => {
  it('shows the three stats and allocation legend with T5 golden literals', () => {
    render(<PositionsHero kpis={positionsHero(fixture())} />)
    for (const text of ['Market value', '$1,000.00', '2 positions · 2 accounts', 'Unrealized G/L', '+$20.00', '+2.04%', 'Realized G/L', '+$40.00', '1 closed', 'Equity +60.00% · $600.00', 'Bond +40.00% · $400.00']) {
      expect(screen.getByText(text)).toBeTruthy()
    }
    expect(screen.getByRole('img', { name: 'Asset allocation' })).toBeTruthy()
  })

  it('shows only realized and open unrealized stats in closed mode', () => {
    render(<PositionsHero kpis={positionsHero(fixture(), 'taxable', true)} closed />)
    for (const text of ['Realized G/L', '+$40.00', '1 closed position', 'Unrealized G/L', '+$20.00', 'on open positions']) expect(screen.getByText(text)).toBeTruthy()
    expect(screen.queryByText('Market value')).toBeNull()
    expect(screen.queryByText(/Equity|Bond|Allocation/)).toBeNull()
    expect(screen.queryByRole('img', { name: 'Asset allocation' })).toBeNull()
  })

  it.each([false, true])('renders finite zeros for an empty portfolio (closed=%s)', (closed) => {
    const { container } = render(<PositionsHero kpis={positionsHero(initialState(), 'taxable', closed)} closed={closed} />)
    expect(screen.getAllByText('+$0.00')).toHaveLength(2)
    expect(container.textContent).not.toMatch(/NaN|Infinity/)
    if (!closed) {
      expect(screen.getByText('$0.00')).toBeTruthy()
      expect(screen.getByText('+0.00%')).toBeTruthy()
      expect(screen.getByText('0 positions · 0 accounts')).toBeTruthy()
    }
  })

  it('uses selected-account negative dollar and percentage golden literals', () => {
    const state = fixture()
    state.selectedAccountId = 'a2'
    render(<PositionsHero kpis={positionsHero(state)} />)
    for (const text of ['$400.00', '-$100.00', '-20.00%', '+$0.00', '1 position · 1 account', '0 closed', 'Bond +100.00% · $400.00']) expect(screen.getByText(text)).toBeTruthy()
  })

  it('formats a realized loss negatively', () => {
    const state = fixture()
    state.closedPositions[0].realizedGL = -40
    render(<PositionsHero kpis={positionsHero(state)} closed />)
    expect(screen.getByText('-$40.00')).toBeTruthy()
  })
})
