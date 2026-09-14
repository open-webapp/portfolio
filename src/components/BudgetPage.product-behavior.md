# BudgetPage — Product Behavior

Sibling doc: `BudgetPage.design.md` (props, state, data flow, formulas).

## Period toggle (Monthly / Yearly)

- Two-option `.seg` control at top of page, defaults to **Monthly** on every mount (not persisted).
- Switching period changes: the Budgeted/Income totals' basis (monthly vs. annualized), the month-vs-year picker below it, and all "Actual"/Records/Category-Breakdown figures (which re-filter by the currently selected month or year, independently tracked).

## Income — click-to-edit + mutual exclusivity

| Step | Behavior |
|---|---|
| Default view | Income card shows `fmtUSD(totalIncome)` + a "✎" edit button |
| Click "✎" | Input replaces the display, pre-filled with the **raw stored value for the current period** (`budgetIncomeMonthly` if Monthly, `budgetIncomeYearly` if Yearly) — not the blended `totalIncome` |
| Press Enter in the input | Dispatches `SET_BUDGET_INCOME_FOR_PERIOD` with the current `period` and the parsed amount (`parseFloat(...) \|\| 0`), then closes the editor |
| No Cancel/blur handling | There is no explicit Cancel button or blur-to-save/cancel; only Enter commits |

**Breaking-change note (real behavior, not a bug):** `setBudgetIncomeForPeriod` in `src/lib/state.ts` treats monthly and yearly income as **mutually exclusive** — saving an amount for one period **zeroes the other field**. E.g. entering a monthly income of $5,000 sets `budgetIncomeMonthly = 5000` AND `budgetIncomeYearly = 0` in the same write, discarding whatever yearly income was previously set (and vice versa). Switching the period toggle after editing one will show the other period's income as $0 unless it's re-entered.

## Add / edit / delete expense

- "Add Expense" button (bottom of Expenses card) opens a modal dialog (`.dialog-backdrop`/`.dialog`) titled "Add expense" with fields: Name (text), Category (select, see category derivation below), Amount (number), Frequency (Monthly/Yearly select).
- "Add" button: no-op (dialog stays open) if `formName.trim()` is empty, or `amount` is falsy/`<= 0` (`parseFloat(formAmount)`). On success dispatches `ADD_BUDGET_EXPENSE` with `{ name: formName.trim(), category, amount, frequency }`, closes dialog, resets all four form fields.
- "Cancel" button and clicking the backdrop both close the dialog and reset all four form fields identically (no draft is preserved).
- Existing expense row "Edit" link switches that row to inline inputs (Name text input, Category select, Frequency select, Amount number input). Name/Frequency/Amount dispatch `UPDATE_BUDGET_EXPENSE` immediately per keystroke/change; Category is staged in `editCategoryDraft` and only dispatched (if changed) when "Done" is clicked.
- Row "Delete" link: `window.confirm('Delete this expense? This cannot be undone.')` — on confirm dispatches `DELETE_BUDGET_EXPENSE`; on cancel, no-op.

## Category derivation + "+ Add new category…"

- The category list offered in every category `<select>` on the page is `allBudgetCategories(state.budgetExpenses, state.budgetTransactions)` — the union of every category currently used by any budget expense or any budget transaction, sorted alphabetically. There is no separate stored category list; categories exist only by being referenced.
- Every category `<select>` appends one final option: **"+ Add new category…"** (sentinel value `__add_new`).
- Selecting it triggers `window.prompt('New category name')`. If the user enters non-blank text (after `.trim()`), that trimmed string becomes the selected category value (passed through to whatever the specific form/field does with it — set local state, or stage `editCategoryDraft`). If the prompt is cancelled or the entered text is blank/whitespace-only, the selection is a no-op — the select's value is left unchanged.
- A category not yet in `allBudgetCategories` (freshly typed via the prompt, and not yet saved) is rendered as an extra one-off `<option>` so the select can display it before it exists anywhere else in state.

## Month/Year picker default

- On mount, `selectedMonth` defaults to `availableBudgetMonths(state.budgetTransactions, new Date())[0].value` and `selectedYear` to `availableBudgetYears(state.budgetTransactions, new Date())[0]` — both functions always include the **real current** month/year (via `new Date()`) in their candidate set before sorting descending, so the picker always defaults to the actual current month/year even if no transactions exist yet for it. (If transactions with later dates exist, those override — e.g. a future-dated transaction sorts before "now".)

## Records section

### Manual "Record spend" entry

- Inline form at the bottom of the Records card: Date (date input), Description (text), Category (select, same derivation/`+Add new` behavior as above), Amount (number).
- "Add Record" button: no-op if `recDate` is empty, or `amount` is falsy/`<= 0` (`parseFloat(recAmount)`).
- **Description fallback rule**: if `recDescription.trim()` is empty, the transaction's `description` is set to the selected category (`recCategory`) instead. A non-empty description is used trimmed.
- On success dispatches `ADD_BUDGET_TRANSACTION` with `{ date, description, category, amount }`; clears `recDate`, `recDescription`, `recAmount` (category field is left as-is, not reset).

### CSV import (Copy-Paste and Upload-file tabs)

- "Import transactions…" link opens a modal dialog titled "Import transactions" with a `.seg` tab toggle: **Copy-Paste** (textarea, "Paste CSV") and **Upload file** (drag-and-drop / click-to-browse zone accepting `.csv`; shows the picked filename or "No file selected", plus hint text "Drag and drop, or click to browse").
- Both tabs feed the same underlying `csvText` state — Upload-file reads the dropped/picked file via `FileReader.readAsText` and sets `csvText` from its contents; there is no separate parse path per tab.
- "Import" button calls `parseBudgetTransactionsCsv(csvText)`, dispatches `IMPORT_BUDGET_TRANSACTIONS` with the parsed rows, sets the status line to `"{n} row(s) detected"` (n = parsed row count, before dedup), closes the dialog, and clears `csvText` (but not `importFileName`).
- "Cancel" / backdrop click closes the dialog and clears `csvText` only.

### Dedup rule (exact)

`importBudgetTransactions` (`src/lib/state.ts`) dedups on the natural key **`date|description|category|amount`** (raw values, no normalization/case-folding), checked against:
1. Every existing `state.budgetTransactions` entry, AND
2. Every row already accepted earlier in the **same** import batch (an accumulating `Set`, so duplicate rows within one pasted/uploaded CSV are also collapsed to the first occurrence).

Rows whose key already exists in the seen-set are silently dropped — no error/warning is surfaced for skipped duplicates; only the accepted-row count reaches `importStatus` via the pre-dedup parse count (see above — the displayed count is rows *parsed*, not rows actually *added*, since dedup happens inside the reducer after the count is already set).

### Crude CSV parser quirks (`parseBudgetTransactionsCsv`, `src/lib/computations.ts`)

- **Not RFC 4180**: no quoting/escaping support. Fields are split on raw `,`; a comma inside a description or category breaks column alignment.
- **Header-detection heuristic**: the first non-blank line is dropped **only if** its last comma-separated field fails to parse as a float (`isNaN(parseFloat(...))`). This is a documented quirk, not a bug: a legitimate first data row whose amount field happens to look non-numeric (e.g. malformed, or a stray label) will be misidentified as a header and silently dropped.
- Per-row parsing: splits each line on `,`, trims each part; rows with fewer than 4 fields are skipped; a row is skipped if `date` is empty or `amount` fails to parse as a float; an empty `category` field defaults to `"Other"`.
- Blank lines (after `.trim()`) are filtered out before header-detection and row-parsing.

## Delete confirmations (exact strings)

| Row type | `window.confirm` string |
|---|---|
| Expense | `Delete this expense? This cannot be undone.` |
| Budget transaction (Record) | `` Delete "{row.description}"? This cannot be undone. `` (description interpolated, e.g. `Delete "Groceries"? This cannot be undone.`) |

## Category Breakdown per-category-not-per-row quirk

The Expenses table's **Actual** and **Variance** columns are looked up per-`row.category` from `actualByCategory(periodFilteredTransactions)` (a `Record<category, total>`), not per individual expense row. **Intentional**: two expense rows sharing the same category will display identical Actual and Variance figures — each shows that category's total actual spend, not spend attributable to that specific expense line.

## Empty-state messages (exact copy)

| Location | Condition | Message |
|---|---|---|
| Expenses table | `visibleExpenses(...)` returns 0 rows (post filter) | `No expenses to show.` |
| Category Breakdown panel | `state.budgetExpenses.length === 0` | `Add expenses to see the breakdown.` |
| Records table | `sortedRecords.length === 0` for the selected period | `No records for this period.` |
| Import status line | Before any import this session | `Never imported` |
| Import status line | After an import | `{n} row(s) detected` |
| Upload-file drop zone | No file picked/dropped yet | `No file selected` |

## Other edge cases

- Summary cards always render (never hidden even with zero expenses/transactions/income) — all four show `$0.00`-equivalent via `fmtUSD` when their underlying totals are zero.
- Variance card color: `GAIN_COLOR` when `totalExpense >= totalActual` (under/at budget), else `LOSS_COLOR`.
- Category Breakdown "Over by"/"Under by" line: `variance < 0` → `Over by {fmtUSD(abs(variance))}`; otherwise → `Under by {fmtUSD(abs(variance))}` (a variance of exactly 0 reads as "Under by $0.00").
- Records table "Edit" inline mode: Date/Description/Amount fields dispatch nothing until "Done" is clicked (unlike the Expenses table, where Name/Frequency/Amount dispatch per-change) — the entire row's edits (including category) are staged in `recordDraft` and committed together as one `UPDATE_BUDGET_TRANSACTION` on "Done".
