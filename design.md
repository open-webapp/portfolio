# Design - Ledger

See also: [product-behavior.md](product-behavior.md), [schema-spec.md](schema-spec.md).

## Stack

- React 19 + TypeScript + Vite; Vitest, oxlint, IndexedDB, Google Drive sync.
- Per-portfolio application state uses `useReducer(appReducer, initialState())` in `src/App.tsx`.
- Persistent fields are encrypted per portfolio; UI state is component-local or in `AppState` where explicitly required.

## Budget

- `App.tsx` owns the non-persisted Budget period (`expenses`, `spend`, `analytics`; default: `spend`) and renders its control in `TopBar`; `BudgetPage` receives it as props.
- `BudgetAccountsTab` mounts from Settings' Spend Accounts tab. It receives current-portfolio transactions and visible global `budgetAccountRules`. It confirms configure/remove actions and then dispatches `RECONCILE_BUDGET_ACCOUNT_CONVENTIONS` for the active portfolio.
- Budget imports require an existing canonical account or a new account name. `convertBudgetAccountImportRows` canonicalizes the selected account name and converts a `positiveSpend` statement to canonical negative spend before `IMPORT_BUDGET_TRANSACTIONS` deduplication.
- `negativeSpend` is the permanent default when no rule exists. Import persists an applied-convention marker even if all rows are duplicates.
- CSV/OFX/QFX parsers are unchanged; they return raw parsed rows only.
- `categoryBreakdown()` returns additive, non-breaking drilldown fields for existing callers: `categoryId`, `drillLines`, and `unlinkedActual`.

## Shell Navigation

- `App.tsx` renders `RailNav` and `TopBar` for every hydrated, unlocked portfolio view.
- `RailNav` is a fixed left icon rail: Ledger mark; Budget, Positions, Register, Quotes; flexible spacer; Settings. Main buttons dispatch `SET_VIEW`, expose `aria-pressed`, labels, and tooltips. At widths <=480px it becomes a fixed bottom bar and hides the mark/spacer.
- `TopBar` is a flex row containing the accent-colored portfolio-switch button, optional Budget period control, and right-aligned accent Sync button. Sync is disabled while disconnected or syncing.

## Global Categories

```ts
interface GlobalCategoryState {
  categories: Category[]
  budgetAccountRules: BudgetAccountRule[]
}
```

- `GlobalCategoryState` is cross-portfolio and is not part of `AppState`; spend-expense links (`BudgetTransaction.spendExpenseId`) are autoTag-derived per portfolio (see propagation below), never stored as mappings.
- `categoryStoreReducer` owns category CRUD plus `CONFIGURE_BUDGET_ACCOUNT_RULE` and `DELETE_BUDGET_ACCOUNT_RULE`. Rule identity is `normalizedName`; deletion tombstones the record.
- Spend-link propagation (`propagateSpendLinksByAutoTag`, `src/lib/state.ts`): groups `budgetTransactions` by `autoTags` entry; per tag (sorted order) the most-common `spendExpenseId` among carriers wins (ties → first in input order) and ALL carriers take the winner + its definition's `categoryId`; tags with no linked carrier and dangling winners (no matching definition) are skipped; multi-tag carriers resolve in sorted tag order (last valid winner wins).
- Triggers: import tag-lookup (`resolveBudgetImportRows` — each batch row resolves from existing + earlier-batch carriers); full propagation in `autoTagBudgetTransactions` (auto-tag rerun); immediate overwrite-all-siblings cascade in `addBudgetTransaction` / `updateBudgetTransaction` / `updateBudgetTransactionsBulk`.
- `mergeCategoryState(a, b)` merges categories by `id` and rules by `normalizedName`; larger `deletedAt ?? updatedAt` wins, ties retain `a`.
- `categoryPersist.ts` stores one global IndexedDB document; its `DriveSyncMeta` has optional `lastKnownRemoteModifiedTime` and `sharedFileId` fields.
- `categoryDrive.ts` reads/writes unencrypted shared Drive `OpenWebApp/Portfolio/category-mappings.json`. `pullGlobalCategoriesFromDrive`, `pushGlobalCategoriesToDrive`, and `getGlobalCategoriesModifiedTime` each accept optional `fileId?: string`; when supplied, they read/write/status that file instead of resolving it by name in the shared root.
- `useGlobalCategories(driveAuth, driveConnected, driveProjectId)` hydrates once, returns visible `{ categories, budgetAccountRules, dispatch, hydrated, syncNow }`, debounce-saves locally (500ms), merges Drive initial/manual/polled pulls, immediately pushes connected local edits, and polls every 60 seconds.
- `PortfolioPicker` uses a centered 520px landing layout with a full-width `Open` (default) / `Create` / `Google Drive` segment. Only the selected top-level panel mounts. The Drive card renders sequential My-portfolios and Shared-portfolio sections separated by `.hr`. Local file import remains inside Create; switching modes preserves component-local state.
- `ManageCategoriesPage` is rendered at `#/categories` for global category management. `router.ts` adds the `categories` `Route` variant and `navigateToCategories()` helper.
- `App.tsx` prop-drills global categories, rules, hydration state, and `categoryDispatch` into `BudgetPage`; no context.

## Account Sign Reconciliation

- Per-portfolio `AppState.budgetAccountAppliedConventions: Record<string, StatementConvention>` records the convention applied to each normalized imported account.
- `IMPORT_BUDGET_TRANSACTIONS` receives `appliedConvention: { accountName, statementConvention }` and updates the marker even for a duplicate-only import.
- `reconcileBudgetAccountConventions(state, rules)` delegates to `reconcileBudgetAccountRules`: it compares markers with the current rule/default, flips matching amounts once when conventions differ, canonicalizes a rule-backed account name, and updates markers.
- `App.tsx` reconciles before rendering a hydrated/opened portfolio and after global-rule changes. A confirmed Settings > Spend Accounts tab rule action reconciles the active portfolio immediately.

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
