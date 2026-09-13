# design.md (app-level)

App-wide architecture. Sibling: `product-behavior.md` (user-visible behavior). Module-specific: `src/lib/design.md` (drive.ts/persist.ts internals, component-tree/data-flow addenda).

## Directory Structure

```
src/
  App.tsx / App.css / App.test.tsx   — root component: routing, hydration, gate, persist/drive wiring
  main.tsx / index.css               — entry point
  hooks/
    useHashRoute.ts                  — hash-based route hook
  lib/
    types.ts                         — domain model (Portfolio, Account, Position, Transaction, ...)
    state.ts / reducer.ts            — AppState + useReducer action helpers/dispatch table
    portfolioRegistry.ts             — portfolio CRUD + legacy-db migration (own IndexedDB)
    router.ts                        — hash parse/navigate helpers
    persist.ts                       — per-portfolio IndexedDB read/write/encrypt
    drive.ts                         — per-portfolio Drive backup/restore/conflict + auth
    crypto.ts                        — AES-GCM encrypt/decrypt, key derivation
    csv.ts, accounts.ts, positionsImport.ts, transactionsImport.ts,
    importExport.ts, importPreview.ts, pastedTable.ts — CSV import pipeline
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
    Nav.tsx                          — top nav: view tabs, sync/switch-portfolio/settings buttons
    PasswordGate.tsx                 — password set/enter screens (portfolio-scoped Drive props)
    AccountsPage.tsx, RegisterPage.tsx, QuotesPage.tsx, Settings.tsx — main views
    PositionGroupOverlay.tsx, ClosedPositionsTable.tsx, TransactionsTable.tsx,
    AllocationChart.tsx, AssetClassOverrideSelect.tsx, InstitutionSelect.tsx,
    RegisterBalanceDialog.tsx        — view-local widgets
    DriveRestorePanel.tsx, GateRestoreFromFilePanel.tsx, SyncConflictDialog.tsx,
    ResetAppControl.tsx              — Drive/reset UI
    import/
      ImportDialog.tsx, index.ts     — CSV import dialog
  styles/styles.css                  — verbatim design-bundle CSS port
  test/                              — shared test setup/fixtures
```

## State Management

- Single `useReducer(appReducer, initialState())` in `App.tsx`. No Redux/other state libs.
- `src/lib/state.ts`: `AppState` interface (data collections + UI filter/selection state) and pure action-helper functions (`addAccount`, `setCategory`, `toggleSort`, `selectAccount`, `restoreClosedPosition`, etc). New mutating features: add a helper here.
- `src/lib/reducer.ts`: thin `appReducer(state, action)` dispatch table — each `case` calls one `state.ts` helper. No logic lives directly in the reducer or in components.
- Full `AppState` field list, invariants, and per-field types: see `src/lib/types.ts` and `src/lib/state.ts` (not duplicated here).

## Portfolio Routing Layer (multi-portfolio)

Each portfolio is an isolated IndexedDB database; navigation is driven entirely by the URL hash (no in-memory "current portfolio" pointer persisted anywhere).

- **`src/lib/types.ts`**: `Portfolio = { id: string; name: string; dbName: string; createdAt: number }`.
- **`src/lib/portfolioRegistry.ts`**: CRUD against its own IndexedDB (`portfolio-registry` db, `portfolios` store, keyPath `id`).
  - `listPortfolios()`, `getPortfolio(id)`, `createPortfolio(name)`, `renamePortfolio(id, name)`, `deletePortfolio(id)`.
  - Name uniqueness: case-insensitive + trimmed (`name.trim().toLowerCase()`), checked against all other rows; renaming to one's own current name is a no-op success.
  - `createPortfolio` generates `id = 'port-' + crypto.randomUUID()`, `dbName = `portfolio_app_state_v1-${id}``.
  - `deletePortfolio` removes the registry row then calls `indexedDB.deleteDatabase(portfolio.dbName)` — irreversible, local-only, never touches Drive.
  - `migrateLegacyDbIfNeeded()`: if registry is empty AND legacy db `portfolio_app_state_v1` exists (checked via `indexedDB.databases()`; unsupported → assume absent), seeds one row `{name: 'My Portfolio', dbName: 'portfolio_app_state_v1'}`. Idempotent (`if (portfolios.length > 0) return`).
  - `isMigratedPortfolio(portfolio)`: `true` iff `portfolio.dbName === 'portfolio_app_state_v1'` — drives the Drive `projectId`/folder-path special case in `drive.ts`.
- **`src/lib/router.ts`**: `Route = { name: 'picker' } | { name: 'portfolio', portfolioId: string }`. `parseHash(hash)` maps `#/portfolio/<id>` → the portfolio route, everything else (`''`, `'#/'`, `'#/portfolio/'`) → picker. `navigateToPicker()` sets `location.hash = '#/'`; `navigateToPortfolio(id)` sets `#/portfolio/<encodeURIComponent(id)>`.
- **`src/hooks/useHashRoute.ts`**: `useHashRoute()` returns the current `Route`, re-parsed on `window` `hashchange`.

## Persistence (`src/lib/persist.ts`)

- Parameterized by `dbName`; no hardcoded db name in the active read/write path.
- `dbHandles: Map<string, Promise<IDBDatabase>>` caches one open connection per `dbName`.
- `activePortfolioDbName` module-level stash, set via `setActivePortfolioDb(dbName)` (also evicts any cached handle for that name, forcing a fresh open in case a prior open raced a delete).
- `loadPersistedApp`, `savePersistedApp`, `clearPersistedApp` call `openDb(requireActiveDbName())` — throw if `setActivePortfolioDb` was never called.
- `peekEnvelopeShape`, `peekStoredSalt`, `loadLegacyPlaintextApp` are **legacy-migration-path-only**: they always hardcode `indexedDB.open('portfolio_app_state_v1')` regardless of the active-db stash — used solely to detect pre-multi-portfolio data for one-time migration, never as general per-portfolio boot checks.
- `coalesceWithDefaults(loaded)`: fills missing collections/fields from `initialState()` — every load path (local unlock, Drive restore) runs through this.

## Drive Sync (`src/lib/drive.ts`)

- Portfolio-scoped: every sync/restore/status function takes `portfolio: Portfolio` as its first argument (`syncBackup`, `getBackupFileId`, `getBackupFileStatus`, `restoreBackupFromFileId`, `overwriteLocalWithRemote`, `overwriteRemoteWithLocal`, `getConnectionSnapshot`, `migrateLegacyDriveFolderIfNeeded`).
- `driveProjectIdFor(portfolio)`: returns `'app'` for the migrated legacy portfolio (preserves its pre-upgrade Drive connection without forcing re-auth), else `portfolio.id`.
- `getDriveAuthFor(portfolio)`: returns a cached `DriveAuthHandle` from `driveAuthCache: Map<string, DriveAuthHandle>`, keyed by `driveProjectIdFor(portfolio)` — same portfolio always yields the same handle; distinct non-migrated portfolios get distinct, independently-authenticated handles. Built via `@open-webapp/drive-connect`'s `createDriveAuth({ drive, projectId, tokenBufferMs })`.
- `driveSyncForPortfolio(portfolio)`: builds a fresh `createDriveSync({..., folderPath: ['OpenWebApp', 'Portfolio', portfolio.name]})` per call — folder path always reflects the portfolio's *current* name; renaming targets a new folder on next sync, old-named folder left untouched.
- `migrateLegacyDriveFolderIfNeeded(portfolio)`: one-time, lazy, idempotent move of the legacy flat-root backup file (`OpenWebApp/Portfolio/portfolio-state.json`) into the migrated portfolio's own named subfolder. No-op for non-migrated portfolios, and once the flat file is gone. Never prompts for auth (skips if no connection / `needsReauth`).
- A `legacyDriveSync` fixed facade + `drive` compatibility wrapper remain for `DriveRestorePanel`'s file-picker flow (not yet migrated to per-portfolio scoping — separate follow-up).

## Component Tree

```
App.tsx
├─ route.name === 'picker' → PortfolioPicker
│    (portfolios, onCreate, onRename, onDelete, onOpen=navigateToPortfolio)
└─ route.name === 'portfolio' → resolves Portfolio (from loaded list, or getPortfolio() fallback;
   unknown id → navigateToPicker()) → activatePortfolio() → setActivePortfolioDb + setActivePortfolio
   ├─ not yet resolved / gate shape unknown → "Loading..." placeholder
   ├─ sessionKey === null → PasswordGate (shape, driveAuth=getDriveAuthFor(activePortfolio), activePortfolio, onUnlock, onReset, Drive props)
   │    ├─ shape === 'encrypted' → EnterPasswordScreen
   │    └─ else → SetPasswordScreen (first-run / legacy-plaintext migration, Drive connect widget, restore panels)
   └─ unlocked + hydrated → app shell
        ├─ Nav (view tabs: Positions/Register/Quotes; sync button; onSwitchPortfolio=navigateToPicker; settings button)
        ├─ state.view === 'accounts'  → AccountsPage
        ├─ state.view === 'register'  → RegisterPage
        ├─ state.view === 'quotes'    → QuotesPage
        ├─ state.view === 'settings'  → SettingsPage (activePortfolio, driveAuth=getDriveAuthFor(activePortfolio), sessionKey/salt, sync/price-sync props)
        └─ syncConflict → SyncConflictDialog (overlay)
```

`ImportDialog` (under `components/import/`) is invoked from `AccountsPage`/`Settings` for CSV import, independent of the routing branch above.

## Data Model

Full type definitions, field reference, and domain invariants (natural keys, replace-on-reimport rules, dedup keys, computed-field rules): see `src/lib/types.ts` (types) and root `CLAUDE.md`'s Architecture section (invariants). Not duplicated here.
