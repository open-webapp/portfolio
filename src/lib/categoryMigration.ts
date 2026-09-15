import type { Category, CategoryMapping } from './types'
import type { GlobalCategoryState } from './categoryStore'
import type { Portfolio } from './types'
import { isGlobalStoreSeeded, markGlobalStoreSeeded, saveGlobalCategoryState } from './categoryPersist'

/**
 * Pure, zero-IO: derives a seed GlobalCategoryState from a portfolio's raw persisted
 * blob. Returns null if the blob has no `categories` array to seed with (e.g. a
 * portfolio created after this feature shipped, or a legacy pre-category blob).
 * Verbatim copy — ids and fields untouched, no merge with existing state.
 */
export function computeSeedFromPortfolio(rawBlob: Record<string, unknown>): GlobalCategoryState | null {
  if (!Array.isArray(rawBlob.categories)) return null
  return {
    categories: rawBlob.categories as Category[],
    categoryMappings: (rawBlob.categoryMappings as CategoryMapping[]) ?? [],
  }
}

/**
 * One-shot orchestrator: seeds the global category store from the first unlocked
 * portfolio's raw blob, if the global store hasn't been seeded yet. No-ops thereafter.
 */
export async function seedGlobalCategoriesIfNeeded(_portfolio: Portfolio, rawBlob: Record<string, unknown>): Promise<void> {
  if (await isGlobalStoreSeeded()) return
  const seed = computeSeedFromPortfolio(rawBlob)
  if (seed === null) {
    await markGlobalStoreSeeded()
    return
  }
  await saveGlobalCategoryState(seed)
  await markGlobalStoreSeeded()
}
