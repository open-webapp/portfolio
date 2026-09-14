# BudgetPage — Design

Sibling doc: `BudgetPage.product-behavior.md` (user-visible behavior, edge cases, exact copy).

## Location

`src/components/BudgetPage.tsx` — rendered by `App.tsx` when `state.view === 'budget'`.

## Props (`BudgetPageProps`)

| Prop | Type | Purpose |
|---|---|---|
| `state` | `AppState` | Full app state; component reads `budgetIncomeMonthly`, `budgetIncomeYearly`, `budgetExpenses`, `budgetTransactions` |
| `dispatch` | `(action: any) => void` | Dispatches all `BUDGET_*` action types below |

## Local state (`useState`)

| Field | Type | Reads/writes `AppState` |
|---|---|---|
| `period` | `'monthly' \| 'yearly'` | Drives which `AppState` fields/derivations are shown; not itself persisted |
| `filterCategory` | `string` (`'__all'` or a category) | Filters `state.budgetExpenses` view only |
| `sortBy` | `'category' \| 'name' \| 'amount'` | Sorts `state.budgetExpenses` view only |
| `showAddExpenseDialog` | `boolean` | Gates Add-Expense dialog |
| `formName`, `formCategory`, `formAmount`, `formFrequency` | `string`/`string`/`string`/`'monthly'\|'yearly'` | Add-Expense dialog draft; on submit dispatches `ADD_BUDGET_EXPENSE` |
| `editingId` | `string \| null` | Which expense row is in inline-edit mode |
| `editCategoryDraft` | `string \| null` | Pending category value for the row being edited (category changes are staged, not dispatched per-keystroke like other fields) |
| `editingIncome` | `boolean` | Gates income inline-edit input on the Income card |
| `incomeEditAmount` | `string` | Income edit draft; on save dispatches `SET_BUDGET_INCOME_FOR_PERIOD` |
| `selectedMonth` | `string` (`YYYY-MM`), init `availableBudgetMonths(state.budgetTransactions, new Date())[0].value` | Which month's records/actuals are shown (monthly period) |
| `selectedYear` | `string` (`YYYY`), init `availableBudgetYears(state.budgetTransactions, new Date())[0]` | Which year's records/actuals are shown (yearly period) |
| `recordDraft` | `{id, date, description, category, amount} \| null` | Inline-edit draft for a Records row; on save dispatches `UPDATE_BUDGET_TRANSACTION` |
| `recDate`, `recDescription`, `recCategory`, `recAmount` | `string` each | "Add Record" form fields; on submit dispatches `ADD_BUDGET_TRANSACTION` |
| `showImportDialog` | `boolean` | Gates Import-transactions dialog |
| `importTab` | `'paste' \| 'upload'` | Which import sub-tab is active |
| `csvText` | `string` | CSV content (typed directly, or loaded from a picked/dropped file) fed to `parseBudgetTransactionsCsv` |
| `importFileName` | `string` | Display name of the picked/dropped file (Upload tab) |
| `importStatus` | `string`, init `'Never imported'` | Status line under "Import transactions…" link, e.g. `"{n} row(s) detected"` |
| `importFileInputRef` | `RefObject<HTMLInputElement>` | Hidden `<input type="file">` for Upload tab |

`categories` (derived, not `useState`) = `allBudgetCategories(state.budgetExpenses, state.budgetTransactions)`; recomputed every render, used to seed `formCategory`/`recCategory` initial state and to populate every category `<select>`.

## Data flow — dispatch actions

| Action | Dispatched from | Payload |
|---|---|---|
| `ADD_BUDGET_EXPENSE` | Add-Expense dialog "Add" | `{ expense: { name, category, amount, frequency } }` |
| `UPDATE_BUDGET_EXPENSE` | Inline expense-row edit (per-field on change; category via "Done" button) | `{ id, patch }` |
| `DELETE_BUDGET_EXPENSE` | Expense-row "Delete" (after `window.confirm`) | `{ id }` |
| `ADD_BUDGET_TRANSACTION` | Records "Add Record" | `{ tx: { date, description, category, amount } }` |
| `UPDATE_BUDGET_TRANSACTION` | Records row "Done" (inline edit) | `{ id, patch: { date, description, category, amount } }` |
| `DELETE_BUDGET_TRANSACTION` | Records row "Delete" (after `window.confirm`) | `{ id }` |
| `IMPORT_BUDGET_TRANSACTIONS` | Import dialog "Import" | `{ rows: parseBudgetTransactionsCsv(csvText) }` |
| `SET_BUDGET_INCOME_FOR_PERIOD` | Income card save (Enter key on the amount input) | `{ period, amount: parseFloat(incomeEditAmount) \|\| 0 }` |

No other `BUDGET_*` action types exist in `reducer.ts`/`state.ts` are used by this component (`SET_BUDGET_INCOME_MONTHLY`/`SET_BUDGET_INCOME_YEARLY` exist in the reducer but are not dispatched here — the component always goes through `SET_BUDGET_INCOME_FOR_PERIOD`).

## Component tree / rendered order

1. Header row: "Budget" title + Monthly/Yearly `.seg` toggle (`period`).
2. Month/Year `.field` picker (single `<select>`, swaps options based on `period`).
3. Summary cards row (`data-testid="summary-cards"`, 4-up grid): Income (click-to-edit) · Budgeted (period total) · Actual spend (rangeLabel) · Variance.
4. Add-Expense dialog (`.dialog-backdrop`/`.dialog`), rendered conditionally on `showAddExpenseDialog`, overlays regardless of scroll position (not part of the visual flow below).
5. 2-column grid (`1.6fr 1fr`):
   - Left: Expenses card — filter/sort controls, expense `<table>` (or "No expenses to show."), "Add Expense" button.
   - Right: Category Breakdown card — per-category bar rows (or "Add expenses to see the breakdown.").
6. Records card (full width) — records `<table>` (or "No records for this period."), "Add Record" inline form, "Import transactions…" link + `importStatus` text.
7. Import-transactions dialog (`.dialog-backdrop`/`.dialog`), rendered conditionally on `showImportDialog`.

## Key formulas / derived values

| UI value | Backing function | Source module |
|---|---|---|
| `categories` | `allBudgetCategories(expenses, transactions)` | `selectors.ts` |
| Expense table rows | `visibleExpenses(state.budgetExpenses, filterCategory, sortBy, period)` | `selectors.ts` |
| Month `<select>` options | `availableBudgetMonths(state.budgetTransactions, new Date())` | `selectors.ts` |
| Year `<select>` options | `availableBudgetYears(state.budgetTransactions, new Date())` | `selectors.ts` |
| Records table rows | `budgetTransactionsForPeriod(transactions, period, selectedMonth, selectedYear)`, then locally sorted by `date` descending | `selectors.ts` |
| Actual-spend-by-category (used in expense table's Actual/Variance columns) | `actualByCategory(periodFilteredTransactions)` | `selectors.ts` |
| Category Breakdown panel rows | `categoryBreakdown(state.budgetExpenses, periodFilteredTransactions, period)` | `selectors.ts` |
| CSV → transaction rows | `parseBudgetTransactionsCsv(csvText)` | `computations.ts` |
| Expense amount normalized to current period | `toPeriod(amount, frequency, period)` | `computations.ts` |
| All currency display | `fmtUSD(n)` | `computations.ts` |
| Variance color / gain-loss color | `GAIN_COLOR`, `LOSS_COLOR` constants | `computations.ts` |
| Income total (summary card) | Computed inline in component: monthly = `budgetIncomeMonthly + budgetIncomeYearly/12`; yearly = `budgetIncomeMonthly*12 + budgetIncomeYearly` | `BudgetPage.tsx` |
| `totalExpense` (Budgeted card) | Computed inline: `sum(toPeriod(e.amount, e.frequency, period))` over `state.budgetExpenses` | `BudgetPage.tsx` |
| `totalActual` (Actual spend card) | Computed inline: `sum(t.amount)` over `periodFilteredTransactions` | `BudgetPage.tsx` |
| `variance` (Variance card) | Computed inline: `totalExpense - totalActual` | `BudgetPage.tsx` |
| `rangeLabel` (Actual spend / Records card titles) | Computed inline: selected month's `label` from `availableBudgetMonths`, or `selectedYear` | `BudgetPage.tsx` |

## Design patterns

- Category `<select>` behavior is shared via one helper, `handleCategorySelectChange(value, apply)` (top of file): selecting the `__add_new` sentinel triggers `window.prompt`, any other value passes straight to `apply`. Used identically by the Add-Expense dialog, inline expense-row edit, Records "Add Record" form, and Records inline row edit — this is the single pattern for category selection anywhere in this component.
- Inline table-row editing (both Expenses and Records tables) follows the same shape: a component-local id (`editingId` / `recordDraft.id`) marks which row renders inputs instead of text; non-category fields dispatch `UPDATE_*` immediately on change, while the category field is staged locally (`editCategoryDraft` / part of `recordDraft`) and only dispatched on "Done".
- Both dialogs (Add Expense, Import transactions) use the shared `.dialog-backdrop`/`.dialog.blueprint` pattern with `onClick={stopPropagation}` on the inner dialog so backdrop click closes, dialog click doesn't.
- `textBtnAccent`/`textBtnDanger` are local `CSSProperties` constants for borderless text-style action buttons (Edit/Done in accent color, Delete in `LOSS_COLOR`).
