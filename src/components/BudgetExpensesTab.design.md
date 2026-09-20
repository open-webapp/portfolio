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

## Expense CSV Download

- The table action group is ordered: `Download Expenses`, `Import expenses`, `Add Expense`.
- Download click has no local dialog/state. It calls `buildExpenseCsv` from `lib/expenseExport.ts`, then `downloadCsvAsFile` from `lib/importExport.ts`.
- Builder inputs are the complete `budgetExpenseDefinitions`, `budgetExpenseAmountsByYear`, and `budgetTransactions` state plus shared categories and one click-time `Date`; visible table filtering/sorting does not scope the file.
- Before building, a focused inline name or amount edit is committed and its projected post-edit state is used. Escaped/cancelled drafts are not included. Category/frequency changes commit through their own controls.
- `buildExpenseCsv(definitions, amountsByYear, transactions, categories, now): string` derives columns with shared `expenseTableYears(transactions, amountsByYear, now)`, resolves category names, sorts all definitions by category then name, and returns CRLF CSV. Transactions contribute years only; no transaction row/data is emitted.
- `downloadCsvAsFile(csvText, filename): void` is the public browser Blob/anchor local-download utility (`text/csv;charset=utf-8`); it has no import, persistence, encryption, or Drive path.

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

## Category Drilldown

- Local `useState<string | null>` stores the expanded `categoryId`; selecting a category replaces the prior expansion, and selecting it again clears it.
- `ChevronIcon` renders the per-category expand/collapse affordance.
- The component consumes `categoryBreakdown()` rows with existing category totals plus additive `categoryId`, `drillLines`, and `unlinkedActual` fields.
- `drillLines` supplies linked definition budget, exact `spendExpenseId`-matched actual, variance, and bar values; `unlinkedActual` supplies the category actual not linked to a definition.
