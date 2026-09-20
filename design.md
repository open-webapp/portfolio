# Design - Ledger

See also: [product-behavior.md](product-behavior.md), [schema-spec.md](schema-spec.md).

## Stack

- React 19 + TypeScript + Vite; Vitest, oxlint, IndexedDB, Google Drive sync.
- Per-portfolio application state uses `useReducer(appReducer, initialState())` in `src/App.tsx`.
- Persistent fields are encrypted per portfolio; UI state is component-local or in `AppState` where explicitly required.

## Budget

- `BudgetPage` has four non-persisted local tabs: `expenses`, `spend`, `analytics`, `categoryMapping`; default: `spend`.
- `BudgetAccountsTab` mounts from Settings' Spend Accounts tab. It receives current-portfolio transactions and visible global `budgetAccountRules`. It confirms configure/remove actions and then dispatches `RECONCILE_BUDGET_ACCOUNT_CONVENTIONS` for the active portfolio.
- Budget imports require an existing canonical account or a new account name. `convertBudgetAccountImportRows` canonicalizes the selected account name and converts a `positiveSpend` statement to canonical negative spend before `IMPORT_BUDGET_TRANSACTIONS` deduplication.
- `negativeSpend` is the permanent default when no rule exists. Import persists an applied-convention marker even if all rows are duplicates.
- CSV/OFX/QFX parsers are unchanged; they return raw parsed rows only.
- `categoryBreakdown()` returns additive, non-breaking drilldown fields for existing callers: `categoryId`, `drillLines`, and `unlinkedActual`.

## Global Categories

```ts
interface GlobalCategoryState {
  categories: Category[]
  categoryMappings: CategoryMapping[]
  budgetAccountRules: BudgetAccountRule[]
}
```

- `GlobalCategoryState` is cross-portfolio and is not part of `AppState`.
- `categoryStoreReducer` owns category/mapping CRUD plus `CONFIGURE_BUDGET_ACCOUNT_RULE` and `DELETE_BUDGET_ACCOUNT_RULE`. Rule identity is `normalizedName`; deletion tombstones the record.
- `mergeCategoryState(a, b)` merges categories/mappings by `id` and rules by `normalizedName`; larger `deletedAt ?? updatedAt` wins, ties retain `a`.
- `categoryPersist.ts` stores one global IndexedDB document; `categoryDrive.ts` reads/writes unencrypted shared Drive `OpenWebApp/Portfolio/category-mappings.json`.
- `useGlobalCategories(driveAuth, driveConnected, driveProjectId, budgetExpenseDefinitions?)` hydrates once, returns visible `{ categories, categoryMappings, budgetAccountRules, dispatch, hydrated, seedGlobalCategoriesIfNeeded, syncNow }`, debounce-saves locally (500ms), merges Drive initial/manual/polled pulls, immediately pushes connected local edits, and polls every 60 seconds.
- `App.tsx` prop-drills global categories, mappings, rules, hydration state, and `categoryDispatch` into `BudgetPage`; no context.

## Account Sign Reconciliation

- Per-portfolio `AppState.budgetAccountAppliedConventions: Record<string, StatementConvention>` records the convention applied to each normalized imported account.
- `IMPORT_BUDGET_TRANSACTIONS` receives `appliedConvention: { accountName, statementConvention }` and updates the marker even for a duplicate-only import.
- `reconcileBudgetAccountConventions(state, rules)` delegates to `reconcileBudgetAccountRules`: it compares markers with the current rule/default, flips matching amounts once when conventions differ, canonicalizes a rule-backed account name, and updates markers.
- `App.tsx` reconciles before rendering a hydrated/opened portfolio and after global-rule changes. A confirmed Settings > Spend Accounts tab rule action reconciles the active portfolio immediately.

## Persistence and Drive

- Portfolio encrypted state and its Drive `portfolio-state.json` remain per portfolio.
- Global category state, including account rules, is separate from portfolio backups and uses its global IndexedDB document and shared Drive JSON file.
