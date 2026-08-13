# Product Behavior — Ledger (Portfolio Dashboard)

See also: [design.md](design.md), [schema-spec.md](schema-spec.md)

Local-first, single-user portfolio tracker. No live price feed — all values come from user-imported CSVs. No Watchlist/Alerts feature (out of scope; must never reappear — grep `watchlist` case-insensitive in `src/` must return nothing).

## Layout

Dashboard view, top to bottom: `Nav` → `OverviewCard` (2-segment layout) → divider block → category `.seg` tabs (All/Taxable/Non-Taxable/Tax-Deferred) → `AllocationChart` (2-column grid) → divider → asset-class filter `.seg` control + "Import" button row → `PositionsTable`. Accounts view: 2-column layout with collapsible category cards (left, 360px) and flexible right panel with allocation chart, asset-class filter, and aggregate positions table, see "Accounts page" section below.

## Nav

Nav renders on all views (dashboard, accounts, settings). Single always-visible `.seg` with two tabs:

- **Brand**: `.nav-brand` "Ledger".
- **Dashboard tab**: labeled "Dashboard", active when `state.view === 'dashboard'`, dispatches `SET_VIEW` on click.
- **Accounts tab**: labeled "Accounts", active when `state.view === 'accounts'`, dispatches `SET_VIEW` on click. Neither tab is active when viewing Settings.
- **Sync Now icon button** (refresh icon, `title="Sync now"`): shown only when Drive is connected (`driveReady`); disabled while a sync is in progress (`syncing`). Triggers the same sync action as the Settings page's own "Sync Now" button.
- **Settings gear** (SVG icon): navigates to the Settings page (resets `settingsSection` to "Google Drive" on every open).

## Overview card

Two-segment grid layout (`.card` elements side-by-side), computed live via `segmentCards(state, true/false)`:

- **Retirement segment** — left card, labeled "Retirement" (muted, uppercase, 10px).
  - **Total Value** — heading (font-family heading, 15px, weight 600) showing sum of `shares * price` across all positions in `state.accounts` where `account.retirement === true`.
  - **G/L tag** — colored `.tag` below, showing combined signed gain-loss as `+$X.XX (+Y.YY%)` format (G/L amount + percentage), colored green/red by sign. Percentage computed as `gl / costBasis * 100`, treating 0 cost basis as `0%`.
- **Non-Retirement segment** — right card, same structure, filtered by `account.retirement === false`.

Both segments ignore the current category filter (they are global, not scoped to selected category). "All Together" and "Amount Invested" clusters are no longer shown.

## Allocation chart

Reusable `.card.blueprint.elev-sm` component taking `positions: Position[]` and `title: string` props. Renders a 2-column grid grouped by *effective* asset class (`assetClassManualOverride || assetClass`), computed via `allocationBars(positions)`. Each cell shows: class label + USD value inline (12px font), percentage right-aligned (muted), and a compact horizontal bar (height 6px, accent color fill) sized to percentage of total portfolio value.

- **Dashboard usage** — called with category-filtered positions (via `positionsForCategory(state)`) and title "Allocation".
- **Accounts page usage** — called with selection-scoped positions (all accounts, or single account) and title `"Allocation — All Accounts"` or `"Allocation — {account.name}"` per selection state.
- Empty positions list → empty grid with no crash.

## Positions table

Rows are **aggregate groups** — each row represents a unique combination of symbol + effective asset class only. Tax category and retirement status no longer partition groups; positions with the same symbol and asset class merge regardless of account tax/retirement status. Every group, including size-1, renders as one row. Groups aggregate shares, cost basis, and market value across all underlying positions; price is derived as summed value / summed shares. **% of Portfolio** reflects positions matching the current category filter only.

- **Filters**: asset-class filter (`.seg` radio control, computed from all positions currently in state — not category-scoped — sorted alphabetically; control lives in the header row above the table in `App.tsx`) + free-text search (matches symbol or name, case-insensitive substring) + category filter all compose.
- **Columns**: Symbol (symbol + name), Asset Class (effective), Shares, Cost Basis (labeled "Avg Cost"), Current Price, Amount Invested, Market Value, G/L (signed, colored), G/L %, % of Portfolio (unsigned, one decimal, shows percentage of filtered portfolio total), Row-count badge (right-aligned, `.tag.tag-neutral`, showing count of underlying position rows merged into the aggregate group; column header is blank, still the last column).
- **Sorting**: Clicking a sortable column header (Symbol/Asset Class/Shares/Cost Basis/Current Price) toggles asc/desc via `TOGGLE_SORT`; clicking the currently-sorted column flips direction, clicking a different column resets to `asc`. Arrow (`↑`/`↓`) marks the active sort column. Sorting orders by aggregate/derived group values (e.g., summed Market Value, derived Price = summed value / summed shares), computed client-side in `PositionsTable` after grouping. Amount Invested/Market Value/G/L/G/L % columns are display-only, not sortable.
- **Row click → overlay**: Clicking any row (cursor pointer) opens `PositionGroupOverlay`, a dialog (`.dialog-backdrop`/`.dialog`, closable via Escape/backdrop-click/X button). Title: `` `Symbol — Name — Asset Class` ``. Lists underlying positions sorted by account.institution ascending, then account.name ascending, fallback account.accountNumber. **Overlay columns** (9): Account, Symbol, Name, Shares, Avg Cost, Current Price, % of Portfolio, Override, Delete. **Account display (two-line)**: line 1 shows institution—name (or name only if no institution); line 2 shows muted tax category and retirement labels (e.g., "Taxable • Retirement"). **Editable cells**: Account (dropdown button listing all accounts; selecting one dispatches `UPDATE_POSITION` with `patch: { accountId }`), Symbol (`<input type="text">`, click-to-edit, empty/whitespace-only reverts silently, trimmed non-empty value commits), Name (`EditableTextCell`, click-to-edit via `<input type="text">`, empty/whitespace-only reverts silently, trimmed non-empty value commits), Shares/AvgCost/Price (`<input type="number">`, click-to-edit, no hover affordance). For numeric fields: valid non-negative number commits via `UPDATE_POSITION`, invalid/empty reverts silently (no error UI). All fields: Enter or blur commits; Escape reverts (no dispatch). % of Portfolio is display-only. **Side effect**: editing Symbol or Account changes a position's group key (`symbol` + `effectiveAssetClass`), so the position's row disappears from the overlay on the next render (overlay itself stays open; natural re-render consequence). **Delete column**: blank header, trash-icon button per row; clicking prompts `window.confirm('Delete this position? It will be moved to Closed Positions.')`; on confirm, dispatches `CLOSE_POSITION` which converts the position into a `ClosedPosition` (`realizedGL: null`, `realizedGLBasis: 'unknown'`, `closedDate` = today) rather than hard-deleting it — the row then disappears from the overlay on next render as a natural consequence of no longer being in `state.positions` (same side-effect pattern as editing Symbol/Account). Override column contains `AssetClassOverrideSelect` control.
- **Closed Positions** toggle: a clickable row showing "Show/Hide Closed Positions" + a badge with `state.closedPositions.length` (unfiltered — the badge is not scoped to the current category filter, even though the table itself, when shown, still lists all closed positions with no filter applied either).
- `ClosedPositionsTable` (shown when toggled): Security / Closed date / Realized G/L / Delete columns. Realized G/L renders `"unknown"` when `realizedGLBasis === 'unknown'`, otherwise a signed formatted USD amount; never a fabricated number. Delete column (centered): a trash-icon `.btn-icon` button per row; clicking it opens a native browser dialog (`Delete this closed position? This permanently discards its realized G/L history.`) — accepting removes the closed position permanently (unrecoverable).

## Transactions table

(Not rendered in Dashboard; kept for data-model and future-surface reasons.)

- Type filter tags (`All` + every distinct `Transaction.type` currently in state, alphabetical) + free-text search (symbol or date substring, case-insensitive) + category filter (from Nav).
- Always sorted by date descending — no user-controlled sort.
- Columns: Date (formatted `MMM D, YYYY`), Symbol, Type (colored tag: Buy=accent, Sell=outline, Dividend=neutral, anything else=neutral), Shares, Cost Basis, Amount Invested, Taxes (formatted USD or `—` if null), Position Link.
- **Position Link**: shows an "UNMATCHED" outline tag (with a tooltip explaining "likely fully sold or removed") when the transaction's symbol has no corresponding open `Position` among accounts in the current category; otherwise shows plain "Linked" text. This is purely derived per render — no stored flag.

## Accounts page

2-column layout accessed via the "Accounts" tab in the Nav. Left panel (360px fixed width) shows collapsible category cards; right panel (flexible) shows allocation chart, filter controls, and aggregate positions table.

**Left panel — Category cards** (Taxable / Non-Taxable / Tax-Deferred order):
- **Card header** (click to toggle expanded state): category label + account-count badge (`.tag.tag-neutral`, unfiltered count).
- **Collapsed state** (default): shows only the header with badge.
- **Expanded state**: lists account rows, each clickable (cursor pointer), styled with:
  - Institution and account name on line 1 (or name only if institution is empty), using institution—name format.
  - Tags on line 2: total value (formatted USD), account number, updated date (ISO format).
  - Click to select: dispatches `state.selectedAccountId` or toggles if already selected (toggle semantics). Global selection state persists across category expansions.

**Right panel** (flexible width):
- **Allocation chart** — top: `AllocationChart` component with positions from current selection (all accounts or single account) and title `"Allocation — All Accounts"` or `"Allocation — {account.name}"`.
- **Filter row** — asset-class `.seg` radio control (computed from all positions, not selection-scoped, sorted alphabetically) + "Import" button (same as Dashboard). Free-text search field for symbol/name filtering.
- **Aggregate Positions table** — sorted by column selection (global sort state shared with Dashboard via `state.sortBy`/`TOGGLE_SORT`). **Columns**: Symbol, Asset Class, Shares, Avg Cost, Current Price, Amount Invested, Market Value, G/L, G/L %, **% of Selection** (percentage of selection total, not whole portfolio), Row-count badge. **% of Selection** reflects only positions in the current selection (account or all). Rows are aggregate groups (symbol + asset class merge). Same interaction pattern as Dashboard PositionsTable: row click → `PositionGroupOverlay`, sortable headers with `↑`/`↓` indicators, etc.
- **Empty state**: "No positions to show." when selection has no positions.

**No longer shown**: "Subtotal row", "Cash/Investment/Total" column split, 3-section (Taxable/Non-Taxable/Tax-Deferred) table layout, dividers between sections. **Account CRUD**: remains in CSV import flow only (new-account form at import time).

## CSV import (Positions / Transactions)

A single **Import** button (`.btn.btn-secondary.blueprint` + 4 corner marks + upload SVG, `aria-label="Import"`) sits right-aligned in the asset-class filter + Import button row. It opens a 2-step `ImportDialog`:

Dialog chrome: `.dialog.blueprint` + four corner marks; width `min(96vw, 1400px)`, `max-width: 96vw`, `max-height: 88vh`, `overflow: auto`. Header row (space-between): title "Import" + ✕ close button (`aria-label="Close"`). Step indicator `[Setup, Review]` as numbered tags: active = `tag-accent`, completed = `tag-neutral`, future = `tag-outline` + muted label. Footer `.dialog-actions`: Continue / Back / primary import button.

**Step 1 — Setup** (content constrained to `max-width: 720px` so inputs don't stretch across the full dialog):
- **What are you importing?** (`.seg` radios, 2 equal columns full-width): Transactions / Positions / Holdings — default Positions.
- **Destination account** (`.seg` radios, 2 equal columns full-width): Existing account / New account.
  - Existing: `<select class="input">` with a blank `-- Select an account --` option; each option reads `{name} • #{number} — {category} — {Retirement|Non-Retirement}` (or `{name} — {category} — {Retirement|Non-Retirement}` when the account has no number).
  - New: a `2fr/1fr/1fr/1fr` grid of "New account name", "Account number", "Institution" (seeded-list combobox with free-type "Add X" affordance; required before Continue enables), "Category" select (Taxable / Non-Taxable / Tax-Deferred) + a "Retirement Account" checkbox. Institution must be filled (non-empty string) to unlock the Continue button in new-account mode.
- **Positions-only entry mode** (`.seg` radios): `Upload CSV file` (default) / `Copy-Paste` / `Enter manually`. Not rendered for Transactions.
- **CSV file** (upload mode only): dashed dropzone (upload SVG, "No file selected" / "Drag and drop, or click to browse"; once a file parses, shows `{name} ({rows} rows)`). Non-`.csv` files and empty CSVs show an inline error.
- **Copy-Paste zones** (Copy-Paste mode only): two dashed-border zones (Headers, Values). Each zone prompts `Click here and press Ctrl+V / ⌘V` until paste; on paste, shows `{n} columns/rows pasted — click to replace`. Backed by `tableToCsv()` from `pastedTable.ts`, feeding the same `csvHeaders` / `csvRows` as upload mode. When `tableToCsv()` reports row inconsistencies, a non-blocking warning appears below the Values zone: `{n} row(s) had an unexpected number of columns and were adjusted`.
- **Entry mode switching**: selecting a different entry-mode option clears any pasted clipboard state and derived headers/rows.
- **Continue** is disabled until the destination account is resolved (existing selected OR new name+number+institution filled). Upload mode additionally requires a parsed CSV with ≥1 row; manual mode does not require a file; Copy-Paste mode requires both zones populated. Close/✕ closes the dialog and fully resets local state (including entry mode back to upload).

**Step 2 — Review**:
- Destination line: `Importing into {account} · {category}` (existing-account label = `name` + ` • #number` when a number is present; category via `TAX_CATEGORY_LABELS`).
- Summary line: `Pick the file's column for each field below. {n} row(s) detected · {valid} valid. Fields marked * are required.` A `tag-outline` pill reads `{n} row(s) need fixing before you can continue` whenever any non-blank row is invalid.
- One `<table class="table">`: `<thead>` has one `<th>` per field in required-then-optional order (`*` on required). Upload mode renders mapping `<select>` controls (`— Not mapped —` + CSV headers; no constant-value option). Manual positions mode renders **no mapping selects** for non-asset-class fields. **Asset Class (positions only) always renders as a free-text `<input>` that broadcasts to untouched rows (sticky per-row override once edited).** When entering Step 2 with an existing account in upload mode, mappings can prefill from saved mapping for that account+kind, filtered to headers present in the current file. `<tbody>` renders one editable `<input>` per field per row (mapped values + user edit overlay); cells missing required fields — with `avgCost`/`purchaseAmount` and `price`/`marketValue` treated as alternatives — get red-border styling and a tinted row background.
- Each row has a trash-icon button (`.btn-icon`, `title="Delete this row"`) before the first field cell; clicking it drops that row from the preview (and from the import), re-keying later rows' edits. Fully-empty rows report no error and never block import. If every row is deleted, **Import** disables (nothing left to import).
- **Back** (`.btn.btn-secondary.blueprint`) returns to Step 1 with file, account, and edits intact.
- **Import** (primary): label `importDone ? 'Done' : 'Import'`; disabled while `!importDone && (upload mode + invalid fieldMap via isReviewValid, row errors, no preview rows, positions asset-class header empty, or manual mode has zero valid non-blank rows)`. In manual positions mode, `isReviewValid` is bypassed (fieldMap remains `{}`), and asset-class-only rows are treated as blank-equivalent for error gating. On commit, new-account mode dispatches `ADD_ACCOUNT` first (name, number, category, retirement) and captures the new account's id; then `IMPORT_POSITIONS` or `IMPORT_TRANSACTIONS` runs with destination `accountId` and valid user-edited rows. Manual mode never dispatches `UPSERT_CSV_MAPPING`; upload mode does.
- **Positions replace vs. merge by entry mode**: `IMPORT_POSITIONS` carries `mode: 'replace'` for Upload CSV and `mode: 'merge'` for Copy-Paste/Enter manually. Upload treats the file as the account's complete holdings — it replaces the account's entire position list, and any symbol missing from the file becomes a `ClosedPosition`. Copy-Paste/Manual entry is treated as an incremental addition — it upserts the entered rows by symbol into the account's existing positions and leaves every other existing position untouched (nothing is closed).
- **Import complete**: a success block (check icon, "Import complete", "Successfully imported N position(s)/transaction(s).") replaces the review table in the same step-2 slot; the primary button becomes **Done** and closes + resets the dialog. Cancel/✕ at any point fully resets local state. Dialog-open state is component-local.

## Password gate

Full-replacement gate screen (`PasswordGate`) rendered by `App.tsx` in place of the entire Nav/dashboard tree until the user unlocks the app. Runs on every load (no "remember me" — see in-memory key note below). Layout mirrors `design/v4`'s "Encryption Password" screen: centered card (max-width 440px) on the full-viewport `--color-bg` background, "Ledger" eyebrow, `<h1>` title, muted subtitle, a `.card.blueprint.elev-sm` form card with corner marks, and a danger-zone block below a divider with muted explanatory copy and a "Reset App" text link (not a button).

- **First run** (no stored data) or **legacy plaintext data found** (pre-encryption blob detected) → **set-password screen**: title "Set Encryption Password", subtitle "Choose a password to encrypt your data on this device." "New password" + "Confirm password" fields, both required; 6-character minimum; must match. Explanatory note inside the card: password encrypts data locally, is never saved anywhere, must be re-entered every session, and is unrecoverable if forgotten. Submit button is a full-width (`.btn-block`) blueprint-cornered "Set password". Submitting derives a fresh key+salt and, if legacy plaintext data existed, silently migrates it to encrypted form in the same submit (no separate migration step or prompt).
- **Returning encrypted user** → **enter-password screen**: title "Encryption Password", subtitle "Your data is encrypted on this device. Enter your password to unlock it." Single "Password" field, full-width blueprint-cornered "Unlock" button. Unlimited retries, no lockout. Wrong password shows an inline "Incorrect password" error below the field and clears it; the field's key is not derivable except by wrong-guessing forever.
- **Reset app** (both screens): a muted, underlined "Reset App" text link below a divider opens a blueprint-cornered confirm dialog ("Reset app and erase all data?") requiring the user to type `RESET` (case-insensitive) into a text field before the destructive "Erase Everything" button (styled in the danger color) enables; "Cancel" closes without effect. Confirming wipes only the IndexedDB record (`clearPersistedApp()`) — any Google Drive backup is untouched — shows a bottom-center toast ("App reset. All data wiped.") and returns the app to first-run (set-password) state.
- **Session key lifetime**: the derived key/salt live only in `App.tsx` React state, never persisted. Lost on refresh, tab close, or navigation away — there is no "remember" option and no manual lock button; the only way back in is re-entering the password on next load.

## Settings page

A dedicated page accessed via the gear button in the Nav. Two mutually-exclusive sections (Google Drive Sync / Change Encryption Password), switched via a `.seg` tab control at the top of the page's content — only one section's card is visible at a time. The tab-seg is followed by a `.hr` divider.

- **Tab-seg** (top of content): "Google Drive" / "Encryption" tabs, active per `settingsSection`, each dispatches `setSettingsSection` on click. Resets to "Google Drive" every time Settings is opened via the gear button.
- **Google Drive Sync** (`settingsSection === 'drive'`): connection state shown by the button set. Not connected → **Connect Drive** (`.btn.btn-primary`). Connected → **Sync Now** (`.btn.btn-primary`, calls `syncBackup(state, sessionKey, sessionSalt)`), **Restore from Drive** (`.btn.btn-secondary`, native confirm then `restoreBackup(sessionKey)` + dispatches `__SET_STATE` on success), **Disconnect** (`.btn.btn-secondary`, calls `disconnectDrive()` and flips back to not-connected). Buttons show an "-ing" label while busy. When connected AND a backup file exists (found on page load via `getBackupFileId()`, or set by the last successful sync), a **View backup in Google Drive** link appears below the buttons — opens `https://drive.google.com/file/d/{fileId}/view` in a new tab. No link while not connected or before any sync. **Auth-token behavior**: Sync/Restore validate the cached token before any Drive I/O. A still-valid token (not expired, scopes complete) is reused without prompting; only an expired or missing token triggers the interactive Google auth window, and never more than one window at a time (in-flight guard) even if sync/restore is triggered rapidly. `getBackupFileId()` is a passive page-load probe and never opens Google auth — an expired token just hides the backup link until the next successful sync/connect. **Restore fallback**: Restore can fail in two scenarios, both triggering the same fallback: (1) No backup found in this account's own `OpenWebApp/Portfolio` folder (e.g., backup was shared by a different account, lives outside this folder tree); (2) Fetched backup decrypts successfully initially, then user re-enters password on retry and it fails (`crossPasswordError` set after first-attempt decrypt fails). On either, an inline **Search Google Drive...** button (`.btn.btn-secondary`) appears below the buttons. Clicking calls `pickDriveFile()`, opening Google's file picker; picking a file grants Drive token access and calls `restoreBackupFromFileId(fileId, sessionKey)` — first attempting decrypt with the current session key. On success, app adopts that backup's data. On decrypt failure, an inline password prompt appears (blank, not pre-filled) asking for that file's password; submitting re-derives a key against the file's salt and decrypts locally — on success app adopts that key as session-wide and dispatches `__SET_STATE`. Wrong password shows "Incorrect password" error; "Cancel" dismisses. Picking another file chains — the button remains available for additional picks. Cancelling the picker does nothing.
- **Change Password** (`settingsSection === 'encryption'`): "Current Password", "New Password", "Confirm New Password" fields + a "Change Password" button. Verifies the current password by attempting a real decrypt of the stored data; wrong current password shows "Current password is incorrect" and stops. New password follows the same 6-char-minimum/must-match rules as the set-password screen. On success: generates a **fresh salt** (rotated on every change, never reused), re-derives a key, re-encrypts and saves the local IndexedDB copy under the new key+salt, then — only if Google Drive is currently connected — re-syncs the Drive backup under the new key too. If that Drive re-sync fails, a non-blocking inline warning is shown ("Password changed locally, but Drive re-sync failed... Sync manually...") but **the local password change is not rolled back**. On success the app adopts the new key as the session-wide key going forward.

Navigation back to the dashboard occurs via the Nav's Dashboard tab (no separate Back button or navigation affordance in Settings page content).

## Formatting conventions

- USD: `fmtUSD(n)` → `"$1,234.56"` / `"-$1,234.56"` (no leading `+` on positives; callers that want a `+` prepend it themselves for G/L-style fields).
- Percent: `fmtPct(n)` → always signed, `"+1.20%"` / `"-1.20%"` / `"+0.00%"`.
- Shares: `toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})`.
- Dates in Transactions table: `Date.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'})` (e.g. "Jan 5, 2026"). Dates in Closed Positions "Closed" column are shown as raw ISO strings.
