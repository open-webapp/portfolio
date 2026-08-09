# Product Behavior — Ledger (Portfolio Dashboard)

See also: [design.md](design.md), [schema-spec.md](schema-spec.md)

Local-first, single-user portfolio tracker. No live price feed — all values come from user-imported CSVs. No Watchlist/Alerts feature (out of scope; must never reappear — grep `watchlist` case-insensitive in `src/` must return nothing).

## Layout

Top to bottom: `Nav` → portfolio header row (kicker + title + retirement tags) → 5-column `SummaryCards` grid (all 5 cards in one row) → 2-column chart grid (`2fr 1fr` — Performance wider than Allocation) → tabs row (Positions/Transactions `.seg` selector + right-aligned "Import" button) → active tab's table.

## Nav

- **Brand**: `.nav-brand` "Ledger".
- **Category tabs** (radio-style `.seg`): All / Taxable / Non-Taxable / Tax-Deferred. Filters accounts by `Account.taxCategory`; "All" includes every account. Drives every downstream selector (positions, transactions, summary cards, allocation, performance series).
- **Date range select**: 6 Months / 1 Year / YTD / All. Filters the Performance chart's plotted snapshots to those on/after a cutoff computed from today (`6m`/`1y` roll back that many months/years, `ytd` cuts off at Jan 1 of the current year, `all` shows everything). Does **not** affect summary cards, allocation, or the tables — those are category/retirement-filtered only.
- **Settings gear**: navigates to the Settings page.

## Portfolio header

In the dashboard content area, below `Nav`: kicker "Portfolio" + `<h1>Ledger</h1>` on the left; retirement-filter `.tag` pills (All / Retirement / Non-Retirement) on the right. Pills filter **positions only** (not transactions, not summary cards, not allocation, not performance) by the owning `Account.retirement` boolean.

## Summary cards

Rendered as `.card.blueprint.elev-sm` cards with corner marks, in a single row of 5 equal columns (grid gap `var(--space-4)`), shrinking each card to fit. Cards are, in order:

1. **Total Value** — sum of `shares * price` across positions in the selected category. Always neutral-colored.
2. **Day Change** — `lastSnapshotSeriesValue - previousSnapshotSeriesValue` across *all* accounts (not filtered by category), as a signed USD delta. Renders `N/A` when fewer than 2 distinct snapshot dates exist across the whole portfolio. Green (`--color-accent-700`) when ≥ 0, red (`#8a3c2e`) when negative.
3. **Total Gain/Loss** — sum of `marketValue - costBasis` across positions in the selected category, signed with `+`/`-` prefix, with a `sub` line showing the % (`gl / costBasis * 100`, `0` if cost basis is 0). Colored green/red by sign.
4. **Amount Invested** — sum of `shares * avgCost` across positions in the selected category. Neutral-colored.
5. **Total Taxes Paid** — sum of `transaction.taxes` (null treated as 0) across transactions in the selected category. Neutral-colored.

## Performance chart

SVG polyline (`viewBox="0 0 100 500"`) with 3 horizontal quartile gridlines. X axis = snapshot index within the selected range (not real date spacing — points are evenly spaced regardless of gaps between dates). Y axis = value normalized between the range-filtered series' min and max (inverted, since SVG y grows downward). A single-point series renders one point at the chart's horizontal/vertical center instead of a line. Below the chart, the first and last snapshot dates *within the selected range* are shown as plain ISO date strings.

## Allocation chart

Bar list grouped by *effective* asset class (`assetClassManualOverride || assetClass`) for positions in the selected category (not retirement-filtered). Each row shows the class label, its USD value, its % of category total, and a horizontal bar sized to that %. Empty positions list → empty bar list, no crash.

## Positions table

Rows are **aggregate groups** — each row represents a unique combination of symbol + effective asset class + tax category + retirement status. Every group, including size-1, renders as one row. Groups aggregate shares, cost basis, and market value across all underlying positions; price is derived as summed value / summed shares.

- **Filters**: asset-class tags (computed from all positions currently in state — not category-scoped — sorted alphabetically) + free-text search (matches symbol or name, case-insensitive substring) + category + retirement filter (from the header row) all compose.
- **Columns**: Symbol (symbol + name), Asset Class (effective), Shares, Cost Basis (labeled "Avg Cost"), Current Price, Amount Invested, Market Value, G/L (signed, colored), G/L %, Account count badge (right-aligned, `.tag.tag-neutral`, showing count of distinct accounts in the group; column header is blank).
- **Sorting**: Clicking a sortable column header (Symbol/Asset Class/Shares/Cost Basis/Current Price) toggles asc/desc via `TOGGLE_SORT`; clicking the currently-sorted column flips direction, clicking a different column resets to `asc`. Arrow (`↑`/`↓`) marks the active sort column. Sorting orders by aggregate/derived group values (e.g., summed Market Value, derived Price = summed value / summed shares), computed client-side in `PositionsTable` after grouping. Amount Invested/Market Value/G/L/G/L % columns are display-only, not sortable.
- **Row click → overlay**: Clicking any row (cursor pointer) opens `PositionGroupOverlay`, a dialog (`.dialog-backdrop`/`.dialog`, closable via Escape/backdrop-click/X button). Title: `` `Symbol — Name — Asset Class` ``. Lists underlying positions (sorted by account name ascending, fallback account number) with columns: Account Name, Shares, Cost Basis (Avg Cost), Current Price, Taxes (new column), Amount Invested, Market Value, G/L, G/L%, Override. **Editable cells**: Shares, Cost Basis, Current Price, and Taxes are independently click-to-edit — click a value → `<input type="number">` pre-filled with current value (no hover affordance). Enter or blur commits: dispatches `UPDATE_POSITION` with `patch: { [field]: parsed number }` if valid non-negative number, otherwise reverts silently (no error UI). Escape cancels: reverts to previous value, no dispatch. **Exception**: empty Taxes input on blur saves as `0`, not reverted. **Computed columns** (Amount Invested, Market Value, G/L, G/L%) remain plain read-only text; they auto-update via re-render when underlying shares/price/cost change. Override column contains `AssetClassOverrideSelect` control (same behavior as before, relocated to overlay).
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
  - New: a `2fr/1fr/1fr` grid of "New account name", "Account number", "Category" select (Taxable / Non-Taxable / Tax-Deferred) + a "Retirement Account" checkbox.
- **Positions-only entry mode** (`.seg` radios): `Upload CSV file` (default) / `Enter manually`. Not rendered for Transactions.
- **CSV file** (upload mode only): dashed dropzone (upload SVG, "No file selected" / "Drag and drop, or click to browse"; once a file parses, shows `{name} ({rows} rows)`). Non-`.csv` files and empty CSVs show an inline error.
- **Continue** is disabled until the destination account is resolved (existing selected OR new name+number filled). Upload mode additionally requires a parsed CSV with ≥1 row; manual mode does not require a file. Close/✕ closes the dialog and fully resets local state (including entry mode back to upload).

**Step 2 — Review**:
- Destination line: `Importing into {account} · {category}` (existing-account label = `name` + ` • #number` when a number is present; category via `TAX_CATEGORY_LABELS`).
- Summary line: `Pick the file's column for each field below. {n} row(s) detected · {valid} valid. Fields marked * are required.` A `tag-outline` pill reads `{n} row(s) need fixing before you can continue` whenever any non-blank row is invalid.
- One `<table class="table">`: `<thead>` has one `<th>` per field in required-then-optional order (`*` on required). Upload mode renders mapping `<select>` controls (`— Not mapped —` + CSV headers; no constant-value option). Manual positions mode renders **no mapping selects** for non-asset-class fields. **Asset Class (positions only) always renders as a free-text `<input>` that broadcasts to untouched rows (sticky per-row override once edited).** When entering Step 2 with an existing account in upload mode, mappings can prefill from saved mapping for that account+kind, filtered to headers present in the current file. `<tbody>` renders one editable `<input>` per field per row (mapped values + user edit overlay); cells missing required fields — with `avgCost`/`purchaseAmount` and `price`/`marketValue` treated as alternatives — get red-border styling and a tinted row background.
- Each row has a trash-icon button (`.btn-icon`, `title="Delete this row"`) before the first field cell; clicking it drops that row from the preview (and from the import), re-keying later rows' edits. Fully-empty rows report no error and never block import. If every row is deleted, **Import** disables (nothing left to import).
- **Back** (`.btn.btn-secondary.blueprint`) returns to Step 1 with file, account, and edits intact.
- **Import** (primary): label `importDone ? 'Done' : 'Import'`; disabled while `!importDone && (upload mode + invalid fieldMap via isReviewValid, row errors, no preview rows, positions asset-class header empty, or manual mode has zero valid non-blank rows)`. In manual positions mode, `isReviewValid` is bypassed (fieldMap remains `{}`), and asset-class-only rows are treated as blank-equivalent for error gating. On commit, new-account mode dispatches `ADD_ACCOUNT` first (name, number, category, retirement) and captures the new account's id; then `IMPORT_POSITIONS` or `IMPORT_TRANSACTIONS` runs with destination `accountId` and valid user-edited rows. Manual mode never dispatches `UPSERT_CSV_MAPPING`; upload mode does.
- **Import complete**: a success block (check icon, "Import complete", "Successfully imported N position(s)/transaction(s).") replaces the review table in the same step-2 slot; the primary button becomes **Done** and closes + resets the dialog. Cancel/✕ at any point fully resets local state. Dialog-open state is component-local.

## Settings page

A dedicated page (not a modal or dropdown) accessed via a gear button in the Nav. Two-tab structure via `.seg` radios: **General** (default) and **Import Sessions**. Tab state is a component-local `useState` in `SettingsPage`; `App.tsx`'s view ternary fully unmounts/remounts the page on each visit, so the tab resets to General every time.

**General tab** — Accounts section first, then Google Drive Sync:
- **Accounts**: list of all accounts; each row: account number (click-to-edit; `Enter`/blur commits, `Esc` cancels), name (same pattern), tax category dropdown (Taxable/Non-Taxable/Tax-Deferred), retirement checkbox, ✕ delete button. Delete opens a native browser dialog (`Delete this account? This removes all its positions, closed positions, transactions, and snapshots.`) — accepting cascade-deletes the account and its associated data. Empty list → "No accounts yet."
- **Google Drive Sync**: connection state shown by the button set. Not connected → **Connect Drive** (`.btn.btn-primary`). Connected → **Sync Now** (`.btn.btn-primary`, calls `syncBackup(state)`), **Restore from Drive** (`.btn.btn-secondary`, native confirm then `restoreBackup()` + dispatches `__SET_STATE` on success), **Disconnect** (`.btn.btn-secondary`, calls `disconnectDrive()` and flips back to not-connected). Buttons show an "-ing" label while busy. When connected AND a backup file exists (found on page load via `getBackupFileId()`, or set by the last successful sync), a **View backup in Google Drive** link appears below the buttons — opens `https://drive.google.com/file/d/{fileId}/view` in a new tab. No link while not connected or before any sync. **Auth-token behavior**: Sync/Restore validate the cached token before any Drive I/O. A still-valid token (not expired, scopes complete) is reused without prompting; only an expired or missing token triggers the interactive Google auth window, and never more than one window at a time (in-flight guard) even if sync/restore is triggered rapidly. `getBackupFileId()` is a passive page-load probe and never opens Google auth — an expired token just hides the backup link until the next successful sync/connect.

**Import Sessions tab** (unchanged behavior): a table listing all past CSV imports with columns: Date/Time, Kind (Positions/Transactions), File Name, Accounts (comma-separated names), Row Count, ✕ delete. Each row's delete button opens a native browser dialog (`Delete this import? This will remove ${rowCount} positions/transactions.`) — accepting removes the session and all rows tagged with its `importSessionId`. Empty list → "No imports yet."

**Back button**: Returns to the dashboard.

## Formatting conventions

- USD: `fmtUSD(n)` → `"$1,234.56"` / `"-$1,234.56"` (no leading `+` on positives; callers that want a `+` prepend it themselves for G/L-style fields).
- Percent: `fmtPct(n)` → always signed, `"+1.20%"` / `"-1.20%"` / `"+0.00%"`.
- Shares: `toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})`.
- Dates in Transactions table: `Date.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'})` (e.g. "Jan 5, 2026"). Dates elsewhere (Performance chart labels, Closed Positions "Closed" column) are shown as raw ISO strings.
