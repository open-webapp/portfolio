# Budget Page

Sibling: `BudgetPage.product-behavior.md`.

- Tree: `BudgetPage` -> `BudgetExpensesTab` | Spend records | `BudgetAnalytics`.
- Inputs: `AppState`, global `Category[]`, expense definitions, amount snapshots, budget transactions.
- `budgetedIncomeForYear` and `actualIncomeForYear` provide card values.
- `isIncomeOrExcludedTransaction` controls default Spend visibility and total scope.
- `BudgetAnalytics` uses the same selector rules for spend/savings output.
