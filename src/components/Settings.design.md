# Settings Design

Sibling: `Settings.product-behavior.md`.

## API

- `SettingsPageProps.settingsSection`: `'backup' | 'encryption' | 'priceSync' | 'spendAccounts'`.
- Props cover app state/dispatch, portfolio Drive auth, session key/salt/password callbacks, price-sync triggers/errors, Drive connection state, plus spend-accounts props: `budgetTransactions`, `budgetAccountRules`, `categoriesHydrated`, `categoryDispatch`.
- No `categories` or `categoryMappings` props.

## Sections

- Backup: Drive widget/folder link and backup download.
- Encryption: password change.
- Quotes API Key: Polygon and Alphavantage controls.
- Spend Accounts -> `BudgetAccountsTab`, supplied current-portfolio `budgetTransactions` and visible global `budgetAccountRules`. `hydrated` gates on `categoriesHydrated`; `dispatch` is `categoryDispatch`. Confirmed configure/remove actions dispatch `CategoryAction` (`CONFIGURE_BUDGET_ACCOUNT_RULE`/`DELETE_BUDGET_ACCOUNT_RULE`) and `onReconcile` dispatches `RECONCILE_BUDGET_ACCOUNT_CONVENTIONS` for the active portfolio.
