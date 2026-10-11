import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PositionsKpiRow } from './PositionsKpiRow'

afterEach(cleanup)

const kpis = {
  marketValue: 1000,
  unrealizedGL: 50,
  unrealizedGLPct: 5,
  realizedGL: -25,
  positionCount: 1,
  accountCount: 2,
  allocationBars: [
    { label: 'Equity', value: '$700.00', pct: '+70.00%', pctNum: 70 },
    { label: 'Bond', value: '$300.00', pct: '+30.00%', pctNum: 30 },
  ],
}

describe('PositionsKpiRow', () => {
  it('renders four list-view cards with values, scope counts, allocations, and gain/loss colors', () => {
    render(<PositionsKpiRow kpis={kpis} />)

    expect(screen.getAllByTestId('positions-kpi-card')).toHaveLength(4)
    expect(screen.getByText('Market value')).toBeTruthy()
    expect(screen.getByText('$1,000.00')).toBeTruthy()
    expect(screen.getByText('Unrealized G/L')).toBeTruthy()
    expect(screen.getByText('+$50.00').classList.contains('kpi-gain')).toBe(true)
    expect(screen.getByText('Realized G/L')).toBeTruthy()
    expect(screen.getByText('-$25.00').classList.contains('kpi-loss')).toBe(true)
    expect(screen.getByText('Allocations')).toBeTruthy()
    expect(screen.getByText('Equity')).toBeTruthy()
    expect(screen.getByText('Bond')).toBeTruthy()
    expect(screen.getByText('1 position · 2 accounts')).toBeTruthy()
  })

  it('renders finite zero values for an empty scope', () => {
    render(<PositionsKpiRow kpis={{ ...kpis, marketValue: 0, unrealizedGL: 0, unrealizedGLPct: 0, realizedGL: 0, positionCount: 0, accountCount: 0, allocationBars: [] }} />)

    expect(screen.getAllByText('$0.00')).toHaveLength(1)
    expect(screen.getAllByText('+$0.00')).toHaveLength(2)
    expect(screen.queryByText(/NaN/)).toBeNull()
  })

  it('omits allocations in the closed view', () => {
    render(<PositionsKpiRow kpis={kpis} closed />)

    expect(screen.getAllByTestId('positions-kpi-card')).toHaveLength(3)
    expect(screen.queryByText('Allocations')).toBeNull()
    expect(screen.getByText('1 position · 2 accounts')).toBeTruthy()
  })
})
