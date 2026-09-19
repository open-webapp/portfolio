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
