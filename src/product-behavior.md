# product-behavior.md (app-level)

User-visible behavior. Sibling: `design.md` (architecture). Module-specific: `src/lib/design.md`.

## Multi-Portfolio (most detailed — recently shipped)

### Navigation model

- URL hash is the sole source of navigation/routing state — no separate in-memory "current portfolio" pointer is ever persisted.
- `#/` (or empty hash, or any hash not matching `#/portfolio/<id>`) → **Portfolio Picker** screen.
- `#/portfolio/<id>` → that portfolio's app (gate → shell). `<id>` not found among registered portfolios (either not yet loaded, or truly unknown) → silently redirected to `#/` (picker). No error page is ever shown for a bad/unknown id.
- Directly editing the URL, browser back/forward, or bookmarking `#/portfolio/<id>` all work as first-class navigation — the app re-resolves state from the hash on every change.

### Portfolio Picker

- Lists every registered portfolio as a row: name (click to rename inline), an **Open** button, a **Delete** link.
- **Create**: name input + Create button below the list. Duplicate name (case-insensitive, trimmed — `"Foo"` and `"  foo  "` collide) is rejected with an inline error message; does not crash or navigate away.
- **Rename**: click the name to enter inline edit mode. Save on blur or Enter; cancel (revert, no save) on Escape. Saving an unchanged name (trim/case-equal to current) is silently skipped — no rename call, no error. Saving a name that collides with a DIFFERENT portfolio is rejected inline (renaming a portfolio to its own current name is always allowed, never treated as a collision).
- **Delete**: requires a native `window.confirm` ("Delete portfolio "X"? This cannot be undone.") before proceeding. Confirmed delete is immediate, irreversible, and local-only — it deletes the portfolio's IndexedDB database and its registry row, but never touches any Google Drive backup (an orphaned Drive folder, if one existed, is left in place intentionally).
- **Open**: navigates to `#/portfolio/<id>`.

### Switch Portfolio (in-app)

- Nav bar (visible once inside an unlocked portfolio) has a "Switch Portfolio" icon button next to the sync and settings buttons. Clicking it navigates back to `#/` (the picker) — it does not lock/reset the current portfolio's saved data, it only leaves that portfolio's screen.

### First-boot legacy migration

- A user who already had data before multi-portfolio support shipped (an existing `portfolio_app_state_v1` IndexedDB database) sees **no migration prompt of any kind**. On first load after the upgrade, the app silently registers that existing database as a portfolio named "My Portfolio" and it becomes reachable at its own `#/portfolio/<id>`. Their existing accounts/positions/transactions/password/Drive connection are all unchanged — the underlying database is never renamed, copied, or altered.
- This migration is idempotent and one-time: it only runs when the portfolio registry is completely empty; once any portfolio exists (migrated or newly created), it never runs again.
- A first-time user (no legacy database, empty registry) lands on the picker with an empty list — they must create a portfolio to proceed. There is no auto-created default portfolio for a brand-new install.

### Per-portfolio isolation

- **Password / encryption gate**: each portfolio has its own independent password gate — its own "absent / legacy-plaintext / encrypted" state, unlocked with its own password, against its own database. Unlocking one portfolio has no effect on any other portfolio's lock state.
- **Drive connection**: each portfolio (other than the migrated legacy one) has its own independent Google Drive connection/token. Connecting Drive while inside one portfolio never connects, disconnects, or otherwise affects any other portfolio's Drive connection. The migrated legacy portfolio specifically keeps using its pre-upgrade Drive connection (no re-auth forced on upgrade).
- **Drive backup location**: each portfolio's Drive backup lives in its own named subfolder (`OpenWebApp/Portfolio/{portfolio name}/portfolio-state.json`). Renaming a portfolio moves future backups to a folder matching the new name — the old-named folder is left behind, not renamed or deleted. The migrated legacy portfolio's pre-upgrade flat-root backup file is moved into its own subfolder automatically, once, the first time a Drive connection is active after upgrade (silent, no prompt).
- Switching directly between two portfolio routes (e.g. via browser back/forward, bypassing the picker) fully resets the in-memory unlock session (password/session key, hydrated app state) before the new portfolio's gate is shown — one portfolio's decrypted data is never visible while looking at another's screen.

## Pre-Existing Behavior (all portfolios)

### Password gate / encryption

- On first use of a portfolio (no data yet): set a new password (`SetPasswordScreen`).
- On a pre-encryption legacy plaintext blob: prompted through the same set-password screen, which migrates the plaintext data into the newly-chosen password's encrypted envelope.
- On an existing encrypted blob: `EnterPasswordScreen` prompts for the password; wrong password fails to decrypt (no partial/garbled data shown).
- Auto-lock: session locks after 2 hours absolute OR 5 minutes of inactivity (mouse/keyboard/touch/scroll all count as activity), checked every 30 seconds and on tab refocus. Locking flushes any pending save first, then returns to the password-entry screen (same password unlocks again — data isn't cleared).
- "Reset" (from the gate) clears the persisted state for that portfolio's database and returns to the initial "set a password" screen — destructive, portfolio-scoped only.

### CSV Import

- Positions and Transactions each import via a dialog (`ImportDialog.tsx`) that maps CSV headers to fields, using or creating reusable per-account "mapping profiles."
- First-seen account numbers prompt the user to create/resolve the matching `Account`.
- Re-importing Positions for an account replaces that account's full position list; symbols that disappear become `ClosedPosition`s (with realized G/L computed from matching Sell transactions when available, otherwise left unknown — never fabricated).
- Re-importing Positions for the same account on the same calendar day replaces that day's portfolio snapshot rather than creating a duplicate.
- Transactions dedup per-account by `date|symbol|type|shares|price` — re-importing the same transaction twice is a no-op.

### Views

- **Positions (Accounts)**: account/category drill-down, position tables, allocation chart, closed-positions table with undo.
- **Register**: per-account chronological activity/balance ledger; balance-entry dialog supports multiple activities per entry (contribution/withdrawal/transfer/dividend/fee).
- **Quotes**: read-only table of every held Equity/ETF/Mutual Fund symbol, current price/status/last-updated, with a search box; shows a failure banner when a Polygon name lookup fails for any symbol.
- **Settings**: three tabs — Backup (Drive connect/sync/restore), Encryption (change password), Quotes API Key (Polygon + Alphavantage key entry, manual "fetch now" triggers, last-run status per provider).

### Drive backup / restore / conflict

- Manual-only sync (a "Sync" button in Nav and Settings) — no automatic background sync.
- Successful sync uploads the current encrypted state as `portfolio-state.json` under the portfolio's Drive folder.
- If the remote file changed since the last known baseline, a spurious-drift check first tries a silent re-adopt-and-repush when the remote's actual content time is no newer than the last restore; only a genuinely newer remote triggers the **Sync Conflict** dialog, letting the user choose "keep remote" or "push local" (remote-wins is not automatic — user decides).
- Restoring a backup encrypted with a different password surfaces a specific "different password" message rather than a generic failure.
- Drive restore also supports picking an arbitrary file via Google Picker (`DriveRestorePanel`) and restoring from a locally-selected file (`GateRestoreFromFilePanel`), independent of the app's own by-name backup lookup.
