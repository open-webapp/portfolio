import type { Position } from './types'
import { computePosition } from './computations'

/**
 * Build a grouping key from a position and accounts array.
 * Key format: `${symbol}|${effectiveAssetClass}`
 *
 * Tax category and retirement status are ignored in grouping.
 */
export function buildGroupKey(position: Position): string {
  const effectiveAssetClass = position.assetClassManualOverride || position.assetClass
  return `${position.symbol}|${effectiveAssetClass}`
}

/**
 * Aggregated position row: multiple positions grouped by symbol, asset class, and account attributes.
 */
export interface AggregateRow {
  key: string
  symbol: string
  displayName: string
  effectiveAssetClass: string
  shares: number
  costBasis: number
  marketValue: number
  price: number
  avgCost: number
  gl: number
  glPct: number
  rowCount: number
  positions: Position[]
}

/**
 * Mapping from Position column keys to AggregateRow sort fields.
 * Used when sorting aggregate rows to translate the position key to the corresponding aggregate field.
 * Example: assetClass (Position key) maps to effectiveAssetClass (AggregateRow field).
 */
export const AGGREGATE_SORT_FIELD: Record<string, keyof AggregateRow> = {
  assetClass: 'effectiveAssetClass',
  // All other sortable keys (symbol, shares, avgCost, price) have identity mapping
}

/**
 * Group positions by their aggregation key and compute aggregate values.
 * Returns sorted list of AggregateRow objects.
 */
export function buildAggregateRows(positions: Position[]): AggregateRow[] {
  // Group positions by key
  const groups: Record<string, Position[]> = {}

  positions.forEach((p) => {
    const key = buildGroupKey(p)
    if (!groups[key]) {
      groups[key] = []
    }
    groups[key].push(p)
  })

  // Convert groups to AggregateRow objects
  return Object.entries(groups).map(([key, groupPositions]) => {
    // Compute each position and sum values
    let totalShares = 0
    let totalCostBasis = 0
    let totalMarketValue = 0

    groupPositions.forEach((p) => {
      const computed = computePosition(p)
      totalShares += computed.shares
      totalCostBasis += computed.costBasis
      totalMarketValue += computed.marketValue
    })

    // Derive aggregate values
    const price = totalShares === 0 ? 0 : totalMarketValue / totalShares
    const avgCost = totalShares === 0 ? 0 : totalCostBasis / totalShares
    const gl = totalMarketValue - totalCostBasis
    const glPct = totalCostBasis === 0 ? 0 : (gl / totalCostBasis) * 100

    // Get displayName from first position
    const displayName = groupPositions[0].name ?? groupPositions[0].symbol

    // Count total positions in group
    const rowCount = groupPositions.length

    return {
      key,
      symbol: groupPositions[0].symbol,
      displayName,
      effectiveAssetClass: groupPositions[0].assetClassManualOverride || groupPositions[0].assetClass,
      shares: totalShares,
      costBasis: totalCostBasis,
      marketValue: totalMarketValue,
      price,
      avgCost,
      gl,
      glPct,
      rowCount,
      positions: groupPositions,
    }
  })
}
