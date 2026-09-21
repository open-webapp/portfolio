# BudgetExpensesTab behavior

Component behavior reference. Sibling: `BudgetExpensesTab.design.md`.

## Actual-Spend Overview

- Above the existing Expenses table and Category Breakdown, the tab shows four summary cards, an expense-by-category stream graph, and action items. The table and drilldown retain their existing behavior.
- Summary cards and action items use the Category Breakdown's selected year. It initially selects the first available budget year; changing its Year control refreshes those sections and the breakdown. The stream graph spans all active-spend years.
- **Spend** is the sum of absolute transaction amounts for that year, shown against the sum of configured expense amounts for that year.
- **Average transaction** is spend divided by transaction count, shown against the largest absolute transaction.
- **Largest transaction** shows its absolute amount, category, and description; with no transactions it shows `$0` and `No transactions`.
- **Top category by spend** shows the largest summed absolute transaction amount by category; with no transactions it shows `$0` and `No transactions`.
- Progress bars never exceed 100%; zero denominators render an empty bar.
- **Expense by category** is a stacked annual actual-spend area graph from all active-spend years, with year labels and a category legend showing all-time displayed totals. It omits excluded/deleted categories and categories without positive spend. If no graphable data exists, it shows `No expense activity to chart.`
- **Action items** lists each category whose selected-year actual exceeds its budget, highest dollar overage first. Each item shows category, dollar overage, percentage over budget, and review guidance. A category with actual spend and no budget shows `∞%`; no overages shows `No categories over budget`.

## Expense CSV Download

- `Download Expenses` is the first action button, before `Import expenses` and `Add Expense`.
- Clicking it immediately downloads locally; it opens no dialog and does not import, persist, encrypt, sync, or contact Drive.
- Filename: `expenses-YYYY-MM-DD.csv`, using the click's local calendar date and zero-padded month/day.
- File columns: `Name`, `Category`, `Frequency`, then every shared expense-table year (years from budget transaction dates and amount-map keys, plus the current calendar year).
- File rows: every expense definition, regardless of visible category filter/table sort; rows sort by resolved category name, then expense name. Categories missing from shared categories use their stored category ID. Frequency is `Monthly` or `Yearly`; unset year amounts are blank and set amounts are raw numbers.
- Budget transactions affect only the year columns. Actual transaction description, account, amount, and transaction rows are never exported.
- With no definitions, the file contains only the header row and applicable years.
- Text fields use CSV escaping and formula-leading text (`=`, `+`, `-`, `@`) is prefixed with an apostrophe. Numeric amounts, including negative values, remain numeric.
- A focused inline name or amount draft is committed before download; an Escape-cancelled draft is excluded.

## Paste Import

- `Import expenses` opens a dialog with a year field and paste area.
- Input format: header row followed by `Name` and `Amount` rows, tab- or comma-separated.
- Year must be exactly four digits. Import is disabled for an invalid year or no valid rows.
- Invalid data lines are skipped, listed by line number and reason, and do not block importing valid rows.
- Dialog reports total data lines, valid rows, imported identities, skipped-invalid rows, and created, updated, unchanged counts.
- `Imported` is the number of distinct valid name identities after duplicate folding; `Valid` counts valid input rows before folding.

## Category Target

- Imports target the first category named `Uncategorized`, matching case-insensitively after trimming whitespace.
- If none exists, importing creates `Uncategorized` and uses it as the target.
- Existing expenses are matched only inside that target category; same-name expenses in other categories are not reused.

## Duplicates And Mutation

- Names match after trimming whitespace and case-folding.
- Duplicate pasted names use the first row's spelling and the last row's amount.
- A new identity creates a monthly expense definition in `Uncategorized` and sets its selected-year amount.
- An existing target-category identity updates only its selected-year amount when it differs; an equal amount is unchanged.
- Import never alters expense amounts in other years or an existing definition's name, category, or frequency.

## Dialog Lifecycle

- Successful import leaves the dialog open and shows its result count.
- Changing the year or pasted text clears the result message.
- Cancel, backdrop close, and dialog close reset the year to the current year, clear pasted text, and clear the result message.

## Category Drilldown

- Clicking a Category Breakdown category row or its chevron expands/collapses its details; expansion is a single accordion, so opening one category closes another.
- Each linked expense line shows budget, exact actual from records linked by `spendExpenseId`, variance, and budget/actual bars.
- **Unlinked transactions** appears exactly when the category's unlinked actual is nonzero, including when it has zero expense definitions.
- No definitions and no unlinked spend: show "No budget lines in this category."
- No definitions but unlinked spend: show the **Unlinked transactions** row, not the empty copy.
