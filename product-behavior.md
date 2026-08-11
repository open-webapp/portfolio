# Product Behavior — Ledger (Portfolio Dashboard)

See also: [design.md](design.md), [schema-spec.md](schema-spec.md)

Local-first, single-user portfolio tracker. No live price feed — all values come from user-imported CSVs. No Watchlist/Alerts feature (out of scope; must never reappear — grep `watchlist` case-insensitive in `src/` must return nothing).

## Layout

Top to bottom: `Nav` → portfolio header row (kicker + title only, no tags) → 4-column `SummaryCards` grid → "Retirement" `SegmentSummaryCards` row → "Non-Retirement" `SegmentSummaryCards` row → full-width `AllocationChart` → tabs row (Positions/Transactions `.seg` selector + right-aligned "Import" button) → retirement filter tags (Positions tab only) → active tab's table.

## Nav

- **Brand**: `.nav-brand` "Ledger".
- **Category tabs** (radio-style `.seg`): All / Taxable / Non-Taxable / Tax-Deferred. Filters accounts by `Account.taxCategory`; "All" includes every account. Drives every downstream selector (positions, transactions, summary cards, allocation, performance series).
- **Date range select**: 6 Months / 1 Year / YTD / All. Filters the Performance chart's plotted snapshots to those on/after a cutoff computed from today (`6m`/`1y` roll back that many months/years, `ytd` cuts off at Jan 1 of the current year, `all` shows everything). Does **not** affect summary cards, allocation, or the tables — those are category/retirement-filtered only.
- **Settings gear**: navigates to the Settings page.

## Portfolio header

In the dashboard content area, below `Nav`: kicker "Portfolio" + `<h1>Ledger</h1>`. No filtering controls at this location.

## Summary cards

Rendered as `.card.blueprint.elev-sm` cards with corner marks, in a single row of 4 equal columns (grid gap `var(--space-4)`), shrinking each card to fit. Cards are, in order:

1. **Total Value** — sum of `shares * price` across positions in the selected category. Always neutral-colored.
2. **Day Change** — `lastSnapshotSeriesValue - previousSnapshotSeriesValue` across *all* accounts (not filtered by category), as a signed USD delta. Renders `N/A` when fewer than 2 distinct snapshot dates exist across the whole portfolio. Green (`--color-accent-700`) when ≥ 0, red (`#8a3c2e`) when negative.
3. **Total Gain/Loss** — sum of `marketValue - costBasis` across positions in the selected category, signed with `+`/`-` prefix, with a `sub` line showing the % (`gl / costBasis * 100`, `0` if cost basis is 0). Colored green/red by sign.
4. **Amount Invested** — sum of `shares * avgCost` across positions in the selected category. Neutral-colored.

## Segment summary card rows

Two rows rendering portfolio data by retirement status ("Retirement" and "Non-Retirement"), appearing below the main `SummaryCards`. Each row is a `.card.blueprint.elev-sm` with corner marks, containing:

- **Kicker label** (uppercase, muted): `"Retirement"` or `"Non-Retirement"`
- **3-column grid** (gap `var(--space-4)`):
  1. **Total Value** — sum of `shares * price` across positions in the selected category filtered by retirement status.
  2. **Total Gain/Loss** — sum of `marketValue - costBasis` across filtered positions, signed with `+`/`-` prefix, with a `sub` line showing the % (`gl / costBasis * 100`). Colored green/red by sign.
  3. **Amount Invested** — sum of `shares * avgCost` across filtered positions.

Both cards are computed via `segmentSummaryCards(state, retirement)` and reflect the current category tab's filter but *never* include a Day Change card.

## Allocation chart

Full-width bar list grouped by *effective* asset class (`assetClassManualOverride || assetClass`) for positions in the selected category (not retirement-filtered). Each row shows the class label, its USD value, its % of category total, and a horizontal bar sized to that %. Empty positions list → empty bar list, no crash. Rendered below both segment summary card rows.

## Positions table

**Retirement filter tags**: Three clickable `.tag` pills ("All" / "Retirement" / "Non-Retirement") render directly above the table, filtering positions by the owning `Account.retirement` boolean. Only shown on the Positions tab; not applicable to Transactions.

Rows are **aggregate groups** — each row represents a unique combination of symbol + effective asset class only. Tax category and retirement status no longer partition groups; positions with the same symbol and asset class merge regardless of account tax/retirement status. Every group, including size-1, renders as one row. Groups aggregate shares, cost basis, and market value across all underlying positions; price is derived as summed value / summed shares. **% of Portfolio** reflects positions matching both the current category filter and retirement filter.

- **Filters**: asset-class tags (computed from all positions currently in state — not category-scoped — sorted alphabetically) + free-text search (matches symbol or name, case-insensitive substring) + category + retirement filter (from the tags above) all compose.
- **Columns**: Symbol (symbol + name), Asset Class (effective), Shares, Cost Basis (labeled "Avg Cost"), Current Price, Amount Invested, Market Value, G/L (signed, colored), G/L %, % of Portfolio (unsigned, one decimal, shows percentage of filtered portfolio total), Row-count badge (right-aligned, `.tag.tag-neutral`, showing count of underlying position rows merged into the aggregate group; column header is blank, still the last column).
- **Sorting**: Clicking a sortable column header (Symbol/Asset Class/Shares/Cost Basis/Current Price) toggles asc/desc via `TOGGLE_SORT`; clicking the currently-sorted column flips direction, clicking a different column resets to `asc`. Arrow (`↑`/`↓`) marks the active sort column. Sorting orders by aggregate/derived group values (e.g., summed Market Value, derived Price = summed value / summed shares), computed client-side in `PositionsTable` after grouping. Amount Invested/Market Value/G/L/G/L % columns are display-only, not sortable.
- **Row click → overlay**: Clicking any row (cursor pointer) opens `PositionGroupOverlay`, a dialog (`.dialog-backdrop`/`.dialog`, closable via Escape/backdrop-click/X button). Title: `` `Symbol — Name — Asset Class` ``. Lists underlying positions sorted by account.institution ascending, then account.name ascending, fallback account.accountNumber. **Overlay columns** (9): Account, Symbol, Name, Shares, Avg Cost, Current Price, Taxes, Override, Delete. **Account display (two-line)**: line 1 shows institution—name (or name only if no institution); line 2 shows muted tax category and retirement labels (e.g., "Taxable • Retirement"). **Editable cells**: Account (dropdown button listing all accounts; selecting one dispatches `UPDATE_POSITION` with `patch: { accountId }`), Symbol (`<input type="text">`, click-to-edit, empty/whitespace-only reverts silently, trimmed non-empty value commits), Name (new column, `EditableTextCell`, click-to-edit via `<input type="text">`, empty/whitespace-only reverts silently, trimmed non-empty value commits), Shares/AvgCost/Price/Taxes (`<input type="number">`, click-to-edit, no hover affordance). For numeric fields: valid non-negative number commits via `UPDATE_POSITION`, invalid/empty reverts silently (no error UI), **except** empty Taxes saves as `0`. All fields: Enter or blur commits; Escape reverts (no dispatch). **Side effect**: editing Symbol or Account changes a position's group key (`symbol` + `effectiveAssetClass`), so the position's row disappears from the overlay on the next render (overlay itself stays open; natural re-render consequence). **Delete column**: blank header, trash-icon button per row; clicking prompts `window.confirm('Delete this position? It will be moved to Closed Positions.')`; on confirm, dispatches `CLOSE_POSITION` which converts the position into a `ClosedPosition` (`realizedGL: null`, `realizedGLBasis: 'unknown'`, `closedDate` = today) rather than hard-deleting it — the row then disappears from the overlay on next render as a natural consequence of no longer being in `state.positions` (same side-effect pattern as editing Symbol/Account). Override column contains `AssetClassOverrideSelect` control.
- **Closed Positions** toggle: a clickable row showing "Show/Hide Closed Positions" + a badge with `state.closedPositions.length` (unfiltered — the badge is not scoped to the current category/retirement filter, even though the table itself, when shown, still lists all closed positions with no filter applied either).
- `ClosedPositionsTable` (shown when toggled): Security / Closed date / Realized G/L / Delete columns. Realized G/L renders `"unknown"` when `realizedGLBasis === 'unknown'`, otherwise a signed formatted USD amount; never a fabricated number. Delete column (centered): a trash-icon `.btn-icon` button per row; clicking it opens a native browser dialog (`Delete this closed position? This permanently discards its realized G/L history.`) — accepting removes the closed position permanently (unrecoverable).

## Transactions table

- Type filter tags (`All` + every distinct `Transaction.type` currently in state, alphabetical) + free-text search (symbol or date substring, case-insensitive) + category filter (from Nav; transactions are **not** affected by the retirement filter).
- Always sorted by date descending — no user-controlled sort.
- Columns: Date (formatted `MMM D, YYYY`), Symbol, Type (colored tag: Buy=accent, Sell=outline, Dividend=neutral, anything else=neutral), Shares, Cost Basis, Amount Invested, Taxes (formatted USD or `—` if null), Position Link.
- **Position Link**: shows an "UNMATCHED" outline tag (with a tooltip explaining "likely fully sold or removed") when the transaction's symbol has no corresponding open `Position` among accounts in the current category; otherwise shows plain "Linked" text. This is purely derived per render — no stored flag.

## CSV import (Positions / Transactions)

A single **Import** button (`.btn.btn-secondary.blueprint` + 4 corner marks + upload SVG, `aria-label="Import"`) sits right-aligned in the tabs row, visible on both Positions and Transactions tabs. It opens a 2-step `ImportDialog`:

Dialog chrome: `.dialog.blueprint` + four corner marks; width `min(96vw, 1400px)`, `max-width: 96vw`, `max-height: 88vh`, `overflow: auto`. Header row (space-between): title "Import" + ✕ close button (`aria-label="Close"`). Step indicator `[Setup, Review]` as numbered tags: active = `tag-accent`, completed = `tag-neutral`, future = `tag-outline` + muted label. Footer `.dialog-actions`: Continue / Back / primary import button.

**Step 1 — Setup** (content constrained to `max-width: 720px` so inputs don't stretch across the full dialog):
- **What are you importing?** (`.seg` radios, 2 equal columns full-width): Transactions / Positions / Holdings — default Positions.
- **Destination account** (`.seg` radios, 2 equal columns full-width): Existing account / New account.
  - Existing: `<select class="input">` with a blank `-- Select an account --` option; each option reads `{name} • #{number} — {category} — {Retirement|Non-Retirement}` (or `{name} — {category} — {Retirement|Non-Retirement}` when the account has no number).
  - New: a `2fr/1fr/1fr/1fr` grid of "New account name", "Account number", "Institution" (seeded-list combobox with free-type "Add X" affordance; required before Continue enables), "Category" select (Taxable / Non-Taxable / Tax-Deferred) + a "Retirement Account" checkbox. Institution must be filled (non-empty string) to unlock the Continue button in new-account mode.
- **Positions-only entry mode** (`.seg` radios): `Upload CSV file` (default) / `Enter manually`. Not rendered for Transactions.
- **CSV file** (upload mode only): dashed dropzone (upload SVG, "No file selected" / "Drag and drop, or click to browse"; once a file parses, shows `{name} ({rows} rows)`). Non-`.csv` files and empty CSVs show an inline error.
- **Continue** is disabled until the destination account is resolved (existing selected OR new name+number+institution filled). Upload mode additionally requires a parsed CSV with ≥1 row; manual mode does not require a file. Close/✕ closes the dialog and fully resets local state (including entry mode back to upload).

**Step 2 — Review**:
- Destination line: `Importing into {account} · {category}` (existing-account label = `name` + ` • #number` when a number is present; category via `TAX_CATEGORY_LABELS`).
- Summary line: `Pick the file's column for each field below. {n} row(s) detected · {valid} valid. Fields marked * are required.` A `tag-outline` pill reads `{n} row(s) need fixing before you can continue` whenever any non-blank row is invalid.
- One `<table class="table">`: `<thead>` has one `<th>` per field in required-then-optional order (`*` on required). Upload mode renders mapping `<select>` controls (`— Not mapped —` + CSV headers; no constant-value option). Manual positions mode renders **no mapping selects** for non-asset-class fields. **Asset Class (positions only) always renders as a free-text `<input>` that broadcasts to untouched rows (sticky per-row override once edited).** When entering Step 2 with an existing account in upload mode, mappings can prefill from saved mapping for that account+kind, filtered to headers present in the current file. `<tbody>` renders one editable `<input>` per field per row (mapped values + user edit overlay); cells missing required fields — with `avgCost`/`purchaseAmount` and `price`/`marketValue` treated as alternatives — get red-border styling and a tinted row background.
- Each row has a trash-icon button (`.btn-icon`, `title="Delete this row"`) before the first field cell; clicking it drops that row from the preview (and from the import), re-keying later rows' edits. Fully-empty rows report no error and never block import. If every row is deleted, **Import** disables (nothing left to import).
- **Back** (`.btn.btn-secondary.blueprint`) returns to Step 1 with file, account, and edits intact.
- **Import** (primary): label `importDone ? 'Done' : 'Import'`; disabled while `!importDone && (upload mode + invalid fieldMap via isReviewValid, row errors, no preview rows, positions asset-class header empty, or manual mode has zero valid non-blank rows)`. In manual positions mode, `isReviewValid` is bypassed (fieldMap remains `{}`), and asset-class-only rows are treated as blank-equivalent for error gating. On commit, new-account mode dispatches `ADD_ACCOUNT` first (name, number, category, retirement) and captures the new account's id; then `IMPORT_POSITIONS` or `IMPORT_TRANSACTIONS` runs with destination `accountId` and valid user-edited rows. Manual mode never dispatches `UPSERT_CSV_MAPPING`; upload mode does.
- **Import complete**: a success block (check icon, "Import complete", "Successfully imported N position(s)/transaction(s).") replaces the review table in the same step-2 slot; the primary button becomes **Done** and closes + resets the dialog. Cancel/✕ at any point fully resets local state. Dialog-open state is component-local.

## Password gate

Full-replacement gate screen (`PasswordGate`) rendered by `App.tsx` in place of the entire Nav/dashboard tree until the user unlocks the app. Runs on every load (no "remember me" — see in-memory key note below). Layout mirrors `design/v4`'s "Encryption Password" screen: centered card (max-width 440px) on the full-viewport `--color-bg` background, "Ledger" eyebrow, `<h1>` title, muted subtitle, a `.card.blueprint.elev-sm` form card with corner marks, and a danger-zone block below a divider with muted explanatory copy and a "Reset App" text link (not a button).

- **First run** (no stored data) or **legacy plaintext data found** (pre-encryption blob detected) → **set-password screen**: title "Set Encryption Password", subtitle "Choose a password to encrypt your data on this device." "New password" + "Confirm password" fields, both required; 6-character minimum; must match. Explanatory note inside the card: password encrypts data locally, is never saved anywhere, must be re-entered every session, and is unrecoverable if forgotten. Submit button is a full-width (`.btn-block`) blueprint-cornered "Set password". Submitting derives a fresh key+salt and, if legacy plaintext data existed, silently migrates it to encrypted form in the same submit (no separate migration step or prompt).
- **Returning encrypted user** → **enter-password screen**: title "Encryption Password", subtitle "Your data is encrypted on this device. Enter your password to unlock it." Single "Password" field, full-width blueprint-cornered "Unlock" button. Unlimited retries, no lockout. Wrong password shows an inline "Incorrect password" error below the field and clears it; the field's key is not derivable except by wrong-guessing forever.
- **Reset app** (both screens): a muted, underlined "Reset App" text link below a divider opens a blueprint-cornered confirm dialog ("Reset app and erase all data?") requiring the user to type `RESET` (case-insensitive) into a text field before the destructive "Erase Everything" button (styled in the danger color) enables; "Cancel" closes without effect. Confirming wipes only the IndexedDB record (`clearPersistedApp()`) — any Google Drive backup is untouched — shows a bottom-center toast ("App reset. All data wiped.") and returns the app to first-run (set-password) state.
- **Session key lifetime**: the derived key/salt live only in `App.tsx` React state, never persisted. Lost on refresh, tab close, or navigation away — there is no "remember" option and no manual lock button; the only way back in is re-entering the password on next load.

## Settings page

A dedicated page (not a modal or dropdown) accessed via a gear button in the Nav. Single unconditional page with no tabs.

Google Drive Sync, then Change Password:
- **Google Drive Sync**: connection state shown by the button set. Not connected → **Connect Drive** (`.btn.btn-primary`). Connected → **Sync Now** (`.btn.btn-primary`, calls `syncBackup(state, sessionKey, sessionSalt)`), **Restore from Drive** (`.btn.btn-secondary`, native confirm then `restoreBackup(sessionKey)` + dispatches `__SET_STATE` on success), **Disconnect** (`.btn.btn-secondary`, calls `disconnectDrive()` and flips back to not-connected). Buttons show an "-ing" label while busy. When connected AND a backup file exists (found on page load via `getBackupFileId()`, or set by the last successful sync), a **View backup in Google Drive** link appears below the buttons — opens `https://drive.google.com/file/d/{fileId}/view` in a new tab. No link while not connected or before any sync. **Auth-token behavior**: Sync/Restore validate the cached token before any Drive I/O. A still-valid token (not expired, scopes complete) is reused without prompting; only an expired or missing token triggers the interactive Google auth window, and never more than one window at a time (in-flight guard) even if sync/restore is triggered rapidly. `getBackupFileId()` is a passive page-load probe and never opens Google auth — an expired token just hides the backup link until the next successful sync/connect. **Cross-password restore**: if the fetched Drive backup was encrypted under a different password than the current session (`restoreBackup` throws `DriveDecryptError`), a small inline prompt appears below the buttons (not the full gate, not `window.confirm`) asking for that backup's password; submitting re-derives a key against the backup's own salt and decrypts locally (no second Drive round-trip) — on success the app adopts that key as the session-wide key going forward and dispatches `__SET_STATE` with the decrypted data. Wrong password shows an inline "Incorrect password" error; "Cancel" dismisses the prompt with no changes.
- **Change Password**: "Current Password", "New Password", "Confirm New Password" fields + a "Change Password" button. Verifies the current password by attempting a real decrypt of the stored data; wrong current password shows "Current password is incorrect" and stops. New password follows the same 6-char-minimum/must-match rules as the set-password screen. On success: generates a **fresh salt** (rotated on every change, never reused), re-derives a key, re-encrypts and saves the local IndexedDB copy under the new key+salt, then — only if Google Drive is currently connected — re-syncs the Drive backup under the new key too. If that Drive re-sync fails, a non-blocking inline warning is shown ("Password changed locally, but Drive re-sync failed... Sync manually...") but **the local password change is not rolled back**. On success the app adopts the new key as the session-wide key going forward.

**Back button**: Returns to the dashboard.

## Formatting conventions

- USD: `fmtUSD(n)` → `"$1,234.56"` / `"-$1,234.56"` (no leading `+` on positives; callers that want a `+` prepend it themselves for G/L-style fields).
- Percent: `fmtPct(n)` → always signed, `"+1.20%"` / `"-1.20%"` / `"+0.00%"`.
- Shares: `toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})`.
- Dates in Transactions table: `Date.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'})` (e.g. "Jan 5, 2026"). Dates elsewhere (Performance chart labels, Closed Positions "Closed" column) are shown as raw ISO strings.
