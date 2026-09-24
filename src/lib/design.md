# design.md

Directory structure, API contract, component tree, state management, data model, data flows, design patterns.

## Component Tree

- `App.tsx` owns the non-persisted Budget `period` and Spend `selectedScope`; `BudgetPage.tsx` receives both. `period` initializes to `'spend'`; `selectedScope` initializes to the newest transaction-backed year or `SPEND_ALL_YEARS`. The top-bar control has three tabs: Expenses, Spend, Analytics; Spend's All/year selector is a second row. Shared account-rule controls are in Settings.
- `router.ts` recognizes `#/categories`; `App.tsx` renders `ManageCategoriesPage` there without requiring a portfolio session.
- `Settings.tsx` has exactly Backup, Encryption, Quotes API Key, and Spend Accounts tabs. Its props contain no categories, mappings, category dispatcher, or category-hydration state.
- `ClosedPositionsTable.tsx` — table with symbol, closed date, realized G/L, delete + undo buttons; takes `positions` prop (caller-supplied ClosedPosition[])
  - Used by `PositionsTable.tsx` (passes `state.closedPositions`)
  - Used by `AccountsPage.tsx` (passes `acctFilteredClosedPositions(state)`)
- `Settings.tsx` "Quotes API Key" tab (third `.seg-opt`, alongside Backup/Encryption; internal `settingsSection` value still `'priceSync'`) — single card with two sub-blocks:
  - Polygon (Equity/ETF) sub-block: masked (`type="password"`) Polygon.io API key input (commits on blur via `SET_PRICE_SYNC_API_KEY`), "Fetch prices now" button + adjacent `type="date"` input (disabled while fetching; date optional — empty means auto-computed date), last-run status text (`state.priceSync.lastRun`: date/time, and either an error message (`lastRun.error`, e.g. invalid/unauthorized API key) or `{marketTickerCount} tickers fetched from Polygon` + updated count + not-found list; "Never run" if no run yet), and (new) a `tickerOverviewErrors` error list (`{symbol}: {message}` per line) — same map `QuotesPage.tsx` renders its failure banner from, passed here as a new `tickerOverviewErrors` prop
    - Shares its fetch/orchestration call with `App.tsx`'s on-load/on-focus effect: both call the same `runPriceSyncTrigger` `useCallback`, lifted from `App.tsx` and passed down as a prop; the button just wraps it with a local `fetchingPrices` loading state, passing the local date-input value (or `undefined` if empty) as `runPriceSyncTrigger`'s optional `overrideDate` arg — the automatic on-load/on-focus calls always call it with no argument
  - Alphavantage (Mutual Fund) sub-block, visually separated below (border-top) within the same card: masked Alphavantage API key input (commits on blur via `SET_MUTUAL_FUND_SYNC_API_KEY`), "Fetch mutual fund prices now" button (no date input — always fetches today's latest close), last-run status text (`state.mutualFundSync.lastRun`: date/time, error or updated count + not-found list, "Never run" if no run yet), and its own `mutualFundSyncErrors` error list — independent `Record<symbol, message>` map from `tickerOverviewErrors`, never merged with it
    - Mirrors the Polygon block's wiring: button wraps a new `runMutualFundSyncTrigger` prop (lifted from `App.tsx`, mirrors `runPriceSyncTrigger`) with a local `fetchingMutualFunds` loading state; no date override arg
- `QuotesPage.tsx` — full-page view rendered when `state.view === 'quotes'` (sibling of `AccountsPage.tsx`/Settings, same full-width wrapper as Accounts); props `{ state, dispatch, tickerOverviewErrors }` (`tickerOverviewErrors` is `App.tsx` local state, not part of `AppState`; `mutualFundSyncErrors` is NOT passed here — its errors surface only in Settings). Row set = `heldEquityEtfSymbols(state)` UNION `heldMutualFundSymbols(state)`, each sorted alphabetically then merged and re-sorted by symbol. New "Asset Class" column: Equity/ETF rows look up the matching position's effective `assetClassManualOverride || assetClass`; Mutual Fund rows hardcode `'Mutual Fund'` (a mutual fund symbol is definitionally that class). Loads `marketDataDb.getAllBars()` + `getAllTickerOverviews()` in a `useEffect` keyed on both `priceSync.lastRun?.at` and `state.mutualFundSync.lastRun?.at` (re-reads after either sync's run). Columns: Ticker, Asset Class, Name (from cached `TickerOverview.name`, `—` if uncached — shared cache, see Data Flows), Status, Price (`fmtUSD`; Equity/ETF falls back to cached bar's `close` if not in `priceSync.heldPrices`; Mutual Fund reads `mutualFundSync.heldPrices` only, no bar fallback), Held (always `Yes` — page only lists held symbols), Last Updated (UTC, formatted from the matching `DailyBar.t`, if any), SIC Description (`overview?.sicDescription || '—'` — `||` not `??`, so a cached-but-empty string from a mutual fund's overview also shows `—`). Status values: Equity/ETF rows are `OK`/`Not found` (from `priceSync.heldPrices`/`lastRun.notFound`, as before); Mutual Fund rows are `Not found` (in `mutualFundSync.lastRun.notFound`), else `OK` (has a price fetched today) or `Pending` (no price yet, or stale from a prior day). Search box live-filters ticker/name/status/SIC/asset-class across the row set. Empty state "No holdings to show." when no held Equity/ETF or Mutual Fund symbols. Failure banner "Could not fetch name for: X, Y" rendered when `tickerOverviewErrors` (Polygon only) is non-empty.
- `Nav.tsx`'s `mainNavTabs` has 4 entries: Budget, Positions (`accounts` view), Register, Quotes. RailNav places Switch portfolio first, Sync above Settings when `connected || syncing`, and Settings last; TopBar is period-control-only.

## Data Flows

### Budget Income

`GlobalCategoryState = { categories: Category[]; budgetAccountRules: BudgetAccountRule[] }` is shared through `categoryStore`, `categoryPersist`, `categoryDrive` (`category-mappings.json`), `categoryMerge`, and `useGlobalCategories`. There is no portfolio-level description→expense mapping; `state.ts`'s `propagateSpendLinksByAutoTag(transactions, definitions)` instead links a `BudgetTransaction`'s `spendExpenseId`/`categoryId` by shared `autoTag` string — for each distinct tag, the most-common linked `spendExpenseId` among its carriers wins (ties → first in state order), and every carrier is overwritten to that winner (unresolvable winners and untagged/singleton-tag records are left untouched). It runs on `IMPORT_BUDGET_TRANSACTIONS` (tag lookup against the existing state plus the current batch), on `AUTO_TAG_BUDGET_TRANSACTIONS`, and immediately after manual `ADD/UPDATE_BUDGET_TRANSACTION`/`UPDATE_BUDGET_TRANSACTIONS_BULK` (bulk's explicit `spendExpenseId` patch on selected rows applies first, then cascades to same-tag siblings). Rules merge by `normalizedName`, tombstone on delete, and use `negativeSpend` as the permanent default. `AppState.budgetAccountAppliedConventions: Record<normalizedAccountName, StatementConvention>` records each portfolio's applied convention. BudgetPage requires an import account, converts rows to canonical signs/names before `IMPORT_BUDGET_TRANSACTIONS` dedup, and stores the marker even for an all-duplicate batch. `App.tsx` reconciles before rendering an opened portfolio and after global-rule changes; `RECONCILE_BUDGET_ACCOUNT_CONVENTIONS` delegates to `reconcileBudgetAccountRules`. Parsers are unchanged. Manual transactions have no provenance, so reconciliation also flips their matching amounts.

`Category` active exact normalized `Income` match -> `selectors.ts` income helpers -> BudgetPage income cards and savings-rate selectors. `effectiveCategoryId(transaction, definitions)` resolves a linked definition before all Income/spend classification. `excludedCategoryIdSet` centralizes `excludeFromSpend` and Income exclusion for spend totals and analytics. Shared spend selectors negate debit-signed amounts; credits/refunds therefore reduce actual spend. Budget persistence/export contains definitions, amount snapshots, and transactions only; legacy manual-income keys are dropped during hydration/import.

Spend only: `spendBudgetYears(budgetTransactions)` returns newest-first transaction years, without current-year or snapshot-only additions. `SPEND_ALL_YEARS` is a selector-local symbol sentinel; `spendTransactionsForScope` returns all transactions for it, and `spendCardTotals` aggregates each transaction year with that exact year's snapshot (`{}` when absent), never nearest-year resolution. BudgetPage dispatches `ENSURE_BUDGET_YEAR_SNAPSHOT` only for selected concrete years lacking an expense snapshot, never for All; add/import preserves All, while a concrete scope invalidated by deletion or moving its last transaction resets to All. `availableBudgetYears` remains unchanged for shared non-Spend consumers: transaction years plus the current year.

`sankeyFlowData` spaces category nodes by a 32px minimum gap so two-line labels do not overlap. `BudgetSankey` derives its canvas height from the lowest node (460px minimum) and scrolls both axes within a 720px-tall viewport.

### Budget Auto-Tag

- Parallel-array model: `BudgetTransaction.tags` (user-only by convention, no rename) alongside `BudgetTransaction.autoTags` (system-only). Omit-when-empty invariant for both (key deleted, never `[]`); old blobs backfill all-existing-as-user — `coalesceWithDefaults` (`persist.ts`) tolerates missing `autoTags` (undefined = none), no migration writes, and the Drive restore path shares the function so it gets the same guarantee. JSON backup / Drive encrypted envelope carry both arrays automatically (whole-object shape, no code change).
- Union helpers: `unionTags` (`autoTag.ts`, zero imports; `state.ts` → `autoTag.ts` acyclic) has two overloads — legacy single-array `(existing, toAdd)` and combined-aware `(user, auto, toAdd, target)`, which dedups against the merged case-insensitive set of both arrays (either direction, existing casing wins), skips once the combined unique count reaches 5 (`seen.size >= 5` → skip; neither array evicts the other), appends only to the target array (`'user'` → `tags`, `'auto'` → `autoTags`), and returns `undefined`-when-empty. Bulk apply (`updateBudgetTransactionsBulk` `tagsToAdd`) uses the combined form with target `'user'`, so candidates duplicating an auto tag or exceeding the combined cap are refused (dropped, not added).
- Recompute transform: generic `applyAutoTags<T extends { description: string; tags?: string[]; autoTags?: string[] }>` clusters the pool, then sets each member's `autoTags` from scratch via the auto-target union (prior auto never carried over, so stale tags vanish on description change); singleton / null-tagged members and cap/dup-skipped candidates get the `autoTags` key deleted; `tags` never touched. `taggedCount` = records that actually gained an auto tag (skips + removals excluded). Clustering (`clusterDescriptions`, `sanitizeTagToken`, `MIN_TAG_LENGTH`) unchanged: adjacent-pair LCP with min-4-char trimmed threshold (whitespace never counts), singleton clusters untagged, affinity-lengthening cut without prefix-containment, sanitized alphanumeric max-10 output.
- Two triggers, different pools: manual `AUTO_TAG_BUDGET_TRANSACTIONS` (no payload) → `autoTagBudgetTransactions` (`state.ts`) recomputes ALL `budgetTransactions` regardless of Spend scope; import path → `importBudgetTransactions` runs `applyAutoTags(rows)` on just the imported batch pre-dedup (CSV-parsed `tags` flow into user, cluster tags into auto under merged rules with user-wins clash skip), never pre-existing records.
- Split clear actions: `CLEAR_BUDGET_TRANSACTION_TAGS` (no payload) → `clearBudgetTransactionTags` (`state.ts`, strips `tags`, preserves auto) plus `CLEAR_BUDGET_TRANSACTION_AUTO_TAGS` → `clearBudgetTransactionAutoTags` (strips `autoTags`, preserves user); both omit the key, never `[]`. The chooser's Both scope dispatches the two actions sequentially.
- Merged-render rule (`BudgetPage.tsx` `visibleAutoTags` + `TagInput blockedTags`): read and edit cells render visible auto chips gray first (`tag tag-neutral` + `title="Auto-tag"`) then user chips red (`tag tag-outline`); cross-dupe suppressed (an auto chip whose lowercase matches any user chip on the same record is hidden). Edit mode gray chips have no × (read-only); `TagInput` gets `blockedTags = row.autoTags` for silent merged dup/cap refusal. `TagInput.tsx` accepts optional `blockedTags?` (never rendered there — the host renders the read-only chips): `commit` silently refuses tokens matching `value` + `blockedTags` case-insensitively or when the merged unique count reaches 5 (`MAX_TAGS`).
- `BudgetPage.tsx` header left-group holds title + Auto-tag + Clear-all-tags buttons + shared transient ~4s feedback span (`autoTagFeedback`, reused by the chooser with its own 4s timer helper); muted legend line under the toolbar ("Gray = auto-tag, red = your tag"); no tag-filter combobox. Search filters over the merged set (`tags` + `autoTags`). The chooser dialog (radio User/Auto/Both, default User) shows per-scope affected counts, per-scope confirm copy, Cancel, and zero-skip (feedback only, no dispatch).

### Undo Closed Position

ClosedPosition → ClosedPositionsTable Undo click → findMatchingOpenPosition/isExactLotMatch dedup check (state.ts) → [window.confirm if exact-lot match] → RESTORE_CLOSED_POSITION dispatch → restoreClosedPosition (state.ts)

- No same-symbol open position in account → silent restore.
- Same-symbol position, identical shares/avgCost/assetClass (exact-lot match) → confirm dialog; Yes replaces existing position, No is a no-op.
- Same-symbol position, different shares/avgCost/assetClass → silent restore as separate duplicate-symbol row.

### Account Selection

SELECT_ACCOUNT (accountId, categoryKey) → selectAccount (state.ts) → sets selectedAccountId + selectedCategoryKey (toggle if same pair) → categoryCards/closedPositionsCard `selected` fields react → AccountsPage branches main panel on selectedCategoryKey

- Same account + categoryKey clicked again → toggle: clear selection (both null).
- Different account or categoryKey → replace selection.
- Null selection → main panel shows portfolio-level view.
- `CLEAR_ACCOUNT_SELECTION` → `clearAccountSelection` (state.ts) is a second, unconditional (non-toggle) path to the same null state (`selectedAccountId`/`selectedCategoryKey` both set to `null` regardless of current selection) — used by the Accounts page's "All Accounts" pill.

### Drive Connection Persistence

Auth is portfolio-scoped: `getDriveAuthFor(portfolio: Portfolio): DriveAuthHandle` (`drive.ts`) returns a cached, lazily-created handle keyed by `driveProjectIdFor(portfolio)` (`driveAuthCache: Map<string, DriveAuthHandle>`) — `driveProjectIdFor` returns the fixed `'app'` id for the migrated legacy portfolio (`isMigratedPortfolio(portfolio)` true, so its existing stored token/connection keeps working) and `portfolio.id` for every other portfolio (isolated auth/token per portfolio). Each cache miss builds a fresh `createDriveSync({ appId: 'portfolio', clientId, folderPath: ['OpenWebApp','Portfolio'] })` auth facade and wraps it via `createDriveAuth({ drive: authFacade, projectId, tokenBufferMs: 5*60*1000 })` from `@open-webapp/drive-connect` (0.2.0), co-located in `drive.ts` (a separate `driveAuth.ts` would import-cycle with `drive.ts`). `DriveAuthHandle` API is exactly `{ connect(): Promise<Connection>, disconnect(): Promise<void>, ensureFresh(): Promise<Connection>, activate(): () => void }`. Each handle owns its own `connectInFlight` guard (shared by the widget's Connect button and `ensureFresh()` — prevents a double Google popup) and the visibility/pageshow token warm-up. It does NOT own a connection-status store of its own — status lives in drive-sync.

Status: `useDriveConnection(getDriveAuthFor(portfolio))` → `{ connected, email, connecting, error, needsReauth }` is the only read path (unchanged shape/hook signature). Internally it reads drive-sync's own connection store (`ProjectHandle.getConnectionSync()`/`subscribeConnection(cb)` on `driveSyncForPortfolio(portfolio).project(driveProjectIdFor(portfolio))`) — drive-sync is the real single source of truth for `connected`/`email`/`needsReauth`; drive-connect layers only `connecting`/`error` (its own in-flight/last-error state) on top. `App.tsx` calls `useDriveConnection(getDriveAuthFor(activePortfolio ?? NO_ACTIVE_PORTFOLIO))` — a placeholder `Portfolio` (`NO_ACTIVE_PORTFOLIO`) stands in before `activePortfolio` resolves, since hooks can't be called conditionally; its `connected` status is never surfaced anywhere the picker/loading screens render.

`getConnectionSnapshot(portfolio: Portfolio): Connection | null` (`drive.ts`) — wraps `driveSyncForPortfolio(portfolio).project(driveProjectIdFor(portfolio)).getConnectionSync()`; synchronous, never throws, `null` means disconnected OR not-yet-hydrated (indistinguishable). One call site: `Settings.tsx`'s `handleChangePassword`, gating the re-sync as `if (getConnectionSnapshot(activePortfolio) !== null) { await syncBackup(activePortfolio, ...) }`.

`App.tsx` holds NO Drive auth state — connection state is read via `useDriveConnection(getDriveAuthFor(...))`; `{ connected }` feeds `<Nav>`. No pre-gate Drive status probe; no `getBackupFileId()` auto-call on initial load.

Post-unlock, a single effect gated on `sessionKey !== null && activePortfolio` calls `getDriveAuthFor(activePortfolio).activate()` (returns a dispose fn for cleanup) to start background token warm-up. `activate()` is host-called; the widget never self-activates on mount.

`App.tsx` defines `onDriveConnected` (fetches `getBackupFileId(activePortfolio)` → `setBackupFileId` in its own try/catch — a failed lookup leaves `backupFileId` null, does NOT forget the connection) and `onDriveDisconnected` (`setBackupFileId(null)`), passed only to `<SettingsPage>` along with `activePortfolio` and the resolved `driveAuth` handle (`getDriveAuthFor(activePortfolio)`). `<PasswordGate>` receives none of these — it takes just `{ shape, onUnlock, onBackToPicker }` and renders no Drive UI. `SettingsPage` renders `<GoogleDriveWidget auth={driveAuth} onConnected/onDisconnected>` itself.

The four content ops (`syncBackup`, `restoreBackupFromFileId`, `overwriteLocalWithRemote`, `overwriteRemoteWithLocal`) each take `portfolio: Portfolio` as their first argument and call `await getDriveAuthFor(portfolio).ensureFresh()` internally.

`migrateLegacyDriveFolderIfNeeded(portfolio: Portfolio): Promise<void>` (`drive.ts`) — one-time, idempotent migration of a portfolio's backup out of the legacy flat root folder (`OpenWebApp/Portfolio/portfolio-state.json`, shared by every portfolio pre-multi-portfolio) into its own named subfolder (`OpenWebApp/Portfolio/{portfolio.name}/portfolio-state.json`). No-ops for any non-legacy portfolio (`isMigratedPortfolio` false) and when there's no existing, still-valid connection (checked via `getConnectionSnapshot`) — deliberately never triggers an auth popup, since it runs as a background step rather than in response to a user "connect" action. Writes the new copy before removing the old one, so a crash mid-migration leaves the legacy file in place and simply retries next call; once the flat-root file is gone (or never existed) it's a cheap no-op forever after.

No `NeedsReauthError` catch site calls a manual auth refresh/re-probe anymore — the five former call sites (`App.tsx` `handleSync`/`handleConflictTakeRemote`/`handleConflictPushLocal`, `Settings.tsx` `handleChangePassword`, `DriveRestorePanel.tsx`'s `DriveFilePickerDialog.onSelect`) were deleted outright, with no retry/poll/re-subscribe logic added in their place. This is an accepted behavior change: after a `NeedsReauthError`, the connected/needs-reauth badge no longer updates instantly — it is eventually consistent, catching up passively on drive-sync's own next trigger (mount, visibility warm-up, cross-tab broadcast, or a subsequent `connect()`/`disconnect()`), not on the error itself.

`getBackupFileId(portfolio)`'s own internal `NeedsReauthError` catch in `drive.ts` is a passive probe and stays silent (unchanged).

**Orphaned code**: the exported `drive` object in `drive.ts` (a compatibility wrapper adding a single-file-returning `pickFile` override over `legacyDriveSync`) has no remaining callers anywhere in `src/` now that `DriveRestorePanel.tsx` is deleted — only its own test (`drivePickFile.test.ts`) exercises it. Not removed as part of this docs pass; flagged here for a future cleanup.

Widget styling: `src/index.css` does `@import '@open-webapp/drive-connect/styles.css'` and maps the package's `--owa-drive-*` custom props (`gap/font/fg/muted/accent/accent-fg/danger/radius`) onto portfolio design tokens under `:root` (`--owa-drive-danger` → `--color-text` — portfolio has no error-color token, so widget inline errors are not red). `src/styles/styles.css` untouched (byte-identical port of the design bundle).

### Restore from Drive

There is no in-app "restore an arbitrary backup file into the current portfolio" flow anymore (`DriveRestorePanel`/`GateRestoreFromFilePanel` are deleted). What replaced them:

- **Existing portfolio, same backup**: the Sync Conflict flow below (`overwriteLocalWithRemote`) is the only way an already-open portfolio's local state is replaced from Drive.
- **New portfolio from a Drive backup**: `PortfolioPicker.tsx` lists an account's other Drive-backed portfolio folders (via `getPickerDriveAuth()` + `listPortfolioFoldersOnDrive()`) and imports a chosen one as a brand-new local portfolio via `decryptDriveFolderBackup()` — see "Picker-scoped Drive access" below and `src/components/PortfolioPicker.design.md`.
- **New portfolio from a local file**: `PortfolioPicker.tsx` decrypts a user-picked export file directly (`lib/importExport.ts`'s `decryptImportEnvelope`) into a new portfolio — no gate-level component involved.

The `drive` compatibility wrapper (`pickFile` override) in `drive.ts` that the old `DriveRestorePanel` used to call `drive.project('app').pickFile({ includeFolders: true })` is still defined but has no current callers — see "Orphaned code" note under Drive Sync above.

### Picker-scoped Drive access

- `getPickerDriveAuth()` (`drive.ts`) — cached `DriveAuthHandle` (fixed `projectId: 'picker'`) built over `legacyDriveSync` (the fixed `['OpenWebApp','Portfolio']` facade), independent of any per-portfolio `driveAuthCache` entry. Used by `PortfolioPicker.tsx` (via `App.tsx`) to authenticate before browsing Drive for importable portfolios.
- `listPortfolioFoldersOnDrive()` (`drive.ts`) — lists immediate subfolders of `OpenWebApp/Portfolio` (`files.list({ folderId, mimeType: 'application/vnd.google-apps.folder' })`), each expected to be one portfolio's backup folder; returns `{ name, id }[]`.
- `decryptDriveFolderBackup(folderId, password)` (`drive.ts`) — reads `portfolio-state.json` from the given folder, derives a key from the envelope's own embedded salt, decrypts it; throws `DriveDecryptError` on a password mismatch, `DriveMalformedBackupError` on a folder with no/unparseable backup file (distinct from a decrypt failure so the picker can skip a malformed folder while still prompting to retry the password on a real mismatch). Returns `{ state, key, salt }`.
- `DriveMalformedBackupError` (`drive.ts`, extends `Error`) — see above.

### Sync Conflict

Manual Sync button → `App.tsx` `handleSync` → `syncBackup(activePortfolio, state, key, salt)` throws `RemoteChangedError` (drive-sync; `reason` = `'remote-changed'` | `'never-restored'`) → caught via `error.name === 'RemoteChangedError'` string match (not `instanceof`)
  ├─ `fileId = backupFileId ?? error.fileId ?? await getBackupFileId(activePortfolio)`; none → existing `alert('Sync failed: …')`, no dialog
  ├─ `getBackupFileStatus(activePortfolio, fileId).catch(() => null)` → `remoteMs = Date.parse(remoteModifiedTime)`, `restoredMs = lastRestoredAt` (epoch ms)
  ├─ **spurious version drift**: `restoredMs` finite AND remote content NOT newer (`!(remoteMs > restoredMs)`) → `RemoteChangedError` is a metadata-only Drive `version` bump, not a real remote edit → `overwriteRemoteWithLocal(activePortfolio, state, key, salt, fileId)` silently → `setBackupFileId` → `alert('Synced to Drive')`, no dialog. That re-push throwing → fall through to the dialog.
  └─ else (remote content genuinely newer, or no `lastRestoredAt` / status fetch failed) → `setSyncConflict({ fileId, remoteModifiedTime, lastRestoredAt })` → `<SyncConflictDialog>` (`src/components/SyncConflictDialog.tsx`; owns local `busy` + `inlineError`, all buttons disabled while pending)
     ├─ Overwrite local with remote → `handleConflictTakeRemote` → `overwriteLocalWithRemote(activePortfolio, fileId, key)` → `dispatch({ type: '__SET_STATE', newState })` → `setSyncConflict(null)` (debounced local-persist effect saves after; no explicit persist call)
     ├─ Overwrite remote with local → `handleConflictPushLocal` → `overwriteRemoteWithLocal(activePortfolio, state, key, salt, fileId)` → `setBackupFileId` → `setSyncConflict(null)` → `alert('Synced to Drive')`
     └─ Cancel → `setSyncConflict(null)`, no change on either side

Non-`RemoteChangedError` throws from `syncBackup` keep the old `alert('Sync failed: …')`.

Dialog error handling (both overwrite props are async, may throw):
- `DriveDecryptError` (matched by `err.name`) → inline "This Drive backup was saved with a different password. Use Settings > Drive > Restore from Drive to enter it."; dialog stays mounted, no inline password input.
- Any other throw (incl. a second `RemoteChangedError` from the re-write) → inline "Drive changed again — close and retry sync."; dialog stays open, no retry loop.

`drive.ts` exports, all taking `portfolio: Portfolio` as their first argument (each internally resolves `driveSyncForPortfolio(portfolio).project(driveProjectIdFor(portfolio))` and/or `getDriveAuthFor(portfolio)`):
- `getBackupFileStatus(portfolio, fileId): Promise<{ exists, remoteModifiedTime?: string, lastRestoredAt?: number }>` — thin `withTimeout` wrapper over that project's `files.status`; `lastRestoredAt` is epoch ms (`null` → `undefined`). Deliberately omits drive-sync's `changedSinceRestore` (a Drive `version`-counter compare that also trips on metadata-only server changes). Detection is by the thrown `RemoteChangedError`; `remoteModifiedTime` vs `lastRestoredAt` only distinguishes a real remote edit from spurious version drift. Rejections propagate (caller does `.catch(() => null)`). Never gates a sync/restore.
- `overwriteLocalWithRemote(portfolio, fileId, key): Promise<AppState>` — `await getDriveAuthFor(portfolio).ensureFresh()` → reuses private `readAndDecryptFile` (advances drive-sync baseline via `files.read`; maps `OperationError` → `DriveDecryptError`); throws `Error('Drive backup is empty or unreadable')` on null; propagates `DriveDecryptError`.
- `overwriteRemoteWithLocal(portfolio, state, key, salt, fileId): Promise<string>` — `await getDriveAuthFor(portfolio).ensureFresh()` → `files.read(fileId)` to adopt the remote version as baseline (result discarded) → `return syncBackup(portfolio, state, key, salt)`; a `RemoteChangedError` from that re-write propagates unchanged, NO retry.
- `getPortfolioDriveFolderUrl(portfolio): Promise<string>` — resolves the portfolio's Drive backup folder URL (`https://drive.google.com/drive/folders/<folderId>`) via `ensureFolderPath()`. Placed near `getBackupFileId`.

### Balance Register

`register.ts` — pure data-in/data-out module (no `AppState` coupling), consumed by `selectors.ts` and `RegisterPage.tsx`/`RegisterBalanceDialog.tsx` (not detailed here):

- `ACTIVITY_TYPES: ActivityType[]` — the 7 activity types (`None` first).
- `ACTIVITY_SIGN: Partial<Record<ActivityType, 1 | -1>>` — sign per type; `None` absent (treated as 0 by callers via `?? 0`).
- `BALANCE_FIELD_HINTS` — `{ key, hints[] }[]` for paste-mode column-mapping.
- `accountLedger(entries, accountId)` — filters to one account, sorts date-asc, returns `LedgerRow[]` (`BalanceEntry` + `change`/`attributed`/`unexplained`); `attributed` sums `ACTIVITY_SIGN[type] * amount` across each entry's `activities` array.
- `latestBalance(entries, accountId)` — most recent `BalanceEntry` by date, or `null`.
- `scopeLedger(entries, scopeAccountIds, activityFilter)` — unions `accountLedger` across accounts, optional `'With Activity'` filter, sorted date-desc then accountId.
- `registerChartSeries(entries, scopeAccountIds)` — builds `RegisterChartSeries` (SVG `points`/`area`/`dots`/`yLabels`/`xLabels`) for the balance-over-time chart.
- `matchAccountId`, `matchActivityType`, `normalizeDateInput` — paste-mode field-matching/normalization helpers.
- `emptyDraftRow`, `isDraftRowValid` — `DraftRow` helpers for the manual-entry dialog; `DraftRow.activities: DraftActivity[]` holds the row's activity lines, `emptyDraftRow()` seeds `activities: []`.
- `DraftActivity` — `{ key: string; type: string; amount: string; note: string }`, one activity line within a `DraftRow`.

`selectors.ts`'s `registerCategoryCards(state)`/`registerAllAccountsTotal(state)` call `latestBalance(state.balanceEntries, accountId)` against `state.accounts`/`state.balanceEntries` to build the Register page's left-column cards and "All Accounts" total — `register.ts` itself never imports `AppState`; all `AppState` reads happen in `selectors.ts`, which passes plain `BalanceEntry[]`/`accountId` args in. `RegisterPage.tsx` reads only the derived selector/register.ts output, never raw `state.balanceEntries` directly.

`state.ts`'s `updateBalanceEntry(state, entry)` upserts a `BalanceEntry` by id (updates in place if the id exists, else appends), dropping any other entry that collides on the same `(accountId, date)` with a different id. `reducer.ts`'s `UPDATE_BALANCE_ENTRY { entry: BalanceEntry }` action dispatches to it — the save path for the manual-entry dialog (new and edited register rows).

### Price Sync

App load/tab-focus (or Settings "Fetch prices now") → `App.tsx`'s `runPriceSyncTrigger(overrideDate?)` → `priceSync.ts`'s
`runPriceSync(state.priceSync, heldEquityEtfSymbols, overrideDate?)` → `fetchGroupedDailyBars`
(Polygon grouped-daily-bars, one call for `overrideDate` if given, else the next business day after
`lastFetchedDate`) → `marketDataDb.putBars` (ALL response tickers, unencrypted
local cache, separate from `persist.ts`/Drive, readable in full via `marketDataDb.getAllBars()`) + `RECORD_PRICE_SYNC_RUN` dispatch (advances `lastFetchedDate` +
`heldPrices` + `lastRun.marketTickerCount` (total tickers in the Polygon response, 0 on empty/error) only on non-empty response) → `UPDATE_POSITION` dispatch for
each held Equity/ETF symbol found in the response → (unawaited) `tickerOverview.ts`'s
`syncTickerOverviews(heldSymbols, apiKey, positions, dispatch, onError, onSuccess?, sleep?)`: for each held
symbol not already in the `ticker_overviews` `marketDataDb` cache, fetches Polygon's Ticker Overview endpoint
(`GET /v3/reference/tickers/{ticker}`), caches `{ name, sicDescription }` via `putTickerOverview`, and
dispatches `UPDATE_POSITION` (`patch: { name }`) for every matching held position. `results.sic_description`
is optional in Polygon's response (ETF/fund tickers, e.g. `SCHD`, omit it — only company tickers carry a SIC
classification); `fetchTickerOverview` requires only `results.name`, defaulting `sicDescription` to `''` when
absent, so an ETF response is never treated as malformed. A `status: "NOT_FOUND"` body (Polygon doesn't
recognize the ticker) throws `TickerOverviewNotFoundError`, checked before the HTTP-status gate since Polygon
doesn't reliably return 200 for this body (a non-2xx NOT_FOUND response must still be detected, not swallowed
into the generic non-2xx Error branch below it). Distinct from a malformed/network failure: the caller caches
it as `{ name: '', sicDescription: '', notFound: true }` and calls `onError` once —
`notFound: true` cache entries are treated as a cache hit on every later call, so the ticker is never
refetched. Other per-ticker fetch/parse failures are caught and never rethrown, never touch `priceSync` state,
leave the ticker uncached (retried on a future call), and are surfaced only via `tickerOverviewErrors` —
`App.tsx` local state (`Record<ticker, message>`) passed as a prop to `QuotesPage.tsx` for its failure banner.
Successive tickers are paced `REQUEST_SPACING_MS` (12.5s) apart to stay under Polygon's ~5 req/min free-tier
limit proactively. A 429 (`TickerOverviewRateLimitError`) is treated differently from other per-ticker
failures: instead of moving on, the same ticker is retried after `RATE_LIMIT_BACKOFF_MS` (60s, still within
the rate limit) in a loop until it succeeds or fails for a non-rate-limit reason — so one call drives every
held symbol to completion rather than stopping at the first rate-limited ticker. `sleep` is injectable
(defaults to a real `setTimeout`-based wait) purely for test determinism. `App.tsx` guards against overlapping
runs via `tickerSyncInFlightRef` — since a run can now take minutes for a large portfolio, a mount/tab-focus
retrigger mid-run is a no-op rather than starting a second overlapping loop. This ref only gates *starting* a
new name-sync run — it does NOT gate the price-sync retry poll (see Shared retry interval below): a
long-running name sync never blocks price-date catch-up, since the two hit independent Polygon endpoints.

`marketDataDb`'s `DailyBar` also carries `t` (Unix ms — Polygon aggregate bar's end-of-window timestamp),
passed through unchanged from `PolygonGroupedBarsResponse.results[].t` by `runPriceSync`'s bar mapping;
`QuotesPage.tsx` formats it as each row's "Last Updated (UTC)".

- No API key configured → no fetch attempted (`runPriceSyncTrigger` returns early).
- Settings "Fetch prices now" with a date entered in the adjacent date input → that date is used verbatim as `overrideDate`, bypassing the `lastFetchedDate`-based next-business-day computation; on success `lastFetchedDate` is still set to it (so the next automatic trigger continues forward from there, which can mean re-fetching or skipping days relative to a purely sequential catch-up — an accepted trade-off for an explicit manual/ad-hoc fetch).
- Empty/malformed response (incl. network error) → `lastFetchedDate` NOT advanced, every held symbol reported in `lastRun.notFound`, retried on next trigger.
- Non-2xx HTTP response → `fetchGroupedDailyBars` throws `PolygonApiError`. `runPriceSync` special-cases a 403 when the target date is today: Polygon returns 403 NOT_AUTHORIZED ("today's data before end of day") for the *current* calendar day even on plans entitled to this endpoint — treated identically to an empty response (no-op, `lastRun.notFound` populated, no `error`, retried next trigger). A 403 (or any other non-2xx) for a non-today target date is a genuine entitlement/auth failure: `lastFetchedDate` NOT advanced, `lastRun.notFound` is empty and `lastRun.error` holds the message instead (surfaced in Settings).
- CSV Positions import after a same-day fetch already ran →
  `positionsImport.ts` reapplies the cached `state.priceSync.heldPrices`
  price over the freshly-imported CSV price for Equity/ETF positions when the cached price's date >= the import date
  (API always wins for the same day or newer).

### Mutual Fund Price Sync

App load/tab-focus (or Settings "Fetch mutual fund prices now") → `App.tsx`'s `runMutualFundSyncTrigger()`
(no-op if `mutualFundSync.apiKey` unset or a run is already in flight, via `mutualFundSyncInFlightRef`) →
`mutualFundSync.ts`'s `runMutualFundSync(state.mutualFundSync, heldMutualFundSymbols(state), positions,
dispatch, onError, onSuccess)` → for each held Mutual Fund symbol, Alphavantage `SYMBOL_SEARCH` (name, once
ever) if not already cached, then `TIME_SERIES_DAILY` (latest close, once per calendar day) if today's price
isn't cached yet → `RECORD_MUTUAL_FUND_SYNC_RUN` dispatch (sets `lastRun` + merges `heldPrices` + persists
`callBudget`) → `UPDATE_POSITION` (`patch: { name }`, never `price`) for every matching held position on a
successful name fetch, mirroring `tickerOverview.ts`'s pattern.

- **Shared name cache**: reuses the same `ticker_overviews` `marketDataDb` store as Polygon's ticker-overview
  sync (see Price Sync above), writing `{ name, sicDescription: '' }` — Alphavantage has no SIC-equivalent
  field. `QuotesPage.tsx` reads this cache for both Equity/ETF and Mutual Fund rows, so the `||` (not `??`)
  fallback on `sicDescription` matters here: a mutual fund's cached-but-empty string must still render `—`.
  A `SYMBOL_SEARCH` call with no match caches `{ name: '', sicDescription: '', notFound: true }` (same
  `notFound: true` sentinel as Polygon's `TickerOverviewNotFoundError` path) and calls `onError` once — never
  refetched on a later run, same cache-hit-skips-fetch behavior as the Polygon side. The cached not-found
  status is still added to that run's `lastRun.notFound` even when the cache hit means no fetch happens, so
  the Quotes page's "Not found" status keeps showing for it.
- **Daily call budget**: Alphavantage's free tier caps at `ALPHAVANTAGE_DAILY_CALL_CAP = 25` calls/day
  (`mutualFundSync.ts` and `selectors.ts` each define the constant; a comment cross-references the other to
  keep them in sync). Spent budget is tracked in `mutualFundSync.callBudget: { date, callsUsed }`, reset when
  `date` isn't today. Budget is incremented *before* each fetch call resolves (conservative — a crash mid-fetch
  still counts, avoiding a crash-loop re-spend). Once exhausted, `runMutualFundSync` stops issuing calls for
  the remainder of the run and reports the still-unresolved symbol count; it resumes on the next trigger once
  `date` rolls over.
- **Errors**: per-symbol fetch/parse failures are caught, never rethrown, and surfaced only via
  `mutualFundSyncErrors` — `App.tsx` local state (`Record<symbol, message>`), independent of
  `tickerOverviewErrors`, rendered only in `Settings.tsx`'s Alphavantage sub-block (not on `QuotesPage.tsx`).
  A rate-limited response (`AlphavantageRateLimitError`, detected via a truthy `Note`/`Information` field in
  an otherwise-200 body — Alphavantage doesn't use HTTP 429) is treated like any other per-symbol failure:
  logged via `onError` and given up on for this run, NOT retried in place. (Previously this looped on the same
  symbol with a 60s backoff between attempts; since each attempt still spent one unit of the shared daily
  budget, a single persistently-rate-limited symbol could drain the entire day's budget and starve every other
  held symbol — multiple symbols would show "Pending" for days. Now the symbol is simply left unresolved and
  retried on the next `SYNC_RETRY_POLL_INTERVAL_MS` tick or daily rollover, so a rate limit on one symbol never
  blocks the rest of the run.) Successive calls are paced `ALPHAVANTAGE_REQUEST_SPACING_MS` (12.5s) apart.
- **Shared retry interval**: a single `setInterval` (`SYNC_RETRY_POLL_INTERVAL_MS`, 60s) in `App.tsx` drives
  both syncs' catch-up retries. Each tick calls `selectors.ts`'s `shouldRetryPolygonSync(state,
  tickerOverviewErrors)` (true if the last Polygon run left symbols in `notFound`, or a ticker-overview fetch
  is currently erroring) and `shouldRetryMutualFundSync(state, today?)` (true if any held mutual fund symbol
  has a stale/missing price AND today's call budget isn't exhausted) independently, re-triggering whichever
  sync has unfinished work. The price-sync (`runPriceSyncTrigger`) retry is NOT gated on
  `tickerSyncInFlightRef` — price-date catch-up and ticker-name enrichment hit independent Polygon endpoints,
  so a long name sync (which can run for minutes) must not stall price retries; `runPriceSyncTrigger`'s own
  internal `tickerSyncInFlightRef` check still prevents it from starting an overlapping name sync. The
  mutual-fund retry IS gated on `mutualFundSyncInFlightRef` so a due retry never overlaps a run already in
  progress (mutual-fund price + name fetches share one call budget and one in-flight run, unlike Polygon's).
- No API key configured → no fetch attempted (`runMutualFundSyncTrigger` returns early, mirrors Price Sync).
- Symbol's price already fetched today (`heldPrices[symbol].fetchedAt` same calendar date) and name already
  cached → both fetches skipped for that symbol, no calls spent.
- Does not touch `Position.price` — Mutual Fund positions' price is never overwritten by this sync, only
  `Position.name`; `mutualFundSync.heldPrices` is the sole read path for mutual fund prices (`QuotesPage.tsx`,
  no bar-cache fallback since mutual funds aren't in `marketDataDb`'s Polygon bar cache).

### Import/Export

`importExport.ts` — local encrypted backup download/import plus public local-download utilities; backup contains budget data and no quotes-price caches:

- `ExportableState` (type) — strict subset of `AppState`: `accounts`, `positions`, `closedPositions`, `transactions`, `snapshots`, `csvMappings`, `customInstitutions`, `balanceEntries`, `budgetExpenseDefinitions`, `budgetExpenseAmountsByYear`, `budgetTransactions`, `priceSync: { apiKey, lastRun }`, `mutualFundSync: { apiKey, lastRun }`. Excludes `priceSync`/`mutualFundSync`'s `heldPrices`/`lastFetchedDate`/`callBudget` and all UI-state fields.
- `buildExportableState(state)` — pure pick of the above from `AppState`.
- `exportBackup(state, key, salt)` — `buildExportableState` then `encryptState` (`./crypto`) → `EncryptedEnvelope`.
- `downloadEnvelopeAsFile(envelope, filename)` — Blob + anchor-click browser download.
- `downloadCsvAsFile(csvText, filename)` — public Blob + anchor-click local CSV download (`text/csv;charset=utf-8`); no persistence, import, encryption, or Drive interaction.
- `UnencryptedPortfolioExport` (type) — alias of `ExportableState` (no additional fields).
- `buildUnencryptedPortfolioExport(state)` — pure; spreads `buildExportableState`, blanks `priceSync.apiKey`/`mutualFundSync.apiKey` to `''` (`lastRun` kept); never mutates input.
- `buildUnencryptedCategoriesExport(categories, budgetAccountRules)` — pure; returns `GlobalCategoryState` `{categories, budgetAccountRules}`.
- `localDateStamp(d = new Date())` — local-calendar `YYYY-MM-DD` stamp for filenames.
- `downloadPrettyJsonAsFile(data, filename)` — Blob + anchor-click download of 2-space pretty-printed JSON (`JSON.stringify(data, null, 2)`, `application/json`); silent, no password prompt or confirm. Settings Download card writes `ledger-portfolio-YYYY-MM-DD.json` (portfolio export) and `ledger-categories-YYYY-MM-DD.json` (categories export). Export-only — no import path. Same exclusions as the encrypted backup: UI/filter state and `heldPrices`/`lastFetchedDate`/`callBudget`. Encrypted `Download Backup` and `PortfolioPicker.tsx` `handleDownloadCategoryMapping` (`category-mapping.json`, the shared global-categories file) untouched.
- `ImportDecryptError` (extends `Error`) — wrong password (auth-tag mismatch on decrypt).
- `ImportMalformedFileError` (extends `Error`) — file isn't valid JSON, or isn't envelope-shaped per `detectEnvelopeShape`.
- `parseImportFile(fileText)` — `JSON.parse` + `detectEnvelopeShape` check → `EncryptedEnvelope`; throws `ImportMalformedFileError`.
- `getEnvelopeSaltBytes(envelope: EncryptedEnvelope)` — `Uint8Array`, decodes `envelope.salt` from base64 (wraps the module-private `base64ToBytes`).
- `decryptImportEnvelope(envelope, password)` — derives key from the envelope's OWN embedded salt (via `getEnvelopeSaltBytes`, not session salt) via `deriveKey`, decrypts via `decryptState`, catches `OperationError` and rethrows as `ImportDecryptError` → `ExportableState`. Coalesces every field against `ExportableState` defaults (`?? []` for arrays, `?? ''`/`?? null` for `apiKey`/`lastRun`) so an older/partial export never injects `undefined`.

`state.ts`'s `replaceImportedState(state, data: ExportableState)` — full replace of the exported collection fields + `priceSync`/`mutualFundSync` `apiKey`/`lastRun` only; spreads existing `priceSync`/`mutualFundSync` first so `heldPrices`/`lastFetchedDate`/`callBudget` survive untouched, and spreads existing `state` first so all UI-state fields pass through unchanged. **Orphaned**: no reducer action dispatches this and no component calls it (its former caller, `GateRestoreFromFilePanel.tsx`, is deleted — `PortfolioPicker.tsx`'s file-import path builds a fresh `AppState` directly in `App.tsx`'s `handleImportFromFile` instead). Only exercised by `state.test.ts`. Not removed as part of this docs pass; flagged for a future cleanup.

### Budget Expense CSV Export

`expenseExport.ts` — pure unencrypted budget expense-definition CSV builder:

- `buildExpenseCsv(definitions, amountsByYear, transactions, categories, now): string` derives years through `expenseTableYears(transactions, amountsByYear, now)`, sorts every definition by resolved category name then name, and returns CRLF CSV with `Name,Category,Frequency,...years`.
- Rows contain definition fields and raw per-year amounts only. Transactions contribute date-derived year columns only; no actual transaction field or row is serialized.
- Missing category IDs are emitted as IDs. Missing amounts are blank. Frequencies display as `Monthly`/`Yearly`.
- Text is RFC4180 escaped and formula-leading text is apostrophe-prefixed; numeric values, including negative amounts, are unchanged.
- `BudgetExpensesTab.tsx` builds from full state and shared categories, commits a focused name/amount edit first, and passes the result to `downloadCsvAsFile` as `expenses-YYYY-MM-DD.csv` using the click's local date. No import, persistence, encryption, or Drive path is involved.
