import type { GlobalCategoryState } from './categoryStore'

/** Comparable timestamp for merge conflict resolution: deletedAt if present, else updatedAt. */
function mergeTimestamp(record: { updatedAt: string; deletedAt?: string }): string {
  return record.deletedAt ?? record.updatedAt
}

/**
 * Union two arrays of timestamped records. For a shared key, keep whichever record has
 * the larger `deletedAt ?? updatedAt`; ties keep `a`'s copy. Records present on only one
 * side pass through unchanged.
 */
function mergeById<T extends { updatedAt: string; deletedAt?: string }>(
  a: T[],
  b: T[],
  keySelector: (record: T) => string = (record) => (record as T & { id: string }).id
): T[] {
  const bById = new Map(b.map((r) => [keySelector(r), r]))
  const result: T[] = []
  const seen = new Set<string>()

  for (const recordA of a) {
    const key = keySelector(recordA)
    seen.add(key)
    const recordB = bById.get(key)
    if (!recordB) {
      result.push(recordA)
    } else {
      result.push(mergeTimestamp(recordB) > mergeTimestamp(recordA) ? recordB : recordA)
    }
  }

  for (const recordB of b) {
    if (!seen.has(keySelector(recordB))) result.push(recordB)
  }

  return result
}

/**
 * Merge two GlobalCategoryState snapshots. Categories merge by id; budget account rules
 * merge by normalized name. Conflicts keep the record with the larger
 * `deletedAt ?? updatedAt` timestamp; ties keep `a`'s copy. Pure; no IO.
 */
export function mergeCategoryState(a: GlobalCategoryState, b: GlobalCategoryState): GlobalCategoryState {
  return {
    categories: mergeById(a.categories, b.categories),
    budgetAccountRules: mergeById(
      Array.isArray(a.budgetAccountRules) ? a.budgetAccountRules : [],
      Array.isArray(b.budgetAccountRules) ? b.budgetAccountRules : [],
      (rule) => rule.normalizedName
    ),
  }
}
