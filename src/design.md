# design.md (app-level)

App-wide architecture. Sibling: `product-behavior.md` (user-visible behavior). Module-specific: `src/lib/design.md` (drive.ts/persist.ts internals, component-tree/data-flow addenda).

## Directory Structure

```
src/
  App.tsx / App.css / App.test.tsx   — root component: routing, hydration, gate, persist/drive wiring
  main.tsx / index.css               — entry point
  hooks/
    useHashRoute.ts                  — hash-based route hook
    useGlobalCategories.ts            — global category/mapping/account-rule hydrate, persist, Drive sync hook
  lib/
    types.ts                         — domain model (Portfolio, Account, Position, Transaction, ...)
    state.ts / reducer.ts            — AppState + useReducer action helpers/dispatch table; per-portfolio applied account-convention markers
    categoryStore.ts / categoryMerge.ts / categoryPersist.ts / categoryDrive.ts / categoryMigration.ts — global categories, mappings, and account sign rules
    portfolioRegistry.ts             — portfolio CRUD + legacy-db migration (own IndexedDB)
    router.ts                        — hash parse/navigate helpers
    persist.ts                       — per-portfolio IndexedDB read/write/encrypt
    drive.ts                         — per-portfolio Drive backup/restore/conflict + auth
    crypto.ts                        — AES-GCM encrypt/decrypt, key derivation
    csv.ts, accounts.ts, positionsImport.ts, transactionsImport.ts,
    importExport.ts, expenseExport.ts, importPreview.ts, pastedTable.ts — local export/download helpers and CSV import pipeline
    (mapping-profile fields live on SavedCsvMapping in types.ts / csvMappings in AppState)
    selectors.ts                     — derived/filtered view data for components
    computations.ts                  — position market value/cost basis/G-L math
    aggregateRows.ts, sort.ts, register.ts, tickerOverview.ts — misc view-model helpers
    priceSync.ts, mutualFundSync.ts, marketDataDb.ts — price/NAV sync + cache
    seed.ts
    *.test.ts                        — one colocated test file per module
    design.md                        — drive.ts-focused module doc (see header note)
  components/
    PortfolioPicker.tsx              — portfolio create/rename/delete/open UI
    Nav.tsx                          — top nav: view tabs, sync button, portfolio-name button (switch portfolio), settings button
    PasswordGate.tsx                 — password set/enter screens (portfolio-scoped Drive props)
    AccountsPage.tsx, BudgetPage.tsx, RegisterPage.tsx, QuotesPage.tsx, Settings.tsx — main views
    BudgetExpensesTab.tsx            — budget expense definitions, per-year amounts, direct CSV download, and paste import dialog
    BudgetAccountsTab.tsx            — global statement-convention rule controls
    BudgetExpensesTab.design.md,
    BudgetExpensesTab.product-behavior.md — component API/data flow and user-visible expense import/download behavior
    CategoryMappingTab.tsx            — Budget-local category/mapping management tab
    CategoryMappingTab.design.md,
    CategoryMappingTab.product-behavior.md — component API/data flow and user-visible behavior
    PositionGroupOverlay.tsx, ClosedPositionsTable.tsx, TransactionsTable.tsx,
    AllocationChart.tsx, AssetClassOverrideSelect.tsx, InstitutionSelect.tsx,
    RegisterBalanceDialog.tsx        — view-local widgets
    SyncConflictDialog.tsx           — Drive UI
    import/
      ImportDialog.tsx, index.ts     — CSV import dialog
  styles/styles.css                  — shared design-bundle CSS port; category-mapping dialogs constrain their viewport height and scroll their body
  test/                              — shared test setup/fixtures
```

## State Management

- Single `useReducer(appReducer, initialState())` in `App.tsx`. No Redux/other state libs.
- `src/lib/state.ts`: `AppState` interface (data collections + UI filter/selection state) and pure action-helper functions (`addAccount`, `setCategory`, `toggleSort`, `selectAccount`, `restoreClosedPosition`, etc). New mutating features: add a helper here.
- `src/lib/reducer.ts`: thin `appReducer(state, action)` dispatch table — each `case` calls one `state.ts` helper. No logic lives directly in the reducer or in components.
- Full `AppState` field list, invariants, and per-field types: see `src/lib/types.ts` and `src/lib/state.ts` (not duplicated here).
- Budget income is derived in `selectors.ts` from active exact normalized `Income` categories, expense definitions, and budget transactions. No manual income state is persisted or exported.
- `GlobalCategoryState = { categories: Category[]; categoryMappings: CategoryMapping[]; budgetAccountRules: BudgetAccountRule[] }` is global across portfolios. `useGlobalCategories` hydrates it, saves edits to its own IndexedDB store (500ms debounce), merges initial/polled/manual Drive data with `mergeCategoryState`, immediately pushes connected local edits to shared unencrypted `category-mappings.json`, and returns visible records plus `dispatch`, `hydrated`, and `syncNow`.
- `budgetAccountAppliedConventions: Record<string, StatementConvention>` remains per-portfolio `AppState` data. Budget imports require an account, canonicalize its name/sign before import dedup, and persist the applied convention marker even when all rows dedup. `App.tsx` reconciles markers/rules before shell render after hydrate and after global-rule changes; the Budget Accounts tab confirms then reconciles local changes immediately. Parsers are unchanged.

## Portfolio Routing Layer (multi-portfolio)

Each portfolio is an isolated IndexedDB database; navigation is driven entirely by the URL hash (no in-memory "current portfolio" pointer persisted anywhere).

- **`src/lib/types.ts`**: `Portfolio = { id: string; name: string; dbName: string; createdAt: number }`.
- **`src/lib/portfolioRegistry.ts`**: CRUD against its own IndexedDB (`portfolio-registry` db, `portfolios` store, keyPath `id`).
  - `listPortfolios()`, `getPortfolio(id)`, `createPortfolio(name)`, `renamePortfolio(id, name)`, `deletePortfolio(id)`.
  - Name uniqueness: case-insensitive + trimmed (`name.trim().toLowerCase()`), checked against all other rows; renaming to one's own current name is a no-op success.
  - `createPortfolio` generates `id = 'port-' + crypto.randomUUID()`, `dbName = `portfolio_app_state_v1-${id}``.
  - `deletePortfolio` removes the registry row then calls `indexedDB.deleteDatabase(portfolio.dbName)` — irreversible, local-only, never touches Drive.
  - `isMigratedPortfolio(portfolio)`: `true` iff `portfolio.dbName === 'portfolio_app_state_v1'` — drives the Drive `projectId`/folder-path special case in `drive.ts`. (No code seeds a registry row with this dbName anymore — it only still matters for the pre-existing registry row of whoever's local browser was upgraded through that transition in the past.)
- **`src/lib/router.ts`**: `Route = { name: 'picker' } | { name: 'portfolio', portfolioId: string }`. `parseHash(hash)` maps `#/portfolio/<id>` → the portfolio route, everything else (`''`, `'#/'`, `'#/portfolio/'`) → picker. `navigateToPicker()` sets `location.hash = '#/'`; `navigateToPortfolio(id)` sets `#/portfolio/<encodeURIComponent(id)>`.
- **`src/hooks/useHashRoute.ts`**: `useHashRoute()` returns the current `Route`, re-parsed on `window` `hashchange`.

## Persistence (`src/lib/persist.ts`)

- Parameterized by `dbName`; no hardcoded db name in the active read/write path.
- `dbHandles: Map<string, Promise<IDBDatabase>>` caches one open connection per `dbName`.
- `activePortfolioDbName` module-level stash, set via `setActivePortfolioDb(dbName)` (also evicts any cached handle for that name, forcing a fresh open in case a prior open raced a delete).
- `loadPersistedApp`, `savePersistedApp`, `peekEnvelopeShape`, `peekStoredSalt` all call `openDb(requireActiveDbName())` / read via the same active-db stash — throw (or resolve 'absent'/null) if `setActivePortfolioDb` was never called for the current portfolio. No function in this module ever hardcodes a specific db name.
- `coalesceWithDefaults(loaded)`: fills missing collections/fields from `initialState()` — every load path (local unlock, Drive restore) runs through this.

## Drive Sync (`src/lib/drive.ts`)

- Portfolio-scoped: every sync/restore/status function takes `portfolio: Portfolio` as its first argument (`syncBackup`, `getBackupFileId`, `getBackupFileStatus`, `restoreBackupFromFileId`, `overwriteLocalWithRemote`, `overwriteRemoteWithLocal`, `getConnectionSnapshot`, `migrateLegacyDriveFolderIfNeeded`).
- `driveProjectIdFor(portfolio)`: returns `'app'` for the migrated legacy portfolio (preserves its pre-upgrade Drive connection without forcing re-auth), else `portfolio.id`.
- `getDriveAuthFor(portfolio)`: returns a cached `DriveAuthHandle` from `driveAuthCache: Map<string, DriveAuthHandle>`, keyed by `driveProjectIdFor(portfolio)` — same portfolio always yields the same handle; distinct non-migrated portfolios get distinct, independently-authenticated handles. Built via `@open-webapp/drive-connect`'s `createDriveAuth({ drive, projectId, tokenBufferMs })`.
- `driveSyncForPortfolio(portfolio)`: builds a fresh `createDriveSync({..., folderPath: ['OpenWebApp', 'Portfolio', portfolio.name]})` per call — folder path always reflects the portfolio's *current* name; renaming targets a new folder on next sync, old-named folder left untouched.
- `migrateLegacyDriveFolderIfNeeded(portfolio)`: one-time, lazy, idempotent move of the legacy flat-root backup file (`OpenWebApp/Portfolio/portfolio-state.json`) into the migrated portfolio's own named subfolder. No-op for non-migrated portfolios, and once the flat file is gone. Never prompts for auth (skips if no connection / `needsReauth`).
- Picker-scoped Drive folder browsing (new-portfolio creation/import) is separate from per-portfolio sync: `getPickerDriveAuth()` (fixed `'picker'` project id) + `listPortfolioFoldersOnDrive()`/`decryptDriveFolderBackup()` in `drive.ts`, called from `App.tsx`'s handlers and passed down to `PortfolioPicker.tsx` — not component-owned. See `src/lib/design.md` for the full API.
- `legacyDriveSync` (fixed `['OpenWebApp','Portfolio']` facade) also backs `getPickerDriveAuth()` above. The separate `drive` compatibility wrapper (its `pickFile` override) has no current callers — see `src/lib/design.md`.

## Component Tree

```
App.tsx
├─ route.name === 'picker' → PortfolioPicker
│    (portfolios, onRename, onDelete, onOpen=navigateToPortfolio, onCreateNew,
│    onImportFromDriveFolder, onImportFromFile, onListDriveFolders=listPortfolioFoldersOnDrive)
│    — inline create/import flows; see `src/components/PortfolioPicker.design.md`
└─ route.name === 'portfolio' → resolves Portfolio (from loaded list, or getPortfolio() fallback;
   unknown id → navigateToPicker()) → activatePortfolio() → setActivePortfolioDb + setActivePortfolio
   ├─ not yet resolved / gate shape unknown → "Loading..." placeholder
   ├─ sessionKey === null → PasswordGate (shape, onUnlock, onBackToPicker — no Drive props; new portfolios skip this gate entirely via PortfolioPicker's inline create/import flow, see below)
   │    ├─ shape === 'encrypted' → EnterPasswordScreen
   │    └─ shape === 'absent' → SetPasswordScreen (defends against a portfolio db that's genuinely empty; new portfolios never reach this since they skip the gate entirely)
   └─ unlocked + hydrated → app shell
        ├─ Nav (view tabs: Budget/Positions/Register/Quotes; sync button; portfolio-name button, onSwitchPortfolio=navigateToPicker; settings button)
        ├─ desktop content shell offsets 76px for the fixed left rail; at <=480px the rail moves to the bottom and the offset is removed
        ├─ state.view === 'budget'    → BudgetPage (local Expenses/Spend/Analytics/Category Mapping/Accounts tabs; receives hydrated global categories, mappings, and account rules)
        ├─ state.view === 'accounts'  → AccountsPage
        ├─ state.view === 'register'  → RegisterPage
        ├─ state.view === 'quotes'    → QuotesPage
        ├─ state.view === 'settings'  → SettingsPage (activePortfolio, driveAuth=getDriveAuthFor(activePortfolio), sessionKey/salt, sync/price-sync props; Backup/Encryption/Quotes API Key only, no category-mapping props)
        ├─ budget expenses → BudgetExpensesTab (direct local `Download Expenses` builds full-state definition CSV via `expenseExport.ts` + `downloadCsvAsFile`; local add/import dialogs; paste import parses valid rows, ensures an Uncategorized category, then dispatches `IMPORT_EXPENSE_PASTE` for the selected year)
        ├─ budget category mapping → CategoryMappingTab (Budget-local tab; hydrated global categories/mappings and category-store dispatch)
        └─ syncConflict → SyncConflictDialog (overlay)
```

`ImportDialog` (under `components/import/`) is invoked from `AccountsPage`/`Settings` for CSV import, independent of the routing branch above.

## Data Model

Full type definitions, field reference, and domain invariants (natural keys, replace-on-reimport rules, dedup keys, computed-field rules): see `src/lib/types.ts` (types) and root `CLAUDE.md`'s Architecture section (invariants). Not duplicated here.

- `expenseExport.ts` is a pure budget expense-definition CSV module. It receives full definitions, amount maps, budget transactions, shared categories, and a date; it emits all definitions sorted by category/name with shared year columns. The Budget Expenses download passes its CSV directly to the browser-local `downloadCsvAsFile`; it has no expense-import or Drive route.
