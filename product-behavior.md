# Product Behavior — Ledger (Portfolio Dashboard)

See also: [design.md](design.md), [schema-spec.md](schema-spec.md)

Local-first, single-user portfolio tracker. No live price feed — all values come from user-imported CSVs. No Watchlist/Alerts feature (out of scope; must never reappear — grep `watchlist` case-insensitive in `src/` must return nothing).

## Layout

Top to bottom: `Nav` → portfolio header row (kicker + title + retirement tags) → 5-column `SummaryCards` grid (all 5 cards in one row) → 2-column chart grid (`2fr 1fr` — Performance wider than Allocation) → tabs row (Positions/Transactions `.seg` selector + right-aligned "Import CSV" button) → active tab's table.

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

- Filters (asset-class tags, computed from all positions currently in state — not category-scoped — sorted alphabetically) + free-text search (matches symbol or name, case-insensitive substring) + category + retirement filter (from the header row) all compose.
- Columns: Symbol (symbol + name), Asset Class (effective), Shares, Cost Basis, Current Price, Amount Invested, Market Value, G/L (signed, colored), G/L %, Override.
- Clicking a sortable column header (Symbol/Asset Class/Shares/Cost Basis/Current Price) toggles asc/desc via `TOGGLE_SORT`; clicking the currently-sorted column flips direction, clicking a different one resets to `asc`. An arrow (`↑`/`↓`) appears next to the active sort column. Amount Invested/Market Value/G/L/G/L % columns are display-only, not sortable.
- **Override** column: `AssetClassOverrideSelect` — a button that opens a searchable dropdown of 7 seeded classes (Equity, ETF, Mutual Fund, Fixed Income, Crypto, Cash, Other) plus free-typed values. Selecting one sets `Position.assetClassManualOverride`; a "Clear override" option (shown only when an override is active) resets it to `undefined`. The button reads "Set" normally, "Override" (accent-colored) when an override is active.
- **Position group overlay**: when a row in the positions table is clicked (future integration), a modal dialog opens showing all individual positions that make up that aggregated group. Title bar displays `{Symbol} — {Name} — {Asset Class}`. Positions are listed in a table sorted by account name (alphabetically, using account name or account number as fallback), with columns: Account, Shares, Cost Basis, Current Price, Amount Invested, Market Value, G/L, G/L %, Override. Each position row includes an `AssetClassOverrideSelect` in the Override column. The overlay closes via Escape key, backdrop click, or the ✕ close button.
- **Closed Positions** toggle: a clickable row showing "Show/Hide Closed Positions" + a badge with `state.closedPositions.length` (unfiltered — the badge is not scoped to the current category/retirement filter, even though the table itself, when shown, still lists all closed positions with no filter applied either).
- `ClosedPositionsTable` (shown when toggled): Security / Closed date / Realized G/L / Delete columns. Realized G/L renders `"unknown"` when `realizedGLBasis === 'unknown'`, otherwise a signed formatted USD amount; never a fabricated number. Delete column (centered): a trash-icon `.btn-icon` button per row; clicking it opens a native browser dialog (`Delete this closed position? This permanently discards its realized G/L history.`) — accepting removes the closed position permanently (unrecoverable).

## Transactions table

- Type filter tags (`All` + every distinct `Transaction.type` currently in state, alphabetical) + free-text search (symbol or date substring, case-insensitive) + category filter (from Nav; transactions are **not** affected by the retirement filter).
- Always sorted by date descending — no user-controlled sort.
- Columns: Date (formatted `MMM D, YYYY`), Symbol, Type (colored tag: Buy=accent, Sell=outline, Dividend=neutral, anything else=neutral), Shares, Cost Basis, Amount Invested, Taxes (formatted USD or `—` if null), Position Link.
- **Position Link**: shows an "UNMATCHED" outline tag (with a tooltip explaining "likely fully sold or removed") when the transaction's symbol has no corresponding open `Position` among accounts in the current category; otherwise shows plain "Linked" text. This is purely derived per render — no stored flag.

## CSV import (Positions / Transactions)

A single **Import CSV** button (`.btn.btn-secondary.blueprint` + 4 corner marks + upload SVG) sits right-aligned in the tabs row, visible on both Positions and Transactions tabs. It opens a 2-step `ImportDialog`:

Dialog chrome: `.dialog.blueprint` + four corner marks; width `min(96vw, 1400px)`, `max-width: 96vw`, `max-height: 88vh`, `overflow: auto`. Header row (space-between): title "Import from CSV" + ✕ close button (`aria-label="Close"`). Step indicator `[Setup, Review]` as numbered tags: active = `tag-accent`, completed = `tag-neutral`, future = `tag-outline` + muted label. Footer `.dialog-actions`: Cancel (`.btn.btn-secondary`) / Continue (`.btn.btn-primary`) / primary import button.

**Step 1 — Setup** (content constrained to `max-width: 720px` so inputs don't stretch across the full dialog):
- **What are you importing?** (`.seg` radios, 2 equal columns full-width): Transactions / Positions / Holdings — default Positions.
- **Destination account** (`.seg` radios, 2 equal columns full-width): Existing account / New account.
  - Existing: `<select class="input">` with a blank `-- Select an account --` option; each option reads `{name} • #{number} — {category} — {Retirement|Non-Retirement}` (or `{name} — {category} — {Retirement|Non-Retirement}` when the account has no number).
  - New: a `2fr/1fr/1fr` grid of "New account name", "Account number", "Category" select (Taxable / Non-Taxable / Tax-Deferred) + a "Retirement Account" checkbox.
- **CSV file**: dashed dropzone (upload SVG, "No file selected" / "Drag and drop, or click to browse"; once a file parses, shows `{name} ({rows} rows)`). Non-`.csv` files and empty CSVs show an inline error.
- **Continue** is disabled until the destination account is resolved (existing selected OR new name+number filled) and a file parsed with ≥1 row. Cancel/✕ closes the dialog and fully resets local state.

**Step 2 — Review**:
- Destination line: `Importing into {account} · {category}` (existing-account label = `name` + ` • #number` when a number is present; category via `TAX_CATEGORY_LABELS`).
- Summary line: `Pick the file's column for each field below. {n} row(s) detected · {valid} valid. Fields marked * are required.` A `tag-outline` pill reads `{n} row(s) need fixing before you can continue` whenever any row is invalid.
- One `<table class="table">`: `<thead>` has one `<th>` per field in required-then-optional order (`*` on required); each `<th>` holds a mapping `<select>` (`— Not mapped —` + CSV headers; no "Enter a value…"/constant-value option) plus an alternative-pair hint for `avgCost`/`purchaseAmount`, `price`/`marketValue`, and `amount` — **exception: Asset Class (positions only) is a free-text `<input>` that broadcasts to all untouched rows (sticky per-row override once edited)**. When entering Step 2 with an existing account, the mapping dropdowns are prefilled from the saved mapping for that account and import kind (if it exists), filtered to headers present in the current file. `<tbody>` renders one editable `<input>` per field per CSV row (values from `applyFieldMap(csvRow, fieldMap)`, user edits overlaid); cells missing a required field — with `avgCost`/`purchaseAmount` and `price`/`marketValue` treated as alternatives — get red-border error styling and a tinted row background.
- Each row has a trash-icon button (`.btn-icon`, `title="Delete this row"`) before the first field cell; clicking it drops that row from the preview (and from the import), re-keying later rows' edits. Fully-empty rows report no error and never block import. If every row is deleted, **Import** disables (nothing left to import).
- **Back** (`.btn.btn-secondary.blueprint`) returns to Step 1 with file, account, and edits intact.
- **Import** (primary): label `importDone ? 'Done' : 'Import'`; disabled while `!importDone && (!isReviewValid(dataType, fieldMap) || hasImportErrors || previewRows.length === 0 || (dataType === 'positions' && assetClassHeaderValue is empty))`. On commit, new-account mode dispatches `ADD_ACCOUNT` first (name, number, category, retirement) and captures the new account's id; then `IMPORT_POSITIONS` or `IMPORT_TRANSACTIONS` runs with the destination `accountId` and the valid, user-edited rows. All created rows are tagged with a fresh import-session id. A successful import updates the saved mapping for that account and kind (upsert, not append).
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
