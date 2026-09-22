# BudgetPage Design

Sibling: `BudgetPage.product-behavior.md`.

## API

```ts
BudgetPageProps = {
  state: AppState
  dispatch: (action: any) => void
  categories: Category[]
  categoryMappings: CategoryMapping[] // state.categoryMappings supplied by App
  categoryDispatch: (action: CategoryAction) => void
  budgetAccountRules?: BudgetAccountRule[]
  period: 'expenses' | 'spend' | 'analytics' | 'categoryMapping'
  setPeriod: (period: 'expenses' | 'spend' | 'analytics' | 'categoryMapping') => void
  selectedScope: SpendScope
  setSelectedScope: Dispatch<SetStateAction<SpendScope>>
}
```

## Structure

- `period`/`setPeriod` and `selectedScope`/`setSelectedScope` are App-owned props. `PeriodSegControl` is in App's Budget top bar, not BudgetPage; its four tabs are Expenses, Spend, Analytics, and Category Mapping (inline grid icon + label). Period and scope survive cross-view navigation during the app session, but are not persisted.
- The shell control keeps tabs and the Spend All/year selector on a single row (tabs centered and horizontally scrollable where needed; selector right-aligned, Spend-only, no visible label, empty cell on other tabs so tabs never shift). BudgetPage consumes the controlled scope for Spend calculations and requests `ENSURE_BUDGET_YEAR_SNAPSHOT` through App's scope handler when a concrete year lacks a snapshot.
- Local `showRecurringOnly` controls the Spend records recurring-only filter; initialized `false`, never persisted.
- `computeRecurringSpendIds` from `selectors.ts` runs each render against full `state.budgetTransactions`, not `periodFilteredTransactions`; its result drives the recurring-only filter and row icon.
- Expenses -> `BudgetExpensesTab`.
- Spend -> controlled All/year scope; three summary cards; `BudgetSankey`; records, import, and category selection.
- Summary cards: Spend vs budget (scoped actual/budget percentage and amounts); Projected spend (current-date projection and over/under budget status); Savings rate (selected-year rate, with inline aggregate annual income-budget editing). There is intentionally no fourth summary card.
- `sankeyFlowData(definitions, amountsByYear, transactions, categories, selectedScope)` supplies category-aggregated budget/actual nodes and links to `BudgetSankey`; unused budget flows to `Unspent`. The chart renders between summary cards and Spend records.
- Spend mapping overlay is keyed by transaction row ID; it reads portfolio-scoped `state.categoryMappings` and derives mappings from that row's linked, live expense definition. Inline substring editing tracks the mapping ID and draft locally; updates/deletes dispatch `AppAction` mapping mutations, which reapply this portfolio's `budgetTransactions` internally. The overlay has no add control and stays open when empty.
- Analytics -> `BudgetAnalytics`.
- Category Mapping -> `CategoryMappingTab` (`CategoryMappingTab.tsx`: `state`, `dispatch`, `categories`, `categoryMappings`, `categoryDispatch`, `categoriesHydrated`). Renders category CRUD (rename, exclude-from-spend, guarded delete) plus substring mappings grouped by category and expense definition. Mapping add/edit/delete dispatch portfolio-scoped `AppAction`s (`ADD/UPDATE/DELETE_CATEGORY_MAPPING`), which reapply this portfolio's `budgetTransactions` internally; category ops dispatch global `CategoryAction`s.
- Import requires an existing canonical account selection or a new account name. `convertBudgetAccountImportRows` canonicalizes the name and converts `positiveSpend` imports to canonical negative spend before `IMPORT_BUDGET_TRANSACTIONS`; its `appliedConvention` marker persists even for a duplicate-only batch. Parsers remain unchanged.
- `TagInput` (`TagInput.tsx`: `value: string[]`, `onChange`, `ariaLabel?`, `disabled?`) — reusable free-form tag editor: `.tag.tag-outline` chips with per-chip remove + text input; invalid chars stripped live, 10-char token cap, Enter/`,` commits, 5-chip cap with case-insensitive dedup (first casing wins), Backspace on empty input removes last chip. Consumed by the Spend Tags cell editor, the Add Record Tags field, and the bulk-edit action bar Tags input.
- Spend tag filter combobox is inline in `BudgetPage.tsx` (not a new file): component-local `tagFilter`/`tagFilterQuery` state plus a `useMemo` distinct-tags-in-scope list, mirroring the inline `showExcludedRecords` precedent.
