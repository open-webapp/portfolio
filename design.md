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
    crypto.ts                # EncryptedEnvelope shape, PBKDF2 key derivation, AES-GCM encrypt/decrypt, envelope-shape detection
    persist.ts               # IndexedDB load/save of the encrypted envelope (single blob)
    drive.ts                 # drive-sync singleton + syncBackup/restoreBackup/restoreBackupFromFileId/getBackupFileId/pickDriveFile, DriveDecryptError
    csv.ts                    # Papa.parse wrapper: parseCsvFile, parseCsvNumber
    accounts.ts               # empty stub retained for future use
    positionsImport.ts        # replace/merge mode + closed-position diff + snapshot upsert
    transactionsImport.ts     # dedup-by-natural-key insert
    computations.ts           # computePosition, allocationByAssetClass, fmtUSD, fmtPct
    sort.ts                   # generic sortBy<T>
    selectors.ts               # visiblePositions/visibleTransactions/summaryCards/etc.
    importPreview.ts           # applyFieldMap / validatePreviewRow / isBlankRow / isReviewValid
    seed.ts                    # uid(prefix)
    pastedTable.ts              # tableToCsv(headersClipboard, valuesClipboard): clipboard-paste → CSV/rows/headers parser, used by ImportDialog's Copy-Paste entry mode
  components/
    PasswordGate.tsx           # full-replacement gate screen: set-password (first-run/legacy-migrate) or enter-password (returning encrypted), reset-app escape hatch
    Nav.tsx                    # nav-brand, Dashboard/Accounts seg tabs, SVG sync/gear icons
    AccountsPage.tsx           # 2-column layout with collapsible category cards and allocation chart; row click opens PositionGroupOverlay
    OverviewCard.tsx           # 2-segment card (Retirement/Non-Retirement, showing total value + GL tag)
    AllocationChart.tsx         # asset allocation bar list (positions, title); reused on Dashboard and Accounts page
    PositionsTable.tsx
    PositionGroupOverlay.tsx    # dialog overlay: displays positions from a caller-supplied list with editable fields and inline account/symbol/shares/price cells
    ClosedPositionsTable.tsx
    TransactionsTable.tsx
    AssetClassOverrideSelect.tsx
    InstitutionSelect.tsx                       # { value: string, accounts: Account[], onChange: (value: string) => void } — seeded list ∪ in-use values with free-type "Add X" affordance
    Settings.tsx                  # single page, no tabs: Google Drive Sync + cross-password restore prompt, Change Password
    import/
      ImportDialog.tsx          # 2-step positions/transactions import wizard (Setup → Review); 3 entry modes for positions: upload/paste/manual
      index.ts
plans/                        # historical planning docs, superseded by this file
portfolio-dashboard-design/   # pixel-reference prototype (.dc.html) — not shipped code
csv/                           # sample/user CSV fixtures for manual testing
pastedTable.js                 # hand-mirrored classic-script copy of src/lib/pastedTable.ts, no build step, window.PastedTable.tableToCsv, file://-runnable
test1.html                     # dev harness for pastedTable.js (two paste zones → live table preview + CSV textarea), not shipped UI, file://-runnable
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
  csvMappings: SavedCsvMapping[]

  // UI state
  category: TaxCategory | 'all'
  view: 'dashboard' | 'settings' | 'accounts'
  sortKey: keyof Position
  sortDir: 'asc' | 'desc'
  assetClassFilter: string
  posSearch: string
  txTypeFilter: string
  txSearch: string
  showClosed: boolean
  selectedAccountId: string | null
  expandedCategories: Record<string, boolean>
  acctAssetClassFilter: string
  acctPosSearch: string
}
```

- `src/lib/state.ts` — `AppState` interface (6 data collections + 14 UI fields) and one pure helper per mutation (`addAccount`, `updateAccount`, `deleteAccount`, `updatePosition`, `closePosition`, `deleteClosedPosition`, `setCategory`, `setTab`, `setSort`, `toggleSort`, `setAssetClassFilter`, `setPositionsSearch`, `setTransactionsSearch`, `setTransactionTypeFilter`, `toggleShowClosed`, `upsertCsvMapping`, `selectAccount`, `toggleCategoryExpanded`, `setAcctAssetClassFilter`, `setAcctPosSearch`).
- `src/lib/reducer.ts` — `appReducer(state, action)` switches on `action.type` (string) and calls the matching `state.ts` helper, or the import logic in `positionsImport.ts`/`transactionsImport.ts`. `default: return state`. Special case `__SET_STATE` replaces the whole state (used by hydration).
- Components never mutate state directly; they `dispatch({ type: '...', ...payload })`.

### Action types (reducer.ts)

`__SET_STATE`, `ADD_ACCOUNT`, `UPDATE_ACCOUNT`, `DELETE_ACCOUNT`, `UPDATE_POSITION`, `CLOSE_POSITION`, `SET_ASSET_CLASS_OVERRIDE`, `DELETE_CLOSED_POSITION`, `SET_CATEGORY`, `SET_TAB`, `SET_SORT`, `TOGGLE_SORT`, `SET_ASSET_CLASS_FILTER`, `SET_POSITIONS_SEARCH`, `SET_TRANSACTIONS_SEARCH`, `SET_TRANSACTION_TYPE_FILTER`, `TOGGLE_SHOW_CLOSED`, `IMPORT_POSITIONS`, `IMPORT_TRANSACTIONS`, `UPSERT_CSV_MAPPING`, `SET_VIEW`, `SELECT_ACCOUNT`, `TOGGLE_CATEGORY_EXPANDED`, `SET_ACCT_ASSET_CLASS_FILTER`, `SET_ACCT_POS_SEARCH`.

## Component tree

```
App
  [gateShape === null]         — "Loading dashboard..." while peekEnvelopeShape() resolves
  [sessionKey === null]
    PasswordGate               (shape, onUnlock, onReset) — replaces the entire tree below until unlocked
  [sessionKey set, !isHydrated] — "Loading dashboard..." (brief, between onUnlock and hydration dispatch)
  Nav                         (state, dispatch, driveReady, syncing, handleSync, onOpenSettings)  — renders on both dashboard and settings views. nav-brand 'Ledger' + always-rendered `.seg` with "Dashboard" and "Accounts" tabs (active state per `state.view`, neither tab active when `state.view === 'settings'`), each `onClick` dispatches `SET_VIEW` + conditional sync-icon button (refresh icon, `title="Sync now"`, shown only when `driveReady`, disabled while `syncing`, calls `handleSync`) + SVG gear icon that calls `onOpenSettings` (dispatches view change to settings, resets `settingsSection` to `'drive'`)
  [view === 'dashboard']
    OverviewCard              (state)            — 2-segment card (Retirement/Non-Retirement only, showing total value + GL tag)
    category .seg             (inline in App)    — category filter tabs
    AllocationChart           (positions, title) — full-width bar list; reused on Dashboard and Accounts page
    filter & import row       (inline in App)    — flex space-between: left-aligned asset-class .seg control + right-aligned Import button
      ImportDialog            (state, dispatch)  — renders the Import button trigger; open state is component-local (isOpen)
    PositionsTable            (state, dispatch)  — groups visiblePositions() into aggregate rows (symbol+effectiveAssetClass), reads asset-class filter for its own filtering (category handled upstream via selector); selectedGroupKey is component-local useState
      ClosedPositionsTable      (state, dispatch)       — when state.showClosed
      PositionGroupOverlay    (positions, title, accounts, dispatch, onClose, existingAssetClasses, state, sortPositions?)  — when a row is clicked in PositionsTable or AccountsPage; lists positions supplied by caller. 9-column table: Account (two-line dropdown: line 1 shows institution+name, line 2 shows tax category+retirement), Symbol, Name, Shares, Avg Cost, Current Price, % of Portfolio, Override (asset class), Delete (trash-icon button, `window.confirm` then dispatches `CLOSE_POSITION`, converting the position to a `ClosedPosition` rather than removing it outright). All editable fields use independent inline-edit UI with component-local state: click → input → Enter or blur commits via `UPDATE_POSITION` dispatch, Escape cancels/reverts (no dispatch). Editable cells: Symbol (`<input type="text">`, empty reverts silently), Account (dropdown; selecting one dispatches `UPDATE_POSITION` with `patch: { accountId }`), Shares/AvgCost/Price (`<input type="number">`; invalid/empty revert silently). Editing Symbol, Account, or deleting a position changes position's `buildGroupKey()` result or removes the position → position row disappears from currently-open overlay on next render (overlay itself stays open; no special wiring needed, natural re-render side effect).
        AssetClassOverrideSelect (position, dispatch)  — per underlying position, inside the overlay
  [view === 'settings']
    SettingsPage              (state, dispatch, sessionKey, sessionSalt, onKeyChange, driveReady, driveEmail, backupFileId, syncing, setSyncing, handleConnect, handleDisconnect, handleSync, settingsSection, setSettingsSection)  — renders tab-seg ("Google Drive" / "Encryption") at the top (active per `settingsSection`, each `onClick` dispatches `setSettingsSection`), followed by `.hr` divider, then conditionally the Google Drive Sync card (incl. cross-password restore prompt) when `settingsSection === 'drive'` or the Change Encryption Password card when `settingsSection === 'encryption'`.
  [view === 'accounts']
    AccountsPage              (state, dispatch) — 2-column layout: left collapsible category cards, right allocation chart + filter + aggregate positions table. Row click on category card opens `PositionGroupOverlay` with that account's positions.
```

Props convention: most components take `{ state: AppState, dispatch }`; narrower props for focused components: `AssetClassOverrideSelect` (`position`, `dispatch`), `PositionGroupOverlay` (`positions`, `title`, `accounts`, `dispatch`, `onClose`, `existingAssetClasses`, `state`, `sortPositions?`), `PasswordGate` (`shape`, `onUnlock`, `onReset`), `Nav` (`state`, `dispatch`, `driveReady`, `syncing`, `handleSync`, `onOpenSettings`), `SettingsPage` (`state`, `dispatch`, `sessionKey`, `sessionSalt`, `onKeyChange`, `driveReady`, `driveEmail`, `backupFileId`, `syncing`, `setSyncing`, `handleConnect`, `handleDisconnect`, `handleSync`, `settingsSection`, `setSettingsSection`), `AllocationChart` (`positions: Position[]`, `title: string`), `AccountsPage` (`state`, `dispatch`). `dispatch` is typed `(action: any) => void` throughout — action payloads are not statically checked against `reducer.ts`'s cases.

## Data flow

**CSV import** — synchronous 2-step wizard inside `ImportDialog` (positions or transactions). Dialog-open state is component-local (`isOpen`), not in `AppState`. Paste mode maintains additional component-local state: `pasteHeaderClipboard`, `pasteValuesClipboard`, `pasteIssues`.
1. **Setup** (`step === 1`): pick data type (`.seg`: Transactions / Positions — default Positions), destination account (existing `<select>` or new-account form: name, number, category, retirement checkbox), and entry mode for positions (`upload`/`paste`/`manual`, default `upload`). Upload mode uses `.csv` file parsing (`parseCsvFile` from `csv.ts` -> `{ headers, rows }`). Paste mode feeds two clipboard paste zones (headers + values) into `tableToCsv()` (`pastedTable.ts`) to produce the same `csvHeaders`/`csvRows` state as upload, then shares Step 2's mapping/prefill/commit logic with no changes. Manual mode enters Step 2 with blank rows (no CSV parsing). Continue requires account resolution; upload and paste modes additionally require ≥1 parsed row, manual mode does not.
2. **Review** (`step === 2`):
   - Upload mode: `headers` drive one mapping `<select>` per non-asset-class field (`{ csvColumn: targetField }`, required then optional).
   - Manual positions mode: entering Step 2 seeds exactly 10 blank rows and renders no mapping selects for non-asset-class fields.
   - Positions `Asset Class` header is always a free-text `<input>` that broadcasts to rows not yet touched in their own `assetClass` cell.
   - Existing-account mapping prefill applies only in upload mode (`csvMappings` filtered to headers present in current file).
   - `applyFieldMap(row, fieldMap)` + `importEdits[rowIdx]` produce editable rows; `validatePreviewRow` handles required-field validation (with avgCost/purchaseAmount and price/marketValue alternatives). Fully-empty rows are valid and excluded at commit via `isBlankRow`.
   - Primary button gating: upload mode includes `isReviewValid(dataType, fieldMap)`; manual mode bypasses `isReviewValid` and additionally requires at least one valid non-blank row.
   - Row delete (`handleDeleteRow`) removes row + re-keys row-indexed edits/touched state.
3. **Commit**: primary button dispatches `ADD_ACCOUNT` first when new-account mode (capturing the new account id), then `IMPORT_POSITIONS` or `IMPORT_TRANSACTIONS` with `accountId`, valid non-blank edited rows, and fresh mapping profile saved. For positions, `IMPORT_POSITIONS` also carries `mode: entryMode === 'upload' ? 'replace' : 'merge'` (see `importPositions` below). `UPSERT_CSV_MAPPING` runs only in upload mode. "Import complete" renders in the same step-2 slot; "Done" closes and resets local state.

All steps are **synchronous**; no async queue beyond the debounce-save to IndexedDB.

**Password gate & hydration**: on mount, `App.tsx` calls `peekEnvelopeShape()` (`persist.ts`) to classify the stored IndexedDB record as `'absent' | 'legacy-plaintext' | 'encrypted'`, without decrypting anything (renders "Loading dashboard..." while this resolves). While `sessionKey` is `null`, `App` renders `PasswordGate` instead of the dashboard/settings tree:
1. `shape === 'encrypted'` → enter-password screen: derives a key from the typed password against `peekStoredSalt()`, calls `loadPersistedApp(key)`; a decrypt failure (wrong password) surfaces as `OperationError` and shows "Incorrect password".
2. `shape === 'absent' | 'legacy-plaintext'` → set-password screen: generates a fresh salt via `generateSalt()`, derives a key; if `shape === 'legacy-plaintext'`, also calls `loadLegacyPlaintextApp()` to read the old plaintext blob so it can be migrated.
3. Either path calls `onUnlock(key, salt, loadedState?)`: `App.tsx` sets `sessionKey`/`sessionSalt` React state, dispatches `__SET_STATE` with `loadedState` if present (decrypted or migrated data), and sets `isHydrated = true`. This is the **only** point `AppState` is populated from storage — no separate hydration effect.
4. "Reset App" (text link, both screens) opens an in-component blueprint-cornered confirm dialog gated on typing `RESET`; confirming calls `clearPersistedApp()` then `onReset()`, which resets `gateShape` to `'absent'`, `sessionKey`/`sessionSalt` to `null`, and dispatches `__SET_STATE` with `initialState()`, returning to the set-password screen. The dialog's open/confirm-text/toast state is local to `PasswordGate`'s shared `GateShell` wrapper, not `App.tsx`.

**Persistence**: once unlocked, every state change schedules `savePersistedApp(state, sessionKey, sessionSalt)` 500ms later (debounced via `setTimeout` in a `useEffect`, cleared/reset on each state change; skipped entirely while `sessionKey`/`sessionSalt` are null). A separate effect flushes the pending save on `pagehide`, `visibilitychange → hidden`, and unmount (via refs holding the latest state, key, and salt — `latestStateRef`, `sessionKeyRef`, `sessionSaltRef` — so the flush sees values from an unlock that happened after the listener was registered) so a refresh/reload within the debounce window never loses the newest state (e.g. a just-finished import). `savePersistedApp` encrypts the whole state into an envelope (`encryptState`) before the IndexedDB write, and rethrows IndexedDB open/write failures so callers' `.catch` fires (no silent success).

**Drive sync**: `drive.ts` exports a `drive` singleton (`createDriveSync({ appId: 'portfolio', folderPath: ['OpenWebApp','Portfolio'] })`) plus `syncBackup(state, key, salt)` (encrypts state into an envelope, writes it as the Drive JSON file, resolves with the written file id)/`restoreBackup(key)` (reads+parses the Drive JSON envelope, decrypts with `key`; throws `DriveDecryptError` — carrying the envelope's decoded `salt` and the raw `EncryptedEnvelope` — specifically on an auth-tag mismatch so a caller can retry with a different password without a second network round-trip)/`getBackupFileId()` (resolves the existing backup file id or null)/`getDriveAuthStatus()` (non-interactive auth snapshot `{ connected, email, expiresAt, needsReauth, tokenValid }`), all operating on `drive.project('app')`. **Token validation & reauth**: `syncBackup`/`restoreBackup` first call internal `ensureFreshConnection()` — a cached token is reused as-is while valid (connection exists, scopes complete, `expiresAt` > now + 5-min buffer), otherwise the interactive `connectDrive()` flow runs. A module-level in-flight guard guarantees at most one Google auth window even under concurrent sync/restore calls. `getBackupFileId()` is a passive probe (called on page load) and never prompts: an expired/missing token resolves `null` (catching `NeedsReauthError`) instead of opening auth. Drive connection state (`driveReady`, `driveEmail`, `backupFileId`, `syncing`) and handlers (`handleConnect`, `handleDisconnect`, `handleSync`) are lifted state/callbacks owned by `App.tsx` (not local to `SettingsPage`), including the `getDriveAuthStatus()`/`getBackupFileId()` check — this effect, and the `drive.activate()` effect, both run once the password gate is passed (`sessionKey !== null`), not on raw `App` mount: Drive is irrelevant before local unlock, and running them pre-unlock let a stale cached token's background warm-up (from `activate()`'s `visibilitychange`/`pageshow` listeners) surface a Google reauth prompt while the password screen was still showing. `App.tsx` passes them as props to both `Nav` (`driveReady`, `syncing`, `handleSync`) and `SettingsPage` (all Drive-related props plus `sessionKey`, `sessionSalt`, `onKeyChange`, `setSyncing`, `settingsSection`, `setSettingsSection`). `SettingsPage` provides UI affordances to sync/disconnect and renders a "View backup in Google Drive" link (built as `https://drive.google.com/file/d/{fileId}/view`) when connected and a backup file exists. `Nav`'s conditional sync-icon button (shown iff `driveReady`, disabled while `syncing`) calls the same lifted `handleSync`. **Error recovery**: when `handleConnect` fails (including when the user cancels the Google auth flow), the error is caught and `syncing` is reset to false via the finally block; the connection state is explicitly cleared (`driveReady`, `driveEmail`, `backupFileId` all reset) to ensure the UI remains in a consistent state. On `DriveDecryptError` from `handleRestore` (still `SettingsPage`-local, unchanged), `SettingsPage` shows an inline cross-password prompt: `deriveKey(typedPassword, error.salt)` + `decryptState(error.envelope, retryKey)` decrypt locally, then `onKeyChange(retryKey, error.salt)` (a prop from `App.tsx` that calls `setSessionKey`/`setSessionSalt`) adopts the new key session-wide. Requires `VITE_GOOGLE_CLIENT_ID` in `.env` (repo root, tracked in git) or OAuth connect fails (`token.ts` sends `client_id: undefined`); pinned by a test in `drive.test.ts`.

**Restoring a backup shared by another account**: `restoreBackup`'s `files.list({ folderId, nameEquals })` only ever sees files inside this account's own `OpenWebApp/Portfolio` folder — a file merely shared with this Google account by another (not synced from it) lives outside that tree and `restoreBackup` correctly returns `null` for it (this is inherent to the `drive.file` OAuth scope, not a bug). For that case, `drive.ts` also exports `pickDriveFile(): Promise<{id, name} | null>`, which dynamically loads `apis.google.com/js/api.js` + Google's Picker module and opens `google.picker.PickerBuilder` — selecting a file through Picker grants this app's `drive.file`-scoped token access to that specific file, the intended mechanism for that scope. Picker needs a raw OAuth access token, obtained via `drive.project('app').getAccessToken()` (from `@open-webapp/drive-sync@^0.2.0`) — the one deliberate exception to that library's `Connection` type never exposing token material, added specifically to feed Picker's `setOAuthToken()`. The picked file id is then read via `restoreBackupFromFileId(fileId, key)`, which shares `restoreBackup`'s read-and-decrypt logic (private `readAndDecryptFile` helper) and throws the identical `DriveDecryptError` on a wrong-password mismatch, so it plugs into the same cross-password-prompt UI in `SettingsPage`. `SettingsPage` renders a shared `DrivePickerFallback` button in two contexts: when no default-location backup exists (`noBackupFound`) and when a cross-password restore has failed (`crossPasswordError`).

**Password change** (`SettingsPage.handleChangePassword`): verifies the typed current password by deriving a key against `sessionSalt` and attempting `loadPersistedApp(candidateKey)` (a real decrypt, not a stored-hash check); on success generates a brand-new salt (`generateSalt()`, never reuses the old one), derives a new key, and calls `savePersistedApp(state, newKey, newSalt)`. If Drive is connected (`getDriveAuthStatus().connected`), also calls `syncBackup(state, newKey, newSalt)` — a failure here is caught and shown as a non-blocking warning; it does not undo the already-completed local `savePersistedApp`. On success calls `onKeyChange(newKey, newSalt)` to update `App.tsx`'s session state.

**Selectors** (`selectors.ts`) are the only place that reads+filters+sorts raw `AppState` collections for display; components call them instead of re-deriving:
- `visiblePositions(state)` — category → asset-class filter → search (symbol/name, case-insensitive) → `sortBy(state.sortKey, state.sortDir)`. (`PositionsTable` then groups its output client-side into aggregate rows by symbol+effectiveAssetClass and sorts those aggregate rows by `state.sortKey`/`sortDir`; grouping/sorting-of-aggregates is component-level, not in selectors.)
- `visibleTransactions(state)` — category filter → type filter → search (symbol/date) → always sorted by `date desc` (not user-sortable).
- `segmentCards(state, retirement)` — Total Value + a single combined GL `$ (%)` string/color, scoped to positions whose account.retirement matches the boolean arg. Powers `OverviewCard`'s 2 segments.
- `positionsForCategory(state)` — positions scoped to `state.category` (or all, if `'all'`); shared by Dashboard's `AllocationChart` and `PositionsTable`.
- `allocationBars(positions)` — wraps `computations.allocationByAssetClass` over an explicit `positions` array (caller scopes it), respecting `assetClassManualOverride`; returns `pctNum` alongside the formatted `pct` string.
- `assetClassOptions(state)` — Deduplicates and sorts effective asset classes (manual override or original) across all positions (global, Dashboard-scoped).
- `filteredPortfolioTotal(state)` — Computes sum of market values for positions matching category and asset-class filters; denominator for the Dashboard's `% of Portfolio` display.
- `categoryCards(state)` — one card per tax category (Taxable/Non-Taxable/Tax-Deferred) for the Accounts page's left column: per-account total/`updatedStr`/selection state, category total, `expanded` from `state.expandedCategories`.
- `acctScopedPositions(state)` — `state.selectedAccountId`'s positions, or all positions if none selected.
- `acctAssetClassOptions(positions)` — distinct effective asset classes among the given positions (used with `acctScopedPositions` to build the Accounts page's asset-class filter options).
- `acctFilteredPositions(state)` — `acctScopedPositions(state)` further filtered by `state.acctAssetClassFilter`/`state.acctPosSearch`; denominator for the Accounts page's `% of Selection` display.
- `acctAllocationTitle(state)` — `"Allocation — {account.name}"` or `"Allocation — All Accounts"`, based on `state.selectedAccountId`.

## Key Invariants

- **Account cascade delete**: Deleting an `Account` cascade-deletes all its `Position`s, `ClosedPosition`s, `Transaction`s, `PortfolioSnapshot`s, and `SavedCsvMapping`s.
- **importPositions replace vs merge mode**: `importPositions(state, accountId, mappedRows, importDate, mode)` (`mode: 'replace' | 'merge'`, default `'replace'`). `'replace'` (CSV-upload, a full broker export) replaces the account's entire position list; symbols missing from the new rows become `ClosedPosition`s. `'merge'` (manual entry / Copy-Paste, inherently partial batches) upserts new rows by symbol into the account's existing positions — untouched symbols are left alone and nothing is closed. `ImportDialog` dispatches `mode: entryMode === 'upload' ? 'replace' : 'merge'`.
- **Position delete = close, not hard delete**: deleting a position from `PositionGroupOverlay` (`CLOSE_POSITION` action) converts it to a `ClosedPosition` with `realizedGL: null`, `realizedGLBasis: 'unknown'` (never transaction-matched, unlike the reimport-driven auto-close path in `positionsImport.ts`) — same target shape, different trigger and always-unknown basis.

## Design patterns

- **Computed-not-stored**: `marketValue`/`costBasis`/`gl`/`glPct` are never persisted on `Position`; always derived via `computations.computePosition()`.
- **Category filter is compositional**: every selector re-derives "accounts in category" via a local `getAccountsForCategory`/inline filter rather than storing a filtered account list.
- **Effective asset class**: anywhere a position's asset class is displayed or grouped, code reads `p.assetClassManualOverride || p.assetClass`, never `p.assetClass` alone.
- **Natural-key upsert**: `positionsImport.ts` (snapshot) and `transactionsImport.ts` (transaction) both dedup by recomputing a string key and filtering pre-existing entries out before appending, rather than mutating in place.
- **Session-key lifecycle**: the derived `CryptoKey` + PBKDF2 salt (`sessionKey`/`sessionSalt`) live only as React state in `App.tsx`, set once by `PasswordGate`'s `onUnlock` (or rotated by `SettingsPage`'s `onKeyChange`) and threaded down via props to `SettingsPage` — they are explicitly **not** fields on `AppState` and never flow through the reducer or `__SET_STATE`. They are additionally mirrored into `sessionKeyRef`/`sessionSaltRef` (plain refs, updated on every render) purely so the pagehide/unmount flush-save listener — registered once on mount — can read the latest values without re-registering. Losing this state (refresh, tab close) is by design: it is what makes the password required every session.
- **Styling**: components use inline `style={{ ... }}` extensively alongside the design-system classes (`.card.blueprint.elev-sm`, `.tag`/`.tag-accent`, `.seg`/`.seg-opt`, `.table`, `.nav`, `.field`/`.input`, `.dialog-backdrop`/`.dialog`) — this is a live deviation from the CLAUDE.md styling rule ("Components consume the existing class vocabulary ... rather than inline styles"); most layout/spacing (flex, gap, padding, modal positioning) is inline today, only the visual vocabulary (colors, card chrome, tags, table borders) comes from `styles.css` classes.
- **Hand-mirrored dual artifact**: `src/lib/pastedTable.ts` (typed ES module) is paired with a root-level `pastedTable.js` (classic-script, `window.PastedTable` global, no `import`/`export`) — one hand-maintained copy of the same logic per runtime, no build step generates one from the other. `pastedTable.js` sits outside `tsconfig.app.json`'s `include`, so it is never typechecked or bundled; parity between the two is enforced entirely at test time by one shared vitest case table (`src/lib/pastedTable.test.ts`) run against both implementations. Editing one copy without the other does not fail `tsc -b` — it only fails that shared-case test suite, so the two files can silently drift until tests are run.
