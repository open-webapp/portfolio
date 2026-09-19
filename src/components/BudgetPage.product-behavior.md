# Budget Page

Sibling: `BudgetPage.design.md`.

- Spend has five read-only summary cards: budgeted income, actual income, budgeted spending, actual spend, variance.
- Income: active, non-deleted category name exactly `Income` after trim/lowercase.
- Budgeted income: selected-year Income definitions, monthly x12, yearly unchanged.
- Actual income: selected-year signed Income transactions.
- Default Spend table excludes Income and categories marked `excludeFromSpend`; Show excluded reveals both.
- A linked expense definition controls a transaction category over its stored category.
- No income edit control, auto-create, or drilldown.
