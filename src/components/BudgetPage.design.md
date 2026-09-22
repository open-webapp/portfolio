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
  budgetAccountRules?: BudgetAccountRule[]
  period: 'expenses' | 'spend' | 'analytics'
  setPeriod: (period: 'expenses' | 'spend' | 'analytics') => void
  selectedScope: SpendScope
  setSelectedScope: Dispatch<SetStateAction<SpendScope>>
}
```

## Structure

- `period`/`setPeriod` and `selectedScope`/`setSelectedScope` are App-owned props. `PeriodSegControl` is in App's Budget top bar, not BudgetPage; its three tabs are Expenses, Spend, and Analytics. Period and scope survive cross-view navigation during the app session, but are not persisted.
- The shell control keeps tabs and the Spend All/year selector on a single row (tabs centered and horizontally scrollable where needed; selector right-aligned, Spend-only, no visible label, empty cell on other tabs so tabs never shift). BudgetPage consumes the controlled scope for Spend calculations and requests `ENSURE_BUDGET_YEAR_SNAPSHOT` through App's scope handler when a concrete year lacks a snapshot.
- Local `showRecurringOnly` controls the Spend records recurring-only filter; initialized `false`, never persisted.
- `computeRecurringSpendIds` from `selectors.ts` runs each render against full `state.budgetTransactions`, not `periodFilteredTransactions`; its result drives the recurring-only filter and row icon.
- Expenses -> `BudgetExpensesTab`.
- Spend -> controlled All/year scope; three summary cards; `BudgetSankey`; records, import, and category selection.
- Summary cards: Spend vs budget (scoped actual/budget percentage and amounts); Projected spend (current-date projection and over/under budget status); Savings rate (selected-year rate, with inline aggregate annual income-budget editing). There is intentionally no fourth summary card.
- `sankeyFlowData(definitions, amountsByYear, transactions, categories, selectedScope)` supplies category-aggregated budget/actual nodes and links to `BudgetSankey`; unused budget flows to `Unspent`. The chart renders between summary cards and Spend records.
- `CategoryMappingsDialog` is shared with `PortfolioPicker`; it owns inline-edit state, Escape handling, and delete confirmation. Budget keys the dialog by transaction row ID and passes only live mappings from that row's linked, live expense definition. Its update/delete callbacks dispatch the category-store action plus `REAPPLY_CATEGORY_MAPPINGS` with `updateCategoryMapping`/`deleteCategoryMapping` output, affecting this `state.budgetTransactions` only. The dialog has no add control and stays open when empty.
- Analytics -> `BudgetAnalytics`.
- Import requires an existing canonical account selection or a new account name. `convertBudgetAccountImportRows` canonicalizes the name and converts `positiveSpend` imports to canonical negative spend before `IMPORT_BUDGET_TRANSACTIONS`; its `appliedConvention` marker persists even for a duplicate-only batch. Parsers remain unchanged.
