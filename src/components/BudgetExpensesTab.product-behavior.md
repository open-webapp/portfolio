# BudgetExpensesTab behavior

Component behavior reference. Sibling: `BudgetExpensesTab.design.md`.

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
