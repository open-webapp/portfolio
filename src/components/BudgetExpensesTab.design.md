# BudgetExpensesTab design

Component reference. Sibling: `BudgetExpensesTab.product-behavior.md`.

## API

```ts
type BudgetExpensesTabProps = {
  state: AppState
  dispatch: Dispatch<AppAction>
  categories: Category[]
  categoryDispatch: Dispatch<CategoryAction>
}
```

- `state` supplies budget definitions, per-year amounts, filters, and selected year.
- `dispatch` applies app-state mutations, including `IMPORT_EXPENSE_PASTE`.
- `categories` supplies category labels and locates `Uncategorized`.
- `categoryDispatch` creates `Uncategorized` when absent.

## Import Dialog

- Local state: visibility, `importYear` (initialized/reset to current four-digit year), pasted text, and post-import result text.
- Derived on every render: `parseExpensePaste(importText)`, four-digit-year validity, case/trim-insensitive `Uncategorized` category lookup, and `planExpensePasteImport(...)` preview.
- Close/cancel/backdrop close resets all import-dialog local state; importing leaves it open with the result message.

## Import Flow

1. `parseExpensePaste` returns valid rows, errors, and total data-line count.
2. `planExpensePasteImport` folds/plans valid rows against the selected year and resolved target category for preview counts.
3. On import, the component finds the first case/trim-insensitive `Uncategorized` category or dispatches `ADD_CATEGORY` with that name and a generated ID.
4. The component dispatches one `IMPORT_EXPENSE_PASTE` action with the year, resolved category ID, and valid parser rows.
5. Reducer delegates to `importExpensePaste`; it creates definitions or updates selected-year amounts.

## Identity And Scope

- Paste identity: `name.trim().toLowerCase()`.
- Existing-definition match: first definition with that identity in the target `Uncategorized` category only.
- New definitions retain first pasted spelling, target `Uncategorized`, and use `monthly` frequency.
- Definitions are year-independent. `budgetExpenseAmountsByYear[year]` is the only amount map mutated by an import; other years remain unchanged.
