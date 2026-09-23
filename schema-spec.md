# Schema Spec — Ledger (Portfolio Dashboard)

See also: [design.md](design.md), [product-behavior.md](product-behavior.md)

All types defined in `src/lib/types.ts`. IDs are `string`, generated via `uid(prefix)` (`src/lib/seed.ts`): `prefix + '-' + <7 random base36 chars>`, e.g. `pos-a1b2c3d`. Prefixes used: `acc` (Account), `pos` (Position), `closed` (ClosedPosition), `tx` (Transaction), `snap` (PortfolioSnapshot), `mapping` (SavedCsvMapping), `bal` (BalanceEntry), `expense` (Expense), `budgettx` (BudgetTransaction), `category` (Category), `catmap` (CategoryMapping).

## Account

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uid('acc')` |
| `accountNumber` | `string` | User-typed in the import dialog's new-account form; not derived from CSV |
| `name` | `string` | User-assigned, editable |
| `institution` | `string` | User-selected via seeded list or free-typed; empty string means unfilled; required only for accounts created via the import dialog's new-account form |
| `taxCategory` | `TaxCategory` | `'taxable' \| 'nonTaxable' \| 'taxDeferred'` |
| `retirement` | `boolean` | |
| `createdAt` | `string` | ISO date, set once at creation |

## Position

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uid('pos')`. Regenerated fresh on every import — **not** stable across re-imports of the same `(accountId, symbol)` |
| `accountId` | `string` | FK → `Account.id` |
| `symbol` | `string` | |
| `name` | `string \| null` | `null` if the CSV has no `name` column mapped. Never required (`name` not in `POSITIONS_REQUIRED_FIELDS`). UI falls back to `symbol` when null. |
| `trackingSymbol?` | `string` | Optional override symbol used for grouping/display in place of `symbol` (e.g. mapping a share class to its common ticker); empty/unset falls back to `symbol` |
| `assetClass` | `string` | From CSV mapping; not a closed enum in storage |
| `assetClassManualOverride?` | `string` | If set, wins over `assetClass` everywhere (filtering, grouping, display) |
| `shares` | `number` | `parseCsvNumber` of mapped `shares` column |
| `avgCost` | `number` | Direct from mapped `avgCost` column, or `purchaseAmount / shares` if `avgCost` unmapped/invalid |
| `price` | `number` | Direct from mapped `price` column, or `marketValue / shares` if `price` unmapped/invalid. Frozen "as of last import" — never live |
| `lastImportedAt` | `string` | ISO date of the Positions import that set `shares`/`price` |

**Computed, never stored** (`src/lib/computations.ts` → `computePosition`): `marketValue = shares * price`, `costBasis = shares * avgCost`, `gl = marketValue - costBasis`, `glPct = costBasis === 0 ? 0 : (gl / costBasis) * 100`.

## ClosedPosition

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uid('closed')` |
| `accountId` | `string` | |
| `symbol` | `string` | |
| `name` | `string \| null` | Inherited verbatim from the `Position` that closed (preserves `null`) |
| `closedDate` | `string` | ISO date of the import (or `CLOSE_POSITION` dispatch) that closed this position |
| `assetClass` | `string` | Inherited from the closed `Position` (base class, not the override) |
| `assetClassManualOverride?` | `string` | Inherited from the closed `Position`'s override, if any |
| `shares` | `number` | Inherited from the closed `Position` |
| `avgCost` | `number` | Inherited from the closed `Position` |
| `price` | `number` | Inherited from the closed `Position` |
| `lastImportedAt` | `string` | Inherited from the closed `Position` |
| `realizedGL` | `number \| null` | Computed from matching `Sell` transactions if any exist for `(accountId, symbol)`; `null` if none exist. **Never approximated/fabricated.** |
| `realizedGLBasis` | `'transactions' \| 'unknown'` | `'transactions'` iff `realizedGL` was computed; `'unknown'` otherwise |

Realized G/L formula when basis is `'transactions'`: `sum(sellTx.amount for matching sells) - (oldPosition.shares * oldPosition.avgCost)` — total sale proceeds minus the closed position's cost basis at time of closure.

## Transaction

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uid('tx')` |
| `accountId` | `string` | |
| `date` | `string` | ISO date, from CSV mapping |
| `symbol` | `string` | |
| `type` | `string` | Free string (Buy/Sell/Dividend/etc.) — not a closed enum. UI defaults type-filter tags to whatever distinct values are present in state |
| `shares` | `number` | `parseCsvNumber` |
| `price` | `number` | `parseCsvNumber` |
| `amount` | `number` | `parseCsvNumber` of mapped `amount` column (required, not derived at import time — display code falls back to `shares * price` only if `amount` is nullish) |
| `importedAt` | `string` | ISO timestamp this row was inserted (audit only, not part of the dedup key) |

**Natural key** (dedup, per-account): `` `${date}|${symbol}|${type}|${shares}|${price}` `` — computed with `shares`/`price` re-parsed via `parseCsvNumber` so `"150.0"` and `"150"` collide. `amount` is **not** part of the key — two rows differing only in `amount` are treated as duplicates and the second is dropped.

**Numeric parsing** (`parseCsvNumber` in `src/lib/csv.ts`): strips `$`, `,`, and whitespace before `parseFloat`, so brokerage-formatted cells like `"$3.79 "` or `"45,000"` parse correctly instead of yielding `NaN` or silently truncating at the comma. Used everywhere a raw CSV cell is converted to a number during import (positions and transactions).

## PortfolioSnapshot

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uid('snap')` |
| `accountId` | `string` | One snapshot per account per import |
| `date` | `string` | ISO calendar date of the Positions import (not a timestamp) |
| `value` | `number` | Sum of `shares * price` across that account's positions at import time |

**Natural key**: `(accountId, date)`. Re-importing the same account on the same calendar date **replaces** the prior snapshot for that key (upsert, not append). A CSV spanning multiple accounts produces one snapshot per resolved account, not one combined snapshot. Whole-portfolio series are derived, never stored — see `selectors.totalValueSeries`.

## BalanceEntry

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uid('bal')` |
| `accountId` | `string` | FK → `Account.id` |
| `date` | `string` | `YYYY-MM-DD` |
| `balance` | `number` | Account balance as of `date` |
| `activities` | `{ type: ActivityType; amount: number; note: string }[]` | 0..N per entry; no persisted id per item; array order = insertion order; `amount` always `>= 0` (stored via `Math.abs`), sign applied at read time via `ACTIVITY_SIGN[type]` |

`ActivityType` = `'None' \| 'Contribution' \| 'Withdrawal' \| 'Transfer In' \| 'Transfer Out' \| 'Dividend' \| 'Fee'`. `ACTIVITY_SIGN`: `+1` (Contribution/Transfer In/Dividend), `-1` (Withdrawal/Transfer Out/Fee), unsigned/0 for `'None'`.

**Legacy shape**: entries stored on disk from before multi-activity support have `activityType`/`activityAmount`/`note` instead of `activities`; `coalesceWithDefaults` (`src/lib/persist.ts`) converts these to the `activities` array shape on load (idempotent), so in-memory `AppState` always sees the current shape.

**Natural key**: `(accountId, date)`. `addBalanceEntries(state, entries)` (`src/lib/state.ts`) drops any pre-existing entry sharing an incoming `(accountId, date)` key, then appends the incoming entries — **replace, not append**, for entries recorded across separate calls. Not deduped *within* a single incoming batch: two entries in the same call sharing a key are both appended.

**Derived, never stored** (`src/lib/register.ts` → `accountLedger`): for a `BalanceEntry` sorted into its account's chronological ledger, `change = balance - previousEntry.balance` (`null` for the first/opening entry), `attributed = sum over entry.activities of (ACTIVITY_SIGN[type] ?? 0) * amount`, `unexplained = change - attributed` (`null` when `change` is `null`).

## ExpenseDefinition

Year-independent — no `amount` field. One row per expense, shared globally across every year.

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uid('expense')` |
| `name` | `string` | User-entered, trimmed at creation via `ADD_EXPENSE_DEFINITION`; edits via `UPDATE_EXPENSE_DEFINITION` are not trimmed |
| `categoryId` | `string` | FK → `Category.id` |
| `frequency` | `'monthly' \| 'yearly'` | Descriptive metadata only — no year-scoped `amount` hangs off a definition; see `budgetExpenseAmountsByYear` below for the actual per-year dollar figures |

**Derived, never stored** (`src/lib/computations.ts`): `toMonthly(amount, freq)` (`freq === 'yearly' ? amount / 12 : amount`), `toYearly(amount, freq)` (`freq === 'yearly' ? amount : amount * 12`), `toPeriod(amount, freq, period)` — all three take a raw `amount` (looked up separately from `budgetExpenseAmountsByYear`), independent of the definition record itself.

## Budget storage: `budgetExpenseDefinitions` / `budgetExpenseAmountsByYear`

`AppState` fields (`src/lib/state.ts`), superseding the old year-scoped `budgetExpensesByYear: Record<string, Expense[]>` which duplicated name/categoryId/frequency into every year an expense appeared in:

| Field | Type | Notes |
|---|---|---|
| `budgetExpenseDefinitions` | `ExpenseDefinition[]` | Global, year-independent list — not keyed by year |
| `categoryMappings` | `CategoryMapping[]` | Portfolio-scoped description-to-expense mappings; encrypted with the containing `AppState` |
| `budgetExpenseAmountsByYear` | `Record<string, Record<string, number>>` | Key = calendar year as string (e.g. `"2026"`) → `{ [expenseId]: amount }`. Amounts-only; no name/categoryId/frequency here |

**Migration** (`src/lib/persist.ts`, run on every load before `coalesceWithDefaults`):
- `migrateBudgetExpensesByYearIfNeeded`: folds a legacy flat `budgetExpenses: Expense[]` into `budgetExpensesByYear[currentBudgetYear()]` first (no-op once `budgetExpensesByYear` exists, even `{}`).
- `dropLegacyBudgetIncome`: drops all retired manual-income fields without converting them to definitions or transactions.
- `migrateBudgetExpenseDefinitionsIfNeeded`: splits the (now-migrated) year-scoped `budgetExpensesByYear: Record<year, Expense[]>` into `budgetExpenseDefinitions` + `budgetExpenseAmountsByYear`. Scans years **descending** so each expense id's **most-recent year** wins for `name`/`categoryId`/`frequency`; every `(year, id)` pair that existed keeps its `amount` under `budgetExpenseAmountsByYear[year][id]`. The superseded `budgetExpensesByYear` key is dropped. No-op if `budgetExpenseDefinitions` is already present (even `[]`).

**Amounts-only per-year semantics** (`src/lib/state.ts`):
- `currentBudgetYear(now)`: current calendar year as a string key.
- The Expenses tab's Category Breakdown panel and multi-year Expense table read/write across an arbitrary set of years at once (own local `breakdownYear`, plus a union-of-years column set). Spend owns local `selectedScope`: `All` plus transaction-backed concrete years only, initially newest transaction year or `All` when empty. `All` is not a snapshot year/key.
- **Seed-from-nearest** (`nearestExpenseAmountsYear`): a missing year resolves for display via `resolveExpenseAmountsForYear` to the nearest non-empty snapshot; ties favor the earlier year.
- **Eager snapshot** (`ensureExpenseAmountsSnapshotForYear`, via `ENSURE_BUDGET_YEAR_SNAPSHOT { year }`): selecting a concrete Spend year without a snapshot clones the nearest non-empty expense snapshot. All never creates a snapshot; no source is a no-op.
- **Never empty**: `stripEmptyBudgetSnapshots` removes empty maps; `clearExpenseAmount` removes a year's key when its last amount is cleared.
- **Rollover on load** (`rolloverBudgetExpenseAmountsIfNeeded`, via `ROLLOVER_BUDGET_EXPENSE_AMOUNTS_IF_NEEDED`): a missing current-year snapshot copies the nearest prior non-empty snapshot.
- Income is derived from active categories named `Income`, their `ExpenseDefinition`s, and transactions. It has no dedicated `AppState` field.
- `budgetExpenseDefinitions` itself is never year-scoped and has no seed/rollover/skip-empty concept — a definition simply exists or doesn't; only its per-year `amount` entries go through the above machinery.

## BudgetTransaction

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uid('budgettx')` |
| `date` | `string` | `YYYY-MM-DD` |
| `description` | `string` | Falls back to the transaction's category name if left blank on manual entry |
| `categoryId` | `string` | FK → `Category.id`. Resolved internally by `importBudgetTransactions` (see below) — CSV/OFX import rows never carry a category column. Legacy fallback category source — see `spendExpenseId` |
| `amount` | `number` | |
| `spendExpenseId?` | `string` | Optional FK → `ExpenseDefinition.id`, driving `effectiveCategoryId`. Definitions are global/year-independent, so resolution is a flat lookup by id — no `tx.date`-scoped year matching. When set AND resolvable against `budgetExpenseDefinitions`, the linked definition's `categoryId` is the EFFECTIVE category for every actual-spend surface (via `effectiveCategoryId(tx, budgetExpenseDefinitions)` in `src/lib/selectors.ts`) — `categoryId` above is only a fallback, used when `spendExpenseId` is unset or unresolvable (e.g. the definition was deleted). Set via the `SpendCategoryPicker` component (Spend records per-cell edit, bulk-edit action bar, Add Record form) — the picker now lists ALL `budgetExpenseDefinitions` regardless of the transaction's or page's year (see `product-behavior.md`'s Budget section for the UX implications of this global-visibility change) — or auto-linked on import (via `resolveSpendExpenseIdForDescription(categoryMappings, description)`, verified against `budgetExpenseDefinitions`; `categoryId` derived from the linked definition, "Other" fallback when unmatched). **"Clearing" the link always sets this field to the literal value `undefined`** (an explicit key with value `undefined`, which `JSON.stringify`/the IndexedDB structured-clone path both drop — so a cleared record is stored indistinguishably from one that never had `spendExpenseId` set; there is no separate "deleted" marker) — done via the `SpendCategoryPicker`'s leading `— Uncategorized —` option (per-cell edit, Add Record form). It is **not** cleared unconditionally by `reapplyMappingsToTransactions` — see that function's "Auto re-apply" note below for its set-on-hit/never-clear behavior, including the accepted tradeoff that a manual "Uncategorized" choice can be silently overwritten |
| `tags?` | `string[]` | User-only free-form per-record tags (system auto-tags live in `autoTags`, never here). Validated `[a-zA-Z0-9]` only, max 10 chars/tag. Never stored as `[]` — key omitted when empty; clearing sets `tags: undefined` |
| `autoTags?` | `string[]` | System-only auto-tags from LCP-cluster detection (`applyAutoTags`), parallel to `tags`. Same omit-when-empty invariant (key deleted, never `[]`); missing key (e.g. pre-provenance blobs) means none — old records backfill all-existing-as-user with no migration writes |

Combined 5-tag cap: the merged unique count across `tags` + `autoTags` (case-insensitive) caps at 5 per record — a candidate duplicating the other array (either direction, existing casing wins) or exceeding the combined cap is skipped, never evicting. Bulk `tagsToAdd`, the tags-cell `TagInput` (`blockedTags`), import batch auto-tagging, and `unionTags` all enforce this merged rule

**`effectiveCategoryId(tx, budgetExpenseDefinitions)`** (`src/lib/selectors.ts`): resolution rule — prefer the `ExpenseDefinition` in `budgetExpenseDefinitions` whose `id === tx.spendExpenseId` when `spendExpenseId` is set and that lookup resolves; otherwise fall back to `tx.categoryId`. No year-based lookup — definitions are global. Used everywhere a transaction's "real" category is needed for actual-spend figures, instead of reading `categoryId` directly.

CSV/paste import normalizes `date` to `YYYY-MM-DD` before the dedup key below is built — accepted input formats: ISO `YYYY-MM-DD`, `MM/DD/YYYY`/`M/D/YYYY`/`MM-DD-YYYY`/`M-D-YYYY` (slash/dash always read as MM/DD/YYYY, no ambiguity heuristics), and month-name formats (e.g. "Sep 17 2026"; a comma before the year, e.g. "Sep 17, 2026", breaks the row parser's comma-splitting when the row is comma-delimited and is not supported there). The row parser auto-detects tab vs. comma delimiting per line. Unparseable/unrecognized dates silently drop the row. See `product-behavior.md` for full parsing details.

**Dedup on import** (`IMPORT_BUDGET_TRANSACTIONS` / `importBudgetTransactions` in `state.ts`): natural key `date|description|amount|accountName` (normalized `date`, raw values otherwise, no further normalization; neither resolved field is part of the key — two rows differing only by expense link now dedup as duplicates, a breaking change from the prior key), checked against existing `budgetTransactions` and against earlier rows already accepted in the same import batch — duplicates are silently dropped. `spendExpenseId` resolution (via `CategoryMapping` substring match verified against `budgetExpenseDefinitions`, falling back to "Other" with `spendExpenseId` unset) happens **before** dedup but does not participate in the dedup key. `tags` (already-validated `string[]` user-tag passthrough from the CSV layer) are carried into `toAdd` unchanged and likewise never participate in the dedup key — two rows differing only by `tags` dedup as duplicates, first row's tags win. Before dedup, `importBudgetTransactions` runs `applyAutoTags(rows)` on the batch so cluster tags fill `autoTags` under the merged combined-5 + cross-dedup rules (user casing wins on clash); pre-existing records are never touched. The resolve+dedup logic is factored into the pure `resolveBudgetImportRows(existing, rows, categories, categoryMappings, budgetExpenseDefinitions): { toAdd, duplicateCount }`, which `importBudgetTransactions` calls internally and which `BudgetPage` also calls directly (pre-dispatch) to report imported/skipped counts in the import dialog.

## Category

**Not part of `AppState`'s persistence envelope.** Categories live in the standalone Global Category Store; `CategoryMapping` records are instead portfolio-scoped `AppState` data.

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uid('category')` |
| `name` | `string` | User-editable, e.g. "Groceries", "Other" |
| `updatedAt` | `string` | ISO timestamp; stamped on every create/rename/delete/exclude-toggle |
| `deletedAt?` | `string` | ISO timestamp tombstone. `DELETE_CATEGORY` sets `deletedAt` (+ refreshes `updatedAt`); record is retained, never physically removed. Budget > Category Mapping is the only delete UI. |
| `excludeFromSpend?` | `boolean` | Default absent (`undefined`/falsy) = included/not excluded. When `true`, Budget page treats every transaction in this category as excluded from all actual-spend-derived figures app-wide (Actual-spend/Variance summary cards, Expenses table per-row Actual/Variance, Category Breakdown panel — which drops the category's row entirely) and Spend records hides its rows by default. Budgeted/planned figures are never affected. Category `<select>` controls elsewhere in the app are unaffected — excluded categories stay selectable. Set from Budget > Category Mapping, dispatching `SET_CATEGORY_EXCLUDE_FROM_SPEND` on the Global Category Store |

An "Other" category is used as the fallback whenever no `CategoryMapping` matches. `visibleCategories()` (`src/lib/categoryStore.ts`) filters out tombstoned (`deletedAt`-set) records for every UI list.

## CategoryMapping

**Part of each portfolio's `AppState` persistence envelope.** Mappings are encrypted in that portfolio's IndexedDB and Drive state; they are not global or cross-portfolio.

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uid('catmap')` |
| `substring` | `string` | Full trimmed transaction `description` this mapping was keyed from (despite the field name, matching against it elsewhere is substring-based, not exact) |
| `spendExpenseId` | `string` | FK → `ExpenseDefinition.id` |
| `updatedAt` | `string` | ISO timestamp; latest-`updatedAt` wins when multiple mappings match a description |

**Upsert**: every time a `BudgetTransaction.spendExpenseId` is set via the Spend-records per-cell edit or manual Add Record submit, `UPSERT_CATEGORY_MAPPING` upserts a mapping keyed by exact full trimmed `description` (case-insensitive, latest-wins). `ExpenseDefinition` category changes never create or update mappings.

**Match** (import + Add Record live-prefill): `resolveSpendExpenseIdForDescription(mappings, description)` (`src/lib/categoryStore.ts`) does a case-insensitive substring match against the row's `description`; on multiple matches, latest `updatedAt` wins. No match (or a hit whose expense no longer exists) → caller falls back to the "Other" category's id with `spendExpenseId` unset.

**Auto re-apply**: `UPSERT_CATEGORY_MAPPING`, `UPDATE_CATEGORY_MAPPING`, `ADD_CATEGORY_MAPPING`, and `DELETE_CATEGORY_MAPPING` each update portfolio `categoryMappings` and reapply that portfolio's `budgetTransactions` in one main-reducer dispatch. `reapplyMappingsToTransactions(transactions, mappings, budgetExpenseDefinitions)` (`src/lib/categoryStore.ts`) sets `spendExpenseId` and `categoryId` only when a matching mapping resolves to a live definition; misses and dangling hits leave rows untouched. The explicit `REAPPLY_CATEGORY_MAPPINGS { categoryMappings }` action remains available for callers that supply a mapping set. Reapply is idempotent and can relink a manually uncategorized transaction when its description matches a mapping.

### CategoryMapping migration

On raw portfolio hydration, after expense-definition migration, `seedCategoryMappingsIfNeeded` copies retained legacy global mappings whose `spendExpenseId` is in that portfolio's definition-id set. The portfolio's own `categoryMappings` key is the idempotency marker: once present, including `[]`, seeding never runs again. Legacy raw entries stay outside current global state and are not mutated by seeding. After the portfolio opens, `App.tsx` checks its definition-id set once per open; if claimable legacy mappings remain, `CategoryMappingMigrationDialog` offers removal. Confirming hard-deletes entries for the dialog's captured `spendExpenseId` set; dismissing retains them and the check re-fires on the next portfolio open.

## Global Category Store

Standalone, cross-portfolio store for `Category` and `BudgetAccountRule` — independent of per-portfolio `AppState`, its debounce-save, and its encryption. Wired into `App.tsx` via `src/hooks/useGlobalCategories.ts`; pure helpers/types in `src/lib/categoryStore.ts`, merge algorithm in `src/lib/categoryMerge.ts`, local persistence in `src/lib/categoryPersist.ts`, and Drive I/O in `src/lib/categoryDrive.ts`.

`DELETE_CATEGORY` remains an unconditional tombstone action: it stamps a matching category's `deletedAt`/`updatedAt` and does not inspect definitions or transactions. Budget > Category Mapping supplies the UI guard: `Other` is protected; a category with any `ExpenseDefinition` is blocked; and a category with any effective Spend record in the currently open portfolio, counted across all years with `effectiveCategoryId(tx, budgetExpenseDefinitions)`, is blocked. The action contract intentionally remains unchanged so non-UI callers can still issue the tombstone action.

**Local IndexedDB**: `ledger_global_categories_v1`, two object stores, both explicit-key `put(value, key)` (no `keyPath`):

| Store | Key | Value |
|---|---|---|
| `state` | `'current'` | `GlobalCategoryState = { categories: Category[]; budgetAccountRules: BudgetAccountRule[] }` — single document, whole-state overwrite on every save; may retain a legacy raw `categoryMappings` key solely for migration cleanup |
| `meta` | `'migration'` | `{ seeded: boolean }` |
| `meta` | `'driveSync'` | `{ lastKnownRemoteModifiedTime?: string }` — bookmark for the 60s poll's metadata-only newer-check |

Unencrypted — plaintext throughout, unlike every per-portfolio store.

**Google Drive file**: `OpenWebApp/Portfolio/category-mappings.json` (Drive-root level, sibling to per-portfolio subfolders), via `legacyDriveSync.project('category-mappings')`. Content is `JSON.stringify({ categories: Category[], budgetAccountRules: BudgetAccountRule[] })`, unencrypted; old files' `categoryMappings` entries are ignored.

**Sync model**: auto-push (no debounce) on every local edit when a Drive connection is currently active (the same single `connected` flag from `useDriveConnection(getDriveAuthFor(activePortfolio))` already live in `App.tsx`); one auto-pull the first time a connection resolves post-hydrate (ref-guarded, once per session); a 60s poll that checks `files.get`/`files.status` `modifiedTime` only and does a full pull+merge only when it's newer than the local `lastKnownRemoteModifiedTime` bookmark; fully local/offline-capable when never connected. Local save to `ledger_global_categories_v1` is debounced 500ms, same constant as the per-portfolio save debounce.

**Merge algorithm** (`mergeCategoryState(a, b)`, `src/lib/categoryMerge.ts`, pure/no IO): unions `categories` and `budgetAccountRules` by id/normalized name respectively; conflicts keep the later effective timestamp, with local ties winning. Used for initial post-connect pull, poll pull, and global-category imports.

## SavedCsvMapping

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uid('mapping')` |
| `accountId` | `string` | FK → `Account.id` |
| `kind` | `'positions' \| 'transactions'` | Type of data this mapping applies to |
| `fieldMap` | `Record<string, string>` | Mapping of CSV column names to target field names (`{ csvColumn: targetField }`) |
| `updatedAt` | `string` | ISO timestamp of the last successful import that used/updated this mapping |

**Natural key**: `(accountId, kind)` — upserted on successful CSV import. Stores the effective `fieldMap` from the most recent successful import for each (account, data type) pair.

### Required field sets

Defined in `src/lib/types.ts`:

```ts
POSITIONS_REQUIRED_FIELDS = [
  'symbol', 'assetClass', 'shares',
  'avgCost', 'purchaseAmount',   // alternative pair — need at least one
  'price', 'marketValue',         // alternative pair — need at least one
]
AVGCOST_FIELDS = ['avgCost', 'purchaseAmount']
PRICE_FIELDS = ['price', 'marketValue']
POSITIONS_OPTIONAL_FIELDS = ['name', 'trackingSymbol']
TRANSACTIONS_REQUIRED_FIELDS = ['date', 'symbol', 'type', 'shares', 'price', 'amount']
TRANSACTIONS_OPTIONAL_FIELDS = []
```

Optional fields (`name`/`trackingSymbol` for positions; none for transactions) are never required — unmapped `name`/`trackingSymbol` → `null`/`undefined`. The import Review step renders the mapping table in required-then-optional order: required fields carry a `*` next to their label, optional fields don't. `avgCost`/`purchaseAmount` and `price`/`marketValue` are validated as alternative pairs (at least one of each pair suffices) and the mapping `<select>` headers show cross-hints for them.

### Import validation (`src/lib/importPreview.ts`)

- `applyFieldMap(row, fieldMap)` — renames each row's keys per `{ csvColumn: targetField }`.
- `isBlankRow(values)` — true when every value is empty after trim (trailing blank CSV rows).
- `validatePreviewRow(dataType, values) → { valid, errors }` — per-row required-missing checks. Positions: `symbol`/`assetClass`/`shares` + ≥1 of `{avgCost, purchaseAmount}` + ≥1 of `{price, marketValue}`. Transactions: all of `TRANSACTIONS_REQUIRED_FIELDS`, no alternative pairs. Blank rows (`isBlankRow`) always return `valid: true` — they never block import and are skipped at commit.
- `isReviewValid(dataType, fieldMap) → boolean` — all required fields present among `Object.values(fieldMap)`; positions honor the alternative pairs.

## TableToCsvResult (`src/lib/pastedTable.ts`)

Return shape of `tableToCsv(headersClipboard, valuesClipboard)` — a standalone clipboard-paste → CSV utility, not wired into the app. `PastedClipboard = { html?: string, text?: string }` (one clipboard paste); headers paste determines column count `N`.

| Field | Type | Notes |
|---|---|---|
| `headers` | `string[]` | Flattened, blank-dropped, uniquified (`_2`, `_3`, ... suffix on collision) header cells from the headers paste. Length is `N`. |
| `rows` | `Record<string, string>[]` | One object per fitted values row, keyed by `headers`. |
| `csv` | `string` | RFC 4180 text: `\r\n` row terminators, minimal quoting (only when a field contains `,`/`"`/CR/LF, with `"` doubled), no BOM, no trailing newline. |
| `issues` | `CsvIssue[]` | **Required, always present** (`[]` when every row's width matched `N` — never omitted). One entry per row whose raw cell count didn't match `N`, describing the pad/truncate that was applied. |

`CsvIssue`:

| Field | Type | Notes |
|---|---|---|
| `rowIndex` | `number` | Index into the fitted/original row list (0-based) |
| `got` | `number` | Raw cell count parsed for that row before fitting |
| `expected` | `number` | `N`, i.e. `headers.length` |

**Structural superset of `ParsedCsv`**: `TableToCsvResult` is pinned via an exported conditional-type assertion, `PastedTableIsParsedCsv = TableToCsvResult extends ParsedCsv ? true : never`, so `tsc -b` fails the build if `TableToCsvResult` ever stops being assignable to `ParsedCsv` (`{ headers: string[], rows: Record<string,string>[] }`, `src/lib/csv.ts`) — i.e. `headers`/`rows` must keep matching shapes; `csv`/`issues` are pure additions.

**Flat-text (no-tab) values row width detection**: when the values paste's non-tab lines are buffered and chunked into rows:
1. Lines matching `/^(view (details|more) (for|about)\b)/i` (screen-reader-only link text some sites emit per table row) are dropped outright before buffering/chunking — this doesn't rely on the line appearing on every row.
2. After that, chunking by `N` (header count) is used if the remaining buffered line count divides evenly by `N`. Otherwise the parser searches widths `N+1..N+8` for one that divides the buffer evenly (some other consistent extra column) and chunks at that width, dropping each row's trailing cell(s) beyond `N`. Falls back to chunking by `N` (with padding/truncation `issues`) if no such width exists.

## Action Types

Core state mutations dispatched via `appReducer` in `reducer.ts`:

**State**
- `__SET_STATE`: Direct replacement of entire `AppState` (hydration from IndexedDB)

**Accounts**
- `ADD_ACCOUNT`: Add new `Account` to state
- `UPDATE_ACCOUNT`: Patch fields on an `Account`
- `DELETE_ACCOUNT`: Remove `Account` and cascade-delete its positions/closedPositions/transactions/snapshots/csvMappings/balanceEntries
- `ADD_CUSTOM_INSTITUTION`: Add a free-typed institution name to `customInstitutions` (no-op if blank or already present)

**Positions**
- `UPDATE_POSITION`: Patch fields on a `Position`
- `SET_ASSET_CLASS_OVERRIDE`: Set/clear `assetClassManualOverride` on a `Position`
- `CLOSE_POSITION`: Move a `Position` to `closedPositions` (`realizedGL: null`, `realizedGLBasis: 'unknown'`)
- `DELETE_CLOSED_POSITION`: Remove a `ClosedPosition` from state
- `RESTORE_CLOSED_POSITION`: Move a `ClosedPosition` back to `positions` (fresh id), optionally replacing an existing open position

**Filters & UI**
- `SET_SORT`, `TOGGLE_SORT`
- `SET_TRANSACTIONS_SEARCH`, `SET_TRANSACTION_TYPE_FILTER`
- `SET_VIEW`: Switch between the `'budget'`, `'accounts'`, `'register'`, `'quotes'`, and `'settings'` views
- `SELECT_ACCOUNT`, `TOGGLE_CATEGORY_EXPANDED`, `SET_ACCT_ASSET_CLASS_FILTER`, `SET_ACCT_POS_SEARCH`

**Register**
- `ADD_BALANCE_ENTRIES { entries: BalanceEntry[] }`: Upsert `BalanceEntry` rows into `balanceEntries` by `(accountId, date)` key (replaces any pre-existing entry sharing that key)
- `UPDATE_BALANCE_ENTRY { entry: BalanceEntry }`: Full replacement of one existing `BalanceEntry`, matched by `id`; also replaces any other entry sharing the incoming `(accountId, date)` key (same collision rule as `ADD_BALANCE_ENTRIES`)
- `DELETE_BALANCE_ENTRY { id: string }`: Remove one `BalanceEntry` by id
- `SET_REG_ACCOUNT { accountId: string | null }`: Set `regAccountId` (RegisterPage scope selection)
- `TOGGLE_REG_CATEGORY_EXPANDED { categoryKey: string }`: Toggle one key in `regExpanded`
- `SET_REG_ACTIVITY_FILTER { filter: string }`: Set `regActivityFilter` (`'All'` or `'With Activity'`)

**Imports**
- `IMPORT_POSITIONS`: Merge/replace positions for an account (calls `importPositions` helper)
- `IMPORT_TRANSACTIONS`: Merge transactions for an account (calls `importTransactions` helper)
- `UPSERT_CSV_MAPPING`: Upsert a `SavedCsvMapping` for (accountId, kind)

**Price sync**
- `SET_PRICE_SYNC_API_KEY`, `RECORD_PRICE_SYNC_RUN`: Polygon.io Equity/ETF price-sync API key + run result
- `SET_MUTUAL_FUND_SYNC_API_KEY`, `RECORD_MUTUAL_FUND_SYNC_RUN`: Alphavantage mutual-fund NAV-sync API key + run result

**Budget**
- `ADD_EXPENSE_DEFINITION { definition: Omit<ExpenseDefinition, 'id'>; amount: number }`: Append a new global `ExpenseDefinition` to `budgetExpenseDefinitions`, id generated (`uid('expense')`), and seed its `amount` for the CURRENT calendar year only in `budgetExpenseAmountsByYear`
- `UPDATE_EXPENSE_DEFINITION { id: string; patch: Partial<Omit<ExpenseDefinition, 'id'>> }`: Patch fields (name/categoryId/frequency) on an `ExpenseDefinition` by id — affects all years at once, since the definition itself is year-independent; no-op if not found
- `DELETE_EXPENSE_DEFINITION { id: string }`: Remove an `ExpenseDefinition`, its amount entries from every year, and every portfolio `CategoryMapping` whose `spendExpenseId` matches; no-op if not found. Callers must check `expenseDefinitionInUse(state, id)` first and block/alert if any `BudgetTransaction` (in any year) still references it via `spendExpenseId`.
- `UPSERT_CATEGORY_MAPPING { description: string; spendExpenseId: string }`: Upsert by trimmed case-insensitive description and reapply mappings to this portfolio's transactions.
- `UPDATE_CATEGORY_MAPPING { id: string; patch }`, `ADD_CATEGORY_MAPPING { spendExpenseId: string; substring: string }`, `DELETE_CATEGORY_MAPPING { id: string }`: Update, add, or hard-delete one portfolio mapping, then reapply mappings to this portfolio's transactions.
- `SET_EXPENSE_AMOUNT { year: string; expenseId: string; amount: number }`: Set `budgetExpenseAmountsByYear[year][expenseId]`, scoped to that one `(year, expenseId)` pair only
- `CLEAR_EXPENSE_AMOUNT { year: string; expenseId: string }`: Remove `budgetExpenseAmountsByYear[year][expenseId]`; removes the year's key entirely if that was its last remaining amount (never-empty-on-delete — see Budget storage note above)
- `ROLLOVER_BUDGET_EXPENSE_AMOUNTS_IF_NEEDED`: dispatched once at app load — runs `rolloverBudgetExpenseAmountsIfNeeded` (see Budget storage note above)
- `ENSURE_BUDGET_YEAR_SNAPSHOT { year: string }`: dispatched from `BudgetPage` only for a concrete Spend scope lacking an expense snapshot, from the Spend Year dropdown or Add Record; never dispatched for All. Runs `ensureExpenseAmountsSnapshotForYear`.
- `ADD_BUDGET_TRANSACTION { tx: Omit<BudgetTransaction, 'id'> }`: Append a new `BudgetTransaction` to `budgetTransactions`, id generated (`uid('budgettx')`)
- `UPDATE_BUDGET_TRANSACTION { id: string; patch: Partial<Omit<BudgetTransaction, 'id'>> }`: Patch fields on a `BudgetTransaction` by id; no-op if not found
- `UPDATE_BUDGET_TRANSACTIONS_BULK { ids: string[]; categoryId: string; spendExpenseId?: string; tagsToAdd?: string[] }`: Patches `categoryId` (and `spendExpenseId`) on every `BudgetTransaction` whose id is in `ids`; ids not found are ignored. `tagsToAdd` (if non-empty) unions case-insensitively into each row's user `tags` (existing casing wins on collision), new tags appended in the order given, checked against the merged (`tags` + `autoTags`) set for case-insensitive dup + combined cap of 5 total — candidates duplicating an auto tag or exceeding the combined cap are refused (dropped, not added). Never produces `tags: []`: rows with no tags and empty/omitted `tagsToAdd` keep `tags` untouched. Dispatched by the Spend records bulk-select action bar's "Apply" button
- `DELETE_BUDGET_TRANSACTION { id: string }`: Remove a `BudgetTransaction` by id; no-op if not found
- `IMPORT_BUDGET_TRANSACTIONS { rows: { date, description, amount, accountName?, tags? }[]; categories: Category[]; categoryMappings: CategoryMapping[] }`: Resolves each row's `spendExpenseId` via `resolveSpendExpenseIdForDescription(categoryMappings, description)` (verified against `state.budgetExpenseDefinitions`; miss or dangling hit → "Other" `categoryId`, `spendExpenseId` unset), derives `categoryId` from the linked definition, then appends rows deduped on `date|description|amount|accountName` against existing `budgetTransactions` and earlier rows in the same batch. `tags` pass through unchanged (never in the key). `categories` and the active portfolio's mappings are supplied by `BudgetPage`; definitions come from `AppState`.
- `REAPPLY_CATEGORY_MAPPINGS { categoryMappings: CategoryMapping[] }`: Explicitly reapply a supplied mapping set to this portfolio's transactions. Normal mapping mutations already fold this work into their own reducer transition.

Note: global `Category` CRUD (`ADD_CATEGORY`, `RENAME_CATEGORY`, `DELETE_CATEGORY`) dispatches through the Global Category Store's `CategoryAction`/`categoryStoreReducer` (`src/lib/categoryStore.ts`). Mapping CRUD is part of `AppAction`/`appReducer`. `DELETE_CATEGORY` remains a tombstone action.

## AppState UI/filter fields (not persisted domain data, but part of the same `AppState` blob — see `state.ts`)

`view: 'settings' | 'accounts' | 'quotes' | 'register' | 'budget'` (defaults to `'accounts'`), `sortKey: keyof Position`, `sortDir: 'asc' | 'desc'`, `txTypeFilter: string`, `txSearch: string`, `selectedAccountId: string | null`, `selectedCategoryKey: TaxCategory | 'closedPositions' | null`, `expandedCategories: Record<string, boolean>`, `acctAssetClassFilter: string`, `acctPosSearch: string`, `regAccountId: string | null` (selected account on RegisterPage), `regExpanded: Record<string, boolean>` (category expansion state on RegisterPage), `regActivityFilter: 'All' | 'With Activity'`.

On load, `coalesceWithDefaults` whitelists `view`: any value other than `'accounts'`/`'settings'`/`'quotes'`/`'register'`/`'budget'` — including the retired `'dashboard'` written by older builds — is coerced to `'accounts'`. All other missing fields fall back to `initialState()` defaults.

**Budget page fields are split across two layers**: `App.tsx` owns `period` (`'expenses' | 'spend' | 'analytics' | 'categoryMapping'`, initialized to `'spend'` per app session). `BudgetPage`'s Spend-records `selectedScope`/`recordSearch`/`recSortBy`/`recSortDir`/`recPage`/`editingCell`/`cellDraft`/dialog and form drafts, plus `BudgetExpensesTab`'s own `breakdownYear`/`filterCategoryId`/`sortBy`/`sortDir`/dialog and form drafts, are component-local and not persisted. `budgetExpenseDefinitions`/`categoryMappings`/`budgetExpenseAmountsByYear`/`budgetTransactions` are persisted `AppState` fields; `categories` are global-store props.

## Persistence envelope

The entire `AppState` (all data collections/fields + all UI fields) is wrapped in an `EncryptedEnvelope` shape (`src/lib/crypto.ts`) for every write — both local IndexedDB and Google Drive:

```ts
interface EncryptedEnvelope {
  version: 1
  salt: string        // base64, 16 raw bytes — PBKDF2 salt
  iv: string           // base64, 12 raw bytes — AES-GCM IV, fresh per encryption, never reused
  ciphertext: string    // base64 — AES-256-GCM ciphertext of JSON.stringify(AppState)
}
```

- **IndexedDB** (managed by `@open-webapp/project-sync`): one `EncryptedEnvelope` record per project in the per-project db.
- **Google Drive** (`drive.ts` implements sync): the backup file `portfolio-state.json` is `JSON.stringify(envelope)` — identical shape and encryption as the IndexedDB envelope.
- **Algorithm (fixed, not configurable)**: key derivation is PBKDF2-SHA256, 600,000 iterations (OWASP 2023 minimum), producing a non-extractable AES-256-GCM `CryptoKey`. Encryption is AES-256-GCM with a fresh random 12-byte IV per `encryptState` call. Salt is 16 random bytes, generated once per password and reused until rotated.
- **Legacy-plaintext detection** (`detectEnvelopeShape`, pure/no I/O): a stored value is `'absent'` if `undefined`/`null`, `'encrypted'` if it structurally has `version === 1` and string `salt`/`iv`/`ciphertext` fields, otherwise `'legacy-plaintext'`. Purely structural — no version-field-only check, no content inspection beyond those four keys.
- **Migration-tolerant field coalescing**: `loadPersistedApp` rebuilds `AppState` from a fixed whitelist against `initialState()` defaults; missing fields default and stale keys are dropped. `budgetExpenseDefinitions`/`categoryMappings`/`budgetTransactions` default to `[]`; `budgetExpenseAmountsByYear` defaults to `{}`. `dropLegacyBudgetIncome` removes retired manual-income fields before coalescing; raw hydration runs the mapping seed before coalescing.
- `loadPersistedApp(key: CryptoKey)` — now `const raw = await loadRawPersistedBlob(key); return raw ? coalesceWithDefaults(raw) : null` — throws if the stored value is not `'encrypted'` or if decryption fails (wrong password → `OperationError` propagates).
- `loadLegacyPlaintextApp()` reads the pre-encryption blob for one-time migration; `clearPersistedApp()` deletes the IndexedDB record entirely.

`ExportableState` (`src/lib/importExport.ts`, the manual backup-download/restore-file format) excludes global `categories` and portfolio `categoryMappings`; `buildExportableState`/`decryptImportEnvelope`/`replaceImportedState` do not read or write them. The encrypted IndexedDB and Drive `AppState` envelope does include portfolio mappings.
