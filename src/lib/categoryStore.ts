import type { Category, CategoryMapping, BudgetTransaction } from './types'
import { uid } from './seed'
import { mergeCategoryState } from './categoryMerge'

export interface GlobalCategoryState {
  categories: Category[]
  categoryMappings: CategoryMapping[]
}

/** Fresh, empty global category state. */
export function initialGlobalCategoryState(): GlobalCategoryState {
  return { categories: [], categoryMappings: [] }
}

/** Add a new category with a caller-supplied id (so the caller can synchronously know the new id). */
export function addCategory(s: GlobalCategoryState, id: string, name: string): GlobalCategoryState {
  const now = new Date().toISOString()
  return { ...s, categories: [...s.categories, { id, name, updatedAt: now }] }
}

/** Rename a category by ID, stamping updatedAt. No-op if the ID isn't found. */
export function renameCategory(s: GlobalCategoryState, id: string, name: string): GlobalCategoryState {
  const now = new Date().toISOString()
  return { ...s, categories: s.categories.map((c) => (c.id === id ? { ...c, name, updatedAt: now } : c)) }
}

/** Tombstone a category by ID (sets deletedAt + updatedAt). No-op if the ID isn't found. */
export function deleteCategory(s: GlobalCategoryState, id: string): GlobalCategoryState {
  if (!s.categories.some((c) => c.id === id)) return s
  const now = new Date().toISOString()
  return { ...s, categories: s.categories.map((c) => (c.id === id ? { ...c, deletedAt: now, updatedAt: now } : c)) }
}

/**
 * Upsert a category mapping by description substring, case-insensitive.
 * If a non-tombstoned mapping with the same substring (case-insensitively) already
 * exists, its categoryId/updatedAt are updated in place; otherwise a new mapping is
 * created. Blank/whitespace-only descriptions are a no-op. Tombstoned mappings are
 * ignored for dedup purposes (a fresh mapping is created even if a deleted one shares
 * the same substring).
 */
export function upsertCategoryMapping(s: GlobalCategoryState, description: string, categoryId: string): GlobalCategoryState {
  const trimmed = description.trim()
  if (!trimmed) return s
  const now = new Date().toISOString()
  const existing = s.categoryMappings.find((m) => !m.deletedAt && m.substring.toLowerCase() === trimmed.toLowerCase())
  if (existing) {
    return {
      ...s,
      categoryMappings: s.categoryMappings.map((m) =>
        m.id === existing.id ? { ...m, categoryId, updatedAt: now } : m
      ),
    }
  }
  const mapping: CategoryMapping = { id: uid('catmap'), substring: trimmed, categoryId, updatedAt: now }
  return { ...s, categoryMappings: [...s.categoryMappings, mapping] }
}

/** Patch an existing category mapping by ID, stamping updatedAt. No-op if the ID isn't found. */
export function updateCategoryMapping(
  s: GlobalCategoryState,
  id: string,
  patch: Partial<Pick<CategoryMapping, 'substring' | 'categoryId'>>
): GlobalCategoryState {
  const now = new Date().toISOString()
  return {
    ...s,
    categoryMappings: s.categoryMappings.map((m) => (m.id === id ? { ...m, ...patch, updatedAt: now } : m)),
  }
}

/** Add a new category mapping. Blank/whitespace-only substrings are a no-op. */
export function addCategoryMapping(s: GlobalCategoryState, categoryId: string, substring: string): GlobalCategoryState {
  const trimmed = substring.trim()
  if (!trimmed) return s
  const mapping: CategoryMapping = { id: uid('catmap'), substring: trimmed, categoryId, updatedAt: new Date().toISOString() }
  return { ...s, categoryMappings: [...s.categoryMappings, mapping] }
}

/** Tombstone a category mapping by ID (sets deletedAt + updatedAt). No-op if the ID isn't found. */
export function deleteCategoryMapping(s: GlobalCategoryState, id: string): GlobalCategoryState {
  if (!s.categoryMappings.some((m) => m.id === id)) return s
  const now = new Date().toISOString()
  return {
    ...s,
    categoryMappings: s.categoryMappings.map((m) => (m.id === id ? { ...m, deletedAt: now, updatedAt: now } : m)),
  }
}

/**
 * Resolve the categoryId for a transaction description by finding all non-tombstoned
 * mappings whose substring (case-insensitive) appears in the description, and returning
 * the categoryId of the one with the latest updatedAt. Returns null if no mapping matches.
 */
export function resolveCategoryIdForDescription(mappings: CategoryMapping[], description: string): string | null {
  const lower = description.toLowerCase()
  const matches = mappings.filter((m) => !m.deletedAt && m.substring && lower.includes(m.substring.toLowerCase()))
  if (matches.length === 0) return null
  return matches.reduce((latest, m) => (m.updatedAt > latest.updatedAt ? m : latest)).categoryId
}

/** Non-tombstoned categories, in original order. */
export function visibleCategories(s: GlobalCategoryState): Category[] {
  return s.categories.filter((c) => !c.deletedAt)
}

/** Non-tombstoned category mappings, in original order. */
export function visibleMappings(s: GlobalCategoryState): CategoryMapping[] {
  return s.categoryMappings.filter((m) => !m.deletedAt)
}

/**
 * Re-run category mapping resolution against a list of budget transactions, rewriting
 * categoryId for any transaction whose description matches a mapping. Transactions with
 * no match are left untouched. Pure; mappings are filtered for tombstones internally, so
 * callers may pass either the raw or pre-filtered mapping list.
 */
export function reapplyMappingsToTransactions(transactions: BudgetTransaction[], mappings: CategoryMapping[]): BudgetTransaction[] {
  return transactions.map((t) => {
    const resolved = resolveCategoryIdForDescription(mappings, t.description)
    return resolved ? { ...t, categoryId: resolved } : t
  })
}

export type CategoryAction =
  | { type: 'ADD_CATEGORY'; id: string; name: string }
  | { type: 'RENAME_CATEGORY'; id: string; name: string }
  | { type: 'DELETE_CATEGORY'; id: string }
  | { type: 'UPSERT_CATEGORY_MAPPING'; description: string; categoryId: string }
  | { type: 'UPDATE_CATEGORY_MAPPING'; id: string; patch: Partial<Pick<CategoryMapping, 'substring' | 'categoryId'>> }
  | { type: 'ADD_CATEGORY_MAPPING'; categoryId: string; substring: string }
  | { type: 'DELETE_CATEGORY_MAPPING'; id: string }
  | { type: '__REPLACE'; state: GlobalCategoryState }
  | { type: '__MERGE_IMPORTED'; imported: GlobalCategoryState }

export function categoryStoreReducer(s: GlobalCategoryState, a: CategoryAction): GlobalCategoryState {
  switch (a.type) {
    case '__REPLACE':
      return a.state
    case '__MERGE_IMPORTED':
      return mergeCategoryState(s, a.imported)
    case 'ADD_CATEGORY':
      return addCategory(s, a.id, a.name)
    case 'RENAME_CATEGORY':
      return renameCategory(s, a.id, a.name)
    case 'DELETE_CATEGORY':
      return deleteCategory(s, a.id)
    case 'UPSERT_CATEGORY_MAPPING':
      return upsertCategoryMapping(s, a.description, a.categoryId)
    case 'UPDATE_CATEGORY_MAPPING':
      return updateCategoryMapping(s, a.id, a.patch)
    case 'ADD_CATEGORY_MAPPING':
      return addCategoryMapping(s, a.categoryId, a.substring)
    case 'DELETE_CATEGORY_MAPPING':
      return deleteCategoryMapping(s, a.id)
    default:
      return s
  }
}
