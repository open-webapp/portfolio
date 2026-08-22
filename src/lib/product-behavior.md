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

Settings > Price Sync tab (alongside Drive Sync and Change Encryption Password) fetches daily closing prices for held Equity/ETF positions from Polygon.io.

### Settings UI

- **API Key field**: masked (password-style) input. Committed on blur (click/tab away), not on every keystroke.
- **"Fetch prices now" button**: disabled while a fetch is in progress or when no API key is set. Label reads "Fetching prices..." while running.
- **Status text**: last run date/time, count of positions updated, and a "not found" list of held symbols absent from that day's data. Shows "Never run" before the first fetch.
- No automatic or manual fetch happens at all until an API key is entered.

### Automatic Fetch (load + tab focus)

Runs after hydration/unlock on app load, and again whenever the browser tab regains focus (switching back to it) — no fixed timer. At most one real price update happens per calendar day: the app tracks the last date it successfully fetched prices for, and each trigger tries to advance to the next business day (skipping Saturday/Sunday) after that date. If today's data isn't published yet (market not yet closed, or provider hasn't posted it), the attempt is a no-op and it retries on the next trigger — no duplicate fetching, no getting stuck.

### Manual Fetch

The "Fetch prices now" button runs the identical fetch/update logic as the automatic trigger, on demand.

### On a Successful Fetch

- Held Equity or ETF positions whose symbol is found in that day's price data: price is updated to the new value.
- Symbols not found in the response: left untouched, listed under "not found" in the status text — expected (e.g. delisted symbol, data gap), not shown as an error.
- Other asset classes (Fixed Income, Cash, Crypto, etc.) are never touched by price sync.

### Interaction with CSV Positions Import

If a Positions CSV is imported for an account after prices have already synced for today, the synced (API) price wins over the CSV file's price, for that account's Equity/ETF positions only. Other asset classes use whatever price the CSV provides, as usual.

### Out of Scope (this phase)

No per-position "last synced/updated" label is shown in the Positions table — planned for a future phase.

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
