# design.md

Directory structure, API contract, component tree, state management, data model, data flows, design patterns.

## Component Tree

- `ClosedPositionsTable.tsx` — table with symbol, closed date, realized G/L, delete + undo buttons; takes `positions` prop (caller-supplied ClosedPosition[])
  - Used by `PositionsTable.tsx` (passes `state.closedPositions`)
  - Used by `AccountsPage.tsx` (passes `acctFilteredClosedPositions(state)`)
- `Settings.tsx` "Quotes API Key" tab (third `.seg-opt`, alongside Drive/Encryption; internal `settingsSection` value still `'priceSync'`) — masked (`type="password"`) Polygon.io API key input (commits on blur via `SET_PRICE_SYNC_API_KEY`), "Fetch prices now" button + adjacent `type="date"` input (disabled while fetching; date optional — empty means auto-computed date), last-run status text (`state.priceSync.lastRun`: date/time, and either an error message (`lastRun.error`, e.g. invalid/unauthorized API key) or `{marketTickerCount} tickers fetched from Polygon` + updated count + not-found list; "Never run" if no run yet)
  - Shares its fetch/orchestration call with `App.tsx`'s on-load/on-focus effect: both call the same `runPriceSyncTrigger` `useCallback`, lifted from `App.tsx` and passed down as a prop; the button just wraps it with a local `fetchingPrices` loading state, passing the local date-input value (or `undefined` if empty) as `runPriceSyncTrigger`'s optional `overrideDate` arg — the automatic on-load/on-focus calls always call it with no argument
- `QuotesPage.tsx` — full-page view rendered when `state.view === 'quotes'` (sibling of `AccountsPage.tsx`/Settings, same full-width wrapper as Accounts); props `{ state, dispatch, tickerOverviewErrors }` (`tickerOverviewErrors` is `App.tsx` local state, not part of `AppState`). Row set = `heldEquityEtfSymbols(state)` sorted alphabetically. Loads `marketDataDb.getAllBars()` + `getAllTickerOverviews()` in a `useEffect` keyed on `priceSync.lastRun?.at` (re-reads after every sync run). Columns: Ticker, Name (from cached `TickerOverview.name`, `—` if uncached), Status (`OK`/`Not found`, from `heldPrices`/`lastRun.notFound`), Price (`fmtUSD`, falls back to cached bar's `close` if not in `heldPrices`), Held (always `Yes` — page only lists held symbols), Last Updated (UTC, formatted from the matching `DailyBar.t`), SIC Description (from cached `TickerOverview.sicDescription`, `—` if uncached). Search box live-filters ticker/name/status/SIC across the row set. Empty state "No holdings to show." when no held Equity/ETF symbols. Failure banner "Could not fetch name for: X, Y" rendered when `tickerOverviewErrors` is non-empty.
- `Nav.tsx`'s `mainNavTabs` has 2 entries: `Accounts`, `Quotes`.

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

App load/tab-focus (or Settings "Fetch prices now") → `App.tsx`'s `runPriceSyncTrigger(overrideDate?)` → `priceSync.ts`'s
`runPriceSync(state.priceSync, heldEquityEtfSymbols, overrideDate?)` → `fetchGroupedDailyBars`
(Polygon grouped-daily-bars, one call for `overrideDate` if given, else the next business day after
`lastFetchedDate`) → `marketDataDb.putBars` (ALL response tickers, unencrypted
local cache, separate from `persist.ts`/Drive, readable in full via `marketDataDb.getAllBars()`) + `RECORD_PRICE_SYNC_RUN` dispatch (advances `lastFetchedDate` +
`heldPrices` + `lastRun.marketTickerCount` (total tickers in the Polygon response, 0 on empty/error) only on non-empty response) → `UPDATE_POSITION` dispatch for
each held Equity/ETF symbol found in the response → (unawaited) `tickerOverview.ts`'s
`syncTickerOverviews(heldSymbols, apiKey, positions, dispatch, onError, onSuccess?)`: for each held symbol not
already in the `ticker_overviews` `marketDataDb` cache, fetches Polygon's Ticker Overview endpoint
(`GET /v3/reference/tickers/{ticker}`), caches `{ name, sicDescription }` via `putTickerOverview`, and
dispatches `UPDATE_POSITION` (`patch: { name }`) for every matching held position; per-ticker fetch/parse
failures are caught and never rethrown (so the loop always completes), never touch `priceSync` state, and
are surfaced only via `tickerOverviewErrors` — `App.tsx` local state (`Record<ticker, message>`) passed as a
prop to `QuotesPage.tsx` for its failure banner.

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
