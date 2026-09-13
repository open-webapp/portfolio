# Schema Spec — Ledger (Portfolio Dashboard)

See also: [design.md](design.md), [product-behavior.md](product-behavior.md)

All types defined in `src/lib/types.ts`. IDs are `string`, generated via `uid(prefix)` (`src/lib/seed.ts`): `prefix + '-' + <7 random base36 chars>`, e.g. `pos-a1b2c3d`. Prefixes used: `acc` (Account), `pos` (Position), `closed` (ClosedPosition), `tx` (Transaction), `snap` (PortfolioSnapshot), `mapping` (SavedCsvMapping), `bal` (BalanceEntry), `expense` (Expense).

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

## Expense

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uid('expense')` |
| `name` | `string` | User-entered, trimmed at creation; edits via `UPDATE_BUDGET_EXPENSE` are not trimmed |
| `category` | `string` | Free string; not required to be a member of `state.budgetCategories` at read time (e.g. after that category is deleted while an expense elsewhere still references it, though `DELETE_BUDGET_CATEGORY` normally reassigns those to `'Other'` in the same update) |
| `amount` | `number` | In the unit implied by `frequency` — a monthly-frequency expense's `amount` is a monthly dollar figure, a yearly-frequency expense's is a yearly figure |
| `frequency` | `'monthly' \| 'yearly'` | |

**Derived, never stored** (`src/lib/computations.ts`): `toMonthly(amount, freq)` (`freq === 'yearly' ? amount / 12 : amount`), `toYearly(amount, freq)` (`freq === 'yearly' ? amount : amount * 12`), `toPeriod(amount, freq, period)` (dispatches to one of the above by the caller's selected display period, independent of the expense's own `frequency`).

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
- `SET_BUDGET_INCOME_MONTHLY { amount: number }`: Set `budgetIncomeMonthly`, clamped to `>= 0`
- `SET_BUDGET_INCOME_YEARLY { amount: number }`: Set `budgetIncomeYearly`, clamped to `>= 0`
- `ADD_BUDGET_EXPENSE { expense: Omit<Expense, 'id'> }`: Append a new `Expense` to `budgetExpenses`, id generated (`uid('expense')`)
- `UPDATE_BUDGET_EXPENSE { id: string; patch: Partial<Omit<Expense, 'id'>> }`: Patch fields on an `Expense` by id; no-op if not found
- `DELETE_BUDGET_EXPENSE { id: string }`: Remove an `Expense` by id; no-op if not found
- `ADD_BUDGET_CATEGORY { name: string }`: Append a trimmed category name to `budgetCategories`; no-op if empty or already present
- `DELETE_BUDGET_CATEGORY { name: string }`: Remove a category from `budgetCategories` and reassign every `Expense` referencing it to `'Other'`; no-op for `name === 'Other'`

## AppState UI/filter fields (not persisted domain data, but part of the same `AppState` blob — see `state.ts`)

`view: 'settings' | 'accounts' | 'quotes' | 'register' | 'budget'` (defaults to `'accounts'`), `sortKey: keyof Position`, `sortDir: 'asc' | 'desc'`, `txTypeFilter: string`, `txSearch: string`, `selectedAccountId: string | null`, `selectedCategoryKey: TaxCategory | 'closedPositions' | null`, `expandedCategories: Record<string, boolean>`, `acctAssetClassFilter: string`, `acctPosSearch: string`, `regAccountId: string | null` (selected account on RegisterPage), `regExpanded: Record<string, boolean>` (category expansion state on RegisterPage), `regActivityFilter: 'All' | 'With Activity'`.

On load, `coalesceWithDefaults` whitelists `view`: any value other than `'accounts'`/`'settings'`/`'quotes'`/`'register'`/`'budget'` — including the retired `'dashboard'` written by older builds — is coerced to `'accounts'`. All other missing fields fall back to `initialState()` defaults.

**Budget page fields are split across two layers**: `BudgetPage`'s `period`/`filterCategory`/`sortBy`/add-expense-form inputs/`editingId` are intentionally component-local `useState` — NOT part of `AppState`, never persisted, reset on remount. By contrast `budgetIncomeMonthly`/`budgetIncomeYearly`/`budgetExpenses`/`budgetCategories` (see next section) ARE persisted `AppState` fields, coalesced/defaulted like every other domain collection on load.

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
- **Migration-tolerant field coalescing**: `loadPersistedApp`/`loadLegacyPlaintextApp` both rebuild the `AppState` field-by-field from a fixed whitelist against `initialState()` defaults — a blob missing a newer collection/field loads with that field defaulted, and stale keys are silently dropped. `budgetCategories` is a notable special case: on both persist-load coalescing (`persist.ts`, backed by `initialState()`'s local category list) and import backfill (`importExport.ts`, via `computations.ts`'s exported `DEFAULT_CATEGORIES`), a missing/legacy value defaults to the same 11-entry list (Housing/Utilities/Groceries/Transportation/Insurance/Subscriptions/Health/Entertainment/Debt/Loans/Savings/Other), **not** `[]` — unlike `budgetExpenses`, which defaults to an empty array like every other collection. A legacy/missing blob therefore surfaces the full default category set with zero expenses in it.
- `loadPersistedApp(key: CryptoKey)` throws if the stored value is not `'encrypted'` or if decryption fails (wrong password → `OperationError` propagates).
- `loadLegacyPlaintextApp()` reads the pre-encryption blob for one-time migration; `clearPersistedApp()` deletes the IndexedDB record entirely.
