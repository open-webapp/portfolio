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
    Settings.tsx                # Drive-sync Connect/Disconnect/Sync Now/Restore
    import/
      ImportPositionsDialog.tsx
      ImportTransactionsDialog.tsx
      MappingProfileEditor.tsx
      AccountResolvePrompt.tsx   # first-seen-account name/category/retirement prompt
      index.ts
plans/                        # historical planning docs, superseded by this file
portfolio-dashboard-design/   # pixel-reference prototype (.dc.html) — not shipped code
csv/                           # sample/user CSV fixtures for manual testing
```

Each `src/lib/*.ts` has a colocated `*.test.ts` (vitest, one file per module).

## State management

Single `useReducer(appReducer, initialState())` in `App.tsx`. No Redux/Zustand/Context split.

- `src/lib/state.ts` — `AppState` interface (6 data collections + UI filter fields + transient import fields) and one pure `stateAction(state, ...): AppState` helper per mutation (`addAccount`, `updateAccount`, `deleteAccount`, `updatePosition`, `setCategory`, `setRange`, `setTab`, `setSort`, `toggleSort`, `setAssetClassFilter`, `setRetirementFilter`, `setPositionsSearch`, `setTransactionsSearch`, `setTransactionTypeFilter`, `toggleShowClosed`, `setPendingImport`, `setAccountPromptQueue`).
- `src/lib/reducer.ts` — `appReducer(state, action)` switches on `action.type` (string) and calls the matching `state.ts` helper, or the CRUD logic in `accounts.ts`/`positionsImport.ts`/`transactionsImport.ts`. `default: return state`. Special case `__SET_STATE` replaces the whole state (used by hydration).
- Components never mutate state directly; they `dispatch({ type: '...', ...payload })`.

### Action types (reducer.ts)

`__SET_STATE`, `ADD_ACCOUNT`, `UPDATE_ACCOUNT`, `DELETE_ACCOUNT`, `FINALIZE_NEW_ACCOUNT`, `UPDATE_POSITION`, `SET_ASSET_CLASS_OVERRIDE`, `SET_CATEGORY`, `SET_RANGE`, `SET_TAB`, `SET_SORT`, `TOGGLE_SORT`, `SET_ASSET_CLASS_FILTER`, `SET_RETIREMENT_FILTER`, `SET_POSITIONS_SEARCH`, `SET_TRANSACTIONS_SEARCH`, `SET_TRANSACTION_TYPE_FILTER`, `TOGGLE_SHOW_CLOSED`, `SET_PENDING_IMPORT`, `CLEAR_IMPORT_DIALOG`, `SET_ACCOUNT_PROMPT_QUEUE`, `IMPORT_POSITIONS`, `IMPORT_TRANSACTIONS`, `ADD_MAPPING_PROFILE`, `UPDATE_MAPPING_PROFILE`, `DELETE_MAPPING_PROFILE`.

## Component tree

```
App
  AccountResolvePrompt        (state, dispatch)      — renders null unless state.accountPromptQueue is non-empty
  Nav                          (state, dispatch)
  Settings                     (state, dispatch)      — Drive backup Connect/Disconnect/Sync Now/Restore
  SummaryCards                 (state)
  PerformanceChart             (state)
  AllocationChart              (state)
  [tab === 'positions']
    ImportPositionsDialog      (state, dispatch)
      MappingProfileEditor     (kind, csvHeaders, existingProfile?, onSave, onCancel)
    PositionsTable             (state, dispatch)
      AssetClassOverrideSelect (position, dispatch)  — per row
      ClosedPositionsTable     (state, dispatch)     — when state.showClosed
  [tab === 'transactions']
    ImportTransactionsDialog   (state, dispatch)
      MappingProfileEditor
    TransactionsTable          (state, dispatch)
```

Props convention: presentational components take `{ state: AppState, dispatch }`; a few (`AssetClassOverrideSelect`) take a narrower prop (`position`) plus `dispatch`. `dispatch` is typed `(action: any) => void` throughout — action payloads are not statically checked against `reducer.ts`'s cases.

## Data flow

**CSV import** (positions or transactions, same shape in both dialogs):
1. `ImportPositionsDialog`/`ImportTransactionsDialog` local state machine: `closed → file-picker → profile-select → profile-editor? → review → closed`.
2. `parseCsvFile(file)` (`csv.ts`) → `{ headers, rows }` (raw strings, Papa.parse).
3. User picks an existing `MappingProfile` (filtered by `kind` via `listProfilesForKind`) or creates one via `MappingProfileEditor` → `createProfile`/`updateProfile` → `validateProfile` → dispatched via `ADD_MAPPING_PROFILE`/`UPDATE_MAPPING_PROFILE`.
4. `applyMapping(row, profile)` renames each CSV row's headers to internal field names per `profile.fieldMap`.
5. Dialog dispatches `SET_PENDING_IMPORT` with `{ kind, rows: mappedRows, profileId }` and closes itself.

**Import processing** (`App.tsx` effect, keyed on `[state.pendingImport, state.mappingProfiles, state.accounts, isHydrated]`):
6. When `pendingImport` is set, an effect automatically:
   - Looks up the profile by `profileId` in state.
   - Groups rows by `resolveAccountNumber(row, profile)` (mapped account column); rows with no resolvable account number use `'__default_account__'` marker, triggering account resolution prompt.
   - For each distinct account number, resolves to an `accountId` via `findOrCreateAccountPrompt(state, accountNumber)` (existing account or `'needs-prompt'`).
   - If any account numbers come back `'needs-prompt'`, dispatches `SET_ACCOUNT_PROMPT_QUEUE` with `{accountNumber, profileId}` for each and returns *without* importing yet — `AccountResolvePrompt` then renders and blocks on the first queued entry.
   - Submitting `AccountResolvePrompt` dispatches `FINALIZE_NEW_ACCOUNT` (creating the account) then dequeues that entry via `SET_ACCOUNT_PROMPT_QUEUE`; the effect's `state.accounts` dependency re-triggers it, and previously-unresolvable account numbers now resolve. "Cancel Import" clears both the queue and `pendingImport`.
   - Once every account number resolves, calls `importPositions()` (replaces positions, creates closed positions, upserts snapshot) or `importTransactions()` (deduplicates, inserts) for each account.
   - Dispatches `__SET_STATE` to clear `pendingImport` from state and persist the new positions/transactions/snapshots.

**Persistence**: `App.tsx` calls `loadPersistedApp()` (`persist.ts`) once on mount via `dispatch({ type: '__SET_STATE', newState })`, gated by an `isHydrated` flag (renders "Loading dashboard..." until then). Every state change after hydration schedules `savePersistedApp(state)` 500ms later (debounced via `setTimeout` in a `useEffect`, cleared/reset on each state change).

**Drive sync**: `drive.ts` exports a `drive` singleton (`createDriveSync({ appId: 'portfolio', folderPath: ['OpenWebApp','Portfolio'] })`) plus `syncBackup(state)`/`restoreBackup()`/`connectDrive()`/`disconnectDrive()`/`getDriveConnection()`, all operating on `drive.project('app')`. `src/components/Settings.tsx` is a modal (opened via a "Settings" button, top-right of the main content area) wiring all five: shows the connected email (or "Not connected"), Connect/Disconnect, "Sync Now" (`syncBackup(state)`), and "Restore from Drive" (`restoreBackup()` → dispatches `__SET_STATE` on success). No conflict resolution — last-write-wins, by design (v1 simplification).

**Selectors** (`selectors.ts`) are the only place that reads+filters+sorts raw `AppState` collections for display; components call them instead of re-deriving:
- `visiblePositions(state)` — category → retirement filter → asset-class filter → search (symbol/name, case-insensitive) → `sortBy(state.sortKey, state.sortDir)`.
- `visibleTransactions(state)` — category filter → type filter → search (symbol/date) → always sorted by `date desc` (not user-sortable).
- `totalValueSeries(state, accountIds?)` — groups `PortfolioSnapshot[]` by `date`, sums `value`; defaults to accounts in the selected category if `accountIds` omitted.
- `totalValueSeriesInRange(state, range)` — `totalValueSeries(state)` filtered to a cutoff date derived from `range` (`'6m'`/`'1y'`/`'ytd'` compute a cutoff from `new Date()`; `'all'` or an unrecognized value returns the series unfiltered).
- `summaryCards(state)` — Total Value / Day Change / Total Gain-Loss / Cost Basis / Total Taxes Paid, computed live from `positions`/`transactions`/`totalValueSeries` (no stored placeholder).
- `allocationBars(state)` — wraps `computations.allocationByAssetClass`, respecting `assetClassManualOverride`.
- `totalTaxesPaid(state)` — sums `transaction.taxes` (null treated as 0) across the selected category's accounts.
- `performanceLinePoints(state, range)` — builds an SVG `points` string from `totalValueSeriesInRange(state, range)`, so the Nav's date-range select now actually changes what's plotted.

## Design patterns

- **Computed-not-stored**: `marketValue`/`costBasis`/`gl`/`glPct` are never persisted on `Position`; always derived via `computations.computePosition()`.
- **Category filter is compositional**: every selector re-derives "accounts in category" via a local `getAccountsForCategory`/inline filter rather than storing a filtered account list.
- **Effective asset class**: anywhere a position's asset class is displayed or grouped, code reads `p.assetClassManualOverride || p.assetClass`, never `p.assetClass` alone.
- **Natural-key upsert**: `positionsImport.ts` (snapshot) and `transactionsImport.ts` (transaction) both dedup by recomputing a string key and filtering pre-existing entries out before appending, rather than mutating in place.
- **Styling**: components use inline `style={{ ... }}` extensively alongside the design-system classes (`.card.blueprint.elev-sm`, `.tag`/`.tag-accent`, `.seg`/`.seg-opt`, `.table`, `.nav`, `.field`/`.input`) — this is a live deviation from the CLAUDE.md styling rule ("Components consume the existing class vocabulary ... rather than inline styles"); most layout/spacing (flex, gap, padding, modal positioning) is inline today, only the visual vocabulary (colors, card chrome, tags, table borders) comes from `styles.css` classes.

## Known gaps vs. plan (`plans/portfolio-dashboard-v1.md`)

None outstanding as of this revision — account resolution, Drive-sync Settings, and date-range filtering (previously listed here) are now wired up; see "Import processing" and the `totalValueSeriesInRange` selector above.
