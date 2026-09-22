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
- **Delete**: requires a native `window.confirm` ("Delete portfolio "X"? This cannot be undone.") before proceeding. Confirmed delete is immediate, irreversible, and local-only — it deletes the portfolio's IndexedDB database and its registry row, but never touches any Google Drive backup (an orphaned Drive folder, if one existed, is left in place intentionally). Works on a locked/encrypted portfolio without unlocking it — only the registry id is needed, never that portfolio's password.
- **Open**: navigates to `#/portfolio/<id>`.

### Shell navigation

- The desktop left rail starts with `Switch portfolio`, followed by Budget, Positions, Register, Quotes, then (when connected or syncing) Sync above Settings. Switch portfolio returns to `#/` without changing saved data.
- On desktop, application content begins to the right of the fixed 76px navigation rail. At viewport widths of 480px or less, the rail moves to the bottom and content uses the full width.
- The mobile bottom rail preserves this order: Switch portfolio, main views, Sync when shown, Settings.
- The top-bar strip is period-control-only. Budget shows the four-tab control and, for Spend, a same-row right-aligned year All/year selector; non-Budget views retain an intentionally blank strip.
- Browser title is `Ledger` until an active portfolio is unlocked and hydrated, then `Ledger | {portfolio name}`. It returns to `Ledger` when leaving that ready portfolio state.

### First-time / empty registry

- A first-time user (empty registry) lands on the picker with an empty list — they must create a portfolio to proceed. There is no auto-created default portfolio for a brand-new install.
- Whoever's registry already contains a pre-multi-portfolio row (dbName `portfolio_app_state_v1`, from before this app auto-seeded that row on upgrade) keeps opening it exactly as before — that row itself is never touched. There is no code path left that creates a new row like this from scratch.

### Per-portfolio isolation

- **Password / encryption gate**: each portfolio has its own independent password gate — checked against its own database (never a hardcoded or shared one), unlocked with its own password. (A newly-created or imported portfolio never shows this gate at all — it's set up and unlocked inline in the Portfolio Picker before the portfolio is ever opened.) Unlocking one portfolio has no effect on any other portfolio's lock state.
- **Drive connection**: each portfolio (other than the one legacy pre-multi-portfolio row, if one exists in the registry) has its own independent Google Drive connection/token. Connecting Drive while inside one portfolio never connects, disconnects, or otherwise affects any other portfolio's Drive connection. That one legacy portfolio specifically keeps using its pre-upgrade Drive connection (no re-auth forced).
- **Drive backup location**: each portfolio's Drive backup lives in its own named subfolder (`OpenWebApp/Portfolio/{portfolio name}/portfolio-state.json`). Renaming a portfolio moves future backups to a folder matching the new name — the old-named folder is left behind, not renamed or deleted. That one legacy portfolio's pre-upgrade flat-root backup file is moved into its own subfolder automatically, once, the first time a Drive connection is active (silent, no prompt).
- Switching directly between two portfolio routes (e.g. via browser back/forward, bypassing the picker) fully resets the in-memory unlock session (password/session key, hydrated app state) before the new portfolio's gate is shown — one portfolio's decrypted data is never visible while looking at another's screen.

## Pre-Existing Behavior (all portfolios)

### Password gate / encryption

- A new or imported portfolio never reaches this gate — its password is set inline in the Portfolio Picker (see `PortfolioPicker.product-behavior.md`) and it opens already unlocked.
- On a pre-encryption legacy plaintext blob (the one pre-multi-portfolio database migrated into a portfolio row): prompted through `SetPasswordScreen`, which migrates the plaintext data into the newly-chosen password's encrypted envelope.
- On an existing encrypted blob: `EnterPasswordScreen` prompts for the password; wrong password fails to decrypt (no partial/garbled data shown).
- Auto-lock: session locks after 2 hours absolute OR 5 minutes of inactivity (mouse/keyboard/touch/scroll all count as activity), checked every 30 seconds and on tab refocus. Locking flushes any pending save first, then returns to the password-entry screen (same password unlocks again — data isn't cleared).
- "Back to portfolios" (from the gate, a plain text link, no confirmation step) navigates to the portfolio picker (`#/`) without touching this portfolio's data — the recovery path for a forgotten password is to delete the locked-out portfolio from the picker instead (see the picker's Delete behavior above), which never requires that portfolio's password.

### CSV Import

- Positions and Transactions each import via a dialog (`ImportDialog.tsx`) that maps CSV headers to fields, using or creating reusable per-account "mapping profiles."
- First-seen account numbers prompt the user to create/resolve the matching `Account`.
- Re-importing Positions for an account replaces that account's full position list; symbols that disappear become `ClosedPosition`s (with realized G/L computed from matching Sell transactions when available, otherwise left unknown — never fabricated).
- Re-importing Positions for the same account on the same calendar day replaces that day's portfolio snapshot rather than creating a duplicate.
- Transactions dedup per-account by `date|symbol|type|shares|price` — re-importing the same transaction twice is a no-op.

### Views

- **Budget**: four App-owned tabs — Expenses, Spend, Analytics, Category Mapping. Spend is the session default; period and All/year scope remain while navigating away and back, but reset on reload. Category Mapping waits for global-store hydration. Selecting a concrete Spend year without a snapshot creates it; All does not. Imports require an account and canonicalize imported signs before dedup. CSV/OFX/QFX parsers do not change. Spend-row Category mappings dialogs keep their header visible and scroll long mapping lists within the viewport.
- **Positions (Accounts)**: account/category drill-down, position tables, allocation chart, closed-positions table with undo.
- **Register**: per-account chronological activity/balance ledger; balance-entry dialog supports multiple activities per entry (contribution/withdrawal/transfer/dividend/fee).
- **Quotes**: read-only table of every held Equity/ETF/Mutual Fund symbol, current price/status/last-updated, with a search box; shows a failure banner when a Polygon name lookup fails for any symbol.
- **Settings**: three tabs — Backup (Drive connect/sync/restore), Encryption (change password), Quotes API Key (Polygon + Alphavantage key entry, manual "fetch now" triggers, last-run status per provider).
- **Budget**: active categories named exactly `Income` (trimmed/case-insensitive) derive read-only budgeted and signed actual income. Income is excluded from spend by default; Show excluded reveals those records.

### Drive backup / restore / conflict

- Manual-only sync (a rail `Sync` button and Settings) — no automatic background sync. The rail button appears when connected, and stays visible only for the duration of an already-running sync if connection state becomes false; that in-flight button spins, is disabled, and reads `Syncing`.
- Successful sync uploads the current encrypted state as `portfolio-state.json` under the portfolio's Drive folder.
- If the remote file changed since the last known baseline, a spurious-drift check first tries a silent re-adopt-and-repush when the remote's actual content time is no newer than the last restore; only a genuinely newer remote triggers the **Sync Conflict** dialog, letting the user choose "keep remote" or "push local" (remote-wins is not automatic — user decides).
- Restoring a backup encrypted with a different password surfaces a specific "different password" message rather than a generic failure.

New portfolio creation and import (from a Drive folder or a local backup file) happen entirely in the Portfolio Picker, before any portfolio-scoped gate is shown — see `src/components/PortfolioPicker.product-behavior.md`.
