# Product Behavior — Ledger (Portfolio Dashboard)

See also: [design.md](design.md), [schema-spec.md](schema-spec.md)

Local-first, single-user portfolio tracker. No live price feed — all values come from user-imported CSVs. No Watchlist/Alerts feature (out of scope; must never reappear — grep `watchlist` case-insensitive in `src/` must return nothing).

## Layout

Top to bottom: `Nav` → 5 `SummaryCards` → 2-column chart grid (`PerformanceChart`, `AllocationChart`) → tab selector (Positions / Transactions) → Import button + table for the active tab.

## Nav

- **Category tabs** (radio-style `.seg`): All / Taxable / Non-Taxable / Tax-Deferred. Filters accounts by `Account.taxCategory`; "All" includes every account. Drives every downstream selector (positions, transactions, summary cards, allocation, performance series).
- **Retirement filter tags**: All / Retirement / Non-Retirement. Filters *positions only* (not transactions, not summary cards, not allocation, not performance) by the owning `Account.retirement` boolean.
- **Date range select**: 6 Months / 1 Year / YTD / All. Filters the Performance chart's plotted snapshots to those on/after a cutoff computed from today (`6m`/`1y` roll back that many months/years, `ytd` cuts off at Jan 1 of the current year, `all` shows everything). Does **not** affect summary cards, allocation, or the tables — those are category/retirement-filtered only.

## Summary cards

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

- Filters (asset-class tags, computed from all positions currently in state — not category-scoped — sorted alphabetically) + free-text search (matches symbol or name, case-insensitive substring) + category + retirement filter (from Nav) all compose.
- Columns: Symbol (symbol + name), Asset Class (effective), Shares, Cost Basis, Current Price, Amount Invested, Market Value, G/L (signed, colored), G/L %, Override.
- Clicking a sortable column header (Symbol/Asset Class/Shares/Cost Basis/Current Price) toggles asc/desc via `TOGGLE_SORT`; clicking the currently-sorted column flips direction, clicking a different one resets to `asc`. An arrow (`↑`/`↓`) appears next to the active sort column. Amount Invested/Market Value/G/L/G/L % columns are display-only, not sortable.
- **Override** column: `AssetClassOverrideSelect` — a button that opens a searchable dropdown of 7 seeded classes (Equity, ETF, Mutual Fund, Fixed Income, Crypto, Cash, Other) plus free-typed values. Selecting one sets `Position.assetClassManualOverride`; a "Clear override" option (shown only when an override is active) resets it to `undefined`. The button reads "Set" normally, "Override" (accent-colored) when an override is active.
- **Closed Positions** toggle: a clickable row showing "Show/Hide Closed Positions" + a badge with `state.closedPositions.length` (unfiltered — the badge is not scoped to the current category/retirement filter, even though the table itself, when shown, still lists all closed positions with no filter applied either).
- `ClosedPositionsTable` (shown when toggled): Security / Closed date / Realized G/L / Delete columns. Realized G/L renders `"unknown"` when `realizedGLBasis === 'unknown'`, otherwise a signed formatted USD amount; never a fabricated number. Delete column contains a trash-icon button per row; clicking it prompts with `window.confirm('Delete this closed position? This permanently discards its realized G/L history.')` — if confirmed, the closed position is removed permanently (unrecoverable).

## Transactions table

- Type filter tags (`All` + every distinct `Transaction.type` currently in state, alphabetical) + free-text search (symbol or date substring, case-insensitive) + category filter (from Nav; transactions are **not** affected by the retirement filter).
- Always sorted by date descending — no user-controlled sort.
- Columns: Date (formatted `MMM D, YYYY`), Symbol, Type (colored tag: Buy=accent, Sell=outline, Dividend=neutral, anything else=neutral), Shares, Cost Basis, Amount Invested, Taxes (formatted USD or `—` if null), Position Link.
- **Position Link**: shows an "UNMATCHED" outline tag (with a tooltip explaining "likely fully sold or removed") when the transaction's symbol has no corresponding open `Position` among accounts in the current category; otherwise shows plain "Linked" text. This is purely derived per render — no stored flag.

## CSV import (Positions / Transactions)

A single "Import CSV" button (visible on both Positions and Transactions tabs) opens a unified 4-step `ImportDialog`:

**Step 1 — Setup (choose data type & destination account)**:
- **Data type** (`seg` control): Positions or Transactions.
- **Destination account** (`seg` control): Existing account (dropdown populated from `state.accounts`) or New account.
- **New account fields** (shown when "New account" is selected): name (required), number (required), tax category (`seg`: Taxable / Non-Taxable / Tax-Deferred), retirement toggle (`seg`: Yes / No).
- **File selector**: drag-and-drop or `<input type=file accept=.csv>` zone. Parses immediately via Papa.parse (header row required, empty lines skipped, no type coercion).
- **Continue** button: disabled until data type chosen, destination account resolved (existing selected OR new account name+number filled), and file parsed with ≥1 row.

**Step 2 — Map columns (assign CSV headers to fields, add constant values)**:
- **"Use saved profile"** dropdown: shows existing `MappingProfile`s matching the chosen data type (Positions or Transactions). Selecting one pre-fills the mapping grid below; selecting "Create new" starts with an empty grid.
- **Mapping grid**: one row per field in `POSITIONS_REQUIRED_FIELDS`/`POSITIONS_OPTIONAL_FIELDS` (or `TRANSACTIONS_*` equivalents). Each field's dropdown shows parsed CSV headers plus a synthetic "Enter a value…" option.
  - Selecting a CSV header maps that column to the field.
  - Selecting "Enter a value…" reveals a text input; the constant value is applied to every row for this field.
  - No "Account Number Column" option (v2 resolves the account upfront in Step 1, not per-row).
- **"Save as profile"** button: inline name input → creates (`ADD_MAPPING_PROFILE`) or updates (`UPDATE_MAPPING_PROFILE`) a profile with current `fieldMap` and `constants`.
- **Continue** button: enabled once required fields are mapped (either via CSV header or constant).

**Step 3 — Preview & validate (edit rows, catch errors)**:
- **Editable table**: one row per CSV row, one column per mapped field. Each cell is an `<input>`, reflecting the pre-mapped or constant value with any user edits applied locally.
- **Per-cell validation**: Positions requires `symbol`, `name`, `assetClass`, `shares`, and *either* `avgCost` or `purchaseAmount`, and *either* `price` or `marketValue` (invalid cells show inline error messages). Transactions requires all of `date, symbol, type, shares, price, amount`. Rows with errors are styled to highlight the invalid cells.
- **"Review Import"** button: disabled while any row has an error; enabled once all rows are valid or invalid rows are removed.

**Step 4 — Confirm (review, commit, show completion)**:
- **Review card**: shows data type label (Positions / Transactions), destination label (existing account name, or the new account's name), and valid-row count.
- **"Import"** button: on click, (a) if new account, dispatch `ADD_ACCOUNT` with the Step 1 details (name, number, category, retirement), capturing the new account's id; (b) dispatch `IMPORT_POSITIONS` or `IMPORT_TRANSACTIONS` with the destination `accountId` and the preview rows (including any user edits from Step 3).
- **"Import complete"** screen: shows a success message and row-count summary, allowing the user to review before closing.
- **"Back"** from any step: returns to the prior step, preserving file, mapping, and edits.
- **"Cancel"** from any step: closes the dialog and fully resets local state (file, mapping, edits, destination account).

## Formatting conventions

- USD: `fmtUSD(n)` → `"$1,234.56"` / `"-$1,234.56"` (no leading `+` on positives; callers that want a `+` prepend it themselves for G/L-style fields).
- Percent: `fmtPct(n)` → always signed, `"+1.20%"` / `"-1.20%"` / `"+0.00%"`.
- Shares: `toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})`.
- Dates in Transactions table: `Date.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'})` (e.g. "Jan 5, 2026"). Dates elsewhere (Performance chart labels, Closed Positions "Closed" column) are shown as raw ISO strings.
