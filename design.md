# Design - Ledger

See also: [product-behavior.md](product-behavior.md), [schema-spec.md](schema-spec.md).

## Stack

- React 19 + TypeScript + Vite; Vitest, oxlint, IndexedDB, Google Drive sync.
- Per-portfolio application state uses `useReducer(appReducer, initialState())` in `src/App.tsx`.
- Persistent fields are encrypted per portfolio; UI state is component-local or in `AppState` where explicitly required.

## Budget

- `BudgetPage` has five non-persisted local tabs: `expenses`, `spend`, `analytics`, `categoryMapping`, `accounts`; default: `spend`.
- `BudgetAccountsTab` receives current-portfolio transactions and visible global `budgetAccountRules`. It confirms configure/remove actions and then dispatches `RECONCILE_BUDGET_ACCOUNT_CONVENTIONS` for the active portfolio.
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
- `categoryPersist.ts` stores one global IndexedDB document; its `DriveSyncMeta` has optional `lastKnownRemoteModifiedTime` and `sharedFileId` fields.
- `categoryDrive.ts` reads/writes unencrypted shared Drive `OpenWebApp/Portfolio/category-mappings.json`. `pullGlobalCategoriesFromDrive`, `pushGlobalCategoriesToDrive`, and `getGlobalCategoriesModifiedTime` each accept optional `fileId?: string`; when supplied, they read/write/status that file instead of resolving it by name in the shared root.
- `useGlobalCategories(driveAuth, driveConnected, driveProjectId, budgetExpenseDefinitions?)` hydrates once, returns visible `{ categories, categoryMappings, budgetAccountRules, dispatch, hydrated, seedGlobalCategoriesIfNeeded, syncNow }`, debounce-saves locally (500ms), merges Drive initial/manual/polled pulls, immediately pushes connected local edits, and polls every 60 seconds.
- `PortfolioPicker` has a separate one-shot global-mapping path: it loads/saves the global category document locally, can merge a picker-selected shared Drive mapping, and stores/unlinks its `sharedFileId`. It is distinct from the `useGlobalCategories` lifecycle and starts no interval.
- `App.tsx` prop-drills global categories, mappings, rules, hydration state, and `categoryDispatch` into `BudgetPage`; no context.

## Account Sign Reconciliation

- Per-portfolio `AppState.budgetAccountAppliedConventions: Record<string, StatementConvention>` records the convention applied to each normalized imported account.
- `IMPORT_BUDGET_TRANSACTIONS` receives `appliedConvention: { accountName, statementConvention }` and updates the marker even for a duplicate-only import.
- `reconcileBudgetAccountConventions(state, rules)` delegates to `reconcileBudgetAccountRules`: it compares markers with the current rule/default, flips matching amounts once when conventions differ, canonicalizes a rule-backed account name, and updates markers.
- `App.tsx` reconciles before rendering a hydrated/opened portfolio and after global-rule changes. A confirmed Accounts-tab rule action reconciles the active portfolio immediately.

## Persistence and Drive

```ts
interface Portfolio {
  id: string
  name: string
  dbName: string
  createdAt: number
  sharedDriveFolderId?: string
}
```
- Portfolio encrypted state and its Drive `portfolio-state.json` remain per portfolio unless `sharedDriveFolderId` is set.
- `resolvePortfolioFolderId(portfolio, project)` returns `portfolio.sharedDriveFolderId` when present; otherwise it resolves the private `OpenWebApp/Portfolio/<portfolio.name>` folder. `syncBackup`, `getBackupFileId`, and `getPortfolioDriveFolderUrl` use this resolver. `getBackupFileStatus` checks its supplied backup file ID directly, including IDs found in a shared folder.
- Global category state, including account rules, is separate from portfolio backups and uses its global IndexedDB document and shared Drive JSON file.
