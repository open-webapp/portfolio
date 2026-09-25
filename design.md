# Design - Ledger

See also: [product-behavior.md](product-behavior.md), [schema-spec.md](schema-spec.md).

## Stack

- React 19 + TypeScript + Vite; Vitest, oxlint, IndexedDB, Google Drive sync.
- Per-portfolio application state uses `useReducer(appReducer, initialState())` in `src/App.tsx`.
- Persistent fields are encrypted per portfolio; UI state is component-local or in `AppState` where explicitly required.

## Budget

- `App.tsx` owns the non-persisted Budget period (`expenses`, `spend`, `analytics`; default: `spend`) and renders its control in `TopBar`; `BudgetPage` receives it as props. Top-bar control is three tabs (Expenses/Spend/Analytics).
- `App.tsx` also owns non-persisted Spend `selectedScope` (init: newest transaction year, else `SPEND_ALL_YEARS` sentinel), passed to `BudgetPage`; Spend's All/year selector renders as a second row under the period tabs.
- `BudgetAccountsTab` mounts from Settings' Spend Accounts tab. It receives current-portfolio transactions and visible global `budgetAccountRules`. It confirms configure/remove actions and then dispatches `RECONCILE_BUDGET_ACCOUNT_CONVENTIONS` for the active portfolio.
- Budget imports require an existing canonical account or a new account name. `convertBudgetAccountImportRows` canonicalizes the selected account name and converts a `positiveSpend` statement to canonical negative spend before `IMPORT_BUDGET_TRANSACTIONS` deduplication.
- `negativeSpend` is the permanent default when no rule exists. Import persists an applied-convention marker even if all rows are duplicates.
- CSV/OFX/QFX parsers are unchanged; they return raw parsed rows only.
- `categoryBreakdown()` returns additive, non-breaking drilldown fields for existing callers: `categoryId`, `drillLines`, and `unlinkedActual`.
- Income derivation: an active `Category` with an exact `Income` match resolves through `selectors.ts` into `BudgetPage` summary cards and savings-rate, gated by `effectiveCategoryId`/`excludedCategoryIdSet`. Spend selectors negate debit amounts for display. Legacy manual-income keys are dropped on hydration/import.
- Spend-scope selectors: `spendBudgetYears`, `SPEND_ALL_YEARS` sentinel, `spendTransactionsForScope`; `spendCardTotals` aggregates per exact-year snapshot (no nearest-year fallback). `ENSURE_BUDGET_YEAR_SNAPSHOT` dispatch creates a year's snapshot on demand. `availableBudgetYears` definition is unaffected by scope work.
- `BudgetSankey`/`sankeyFlowData` layout constants: 32px node gap, 460px min height, 720px scroll viewport.
- Sankey responsive width: `sankeyFlowData(definitions, amountsByYear, transactions, categories, scope, width = 1200)` — `incomeX`/`budgetX`/`actualX` column positions scale proportionally to `width`; `nodeWidth` (18), `top` (40), `gap` (32) stay fixed; vertical `scale` is unaffected by width. `BudgetSankey.tsx` owns the `sankeyFlowData` call (moved from `BudgetPage.tsx`); its props are raw `{definitions, amountsByYear, transactions, categories, scope}`, not precomputed `nodes/links`. Width source: `ResizeObserver` on its wrapper div, ~120ms debounced, seeded at 1200 before first measurement, clamped to `[640, 1600]`; below 640px measured width it renders at the 640px floor with horizontal scroll (existing `overflow: auto` wrapper).
- Auto-tag vs user tag (`src/lib/autoTag.ts`): parallel-array model on `BudgetTransaction` — `tags` (user-only) and `autoTags` (system-only), both omitted when empty. `unionTags` dedupes/caps/merges the two; `applyAutoTags` recomputes `autoTags` from current rules. Two triggers with different candidate pools: manual "Auto-tag" action vs. CSV/OFX import. Clearing is split (`CLEAR_BUDGET_TRANSACTION_TAGS` user-only vs `CLEAR_BUDGET_TRANSACTION_AUTO_TAGS` auto-only). Chip render order: gray auto chips first, then red user chips, with cross-list dedup suppression; `TagInput` supports `blockedTags`. Header exposes Auto-tag/Clear-all-tags actions and a tag-chooser dialog.
- `propagateSpendLinksByAutoTag` (see Global Categories) also runs on manual add/update/bulk-update of budget transactions, not just import/auto-tag-rerun.
- **Expense Summary** and **Action items** cards render in `BudgetPage.tsx`'s Spend branch (5-card `summary-cards` grid, all `.card-compact`), not in `BudgetExpensesTab.tsx`. Both are keyed off `selectedScope` (year or `SPEND_ALL_YEARS`), via `src/lib/selectors.ts`:
  - `expenseSummaryForScope(amountsByYear: Record<string, Record<string, number>>, transactions: BudgetTransaction[], scope: SpendScope): { totalSpend: number; totalBudget: number; averageTransaction: number; largestTransaction: (BudgetTransaction & { magnitude: number }) | null; topCategory: [string, number] | null }`
  - `overBudgetCategoriesForScope(definitions: ExpenseDefinition[], amountsByYear: Record<string, Record<string, number>>, transactions: BudgetTransaction[], categories: Category[], scope: SpendScope): Array<{ categoryId: string; label: string; overageAmount: number; pctOver: number }>`
  - `BudgetExpensesTab.tsx` retains only `Category Breakdown` + the `Expenses` table, still scoped by its own `breakdownYear`.

## Budget Expense CSV Export

- `expenseExport.ts`: `buildExpenseCsv` builds an RFC4180-escaped CSV of expense rows, prefixing a leading apostrophe on values that would otherwise be read as a spreadsheet formula.
- `BudgetExpensesTab.tsx` wires build + browser download; filename pattern `expenses-YYYY-MM-DD.csv`.

## Shell Navigation

- `App.tsx` renders `RailNav` and `TopBar` for every hydrated, unlocked portfolio view.
- `RailNav` is a fixed left icon rail: Ledger mark; Budget, Positions, Register (3 main items — Quotes is not a rail item, see Positions); flexible spacer; Sync (when connected/syncing); Settings. Main buttons dispatch `SET_VIEW`, expose `aria-pressed`, labels, and tooltips. At widths <=480px it becomes a fixed bottom bar and hides the mark/spacer.
- `TopBar` is a flex row containing the accent-colored portfolio-switch button, optional Budget period control, and right-aligned accent Sync button. Sync is disabled while disconnected or syncing.
- `router.ts` recognizes `#/categories` and renders `ManageCategoriesPage` without requiring an unlocked portfolio session.

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

## Settings

- `Settings.tsx` tabs: Backup, Encryption, Quotes API Key, Spend Accounts — no categories/mappings props (moved to global category store).
- Quotes API Key tab has two sub-blocks in one card, separated by a border: Polygon (Equity/ETF) and Alphavantage (Mutual Fund).
  - Polygon: masked key input (commits on blur, `SET_PRICE_SYNC_API_KEY`), "Fetch prices now" button + date input (disabled while fetching), last-run status (`state.priceSync.lastRun`), `tickerOverviewErrors` list (`{symbol}: {message}`). Shares orchestration with `App.tsx`'s on-load/on-focus effect via a lifted `runPriceSyncTrigger` callback prop; the button wraps it with local `fetchingPrices` state and an optional override date.
  - Alphavantage: masked key input (`SET_MUTUAL_FUND_SYNC_API_KEY`), "Fetch mutual fund prices now" button (no date input), last-run status (`state.mutualFundSync.lastRun`), independent `mutualFundSyncErrors` map (never merged with Polygon's). Mirrors the Polygon wiring via `runMutualFundSyncTrigger` prop + local `fetchingMutualFunds` state.

## Quotes Page

- `QuotesPage.tsx`: rendered as the 5th tab (`'quotes'`) inside `AccountsPage`, full width, no left nav — not a standalone rail-navigable view. Props: `{state, dispatch, tickerOverviewErrors}`.
- Rows = union of held Equity/ETF and Mutual Fund symbols, sorted/merged by symbol. Asset Class: Equity/ETF looks up `assetClassManualOverride || assetClass`; Mutual Fund rows are hardcoded `'Mutual Fund'`.
- Loads `marketDataDb.getAllBars()` + `getAllTickerOverviews()` in a `useEffect` keyed on `priceSync.lastRun?.at` / `mutualFundSync.lastRun?.at`.
- Columns: Ticker, Asset Class, Name (cached `TickerOverview.name`, `—` if uncached), Status, Price (`fmtUSD`; Equity/ETF falls back to cached bar close, Mutual Fund reads `mutualFundSync.heldPrices` only, no bar fallback), Held (always Yes), Last Updated (UTC from `DailyBar.t`), SIC Description (`overview?.sicDescription || '—'`, `||` not `??` so empty string also shows `—`).
- Status: Equity/ETF = OK / Not found (`priceSync.heldPrices`/`lastRun.notFound`); Mutual Fund = Not found (`mutualFundSync.lastRun.notFound`), else OK (priced today) or Pending.
- Live search filters ticker/name/status/SIC/asset-class. Empty state: "No holdings to show." Failure banner when `tickerOverviewErrors` non-empty: "Could not fetch name for: X, Y".

## Price Sync

- Trigger chain: `App.tsx` `runPriceSyncTrigger` → `priceSync.ts` `runPriceSync` → `fetchGroupedDailyBars` → `marketDataDb.putBars` + `RECORD_PRICE_SYNC_RUN` → `UPDATE_POSITION` → `tickerOverview.ts` `syncTickerOverviews`.
- Uses Polygon's Ticker Overview endpoint; `TickerOverviewNotFoundError` caches `notFound: true`. Paced by `REQUEST_SPACING_MS` (12.5s). `TickerOverviewRateLimitError` retries in a loop until success, backed off by `RATE_LIMIT_BACKOFF_MS` (60s). `tickerSyncInFlightRef` guards concurrent runs.
- Edge cases: no API key set, manual date override, empty/malformed response, 403-today-special-case vs 403-other-date, CSV-import price precedence over synced price.

## Mutual Fund Price Sync

- Trigger chain: `runMutualFundSyncTrigger` → `mutualFundSync.ts` `runMutualFundSync`, using Alphavantage `SYMBOL_SEARCH`/`TIME_SERIES_DAILY`. Reuses the `ticker_overviews` store for name caching (shared with Polygon).
- `ALPHAVANTAGE_DAILY_CALL_CAP` = 25/day; `callBudget: {date, callsUsed}` tracked and pre-incremented before each call.
- Per-symbol error handling includes `AlphavantageRateLimitError`, which does NOT retry-loop (unlike Polygon). Paced by `ALPHAVANTAGE_REQUEST_SPACING_MS` (12.5s).
- Both syncs share a 60s retry interval (`SYNC_RETRY_POLL_INTERVAL_MS`) driving `shouldRetryPolygonSync`/`shouldRetryMutualFundSync`. `mutualFundSyncInFlightRef` guards concurrency. Never writes `Position.price`.

## Positions

- `AccountsPage.tsx` renders a 5-tab top strip: Taxable, Non-Taxable, Tax-Deferred, Closed Positions, Quotes. Active tab is `PositionsTab` (`src/lib/state.ts`), held as local `useState` in `App.tsx` — not persisted, not part of `AppState`/reducer. Switching tabs dispatches `CLEAR_ACCOUNT_SELECTION`.
- No "All Accounts" pill; category collapse/expand (chevrons, `expandedCategories`, `TOGGLE_CATEGORY_EXPANDED`) is removed — category blocks are always static/expanded.
- Left nav per tab:
  - Taxable/Non-Taxable/Tax-Deferred: exactly one category block — accounts in that tax category, per-account totals, category sum.
  - Closed Positions: accounts with closed positions + realized G/L totals.
  - Quotes: none; right panel is `QuotesPage` full width.
- Right panel per tab:
  - Taxable/Non-Taxable/Tax-Deferred: allocation chart, filter row, aggregate table, scoped to the active tab's accounts even with no account selected (selectors take `tabAccountIds?: string[]`: `acctScopedPositions`, `acctFilteredPositions`, `acctScopedClosedPositions`, `acctFilteredClosedPositions`; `acctAllocationTitle` takes optional `tabLabel?: string`).
  - Closed Positions: always renders `ClosedPositionsTable` (`acctFilteredClosedPositions(state)`), not conditional on selection.
  - Quotes: `QuotesPage`.
- `ClosedPositionsTable.tsx` takes a `positions` prop; reused by `PositionsTable.tsx` (`state.closedPositions`) and `AccountsPage.tsx`.
- Undo Closed Position flow: table Undo click → `findMatchingOpenPosition`/`isExactLotMatch` → confirm dialog only if an exact-lot match exists → `RESTORE_CLOSED_POSITION` dispatch → `restoreClosedPosition` (three outcome branches: no match/partial match/exact match); account selection is cleared via `CLEAR_ACCOUNT_SELECTION`/`clearAccountSelection` as part of the restore.
- Account Selection flow: `SELECT_ACCOUNT` → `selectAccount`, with toggle (reselect clears)/replace/null semantics for single-account filtering.
- `acctAllAccountsTotal` deleted (dead code after pill removal).

## Balance Register

- `register.ts` pure functions: `ACTIVITY_TYPES`, `ACTIVITY_SIGN`, `BALANCE_FIELD_HINTS`, `accountLedger`, `latestBalance`, `scopeLedger`, `registerChartSeries`, `matchAccountId`, `matchActivityType`, `normalizeDateInput`, `emptyDraftRow`, `isDraftRowValid`, `DraftActivity` type.
- `selectors.ts`/`RegisterPage.tsx` consume these for ledger rows and chart series. `updateBalanceEntry` upserts by id, dropping on id collision.

## Import/Export

- `importExport.ts`: `ExportableState` type (field list + exclusions), `buildExportableState`, `exportBackup`, `downloadEnvelopeAsFile`, `downloadCsvAsFile`.
- `UnencryptedPortfolioExport`/`buildUnencryptedPortfolioExport` (blanks API keys), `buildUnencryptedCategoriesExport`, `localDateStamp`, `downloadPrettyJsonAsFile` (used by Settings Download card filenames).
- `ImportDecryptError`/`ImportMalformedFileError`, `parseImportFile`, `getEnvelopeSaltBytes`, `decryptImportEnvelope`.
- `state.ts`'s `replaceImportedState` is orphaned — no production caller, exercised only by `state.test.ts`.

## Drive Connection Persistence

- `getDriveAuthFor(portfolio)` caches/keys a `DriveAuthHandle` per portfolio; `driveProjectIdFor` derives the Drive project id. `createDriveSync`/`createDriveAuth` wire `@open-webapp/drive-connect` 0.2.0.
- `DriveAuthHandle` exposes only `{connect, disconnect, ensureFresh, activate}`; connection status comes from the `useDriveConnection` hook, not the handle. `connectInFlight` guards duplicate connect attempts.
- Status is split across two sources: `@open-webapp/drive-sync` (backup/sync state) vs `@open-webapp/drive-connect` (auth/connection state). `NO_ACTIVE_PORTFOLIO` is the placeholder id used before a portfolio is open.
- `getConnectionSnapshot()` in `src/lib/drive.ts` is the single call site reading the current `Connection` snapshot. A post-unlock effect calls `activate()`. `onDriveConnected`/`onDriveDisconnected` handlers exist for the four content-op signatures (backup/restore/list/status). `migrateLegacyDriveFolderIfNeeded` migrates pre-existing per-portfolio folders.
- Orphaned: a drive-compat wrapper and `pickFile` helper have no remaining callers. Widget CSS vars are mapped through `--owa-drive-*` custom properties.

## Drive Restore

- Three live restore paths: existing-portfolio conflict flow, new-portfolio-from-Drive-folder, new-portfolio-from-local-file. `DriveRestorePanel` and `GateRestoreFromFilePanel` have been removed and are not part of the current component tree.
- Picker-scoped Drive access (used before a portfolio session exists): `getPickerDriveAuth()`, `listPortfolioFoldersOnDrive()`, `decryptDriveFolderBackup()`; `DriveMalformedBackupError` vs `DriveDecryptError` distinguish corrupt-format from wrong-key/undecryptable backups.

## Drive Sync Conflict

- `handleSync` → `syncBackup` throws `RemoteChangedError` on conflict → `SyncConflictDialog` (Overwrite local / Overwrite remote / Cancel), including a spurious-version-drift auto-recovery path and separate handling for `DriveDecryptError` vs generic errors.
- `drive.ts` exports: `getBackupFileStatus`, `overwriteLocalWithRemote`, `overwriteRemoteWithLocal`, `getPortfolioDriveFolderUrl` (plus `syncBackup`/`getBackupFileId` above).

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
