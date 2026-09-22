# CategoryMappingTab Product Behavior

Sibling: `CategoryMappingTab.design.md`.

- Rendered only through Budget's local Category Mapping tab.
- Before global categories hydrate, displays `Loading category mappings...`; no mapping controls are shown.
- Supports category rename and exclude-from-spend toggle; displays each category's expense definitions and their mapping substrings.
- Each category header shows its all-year effective Spend-record count from the current portfolio only and a visible delete affordance.
- Delete guard paths use native `window.alert`: categories with any expense definition are blocked; categories with any effective Spend record (resolved with linked expense category first, then transaction fallback) are blocked. `Other` shows no delete affordance at all. An unblocked delete uses native `window.confirm`; confirmation dispatches unchanged `DELETE_CATEGORY`, tombstoning the category.
- Supports adding, editing, and deleting mapping substrings. Enter saves a trimmed, non-empty edited substring and exits edit mode; delete requires confirmation.
- Category-mapping JSON import/export lives in the portfolio picker settings panel, not this tab.
- Every mapping mutation immediately reapplies mappings to budget transactions. No manual reapply control exists.
- Tab CRUD is separate and unchanged from BudgetPage's row-scoped mapping overlay; this tab never renders that overlay. Both surfaces use native confirmation before mapping deletion and immediately reapply the resulting mapping list to the current portfolio.
