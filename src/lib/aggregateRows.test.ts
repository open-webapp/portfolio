import { describe, it, expect } from 'vitest'
import { buildGroupKey, buildAggregateRows } from './aggregateRows'
import type { Position } from './types'

// Helper to create a minimal valid Position, with overrides
function makePosition(overrides: Partial<Position> & { id: string; symbol: string }): Position {
  return {
    accountId: 'acc-1',
    name: null,
    assetClass: 'Equity',
    shares: 10,
    avgCost: 100,
    price: 150,
    lastImportedAt: '2026-01-01',
    ...overrides,
  }
}

describe('buildGroupKey', () => {
  it('uses symbol when trackingSymbol is absent', () => {
    const p = makePosition({ id: 'p1', symbol: 'AAPL', assetClass: 'Equity' })
    expect(buildGroupKey(p)).toBe('AAPL|Equity')
  })

  it('uses trackingSymbol when present, ignoring symbol', () => {
    const p = makePosition({ id: 'p1', symbol: 'AAPL-CLASSA', trackingSymbol: 'AAPL', assetClass: 'Equity' })
    expect(buildGroupKey(p)).toBe('AAPL|Equity')
  })

  it('uses symbol when trackingSymbol is blank string', () => {
    const p = makePosition({ id: 'p1', symbol: 'AAPL', trackingSymbol: '', assetClass: 'Equity' })
    expect(buildGroupKey(p)).toBe('AAPL|Equity')
  })

  it('uses assetClassManualOverride for effectiveAssetClass when set', () => {
    const p = makePosition({
      id: 'p1',
      symbol: 'AAPL',
      assetClass: 'Equity',
      assetClassManualOverride: 'ETF',
    })
    expect(buildGroupKey(p)).toBe('AAPL|ETF')
  })

  it('uses trackingSymbol together with assetClassManualOverride', () => {
    const p = makePosition({
      id: 'p1',
      symbol: 'AAPL-CLASSA',
      trackingSymbol: 'AAPL',
      assetClass: 'Equity',
      assetClassManualOverride: 'ETF',
    })
    expect(buildGroupKey(p)).toBe('AAPL|ETF')
  })

  it('produces different keys when trackingSymbol does not equal the other symbol', () => {
    const p1 = makePosition({ id: 'p1', symbol: 'AAPL', assetClass: 'Equity' })
    const p2 = makePosition({ id: 'p2', symbol: 'AAPL', trackingSymbol: 'GOOG', assetClass: 'Equity' })
    expect(buildGroupKey(p1)).not.toBe(buildGroupKey(p2))
  })

  it('produces matching keys when trackingSymbol equals the other position plain symbol', () => {
    const p1 = makePosition({ id: 'p1', symbol: 'AAPL', assetClass: 'Equity' })
    const p2 = makePosition({ id: 'p2', symbol: 'AAPL-CLASSB', trackingSymbol: 'AAPL', assetClass: 'Equity' })
    expect(buildGroupKey(p1)).toBe(buildGroupKey(p2))
  })
})

describe('buildAggregateRows', () => {
  it('(a) groups two positions with same trackingSymbol but different symbol into one row', () => {
    const positions: Position[] = [
      makePosition({ id: 'p1', symbol: 'AAPL-CLASSA', trackingSymbol: 'AAPL', assetClass: 'Equity', shares: 10, avgCost: 100, price: 150 }),
      makePosition({ id: 'p2', symbol: 'AAPL-CLASSB', trackingSymbol: 'AAPL', assetClass: 'Equity', shares: 5, avgCost: 90, price: 150 }),
    ]

    const rows = buildAggregateRows(positions)
    expect(rows).toHaveLength(1)
    expect(rows[0].rowCount).toBe(2)
    expect(rows[0].symbol).toBe('AAPL')
    expect(rows[0].shares).toBe(15)
  })

  it('(b) position with no trackingSymbol groups/displays by symbol as before (regression)', () => {
    const positions: Position[] = [
      makePosition({ id: 'p1', symbol: 'MSFT', assetClass: 'Equity', shares: 10, avgCost: 100, price: 150 }),
      makePosition({ id: 'p2', symbol: 'MSFT', assetClass: 'Equity', shares: 5, avgCost: 90, price: 150 }),
    ]

    const rows = buildAggregateRows(positions)
    expect(rows).toHaveLength(1)
    expect(rows[0].rowCount).toBe(2)
    expect(rows[0].symbol).toBe('MSFT')
    expect(rows[0].key).toBe('MSFT|Equity')
  })

  it('(c) AggregateRow.symbol equals trackingSymbol when set on group first position', () => {
    const positions: Position[] = [
      makePosition({ id: 'p1', symbol: 'AAPL-CLASSA', trackingSymbol: 'AAPL', assetClass: 'Equity' }),
    ]
    const rows = buildAggregateRows(positions)
    expect(rows[0].symbol).toBe('AAPL')
  })

  it('(c) AggregateRow.symbol equals symbol when trackingSymbol is blank/undefined', () => {
    const positionsUndefined: Position[] = [
      makePosition({ id: 'p1', symbol: 'MSFT', assetClass: 'Equity' }),
    ]
    expect(buildAggregateRows(positionsUndefined)[0].symbol).toBe('MSFT')

    const positionsBlank: Position[] = [
      makePosition({ id: 'p1', symbol: 'MSFT', trackingSymbol: '', assetClass: 'Equity' }),
    ]
    expect(buildAggregateRows(positionsBlank)[0].symbol).toBe('MSFT')
  })

  it('(d) does NOT merge when trackingSymbol does not equal the other symbol, even with same plain symbol', () => {
    const positions: Position[] = [
      makePosition({ id: 'p1', symbol: 'AAPL', assetClass: 'Equity', shares: 10, avgCost: 100, price: 150 }),
      makePosition({ id: 'p2', symbol: 'AAPL', trackingSymbol: 'GOOG', assetClass: 'Equity', shares: 5, avgCost: 90, price: 150 }),
    ]

    expect(buildGroupKey(positions[0])).not.toBe(buildGroupKey(positions[1]))

    const rows = buildAggregateRows(positions)
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.rowCount)).toEqual([1, 1])
  })

  it('(d) merges when trackingSymbol on one equals the plain symbol of another (resolved strings literally equal)', () => {
    const positions: Position[] = [
      makePosition({ id: 'p1', symbol: 'AAPL', assetClass: 'Equity', shares: 10, avgCost: 100, price: 150 }),
      makePosition({ id: 'p2', symbol: 'AAPL-CLASSB', trackingSymbol: 'AAPL', assetClass: 'Equity', shares: 5, avgCost: 90, price: 150 }),
    ]

    expect(buildGroupKey(positions[0])).toBe(buildGroupKey(positions[1]))

    const rows = buildAggregateRows(positions)
    expect(rows).toHaveLength(1)
    expect(rows[0].rowCount).toBe(2)
    expect(rows[0].symbol).toBe('AAPL')
  })
})
