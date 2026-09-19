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
- Mapping mutations calculate next mappings with category-store helpers, then dispatch `REAPPLY_CATEGORY_MAPPINGS` through the app reducer immediately.
- JSON import parses with `parseCategoryMappingImportFile`, merges with `mergeCategoryState` through `__MERGE_IMPORTED`, then immediately reapplies the computed merged mappings.
- JSON export uses `downloadJsonAsFile({ categories, categoryMappings }, filename)`; format, unencrypted storage, and merge-not-replace import semantics are unchanged.
