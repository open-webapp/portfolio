# Design

**See also:** `schema-spec.md`, `product-behavior.md`

## Overview

Local-first, single-user React 19 + TypeScript portfolio tracker. State is a single `useReducer` in `App.tsx`, persisted to IndexedDB, and optionally synced to Google Drive via `@open-webapp/drive-sync`.

**Key principle:** All data mutations flow through pure action-helper functions in `state.ts` and a thin dispatch table in `reducer.ts`. Components read through selectors and dispatch actions only.

## State Architecture

### AppState (src/lib/state.ts)
```typescript
interface AppState {
  // Data collections
  accounts: Account[]
  positions: Position[]
  closedPositions: ClosedPosition[]
  transactions: Transaction[]
  snapshots: PortfolioSnapshot[]
  mappingProfiles: MappingProfile[]

  // UI state
  category: 'all' | 'taxable' | 'nonTaxable' | 'taxDeferred'
  range: 'all' | '1M' | '3M' | '6M' | '1Y' | 'YTD'
  tab: 'overview' | 'positions' | 'transactions'
  sortKey: keyof Position
  sortDir: 'asc' | 'desc'
  assetClassFilter: string  // 'All' or specific asset class
  retirementFilter: boolean  // true = show only retirement accounts
  posSearch: string         // Position search/filter term
  txTypeFilter: string      // Transaction type filter
  txSearch: string          // Transaction search term
  showClosed: boolean       // Show/hide closed positions table

  // Transient state (not persisted)
  pendingImport?: {
    kind: 'positions' | 'transactions'
    rows: Record<string, string>[]
    profileId: string
    manualAccountNumber?: string  // typed in by user when profile has no accountNumberColumn
  }
  accountPromptQueue?: { accountNumber: string; profileId: string }[]  // first-seen accounts awaiting name/category/retirement
}
```

### Action Pattern

All mutations defined in `state.ts` as pure functions:
```typescript
export function addAccount(state: AppState, ...): AppState
export function setCategory(state: AppState, category: string): AppState
export function toggleSort(state: AppState, sortKey: keyof Position): AppState
// ... etc
```

Reducer (`reducer.ts`) is a thin dispatch table:
```typescript
function appReducer(state: AppState, action: any): AppState {
  switch (action.type) {
    case 'ADD_ACCOUNT':
      return addAccount(state, action.payload)
    // ... etc
  }
}
```

## Data Flow

### CSV Import Pipeline

1. **User uploads CSV** → `ImportPanel` component captures file
2. **Papa.parse** → Extract headers and rows (raw strings)
3. **User selects/creates MappingProfile** → Maps CSV columns to field names
4. **Validation** → Check all required fields are mapped (`validateProfile`)
5. **Apply mapping** → Each row remapped to canonical field names
6. **Account resolution** → If the profile has no `accountNumberColumn` mapped, prompt the user to type one in (`ManualAccountNumberPrompt`, applied to every row). For each unique account number, prompt user if it's first-seen (`AccountResolvePrompt`, backed by `accounts.ts`)
7. **Position/Transaction import** → Apply business rules (replace vs merge, dedup, close positions). Rows with blank/unparseable required fields are skipped (not imported as NaN records).
8. **State merge** → Return updated `AppState`

**Files involved:**
- `csv.ts` — Papa.parse wrapper
- `mappingProfiles.ts` — Profile CRUD, validation, mapping application
- `accounts.ts` — Account lookup/prompt
- `positionsImport.ts` — Position replace logic + ClosedPosition creation
- `transactionsImport.ts` — Transaction dedup by natural key

### Persistence

**IndexedDB** (`persist.ts`):
- Single versioned blob: `portfolio_app_state_v1`
- Load: `loadPersistedApp()` → returns `AppState | null`
- Save: `savePersistedApp(state)` → debounce 500ms on every state change
- Migration tolerance: Missing collections default to `[]`, never throw

**Google Drive sync** (`drive.ts`):
- Singleton `drive` instance wraps `@open-webapp/drive-sync`
- Load-bearing path: `['OpenWebApp', 'Portfolio']` — exact match required
- Backup format: JSON dump of entire `AppState`
- Error handling: Silent failures log to console, don't block app

## Selector Layer (src/lib/selectors.ts)

All filtering, search, sort, aggregation derived here from `AppState`:

```typescript
export function visiblePositions(state: AppState): Position[]
export function visibleTransactions(state: AppState): Transaction[]
export function totalValueSeries(state: AppState): { date, value }[]
export function summaryCards(state: AppState): SummaryCard[]
export function allocationBars(state: AppState): AllocationBar[]
export function performanceLinePoints(state: AppState): Point[]
```

**Pattern:** Components call selectors, never derive filters/sorts inline.

## Component Tree

```
App (useReducer, hydrate/persist)
├─ Header (logo, account switcher)
├─ Overview (summary cards, charts)
├─ ImportPanel (CSV upload, mapping UI)
├─ PositionsTable
│  ├─ Asset class filter tags
│  ├─ Search input
│  ├─ Sortable position rows
│  └─ ClosedPositionsTable (toggle)
├─ TransactionsTable
│  ├─ Transaction type filter
│  ├─ Search input
│  └─ Sortable transaction rows
└─ Settings (manage profiles, Drive sync)
```

## Styling

**src/styles/styles.css:** Verbatim port of design-bundle CSS. Do not hand-edit design tokens inline.

**Class vocabulary** (from design-bundle):
- `.card.blueprint.elev-sm` + corner marks (`<i class="corner tl/tr/bl/br">`)
- `.tag`, `.tag-accent`, `.tag-outline` — filter/chip UI
- `.seg`, `.seg-opt` — segmented button groups
- `.table` — tabular data
- `.nav` — navigation
- `.field`, `.input` — form controls
- `.dialog-backdrop`, `.dialog` — modals

**Pattern:** Compose classes, avoid inline styles.

## Computation (src/lib/computations.ts)

Pure functions derive position metrics from schema fields:
- `costBasis = shares × avgCost`
- `marketValue = shares × price`
- `gl = marketValue - costBasis`
- `glPct = gl / costBasis` (0 if costBasis = 0)
- `realizedGL` — from transaction data, or null + 'unknown' basis

Never stored on `Position`; always computed on read.

## Testing

- **Framework:** vitest + jsdom
- **Colocation:** One `*.test.ts` per `src/lib/*.ts` module
- **Mocking:** `fake-indexeddb` for IndexedDB tests, mock `@open-webapp/drive-sync` calls
- **Coverage:** CSV import, dedup logic, persistence, validation

## Key Invariants

1. **Position natural key:** `(accountId, symbol)` — re-importing replaces, doesn't merge
2. **Transaction natural key:** `date|symbol|type|shares|price` per account — duplicates skipped
3. **PortfolioSnapshot natural key:** `(accountId, date)` — same-day re-import replaces
4. **ClosedPosition creation:** When symbol disappears from import, create closed record with name/assetClass inherited
5. **Realized G/L:** Computed from matching Sell transactions if exist; else null + 'unknown' basis
6. **Optional fields:** `name`, `taxes` default to `null` if not in CSV or empty in row; never required
7. **Immutability:** All mutations return new objects; no in-place edits
8. **TypeScript:** Strict mode enforced; no `any` except in action dispatch payloads
