# Portfolio Dashboard ("Ledger") — Implementation Plan v1

Greenfield React 19 + TS + Vite app. Local-first, CSV-import-driven portfolio
tracker. No live prices, no auth beyond Drive OAuth, single user.

This plan is written caveman-simple on purpose: small tasks, explicit deps,
concrete types. Read it top to bottom before coding task 1.

## Overview

**What we're building**: a single-page dashboard ("Ledger") with:
- Nav bar: category tabs (Taxable / Non-Taxable / Tax-Deferred / All) + date-range select.
- Retirement filter tags (All / Retirement / Non-Retirement).
- 4 summary cards: Total Value, Day Change, Total Gain/Loss, Cost Basis.
- Performance line chart (SVG polyline) driven by `PortfolioSnapshot` history (real data, not mock).
- Allocation bar chart by asset class (% of total market value).
- Positions table: sortable columns, asset-class filter tags, search box, closed-positions toggle/table.
- Transactions table: type filter tags, search box, unmatched/orphaned detection.
- CSV import flows (Positions, Transactions) with a mapping-profile UI, account
  resolution/first-seen prompts, and per-import diffing (snapshot + closed
  positions, transaction dedup).

**What we are NOT building** (explicitly cut from scope — do not port from the
`.dc.html` prototype):
- Watchlist & Alerts card and all its markup/state (`showWatchlist`, `watchlist`,
  `ACCOUNTS.*.watchlist`, the bird-icon card block). If you're porting JSX from
  the prototype file, skip that block entirely — don't comment it out, delete it.
- Any live price feed / ticker integration.
- Multi-user / auth beyond whatever `@open-webapp/drive-sync`'s Google OAuth
  itself requires.
- Permanent mock/demo data anywhere in shipped app code (fixtures live only in
  `*.test.ts` files).

**Source-of-truth references** (read once, cite by path in code comments where
logic is ported):
- UI/computation spec: `portfolio-dashboard-design/project/Portfolio Dashboard.dc.html`
  — its `fmtUSD`, `fmtPct`, `computePositions`, `buildTransactions`,
  `combineAccounts`, `renderVals` show exactly what fields and math are needed.
  We reimplement the math against real data; we do NOT reuse `ACCOUNTS`,
  `getAccountsForCategory`'s "no accounts → fake empty account" fallback trick,
  or the synthetic `buildTransactions` (that function fabricates fake
  transactions from position lists — real transactions come from imported CSV
  rows, never generated).
- Design tokens/components: `portfolio-dashboard-design/project/styles.css`
  (ported verbatim, see Task 2) and
  `portfolio-dashboard-design/project/_ds/industry-*/readme.md` (usage rules:
  never hardcode a hex/px/font the tokens already cover; keep `.blueprint` +
  4 `<i class="corner ...">` marks on every card; no rounding).
- Stack conventions: `/Users/mdoraiswamy/owa/planning` — `package.json` (exact
  dependency versions to match), `src/lib/state.ts` + `reducer.ts` (reducer
  pattern: `AppState` interface, `type Action = { type: string; ... }`,
  pure `appReducer(state, action)`, action-specific helper functions in
  `state.ts` that the reducer just calls), `src/lib/persist.ts` (localStorage
  read/write with a versioned storage key, migration-tolerant), `src/lib/drive.ts`
  (`createDriveSync({ appId, clientId, folderPath })` singleton + a
  `connectDriveSync()` helper), `src/lib/csv.ts` (Papa.parse usage, header-based
  parsing, `escapeCSVField`/round-trip build+parse pattern), and
  `src/lib/csv.test.ts` (vitest `describe`/`it`, one file per lib module,
  numbered "Test N:" comments, table-driven fixtures inline in the test file).

## Architecture

```
portfolio/
  src/
    main.tsx
    App.tsx                    # top-level layout, wires reducer + Nav + tabs
    styles/
      styles.css                # ported verbatim from design bundle (Task 2)
    lib/
      types.ts                  # Account, Position, Transaction, PortfolioSnapshot,
                                 # MappingProfile, ClosedPosition, AssetClass, etc.
      state.ts                  # AppState interface + pure action-helper functions
      reducer.ts                # appReducer(state, action) — thin dispatch table
      persist.ts                # IndexedDB load/save (idb wrapper), migration-tolerant
      drive.ts                  # createDriveSync singleton + connect/sync helpers
      csv.ts                    # papaparse wrappers: parsePositionsCsv, parseTransactionsCsv
      mappingProfiles.ts         # profile CRUD + apply-mapping-to-row
      accounts.ts                # account resolution, first-seen prompt logic
      positionsImport.ts         # replace-snapshot + closed-position diff logic
      transactionsImport.ts      # dedup-by-natural-key logic
      computations.ts            # marketValue/costBasis/gl/glPct/allocation % (ported math)
      sort.ts                    # generic table sort helper (mirrors planning/src/lib/sort.ts)
      selectors.ts               # derived-data selectors (visiblePositions, visibleTransactions, summary)
      seed.ts                    # uid() helper (same pattern as planning/src/lib/seed.ts)
    components/
      Nav.tsx                    # category tabs + range select
      SummaryCards.tsx
      PerformanceChart.tsx       # SVG polyline, built from PortfolioSnapshot[]
      AllocationChart.tsx        # bar list by asset class
      PositionsTable.tsx         # sort/filter/search/closed-toggle
      ClosedPositionsTable.tsx
      TransactionsTable.tsx      # filter/search/unmatched badge
      import/
        ImportPositionsDialog.tsx
        ImportTransactionsDialog.tsx
        MappingProfileEditor.tsx
        AccountResolvePrompt.tsx      # first-seen account naming/category prompt
        AssetClassOverrideSelect.tsx  # per-position manual override control
    __tests__ or co-located *.test.ts files (vitest convention: one *.test.ts per lib module)
  plans/
    portfolio-dashboard-v1.md   # this file
```

**State shape**: single reducer (`appReducer`) + `AppState`, same shape as
`planning/src/lib/state.ts` (one big interface, action-helper functions
exported from `state.ts`, `reducer.ts` just switches on `action.type` and
calls them — no Redux Toolkit, no extra libs).

**Persistence**: IndexedDB (not localStorage — position/transaction volume can
exceed localStorage's ~5MB comfortably, and `fake-indexeddb` is already a
devDependency in the planning stack for tests). Store one blob per top-level
collection (`accounts`, `positions`, `transactions`, `snapshots`,
`mappingProfiles`) or one versioned blob for the whole app state — decide in
Task 6, but bias toward the simpler single-blob approach planning uses
(`APP_STORAGE_KEY` pattern) unless data volume forces splitting.

**Sync**: `@open-webapp/drive-sync`'s `createDriveSync({ appId: 'portfolio',
clientId, folderPath: ['OpenWebApp', 'Portfolio'] })`, same shape as
`planning/src/lib/drive.ts`. Backup format: JSON snapshot of the whole
IndexedDB state (positions/transactions CSV round-tripping is not required for
sync — sync is our own JSON, CSV is only for user-facing import).

**Styling**: `styles.css` copied verbatim, imported once in `main.tsx`. No
Tailwind despite it being in `planning`'s devDependencies — this app skips
Tailwind entirely per decision 12. Components use the design system's classes
(`.card.blueprint.elev-sm` + 4 `<i class="corner tl/tr/bl/br">`, `.tag`/`.tag-accent`/
`.tag-outline`/`.tag-neutral`, `.seg`/`.seg-opt`, `.table`, `.nav`/`.nav-brand`,
`.field`/`.input`, `.dialog-backdrop`/`.dialog`) directly, matching the
prototype's markup shape (see `.dc.html` lines 50-61 for the summary-card
pattern, 133-183 for the positions table, 208-250 for transactions).

## Data Model

All in `src/lib/types.ts`. IDs are `string` (via `uid(prefix)`, same helper
pattern as `planning/src/lib/seed.ts`).

```ts
export type TaxCategory = 'taxable' | 'nonTaxable' | 'taxDeferred'

export type AssetClass =
  | 'Equity' | 'ETF' | 'Mutual Fund' | 'Fixed Income' | 'Crypto' | 'Cash' | 'Other'
// user can free-type a new one via the override select; not a closed enum at
// the type level in storage (store as string), but these are the seeded options.

export interface Account {
  id: string                 // uid('acct')
  accountNumber: string      // raw value from CSV's mapped account-number column,
                              // or user-typed value if no column was mapped
  name: string                // user-assigned on first-seen prompt, editable after
  taxCategory: TaxCategory     // set on first-seen prompt, editable after
  retirement: boolean          // set on first-seen prompt, editable after
  createdAt: string            // ISO date, first time this account number was seen
}

export interface Position {
  id: string                  // uid('pos'), stable across re-imports for the same
                               // (accountId, symbol) pair — see positionsImport.ts
  accountId: string
  symbol: string
  name: string
  assetClass: string           // from CSV mapping if present, else 'Other';
                                // always overridable via manual override (decision 5)
  assetClassManualOverride?: string  // if set, wins over the imported assetClass
  shares: number
  avgCost: number
  price: number                 // frozen "as of last import" (decision 8)
  lastImportedAt: string         // ISO date of the Positions CSV import that set price/shares
  // computed, not stored (see computations.ts):
  //   marketValue = shares * price
  //   costBasis   = shares * avgCost
  //   gl          = marketValue - costBasis
  //   glPct       = costBasis === 0 ? 0 : (gl / costBasis) * 100
}

export interface ClosedPosition {
  id: string                    // uid('cpos')
  accountId: string
  symbol: string
  name: string
  closedDate: string             // ISO date of the import that first showed it missing
  assetClass: string
  realizedGL: number | null      // null when no matching Sell transaction exists (resolved:
                                  // show "unknown" in the UI, never fabricate a number — decision below)
  realizedGLBasis: 'transactions' | 'unknown'
}

export interface Transaction {
  id: string                     // uid('tx')
  accountId: string
  date: string                    // ISO date, from CSV mapping
  symbol: string
  type: string                     // from CSV mapping, free string (Buy/Sell/Dividend/etc — not
                                    // a closed enum; the prototype's txTypeFilters list
                                    // ('All','Buy','Sell','Dividend') is a UI default filter
                                    // set, not a storage-level constraint)
  shares: number
  price: number
  amount: number                    // shares*price if not separately mapped, else mapped value
  importedAt: string                 // ISO date this row was inserted (for audit, not natural key)
}

export interface PortfolioSnapshot {
  id: string                        // uid('snap')
  accountId: string                  // one snapshot per account per import (resolved decision below)
  date: string                       // ISO calendar date (not timestamp) of the Positions CSV import
  value: number                       // that account's total marketValue at that import
}
// Natural key = (accountId, date). Re-importing the same account on the same
// calendar day dedups by this key: the new snapshot REPLACES the old one for
// that key — no separate "same-day" special case needed, dedup-by-key handles
// it. A Positions CSV containing rows for multiple accounts produces one
// PortfolioSnapshot PER account (grouped by resolved account number), not one
// combined whole-portfolio snapshot. Whole-portfolio totals (e.g. "All"
// category, combined Performance chart) are derived by summing snapshots
// across accounts grouped by date — see selectors.ts's totalValueSeries(state).

export interface MappingProfile {
  id: string                          // uid('map')
  name: string                         // user-named, e.g. "Fidelity Positions"
  kind: 'positions' | 'transactions'    // profiles are scoped to one CSV shape
  fieldMap: Record<string, string>       // maps our field name -> CSV header name, e.g.
                                          // { symbol: 'Symbol', name: 'Description', shares: 'Quantity' }
  accountNumberColumn?: string             // CSV header holding account number; absent -> manual prompt
  createdAt: string
  updatedAt: string
}

// Required field sets a profile's fieldMap must cover (used for validation in the editor UI):
export const POSITIONS_REQUIRED_FIELDS = ['symbol', 'name', 'assetClass', 'shares', 'avgCost', 'price'] as const
export const TRANSACTIONS_REQUIRED_FIELDS = ['date', 'symbol', 'type', 'shares', 'price', 'amount'] as const
```

`AppState` (in `state.ts`) holds: `accounts: Account[]`, `positions: Position[]`,
`closedPositions: ClosedPosition[]`, `transactions: Transaction[]`,
`snapshots: PortfolioSnapshot[]`, `mappingProfiles: MappingProfile[]`, plus UI
state mirroring the prototype's `state` block (`category`, `range`, `tab`,
`sortKey`, `sortDir`, `assetClassFilter`, `retirementFilter`, `posSearch`,
`txTypeFilter`, `txSearch`, `showClosed`), plus import-flow transient state
(`pendingImport`, `accountPromptQueue`, etc. — shaped in Task 8/10).

## Task Breakdown

Each task ≈30 min. "Deps" lists tasks that must land first.

1. **Project scaffold** — Deps: none.
   `npm create vite@latest` (react-ts template), pin dependency versions to
   match `planning/package.json` exactly (React 19.2.8, papaparse 5.5.4,
   `@open-webapp/drive-sync` 0.1.0, vitest 4.1.10, oxlint 1.75.0, etc — copy the
   whole `dependencies`/`devDependencies` block, drop `@dnd-kit/core`,
   `@tailwindcss/postcss`, `tailwindcss`, `autoprefixer`, `postcss` since no
   drag-and-drop or Tailwind here). Wire `npm run dev/build/lint/test` scripts
   identically. Add `vitest.config.ts` + `tsconfig.json` copied/adapted from
   planning.

2. **Design system CSS port** — Deps: 1.
   Copy `portfolio-dashboard-design/project/styles.css` into
   `src/styles/styles.css` verbatim (byte-for-byte, including the Google Fonts
   `@import` and every CSS variable). Import it once in `main.tsx`. No
   modification in this task — later component tasks use the classes as-is.

3. **Data model types** — Deps: 1. Write `src/lib/types.ts` exactly as specced
   above (Account, Position, ClosedPosition, Transaction, PortfolioSnapshot,
   MappingProfile + the two required-field const arrays). No logic, just types
   + `uid()` in `src/lib/seed.ts` (copy pattern from `planning/src/lib/seed.ts`).

4. **Computation helpers** — Deps: 3.
   `src/lib/computations.ts`: `computePosition(p: Position): Position & {marketValue,costBasis,gl,glPct}`,
   `allocationByAssetClass(positions): {label:string; value:number; pct:number}[]`,
   `fmtUSD`/`fmtPct` (ported verbatim from `.dc.html` lines 258-263). Pure
   functions, no state dependency — testable in isolation.

5. **`AppState` + reducer skeleton** — Deps: 3.
   `src/lib/state.ts` (interface + `initialState()`), `src/lib/reducer.ts`
   (dispatch table, empty cases to start — `default: return state`). No CRUD
   logic yet; this just establishes the wiring so later tasks add cases
   incrementally, same shape as planning's `state.ts`/`reducer.ts` split.

6. **IndexedDB persistence** — Deps: 5.
   `src/lib/persist.ts`: `loadPersistedApp()`/`savePersistedApp(state)` using
   IndexedDB (e.g. via the `idb` package or a hand-rolled wrapper — check if
   planning's `persist.ts` uses `idb`; match it). Versioned store name
   (`portfolio_app_state_v1`), debounced save on every dispatch (wire into
   `App.tsx` in a later task). Migration-tolerant: missing collections default
   to `[]`.

7. **Drive-sync wiring** — Deps: 5.
   `src/lib/drive.ts`: `export const drive = createDriveSync({ appId: 'portfolio', clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID, folderPath: ['OpenWebApp', 'Portfolio'] })` +
   a `syncBackup(state)` helper that writes a JSON blob (not CSV — see
   Architecture) to Drive, and a `restoreBackup()` that reads it back. Mirrors
   `planning/src/lib/drive.ts`'s `connectDriveSync` shape. Wire minimal
   Settings UI (Connect/Disconnect/Sync Now) — full conflict-resolution UX
   is out of scope for v1; last-write-wins is acceptable (note as a
   simplification, not a bug).

8. **CSV parsing primitives** — Deps: 3.
   `src/lib/csv.ts`: `parseCsvFile(file: File): Promise<{headers: string[]; rows: Record<string,string>[]}>`
   using `Papa.parse(text, {header:true, skipEmptyLines:true})`, mirroring
   `planning/src/lib/csv.ts`'s `parseTasksCsvString` pattern. No mapping logic
   here — just "give me headers + raw string rows".

9. **Mapping profile model + CRUD** — Deps: 3, 8.
   `src/lib/mappingProfiles.ts`: `createProfile`, `updateProfile`,
   `deleteProfile`, `listProfilesForKind(profiles, kind)`,
   `applyMapping(row: Record<string,string>, profile: MappingProfile): Record<string,string>`
   (renames CSV headers to our field names per `fieldMap`),
   `validateProfile(profile, kind)` (checks all required fields per
   `POSITIONS_REQUIRED_FIELDS`/`TRANSACTIONS_REQUIRED_FIELDS` are mapped).
   Add reducer cases `ADD_MAPPING_PROFILE`/`UPDATE_MAPPING_PROFILE`/`DELETE_MAPPING_PROFILE`.

10. **Account resolution logic** — Deps: 3, 5.
    `src/lib/accounts.ts`: `resolveAccountNumber(row, profile): string | null`
    (reads `profile.accountNumberColumn`'d value, or null if unmapped —
    caller must then prompt), `findOrCreateAccountPrompt(state, accountNumber): Account | 'needs-prompt'`,
    `finalizeNewAccount(state, accountNumber, name, taxCategory, retirement): AppState`.
    First-seen detection: account number not present in `state.accounts`.

11. **Positions import: parse + mapping UI wiring** — Deps: 4, 8, 9.
    `ImportPositionsDialog.tsx` + `MappingProfileEditor.tsx`: file picker →
    parse (Task 8) → profile dropdown (existing profiles for kind='positions')
    or "create new" → editor UI to map each `POSITIONS_REQUIRED_FIELDS` entry
    to a detected CSV header, plus optional account-number column → save
    profile (Task 9) → apply mapping to all rows → hand off mapped rows to
    Task 12.

12. **Positions import: account resolution + snapshot diff + replace** — Deps:
    10, 11. If the CSV's rows span multiple accounts (per-row resolved account
    number), group rows by `accountId` first and run (a)-(c) below once per
    group within the same import action. `src/lib/positionsImport.ts`:
    `importPositions(state, accountId, mappedRows, importDate): AppState` that:
    (a) replaces all `Position`s for `accountId` with the new rows (matching by
    symbol to preserve `assetClassManualOverride` — see Test Cases below for
    the exact matching rule), (b) diffs old vs new position symbol sets to
    produce `ClosedPosition[]` for symbols that disappeared — realized G/L is
    computed from matching Sell transaction(s) if any exist for that
    symbol/account, else `realizedGL: null` / `realizedGLBasis: 'unknown'`
    (resolved: never fabricate a number), (c) upserts ONE `PortfolioSnapshot`
    for `(accountId, importDate)` — dedup by that natural key means a second
    import for the same account on the same calendar day replaces the prior
    snapshot rather than adding a second point. Snapshots for other accounts
    are untouched by this call. If `resolveAccountNumber` returned
    `'needs-prompt'`, this function is NOT called yet — the dialog first shows
    `AccountResolvePrompt.tsx` (Task 10's `finalizeNewAccount`) and only then
    proceeds.

13. **Transactions import: parse + mapping UI wiring** — Deps: 4, 8, 9. Same
    shape as Task 11 but for `kind='transactions'` and
    `TRANSACTIONS_REQUIRED_FIELDS`. `ImportTransactionsDialog.tsx` reuses
    `MappingProfileEditor.tsx` (parameterize by `kind`).

14. **Transactions import: dedup + insert** — Deps: 10, 13.
    `src/lib/transactionsImport.ts`: `importTransactions(state, accountId, mappedRows): AppState`
    that computes a natural key `${date}|${symbol}|${type}|${shares}|${price}`
    per existing transaction in that account, skips any mapped row whose key
    matches, inserts the rest. Same account-resolution gate as Task 12 applies
    (reuse Task 10 flow, don't duplicate it).

15. **Sort/filter helper** — Deps: 3.
    `src/lib/sort.ts`: generic `sortBy<T>(items: T[], key: keyof T, dir: 'asc'|'desc'): T[]`
    (string via `localeCompare`, number via subtraction — ported from `.dc.html`
    lines 473-478). Mirrors `planning/src/lib/sort.ts`'s shape.

16. **Selectors: positions/transactions visible lists + summary** — Deps: 4, 15.
    `src/lib/selectors.ts`: `visiblePositions(state)` (asset-class filter +
    search + sort, ported from `renderVals` lines 467-478),
    `visibleTransactions(state)` (type filter + search, lines 531-536),
    `totalValueSeries(state, accountIds)` (groups that account set's
    `PortfolioSnapshot[]` by `date`, sums `value` per date — this is the
    per-account-snapshot → whole-portfolio-series aggregation used by both of
    the next two selectors), `summaryCards(state)` (Total Value/Day
    Change/Total Gain-Loss/Cost Basis — Day Change reads the last two points of
    `totalValueSeries` for the currently-selected category's accounts, delta
    between them; replaces the prototype's fake `totalValue * 0.0064`
    placeholder at line 439), `allocationBars(state)` (Task 4's helper +
    `.pctStr` formatting), `performanceLinePoints(state, range)` (SVG
    point-string builder, ported from lines 448-457, sourced from
    `totalValueSeries` filtered by the selected date range instead of the mock
    `perf` array).

17. **Nav + category/range UI** — Deps: 5. `Nav.tsx`: category tabs
    (`.seg`/`.seg-opt`), range `<select class="input">`. Reducer cases
    `SET_CATEGORY`/`SET_RANGE`. Matches `.dc.html` lines 16-33.

18. **SummaryCards component** — Deps: 16. Renders the 4 `.card.blueprint`
    cards per `.dc.html` lines 50-61, reading `selectors.summaryCards(state)`.

19. **PerformanceChart component** — Deps: 16. SVG polyline per `.dc.html`
    lines 64-78, `linePoints` from `selectors.performanceLinePoints`.

20. **AllocationChart component** — Deps: 16. Bar list per `.dc.html` lines
    80-94.

21. **PositionsTable component** — Deps: 15, 16. Sortable headers (click →
    `TOGGLE_SORT` reducer case), asset-class filter tags, search input,
    closed-positions toggle + `ClosedPositionsTable.tsx`. Per `.dc.html` lines
    133-206. Include the `AssetClassOverrideSelect.tsx` per-row control
    (decision 5) — a small dropdown/edit affordance that dispatches
    `SET_ASSET_CLASS_OVERRIDE`.

22. **TransactionsTable component** — Deps: 15, 16. Type filter tags, search
    input, unmatched badge (`orphaned` = transaction's symbol not in that
    account's current open `Position`s — same logic as `.dc.html` line 537,
    `heldSymbols`). Per `.dc.html` lines 208-250.

23. **App.tsx wiring** — Deps: 6, 7, 17-22. Top-level layout: mount Nav,
    summary/chart row, main tabs (Positions/Transactions), wire
    `useReducer(appReducer, initialState)`, hydrate from `persist.ts` on
    mount, debounce-save on every state change, expose Import buttons that
    open Task 11/13's dialogs, expose a minimal Settings affordance for Task
    7's drive-sync connect/sync.

24. **Cut-scope audit** — Deps: 21, 22. Grep the final component tree for any
    leftover `watchlist`/`Watchlist` reference; confirm none exist. (Belt and
    suspenders — nothing in Tasks 1-23 should introduce it, but this is the
    checkpoint that verifies it.)

**Dependency graph (topological, roughly parallelizable groups)**:
```
1 → 2
1 → 3 → 4
          → 15 → 16 → 17,18,19,20
3 → 5 → 6
      → 7
3 → 8 → 9 → 11,13
5,10 → 10 → 12, 14
15,16 → 21, 22
6,7,17-22 → 23 → 24
```

## Test Cases

Vitest, one `*.test.ts` per lib module, colocated (matches planning's
`csv.test.ts` convention: `describe` blocks per function, numbered `// Test N:`
comments, table-driven fixtures inline).

**`computations.test.ts`**
- `computePosition`: marketValue = shares*price, costBasis = shares*avgCost, gl = marketValue-costBasis.
- `computePosition`: costBasis === 0 → glPct === 0 (no divide-by-zero).
- `computePosition`: negative gl → glPct negative, correct sign.
- `allocationByAssetClass`: two positions same class sum into one bucket; pct sums to 100 (within float epsilon) across all buckets.
- `allocationByAssetClass`: empty positions array → empty result, no NaN.
- `fmtUSD`/`fmtPct`: negative values render with a leading `-$`/`+`/no-sign per the prototype's exact formatting (`fmtUSD(-5)` === `'-$5.00'`, `fmtPct(-1.2)` === `'-1.20%'`, `fmtPct(1.2)` === `'+1.20%'`).

**`sort.test.ts`**
- Numeric ascend/descend by a key like `marketValue`.
- String ascend/descend by `symbol` using localeCompare (case-insensitive-ish per locale rules — assert exact expected order for a known fixture, e.g. `['aapl','AAPL','Zeta']`).
- Stable-ish behavior: equal keys don't throw, order among equal keys not asserted strictly (unless we require a documented tiebreaker — decide and pin in the test).

**`mappingProfiles.test.ts`**
- `createProfile` produces a `MappingProfile` with a fresh `uid('map')` id and `createdAt === updatedAt`.
- `validateProfile` fails when a required field for `kind='positions'` is unmapped (e.g. missing `avgCost`), passes when all six are present.
- `applyMapping` renames CSV headers to our field keys per `fieldMap`, leaves unmapped extra CSV columns untouched (or dropped — pin the exact expected shape).
- `listProfilesForKind` filters by `kind`, doesn't leak `transactions` profiles into a `positions` dropdown.
- Round-trip: `createProfile` → `applyMapping` on a row using that profile → mapped row has all required keys populated from the right source headers.

**`accounts.test.ts`**
- `resolveAccountNumber` returns the mapped column's value when `profile.accountNumberColumn` is set and present in the row.
- `resolveAccountNumber` returns `null` when `profile.accountNumberColumn` is unset.
- First-seen: an account number not in `state.accounts` triggers `'needs-prompt'` from the resolution flow.
- `finalizeNewAccount` creates an `Account` with the prompted name/taxCategory/retirement and it's found on next `resolveAccountNumber` call for the same number (no duplicate prompt).
- Existing account number (already in `state.accounts`) resolves directly without any prompt path.

**`positionsImport.test.ts`**
- Re-importing a Positions CSV for account A REPLACES A's positions: an old position not in the new CSV is gone from `state.positions` for A; positions for other accounts (B) are untouched.
- A symbol present in the old snapshot but absent from the new import appears in `closedPositions` with `closedDate` set to the new import's date.
- A symbol present in both old and new imports is NOT added to `closedPositions`, and its `assetClassManualOverride` (if previously set) survives the replace (matched by symbol+accountId).
- Importing for account A on date D upserts exactly one `PortfolioSnapshot` keyed `(accountId: A, date: D)` with `value` equal to the sum of `marketValue` across A's new positions; snapshots for other accounts (B) are untouched.
- Re-importing for account A again on the SAME date D replaces (not duplicates) the existing `(A, D)` snapshot — `state.snapshots` still has exactly one entry for that key afterward.
- A single CSV file whose mapped rows resolve to two different accounts (A and B) produces two `PortfolioSnapshot`s for that import date, one per account, each valued from only that account's rows.
- Importing positions for an account with zero prior positions produces zero closed positions (nothing to diff against) and still upserts a snapshot.
- Realized G/L on a closed position: when matching Sell transaction(s) exist for that symbol/account, `realizedGL` is computed from them and `realizedGLBasis === 'transactions'`; when none exist, `realizedGL` is `null` and `realizedGLBasis === 'unknown'` (resolved: do not fabricate a number silently).

**`transactionsImport.test.ts`**
- A row exactly matching an existing transaction's natural key (date+symbol+type+shares+price) for the same account is skipped (not duplicated).
- A row differing in any one of the 5 natural-key fields (e.g. same date/symbol/type/shares but different price) IS inserted as a new transaction.
- A row for a different account with the identical natural-key fields is inserted (dedup is per-account, not global).
- Importing an empty CSV (zero rows) is a no-op — no error, `state.transactions` unchanged.
- Mixed batch: half duplicate, half new — only the new half gets inserted, order/count assertions on the result.

**`selectors.test.ts`**
- `visiblePositions`: asset-class filter `'All'` returns everything; a specific class filters correctly.
- `visiblePositions`: search matches on symbol OR name, case-insensitive, substring (not prefix-only).
- `visiblePositions`: sort respects `sortKey`/`sortDir` from state (delegate assertion to `sort.ts`'s tested behavior, just confirm wiring).
- `visibleTransactions`: type filter + search analogous to above.
- `totalValueSeries`: two accounts each with a snapshot on the same date sum into one series point for that date; a date where only one of the two accounts has a snapshot uses just that account's value (no fabricated zero-fill for the missing account, unless a policy is pinned here explicitly).
- `summaryCards`: Day Change is computed from the last two `totalValueSeries` points for the selected category's accounts, not a hardcoded multiplier; with fewer than 2 points, Day Change renders as 0 or a defined "N/A" sentinel (pin the exact behavior; the prototype's `totalValue*0.0064` placeholder must not survive into this codebase).
- `performanceLinePoints`: single-point series input doesn't divide by zero (range−1 issue when the series has length 1, mirroring the prototype's `(perf.length - 1)` divisor at `.dc.html` line 453 — pin the fallback behavior explicitly).

**`persist.test.ts`** (using `fake-indexeddb`, same devDependency planning already pins)
- Save then load round-trips all five collections (accounts/positions/closedPositions/transactions/snapshots/mappingProfiles) byte-for-byte (deep-equal).
- Loading with no prior data returns a state with empty arrays for every collection, not `undefined`/throw.
- A stored blob missing a newer collection key (simulating a schema migration) loads with that collection defaulting to `[]` rather than crashing.

**`drive.test.ts`** (mirrors `planning/src/lib/drive.test.ts` — pin the `folderPath` array exactly, per that file's own comment about silent-failure risk)
- `drive` singleton is constructed with `appId: 'portfolio'` and `folderPath: ['OpenWebApp', 'Portfolio']` (exact array equality, not just "truthy").
- `syncBackup`/`restoreBackup` round-trip a minimal state fixture through a mocked `drive-sync` project (mock `files.write`/`files.read` or whatever the library's actual surface is — inspect `@open-webapp/drive-sync`'s types before writing this test, don't guess the method names).

## Acceptance Criteria

- [ ] `npm run dev` boots an empty dashboard (zero accounts/positions) with no crash and no mock data visible anywhere.
- [ ] `npm run build` (tsc -b && vite build) and `npm run lint` (oxlint) both pass clean.
- [ ] `npm run test` (vitest run) passes, covering at minimum every test case listed above.
- [ ] Importing a Positions CSV via a newly-created mapping profile: maps required fields, prompts for account name/taxCategory/retirement on first-seen account number, creates the account, creates positions, appends a snapshot.
- [ ] Re-importing a second Positions CSV for the same account replaces its positions, correctly detects closed positions (symbols missing from the new file), and appends a second, distinct snapshot — Performance chart updates to reflect ≥2 data points.
- [ ] Manually overriding a position's asset class in the UI persists across a subsequent unrelated re-import of a different account (no cross-account bleed) and survives a re-import of the SAME account as long as the symbol still exists in the new import.
- [ ] Importing a Transactions CSV twice in a row (identical file) inserts zero duplicate rows on the second import.
- [ ] A transaction whose symbol has no matching open position is visibly flagged "UNMATCHED" in the Transactions table.
- [ ] A position flagged "NO TX DATA"-equivalent state is possible to represent (i.e., a position with zero associated transactions doesn't crash any computation) — note: the prototype's explicit `noTx` flag is dropped in favor of deriving "has transactions" from whether any `Transaction` rows exist for that symbol/account; confirm this derivation is implemented, not the stored boolean.
- [ ] Category tabs, retirement filter, asset-class filter tags, type filter tags, and both search boxes all update their respective tables/derived data without a full page reload.
- [ ] Sorting any Positions column header toggles asc/desc and re-sorts the visible rows correctly for at least one numeric and one string column.
- [ ] Closed Positions toggle shows/hides the closed-positions table and its count badge matches the actual array length.
- [ ] Drive-sync Connect flow completes (creates `OpenWebApp/Portfolio` folder) and a manual "Sync Now" writes a backup without error; disconnecting clears local auth state.
- [ ] Reloading the page restores all accounts/positions/transactions/snapshots/mappingProfiles from IndexedDB with no data loss.
- [ ] No Watchlist/Alerts UI, state, or copied markup exists anywhere in the codebase (grep for `watchlist` case-insensitive returns nothing in `src/`).
- [ ] `styles.css` in `src/styles/` is byte-identical to the design bundle's `portfolio-dashboard-design/project/styles.css` (diff is empty).
- [ ] Every card in the app carries the `.blueprint` class and all four `<i class="corner ...">` marks (spot-check SummaryCards, PerformanceChart, AllocationChart cards).

## Resolved Follow-ups

All four open questions from the first draft of this plan were resolved and
are now baked into the Data Model / Task Breakdown / Test Cases above, not
left as decisions to make during implementation:

1. **Realized G/L on a closed position with no matching Sell transaction**:
   resolved as `realizedGL: null` / `realizedGLBasis: 'unknown'`, rendered as
   an explicit "unknown"/"—" state in the Closed Positions table. Never
   approximate from last-known price × shares.
2. **Same-day re-import of the same account**: resolved via the
   `PortfolioSnapshot` natural key `(accountId, date)` — the dedup-by-key
   upsert in Task 12 already produces "latest wins" for free; no separate
   same-day special case needed.
3. **Multi-account CSV in one file**: resolved as per-account snapshots — one
   `PortfolioSnapshot` per resolved account per import, not one combined
   whole-portfolio snapshot. `PortfolioSnapshot` no longer carries a
   `byAccount` breakdown; whole-portfolio series are derived via
   `selectors.ts`'s `totalValueSeries`.
4. **`@open-webapp/drive-sync`'s restore path**: confirmed to exist —
   `packages/drive-sync/src/files.ts` exports both `read()` and `write()`
   (plus `list`/`ensureFolderPath`). Task 7's `restoreBackup()` should call
   `read()`; no gap here.

## Implementation Notes (non-blocking)

- **IndexedDB single-blob vs per-collection storage** (Task 6) is left as an
  implementation choice biased toward the simpler single-blob approach; if
  position/transaction volume turns out to be large (multi-thousand-row
  transaction histories across many accounts over years), a single JSON blob
  read/written on every dispatch could become a perf problem. Not blocking
  for v1, but flagged so nobody is surprised later.
