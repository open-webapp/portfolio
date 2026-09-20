# BudgetPage Design

Sibling: `BudgetPage.product-behavior.md`.

## API

```ts
BudgetPageProps = {
  state: AppState
  dispatch: (action: any) => void
  categories: Category[]
  categoryMappings: CategoryMapping[]
  categoryDispatch: (action: CategoryAction) => void
  categoriesHydrated: boolean
  budgetAccountRules?: BudgetAccountRule[]
}
```

## Structure

- Local `period: 'expenses' | 'spend' | 'analytics' | 'categoryMapping' | 'accounts'`; initialized as `'spend'`, never persisted.
- Local `showRecurringOnly` controls the Spend records recurring-only filter; initialized `false`, never persisted.
- `computeRecurringSpendIds` from `selectors.ts` runs each render against full `state.budgetTransactions`, not `periodFilteredTransactions`; its result drives the recurring-only filter and row icon.
- Expenses -> `BudgetExpensesTab`.
- Spend -> records, import, and category selection.
- Spend mapping overlay is keyed by transaction row ID; it derives only live mappings from that row's linked, live expense definition. Inline substring editing tracks the mapping ID and draft locally; updates/deletes dispatch the category-store action plus `REAPPLY_CATEGORY_MAPPINGS` with `updateCategoryMapping`/`deleteCategoryMapping` output, affecting this `state.budgetTransactions` only. The overlay has no add control and stays open when empty.
- Analytics -> `BudgetAnalytics`.
- Category Mapping -> `CategoryMappingTab`, supplied all category-store props plus `state`/`dispatch`.
- Accounts -> `BudgetAccountsTab`, supplied local transactions and visible global `budgetAccountRules`. Confirmed configure/remove actions dispatch `CategoryAction` (`CONFIGURE_BUDGET_ACCOUNT_RULE`/`DELETE_BUDGET_ACCOUNT_RULE`) and immediately invoke the local `RECONCILE_BUDGET_ACCOUNT_CONVENTIONS` callback.
- Import requires an existing canonical account selection or a new account name. `convertBudgetAccountImportRows` canonicalizes the name and converts `positiveSpend` imports to canonical negative spend before `IMPORT_BUDGET_TRANSACTIONS`; its `appliedConvention` marker persists even for a duplicate-only batch. Parsers remain unchanged.
- `CategoryMappingTab` gates its UI on `categoriesHydrated`; BudgetPage does not defer the other tabs.
