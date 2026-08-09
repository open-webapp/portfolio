# Design — Ledger (Portfolio Dashboard)

See also: [product-behavior.md](product-behavior.md), [schema-spec.md](schema-spec.md)

## Stack

React 19.2 + TypeScript + Vite 8, no state library (single `useReducer`), no CSS framework, oxlint, vitest 4 + jsdom + fake-indexeddb + @testing-library/react. Dependency: `@open-webapp/drive-sync` for Google Drive backup, `papaparse` for CSV, `lucide-react` for icons. Published to GitHub Pages at `/portfolio/` via `.github/workflows/deploy.yml` (auto-triggers on push to `main`, builds `dist` and deploys with `actions/deploy-pages`); `vite.config.ts` sets `base: '/portfolio/'` to match the repo's Pages path.

## Directory structure

```
src/
  main.tsx                  # entry, imports styles/styles.css once
  App.tsx                   # top-level: useReducer, hydrate, debounce-save, layout
  App.css
  styles/styles.css         # design tokens, byte-identical port of design bundle
  lib/
    types.ts                # domain types + required-field const arrays
    state.ts                # AppState interface, initialState(), pure action-helper fns
    reducer.ts               # appReducer(state, action) dispatch table
    persist.ts               # IndexedDB load/save (single blob)
    drive.ts                 # drive-sync singleton + syncBackup/restoreBackup/getBackupFileId
    csv.ts                    # Papa.parse wrapper: parseCsvFile, parseCsvNumber
    accounts.ts               # empty stub retained for future use
    positionsImport.ts        # replace + closed-position diff + snapshot upsert
    transactionsImport.ts     # dedup-by-natural-key insert
    computations.ts           # computePosition, allocationByAssetClass, fmtUSD, fmtPct
    sort.ts                   # generic sortBy<T>
    selectors.ts               # visiblePositions/visibleTransactions/summaryCards/etc.
    importPreview.ts           # applyFieldMap / validatePreviewRow / isBlankRow / isReviewValid
    seed.ts                    # uid(prefix)
  components/
    Nav.tsx                    # nav-brand, category seg tabs, range select, settings gear
    SummaryCards.tsx
    PerformanceChart.tsx        # SVG polyline
    AllocationChart.tsx         # bar list
    PositionsTable.tsx
    ClosedPositionsTable.tsx
    TransactionsTable.tsx
    AssetClassOverrideSelect.tsx
    Settings.tsx                  # 2 tabs via .seg (local activeTab): General (Accounts + Google Drive Sync) / Import Sessions
    import/
      ImportDialog.tsx          # 2-step positions/transactions import wizard (Setup → Review)
      index.ts
plans/                        # historical planning docs, superseded by this file
portfolio-dashboard-design/   # pixel-reference prototype (.dc.html) — not shipped code
csv/                           # sample/user CSV fixtures for manual testing
```

Each `src/lib/*.ts` has a colocated `*.test.ts` (vitest, one file per module).

## State management

Single `useReducer(appReducer, initialState())` in `App.tsx`. No Redux/Zustand/Context split.

### AppState interface

```ts
interface AppState {
  // Data collections (6)
  accounts: Account[]
  positions: Position[]
  closedPositions: ClosedPosition[]
  transactions: Transaction[]
  snapshots: PortfolioSnapshot[]
  importSessions: ImportSession[]

  // UI state
  category: TaxCategory | 'all'
  range: string  // '6m' | '1y' | 'ytd' | 'all'
  tab: 'positions' | 'transactions'
  view: 'dashboard' | 'settings'
  sortKey: keyof Position
  sortDir: 'asc' | 'desc'
  assetClassFilter: string
  retirementFilter: 'All' | 'Retirement' | 'Non-Retirement'
  posSearch: string
  txTypeFilter: string
  txSearch: string
  showClosed: boolean
}
```

- `src/lib/state.ts` — `AppState` interface (6 data collections + 12 UI fields) and one pure helper per mutation (`addAccount`, `updateAccount`, `deleteAccount`, `updatePosition`, `deleteClosedPosition`, `setCategory`, `setRange`, `setTab`, `setSort`, `toggleSort`, `setAssetClassFilter`, `setRetirementFilter`, `setPositionsSearch`, `setTransactionsSearch`, `setTransactionTypeFilter`, `toggleShowClosed`, `addImportSession`, `deleteImportSession`).
- `src/lib/reducer.ts` — `appReducer(state, action)` switches on `action.type` (string) and calls the matching `state.ts` helper, or the import logic in `positionsImport.ts`/`transactionsImport.ts`. `default: return state`. Special case `__SET_STATE` replaces the whole state (used by hydration).
- Components never mutate state directly; they `dispatch({ type: '...', ...payload })`.

### Action types (reducer.ts)

`__SET_STATE`, `ADD_ACCOUNT`, `UPDATE_ACCOUNT`, `DELETE_ACCOUNT`, `UPDATE_POSITION`, `SET_ASSET_CLASS_OVERRIDE`, `DELETE_CLOSED_POSITION`, `SET_CATEGORY`, `SET_RANGE`, `SET_TAB`, `SET_SORT`, `TOGGLE_SORT`, `SET_ASSET_CLASS_FILTER`, `SET_RETIREMENT_FILTER`, `SET_POSITIONS_SEARCH`, `SET_TRANSACTIONS_SEARCH`, `SET_TRANSACTION_TYPE_FILTER`, `TOGGLE_SHOW_CLOSED`, `IMPORT_POSITIONS`, `IMPORT_TRANSACTIONS`, `ADD_IMPORT_SESSION`, `DELETE_IMPORT_SESSION`, `SET_VIEW`.

## Component tree

```
App
  [view === 'dashboard']
    Nav                       (state, dispatch)  — nav-brand 'Ledger' + category seg tabs + range select + settings gear
    portfolio header row      (inline in App)    — kicker 'Portfolio' + <h1>Ledger</h1> + retirement .tag pills
    SummaryCards              (state)            — all cards in one row of 5 equal columns (.card.blueprint.elev-sm), sized to fit
    charts row                (inline in App)    — grid 2fr 1fr (Performance wider than Allocation)
      PerformanceChart        (state)
      AllocationChart         (state)
    tabs row                  (inline in App)    — flex space-between: Positions/Transactions .seg + Import CSV trigger
      ImportDialog            (state, dispatch)  — renders the trigger button; open state is component-local (isOpen)
    [tab === 'positions']
      PositionsTable          (state, dispatch)
        AssetClassOverrideSelect (position, dispatch)  — per row
        ClosedPositionsTable    (state, dispatch)       — when state.showClosed
    [tab === 'transactions']
      TransactionsTable       (state, dispatch)
  [view === 'settings']
    SettingsPage              (state, dispatch)  — 2 tabs via `.seg` (activeTab is local `useState`, not in AppState): General (Accounts then Google Drive Sync) / Import Sessions
```

Props convention: presentational components take `{ state: AppState, dispatch }`; a few (`AssetClassOverrideSelect`) take a narrower prop (`position`) plus `dispatch`. `dispatch` is typed `(action: any) => void` throughout — action payloads are not statically checked against `reducer.ts`'s cases.

## Data flow

**CSV import** — synchronous 2-step wizard inside `ImportDialog` (positions or transactions). Dialog-open state is component-local (`isOpen`), not in `AppState`.
1. **Setup** (`step === 1`): pick data type (`.seg`: Transactions / Positions — default Positions), destination account (existing `<select>` or new-account form: name, number, category, retirement checkbox), and a `.csv` file — `parseCsvFile` (`csv.ts`) yields `{ headers, rows }` immediately. Continue (enabled once the account is resolved and ≥1 row parsed) advances to Review.
2. **Review** (`step === 2`): `headers` drive one mapping `<select>` per field — `{ csvColumn: targetField }`, values are internal field names — in required-then-optional order; **exception: Asset Class (positions only) is a free-text `<input>` that broadcasts its value to all rows not yet touched in their own assetClass cell; once a row's cell is edited, that row becomes "touched" and no longer receives broadcasts**; `applyFieldMap(row, fieldMap)` renames each CSV row to internal field names; `<input>` cells overlay user edits (`importEdits[rowIdx]`); `validatePreviewRow(dataType, row)` flags required-missing cells (honoring avgCost/purchaseAmount and price/marketValue alternatives; fully-empty rows return valid and are skipped at commit via `isBlankRow`, so trailing blank CSV lines never block import); `isReviewValid(dataType, fieldMap)` gates the primary button. Each row has a leading trash-icon button (`handleDeleteRow(rowIdx)`) that removes it from `csvRows` and re-keys `importEdits` (indices shift down); the primary button also disables when `previewRows.length === 0`. `applyFieldMap`/`validatePreviewRow`/`isBlankRow`/`isReviewValid` come from `importPreview.ts`.
3. **Commit**: primary button dispatches `ADD_ACCOUNT` first when new-account mode (capturing the new account id), then `IMPORT_POSITIONS` (replaces positions, creates closed positions, upserts snapshot) or `IMPORT_TRANSACTIONS` (dedups, inserts) with `accountId`, the valid user-edited rows (blank rows excluded), and a fresh `uid('import')` `importSessionId` tagging every created row. "Import complete" renders in the same step-2 slot; "Done" closes and resets local state.
4. **Session logging**: `processPendingImport(state, kind, fileName, importSessionId, affectedAccountIds)` (App.tsx, exported pure helper, covered by App.test.tsx) counts rows tagged with `importSessionId`, builds an `ImportSession`, and prepends it via `addImportSession` (capped at 50, newest-first).

All steps are **synchronous**; no async queue beyond the debounce-save to IndexedDB.

**Persistence**: `App.tsx` calls `loadPersistedApp()` (`persist.ts`) once on mount via `dispatch({ type: '__SET_STATE', newState })`, gated by an `isHydrated` flag (renders "Loading dashboard..." until then). Every state change after hydration schedules `savePersistedApp(state)` 500ms later (debounced via `setTimeout` in a `useEffect`, cleared/reset on each state change). A separate effect flushes the pending save on `pagehide`, `visibilitychange → hidden`, and unmount (via a ref holding the latest state) so a refresh/reload within the debounce window never loses the newest state (e.g. a just-finished import). `savePersistedApp` rethrows IndexedDB open/write failures so callers' `.catch` fires (no silent success).

**Drive sync**: `drive.ts` exports a `drive` singleton (`createDriveSync({ appId: 'portfolio', folderPath: ['OpenWebApp','Portfolio'] })`) plus `syncBackup(state)` (resolves with the written file id)/`restoreBackup()`/`getBackupFileId()` (resolves the existing backup file id or null)/`getDriveAuthStatus()` (non-interactive auth snapshot `{ connected, email, expiresAt, needsReauth, tokenValid }`), all operating on `drive.project('app')`. **Token validation & reauth**: `syncBackup`/`restoreBackup` first call internal `ensureFreshConnection()` — a cached token is reused as-is while valid (connection exists, scopes complete, `expiresAt` > now + 5-min buffer), otherwise the interactive `connectDrive()` flow runs. A module-level in-flight guard guarantees at most one Google auth window even under concurrent sync/restore calls. `getBackupFileId()` is a passive probe (called on page load) and never prompts: an expired/missing token resolves `null` (catching `NeedsReauthError`) instead of opening auth. The `SettingsPage` component provides UI affordances to sync/disconnect and renders a "View backup in Google Drive" link (built as `https://drive.google.com/file/d/{fileId}/view`) when connected and a backup file exists (`backupFileId` component-local state, set on mount/connect/sync, cleared on disconnect). Requires `VITE_GOOGLE_CLIENT_ID` in `.env` (repo root, tracked in git) or OAuth connect fails (`token.ts` sends `client_id: undefined`); pinned by a test in `drive.test.ts`.

**Selectors** (`selectors.ts`) are the only place that reads+filters+sorts raw `AppState` collections for display; components call them instead of re-deriving:
- `visiblePositions(state)` — category → retirement filter → asset-class filter → search (symbol/name, case-insensitive) → `sortBy(state.sortKey, state.sortDir)`.
- `visibleTransactions(state)` — category filter → type filter → search (symbol/date) → always sorted by `date desc` (not user-sortable).
- `totalValueSeries(state, accountIds?)` — groups `PortfolioSnapshot[]` by `date`, sums `value`; defaults to accounts in the selected category if `accountIds` omitted.
- `totalValueSeriesInRange(state, range)` — drops series points before a cutoff derived from `range` (`6m`/`1y`/`ytd`/`all`).
- `summaryCards(state)` — Total Value / Day Change / Total Gain-Loss / Amount Invested / Total Taxes Paid, computed live from `positions` and `totalValueSeries` (no stored placeholder).
- `allocationBars(state)` — wraps `computations.allocationByAssetClass`, respecting `assetClassManualOverride`.
- `performanceLinePoints(state, range)` — builds an SVG `points` string from `totalValueSeriesInRange(state, range)`; a single-point series renders centered.

## Key Invariants

- **Import session tagging**: Every `Position`, `ClosedPosition`, `Transaction`, and `PortfolioSnapshot` carries an `importSessionId` field linking it back to the `ImportSession` that created it. This enables session-based deletion and audit trails.
- **Session cascade delete**: `DELETE_IMPORT_SESSION` removes the session record AND all rows tagged with its `importSessionId` (positions, closed positions, transactions, snapshots). The Settings delete dialog states the row count that will be removed.
- **Account cascade delete**: Deleting an `Account` cascade-deletes all its `Position`s, `ClosedPosition`s, `Transaction`s, `PortfolioSnapshot`s, and `ImportSession`s (those with the account in `importSession.accountIds`).

## Design patterns

- **Computed-not-stored**: `marketValue`/`costBasis`/`gl`/`glPct` are never persisted on `Position`; always derived via `computations.computePosition()`.
- **Category filter is compositional**: every selector re-derives "accounts in category" via a local `getAccountsForCategory`/inline filter rather than storing a filtered account list.
- **Effective asset class**: anywhere a position's asset class is displayed or grouped, code reads `p.assetClassManualOverride || p.assetClass`, never `p.assetClass` alone.
- **Natural-key upsert**: `positionsImport.ts` (snapshot) and `transactionsImport.ts` (transaction) both dedup by recomputing a string key and filtering pre-existing entries out before appending, rather than mutating in place.
- **Styling**: components use inline `style={{ ... }}` extensively alongside the design-system classes (`.card.blueprint.elev-sm`, `.tag`/`.tag-accent`, `.seg`/`.seg-opt`, `.table`, `.nav`, `.field`/`.input`, `.dialog-backdrop`/`.dialog`) — this is a live deviation from the CLAUDE.md styling rule ("Components consume the existing class vocabulary ... rather than inline styles"); most layout/spacing (flex, gap, padding, modal positioning) is inline today, only the visual vocabulary (colors, card chrome, tags, table borders) comes from `styles.css` classes.
