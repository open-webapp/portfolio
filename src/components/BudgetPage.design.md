# BudgetPage Design

Sibling: `BudgetPage.product-behavior.md`.

## API

```ts
BudgetPageProps = {
  state: AppState
  dispatch: (action: any) => void
  categories: Category[]
  categoryMappings: CategoryMapping[]
  categoryDispatch: (action: CategoryAction) => void
  categoriesHydrated: boolean
}
```

## Structure

- Local `period: 'expenses' | 'spend' | 'analytics' | 'categoryMapping'`; initialized as `'spend'`, never persisted.
- Expenses -> `BudgetExpensesTab`.
- Spend -> records, import, and category selection.
- Spend mapping overlay is keyed by transaction row ID; it derives only live mappings from that row's linked, live expense definition. Inline substring editing tracks the mapping ID and draft locally; updates/deletes dispatch the category-store action plus `REAPPLY_CATEGORY_MAPPINGS` with `updateCategoryMapping`/`deleteCategoryMapping` output, affecting this `state.budgetTransactions` only. The overlay has no add control and stays open when empty.
- Analytics -> `BudgetAnalytics`.
- Category Mapping -> `CategoryMappingTab`, supplied all category-store props plus `state`/`dispatch`.
- `CategoryMappingTab` gates its UI on `categoriesHydrated`; BudgetPage does not defer the other tabs.
