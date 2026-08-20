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
    drive.ts                 # drive-sync singleton (drive, wrapping project().pickFile() for the Google Picker) + syncBackup/restoreBackupFromFileId/getBackupFileId/getDriveAuthStatus, DriveDecryptError
    csv.ts                    # Papa.parse wrapper: parseCsvFile, parseCsvNumber
    accounts.ts               # empty stub retained for future use
    positionsImport.ts        # replace/merge mode + closed-position diff + snapshot upsert
    transactionsImport.ts     # dedup-by-natural-key insert
    computations.ts           # computePosition, allocationByAssetClass, fmtUSD, fmtPct
    sort.ts                   # generic sortBy<T>
    selectors.ts               # visibleTransactions/categoryCards/closedPositionsCard/acct*/etc.
    importPreview.ts           # applyFieldMap / validatePreviewRow / isBlankRow / isReviewValid
    seed.ts                    # uid(prefix)
    pastedTable.ts              # tableToCsv(headersClipboard, valuesClipboard): clipboard-paste → CSV/rows/headers parser, used by ImportDialog's Copy-Paste entry mode
  components/
    PasswordGate.tsx           # full-replacement gate screen: set-password (first-run) with optional "Restore from Drive" tab, enter-password (returning encrypted), reset-app escape hatch
    Nav.tsx                    # nav-brand, Accounts seg tab, SVG sync/gear icons
    AccountsPage.tsx           # 2-column layout: left category cards (Taxable/Non-Taxable/Tax-Deferred/Closed Positions), right panel with allocation chart + positions table (open) or closed-positions table; row click on open-positions opens PositionGroupOverlay
    AllocationChart.tsx         # asset allocation bar list (positions, title); used on the Accounts page
    PositionGroupOverlay.tsx    # dialog overlay: displays positions from a caller-supplied list with editable fields and inline account/symbol/shares/price cells
    ClosedPositionsTable.tsx
    TransactionsTable.tsx
    AssetClassOverrideSelect.tsx
    InstitutionSelect.tsx                       # { value: string, accounts: Account[], onChange: (value: string) => void } — seeded list ∪ in-use values with free-type "Add X" affordance
    DriveRestorePanel.tsx        # shared Drive connect/disconnect/restore UI: connect button, disconnect link, Google Picker-based restore ("Pick a file" dialog, the only restore entry point), cross-password retry prompt with its own fallback picker; used by both PasswordGate restore tab and SettingsPage
    Settings.tsx                  # two-tab page: Google Drive Sync (renders DriveRestorePanel) + Change Encryption Password
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
  view: 'settings' | 'accounts'
  sortKey: keyof Position
  sortDir: 'asc' | 'desc'
  txTypeFilter: string
  txSearch: string
  selectedAccountId: string | null
  selectedCategoryKey: TaxCategory | 'closedPositions' | null
  expandedCategories: Record<string, boolean>
  acctAssetClassFilter: string
  acctPosSearch: string
}
```

- `src/lib/state.ts` — `AppState` interface (6 data collections + 10 UI fields) and one pure helper per mutation (`addAccount`, `updateAccount`, `deleteAccount`, `updatePosition`, `closePosition`, `deleteClosedPosition`, `setSort`, `toggleSort`, `setTransactionsSearch`, `setTransactionTypeFilter`, `upsertCsvMapping`, `selectAccount(accountId, categoryKey?)`, `toggleCategoryExpanded`, `setAcctAssetClassFilter`, `setAcctPosSearch`). `selectAccount` now accepts an optional `categoryKey` parameter to set `selectedCategoryKey` to a tax category or `'closedPositions'`.
- `src/lib/reducer.ts` — `appReducer(state, action)` switches on `action.type` (string) and calls the matching `state.ts` helper, or the import logic in `positionsImport.ts`/`transactionsImport.ts`. `default: return state`. Special case `__SET_STATE` replaces the whole state (used by hydration).
- Components never mutate state directly; they `dispatch({ type: '...', ...payload })`.

### Action types (reducer.ts)

`__SET_STATE`, `ADD_ACCOUNT`, `UPDATE_ACCOUNT`, `DELETE_ACCOUNT`, `UPDATE_POSITION`, `CLOSE_POSITION`, `SET_ASSET_CLASS_OVERRIDE`, `DELETE_CLOSED_POSITION`, `SET_SORT`, `TOGGLE_SORT`, `SET_TRANSACTIONS_SEARCH`, `SET_TRANSACTION_TYPE_FILTER`, `IMPORT_POSITIONS`, `IMPORT_TRANSACTIONS`, `UPSERT_CSV_MAPPING`, `SET_VIEW`, `SELECT_ACCOUNT`, `TOGGLE_CATEGORY_EXPANDED`, `SET_ACCT_ASSET_CLASS_FILTER`, `SET_ACCT_POS_SEARCH`. Note: `SELECT_ACCOUNT` payload carries `accountId` and optional `categoryKey` (a tax category name or `'closedPositions'`).

## Component tree

```
App
  [gateShape === null]         — "Loading..." while peekEnvelopeShape() resolves
  [sessionKey === null]
    PasswordGate               (shape, onUnlock, onReset, driveReady, driveEmail, backupFileId, syncing, setSyncing, handleConnect, handleDisconnect) — replaces the entire tree below until unlocked; when shape='absent', offers tab-seg for New Setup vs. Restore from Drive; restore tab renders DriveRestorePanel
  [sessionKey set, !isHydrated] — "Loading..." (brief, between onUnlock and hydration dispatch)
  Nav                         (state, dispatch, driveReady, syncing, handleSync, onOpenSettings)  — renders on both accounts and settings views. nav-brand 'Ledger' + always-rendered `.seg` with a single "Accounts" tab (active when `state.view === 'accounts'`, inactive when `state.view === 'settings'`), whose `onClick` dispatches `SET_VIEW` + conditional sync-icon button (refresh icon, `title="Sync now"`, shown only when `driveReady`, disabled while `syncing`, calls `handleSync`) + SVG gear icon that calls `onOpenSettings` (dispatches view change to settings, resets `settingsSection` to `'drive'`)
  [view === 'accounts']
    AccountsPage              (state, dispatch) — 2-column layout: left collapsible category cards (Taxable, Non-Taxable, Tax-Deferred, plus optional 4th Closed Positions card when any exist), right panel switches between (allocation chart + asset-class filter + aggregate positions table for open positions) and (closed positions table when closed-positions category selected). Category card click sets `selectedAccountId` and `selectedCategoryKey`; opening open-positions category dispatches `PositionGroupOverlay` with that category's positions, but closed-positions category shows `ClosedPositionsTable` instead (no overlay).
      ImportDialog            (state, dispatch)  — renders the Import button trigger in the filter row; open state is component-local (isOpen)
      ClosedPositionsTable    (state, dispatch, positions)  — when the Closed Positions category is selected
      PositionGroupOverlay  (positions, title, accounts, dispatch, onClose, existingAssetClasses, state, sortPositions?)  — when a row is clicked in AccountsPage's aggregate positions table; lists positions supplied by caller. 9-column table: Account (two-line dropdown: line 1 shows institution+name, line 2 shows tax category+retirement), Symbol, Name, Shares, Avg Cost, Current Price, % of Portfolio, Override (asset class), Delete (trash-icon button, `window.confirm` then dispatches `CLOSE_POSITION`, converting the position to a `ClosedPosition` rather than removing it outright). All editable fields use independent inline-edit UI with component-local state: click → input → Enter or blur commits via `UPDATE_POSITION` dispatch, Escape cancels/reverts (no dispatch). Editable cells: Symbol (`<input type="text">`, empty reverts silently), Account (dropdown; selecting one dispatches `UPDATE_POSITION` with `patch: { accountId }`), Shares/AvgCost/Price (`<input type="number">`; invalid/empty revert silently). Editing Symbol, Account, or deleting a position changes position's `buildGroupKey()` result or removes the position → position row disappears from currently-open overlay on next render (overlay itself stays open; no special wiring needed, natural re-render side effect).
        AssetClassOverrideSelect (position, dispatch)  — per underlying position, inside the overlay
  [view === 'settings']
    SettingsPage              (state, dispatch, sessionKey, sessionSalt, onKeyChange, driveReady, driveEmail, backupFileId, syncing, setSyncing, handleConnect, handleDisconnect, settingsSection, setSettingsSection)  — renders tab-seg ("Google Drive" / "Encryption") at the top (active per `settingsSection`, each `onClick` dispatches `setSettingsSection`), followed by `.hr` divider, then conditionally the Google Drive Sync card (renders DriveRestorePanel) when `settingsSection === 'drive'` or the Change Encryption Password card when `settingsSection === 'encryption'`.
      DriveRestorePanel      (driveReady, driveEmail, backupFileId, syncing, setSyncing, handleConnect, handleDisconnect, restoreKey, restoreSalt, onRestored) — shared Drive panel used here and on PasswordGate's restore tab
```

Props convention: most components take `{ state: AppState, dispatch }`; narrower props for focused components: `AssetClassOverrideSelect` (`position`, `dispatch`), `PositionGroupOverlay` (`positions`, `title`, `accounts`, `dispatch`, `onClose`, `existingAssetClasses`, `state`, `sortPositions?`), `PasswordGate` (`shape`, `onUnlock`, `onReset`, `driveReady?`, `driveEmail?`, `backupFileId?`, `syncing?`, `setSyncing?`, `handleConnect?`, `handleDisconnect?`), `Nav` (`state`, `dispatch`, `driveReady`, `syncing`, `handleSync`, `onOpenSettings`), `SettingsPage` (`state`, `dispatch`, `sessionKey`, `sessionSalt`, `onKeyChange`, `driveReady`, `driveEmail`, `backupFileId`, `syncing`, `setSyncing`, `handleConnect`, `handleDisconnect`, `settingsSection`, `setSettingsSection`), `DriveRestorePanel` (`driveReady`, `driveEmail`, `backupFileId`, `syncing`, `setSyncing`, `handleConnect`, `handleDisconnect`, `restoreKey`, `restoreSalt`, `onRestored`), `AllocationChart` (`positions: Position[]`, `title: string`), `AccountsPage` (`state`, `dispatch`). `dispatch` is typed `(action: any) => void` throughout — action payloads are not statically checked against `reducer.ts`'s cases.

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

**Password gate & hydration**: on mount, `App.tsx` calls `peekEnvelopeShape()` (`persist.ts`) to classify the stored IndexedDB record as `'absent' | 'legacy-plaintext' | 'encrypted'`, without decrypting anything (renders "Loading..." while this resolves). While `sessionKey` is `null`, `App` renders `PasswordGate` instead of the accounts/settings tree:
1. `shape === 'encrypted'` → enter-password screen: derives a key from the typed password against `peekStoredSalt()`, calls `loadPersistedApp(key)`; a decrypt failure (wrong password) surfaces as `OperationError` and shows "Incorrect password".
2. `shape === 'absent'` → set-password screen with optional "Restore from Drive" tab-seg: offers "New Setup" (today's generate-key-and-set-password form) vs. "Restore from Drive" (temporary dummy key `generateSalt()` + `deriveKey(crypto.randomUUID(), dummySalt)` that guarantees the first `restoreBackupFromFileId(fileId, dummyKey)` call always throws `DriveDecryptError`, reusing the cross-password-prompt code path verbatim with no special branching). On restore success (direct pick or cross-password retry), calls `onUnlock(restoredKey, restoredSalt, restoredState)` just as the New Setup form does. Tab switching is free (no validation, state preserved per tab).
3. `shape === 'legacy-plaintext'` → set-password screen (no tab-seg): generates a fresh salt via `generateSalt()`, derives a key, and calls `loadLegacyPlaintextApp()` to read the old plaintext blob so it can be migrated.
4. Either path calls `onUnlock(key, salt, loadedState?)`: `App.tsx` sets `sessionKey`/`sessionSalt` React state, dispatches `__SET_STATE` with `loadedState` if present (decrypted, restored, or migrated data), and sets `isHydrated = true`. This is the **only** point `AppState` is populated from storage — no separate hydration effect.
5. "Reset App" (text link, both screens) opens an in-component blueprint-cornered confirm dialog gated on typing `RESET`; confirming calls `clearPersistedApp()` then `onReset()`, which resets `gateShape` to `'absent'`, `sessionKey`/`sessionSalt` to `null`, and dispatches `__SET_STATE` with `initialState()`, returning to the set-password screen. The dialog's open/confirm-text/toast state is local to `PasswordGate`'s shared `GateShell` wrapper, not `App.tsx`.

**Persistence**: once unlocked, every state change schedules `savePersistedApp(state, sessionKey, sessionSalt)` 500ms later (debounced via `setTimeout` in a `useEffect`, cleared/reset on each state change; skipped entirely while `sessionKey`/`sessionSalt` are null). A separate effect flushes the pending save on `pagehide`, `visibilitychange → hidden`, and unmount (via refs holding the latest state, key, and salt — `latestStateRef`, `sessionKeyRef`, `sessionSaltRef` — so the flush sees values from an unlock that happened after the listener was registered) so a refresh/reload within the debounce window never loses the newest state (e.g. a just-finished import). `savePersistedApp` encrypts the whole state into an envelope (`encryptState`) before the IndexedDB write, and rethrows IndexedDB open/write failures so callers' `.catch` fires (no silent success).

**Load normalization** (`coalesceWithDefaults` in `persist.ts`): the single path every stored blob passes through, on both local unlock and Drive restore. Missing collections/fields fall back to `initialState()` defaults. `view` is whitelisted rather than defaulted — a blob written before the Dashboard was removed carries the retired `view: 'dashboard'`, and anything other than `'accounts'`/`'settings'` is coerced to the default `'accounts'`.

**Drive sync**: `drive.ts` exports a `drive` singleton (`createDriveSync({ appId: 'portfolio', folderPath: ['OpenWebApp','Portfolio'] })`, wrapped so `drive.project(id).pickFile(options)` resolves apiKey/appId/parentFolderId and delegates to `@open-webapp/drive-sync`'s own Picker-backed `pickFile`) plus `syncBackup(state, key, salt)` (encrypts state into an envelope, writes it as the Drive JSON file, resolves with the written file id)/`restoreBackupFromFileId(fileId, key)` (reads+parses the Drive JSON envelope for a specific file id, decrypts with `key`; throws `DriveDecryptError` — carrying the envelope's decoded `salt` and the raw `EncryptedEnvelope` — specifically on an auth-tag mismatch so a caller can retry with a different password without a second network round-trip)/`getBackupFileId()` (resolves the existing backup file id or null, for the "View backup in Google Drive" link only — not used to find what to restore)/`getDriveAuthStatus()` (non-interactive auth snapshot `{ connected, email, expiresAt, needsReauth, tokenValid }`), all operating on `drive.project('app')`. **Token validation & reauth**: `syncBackup`/`restoreBackupFromFileId` first call internal `ensureFreshConnection()` — a cached token is reused as-is while valid (connection exists, scopes complete, `expiresAt` > now + 5-min buffer), otherwise the interactive `connectDrive()` flow runs. A module-level in-flight guard guarantees at most one Google auth window even under concurrent sync/restore calls. `getBackupFileId()` is a passive probe (called on page load) and never prompts: an expired/missing token resolves `null` (catching `NeedsReauthError`) instead of opening auth. Drive connection state (`driveReady`, `driveEmail`, `backupFileId`, `syncing`) and handlers (`handleConnect`, `handleDisconnect`, `handleSync`) are lifted state/callbacks owned by `App.tsx` (not local to `SettingsPage` or `PasswordGate`), including the `getDriveAuthStatus()`/`getBackupFileId()` check — this effect, and the `drive.activate()` effect, both run once the password gate is passed (`sessionKey !== null`), not on raw `App` mount: Drive is irrelevant before local unlock, and running them pre-unlock let a stale cached token's background warm-up (from `activate()`'s `visibilitychange`/`pageshow` listeners) surface a Google reauth prompt while the password screen was still showing. `App.tsx` passes these props to `Nav` (`driveReady`, `syncing`, `handleSync`), `PasswordGate` (all Drive-related props for the restore tab), and `SettingsPage` (all Drive-related props plus `sessionKey`, `sessionSalt`, `onKeyChange`, `setSyncing`, `settingsSection`, `setSettingsSection`). `Nav`'s conditional sync-icon button (shown iff `driveReady`, disabled while `syncing`) calls the lifted `handleSync`. **Restore flow (shared `DriveRestorePanel` component)**: both `SettingsPage` and `PasswordGate`'s restore tab render the same `DriveRestorePanel` component with different success callbacks (`onRestored`). The panel handles all connect/disconnect, restore (via a `DriveFilePickerDialog` "Pick a file" button that opens the Google Picker), and cross-password-prompt logic identically in both contexts — the only difference is what fires on success. **Error recovery**: when `handleConnect` fails (including when the user cancels the Google auth flow), the error is caught and `syncing` is reset to false via the finally block; the connection state is explicitly cleared (`driveReady`, `driveEmail`, `backupFileId` all reset) to ensure the UI remains in a consistent state. On `DriveDecryptError` from `restoreBackupFromFileId()`, the `DriveRestorePanel` hides its picker dialog and shows an inline cross-password prompt: `deriveKey(typedPassword, error.salt)` + `decryptState(error.envelope, retryKey)` decrypt locally, then calls `onRestored(decryptedState, retryKey, error.salt)`. A wrong backup password renders a second `DriveFilePickerDialog` inline as a fallback, so the user can pick a different file without leaving the prompt. Requires `VITE_GOOGLE_CLIENT_ID` in `.env` (repo root, tracked in git) or OAuth connect fails (`token.ts` sends `client_id: undefined`); pinned by a test in `drive.test.ts`.

**Restoring a backup shared by another account**: there is no by-name lookup of a default backup at all — `restoreBackupFromFileId(fileId, key)` always operates on a file id the user explicitly picked via Google Picker (`DriveFilePickerDialog` → `drive.project('app').pickFile({ includeFolders: true })`), which starts scoped to the app's own `OpenWebApp/Portfolio` folder (via `ensureFolderPath()`) but lets the user navigate anywhere in their Drive using Picker's built-in UI — including a file merely shared with this Google account by another (not synced from it), which would otherwise sit outside the `drive.file` OAuth scope's visibility to a by-name `files.list` lookup. Picking a file server-side grants the app access to exactly that file, and `restoreBackupFromFileId` reads and decrypts it, throwing the same `DriveDecryptError` on a wrong-password mismatch as any other restore.

**Password change** (`SettingsPage.handleChangePassword`): verifies the typed current password by deriving a key against `sessionSalt` and attempting `loadPersistedApp(candidateKey)` (a real decrypt, not a stored-hash check); on success generates a brand-new salt (`generateSalt()`, never reuses the old one), derives a new key, and calls `savePersistedApp(state, newKey, newSalt)`. If Drive is connected (`getDriveAuthStatus().connected`), also calls `syncBackup(state, newKey, newSalt)` — a failure here is caught and shown as a non-blocking warning; it does not undo the already-completed local `savePersistedApp`. On success calls `onKeyChange(newKey, newSalt)` to update `App.tsx`'s session state.

**Selectors** (`selectors.ts`) are the only place that reads+filters+sorts raw `AppState` collections for display; components call them instead of re-deriving:
- `visibleTransactions(state)` — type filter → search (symbol/date) → always sorted by `date desc` (not user-sortable).
- `allocationBars(positions)` — wraps `computations.allocationByAssetClass` over an explicit `positions` array (caller scopes it), respecting `assetClassManualOverride`; returns `pctNum` alongside the formatted `pct` string.
- `assetClassOptions(state)` — Deduplicates and sorts effective asset classes (manual override or original) across all positions (global, not selection-scoped).
- `filteredPortfolioTotal(state)` — Sum of market values across every position (unfiltered); denominator for `PositionGroupOverlay`'s `% of Portfolio` display.
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
