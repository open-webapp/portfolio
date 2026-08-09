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
    PositionGroupOverlay.tsx    # dialog for viewing positions in an aggregated group
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
  // Data collections (7)
  accounts: Account[]
  positions: Position[]
  closedPositions: ClosedPosition[]
  transactions: Transaction[]
  snapshots: PortfolioSnapshot[]
  importSessions: ImportSession[]
  csvMappings: SavedCsvMapping[]

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

- `src/lib/state.ts` — `AppState` interface (7 data collections + 12 UI fields) and one pure helper per mutation (`addAccount`, `updateAccount`, `deleteAccount`, `updatePosition`, `deleteClosedPosition`, `setCategory`, `setRange`, `setTab`, `setSort`, `toggleSort`, `setAssetClassFilter`, `setRetirementFilter`, `setPositionsSearch`, `setTransactionsSearch`, `setTransactionTypeFilter`, `toggleShowClosed`, `addImportSession`, `deleteImportSession`, `upsertCsvMapping`).
- `src/lib/reducer.ts` — `appReducer(state, action)` switches on `action.type` (string) and calls the matching `state.ts` helper, or the import logic in `positionsImport.ts`/`transactionsImport.ts`. `default: return state`. Special case `__SET_STATE` replaces the whole state (used by hydration).
- Components never mutate state directly; they `dispatch({ type: '...', ...payload })`.

### Action types (reducer.ts)

`__SET_STATE`, `ADD_ACCOUNT`, `UPDATE_ACCOUNT`, `DELETE_ACCOUNT`, `UPDATE_POSITION`, `SET_ASSET_CLASS_OVERRIDE`, `DELETE_CLOSED_POSITION`, `SET_CATEGORY`, `SET_RANGE`, `SET_TAB`, `SET_SORT`, `TOGGLE_SORT`, `SET_ASSET_CLASS_FILTER`, `SET_RETIREMENT_FILTER`, `SET_POSITIONS_SEARCH`, `SET_TRANSACTIONS_SEARCH`, `SET_TRANSACTION_TYPE_FILTER`, `TOGGLE_SHOW_CLOSED`, `IMPORT_POSITIONS`, `IMPORT_TRANSACTIONS`, `ADD_IMPORT_SESSION`, `DELETE_IMPORT_SESSION`, `UPSERT_CSV_MAPPING`, `SET_VIEW`.

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
    tabs row                  (inline in App)    — flex space-between: Positions/Transactions .seg + Import trigger
      ImportDialog            (state, dispatch)  — renders the trigger button; open state is component-local (isOpen)
    [tab === 'positions']
      PositionsTable          (state, dispatch)  — groups visiblePositions() into aggregate rows (symbol+effectiveAssetClass+taxCategory+retirement); selectedGroupKey is component-local useState
        ClosedPositionsTable    (state, dispatch)       — when state.showClosed
      PositionGroupOverlay    (group, accounts, dispatch, onClose)  — when a row is clicked; lists underlying positions sorted by account name. Cells for shares, avgCost (Cost Basis), price (Current Price), and taxes (new Taxes column) are independently click-to-edit: click → `<input type="number">` pre-filled with current value → Enter or blur commits via `UPDATE_POSITION` dispatch (patch `{ [field]: parsed number }`), Escape cancels/reverts (no dispatch). Invalid input (negative, non-numeric, or empty) on shares/avgCost/price reverts silently; empty taxes saves as 0 (exception). Computed columns (Amount Invested, Market Value, G/L, G/L%) remain read-only text. No new props added (still `{ group, accounts, dispatch, onClose }`).
        AssetClassOverrideSelect (position, dispatch)  — per underlying position, inside the overlay
    [tab === 'transactions']
      TransactionsTable       (state, dispatch)
  [view === 'settings']
    SettingsPage              (state, dispatch)  — 2 tabs via `.seg` (activeTab is local `useState`, not in AppState): General (Accounts then Google Drive Sync) / Import Sessions
```

Props convention: presentational components take `{ state: AppState, dispatch }`; a few take narrower props (`AssetClassOverrideSelect`: `position` + `dispatch`; `PositionGroupOverlay`: `group`, `accounts`, `dispatch`, `onClose`). `dispatch` is typed `(action: any) => void` throughout — action payloads are not statically checked against `reducer.ts`'s cases.

## Data flow

**CSV import** — synchronous 2-step wizard inside `ImportDialog` (positions or transactions). Dialog-open state is component-local (`isOpen`), not in `AppState`.
1. **Setup** (`step === 1`): pick data type (`.seg`: Transactions / Positions — default Positions), destination account (existing `<select>` or new-account form: name, number, category, retirement checkbox), and entry mode for positions (`upload`/`manual`, default `upload`). Upload mode uses `.csv` file parsing (`parseCsvFile` from `csv.ts` -> `{ headers, rows }`). Continue requires account resolution; upload mode additionally requires ≥1 parsed row, manual mode does not.
2. **Review** (`step === 2`):
   - Upload mode: `headers` drive one mapping `<select>` per non-asset-class field (`{ csvColumn: targetField }`, required then optional).
   - Manual positions mode: entering Step 2 seeds exactly 10 blank rows and renders no mapping selects for non-asset-class fields.
   - Positions `Asset Class` header is always a free-text `<input>` that broadcasts to rows not yet touched in their own `assetClass` cell.
   - Existing-account mapping prefill applies only in upload mode (`csvMappings` filtered to headers present in current file).
   - `applyFieldMap(row, fieldMap)` + `importEdits[rowIdx]` produce editable rows; `validatePreviewRow` handles required-field validation (with avgCost/purchaseAmount and price/marketValue alternatives). Fully-empty rows are valid and excluded at commit via `isBlankRow`.
   - Primary button gating: upload mode includes `isReviewValid(dataType, fieldMap)`; manual mode bypasses `isReviewValid` and additionally requires at least one valid non-blank row.
   - Row delete (`handleDeleteRow`) removes row + re-keys row-indexed edits/touched state.
3. **Commit**: primary button dispatches `ADD_ACCOUNT` first when new-account mode (capturing the new account id), then `IMPORT_POSITIONS` or `IMPORT_TRANSACTIONS` with `accountId`, valid non-blank edited rows, and fresh `uid('import')` `importSessionId` tagging every created row. `UPSERT_CSV_MAPPING` runs only in upload mode. "Import complete" renders in the same step-2 slot; "Done" closes and resets local state.
4. **Session logging**: `processPendingImport(state, kind, fileName, importSessionId, affectedAccountIds)` (App.tsx, exported pure helper, covered by App.test.tsx) counts rows tagged with `importSessionId`, builds an `ImportSession`, and prepends it via `addImportSession` (capped at 50, newest-first).

All steps are **synchronous**; no async queue beyond the debounce-save to IndexedDB.

**Persistence**: `App.tsx` calls `loadPersistedApp()` (`persist.ts`) once on mount via `dispatch({ type: '__SET_STATE', newState })`, gated by an `isHydrated` flag (renders "Loading dashboard..." until then). Every state change after hydration schedules `savePersistedApp(state)` 500ms later (debounced via `setTimeout` in a `useEffect`, cleared/reset on each state change). A separate effect flushes the pending save on `pagehide`, `visibilitychange → hidden`, and unmount (via a ref holding the latest state) so a refresh/reload within the debounce window never loses the newest state (e.g. a just-finished import). `savePersistedApp` rethrows IndexedDB open/write failures so callers' `.catch` fires (no silent success).

**Drive sync**: `drive.ts` exports a `drive` singleton (`createDriveSync({ appId: 'portfolio', folderPath: ['OpenWebApp','Portfolio'] })`) plus `syncBackup(state)` (resolves with the written file id)/`restoreBackup()`/`getBackupFileId()` (resolves the existing backup file id or null)/`getDriveAuthStatus()` (non-interactive auth snapshot `{ connected, email, expiresAt, needsReauth, tokenValid }`), all operating on `drive.project('app')`. **Token validation & reauth**: `syncBackup`/`restoreBackup` first call internal `ensureFreshConnection()` — a cached token is reused as-is while valid (connection exists, scopes complete, `expiresAt` > now + 5-min buffer), otherwise the interactive `connectDrive()` flow runs. A module-level in-flight guard guarantees at most one Google auth window even under concurrent sync/restore calls. `getBackupFileId()` is a passive probe (called on page load) and never prompts: an expired/missing token resolves `null` (catching `NeedsReauthError`) instead of opening auth. The `SettingsPage` component provides UI affordances to sync/disconnect and renders a "View backup in Google Drive" link (built as `https://drive.google.com/file/d/{fileId}/view`) when connected and a backup file exists (`backupFileId` component-local state, set on mount/connect/sync, cleared on disconnect). Requires `VITE_GOOGLE_CLIENT_ID` in `.env` (repo root, tracked in git) or OAuth connect fails (`token.ts` sends `client_id: undefined`); pinned by a test in `drive.test.ts`.

**Selectors** (`selectors.ts`) are the only place that reads+filters+sorts raw `AppState` collections for display; components call them instead of re-deriving:
- `visiblePositions(state)` — category → retirement filter → asset-class filter → search (symbol/name, case-insensitive) → `sortBy(state.sortKey, state.sortDir)`. (`PositionsTable` then groups its output client-side into aggregate rows by symbol+effectiveAssetClass+taxCategory+retirement and sorts those aggregate rows by `state.sortKey`/`sortDir`; grouping/sorting-of-aggregates is component-level, not in selectors.)
- `visibleTransactions(state)` — category filter → type filter → search (symbol/date) → always sorted by `date desc` (not user-sortable).
- `totalValueSeries(state, accountIds?)` — groups `PortfolioSnapshot[]` by `date`, sums `value`; defaults to accounts in the selected category if `accountIds` omitted.
- `totalValueSeriesInRange(state, range)` — drops series points before a cutoff derived from `range` (`6m`/`1y`/`ytd`/`all`).
- `summaryCards(state)` — Total Value / Day Change / Total Gain-Loss / Amount Invested / Total Taxes Paid, computed live from `positions` and `totalValueSeries` (no stored placeholder).
- `allocationBars(state)` — wraps `computations.allocationByAssetClass`, respecting `assetClassManualOverride`.
- `performanceLinePoints(state, range)` — builds an SVG `points` string from `totalValueSeriesInRange(state, range)`; a single-point series renders centered.

## Key Invariants

- **Import session tagging**: Every `Position`, `ClosedPosition`, `Transaction`, and `PortfolioSnapshot` carries an `importSessionId` field linking it back to the `ImportSession` that created it. This enables session-based deletion and audit trails.
- **Session cascade delete**: `DELETE_IMPORT_SESSION` removes the session record AND all rows tagged with its `importSessionId` (positions, closed positions, transactions, snapshots). The Settings delete dialog states the row count that will be removed.
- **Account cascade delete**: Deleting an `Account` cascade-deletes all its `Position`s, `ClosedPosition`s, `Transaction`s, `PortfolioSnapshot`s, `SavedCsvMapping`s, and `ImportSession`s (those with the account in `importSession.accountIds`).

## Design patterns

- **Computed-not-stored**: `marketValue`/`costBasis`/`gl`/`glPct` are never persisted on `Position`; always derived via `computations.computePosition()`.
- **Category filter is compositional**: every selector re-derives "accounts in category" via a local `getAccountsForCategory`/inline filter rather than storing a filtered account list.
- **Effective asset class**: anywhere a position's asset class is displayed or grouped, code reads `p.assetClassManualOverride || p.assetClass`, never `p.assetClass` alone.
- **Natural-key upsert**: `positionsImport.ts` (snapshot) and `transactionsImport.ts` (transaction) both dedup by recomputing a string key and filtering pre-existing entries out before appending, rather than mutating in place.
- **Styling**: components use inline `style={{ ... }}` extensively alongside the design-system classes (`.card.blueprint.elev-sm`, `.tag`/`.tag-accent`, `.seg`/`.seg-opt`, `.table`, `.nav`, `.field`/`.input`, `.dialog-backdrop`/`.dialog`) — this is a live deviation from the CLAUDE.md styling rule ("Components consume the existing class vocabulary ... rather than inline styles"); most layout/spacing (flex, gap, padding, modal positioning) is inline today, only the visual vocabulary (colors, card chrome, tags, table borders) comes from `styles.css` classes.
