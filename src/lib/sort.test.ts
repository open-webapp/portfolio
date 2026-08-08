import { describe, it, expect } from 'vitest'
import { sortBy } from './sort'
import { Position } from './types'

describe('sortBy', () => {
  // Test 1: Sort numbers ascending/descending
  it('sorts numeric keys ascending (e.g., marketValue)', () => {
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
        name: 'Microsoft',
        assetClass: 'Equity',
        shares: 50,
        avgCost: 300,
        price: 400,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-3',
        accountId: 'acc-1',
        symbol: 'GOOGL',
        name: 'Google',
        assetClass: 'Equity',
        shares: 200,
        avgCost: 100,
        price: 150,
        lastImportedAt: '2026-08-08'
      }
    ]

    const sorted = sortBy(positions, 'shares', 'asc')

    expect(sorted[0].shares).toBe(50)   // MSFT
    expect(sorted[1].shares).toBe(100)  // AAPL
    expect(sorted[2].shares).toBe(200)  // GOOGL
  })

  it('sorts numeric keys descending', () => {
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
        name: 'Microsoft',
        assetClass: 'Equity',
        shares: 50,
        avgCost: 300,
        price: 400,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-3',
        accountId: 'acc-1',
        symbol: 'GOOGL',
        name: 'Google',
        assetClass: 'Equity',
        shares: 200,
        avgCost: 100,
        price: 150,
        lastImportedAt: '2026-08-08'
      }
    ]

    const sorted = sortBy(positions, 'shares', 'desc')

    expect(sorted[0].shares).toBe(200)  // GOOGL
    expect(sorted[1].shares).toBe(100)  // AAPL
    expect(sorted[2].shares).toBe(50)   // MSFT
  })

  // Test 2: Sort strings ascending/descending with localeCompare
  it('sorts string keys ascending (e.g., symbol) with case-insensitive localeCompare', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'ZZZA',
        name: 'Last',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-2',
        accountId: 'acc-1',
        symbol: 'AAAB',
        name: 'First',
        assetClass: 'Equity',
        shares: 50,
        avgCost: 300,
        price: 400,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-3',
        accountId: 'acc-1',
        symbol: 'MMMC',
        name: 'Middle',
        assetClass: 'Equity',
        shares: 200,
        avgCost: 100,
        price: 150,
        lastImportedAt: '2026-08-08'
      }
    ]

    const sorted = sortBy(positions, 'symbol', 'asc')

    expect(sorted[0].symbol).toBe('AAAB')
    expect(sorted[1].symbol).toBe('MMMC')
    expect(sorted[2].symbol).toBe('ZZZA')
  })

  it('sorts string keys descending', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'ZZZA',
        name: 'Last',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-2',
        accountId: 'acc-1',
        symbol: 'AAAB',
        name: 'First',
        assetClass: 'Equity',
        shares: 50,
        avgCost: 300,
        price: 400,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-3',
        accountId: 'acc-1',
        symbol: 'MMMC',
        name: 'Middle',
        assetClass: 'Equity',
        shares: 200,
        avgCost: 100,
        price: 150,
        lastImportedAt: '2026-08-08'
      }
    ]

    const sorted = sortBy(positions, 'symbol', 'desc')

    expect(sorted[0].symbol).toBe('ZZZA')
    expect(sorted[1].symbol).toBe('MMMC')
    expect(sorted[2].symbol).toBe('AAAB')
  })

  // Test 3: Equal keys don't throw
  it('handles equal keys without throwing', () => {
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
        name: 'Microsoft',
        assetClass: 'Equity',
        shares: 100, // Same shares value
        avgCost: 300,
        price: 400,
        lastImportedAt: '2026-08-08'
      }
    ]

    const sorted = sortBy(positions, 'shares', 'asc')

    expect(sorted).toHaveLength(2)
    expect(sorted[0].shares).toBe(100)
    expect(sorted[1].shares).toBe(100)
  })

  // Test 4: Mixed case strings sorted correctly (case-insensitive)
  it('sorts mixed-case strings correctly with case-insensitive localeCompare', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'Apple',
        name: 'apple Inc.',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-2',
        accountId: 'acc-1',
        symbol: 'Zebra',
        name: 'zebra Corp',
        assetClass: 'Equity',
        shares: 50,
        avgCost: 300,
        price: 400,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-3',
        accountId: 'acc-1',
        symbol: 'banana',
        name: 'BANANA Ltd',
        assetClass: 'Equity',
        shares: 200,
        avgCost: 100,
        price: 150,
        lastImportedAt: '2026-08-08'
      }
    ]

    const sorted = sortBy(positions, 'name', 'asc')

    // Should sort as: apple, BANANA, zebra (case-insensitive)
    expect(sorted[0].name).toBe('apple Inc.')
    expect(sorted[1].name).toBe('BANANA Ltd')
    expect(sorted[2].name).toBe('zebra Corp')
  })

  // Test 5: Non-mutating - original array unchanged
  it('does not mutate the original array', () => {
    const positions: Position[] = [
      {
        id: 'pos-1',
        accountId: 'acc-1',
        symbol: 'ZZZA',
        name: 'Last',
        assetClass: 'Equity',
        shares: 100,
        avgCost: 150,
        price: 200,
        lastImportedAt: '2026-08-08'
      },
      {
        id: 'pos-2',
        accountId: 'acc-1',
        symbol: 'AAAB',
        name: 'First',
        assetClass: 'Equity',
        shares: 50,
        avgCost: 300,
        price: 400,
        lastImportedAt: '2026-08-08'
      }
    ]

    const originalOrder = [positions[0], positions[1]]
    sortBy(positions, 'symbol', 'asc')

    expect(positions[0]).toBe(originalOrder[0])
    expect(positions[1]).toBe(originalOrder[1])
  })

  // Test 6: Empty array
  it('handles empty arrays', () => {
    const positions: Position[] = []
    const sorted = sortBy(positions, 'symbol', 'asc')

    expect(sorted).toHaveLength(0)
  })

  // Test 7: Single item
  it('handles single-item arrays', () => {
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
      }
    ]

    const sorted = sortBy(positions, 'symbol', 'asc')

    expect(sorted).toHaveLength(1)
    expect(sorted[0].symbol).toBe('AAPL')
  })
})
