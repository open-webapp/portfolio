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
- Analytics -> `BudgetAnalytics`.
- Category Mapping -> `CategoryMappingTab`, supplied all category-store props plus `state`/`dispatch`.
- `CategoryMappingTab` gates its UI on `categoriesHydrated`; BudgetPage does not defer the other tabs.
