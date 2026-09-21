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
  period: 'expenses' | 'spend' | 'analytics' | 'categoryMapping'
  setPeriod: (period: 'expenses' | 'spend' | 'analytics' | 'categoryMapping') => void
}
```

## Structure

- `period` and `setPeriod` are App-owned props. The selector is `App`'s top-bar `PeriodSegControl`, not inline in BudgetPage; selection survives BudgetPage unmounts caused by cross-view navigation during the app session, but is not persisted.
- Local `showRecurringOnly` controls the Spend records recurring-only filter; initialized `false`, never persisted.
- `computeRecurringSpendIds` from `selectors.ts` runs each render against full `state.budgetTransactions`, not `periodFilteredTransactions`; its result drives the recurring-only filter and row icon.
- Expenses -> `BudgetExpensesTab`.
- Spend -> local year/All scope selector; three summary cards; `BudgetSankey`; records, import, and category selection.
- Summary cards: Spend vs budget (scoped actual/budget percentage and amounts); Projected spend (current-date projection and over/under budget status); Savings rate (selected-year rate, with inline aggregate annual income-budget editing). There is intentionally no fourth summary card.
- `sankeyFlowData(definitions, amountsByYear, transactions, categories, selectedScope)` supplies category-aggregated budget/actual nodes and links to `BudgetSankey`; unused budget flows to `Unspent`. The chart renders between summary cards and Spend records.
- Spend mapping overlay is keyed by transaction row ID; it derives only live mappings from that row's linked, live expense definition. Inline substring editing tracks the mapping ID and draft locally; updates/deletes dispatch the category-store action plus `REAPPLY_CATEGORY_MAPPINGS` with `updateCategoryMapping`/`deleteCategoryMapping` output, affecting this `state.budgetTransactions` only. The overlay has no add control and stays open when empty.
- Analytics -> `BudgetAnalytics`.
- Category Mapping -> `CategoryMappingTab`, supplied all category-store props plus `state`/`dispatch`.
- Import requires an existing canonical account selection or a new account name. `convertBudgetAccountImportRows` canonicalizes the name and converts `positiveSpend` imports to canonical negative spend before `IMPORT_BUDGET_TRANSACTIONS`; its `appliedConvention` marker persists even for a duplicate-only batch. Parsers remain unchanged.
- `CategoryMappingTab` gates its UI on `categoriesHydrated`; BudgetPage does not defer the other tabs.
