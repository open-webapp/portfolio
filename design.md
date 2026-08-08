# Design — Ledger (Portfolio Dashboard)

See also: [product-behavior.md](product-behavior.md), [schema-spec.md](schema-spec.md)

## Stack

React 19.2 + TypeScript + Vite 8, no state library (single `useReducer`), no CSS framework, oxlint, vitest 4 + jsdom + fake-indexeddb + @testing-library/react. Dependency: `@open-webapp/drive-sync` for Google Drive backup, `papaparse` for CSV, `lucide-react` for icons.

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
    drive.ts                 # drive-sync singleton + syncBackup/restoreBackup
    csv.ts                    # Papa.parse wrapper: parseCsvFile
    mappingProfiles.ts        # profile CRUD + applyMapping + validateProfile
    accounts.ts               # account resolution / first-seen / finalizeNewAccount
    positionsImport.ts        # replace + closed-position diff + snapshot upsert
    transactionsImport.ts     # dedup-by-natural-key insert
    computations.ts           # computePosition, allocationByAssetClass, fmtUSD, fmtPct
    sort.ts                   # generic sortBy<T>
    selectors.ts               # visiblePositions/visibleTransactions/summaryCards/etc.
    seed.ts                    # uid(prefix)
  components/
    Nav.tsx                    # category tabs, retirement tags, range select
    SummaryCards.tsx
    PerformanceChart.tsx        # SVG polyline
    AllocationChart.tsx         # bar list
    PositionsTable.tsx
    ClosedPositionsTable.tsx
    TransactionsTable.tsx
    AssetClassOverrideSelect.tsx
    import/
      ImportDialog.tsx          # unified positions + transactions dialog
      MappingProfileEditor.tsx   # field mapping UI (reused by both import kinds)
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
  mappingProfiles: MappingProfile[]
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
  pendingImport?: { kind, profileId, rows, fileName }
}
```

- `src/lib/state.ts` — `AppState` interface (7 data collections + 8 UI filter fields) and one pure `stateAction(state, ...): AppState` helper per mutation (`addAccount`, `updateAccount`, `deleteAccount`, `updatePosition`, `deleteClosedPosition`, `setCategory`, `setRange`, `setTab`, `setSort`, `toggleSort`, `setAssetClassFilter`, `setRetirementFilter`, `setPositionsSearch`, `setTransactionsSearch`, `setTransactionTypeFilter`, `toggleShowClosed`, `addImportSession`, `deleteImportSession`).
- `src/lib/reducer.ts` — `appReducer(state, action)` switches on `action.type` (string) and calls the matching `state.ts` helper, or the CRUD logic in `accounts.ts`/`positionsImport.ts`/`transactionsImport.ts`. `default: return state`. Special case `__SET_STATE` replaces the whole state (used by hydration).
- Components never mutate state directly; they `dispatch({ type: '...', ...payload })`.

### Action types (reducer.ts)

`__SET_STATE`, `ADD_ACCOUNT`, `UPDATE_ACCOUNT`, `DELETE_ACCOUNT`, `UPDATE_POSITION`, `SET_ASSET_CLASS_OVERRIDE`, `DELETE_CLOSED_POSITION`, `SET_CATEGORY`, `SET_RANGE`, `SET_TAB`, `SET_SORT`, `TOGGLE_SORT`, `SET_ASSET_CLASS_FILTER`, `SET_RETIREMENT_FILTER`, `SET_POSITIONS_SEARCH`, `SET_TRANSACTIONS_SEARCH`, `SET_TRANSACTION_TYPE_FILTER`, `TOGGLE_SHOW_CLOSED`, `IMPORT_POSITIONS`, `IMPORT_TRANSACTIONS`, `ADD_MAPPING_PROFILE`, `UPDATE_MAPPING_PROFILE`, `DELETE_MAPPING_PROFILE`, `ADD_IMPORT_SESSION`, `DELETE_IMPORT_SESSION`, `SET_VIEW`.

## Component tree

```
App
  ImportDialog                (state, dispatch)  — rendered above all tabs
    MappingProfileEditor      (kind, csvHeaders, existingProfile?, onSave, onCancel)
  [view === 'dashboard']
    Nav                       (state, dispatch)
    SummaryCards              (state)
    PerformanceChart          (state)
    AllocationChart           (state)
    [tab === 'positions']
      PositionsTable          (state, dispatch)
        AssetClassOverrideSelect (position, dispatch)  — per row
        ClosedPositionsTable  (state, dispatch)       — when state.showClosed
    [tab === 'transactions']
      TransactionsTable       (state, dispatch)
  [view === 'settings']
    SettingsPage              (state, dispatch)  — Drive backup / Import Sessions table / Accounts list
```

Props convention: presentational components take `{ state: AppState, dispatch }`; a few (`AssetClassOverrideSelect`) take a narrower prop (`position`) plus `dispatch`. `dispatch` is typed `(action: any) => void` throughout — action payloads are not statically checked against `reducer.ts`'s cases.

## Data flow

**CSV import** — synchronous 4-step wizard within `ImportDialog` (positions or transactions):
1. **Pick account**: `ImportDialog` opens; user selects an `Account` (existing or creates new via inline form) or resolves new account number to account details.
2. **Map columns**: User selects existing `MappingProfile` (filtered by `kind`: 'positions' or 'transactions') or creates one via `MappingProfileEditor` → `createProfile`/`updateProfile` → `validateProfile` → `ADD_MAPPING_PROFILE`/`UPDATE_MAPPING_PROFILE` dispatched; `parseCsvFile(file)` (`csv.ts`) yields `{ headers, rows }`.
3. **Preview**: `applyMapping(row, profile)` renames each CSV row to internal field names; dialog displays matched columns and a preview table of transformed data.
4. **Commit**: User clicks "Import"; dialog calls `importPositions()` (replaces positions, creates closed positions, upserts snapshot) or `importTransactions()` (deduplicates, inserts) for the selected account and mapped rows, then dispatches `IMPORT_POSITIONS` or `IMPORT_TRANSACTIONS`, closes itself, and returns to tab view.
5. **Session logging** (`App.tsx` `pendingImport` effect): After state merge completes, `processPendingImport(state, pendingImport)` generates a fresh `ImportSession` (id via `uid('import')`), tags all newly-created rows with that `importSessionId`, logs the session (fileName, kind, accountIds, rowCount) to `state.importSessions`, and dispatches `ADD_IMPORT_SESSION`.

All steps are **synchronous**; no async queue beyond the debounce-save to IndexedDB.

**Persistence**: `App.tsx` calls `loadPersistedApp()` (`persist.ts`) once on mount via `dispatch({ type: '__SET_STATE', newState })`, gated by an `isHydrated` flag (renders "Loading dashboard..." until then). Every state change after hydration schedules `savePersistedApp(state)` 500ms later (debounced via `setTimeout` in a `useEffect`, cleared/reset on each state change).

**Drive sync**: `drive.ts` exports a `drive` singleton (`createDriveSync({ appId: 'portfolio', folderPath: ['OpenWebApp','Portfolio'] })`) plus `syncBackup(state)`/`restoreBackup()`, both operating on `drive.project('app')`. The `SettingsPage` component provides UI affordances to sync and disconnect.

**Selectors** (`selectors.ts`) are the only place that reads+filters+sorts raw `AppState` collections for display; components call them instead of re-deriving:
- `visiblePositions(state)` — category → retirement filter → asset-class filter → search (symbol/name, case-insensitive) → `sortBy(state.sortKey, state.sortDir)`.
- `visibleTransactions(state)` — category filter → type filter → search (symbol/date) → always sorted by `date desc` (not user-sortable).
- `totalValueSeries(state, accountIds?)` — groups `PortfolioSnapshot[]` by `date`, sums `value`; defaults to accounts in the selected category if `accountIds` omitted.
- `summaryCards(state)` — Total Value / Day Change / Total Gain-Loss / Cost Basis, computed live from `positions` and `totalValueSeries` (no stored placeholder).
- `allocationBars(state)` — wraps `computations.allocationByAssetClass`, respecting `assetClassManualOverride`.
- `performanceLinePoints(state, range)` — builds an SVG `points` string from `totalValueSeries`; `range` param is accepted but **not yet used to filter** the series (see product-behavior.md).

## Key Invariants

- **Import session tagging**: Every `Position`, `ClosedPosition`, `Transaction`, and `PortfolioSnapshot` carries an `importSessionId` field linking it back to the `ImportSession` that created it. This enables session-based deletion and audit trails.
- **Forward-only session deletion**: `DeleteImportSession` removes the session record but does NOT recursively delete its tagged rows (data remains orphaned, unlinked to any session). This preserves imported data while allowing session metadata cleanup.
- **Account cascade delete**: Deleting an `Account` cascade-deletes all its `Position`s, `ClosedPosition`s, `Transaction`s, `PortfolioSnapshot`s, and `ImportSession`s (those with the account in `importSession.accountIds`).

## Design patterns

- **Computed-not-stored**: `marketValue`/`costBasis`/`gl`/`glPct` are never persisted on `Position`; always derived via `computations.computePosition()`.
- **Category filter is compositional**: every selector re-derives "accounts in category" via a local `getAccountsForCategory`/inline filter rather than storing a filtered account list.
- **Effective asset class**: anywhere a position's asset class is displayed or grouped, code reads `p.assetClassManualOverride || p.assetClass`, never `p.assetClass` alone.
- **Natural-key upsert**: `positionsImport.ts` (snapshot) and `transactionsImport.ts` (transaction) both dedup by recomputing a string key and filtering pre-existing entries out before appending, rather than mutating in place.
- **Styling**: components use inline `style={{ ... }}` extensively alongside the design-system classes (`.card.blueprint.elev-sm`, `.tag`/`.tag-accent`, `.seg`/`.seg-opt`, `.table`, `.nav`, `.field`/`.input`) — this is a live deviation from the CLAUDE.md styling rule ("Components consume the existing class vocabulary ... rather than inline styles"); most layout/spacing (flex, gap, padding, modal positioning) is inline today, only the visual vocabulary (colors, card chrome, tags, table borders) comes from `styles.css` classes.

## Known gaps vs. plan (`plans/portfolio-dashboard-v1.md`)

- `performanceLinePoints` ignores the `range` argument — the Performance chart always plots the full snapshot history regardless of the Nav's date-range select.
