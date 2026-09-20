import type { BudgetAccountRule, Category, CategoryMapping, BudgetTransaction, ExpenseDefinition, StatementConvention } from './types'
import { uid } from './seed'
import { mergeCategoryState } from './categoryMerge'
import { normalizeBudgetAccountName } from './budgetAccountRules'

export interface GlobalCategoryState {
  categories: Category[]
  categoryMappings: CategoryMapping[]
  budgetAccountRules: BudgetAccountRule[]
}

/** Fresh, empty global category state. */
export function initialGlobalCategoryState(): GlobalCategoryState {
  return { categories: [], categoryMappings: [], budgetAccountRules: [] }
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

/** Set a category's excludeFromSpend flag by ID, stamping updatedAt. No-op if the ID isn't found. */
export function setCategoryExcludeFromSpend(s: GlobalCategoryState, id: string, exclude: boolean): GlobalCategoryState {
  const now = new Date().toISOString()
  return { ...s, categories: s.categories.map((c) => (c.id === id ? { ...c, excludeFromSpend: exclude, updatedAt: now } : c)) }
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
 * exists, its spendExpenseId/updatedAt are updated in place; otherwise a new mapping is
 * created. Blank/whitespace-only descriptions are a no-op. Tombstoned mappings are
 * ignored for dedup purposes (a fresh mapping is created even if a deleted one shares
 * the same substring).
 */
export function upsertCategoryMapping(s: GlobalCategoryState, description: string, spendExpenseId: string): GlobalCategoryState {
  const trimmed = description.trim()
  if (!trimmed) return s
  const now = new Date().toISOString()
  const existing = s.categoryMappings.find((m) => !m.deletedAt && m.substring.toLowerCase() === trimmed.toLowerCase())
  if (existing) {
    return {
      ...s,
      categoryMappings: s.categoryMappings.map((m) =>
        m.id === existing.id ? { ...m, spendExpenseId, updatedAt: now } : m
      ),
    }
  }
  const mapping: CategoryMapping = { id: uid('catmap'), substring: trimmed, spendExpenseId, updatedAt: now }
  return { ...s, categoryMappings: [...s.categoryMappings, mapping] }
}

/** Patch an existing category mapping by ID, stamping updatedAt. No-op if the ID isn't found. */
export function updateCategoryMapping(
  s: GlobalCategoryState,
  id: string,
  patch: Partial<Pick<CategoryMapping, 'substring' | 'spendExpenseId'>>
): GlobalCategoryState {
  const now = new Date().toISOString()
  return {
    ...s,
    categoryMappings: s.categoryMappings.map((m) => (m.id === id ? { ...m, ...patch, updatedAt: now } : m)),
  }
}

/** Add a new category mapping. Blank/whitespace-only substrings are a no-op. */
export function addCategoryMapping(s: GlobalCategoryState, spendExpenseId: string, substring: string): GlobalCategoryState {
  const trimmed = substring.trim()
  if (!trimmed) return s
  const mapping: CategoryMapping = { id: uid('catmap'), substring: trimmed, spendExpenseId, updatedAt: new Date().toISOString() }
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

/** Create or update a live budget-account sign convention rule. */
export function configureBudgetAccountRule(
  s: GlobalCategoryState,
  name: string,
  convention: StatementConvention
): GlobalCategoryState {
  const normalizedName = normalizeBudgetAccountName(name)
  if (!normalizedName) return s

  const existing = s.budgetAccountRules.find((rule) => !rule.deletedAt && rule.normalizedName === normalizedName)
  if (existing) {
    if (existing.statementConvention === convention) return s
    const now = new Date().toISOString()
    return {
      ...s,
      budgetAccountRules: s.budgetAccountRules.map((rule) =>
        rule === existing ? { ...rule, statementConvention: convention, updatedAt: now } : rule
      ),
    }
  }

  const rule: BudgetAccountRule = {
    normalizedName,
    displayName: name.trim(),
    statementConvention: convention,
    updatedAt: new Date().toISOString(),
  }
  return { ...s, budgetAccountRules: [...s.budgetAccountRules, rule] }
}

/** Tombstone a live budget-account rule. */
export function deleteBudgetAccountRule(s: GlobalCategoryState, normalizedName: string): GlobalCategoryState {
  const existing = s.budgetAccountRules.find((rule) => !rule.deletedAt && rule.normalizedName === normalizedName)
  if (!existing) return s
  const now = new Date().toISOString()
  return {
    ...s,
    budgetAccountRules: s.budgetAccountRules.map((rule) =>
      rule === existing ? { ...rule, deletedAt: now, updatedAt: now } : rule
    ),
  }
}

/**
 * Resolve the spendExpenseId for a transaction description by finding all non-tombstoned
 * mappings whose substring (case-insensitive) appears in the description, and returning
 * the spendExpenseId of the one with the latest updatedAt. Returns null if no mapping matches.
 */
export function resolveSpendExpenseIdForDescription(mappings: CategoryMapping[], description: string): string | null {
  const lower = description.toLowerCase()
  const matches = mappings.filter((m) => !m.deletedAt && m.substring && lower.includes(m.substring.toLowerCase()))
  if (matches.length === 0) return null
  return matches.reduce((latest, m) => (m.updatedAt > latest.updatedAt ? m : latest)).spendExpenseId
}

/** Non-tombstoned categories, in original order. */
export function visibleCategories(s: GlobalCategoryState): Category[] {
  return s.categories.filter((c) => !c.deletedAt)
}

/** Non-tombstoned category mappings, in original order. */
export function visibleMappings(s: GlobalCategoryState): CategoryMapping[] {
  return s.categoryMappings.filter((m) => !m.deletedAt)
}

/** Non-tombstoned budget-account rules, in original order. */
export function visibleBudgetAccountRules(s: GlobalCategoryState): BudgetAccountRule[] {
  return s.budgetAccountRules.filter((rule) => !rule.deletedAt)
}

/**
 * First array-order ExpenseDefinition in `budgetExpenseDefinitions` whose categoryId
 * matches `categoryId`, or undefined if none match. Shared by resolveBudgetImportRows
 * (state.ts) and reapplyMappingsToTransactions (this file) for auto-linking a
 * transaction's spendExpenseId to a same-category expense definition.
 */
export function resolveSpendExpenseForCategory(
  budgetExpenseDefinitions: ExpenseDefinition[],
  categoryId: string
): ExpenseDefinition | undefined {
  return budgetExpenseDefinitions.find((e) => e.categoryId === categoryId)
}

/**
 * Re-run category mapping resolution against a list of budget transactions, applying
 * matches by direct lookup: for each transaction, resolveSpendExpenseIdForDescription
 * finds the latest-updated non-tombstoned mapping whose substring appears in the
 * description. On a match, the mapping's spendExpenseId is looked up in
 * `budgetExpenseDefinitions`; if a definition is found, the transaction's categoryId
 * is set to the definition's categoryId and spendExpenseId to the matched
 * spendExpenseId — no guessing, no category-based inference.
 *
 * A match that resolves to a spendExpenseId whose definition no longer exists
 * (dangling), and a description with no match at all, both leave the transaction
 * untouched: reapply never clears or overwrites without a confirmed definition
 * lookup. (The import-time fallback-to-Other only applies at resolve time for fresh
 * transactions, never here.)
 *
 * Pure; mappings are filtered for tombstones internally, so callers may pass either the
 * raw or pre-filtered mapping list.
 */
export function reapplyMappingsToTransactions(
  transactions: BudgetTransaction[],
  mappings: CategoryMapping[],
  budgetExpenseDefinitions: ExpenseDefinition[] = []
): BudgetTransaction[] {
  return transactions.map((t) => {
    const resolvedSpendExpenseId = resolveSpendExpenseIdForDescription(mappings, t.description)
    if (resolvedSpendExpenseId === null) return t
    const definition = budgetExpenseDefinitions.find((d) => d.id === resolvedSpendExpenseId)
    if (!definition) return t
    return { ...t, categoryId: definition.categoryId, spendExpenseId: resolvedSpendExpenseId }
  })
}

export type CategoryAction =
  | { type: 'ADD_CATEGORY'; id: string; name: string }
  | { type: 'RENAME_CATEGORY'; id: string; name: string }
  | { type: 'SET_CATEGORY_EXCLUDE_FROM_SPEND'; id: string; exclude: boolean }
  | { type: 'DELETE_CATEGORY'; id: string }
  | { type: 'UPSERT_CATEGORY_MAPPING'; description: string; spendExpenseId: string }
  | { type: 'UPDATE_CATEGORY_MAPPING'; id: string; patch: Partial<Pick<CategoryMapping, 'substring' | 'spendExpenseId'>> }
  | { type: 'ADD_CATEGORY_MAPPING'; spendExpenseId: string; substring: string }
  | { type: 'DELETE_CATEGORY_MAPPING'; id: string }
  | { type: 'DELETE_CATEGORY_MAPPINGS_FOR_EXPENSE'; spendExpenseId: string }
  | { type: 'CONFIGURE_BUDGET_ACCOUNT_RULE'; name: string; convention: StatementConvention }
  | { type: 'DELETE_BUDGET_ACCOUNT_RULE'; normalizedName: string }
  | { type: '__REPLACE'; state: GlobalCategoryState }
  | { type: '__MERGE_IMPORTED'; imported: GlobalCategoryState }

/** Hard-delete all category mappings for a spend expense (filter, no tombstone). No-op if none match. */
export function deleteCategoryMappingsForExpense(s: GlobalCategoryState, spendExpenseId: string): GlobalCategoryState {
  if (!s.categoryMappings.some((m) => m.spendExpenseId === spendExpenseId)) return s
  return { ...s, categoryMappings: s.categoryMappings.filter((m) => m.spendExpenseId !== spendExpenseId) }
}

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
    case 'SET_CATEGORY_EXCLUDE_FROM_SPEND':
      return setCategoryExcludeFromSpend(s, a.id, a.exclude)
    case 'DELETE_CATEGORY':
      return deleteCategory(s, a.id)
    case 'UPSERT_CATEGORY_MAPPING':
      return upsertCategoryMapping(s, a.description, a.spendExpenseId)
    case 'UPDATE_CATEGORY_MAPPING':
      return updateCategoryMapping(s, a.id, a.patch)
    case 'ADD_CATEGORY_MAPPING':
      return addCategoryMapping(s, a.spendExpenseId, a.substring)
    case 'DELETE_CATEGORY_MAPPING':
      return deleteCategoryMapping(s, a.id)
    case 'DELETE_CATEGORY_MAPPINGS_FOR_EXPENSE':
      return deleteCategoryMappingsForExpense(s, a.spendExpenseId)
    case 'CONFIGURE_BUDGET_ACCOUNT_RULE':
      return configureBudgetAccountRule(s, a.name, a.convention)
    case 'DELETE_BUDGET_ACCOUNT_RULE':
      return deleteBudgetAccountRule(s, a.normalizedName)
    default:
      return s
  }
}
