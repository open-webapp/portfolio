# CategoryMappingTab Design

Sibling: `CategoryMappingTab.product-behavior.md`.

## API

```ts
CategoryMappingTabProps = {
  state: AppState
  dispatch: (action: any) => void
  categories: Category[]
  categoryMappings: CategoryMapping[]
  categoryDispatch: (action: CategoryAction) => void
  categoriesHydrated: boolean
}
```

## Data Flow

- `categoriesHydrated === false` -> loading-only section.
- Category actions dispatch through `categoryDispatch` to the Global Category Store.
- Category headers derive all-year effective Spend-record counts from the supplied `state.budgetTransactions` and `state.budgetExpenseDefinitions`, using `effectiveCategoryId`; no other portfolio state is read or requested.
- Category delete remains component-guarded: alert for `Other`, then alert when definitions or effective Spend records exist; otherwise native confirm then `categoryDispatch({ type: 'DELETE_CATEGORY', id })`. The Global Category Store action remains an unconditional tombstone.
- Mapping mutations dispatch portfolio-scoped `AppAction`s (`ADD/UPDATE/DELETE_CATEGORY_MAPPING`) through the app reducer, which applies the change and immediately reapplies mappings to the current portfolio's `budgetTransactions`. Blank substrings are ignored on save/add.
- Matched expenses render per-category via `filter(e.categoryId === category.id)` + `mappingsForExpense(categoryMappings, expense.id)`; `Unmatched expenses` = definitions with no global `categoryId` match, `Orphaned substrings` = mappings with no `spendExpenseId` match, so ID drift never silently hides rows.
- Tab mapping CRUD is separate from, and unchanged by, BudgetPage's row-scoped mapping overlay; this tab does not render that overlay. Both delete paths use native confirmation.
- Category-mapping JSON import/export lives in the portfolio picker settings panel, not this tab.
