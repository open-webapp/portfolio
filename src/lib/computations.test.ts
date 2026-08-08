import { describe, it, expect } from 'vitest'
import { computePosition, allocationByAssetClass, fmtUSD, fmtPct } from './computations'
import { Position } from './types'

describe('computations', () => {
  // Test 1: computePosition basic math
  it('computePosition: computes marketValue, costBasis, gl, glPct correctly', () => {
    const position: Position = {
      id: 'pos-1',
      accountId: 'acc-1',
      symbol: 'AAPL',
      name: 'Apple Inc.',
      assetClass: 'Equity',
      shares: 100,
      avgCost: 150,
      price: 200,
      lastImportedAt: '2026-08-08'
    }

    const result = computePosition(position)

    expect(result.marketValue).toBe(20000) // 100 * 200
    expect(result.costBasis).toBe(15000) // 100 * 150
    expect(result.gl).toBe(5000) // 20000 - 15000
    expect(result.glPct).toBe((5000 / 15000) * 100) // ~33.33%
  })

  // Test 2: costBasis === 0 → glPct === 0 (no divide-by-zero)
  it('computePosition: handles costBasis === 0 without divide-by-zero', () => {
    const position: Position = {
      id: 'pos-2',
      accountId: 'acc-1',
      symbol: 'CASH',
      name: 'Cash',
      assetClass: 'Cash',
      shares: 1,
      avgCost: 0,
      price: 100,
      lastImportedAt: '2026-08-08'
    }

    const result = computePosition(position)

    expect(result.marketValue).toBe(100) // 1 * 100
    expect(result.costBasis).toBe(0) // 1 * 0
    expect(result.gl).toBe(100) // 100 - 0
    expect(result.glPct).toBe(0) // Should be 0, not NaN or Infinity
  })

  // Test 3: negative gl → glPct negative
  it('computePosition: handles negative gl and glPct correctly', () => {
    const position: Position = {
      id: 'pos-3',
      accountId: 'acc-1',
      symbol: 'TSLA',
      name: 'Tesla Inc.',
      assetClass: 'Equity',
      shares: 50,
      avgCost: 200,
      price: 150,
      lastImportedAt: '2026-08-08'
    }

    const result = computePosition(position)

    expect(result.marketValue).toBe(7500) // 50 * 150
    expect(result.costBasis).toBe(10000) // 50 * 200
    expect(result.gl).toBe(-2500) // 7500 - 10000
    expect(result.glPct).toBe((-2500 / 10000) * 100) // -25%
  })

  // Test 4: allocationByAssetClass groups and calculates percentages
  it('allocationByAssetClass: groups by asset class and calculates percentages', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-2',
        accountId: 'acc-1',
        symbol: 'MSFT',
        name: 'Microsoft Corp.',
        assetClass: 'Equity',
        shares: 50,
        avgCost: 300,
        price: 400,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-3',
        accountId: 'acc-1',
        symbol: 'BND',
        name: 'Bond ETF',
        assetClass: 'Fixed Income',
        shares: 200,
        avgCost: 50,
        price: 50,
        lastImportedAt: '2026-08-08'
      }
    ]

    const result = allocationByAssetClass(positions)

    // Total market value: (100*200) + (50*400) + (200*50) = 20000 + 20000 + 10000 = 50000
    // Equity: 40000, Fixed Income: 10000
    expect(result).toHaveLength(2)

    const equity = result.find(r => r.label === 'Equity')!
    const fixedIncome = result.find(r => r.label === 'Fixed Income')!

    expect(equity.value).toBe(40000)
    expect(equity.pct).toBe(80) // 40000 / 50000 * 100

    expect(fixedIncome.value).toBe(10000)
    expect(fixedIncome.pct).toBe(20) // 10000 / 50000 * 100

    // Verify percentages sum to 100 (within float epsilon)
    const sum = result.reduce((acc, r) => acc + r.pct, 0)
    expect(sum).toBeCloseTo(100, 5)
  })

  // Test 5: allocationByAssetClass with empty positions → empty result, no NaN
  it('allocationByAssetClass: handles empty positions without NaN', () => {
    const result = allocationByAssetClass([])

    expect(result).toEqual([])
    expect(result.every(r => !isNaN(r.pct))).toBe(true)
  })

  // Test 6: fmtUSD/fmtPct format exactly as prototype
  it('fmtUSD: formats correctly with negative signs and decimals', () => {
    expect(fmtUSD(1234.56)).toBe('$1,234.56')
    expect(fmtUSD(-5.00)).toBe('-$5.00')
    expect(fmtUSD(0)).toBe('$0.00')
    expect(fmtUSD(-1234.567)).toBe('-$1,234.57') // Should round
    expect(fmtUSD(1000000)).toBe('$1,000,000.00')
  })

  it('fmtPct: formats correctly with sign and 2 decimals', () => {
    expect(fmtPct(1.2)).toBe('+1.20%')
    expect(fmtPct(-1.2)).toBe('-1.20%')
    expect(fmtPct(0)).toBe('+0.00%')
    expect(fmtPct(33.333)).toBe('+33.33%')
    expect(fmtPct(-25)).toBe('-25.00%')
  })

  // Additional validation: allocationByAssetClass with zero-value positions
  it('allocationByAssetClass: sums to 100% even with multiple asset classes', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'VTI',
        name: 'Vanguard Total Stock',
        assetClass: 'ETF',
        shares: 100,
        avgCost: 100,
        price: 300,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-2',
        accountId: 'acc-1',
        symbol: 'BND',
        name: 'Bond ETF',
        assetClass: 'Fixed Income',
        shares: 100,
        avgCost: 50,
        price: 200,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-3',
        accountId: 'acc-1',
        symbol: 'GLD',
        name: 'Gold ETF',
        assetClass: 'Commodity',
        shares: 100,
        avgCost: 200,
        price: 200,
        lastImportedAt: '2026-08-08'
      }
    ]

    const result = allocationByAssetClass(positions)

    // Total: (100*300) + (100*200) + (100*200) = 30000 + 20000 + 20000 = 70000
    // ETF: 30000 (42.86%), Fixed Income: 20000 (28.57%), Commodity: 20000 (28.57%)
    const percentSum = result.reduce((acc, r) => acc + r.pct, 0)
    expect(percentSum).toBeCloseTo(100, 5)
  })
})
