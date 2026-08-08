# Schema Spec — Ledger (Portfolio Dashboard)

See also: [design.md](design.md), [product-behavior.md](product-behavior.md)

All types defined in `src/lib/types.ts`. IDs are `string`, generated via `uid(prefix)` (`src/lib/seed.ts`): `prefix + '-' + <7 random base36 chars>`, e.g. `pos-a1b2c3d`. Prefixes used: `acc` (Account), `pos` (Position), `closed` (ClosedPosition), `tx` (Transaction), `snap` (PortfolioSnapshot), `map` (MappingProfile).

## Account

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uid('acc')` |
| `accountNumber` | `string` | Raw value from the mapped account-number CSV column, or user-typed on first-seen prompt (prompt UI not yet built — see product-behavior.md) |
| `name` | `string` | User-assigned, editable |
| `taxCategory` | `TaxCategory` | `'taxable' \| 'nonTaxable' \| 'taxDeferred'` |
| `retirement` | `boolean` | |
| `createdAt` | `string` | ISO date, set once at creation |

## Position

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uid('pos')`. Regenerated fresh on every import — **not** stable across re-imports of the same `(accountId, symbol)` (differs from the original v1 plan) |
| `accountId` | `string` | FK → `Account.id` |
| `symbol` | `string` | |
| `name` | `string \| null` | `null` if the mapping profile has no `name` column mapped. Never required (`name` removed from `POSITIONS_REQUIRED_FIELDS`). UI falls back to `symbol` when null. |
| `assetClass` | `string` | From CSV mapping; not a closed enum in storage |
| `assetClassManualOverride?` | `string` | If set, wins over `assetClass` everywhere (filtering, grouping, display) |
| `shares` | `number` | `parseFloat` of mapped `shares` column |
| `avgCost` | `number` | Direct from mapped `avgCost` column, or `purchaseAmount / shares` if `avgCost` unmapped/invalid |
| `price` | `number` | Direct from mapped `price` column, or `marketValue / shares` if `price` unmapped/invalid. Frozen "as of last import" — never live |
| `taxes` | `number \| null` | `parseFloat` of mapped `taxes` column if present and truthy, else `null`. Imported only, never computed; excluded from all cost-basis/G-L/allocation math |
| `lastImportedAt` | `string` | ISO date of the Positions import that set `shares`/`price` |

**Computed, never stored** (`src/lib/computations.ts` → `computePosition`): `marketValue = shares * price`, `costBasis = shares * avgCost`, `gl = marketValue - costBasis`, `glPct = costBasis === 0 ? 0 : (gl / costBasis) * 100`.

## ClosedPosition

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uid('closed')` |
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
| `accountId` | `string` | |
| `date` | `string` | ISO date, from CSV mapping |
| `symbol` | `string` | |
| `type` | `string` | Free string (Buy/Sell/Dividend/etc.) — not a closed enum. UI defaults type-filter tags to whatever distinct values are present in state |
| `shares` | `number` | `parseFloat` |
| `price` | `number` | `parseFloat` |
| `amount` | `number` | `parseFloat` of mapped `amount` column (required, not derived at import time — display code falls back to `shares * price` only if `amount` is nullish) |
| `taxes` | `number \| null` | Same rules as `Position.taxes` — optional, imported only |
| `importedAt` | `string` | ISO timestamp this row was inserted (audit only, not part of the dedup key) |

**Natural key** (dedup, per-account): `` `${date}|${symbol}|${type}|${shares}|${price}` `` — computed with `shares`/`price` re-parsed via `parseFloat` so `"150.0"` and `"150"` collide. `amount` and `taxes` are **not** part of the key — two rows differing only in `amount`/`taxes` are treated as duplicates and the second is dropped.

## PortfolioSnapshot

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uid('snap')` |
| `accountId` | `string` | One snapshot per account per import |
| `date` | `string` | ISO calendar date of the Positions import (not a timestamp) |
| `value` | `number` | Sum of `shares * price` across that account's positions at import time |

**Natural key**: `(accountId, date)`. Re-importing the same account on the same calendar date **replaces** the prior snapshot for that key (upsert, not append). A CSV spanning multiple accounts produces one snapshot per resolved account, not one combined snapshot. Whole-portfolio series are derived, never stored — see `selectors.totalValueSeries`.

## MappingProfile

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `uid('map')` |
| `name` | `string` | User-named |
| `kind` | `'positions' \| 'transactions'` | Profiles are scoped to one CSV shape; `listProfilesForKind` filters by this |
| `fieldMap` | `Record<string, string>` | Keys are **CSV header names**, values are our internal field names, e.g. `{ 'Symbol': 'symbol', 'Qty': 'shares' }` — i.e. `fieldMap[csvHeader] = ourField` (note: inverted relative to the original plan's `ourField -> csvHeader` description) |
| `accountNumberColumn?` | `string` | CSV header holding the account number; absent ⇒ `resolveAccountNumber` returns `null` (manual prompt path, not yet built in UI) |
| `createdAt` | `string` | ISO, set once |
| `updatedAt` | `string` | ISO, bumped on every `updateProfile` call |

### Required field sets

```ts
POSITIONS_REQUIRED_FIELDS = [
  'symbol', 'assetClass', 'shares',
  'avgCost', 'purchaseAmount',   // alternative pair — need at least one
  'price', 'marketValue',         // alternative pair — need at least one
]
AVGCOST_FIELDS = ['avgCost', 'purchaseAmount']
PRICE_FIELDS = ['price', 'marketValue']
TRANSACTIONS_REQUIRED_FIELDS = ['date', 'symbol', 'type', 'shares', 'price', 'amount']
```

`name` (positions) and `taxes` (positions + transactions) are **never** in a required-fields list — always optional, defaulting to `null` when unmapped.

### `validateProfile(profile, kind)` rules

- **positions**: `symbol`, `assetClass`, `shares` always required. Error if neither `avgCost` nor `purchaseAmount` is mapped; error if neither `price` nor `marketValue` is mapped. Warning (non-blocking) if *both* of a pair are mapped — import prefers `avgCost`/`price` over the fallback.
- **transactions**: all of `TRANSACTIONS_REQUIRED_FIELDS` required, no alternative-pair logic, no warnings.
- Returns `{ valid: boolean, errors: string[], warnings?: string[] }`.

## AppState UI/filter fields (not persisted domain data, but part of the same `AppState` blob — see `state.ts`)

`category: TaxCategory | 'all'`, `range: string` (`'6m' | '1y' | 'ytd' | 'all'`, currently inert — see product-behavior.md), `tab: 'positions' | 'transactions'`, `sortKey: keyof Position`, `sortDir: 'asc' | 'desc'`, `assetClassFilter: string`, `retirementFilter: 'All' | 'Retirement' | 'Non-Retirement'`, `posSearch: string`, `txTypeFilter: string`, `txSearch: string`, `showClosed: boolean`, `pendingImport?: { kind: 'positions' | 'transactions'; rows: any[] }`, `accountPromptQueue?: { accountNumber: string; profileId: string }[]`.

## Persistence envelope

IndexedDB (`persist.ts`): DB `portfolio_app_state_v1`, object store `app_state`, single key `'current'` holding the entire `AppState` object (all 6 collections + all UI fields) as one blob — no per-collection stores. On load, every collection field is coalesced against `initialState()` defaults (`loaded.x ?? defaults.x`), so a blob missing a newer collection/field loads with that field defaulted rather than throwing.
