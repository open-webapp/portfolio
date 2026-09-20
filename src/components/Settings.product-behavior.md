# Settings Product Behavior

Sibling: `Settings.design.md`.

- Exactly four tabs: Backup, Encryption, Quotes API Key, Spend Accounts.
- No category or category-mapping controls appear in Settings; only spend-account rules via `budgetTransactions`, `budgetAccountRules`, `categoriesHydrated`, `categoryDispatch`.
- Backup remains Drive connection/sync access plus encrypted backup download.
- Encryption remains password change.
- Quotes API Key remains Polygon and Alphavantage key entry, manual fetches, and last-run/error status.

## Spend Accounts

- Hosts global account statement-convention rules. `negativeSpend` (negative amount = spend) is the permanent silent default; `positiveSpend` converts imported positive spend to canonical negative amounts.
- Shows `Loading budget accounts...` until global categories hydrate.
- A convention change or rule removal requires native confirmation. A confirmed action reconciles matching records in the open portfolio immediately; other portfolios reconcile when opened.
- **Known limitation:** manual records have no provenance. A later convention change flips their matching amount too; there is no exclusion.
- Rules are global: they share the category store, its IndexedDB state, `category-mappings.json` Drive file, merge, and `useGlobalCategories` hook.
