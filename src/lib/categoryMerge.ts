import type { GlobalCategoryState } from './categoryStore'

/** Comparable timestamp for merge conflict resolution: deletedAt if present, else updatedAt. */
function mergeTimestamp(record: { updatedAt: string; deletedAt?: string }): string {
  return record.deletedAt ?? record.updatedAt
}

/**
 * Union two arrays of timestamped, id-keyed records. For an id present on both sides,
 * keep whichever record has the larger `deletedAt ?? updatedAt`; ties keep `a`'s copy.
 * Ids present on only one side pass through unchanged.
 */
function mergeById<T extends { id: string; updatedAt: string; deletedAt?: string }>(a: T[], b: T[]): T[] {
  const bById = new Map(b.map((r) => [r.id, r]))
  const result: T[] = []
  const seen = new Set<string>()

  for (const recordA of a) {
    seen.add(recordA.id)
    const recordB = bById.get(recordA.id)
    if (!recordB) {
      result.push(recordA)
    } else {
      result.push(mergeTimestamp(recordB) > mergeTimestamp(recordA) ? recordB : recordA)
    }
  }

  for (const recordB of b) {
    if (!seen.has(recordB.id)) result.push(recordB)
  }

  return result
}

/**
 * Merge two GlobalCategoryState snapshots. `categories` and `categoryMappings` are
 * merged independently by id, keeping the record with the larger `deletedAt ?? updatedAt`
 * timestamp on conflict (ties keep `a`'s copy). Pure; no IO.
 */
export function mergeCategoryState(a: GlobalCategoryState, b: GlobalCategoryState): GlobalCategoryState {
  return {
    categories: mergeById(a.categories, b.categories),
    categoryMappings: mergeById(a.categoryMappings, b.categoryMappings),
  }
}
