# BudgetAccountsTab Product Behavior

Sibling: `BudgetAccountsTab.design.md`.

- Rendered only through Budget's Accounts tab.
- Before global categories hydrate, displays `Loading budget accounts...`.
- Lists the canonical union of configured account rules and nonblank account names observed in the current portfolio's transactions, with local transaction counts.
- No accounts show `Import statement transactions to configure account sign rules.` and no add form.
- Every row defaults to `Statement negative = spend`; the segmented control can select either statement convention and shows the resulting canonical amount rule.
- A changed convention requires native confirmation mentioning the account, local count, immediate reconciliation, and deferred other-portfolio impact. Declining or choosing the active convention changes nothing.
- A confirmed convention change updates the global rule and immediately reconciles only supplied local transactions. Drive-origin rule changes are reconciled by the app without UI confirmation.
- Only configured rules with zero local transactions expose Remove rule. Removal requires native confirmation, deletes the rule, and immediately reconciles local transactions. Observed-only rows cannot be removed.
