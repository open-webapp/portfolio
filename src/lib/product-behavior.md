# product-behavior.md

User-visible behavior, edge cases, keyboard interactions, URL state.

## Positions

### Closed Positions — Undo

Click Undo on a closed position to restore it instantly, using the exact snapshot (shares, avgCost, price, assetClass, lastImportedAt) captured at close time — no dialog, no manual field entry.

- No open position with the same symbol in the account: silent restore, no confirmation.
- Open position with same symbol and identical shares/avgCost/assetClass: `window.confirm` asks to overwrite. Yes → restored position replaces the existing one, closed entry removed. No → cancels entirely; closed position stays closed, nothing changes.
- Open position with same symbol but different shares/avgCost/assetClass: silent restore as a second, separate lot — duplicate symbol rows coexist, no confirmation shown.
- Restored position always gets a new internal id (not user-visible).

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
