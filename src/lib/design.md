# design.md

Directory structure, API contract, component tree, state management, data model, data flows, design patterns.

## Component Tree

- `ClosedPositionsTable.tsx` — table with symbol, closed date, realized G/L, delete + undo buttons; takes `positions` prop (caller-supplied ClosedPosition[])
  - Used by `PositionsTable.tsx` (passes `state.closedPositions`)
  - Used by `AccountsPage.tsx` (passes `acctFilteredClosedPositions(state)`)
- `Settings.tsx` "Price Sync" tab (third `.seg-opt`, alongside Drive/Encryption) — masked (`type="password"`) Polygon.io API key input (commits on blur via `SET_PRICE_SYNC_API_KEY`), "Fetch prices now" button (disabled while fetching or no API key), last-run status text (`state.priceSync.lastRun`: date/time, updated count, not-found list, or "Never run")
  - Shares its fetch/orchestration call with `App.tsx`'s on-load/on-focus effect: both call the same `runPriceSyncTrigger` `useCallback`, lifted from `App.tsx` and passed down as a prop; the button just wraps it with a local `fetchingPrices` loading state

## Data Flows

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

### Drive Connection Persistence

On mount, `App.tsx` calls `getDriveAuthStatus()` non-blockingly in parallel with other initialization (sets `driveReady` + `driveEmail`, passes to `PasswordGate`). No `getBackupFileId()` auto-call on initial load.

Post-unlock, `drive.activate()` + post-unlock `getDriveAuthStatus()` run in a separate effect only after `sessionKey` is set. No blocking waits on Drive connection status — initialization proceeds independently.

### Restore from Drive

DriveRestorePanel → [Restore from Drive button clicked] → showPicker = true → DriveFilePickerDialog ("Pick a file" button) → [user clicks "Pick a file"] → drive.project('app').pickFile({ includeFolders: true })
  ├─ No by-name lookup first — the picker is the only restore entry point
  ├─ `drive.ts`'s `pickFile` wrapper resolves apiKey (VITE_GOOGLE_PICKER_API_KEY) + appId
  │  (VITE_GOOGLE_PROJECT_NUMBER, or the numeric prefix of VITE_GOOGLE_CLIENT_ID) and a
  │  parentFolderId (defaults to project.ensureFolderPath(), i.e. OpenWebApp/Portfolio),
  │  then calls @open-webapp/drive-sync's project.pickFile(...) — which acquires/refreshes
  │  the OAuth token itself and opens Google Picker scoped to that starting folder; user
  │  can still navigate elsewhere via Picker's own UI
  ├─ Cancelling the picker (PickerCancelledError) resolves `null`, not a throw — treated as onCancel
  └─ Selecting a file resolves `{ id, name, mimeType }` → onSelect(file.id) → confirm dialog → restoreBackupFromFileId(fileId, key)
     ├─ Success: onRestored() → state hydrated, showPicker reset to false
     ├─ DriveDecryptError (password mismatch): showPicker set to false, setCrossPasswordPrompt() → user enters backup password → deriveKey + decryptState
     └─ Error: alert shown; showPicker stays true, "Pick a file" can be clicked again to retry

Cross-password flow's fallback picker: once `crossPasswordError` is set (a wrong backup-password submit), the cross-password prompt renders its own `DriveFilePickerDialog` ("Pick a file" button) inline — picking a file there re-attempts `restoreBackupFromFileId` with the newly picked file id, chaining into a fresh cross-password prompt if that also decrypts wrong. The original dialog's `showPicker` is cleared before this fallback appears (see above), so only one "Pick a file" button is ever on screen at a time.

### Price Sync

App load/tab-focus (or Settings "Fetch prices now") → `App.tsx`'s `runPriceSyncTrigger` → `priceSync.ts`'s
`runPriceSync(state.priceSync, heldEquityEtfSymbols)` → `fetchGroupedDailyBars`
(Polygon grouped-daily-bars, one call for the next business day after
`lastFetchedDate`) → `marketDataDb.putBars` (ALL response tickers, unencrypted
local cache, separate from `persist.ts`/Drive) + `RECORD_PRICE_SYNC_RUN` dispatch (advances `lastFetchedDate` +
`heldPrices` only on non-empty response) → `UPDATE_POSITION` dispatch for
each held Equity/ETF symbol found in the response.

- No API key configured → no fetch attempted (`runPriceSyncTrigger` returns early).
- Empty/error/malformed response → `lastFetchedDate` NOT advanced, every held symbol reported in `lastRun.notFound`, retried
  on next trigger.
- CSV Positions import after a same-day fetch already ran →
  `positionsImport.ts` reapplies the cached `state.priceSync.heldPrices`
  price over the freshly-imported CSV price for Equity/ETF positions when the cached price's date >= the import date
  (API always wins for the same day or newer).
