# BudgetAccountsTab Design

Sibling: `BudgetAccountsTab.product-behavior.md`.

## API

```ts
BudgetAccountsTabProps = {
  transactions: BudgetTransaction[]
  budgetAccountRules: BudgetAccountRule[]
  hydrated: boolean
  dispatch: (action: CategoryAction) => void
  onReconcile: (rules: BudgetAccountRule[]) => void
}
```

## Data Flow

- `budgetAccountViewRows(rules, transactions)` supplies sorted canonical union rows, local counts, and effective default convention.
- Confirmed configure/remove operations calculate next rules with category-store helpers, dispatch the corresponding global category action, then call `onReconcile(nextRules)` for the current portfolio.
- `SettingsPage` maps `onReconcile` to `RECONCILE_BUDGET_ACCOUNT_CONVENTIONS`; App's global-rule effect handles later external/Drive changes.
- Controls use existing `.seg` and `.seg-opt` classes. No local rule state or add form exists.
