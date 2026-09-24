# BudgetPage Product Behavior

Sibling: `BudgetPage.design.md`.

## Tabs

- Three App-owned tabs: Expenses, Spend, Analytics. The selector appears in the Budget top bar, not in BudgetPage; the tab strip scrolls horizontally where needed.
- Spend is the App-session default. Tab and All/year scope selection remain when navigating away from and back to Budget, but are not persisted across app reloads.
- When Spend is selected, the top-bar year selector shares the tab row, right-aligned, and offers `All` plus transaction years. Selecting a concrete year without an expense snapshot creates that year's snapshot; `All` does not.
- The Category Mapping tab groups portfolio-scoped expense-name + category -> substring mappings by category and expense definition (`<expense name> (<category>)`), with an `+ add substring` input per definition. Empty categories render no mapping rows. Definitions with no matching global category appear under `Unmatched expenses`; mappings with no matching definition appear under `Orphaned substrings`. Mapping edits save on Enter; blank substrings are ignored. Deleting a mapping requires native confirmation.
## Spend Records

- The Spend view uses the shell-controlled All/year scope, then shows three summary cards and a Budget flow Sankey chart before the records card.
- Spend vs budget shows scoped actual spending against scoped budget. Projected spend uses the current-date projection and marks over/under budget. Savings rate is available for a selected year; its edit control updates the aggregate annual income budget. A fourth summary card is out of scope.
- Budget flow is derived by `sankeyFlowData` from scoped budget definitions/annual amounts and transactions, aggregated by category. It shows Income -> category budgets -> category actuals, with unused budget flowing to Unspent; no data shows `No budget flow for this period.`
- Search matches description, account, tags (case-insensitive substring), and the displayed Spend Category label, including `Uncategorized (<category>)` for unlinked records.
- Recurring spend is one representative per month in a chain of >=3 consecutive calendar months with the same account name and effective category; absolute amounts must be within +/-10% of the running chain average. Income and categories with `excludeFromSpend` are never flagged.
- Recurring classification always considers all `budgetTransactions`, independent of the Spend year/`All years` scope selector.
- Flagged rows show a non-interactive repeat icon titled `Recurring spend` before the delete button.
- The records-card header's `Show recurring only` checkbox filters to flagged rows and resets pagination, like the other header controls.
- Rows whose linked live expense has >=1 live mapping expose a mapping overlay from the description cell.
- The reusable category-mappings dialog is scoped by selected row ID to that row's linked expense's live mappings only. It cannot add mappings; X closes it and it remains open when empty.
- In the overlay, click a mapping substring to edit it inline. Enter saves a trimmed, non-empty changed value and reapplies mappings to the current portfolio; blur, invalid input, and unchanged input keep editing open. Escape first cancels inline editing, then closes the overlay.
- Deleting a mapping requires native confirmation, immediately reapplies mappings to the current portfolio, and leaves the overlay open when no mappings remain.
- Import requires an existing account selection or a new account name; that name applies to the entire batch. Imported rows are canonicalized before dedup, and the applied convention marker persists even for a duplicate-only import. CSV adds an optional 4th Tags column (`;`-delimited, validated per token); OFX/QFX parsing is tag-free.
- Spend records have a non-sortable Tags column between Account and Amount. Clicking a Tags cell opens an inline `TagInput` pre-populated from `row.tags ?? []`; blur commits `UPDATE_BUDGET_TRANSACTION` with the full merged array (`tags: undefined` when emptied, never `[]`); Escape reverts with no dispatch. × (`Remove <tag>`) and Backspace-on-empty commit `UPDATE_BUDGET_TRANSACTION` immediately without waiting for blur (editor stays open); Escape after a removal does not resurrect it. Untagged rows render an empty state, never "undefined".
- Add Record has a Tags field (`TagInput`, `aria-label="Record tags"`); submit carries `tags: recTags.length ? recTags : undefined` and resets to `[]`.
- Bulk-edit action bar has a Tags input (`aria-label="Bulk edit tags"`); Apply sends `tagsToAdd: bulkTags.length ? bulkTags : undefined` alongside `categoryId`/`spendExpenseId` (union case-insensitively per row, existing casing wins, cap 5, overflow dropped). Apply stays disabled until a category is chosen; `bulkTags` clears after Apply.
- Tag filter removed: no combobox; Search substring-matches tags.
