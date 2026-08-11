import type { Position, ClosedPosition, PortfolioSnapshot } from './types'
import type { AppState } from './state'
import { uid } from './seed'
import { parseCsvNumber } from './csv'

/**
 * Import positions for an account:
 * (a) Replace all positions for accountId with new rows
 *     - Matching by symbol to preserve assetClassManualOverride
 *     - Generate fresh uid('pos') for each new position
 * (b) Create ClosedPosition[] for symbols that disappeared
 *     - Symbols that disappeared: add to closedPositions
 *     - Realized G/L: computed from matching Sell transaction(s) if exist, else realizedGL: null / realizedGLBasis: 'unknown'
 * (c) Upsert ONE PortfolioSnapshot for (accountId, importDate)
 *     - Natural key: (accountId, date)
 *     - Dedup-by-key means second import same account same date replaces prior snapshot
 *     - Value: sum of marketValue across new positions for that account
 */
export function importPositions(
  state: AppState,
  accountId: string,
  mappedRows: Record<string, string>[],
  importDate: string
): AppState {
  // Get old positions for this account
  const oldPositions = state.positions.filter((p) => p.accountId === accountId)
  const oldSymbols = new Set(oldPositions.map((p) => p.symbol))

  // (a) Create new positions from mappedRows
  // mappedRows already have mapped keys: symbol, name, assetClass, shares, avgCost, price
  // Rows missing a required field (blank cells in the CSV) are skipped rather than
  // imported as a position with fabricated NaN numbers.
  const newPositions: Position[] = []

  for (const row of mappedRows) {
    const newSymbol = row.symbol
    const shares = parseCsvNumber(row.shares)
    let avgCost = parseCsvNumber(row.avgCost)
    let price = parseCsvNumber(row.price)

    // Compute avgCost from purchaseAmount if avgCost is invalid
    if ((isNaN(avgCost) || avgCost === null || avgCost === undefined) && row.purchaseAmount) {
      const purchaseAmount = parseCsvNumber(row.purchaseAmount)
      if (!isNaN(purchaseAmount) && purchaseAmount !== null && purchaseAmount !== undefined) {
        avgCost = purchaseAmount / shares
      }
    }

    // Compute price from marketValue if price is invalid
    if ((isNaN(price) || price === null || price === undefined) && row.marketValue) {
      const marketValue = parseCsvNumber(row.marketValue)
      if (!isNaN(marketValue) && marketValue !== null && marketValue !== undefined) {
        price = marketValue / shares
      }
    }

    if (!newSymbol || !row.assetClass || isNaN(shares) || isNaN(avgCost) || isNaN(price)) {
      console.warn('Skipping row with missing/invalid required field(s):', row)
      continue
    }

    // Find old position with same symbol to preserve assetClassManualOverride
    const oldPosition = oldPositions.find((p) => p.symbol === newSymbol)

    newPositions.push({
      id: uid('pos'),
      accountId,
      symbol: newSymbol,
      name: row.name ?? null,
      assetClass: row.assetClass,
      assetClassManualOverride: oldPosition?.assetClassManualOverride,
      shares,
      avgCost,
      price,
      lastImportedAt: importDate,
    })
  }

  // Replace positions: remove old for this account, add new
  const replacedPositions = [
    ...state.positions.filter((p) => p.accountId !== accountId),
    ...newPositions,
  ]

  // (b) Diff old vs new symbols to create ClosedPosition[]
  const newSymbols = new Set(newPositions.map((p) => p.symbol))
  const closedSymbols = Array.from(oldSymbols).filter((s) => !newSymbols.has(s))

  const newClosedPositions: ClosedPosition[] = closedSymbols.map((symbol) => {
    const oldPosition = oldPositions.find((p) => p.symbol === symbol)!

    // Try to find matching Sell transaction(s)
    const sellTransactions = state.transactions.filter(
      (t) =>
        t.accountId === accountId && t.symbol === symbol && t.type.toLowerCase() === 'sell'
    )

    let realizedGL: number | null = null
    let realizedGLBasis: 'transactions' | 'unknown' = 'unknown'

    if (sellTransactions.length > 0) {
      // Compute realized G/L from sell transactions
      // realizedGL = total proceeds from sales - cost basis
      const totalProceeds = sellTransactions.reduce((sum, t) => sum + t.amount, 0)
      const costBasis = oldPosition.shares * oldPosition.avgCost
      realizedGL = totalProceeds - costBasis
      realizedGLBasis = 'transactions'
    }

    return {
      id: uid('closed'),
      accountId,
      symbol,
      name: oldPosition.name,
      closedDate: importDate,
      assetClass: oldPosition.assetClass,
      realizedGL,
      realizedGLBasis,
    }
  })

  // Merge with existing closed positions (avoid duplicates for same symbol)
  const mergedClosedPositions = [
    ...state.closedPositions.filter(
      (cp) => cp.accountId !== accountId || !closedSymbols.includes(cp.symbol)
    ),
    ...newClosedPositions,
  ]

  // (c) Upsert PortfolioSnapshot for (accountId, importDate)
  const snapshotValue = newPositions.reduce((sum, p) => {
    return sum + p.shares * p.price
  }, 0)

  const newSnapshot: PortfolioSnapshot = {
    id: uid('snap'),
    accountId,
    date: importDate,
    value: snapshotValue,
  }

  // Replace existing snapshot with same (accountId, date) key
  const mergedSnapshots = [
    ...state.snapshots.filter((s) => !(s.accountId === accountId && s.date === importDate)),
    newSnapshot,
  ]

  return {
    ...state,
    positions: replacedPositions,
    closedPositions: mergedClosedPositions,
    snapshots: mergedSnapshots,
  }
}
