import type { MappingProfile } from './types'
import { TRANSACTIONS_REQUIRED_FIELDS } from './types'
import { uid } from './seed'

/**
 * Create a new mapping profile with a fresh uid and timestamps.
 */
export function createProfile(
  name: string,
  kind: 'positions' | 'transactions',
  fieldMap: Record<string, string>,
  accountNumberColumn?: string
): MappingProfile {
  const now = new Date().toISOString()
  return {
    id: uid('map'),
    name,
    kind,
    fieldMap,
    accountNumberColumn,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Update an existing profile with new values.
 * Returns a new profile object with updated fields and updatedAt timestamp.
 */
export function updateProfile(
  profile: MappingProfile,
  name?: string,
  fieldMap?: Record<string, string>,
  accountNumberColumn?: string
): MappingProfile {
  return {
    ...profile,
    ...(name !== undefined && { name }),
    ...(fieldMap !== undefined && { fieldMap }),
    ...(accountNumberColumn !== undefined && { accountNumberColumn }),
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Delete a profile from the profiles array by id.
 * Returns a new array without the deleted profile.
 */
export function deleteProfile(profiles: MappingProfile[], profileId: string): MappingProfile[] {
  return profiles.filter((p) => p.id !== profileId)
}

/**
 * Filter profiles by kind (positions or transactions).
 */
export function listProfilesForKind(
  profiles: MappingProfile[],
  kind: 'positions' | 'transactions'
): MappingProfile[] {
  return profiles.filter((p) => p.kind === kind)
}

/**
 * Apply a mapping profile to a CSV row.
 * Renames CSV headers according to fieldMap, returning a new object with mapped keys.
 */
export function applyMapping(
  row: Record<string, string>,
  profile: MappingProfile
): Record<string, string> {
  const mapped: Record<string, string> = {}

  // For each CSV column, if there's a mapping, rename it
  for (const [csvColumn, value] of Object.entries(row)) {
    const targetField = profile.fieldMap[csvColumn]
    if (targetField) {
      mapped[targetField] = value
    }
  }

  return mapped
}

/**
 * Validation result type.
 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings?: string[]
}

/**
 * Validate a profile by checking that all required fields for its kind are mapped.
 * For positions, allows alternative fields (avgCost OR purchaseAmount, price OR marketValue).
 * Returns warnings for non-blocking issues (e.g., both alternatives mapped).
 */
export function validateProfile(
  profile: MappingProfile,
  kind: 'positions' | 'transactions'
): ValidationResult {
  const mappedFields = new Set(Object.values(profile.fieldMap))
  const errors: string[] = []
  const warnings: string[] = []

  if (kind === 'positions') {
    // Check always-required fields for positions
    const alwaysRequired = ['symbol', 'name', 'assetClass', 'shares']
    for (const field of alwaysRequired) {
      if (!mappedFields.has(field)) {
        errors.push(`Required field '${field}' is not mapped`)
      }
    }

    // Check that EITHER avgCost OR purchaseAmount is mapped (not both missing)
    const hasAvgCost = mappedFields.has('avgCost')
    const hasPurchaseAmount = mappedFields.has('purchaseAmount')
    if (!hasAvgCost && !hasPurchaseAmount) {
      errors.push("Either 'avgCost' OR 'purchaseAmount' must be mapped (not both missing)")
    }

    // Check that EITHER price OR marketValue is mapped (not both missing)
    const hasPrice = mappedFields.has('price')
    const hasMarketValue = mappedFields.has('marketValue')
    if (!hasPrice && !hasMarketValue) {
      errors.push("Either 'price' OR 'marketValue' must be mapped (not both missing)")
    }

    // Warn if both avgCost AND purchaseAmount are present
    if (hasAvgCost && hasPurchaseAmount) {
      warnings.push("Both 'avgCost' and 'purchaseAmount' are mapped; will prefer 'avgCost' during import")
    }

    // Warn if both price AND marketValue are present
    if (hasPrice && hasMarketValue) {
      warnings.push("Both 'price' and 'marketValue' are mapped; will prefer 'price' during import")
    }
  } else {
    // For transactions, keep existing logic: check all required fields are mapped
    const requiredFields = TRANSACTIONS_REQUIRED_FIELDS
    for (const field of requiredFields) {
      if (!mappedFields.has(field)) {
        errors.push(`Required field '${field}' is not mapped`)
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    ...(warnings.length > 0 && { warnings }),
  }
}
