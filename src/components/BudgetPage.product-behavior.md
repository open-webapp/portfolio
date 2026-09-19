# BudgetPage Product Behavior

Sibling: `BudgetPage.design.md`.

## Tabs

- Four local tabs: Expenses, Spend, Analytics, Category Mapping.
- Spend is the default on every mount/remount.
- Tab selection is not persisted.
- Category Mapping renders `Loading category mappings...` until global categories hydrate; mapping controls are unavailable before then.

## Category Mapping

- Hosts the category/mapping management UI; see `CategoryMappingTab.product-behavior.md`.
- Category-mapping JSON import/export and immediate automatic reapply keep their existing behavior.

## Spend Records

- Search matches description, account, and the displayed Spend Category label, including `Uncategorized (<category>)` for unlinked records.
- Rows whose linked live expense has >=1 live mapping expose a mapping overlay from the description cell.
- The overlay is scoped by selected row ID to that row's linked expense's live mappings only. It cannot add mappings; X closes it and it remains open when empty.
- In the overlay, click a mapping substring to edit it inline. Enter saves a trimmed, non-empty changed value and reapplies mappings to the current portfolio; blur, invalid input, and unchanged input keep editing open. Escape first cancels inline editing, then closes the overlay.
- Deleting a mapping requires native confirmation, immediately reapplies mappings to the current portfolio, and leaves the overlay open when no mappings remain.
