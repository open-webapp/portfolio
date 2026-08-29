# product-behavior.md

User-visible behavior, edge cases, keyboard interactions, URL state.

## Positions

### Closed Positions — Undo

Click Undo on a closed position to restore it instantly, using the exact snapshot (shares, avgCost, price, assetClass, lastImportedAt) captured at close time — no dialog, no manual field entry.

- No open position with the same symbol in the account: silent restore, no confirmation.
- Open position with same symbol and identical shares/avgCost/assetClass: `window.confirm` asks to overwrite. Yes → restored position replaces the existing one, closed entry removed. No → cancels entirely; closed position stays closed, nothing changes.
- Open position with same symbol but different shares/avgCost/assetClass: silent restore as a second, separate lot — duplicate symbol rows coexist, no confirmation shown.
- Restored position always gets a new internal id (not user-visible).

### Closed Positions — Accounts Page Scoping

Closed positions are viewable per-account on the Accounts page via a Closed Positions card:

- Only accounts with ≥1 closed position display a Closed Positions card.
- Realized G/L total: sum of all `realizedGL` values for the account's closed positions, excluding entries with unknown basis (`realizedGLBasis: 'unknown'`). Displays `—` when all entries in scope are unknown-basis.
- Undo and delete behavior is unchanged (see "Closed Positions — Undo" above).

## Price Sync

Settings > "Quotes API Key" tab (alongside Drive Sync, Download, and Change Encryption Password) fetches daily closing prices for held Equity/ETF positions from Polygon.io.

Mutual Fund holdings sync separately via Alphavantage — see "## Mutual Fund Price Sync" below.

### Settings UI

- **API Key field**: masked (password-style) input. Committed on blur (click/tab away), not on every keystroke.
- **"Fetch prices now" button**: disabled while a fetch is in progress or when no API key is set. Label reads "Fetching prices..." while running.
- **Date input** (next to the button): optional `YYYY-MM-DD` date picker. Empty (default): fetch uses the normal auto-computed next-business-day date. A date entered here fetches that exact date instead, bypassing the auto-computed date entirely — for backfilling a missed day or re-checking a specific date.
- **Status text**: last run date/time, then either an error message (API request failed, e.g. invalid/unauthorized API key) or the total number of tickers Polygon returned for that day (market-wide, not just held symbols) plus the count of positions updated plus a "not found" list of held symbols absent from that day's data. Shows "Never run" before the first fetch.
- **Price table**: the API Key/Fetch/status controls live under a tab now labeled "Quotes API Key" (same `settingsSection === 'priceSync'` tab as before, relabeled). The price/name table itself has moved to the new Quotes page — see "## Quotes" below.
- No automatic or manual fetch happens at all until an API key is entered.

### Automatic Fetch (load + tab focus)

Runs after hydration/unlock on app load, and again whenever the browser tab regains focus (switching back to it) — no fixed timer. At most one real price update happens per calendar day: the app tracks the last date it successfully fetched prices for, and each trigger tries to advance to the next business day (skipping Saturday/Sunday) after that date. If today's data isn't published yet (market not yet closed, or provider hasn't posted it), the attempt is a no-op and it retries on the next trigger — no duplicate fetching, no getting stuck.

### Manual Fetch

The "Fetch prices now" button runs the identical fetch/update logic as the automatic trigger, on demand. If a date is entered in the adjacent date input, that date is fetched directly instead of the auto-computed one; on success, the tracked "last fetched" date is set to it, so the next automatic fetch continues forward from that date (which can mean re-fetching or skipping days relative to the normal one-business-day-at-a-time sequence — expected for a deliberate manual/backfill fetch).

### On a Successful Fetch

- Held Equity or ETF positions whose symbol is found in that day's price data: price is updated to the new value.
- Symbols not found in the response: left untouched, listed under "not found" in the status text — expected (e.g. delisted symbol, data gap), not shown as an error.
- Other asset classes (Fixed Income, Cash, Crypto, etc.) are never touched by price sync.
- After every successful fetch (automatic or manual), name/SIC enrichment for held Equity/ETF symbols also runs in the background — see "## Quotes" below for details.

### On a Failed Fetch (HTTP error, e.g. invalid/unauthorized API key)

A non-2xx HTTP response for a *past* date is distinct from "no data for this date": it's shown as an error message in the status text instead of a "not found" list, so an invalid or unauthorized API key doesn't look like every held symbol is simply missing from the data. `lastFetchedDate` is not advanced; retried on next trigger.

A 403 for *today's* date is not treated as an error even though it's the same HTTP status — Polygon rejects requests for the current calendar day's grouped bars until end of day regardless of plan, so this is expected and handled the same as "no data yet": shown as a "not found" list, not an error, retried on next trigger.

### Interaction with CSV Positions Import

If a Positions CSV is imported for an account after prices have already synced for today, the synced (API) price wins over the CSV file's price, for that account's Equity/ETF positions only. Other asset classes use whatever price the CSV provides, as usual.

### Out of Scope (this phase)

No per-position "last synced/updated" label is shown in the Positions table — planned for a future phase.

## Mutual Fund Price Sync

Settings > "Quotes API Key" tab, second sub-block labeled "Alphavantage API Key (Mutual Funds)" — fetches daily closing prices and display names for held Mutual Fund positions from Alphavantage, independent of the Polygon flow above.

### Settings UI

- **API Key field**: masked (password-style) input, same commit-on-blur behavior as the Polygon key.
- **"Fetch mutual fund prices now" button**: disabled while a fetch is in progress or when no Alphavantage key is set. No date picker — Alphavantage's TIME_SERIES_DAILY always returns the latest close, so there's no date-targeting like the Polygon flow.
- **Error list**: this sub-block shows only Alphavantage failures (`mutualFundSyncErrors`); Polygon errors never appear here, and Alphavantage errors never appear in the first (Polygon) sub-block.

### Automatic Fetch (load + tab focus + 60s retry)

Runs after hydration/unlock on app load and on tab focus, same as the Polygon flow. Additionally, a shared 60-second background interval retries either sync (Polygon or Mutual Fund) if it has unfinished work — for Mutual Fund, "unfinished" means at least one held symbol has a stale/missing price and the daily call budget isn't exhausted.

### Manual Fetch

The "Fetch mutual fund prices now" button runs the identical fetch/update logic as the automatic trigger, on demand.

### Name and Price Lookup

- **Name lookup** (Alphavantage SYMBOL_SEARCH): once per symbol, ever. Result is cached in the same `ticker_overviews` store Polygon uses, with an empty SIC description (Alphavantage doesn't provide one). A no-match result is also cached (permanently not-found) and never retried — same as the Polygon not-found behavior below.
- **Price lookup** (Alphavantage TIME_SERIES_DAILY): once per symbol per calendar day.
- `Position.price` is never updated by this sync (out of scope) — only `Position.name`.

### Daily Budget

At most 25 Alphavantage calls per day (name + price lookups combined), tracked in `mutualFundSync.callBudget` and persisted across reloads. Resets at midnight (calendar day rollover). If the cap is hit mid-run, progress is not reset — the next run picks up where it left off, only the day's used-count resets at rollover.

### Rate Limiting

Alphavantage signals rate limiting via a "Note" or "Information" field in an otherwise-200 response (not an HTTP 429). The app backs off a minute and retries — same silent-until-surfaced-in-Settings failure handling as the Polygon flow. Mutual fund sync errors show only in Settings, never on the Quotes page.

## Quotes

Nav has a "Quotes" tab next to "Accounts". Full-page, read-only table of currently-held Equity/ETF and Mutual Fund tickers, merged into one symbol-sorted table.

- **Row set**: one row per unique symbol currently held across all accounts, Equity/ETF/Mutual Fund only (effective class = manual override if set, else asset class). A symbol disappears once fully sold/closed and appears immediately when bought — independent of whether a price sync has run for it.
- **Columns**:
  - **Ticker**: the symbol.
  - **Name**: company/fund name, fetched lazily in the background (see enrichment below); `—` until fetched.
  - **Asset Class**: Equity, ETF, or Mutual Fund.
  - **Status**: "OK" (priced today), "Pending" (Mutual Fund only — fetched but not yet priced today, or never priced), or "Not found" (red — no match this run: Polygon's `notFound` list for Equity/ETF, or no Alphavantage SYMBOL_SEARCH match for Mutual Fund).
  - **Price**: last synced price, else last cached daily bar close as fallback (Equity/ETF only), else `—`. Mutual Fund rows never fall back to bar-cache pricing — there is none for them.
  - **Held**: always "Yes" on this page (row set is holdings-only).
  - **Last Updated (UTC)**: the exact UTC timestamp Polygon reported for that day's cached bar (Equity/ETF only), else `—` if no cached bar yet, the timestamp is missing/invalid, or the row is a Mutual Fund.
  - **SIC Description**: industry classification from the ticker overview fetch; `—` if not yet fetched or if the row is a Mutual Fund (Alphavantage doesn't provide one).
- **Search box**: live filter across ticker, name, status, and SIC description, case-insensitive, every keystroke.
- **Empty state**: "No holdings to show." when there are no currently-held Equity/ETF/Mutual Fund positions.
- Mutual fund sync errors (`mutualFundSyncErrors`) are not shown on this page — only in Settings, next to the Alphavantage key.

### Name/SIC Enrichment

- Runs automatically in the background after every price sync (automatic or manual) — fetches Polygon's Ticker Overview for each held Equity/ETF symbol not already cached. Independent of price-date catch-up: a long-running name sync (e.g. working through a rate-limit backoff) never blocks or delays the periodic price-sync retry poll, and vice versa.
- Fetched once per ticker, never re-fetched once successful (names/SIC don't change). ETF/fund tickers (e.g. `SCHD`) omit `sic_description` in Polygon's response — that's expected, not a malformed response; only `name` is required, `SIC Description` shows `—` for these.
- A ticker Polygon reports as `NOT_FOUND` (`status: "NOT_FOUND"` in the body, regardless of whether the HTTP status itself is 2xx) is cached as permanently not-found and never retried again — shown as "Not found" on the Quotes page.
- Other failures (bad key, network issue) are silent everywhere else in the app — not shown as a price-sync error in Settings — but surface as a small note on the Quotes page itself: "Could not fetch name for: XYZ". A failed ticker stays uncached, so it's retried automatically on the next sync.
- Rate-limited (429) requests back off and retry the same ticker on a timer until they succeed or fail for a non-rate-limit reason, so one sync call drives every held symbol to completion.

## Balance Register

Manual balance tracking for accounts, independent of Positions/Transactions. `register.ts` holds the pure math; `state.ts`'s `addBalanceEntries` holds persistence rules.

### Ledger Math

- `change = balance - previous entry's balance` (per account, sorted date-asc). First entry in an account: `change` is `null`.
- `attributed = sum over entry.activities of (ACTIVITY_SIGN[activity.type] ?? 0) * activity.amount`. Signs: `Contribution`/`Transfer In`/`Dividend` = `+1`; `Withdrawal`/`Transfer Out`/`Fee` = `-1`; `None`/unmapped = `0`.
- `unexplained = change - attributed`. `null` when `change` is `null` (first entry).

### Chart (Balance Over Time)

- X axis scaled by real elapsed time between the first and last entry date in scope (calendar-day span), not by index/point count — unevenly-spaced entries render proportionally to their actual date gaps.
- Single entry in scope: point renders centered (no meaningful time span).
- Y-axis range padding: 15% of the value range (max − min) added above and below; if range is 0 (flat balance), pads by 5% of the max value instead (so a flat line still shows visible headroom).

### Paste-Mode Field Matching

- Pasted column headers are matched to register fields (date, accountId, balance, activityType, activityAmount, note) by exact header match first; if no exact match, a substring/hint match against `BALANCE_FIELD_HINTS` (e.g. a header containing "balance"/"value"/"total" maps to the balance field).
- Account name/number matching (`matchAccountId`): tries account id, name, account number, and "institution — name" exact matches (case-insensitive), then partial name-substring match either direction; no match → empty string (row flagged invalid, not silently mis-assigned).
- Activity type matching (`matchActivityType`): exact case-insensitive match against `ACTIVITY_TYPES`, then prefix match; no match (or empty input) → `'None'`.
- A pasted row still maps to 0-or-1 activities (single activityType/activityAmount pair → `entry.activities` array of length 0 or 1); multi-activity paste is out of scope.

### Replace, Not Append

Saving balance entries for an account/date combination that already has an entry replaces it rather than creating a duplicate — natural key is `(accountId, date)`, same replace-on-reimport pattern as Positions (see `src/lib/design.md`).

## Google Drive Sync

### Drive Connection Persistence

On app load, the app checks for a stored Google Drive connection (non-blocking, parallel with other initialization). If a connection exists and the cached token is still valid, the app displays "Connected as user@gmail.com" on the Restore tab without re-prompting. If the token is expired or no connection exists, the Restore tab shows a "Connect Google Account" button.

The app does **not** automatically look up the backup file ID on load — file lookup only happens when the user clicks "Restore" and a fresh connection is confirmed.

### Restore from Google Drive

When the user clicks "Restore from Drive" on the Restore tab (PasswordGate) or Settings > Drive, a Google File Picker dialog opens immediately — there is no automatic lookup of a backup by name in the app's own folder first. Picker is the only restore entry point.

1. **Picker opens on click**: Picker's starting folder defaults to the app's own `OpenWebApp/Portfolio` Drive folder, but the user can navigate to any other folder they have access to using Picker's built-in navigation.
2. **File selection**: After the user picks a file, the app asks for confirmation ("Restore will replace all data..."). Restore proceeds with the current session password via `restoreBackupFromFileId`.
3. **Cross-password restore**: If the backup was encrypted with a different password, the app prompts "This backup was saved with a different encryption password. Enter that password to restore:". After the user enters the backup's password and confirms, the app reattempts restore. If the password is wrong, the error is shown and Picker reopens for another attempt.

### Restore Behavior Details

- **No automatic file lookup, ever**: The app never automatically probes for a backup file by name, neither on app startup nor on Restore click. Picker is always the mechanism for choosing which file to restore.
- **Picker cancellation**: If the user closes the Picker dialog without selecting a file, the Picker can be reopened by clicking "Restore from Drive" again.
- **OAuth + API key required**: Picker needs both a valid Google OAuth token and a configured Picker API key (`VITE_GOOGLE_PICKER_API_KEY`) to open. If a valid cached OAuth token exists, no auth window appears — Picker opens directly with the cached token. If the token is expired, the standard Google auth flow runs before Picker opens. A missing API key surfaces as an explicit error in the Picker fallback UI, not a silent failure.

### Sync Conflict

Manual "Sync to Drive" button only — no auto-sync path exists. Conflict is caught on write: `syncBackup` throws `RemoteChangedError` when the Drive file moved since this device's baseline. `reason` is either `'remote-changed'` (file modified since this device last restored) or `'never-restored'` (this device never established a baseline). Detected by `error.name` string match, not `instanceof`.

- **File-id resolve**: known `backupFileId` → `error.fileId` → `getBackupFileId()`. None resolves → keeps the plain `alert('Sync failed: …')`, no dialog.
- **Dialog** (title "Drive backup changed"): shows remote-backup modified time and local last-restored time — each `—` when missing or unparseable, else `new Date(iso).toLocaleString()`. Three buttons, all disabled while an action is pending; inline error region below the times.
  - **Overwrite local with remote**: reads + decrypts the Drive file, applies it via `__SET_STATE`, closes the dialog. The existing debounced local-persist effect writes it to IndexedDB afterward — no explicit persist call. Advances the drive-sync restore baseline.
  - **Overwrite remote with local**: `files.read` the remote file to adopt its version as the new baseline (content discarded), then re-writes local state with `syncBackup`. On success: records the backup file id, closes the dialog, `alert('Synced to Drive')`.
  - **Cancel**: closes the dialog, nothing changes on either side.
- **Wrong-password backup** (`DriveDecryptError` from either overwrite path, matched by `err.name`): inline text "This Drive backup was saved with a different password. Use Settings > Drive > Restore from Drive to enter it." Dialog stays mounted; no inline cross-password prompt — a differently-encrypted backup is Settings-only.
- **Post-read (push) race** (remote moved again between the baseline read and the re-write — a second `RemoteChangedError`, or any other throw): generic inline error "Drive changed again — close and retry sync." Dialog stays open, no retry loop.

## Import/Export

Settings > "Download" tab (between Google Drive and Encryption; module code is `importExport.ts`, internal `settingsSection` value `'importExport'`). Fully local file download — no Google Drive interaction, independent of Drive sync/auth state.

### Download

- Single "Download Backup" button. Silent — no password prompt, no confirm dialog.
- Downloads `ledger-backup-YYYY-MM-DD.json` (today's local date, zero-padded).
- File content is an `EncryptedEnvelope` (`{version, salt, iv, ciphertext}`), encrypted with the current session's key/salt (the user's currently-unlocked encryption password).

### Upload

Restore-from-file moved to the pre-unlock password gate ("Restore from Backup File" tab) — no longer in Settings. See root `product-behavior.md`'s `## Password gate` section for current behavior.
