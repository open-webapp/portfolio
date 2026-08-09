import { TRANSACTIONS_REQUIRED_FIELDS } from './types'

export function applyFieldMap(
  row: Record<string, string>,
  fieldMap: Record<string, string>
): Record<string, string> {
  const mapped: Record<string, string> = {}

  for (const [csvColumn, targetField] of Object.entries(fieldMap)) {
    if (targetField && row[csvColumn] !== undefined) {
      mapped[targetField] = row[csvColumn]
    }
  }

  return mapped
}

export function isBlankRow(values: Record<string, string>): boolean {
  return Object.values(values).every((value) => !value.trim())
}

export function validatePreviewRow(
  dataType: 'positions' | 'transactions',
  values: Record<string, string>
): { valid: boolean; errors: string[] } {
  if (isBlankRow(values)) {
    return { valid: true, errors: [] }
  }

  const errors: string[] = []

  if (dataType === 'positions') {
    if (!values.symbol?.trim()) errors.push('Missing symbol')
    if (!values.assetClass?.trim()) errors.push('Missing asset class')
    if (!values.shares?.trim()) errors.push('Missing shares')

    if (!values.avgCost?.trim() && !values.purchaseAmount?.trim()) {
      errors.push('Missing cost basis (avgCost or purchaseAmount)')
    }
    if (!values.price?.trim() && !values.marketValue?.trim()) {
      errors.push('Missing price (price or marketValue)')
    }
  } else if (dataType === 'transactions') {
    if (!values.date?.trim()) errors.push('Missing date')
    if (!values.symbol?.trim()) errors.push('Missing symbol')
    if (!values.type?.trim()) errors.push('Missing type')
    if (!values.shares?.trim()) errors.push('Missing shares')
    if (!values.price?.trim()) errors.push('Missing price')
    if (!values.amount?.trim()) errors.push('Missing amount')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

export function isReviewValid(
  dataType: 'positions' | 'transactions',
  fieldMap: Record<string, string>
): boolean {
  const mappedFields = new Set(Object.values(fieldMap))

  if (dataType === 'positions') {
    const alwaysRequired = ['symbol', 'shares']
    for (const field of alwaysRequired) {
      if (!mappedFields.has(field)) return false
    }

    const hasAvgCost = mappedFields.has('avgCost')
    const hasPurchaseAmount = mappedFields.has('purchaseAmount')
    if (!hasAvgCost && !hasPurchaseAmount) return false

    const hasPrice = mappedFields.has('price')
    const hasMarketValue = mappedFields.has('marketValue')
    if (!hasPrice && !hasMarketValue) return false

    return true
  }

  for (const field of TRANSACTIONS_REQUIRED_FIELDS) {
    if (!mappedFields.has(field)) return false
  }

  return true
}
