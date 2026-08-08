# Product Behavior — Ledger (Portfolio Dashboard)

See also: [design.md](design.md), [schema-spec.md](schema-spec.md)

Local-first, single-user portfolio tracker. No live price feed — all values come from user-imported CSVs. No Watchlist/Alerts feature (out of scope; must never reappear — grep `watchlist` case-insensitive in `src/` must return nothing).

## Layout

Top to bottom: `Nav` → 4 `SummaryCards` → 2-column chart grid (`PerformanceChart`, `AllocationChart`) → tab selector (Positions / Transactions) → Import button + table for the active tab.

## Nav

- **Category tabs** (radio-style `.seg`): All / Taxable / Non-Taxable / Tax-Deferred. Filters accounts by `Account.taxCategory`; "All" includes every account. Drives every downstream selector (positions, transactions, summary cards, allocation, performance series).
- **Retirement filter tags**: All / Retirement / Non-Retirement. Filters *positions only* (not transactions, not summary cards, not allocation, not performance) by the owning `Account.retirement` boolean.
- **Date range select**: 6 Months / 1 Year / YTD / All. Currently **has no effect** — `performanceLinePoints` always uses the full snapshot history regardless of this selection (known gap, see design.md).

## Summary cards

1. **Total Value** — sum of `shares * price` across positions in the selected category. Always neutral-colored.
2. **Day Change** — `lastSnapshotSeriesValue - previousSnapshotSeriesValue` across *all* accounts (not filtered by category), as a signed USD delta. Renders `N/A` when fewer than 2 distinct snapshot dates exist across the whole portfolio. Green (`--color-accent-700`) when ≥ 0, red (`#8a3c2e`) when negative.
3. **Total Gain/Loss** — sum of `marketValue - costBasis` across positions in the selected category, signed with `+`/`-` prefix, with a `sub` line showing the % (`gl / costBasis * 100`, `0` if cost basis is 0). Colored green/red by sign.
4. **Cost Basis** — sum of `shares * avgCost` across positions in the selected category. Neutral-colored.

## Performance chart

SVG polyline (`viewBox="0 0 100 500"`) with 3 horizontal quartile gridlines. X axis = snapshot index (not real date spacing — points are evenly spaced regardless of gaps between dates). Y axis = value normalized between the series' min and max (inverted, since SVG y grows downward). A single-point series renders one point at the chart's horizontal/vertical center instead of a line. Below the chart, the first and last snapshot dates in the (category-filtered-by-account, not by range) series are shown as plain ISO date strings.

## Allocation chart

Bar list grouped by *effective* asset class (`assetClassManualOverride || assetClass`) for positions in the selected category (not retirement-filtered). Each row shows the class label, its USD value, its % of category total, and a horizontal bar sized to that %. Empty positions list → empty bar list, no crash.

## Positions table

- Filters (asset-class tags, computed from all positions currently in state — not category-scoped — sorted alphabetically) + free-text search (matches symbol or name, case-insensitive substring) + category + retirement filter (from Nav) all compose.
- Columns: Security (symbol + name), Asset Class (effective), Shares, Avg Cost, Price, Cost Basis, Market Value, G/L (signed, colored), G/L %, Override.
- Clicking a sortable column header (Security/Asset Class/Shares/Avg Cost/Price) toggles asc/desc via `TOGGLE_SORT`; clicking the currently-sorted column flips direction, clicking a different one resets to `asc`. An arrow (`↑`/`↓`) appears next to the active sort column. Cost Basis/Market Value/G/L/G/L % columns are display-only, not sortable.
- **Override** column: `AssetClassOverrideSelect` — a button that opens a searchable dropdown of 7 seeded classes (Equity, ETF, Mutual Fund, Fixed Income, Crypto, Cash, Other) plus free-typed values. Selecting one sets `Position.assetClassManualOverride`; a "Clear override" option (shown only when an override is active) resets it to `undefined`. The button reads "Set" normally, "Override" (accent-colored) when an override is active.
- **Closed Positions** toggle: a clickable row showing "Show/Hide Closed Positions" + a badge with `state.closedPositions.length` (unfiltered — the badge is not scoped to the current category/retirement filter, even though the table itself, when shown, still lists all closed positions with no filter applied either).
- `ClosedPositionsTable` (shown when toggled): Security / Closed date / Realized G/L columns. Realized G/L renders `"unknown"` when `realizedGLBasis === 'unknown'`, otherwise a signed formatted USD amount; never a fabricated number.

## Transactions table

- Type filter tags (`All` + every distinct `Transaction.type` currently in state, alphabetical) + free-text search (symbol or date substring, case-insensitive) + category filter (from Nav; transactions are **not** affected by the retirement filter).
- Always sorted by date descending — no user-controlled sort.
- Columns: Date (formatted `MMM D, YYYY`), Symbol, Type (colored tag: Buy=accent, Sell=outline, Dividend=neutral, anything else=neutral), Shares, Price, Amount, Taxes (formatted USD or `—` if null), Position Link.
- **Position Link**: shows an "UNMATCHED" outline tag (with a tooltip explaining "likely fully sold or removed") when the transaction's symbol has no corresponding open `Position` among accounts in the current category; otherwise shows plain "Linked" text. This is purely derived per render — no stored flag.

## CSV import (Positions / Transactions)

Both dialogs share the same 4-step flow, opened by an "Import Positions"/"Import Transactions" button:

1. **File picker** — `<input type=file accept=.csv>`; on selection, parses immediately via Papa.parse (header row required, empty lines skipped, no type coercion).
2. **Profile select** — lists existing `MappingProfile`s for the relevant `kind` as buttons, or "Create New Profile".
3. **Profile editor** (only when creating/editing) — for each field in `POSITIONS_REQUIRED_FIELDS`/`TRANSACTIONS_REQUIRED_FIELDS`, a dropdown of the parsed CSV's headers; plus an optional "Account Number Column" dropdown. Positions validation requires `symbol`, `name`, `assetClass`, `shares` always, and *either* `avgCost` or `purchaseAmount`, and *either* `price` or `marketValue` (warns, doesn't block, if both alternatives in a pair are mapped — import will prefer `avgCost`/`price`). Transactions validation requires all of `date, symbol, type, shares, price, amount`. Errors block save and are listed inline.
4. **Review** — shows the chosen profile name, row count, and a CSV-header → field list; "Back" returns to profile-select, "Import" applies the mapping to every row and stores the result in `state.pendingImport`, then closes the dialog.

**Import processing** — when `pendingImport` is set, an App.tsx effect automatically:
- Groups rows by account number (resolved via the profile's `accountNumberColumn` mapping)
- For each account, resolves the account ID (creating a new account if needed; **note: first-seen-account prompt UI is not yet implemented — imports fail silently if account resolution needs prompt**)
- Calls `importPositions()` (which replaces positions for that account, creates closed positions for disappeared symbols, and upserts a snapshot) or `importTransactions()` (which deduplicates and inserts new transactions)
- Clears `pendingImport` when done

If any row lacks a mapped account number, it is skipped with a console warning.

## Formatting conventions

- USD: `fmtUSD(n)` → `"$1,234.56"` / `"-$1,234.56"` (no leading `+` on positives; callers that want a `+` prepend it themselves for G/L-style fields).
- Percent: `fmtPct(n)` → always signed, `"+1.20%"` / `"-1.20%"` / `"+0.00%"`.
- Shares: `toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})`.
- Dates in Transactions table: `Date.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'})` (e.g. "Jan 5, 2026"). Dates elsewhere (Performance chart labels, Closed Positions "Closed" column) are shown as raw ISO strings.
