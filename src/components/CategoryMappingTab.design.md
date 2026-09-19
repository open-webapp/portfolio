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
- Mapping mutations calculate next mappings with category-store helpers, then dispatch `REAPPLY_CATEGORY_MAPPINGS` through the app reducer immediately.
- Tab mapping CRUD is separate from, and unchanged by, BudgetPage's row-scoped mapping overlay; this tab does not render that overlay. Both delete paths use native confirmation, compute next mappings with the same helpers, then reapply to the current portfolio's supplied `state.budgetTransactions`.
- JSON import parses with `parseCategoryMappingImportFile`, merges with `mergeCategoryState` through `__MERGE_IMPORTED`, then immediately reapplies the computed merged mappings.
- JSON export uses `downloadJsonAsFile({ categories, categoryMappings }, filename)`; format, unencrypted storage, and merge-not-replace import semantics are unchanged.
- Props are unchanged; category-delete counts and guards derive entirely from the existing API above.
