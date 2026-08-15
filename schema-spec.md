# Schema Spec — Ledger (Portfolio Dashboard)

See also: [design.md](design.md), [product-behavior.md](product-behavior.md)

All types defined in `src/lib/types.ts`. IDs are `string`, generated via `uid(prefix)` (`src/lib/seed.ts`): `prefix + '-' + <7 random base36 chars>`, e.g. `pos-a1b2c3d`. Prefixes used: `acc` (Account), `pos` (Position), `closed` (ClosedPosition), `tx` (Transaction), `snap` (PortfolioSnapshot), `import` (ImportSession), `mapping` (SavedCsvMapping).

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
| `importSessionId` | `string` | FK → `ImportSession.id`. Tags which CSV import created this row. |
| `accountId` | `string` | FK → `Account.id` |
| `symbol` | `string` | |
| `name` | `string \| null` | `null` if the CSV has no `name` column mapped. Never required (`name` not in `POSITIONS_REQUIRED_FIELDS`). UI falls back to `symbol` when null. |
| `assetClass` | `string` | From CSV mapping; not a closed enum in storage |
| `assetClassManualOverride?` | `string` | If set, wins over `assetClass` everywhere (filtering, grouping, display) |
| `shares` | `number` | `parseCsvNumber` of mapped `shares` column |
| `avgCost` | `number` | Direct from mapped `avgCost` column, or `purchaseAmount / shares` if `avgCost` unmapped/invalid |
| `price` | `number` | Direct from mapped `price` column, or `marketValue / shares` if `price` unmapped/invalid. Frozen "as of last import" — never live |
| `taxes` | `number \| null` | `parseCsvNumber` of mapped `taxes` column if present and truthy, else `null`. Imported only, never computed; excluded from all cost-basis/G-L/allocation math |
| `lastImportedAt` | `string` | ISO date of the Positions import that set `shares`/`price` |

**Computed, never stored** (`src/lib/computations.ts` → `computePosition`): `marketValue = shares * price`, `costBasis = shares * avgCost`, `gl = marketValue - costBasis`, `glPct = costBasis === 0 ? 0 : (gl / costBasis) * 100`.

## ClosedPosition

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uid('closed')` |
| `importSessionId` | `string` | FK → `ImportSession.id`. Tags which import created this closed position. |
| `accountId` | `string` | |
| `symbol` | `string` | |
| `name` | `string \| null` | Inherited verbatim from the `Position` that closed (preserves `null`) |
| `closedDate` | `string` | ISO date of the import that first showed this symbol missing |
| `assetClass` | `string` | Inherited from the closed `Position` (base class, not the override) |
| `realizedGL` | `number \| null` | Computed from matching `Sell` transactions if any exist for `(accountId, symbol)`; `null` if none exist. **Never approximated/fabricated.** |
| `realizedGLBasis` | `'transactions' \| 'unknown'` | `'transactions'` iff `realizedGL` was computed; `'unknown'` otherwise |

Realized G/L formula when basis is `'transactions'`: `sum(sellTx.amount for matching sells) - (oldPosition.shares * oldPosition.avgCost)` — total sale proceeds minus the closed position's cost basis at time of closure.

## Transaction

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uid('tx')` |
| `importSessionId` | `string` | FK → `ImportSession.id`. Tags which CSV import created this row. |
| `accountId` | `string` | |
| `date` | `string` | ISO date, from CSV mapping |
| `symbol` | `string` | |
| `type` | `string` | Free string (Buy/Sell/Dividend/etc.) — not a closed enum. UI defaults type-filter tags to whatever distinct values are present in state |
| `shares` | `number` | `parseCsvNumber` |
| `price` | `number` | `parseCsvNumber` |
| `amount` | `number` | `parseCsvNumber` of mapped `amount` column (required, not derived at import time — display code falls back to `shares * price` only if `amount` is nullish) |
| `taxes` | `number \| null` | Same rules as `Position.taxes` — optional, imported only |
| `importedAt` | `string` | ISO timestamp this row was inserted (audit only, not part of the dedup key) |

**Natural key** (dedup, per-account): `` `${date}|${symbol}|${type}|${shares}|${price}` `` — computed with `shares`/`price` re-parsed via `parseCsvNumber` so `"150.0"` and `"150"` collide. `amount` and `taxes` are **not** part of the key — two rows differing only in `amount`/`taxes` are treated as duplicates and the second is dropped.

**Numeric parsing** (`parseCsvNumber` in `src/lib/csv.ts`): strips `$`, `,`, and whitespace before `parseFloat`, so brokerage-formatted cells like `"$3.79 "` or `"45,000"` parse correctly instead of yielding `NaN` or silently truncating at the comma. Used everywhere a raw CSV cell is converted to a number during import (positions and transactions).

## PortfolioSnapshot

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uid('snap')` |
| `importSessionId` | `string` | FK → `ImportSession.id`. Tags which import created this snapshot. |
| `accountId` | `string` | One snapshot per account per import |
| `date` | `string` | ISO calendar date of the Positions import (not a timestamp) |
| `value` | `number` | Sum of `shares * price` across that account's positions at import time |

**Natural key**: `(accountId, date)`. Re-importing the same account on the same calendar date **replaces** the prior snapshot for that key (upsert, not append). A CSV spanning multiple accounts produces one snapshot per resolved account, not one combined snapshot. Whole-portfolio series are derived, never stored — see `selectors.totalValueSeries`.

## ImportSession

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uid('import')` |
| `importedAt` | `string` | ISO timestamp when the CSV was processed |
| `kind` | `'positions' \| 'transactions'` | Type of data imported in this session |
| `fileName` | `string` | Name of the uploaded CSV file |
| `accountIds` | `string[]` | Array of `Account.id`s involved in this import (one or more if file spanned multiple accounts) |
| `rowCount` | `number` | Number of rows successfully imported in this session |

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
POSITIONS_OPTIONAL_FIELDS = ['name', 'taxes']
TRANSACTIONS_REQUIRED_FIELDS = ['date', 'symbol', 'type', 'shares', 'price', 'amount']
TRANSACTIONS_OPTIONAL_FIELDS = ['taxes']
```

Optional fields (`name` for positions; `taxes` for both kinds) are never required — unmapped → `null`. The import Review step renders the mapping table in required-then-optional order: required fields carry a `*` next to their label, optional fields don't. `avgCost`/`purchaseAmount` and `price`/`marketValue` are validated as alternative pairs (at least one of each pair suffices) and the mapping `<select>` headers show cross-hints for them.

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
- `DELETE_ACCOUNT`: Remove `Account` and cascade-delete its positions/transactions

**Positions**
- `UPDATE_POSITION`: Patch fields on a `Position`
- `SET_ASSET_CLASS_OVERRIDE`: Set/clear `assetClassManualOverride` on a `Position`
- `DELETE_CLOSED_POSITION`: Remove a `ClosedPosition` from state

**Filters & UI**
- `SET_CATEGORY`, `SET_RANGE`, `SET_TAB`, `SET_SORT`, `TOGGLE_SORT`
- `SET_ASSET_CLASS_FILTER`, `SET_RETIREMENT_FILTER`
- `SET_POSITIONS_SEARCH`, `SET_TRANSACTIONS_SEARCH`, `SET_TRANSACTION_TYPE_FILTER`
- `TOGGLE_SHOW_CLOSED`: Toggle `showClosed` boolean

**Imports**
- `IMPORT_POSITIONS`: Merge/replace positions for an account (calls `importPositions` helper)
- `IMPORT_TRANSACTIONS`: Merge transactions for an account (calls `importTransactions` helper)
- `ADD_IMPORT_SESSION`: Add an `ImportSession` (newest-first, capped at 50)
- `DELETE_IMPORT_SESSION`: Remove an `ImportSession` and all rows tagged with its id
- `UPSERT_CSV_MAPPING`: Upsert a `SavedCsvMapping` for (accountId, kind)

## AppState UI/filter fields (not persisted domain data, but part of the same `AppState` blob — see `state.ts`)

`category: TaxCategory | 'all'`, `range: string` (`'6m' | '1y' | 'ytd' | 'all'`), `tab: 'positions' | 'transactions'`, `view: 'dashboard' | 'settings'`, `sortKey: keyof Position`, `sortDir: 'asc' | 'desc'`, `assetClassFilter: string`, `retirementFilter: 'All' | 'Retirement' | 'Non-Retirement'`, `posSearch: string`, `txTypeFilter: string`, `txSearch: string`, `showClosed: boolean`, `selectedCategoryKey: TaxCategory | 'closedPositions' | null`.

## Persistence envelope

The entire `AppState` (all 7 collections + all UI fields) is never stored in the clear. Every write — both the IndexedDB record and the Google Drive backup file — stores the same `EncryptedEnvelope` shape (`src/lib/crypto.ts`):

```ts
interface EncryptedEnvelope {
  version: 1
  salt: string        // base64, 16 raw bytes — PBKDF2 salt
  iv: string           // base64, 12 raw bytes — AES-GCM IV, fresh per encryption, never reused
  ciphertext: string    // base64 — AES-256-GCM ciphertext of JSON.stringify(AppState)
}
```

- **IndexedDB** (`persist.ts`): DB `portfolio_app_state_v1`, object store `app_state`, single key `'current'` holding one `EncryptedEnvelope` object — no per-collection stores.
- **Google Drive** (`drive.ts`): the backup file `portfolio-state.json` is `JSON.stringify(envelope)` for the same `EncryptedEnvelope` type — identical shape and code path (`encryptState`/`decryptState`), not a second format.
- **Algorithm (fixed, not configurable)**: key derivation is PBKDF2-SHA256, 600,000 iterations (OWASP 2023 minimum), producing a non-extractable AES-256-GCM `CryptoKey`. Encryption is AES-256-GCM with a fresh random 12-byte IV per `encryptState` call. Salt is 16 random bytes, generated once per password (on set-password or password-change) and reused for every subsequent encryption under that password until rotated.
- **Legacy-plaintext detection** (`detectEnvelopeShape`, pure/no I/O): a stored value is `'absent'` if `undefined`/`null`, `'encrypted'` if it structurally has `version === 1` and string `salt`/`iv`/`ciphertext` fields, otherwise `'legacy-plaintext'` (a pre-encryption raw `AppState` blob or any other shape). Purely structural — no version-field-only check, no content inspection beyond those four keys.
- **Migration-tolerant field coalescing**: `loadPersistedApp`/`loadLegacyPlaintextApp` both funnel through `coalesceWithDefaults`, which rebuilds the `AppState` field-by-field from a fixed whitelist against `initialState()` defaults (`loaded.x ?? defaults.x`) — a blob missing a newer collection/field loads with that field defaulted rather than throwing, and stale keys not on the whitelist (left over from removed features) are silently dropped. This logic is unchanged from before encryption was added; it now runs **after** the decrypt step rather than directly on the raw stored value.
- `loadPersistedApp(key: CryptoKey)` throws if the stored value is not `'encrypted'` (caller bug — the gate must never call it on a legacy/absent envelope) or if `crypto.subtle.decrypt` fails (wrong password → `OperationError` propagates uncaught, not swallowed).
- `savePersistedApp(state, key: CryptoKey, salt: Uint8Array)` encrypts via `encryptState` then writes; rethrows IndexedDB open/write failures (rejections propagate to the caller — no silent success).
- `peekEnvelopeShape()` / `peekStoredSalt()` read the raw IndexedDB record without a key — used by the password gate to decide which screen to show and, for `'encrypted'`, which salt to derive against.
- `loadLegacyPlaintextApp()` reads the pre-encryption blob as-is for one-time migration on the set-password submit; `clearPersistedApp()` deletes the IndexedDB record entirely (used by the gate's "Reset app" escape hatch — does not touch Google Drive).
