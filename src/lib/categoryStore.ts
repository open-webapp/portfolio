import type { BudgetAccountRule, Category, StatementConvention } from './types'
import { mergeCategoryState } from './categoryMerge'
import { normalizeBudgetAccountName } from './budgetAccountRules'

export interface GlobalCategoryState {
  categories: Category[]
  budgetAccountRules: BudgetAccountRule[]
}

/** Fresh, empty global category state. */
export function initialGlobalCategoryState(): GlobalCategoryState {
  return { categories: [], budgetAccountRules: [] }
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

/** Non-tombstoned categories, in original order. */
export function visibleCategories(s: GlobalCategoryState): Category[] {
  return s.categories.filter((c) => !c.deletedAt)
}

/** Non-tombstoned budget-account rules, in original order. */
export function visibleBudgetAccountRules(s: GlobalCategoryState): BudgetAccountRule[] {
  return s.budgetAccountRules.filter((rule) => !rule.deletedAt)
}

export type CategoryAction =
  | { type: 'ADD_CATEGORY'; id: string; name: string }
  | { type: 'RENAME_CATEGORY'; id: string; name: string }
  | { type: 'SET_CATEGORY_EXCLUDE_FROM_SPEND'; id: string; exclude: boolean }
  | { type: 'DELETE_CATEGORY'; id: string }
  | { type: 'CONFIGURE_BUDGET_ACCOUNT_RULE'; name: string; convention: StatementConvention }
  | { type: 'DELETE_BUDGET_ACCOUNT_RULE'; normalizedName: string }
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
    case 'SET_CATEGORY_EXCLUDE_FROM_SPEND':
      return setCategoryExcludeFromSpend(s, a.id, a.exclude)
    case 'DELETE_CATEGORY':
      return deleteCategory(s, a.id)
    case 'CONFIGURE_BUDGET_ACCOUNT_RULE':
      return configureBudgetAccountRule(s, a.name, a.convention)
    case 'DELETE_BUDGET_ACCOUNT_RULE':
      return deleteBudgetAccountRule(s, a.normalizedName)
    default:
      return s
  }
}
