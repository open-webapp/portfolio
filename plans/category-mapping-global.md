# Category/CategoryMapping: move to a global, cross-portfolio store with Drive sync

Reference docs to update at the end (repo root, per CLAUDE.md — not colocated): `design.md`, `schema-spec.md`, `product-behavior.md`.

Caveman rules: tasks ≤30min, explicit `T#` deps, exact file paths, test cases (happy+edge+error) per task, measurable acceptance criteria. Commit ONLY after `npm run test` passes and reference docs are updated. First task creates an isolated git worktree; last task merges to local `main` and tears the worktree down. NEVER push to remote.

## Facts checked (current shipped state — `budget-category-mapping` plan already landed)

- `src/lib/types.ts:107-117` — `Category { id, name }`, `CategoryMapping { id, substring, categoryId, updatedAt }`. No `updatedAt` on `Category`, no `deletedAt` on either.
- `src/lib/state.ts:36-39` — `AppState.categories: Category[]` / `AppState.categoryMappings: CategoryMapping[]`, both `[]` in `initialState()` (line ~88-89).
- `src/lib/state.ts:644-720` — helpers living on `AppState`, all to be moved out: `addCategory(state,id,name)`, `renameCategory(state,id,name)`, `upsertCategoryMapping(state,description,categoryId)`, `updateCategoryMapping(state,id,patch)`, `addCategoryMapping(state,categoryId,substring)`, `resolveCategoryIdForDescription(mappings,description)` (already takes `mappings` as a plain param, not `state` — no signature change needed, just relocation), `reapplyCategoryMappings(state)` (reads `state.categoryMappings`, rewrites `state.budgetTransactions`).
- `src/lib/state.ts:607-631` — `importBudgetTransactions(state, rows)`: rows are `{date,description,amount,accountName?}`, resolves `categoryId` internally via `state.categories`/`state.categoryMappings` (falls back to "Other"), then dedups on `date|description|categoryId|amount|accountName` against `state.budgetTransactions`. Only production caller: `BudgetPage.tsx:339,351` via `dispatch({type:'IMPORT_BUDGET_TRANSACTIONS', rows})`.
- `src/lib/state.ts:535-554` (`replaceImportedState`) reads `data.categories`/`data.categoryMappings` off `ExportableState`.
- `src/lib/reducer.ts:5` imports `CategoryMapping` type; `:51-56` action types `ADD_CATEGORY{id,name}` / `RENAME_CATEGORY{id,name}` / `UPSERT_CATEGORY_MAPPING{description,categoryId}` / `UPDATE_CATEGORY_MAPPING{id,patch}` / `ADD_CATEGORY_MAPPING{categoryId,substring}` / `REAPPLY_CATEGORY_MAPPINGS{}`; `:49` `IMPORT_BUDGET_TRANSACTIONS{rows}`; cases at `:203-222` delegate 1:1 to the `state.ts` helpers above.
- `src/lib/persist.ts:1-53` — `migrateCategoriesIfNeeded(loaded)`: pre-migration blobs (no `categories` key) derive `Category[]` from distinct legacy `category` strings on `budgetExpenses`/`budgetTransactions`, auto-vivify "Other", rewrite rows' `category`→`categoryId`. Called from `coalesceWithDefaults` (~line 115), output feeds `categories`/`categoryMappings` (~184-185) onto the returned `AppState`. This whole migration is now **superseded** by the new one-time cross-portfolio migration (this plan's T9) — `coalesceWithDefaults` must stop emitting `categories`/`categoryMappings` on `AppState` at all once this plan ships, but the RAW loaded blob (pre-coalesce) is still where an un-migrated portfolio's legacy `categories`/`categoryMappings`/bare `category` strings live, and the new migration needs to read that raw blob, not the coalesced `AppState`.
- `src/lib/persist.ts:61-` — per-portfolio IDB: `setActivePortfolioDb(dbName)`, `openDb(dbName)`, `loadPersistedApp(key: CryptoKey): Promise<AppState|null>` (decrypts, then `coalesceWithDefaults`), `savePersistedApp(state,key,salt)`. All scoped to whichever portfolio is "active" via a module-level `activePortfolioDbName`. **AppState is encrypted per portfolio** — a portfolio's data cannot be read without that portfolio's own session password. This is why the global-store seed step (T7) can't run eagerly at boot — there's no plaintext available until some portfolio is unlocked; it runs opportunistically, checked once per portfolio hydrate, the moment any portfolio is unlocked in a real session (see Decision D-MIG).
- `src/lib/portfolioRegistry.ts` — `Portfolio { id, name, dbName, createdAt }`, own IDB `portfolio-registry`/`portfolios` store. `listPortfolios()`, `getPortfolio(id)`, `isMigratedPortfolio(p)` (true for the one pre-multi-portfolio db, `dbName === 'portfolio_app_state_v1'`).
- `src/lib/drive.ts` — per-portfolio encrypted sync lives here (`syncBackup`, `getBackupFileId`, `getBackupFileStatus`, `restoreBackupFromFileId`, `overwriteLocalWithRemote`, `overwriteRemoteWithLocal`, all take `(portfolio, ...)` first). Root-level (non-portfolio-scoped) machinery already exists: `legacyDriveSync = createDriveSync({appId:'portfolio', clientId:..., folderPath:['OpenWebApp','Portfolio']})` (line 53-57); `listPortfolioFoldersOnDrive()` (line 110) does `legacyDriveSync.project('picker').ensureFolderPath()` → gets the `OpenWebApp/Portfolio` folderId → `files.list({folderId, mimeType:'application/vnd.google-apps.folder'})`. This plan's new Drive file (`category-mappings.json`) reuses `legacyDriveSync` with its own project id (e.g. `'category-mappings'`) the same way `'picker'` does — `ensureFolderPath()` for the shared root folderId, then `files.list({folderId, nameEquals:'category-mappings.json'})` / `files.create` / `files.update` / `files.get` (for `modifiedTime`), NOT `driveSyncForPortfolio` (per-portfolio subfolder scoping).
- `src/lib/drive.ts:232-249` `getDriveAuthFor(portfolio)` — cached `DriveAuth` per project id, `.activate()`/`.ensureFresh()`/`.connect()`/`.disconnect()`. `src/App.tsx:83` — `const { connected } = useDriveConnection(getDriveAuthFor(activePortfolio ?? NO_ACTIVE_PORTFOLIO))` — this is the ONE Drive connection actually live in memory during a session (the active portfolio's). No other portfolio's Drive auth is instantiated/connected unless that portfolio becomes active. **Decision D-CONN** (below) uses this single `connected` flag as "a Drive connection is currently active" for the whole feature, rather than iterating every portfolio's own Drive auth.
- `src/App.tsx` — `useReducer(appReducer, initialState())` for per-portfolio `state`; `SYNC_RETRY_POLL_INTERVAL_MS = 60_000` (line 43), an existing `setInterval` effect pattern gated on `[sessionKey, isHydrated, ..., activePortfolio?.id]` (~line 424-435) — this plan's 60s category-mappings poll mirrors that shape but is gated only on the new hook being hydrated (NOT on `sessionKey`/`activePortfolio`, since the global store works with zero portfolios unlocked).
- `src/lib/importExport.ts` — `ExportableState` (line 27), `buildExportableState(state)` (56), `exportBackup(state,key,salt)` (87, encrypted), `downloadEnvelopeAsFile(envelope,filename)` (97, Blob-download for an `EncryptedEnvelope`), `decryptImportEnvelope(envelope,password)` (168). `state.ts:550` `replaceImportedState` reads `data.categories ?? []` / `data.categoryMappings ?? []`.
- `src/components/Settings.tsx` — `settingsSection: 'backup'|'encryption'|'priceSync'|'categories'` prop (also declared in `App.tsx`, same union, must stay in sync — no widening needed, just no longer reading `state.categories`/`state.categoryMappings`/dispatching to the main reducer for category actions). Backup card (`settingsSection==='backup'`, ~line 247-262): one `.card.blueprint.elev-sm` titled "Download" with one "Download Backup" button (`exportBackup`+`downloadEnvelopeAsFile`). Categories card (`settingsSection==='categories'`, ~line 420-540+): uses `referencedCategories(state)`, `mappingsForCategory(state.categoryMappings, category.id)`, dispatches `RENAME_CATEGORY`/`UPDATE_CATEGORY_MAPPING`/`ADD_CATEGORY_MAPPING` — all move to the new global dispatch.
- `src/lib/selectors.ts` — `referencedCategories(state: AppState): Category[]` (line 616, reads `state.categories`/`state.budgetExpenses`/`state.budgetTransactions`/`state.categoryMappings`), `mappingsForCategory(mappings, categoryId)` (627, already param-based, no change), `visibleExpenses(...)` (497, takes `categoriesById: Map<string,string>` already as a param — no change needed, caller just now sources it from the global store instead of `state.categories`), `categoryBreakdown(expenses, transactions, period, categories)` (572, already takes `categories: Category[]` as an explicit param — no change), `actualByCategory(transactions)` (531, no category dependency at all — no change).
- `src/components/BudgetPage.tsx` — every category read/write touches `state.categories`/`state.categoryMappings`/`dispatch`: lines 3 (`resolveCategoryIdForDescription` import), 33 (`ADD_CATEGORY` dispatch), 105-107/125 (`categories`/`categoriesById`/`formCategoryId`/`recCategoryId` init from `state.categories`), 179 (`categoryBreakdown` call), 315 (`UPSERT_CATEGORY_MAPPING` dispatch), 339/351 (`IMPORT_BUDGET_TRANSACTIONS` dispatch), 764 (live-prefill `resolveCategoryIdForDescription` call against `state.categoryMappings`), 832/896/915/951 (more `state.categories` reads). All become reads of a new `categories`/`categoryMappings` prop and a new `categoryDispatch` prop instead of `state`/`dispatch`.
- No `plans/_template.md` exists in this repo (confirmed again this pass) — this plan follows the house style already established by `plans/budget-category-mapping.md` and `plans/drive-sync-conflict-reconcile.md`.
- `uid(prefix)` (`src/lib/seed.ts`) — existing prefixes include `category`, `catmap`; no new prefix needed.

## Decisions locked (resolved by the user — do not re-litigate)

1. Brand-new IndexedDB, separate from every per-portfolio db, opened once at startup, independent of active portfolio.
2. No encryption anywhere in this feature (local db, Drive file, manual export/import JSON) — plaintext throughout.
3. Remove `categories`/`categoryMappings` from `AppState` (`state.ts`) and their reducer cases (`reducer.ts`). New standalone hook `useGlobalCategories` in `App.tsx`, own load/save effects, independent of the per-portfolio reducer/debounce/`persist.ts` flow. Components needing categories take them via new props (no context needed — only 2 consumers, `BudgetPage`/`Settings`, both already prop-drilled from `App.tsx`).
4. `Category` gains `updatedAt: string` (ISO). Both `Category` and `CategoryMapping` gain `deletedAt?: string` (ISO) tombstone. Delete = set `deletedAt`, never remove. No delete UI is added in this plan (none existed before) — the tombstone fields exist for the merge algorithm and future use; UI-visible lists filter out `deletedAt`-set records via new `visibleCategories`/`visibleMappings` helpers (`categoryStore.ts`).
5. Drive file `category-mappings.json` at Drive root `OpenWebApp/Portfolio/` (sibling to per-portfolio subfolders), via `legacyDriveSync.project('category-mappings')` (own project id, does not collide with `'picker'`/`'app'`/any portfolio id). Content: `{ categories: Category[], categoryMappings: CategoryMapping[] }`, unencrypted.
6. Sync: auto-push on every local edit (add/rename/delete category, add/update/delete mapping) when a Drive connection is currently active; auto-pull once per app load when a connection resolves; 60s poll checks `files.get` `modifiedTime` only, full pull+merge only if newer than last-known; fully local/offline when never connected.
7. Merge: per-record last-write-wins by `id`, union of both sides, compare `updatedAt` (a `deletedAt` timestamp counts as that record's effective "last write" time for comparison — i.e. compare `deletedAt ?? updatedAt` on each side... **clarify below, D-MERGE**), used identically for initial pull, poll pull, and manual JSON import.
8. Migration: **no cross-portfolio merge/dedupe at all.** The very first portfolio unlocked after this ships seeds the global store: copy that portfolio's existing `categories`/`categoryMappings` into the new global store as-is (same ids, same content — no name-based deduping, no conflict resolution needed since there's only one source). That portfolio's own `BudgetTransaction.categoryId`/`CategoryMapping.categoryId` references keep working unchanged since ids are preserved. Every other portfolio does NOT get merged in when it's later unlocked — its old per-portfolio `categories`/`categoryMappings` are simply left behind/ignored (still physically present in that portfolio's old AppState/DB history, but no longer read once this ships and `categories`/`categoryMappings` are stripped from `AppState` per requirement 9). That portfolio's existing `BudgetTransaction.categoryId` values won't resolve to anything in the global store, so those transactions display as uncategorized ("Other"/blank) until the user manually recreates matching categories and re-categorizes (no automated remap tool needed — out of scope). Idempotent via a single `seeded: boolean` marker stored in the new global db's `meta` store (not a per-portfolio list — there's only ever one seed event).
9. `AppState`/`exportBackup`/`ExportableState` no longer include `categories`/`categoryMappings` going forward. An old backup file/db predating this feature is handled ONLY by the migration path, not by ongoing coalesce defaults.
10. Settings → Backup card: add "Download Category Mapping" button (unencrypted JSON) + a file-picker import control (merges via the same merge algorithm, not replace). Renders once the global store has hydrated.
11. Budget CSV/OFX import + reapply flows take global mappings as an explicit parameter instead of reading `state.categoryMappings`.

## Additional decisions (not explicitly resolved — picked here, noted, not re-opened)

- **D-MIG (seed trigger)**: the global store can't be pre-seeded at app boot because a portfolio's `AppState` is encrypted with that portfolio's own session password (`persist.ts`'s `loadPersistedApp(key: CryptoKey)`) — there's no plaintext available before some portfolio is unlocked. Seeding instead runs **once, the first time ANY portfolio is hydrated in a real session after this ships** (inside `App.tsx`'s existing post-`sessionKey` hydrate effect, right after `loadPersistedApp`/raw-blob read resolves): if the global store's `meta`/`'migration'` marker (`{seeded: boolean}`) is not yet `true`, copy that portfolio's `categories`/`categoryMappings` straight off the **raw pre-coalesce loaded blob** (as-is, same ids — no dedupe, no remap) into the global store, then set `seeded: true`. Every subsequent portfolio hydrate (this session or any future session) checks the marker, finds it `true`, and does nothing — a single boolean replaces the old idea of a per-portfolio migrated-ids list, since there's only one seed event, not N per-portfolio migrations. **Which portfolio ends up seeding the store** = whichever one the user happens to unlock first after upgrading — not user-controllable, called out in `product-behavior.md` (T19).
- **D-CONN (Drive-connected check)**: "a Drive connection is currently active" = the existing `connected` boolean from `useDriveConnection(getDriveAuthFor(activePortfolio))` in `App.tsx` (the only Drive auth actually live in memory this session) — not an iteration over every portfolio's own Drive connection.
- **D-MERGE (tombstone comparison)**: each record's comparable timestamp is `deletedAt ?? updatedAt` (a delete always carries a fresh `deletedAt` that is `>=` its own `updatedAt`, so this is equivalent to "compare whichever of the two timestamps was set most recently"). Winner = the side whose record has the larger `deletedAt ?? updatedAt`; ties keep the local/`a`-side record (deterministic, arbitrary-but-stable tie-break, matches this codebase's existing "latest-updatedAt wins, no documented tie-break needed elsewhere" convention).
- **DB name**: `ledger_global_categories_v1`, two object stores: `state` (single doc, key `'current'`, value `{categories, categoryMappings}`) and `meta` (docs keyed `'migration'` → `{seeded: boolean}`, `'driveSync'` → `{lastKnownRemoteModifiedTime?: string}`).
- **Module layout** (new files, all under `src/lib/` except the hook):
  - `src/lib/categoryStore.ts` — types + all pure CRUD/resolve/reapply helpers (moved off `state.ts`), operating on `GlobalCategoryState = { categories: Category[]; categoryMappings: CategoryMapping[] }`.
  - `src/lib/categoryMerge.ts` — `mergeCategoryState(a, b): GlobalCategoryState`.
  - `src/lib/categoryPersist.ts` — the new IDB (open/load/save + migration-marker + drive-sync bookkeeping reads/writes).
  - `src/lib/categoryDrive.ts` — Drive read/write/status for `category-mappings.json`, built on `legacyDriveSync` from `drive.ts` (export `legacyDriveSync` — currently unexported module-local const — for this file to import; no behavior change to `drive.ts` itself beyond adding one export).
  - `src/lib/categoryMigration.ts` — the one-time global-store seed from the first-unlocked portfolio (pure compute function + a thin IO orchestrator).
  - `src/hooks/useGlobalCategories.ts` — the App-level hook: `useReducer` + hydrate/save/push/poll/pull effects, exposes `{ categories, categoryMappings, dispatch, hydrated, seedGlobalCategoriesIfNeeded }`.
- **Reducer-shape for the global store**: its own local action union (NOT `AppAction`) — `ADD_CATEGORY{id,name}`, `RENAME_CATEGORY{id,name}`, `DELETE_CATEGORY{id}`, `UPSERT_CATEGORY_MAPPING{description,categoryId}`, `UPDATE_CATEGORY_MAPPING{id,patch}`, `ADD_CATEGORY_MAPPING{categoryId,substring}`, `DELETE_CATEGORY_MAPPING{id}`. Every mutating action stamps `updatedAt: new Date().toISOString()` on the touched record — this is also the trigger for the "auto-push on any local edit" effect (a `useEffect` on `[categories, categoryMappings]` skips the very first run via a ref, matching the debounce-save pattern already used for `savePersistedApp` in `App.tsx`).
- **`AppAction` cases that survive** (payload changed per requirement 11): `IMPORT_BUDGET_TRANSACTIONS { rows: {date,description,amount,accountName?}[]; categories: Category[]; categoryMappings: CategoryMapping[] }`, `REAPPLY_CATEGORY_MAPPINGS { categoryMappings: CategoryMapping[] }` — both dispatched by `BudgetPage.tsx`/`Settings.tsx` with the global store's current `categories`/`categoryMappings` passed in at call time.

## What NOT to do

- No delete button/icon in any UI for `Category`/`CategoryMapping` (unchanged from before — tombstone fields are schema/merge-only in this plan).
- No cross-portfolio dedupe/merge/remap logic of any kind — only the first portfolio unlocked after upgrade seeds the global store (see D-MIG); every other portfolio's old categories/mappings are left behind, never merged in.
- No React context — plain prop-drilling from `App.tsx` (matches existing `state`/`dispatch` prop-drilling pattern to `BudgetPage`/`SettingsPage`).
- No encryption anywhere in this feature's new code paths.
- No changes to per-portfolio Drive sync (`syncBackup`, `overwriteLocalWithRemote`, etc.) beyond exporting `legacyDriveSync` from `drive.ts`.

## Tasks

### T0 — Create worktree
Deps: none.
```
git worktree add ../worktree-category-mapping-global -b category-mapping-global/main
cd ../worktree-category-mapping-global
npm install
```
Test: `npm run test` green baseline in the new worktree.
Acceptance: worktree + branch exist; baseline tests green. All later tasks run here.

### T1 — Types: `updatedAt`/`deletedAt`
Deps: T0. File: `src/lib/types.ts`.
- `Category`: add `updatedAt: string`.
- `Category`/`CategoryMapping`: add `deletedAt?: string`.
Test: none (type-only). Acceptance: `grep -n "deletedAt" src/lib/types.ts` shows both interfaces; `Category` has `updatedAt`.

### T2 — `src/lib/categoryStore.ts`: pure CRUD/resolve/reapply helpers
Deps: T1.
- `export interface GlobalCategoryState { categories: Category[]; categoryMappings: CategoryMapping[] }`
- `export function initialGlobalCategoryState(): GlobalCategoryState` → `{categories:[],categoryMappings:[]}`.
- `addCategory(s, id, name)`, `renameCategory(s, id, name)` (stamps `updatedAt`), `deleteCategory(s, id)` (stamps `deletedAt`+`updatedAt`, no-op if unknown id).
- `upsertCategoryMapping(s, description, categoryId)`, `updateCategoryMapping(s, id, patch)`, `addCategoryMapping(s, categoryId, substring)`, `deleteCategoryMapping(s, id)` — same shapes as the retiring `state.ts` versions but operating on `GlobalCategoryState`, and `upsertCategoryMapping`/dedup-by-substring lookups skip tombstoned (`deletedAt` set) mappings.
- `resolveCategoryIdForDescription(mappings, description)` — moved verbatim from `state.ts`, PLUS filter out `m.deletedAt` mappings before matching.
- `visibleCategories(s): Category[]` / `visibleMappings(s): CategoryMapping[]` — filter out `deletedAt`-set records (used by every UI list).
- `reapplyMappingsToTransactions(transactions: BudgetTransaction[], mappings: CategoryMapping[]): BudgetTransaction[]` — pure extraction of the old `reapplyCategoryMappings` body (rewrite `categoryId` per `resolveCategoryIdForDescription`, mappings pre-filtered for tombstones by the caller/this fn).
- Local reducer: `export type CategoryAction = ...` (per "Reducer-shape" decision) + `export function categoryStoreReducer(s: GlobalCategoryState, a: CategoryAction): GlobalCategoryState` dispatching to the helpers above.
Test cases (`src/lib/categoryStore.test.ts`, new file):
- `addCategory`/`renameCategory`/`deleteCategory`: append, patch-by-id no-op-if-unknown, tombstone sets both `deletedAt`+`updatedAt`.
- `upsertCategoryMapping`: case-insensitive dedup update vs new-create; blank description no-op; a tombstoned mapping with the same substring does NOT block creating a fresh (non-tombstoned) one — dedup lookup ignores tombstoned rows.
- `resolveCategoryIdForDescription`: unaffected match/no-match/latest-wins cases (ported from old `state.test.ts` coverage) PLUS a new case — a matching mapping that's tombstoned is ignored even if it would otherwise win on `updatedAt`.
- `visibleCategories`/`visibleMappings`: filter out tombstoned records, keep the rest, order preserved.
- `reapplyMappingsToTransactions`: matching description rewrites `categoryId`; non-matching left untouched; idempotent on repeat call.
- `categoryStoreReducer`: one dispatch test per action type, asserting output shape.
Acceptance: all helpers exported and typed; `npx vitest run src/lib/categoryStore.test.ts` green; `grep -n "export function" src/lib/categoryStore.ts` shows all listed exports.

### T3 — `src/lib/categoryMerge.ts`: merge algorithm
Deps: T2.
- `export function mergeCategoryState(a: GlobalCategoryState, b: GlobalCategoryState): GlobalCategoryState` — for `categories` and `categoryMappings` independently: union by `id`; for an id present on both sides, keep whichever has the larger `deletedAt ?? updatedAt` (ties keep `a`'s copy, per D-MERGE); ids present on only one side pass through unchanged.
Test cases (`src/lib/categoryMerge.test.ts`, new file):
- Same id, `a` newer `updatedAt` → `a`'s copy wins (name/fields from `a`).
- Same id, `b` newer → `b`'s copy wins.
- Same id, `a` has `deletedAt` newer than `b`'s bare `updatedAt` → tombstoned version wins (record present in merged output WITH `deletedAt` set — never silently dropped).
- Same id, equal `updatedAt` on both, no `deletedAt` → `a`'s copy wins (tie-break).
- id only on `a`, id only on `b` → both included, untouched.
- Empty-vs-nonempty on either side → nonempty side's records all survive.
- Applied to both `categories` and `categoryMappings` in one call (fixture exercising both collections at once).
Acceptance: pure function, no IO; `npx vitest run src/lib/categoryMerge.test.ts` green.

### T4 — `src/lib/categoryPersist.ts`: global IDB (load/save + migration marker)
Deps: T2.
- `openCategoryDb(): Promise<IDBDatabase>` — module-level cached promise, `indexedDB.open('ledger_global_categories_v1', 1)`, `onupgradeneeded` creates `state` + `meta` object stores (both `keyPath` implicit — use `put(value, key)` explicit-key form, matching `persist.ts`'s pattern).
- `loadGlobalCategoryState(): Promise<GlobalCategoryState>` — reads `state`/`'current'`; returns `initialGlobalCategoryState()` if absent.
- `saveGlobalCategoryState(s: GlobalCategoryState): Promise<void>` — `put(s, 'current')`.
- `isGlobalStoreSeeded(): Promise<boolean>` / `markGlobalStoreSeeded(): Promise<void>` — read/write `meta`/`'migration'` (`{seeded: boolean}`, default `false`).
- `getLastKnownRemoteModifiedTime(): Promise<string|undefined>` / `setLastKnownRemoteModifiedTime(iso: string): Promise<void>` — `meta`/`'driveSync'` (`{lastKnownRemoteModifiedTime?: string}`).
- `_resetCategoryDbForTests(): void` — mirrors `portfolioRegistry.ts`'s `_resetRegistryForTests` pattern (nulls the cached db promise + deletes the db in test setup) so tests get a clean db per run.
Test cases (`src/lib/categoryPersist.test.ts`, new file, using `fake-indexeddb` if already a devDependency — check `package.json`; if absent, use the same manual IDB test approach `persist.test.ts` already uses):
- `loadGlobalCategoryState` on a fresh db returns `initialGlobalCategoryState()`.
- `saveGlobalCategoryState` then `loadGlobalCategoryState` round-trips exactly.
- `isGlobalStoreSeeded` starts `false`; `markGlobalStoreSeeded()` flips it to `true`; calling it a second time is a no-op (still `true`).
- `getLastKnownRemoteModifiedTime` starts `undefined`; round-trips after `setLastKnownRemoteModifiedTime`.
- Independent of any `setActivePortfolioDb` call — a test that never touches `persist.ts` still exercises this module cleanly (proves DB independence from the per-portfolio db machinery).
Acceptance: `npx vitest run src/lib/categoryPersist.test.ts` green; `grep -n "portfolio_app_state_v1\|setActivePortfolioDb" src/lib/categoryPersist.ts` returns nothing (proves total isolation from per-portfolio persistence).

### T5 — `src/lib/drive.ts`: export `legacyDriveSync`
Deps: T0 (independent of T1-T4).
- Change `const legacyDriveSync = createDriveSync(...)` (line 53) to `export const legacyDriveSync = ...`. No other change.
Test: existing `src/lib/drive.test.ts` still green (no behavior change, pure export addition).
Acceptance: `grep -n "export const legacyDriveSync" src/lib/drive.ts` present; `npx vitest run src/lib/drive.test.ts` green.

### T6 — `src/lib/categoryDrive.ts`: Drive read/write/status for `category-mappings.json`
Deps: T2, T5.
- `const PROJECT_ID = 'category-mappings'`, `const FILENAME = 'category-mappings.json'`.
- `export async function pullGlobalCategoriesFromDrive(driveAuth: ReturnType<typeof getDriveAuthFor>): Promise<GlobalCategoryState | null>` — `driveAuth.ensureFresh()` → `legacyDriveSync.project(PROJECT_ID)` → `ensureFolderPath()` → `files.list({folderId, nameEquals: FILENAME})` → if none, return `null`; else `files.read(fileId)` → `JSON.parse` → shape-check (`Array.isArray(categories)`/`categoryMappings`) → return, or `null` on malformed content (never throw for malformed — mirrors `decryptDriveFolderBackup`'s "swallow malformed, don't hard-fail" convention already in `drive.ts`).
- `export async function pushGlobalCategoriesToDrive(driveAuth, state: GlobalCategoryState): Promise<void>` — `ensureFresh()` → `project.ensureFolderPath()` → `files.list({folderId, nameEquals: FILENAME})` → `files.write({fileId: existing?.id, folderId, name: FILENAME, content: JSON.stringify(state), mimeType: 'application/json'})`.
- `export async function getGlobalCategoriesModifiedTime(driveAuth): Promise<string | null>` — same list-by-name, if found `files.get`/`files.status`-style metadata call to read `modifiedTime` (use whatever drive-sync's `project.files` exposes for metadata-only — confirm exact method name against `node_modules/@open-webapp/drive-sync` types at execution time, matching how `getBackupFileStatus` in `drive.ts:527` already does this for the per-portfolio file — mirror that exact call shape); return `null` if the file doesn't exist yet.
Test cases (`src/lib/categoryDrive.test.ts`, new file, hand-faked `project.files` per the `drive-sync-conflict-reconcile` plan's T1 harness pattern):
- `pullGlobalCategoriesFromDrive`: no file yet → `null`; valid JSON → parsed `GlobalCategoryState`; malformed JSON / wrong shape → `null` (not thrown).
- `pushGlobalCategoriesToDrive`: no existing file → `files.write` called with no `fileId` (create path); existing file → `files.write` called with that `fileId` (update path).
- `getGlobalCategoriesModifiedTime`: file absent → `null`; file present → returns the string given by the fake metadata call.
- `ensureFresh()`/auth failure propagates uncaught from all three (no swallow of connection errors — only content-shape errors are swallowed).
Acceptance: 3 functions exported+typed; `npx vitest run src/lib/categoryDrive.test.ts` green.

### T7 — `src/lib/categoryMigration.ts`: seed-from-first-unlocked-portfolio + IO orchestrator
Deps: T2, T4.
- `export function computeSeedFromPortfolio(rawBlob: Record<string, unknown>): GlobalCategoryState | null` — pure. Returns `null` if `rawBlob.categories` is not a `Category[]`-shaped array (nothing to seed with — e.g. a portfolio created after this shipped, which never had the field, or a legacy pre-category-feature blob). Otherwise returns `{ categories: rawBlob.categories as Category[], categoryMappings: (rawBlob.categoryMappings as CategoryMapping[]) ?? [] }` **verbatim** — no dedupe, no id remap, no name/substring comparison, no merge with anything already in the global store (there's nothing else in the store yet, by construction — this only ever runs pre-seed).
- `export async function seedGlobalCategoriesIfNeeded(portfolio: Portfolio, rawBlob: Record<string, unknown>): Promise<void>` — orchestrator: `if (await isGlobalStoreSeeded()) return` → `computeSeedFromPortfolio(rawBlob)` → if `null`, `markGlobalStoreSeeded()` and return (this portfolio had nothing to seed with, but the seed opportunity is one-shot — see the flagged risk below) → `saveGlobalCategoryState(seed)` → `markGlobalStoreSeeded()`. No `patchAndSavePortfolio`-style callback needed anymore: since ids are preserved verbatim, there is nothing to rewrite on that portfolio's `Expense[]`/`BudgetTransaction[]`.
Test cases (`src/lib/categoryMigration.test.ts`, new file):
- Fresh (unseeded) global store, portfolio's raw blob has `categories: [...]`/`categoryMappings: [...]` → global store ends up holding those exact records, byte-for-byte (same ids, same fields) — no transformation of any kind.
- `seedGlobalCategoriesIfNeeded` idempotency: calling it a second time (same portfolio or a different one) after the marker is set → `saveGlobalCategoryState` is NOT called again; global store contents unchanged.
- A portfolio unlocked AFTER the store is already seeded (by an earlier portfolio) → its own `categories`/`categoryMappings` are never read into the global store, even though its raw blob still has them — the global store keeps only the first portfolio's data.
- `computeSeedFromPortfolio` on a raw blob with no `categories` key at all → returns `null`.
- `seedGlobalCategoriesIfNeeded` on the very first unlocked portfolio when its raw blob has no `categories` key → still marks the store seeded (empty), no global-store writes; a later portfolio with real categories is confirmed NOT to be pulled in afterward (ties to the "arbitrary/unlucky first portfolio" risk noted below).
Acceptance: `computeSeedFromPortfolio` has zero IO (no `await`, no imports from `categoryPersist.ts`); `grep -n "dedupe\|remap\|globalDelta\|expensePatch\|transactionPatch" src/lib/categoryMigration.ts` returns nothing (proves the old cross-portfolio dedupe/remap logic is gone); `npx vitest run src/lib/categoryMigration.test.ts` green.

### T8 — `src/hooks/useGlobalCategories.ts`
Deps: T2, T3, T4, T6, T7.
- `export function useGlobalCategories(driveAuth: ReturnType<typeof getDriveAuthFor> | null, driveConnected: boolean)`:
  - `useReducer(categoryStoreReducer, initialGlobalCategoryState())`.
  - `hydrated` state, `false` until the initial `loadGlobalCategoryState()` resolves (effect on mount, `[]` deps) — `dispatch({type:'__HYDRATE', state})`-style internal set (add a `'__HYDRATE'` case to `categoryStoreReducer`/`CategoryAction`, or a second local `useState` holding the full state instead of routing hydration through the reducer — pick the second: keep `useReducer` for user-driven edits only, seed its initial value lazily via `useReducer(categoryStoreReducer, undefined, () => initialGlobalCategoryState())` then a SEPARATE one-shot `useEffect` that calls `loadGlobalCategoryState()` and, if non-empty, does one `dispatch({type:'__REPLACE', state: loaded})` — add `'__REPLACE'` as a private action case that just returns the given state verbatim, used ONLY by this hook's own hydrate/pull/merge effects, never dispatched by a component).
  - Save effect: on every `[categories, categoryMappings]` change AFTER `hydrated` is true, debounce 500ms (matches `persist.ts`/App's own debounce constant — reuse the literal `500`, no shared constant needed for one usage), call `saveGlobalCategoryState`.
  - Push effect: on every `[categories, categoryMappings]` change after `hydrated`, if `driveConnected && driveAuth`, call `pushGlobalCategoriesToDrive(driveAuth, {categories,categoryMappings})` (no debounce — "immediately", per requirement 6; fire-and-forget with a `.catch(console.error)`, matching this codebase's existing Drive-error-swallow convention for background pushes) then `setLastKnownRemoteModifiedTime` isn't set here (only the push path knows its own new remote time if the write response returns one — if `files.write`'s return doesn't carry `modifiedTime`, skip updating the bookmark on push; only the pull/poll path updates it, which is fine — an extra poll cycle after a push either sees "not newer" and no-ops, or the write itself didn't bump the tracked time and the next poll harmlessly re-pulls-and-merges the same content, a no-op merge).
  - Initial-pull-once effect: `useEffect` gated on `[driveConnected, hydrated]`, guarded by a `didInitialPullRef` so it only ever runs once per app session the FIRST time `driveConnected` flips true post-hydrate: `pullGlobalCategoriesFromDrive` → if non-null, `mergeCategoryState(current, remote)` → `dispatch({type:'__REPLACE', state: merged})` → `saveGlobalCategoryState(merged)`.
  - 60s poll effect: `setInterval` gated on `hydrated` (NOT on `driveConnected` — check connection freshly each tick, matching the `SYNC_RETRY_POLL_INTERVAL_MS` pattern's own style of re-checking gating conditions inside the tick rather than only at effect-setup time): each tick, if not connected, no-op; else `getGlobalCategoriesModifiedTime` → compare to `getLastKnownRemoteModifiedTime()` → if newer (or no local bookmark yet), `pullGlobalCategoriesFromDrive` → merge → `dispatch({type:'__REPLACE',...})` → `saveGlobalCategoryState` → `setLastKnownRemoteModifiedTime(newModifiedTime)`.
  - `seedGlobalCategoriesIfNeeded` passthrough: expose a thin wrapper around `seedGlobalCategoriesIfNeeded` from `categoryMigration.ts` that also does a local `dispatch({type:'__REPLACE', state: seeded})` refresh after a successful seed (so the hook's in-memory state reflects the newly-seeded categories without waiting for a reload — a no-op dispatch when the store was already seeded) as part of the hook's return value, so `App.tsx` can call it after a portfolio hydrates.
  - Returns `{ categories: visibleCategories(state), categoryMappings: visibleMappings(state), dispatch, hydrated, seedGlobalCategoriesIfNeeded }` — components only ever see non-tombstoned records.
Test cases (`src/hooks/useGlobalCategories.test.ts`, new file, `@testing-library/react`'s `renderHook`, mocking `categoryPersist.ts`/`categoryDrive.ts`/`categoryMigration.ts`):
- Hydration: `loadGlobalCategoryState` mock resolves a fixture → hook's `categories`/`categoryMappings` reflect it once `hydrated` flips true; before that, both start empty.
- Dispatching `ADD_CATEGORY` after hydration triggers (after the debounce/fake-timers advance) exactly one `saveGlobalCategoryState` call with the new state.
- With `driveConnected=true`, the same dispatch also triggers `pushGlobalCategoriesToDrive` (no debounce — assert it fires before the save-debounce timer even elapses, i.e. synchronously-ish on the next microtask).
- With `driveConnected=false` throughout, NO `pushGlobalCategoriesToDrive` call ever happens, purely local read/write still works (offline-first requirement).
- Initial pull: `driveConnected` flips `false→true` post-hydrate, `pullGlobalCategoriesFromDrive` returns a fixture with a record newer than local → merged result reflected in hook state; flipping `driveConnected` a SECOND time does not re-trigger a second initial pull (ref-guarded, once per session).
- Poll: advance fake timers by 60s with `driveConnected=true` and `getGlobalCategoriesModifiedTime` returning a timestamp newer than the tracked bookmark → pull+merge happens; a second 60s tick with an UNCHANGED modifiedTime → no `pullGlobalCategoriesFromDrive` call (metadata-only check short-circuits).
- Tombstoned records: hydrating with a mix of tombstoned/live records → hook's returned `categories`/`categoryMappings` exclude the tombstoned ones (via `visibleCategories`/`visibleMappings`).
Acceptance: hook exported; all listed tests pass with fake timers (`vi.useFakeTimers()`); no test relies on a real 60-second wall-clock wait.

### T9 — `state.ts`: remove `categories`/`categoryMappings` from `AppState`, drop moved helpers, retarget `importBudgetTransactions`/`replaceImportedState`
Deps: T2 (helpers now live in `categoryStore.ts`).
- Remove `categories: Category[]` / `categoryMappings: CategoryMapping[]` from `AppState` interface and from `initialState()`.
- Delete `addCategory`, `renameCategory`, `upsertCategoryMapping`, `updateCategoryMapping`, `addCategoryMapping`, `resolveCategoryIdForDescription`, `reapplyCategoryMappings` from this file entirely (now live in `categoryStore.ts`, T2).
- `importBudgetTransactions(state, rows)` → `importBudgetTransactions(state, rows, categories: Category[], categoryMappings: CategoryMapping[])`: same body, but `state.categories`/`state.categoryMappings` reads become the new params.
- `replaceImportedState(state, data)`: drop the `categories: data.categories ?? []` / `categoryMappings: data.categoryMappings ?? []` lines (no longer AppState fields; `ExportableState` itself drops them in T14).
- Remove now-unused `Category`/`CategoryMapping` type imports if nothing else in this file references them (`importBudgetTransactions`'s new params still need them — keep the import, just for the param types, not for `AppState`).
Test cases (`src/lib/state.test.ts`): update `importBudgetTransactions` tests to pass `categories`/`categoryMappings` explicitly instead of via a fixture `AppState`; delete the retired helpers' test blocks (moved to `categoryStore.test.ts`, T2 — don't duplicate). Regression: existing dedup/fallback-to-"Other" behavior unchanged with the new explicit params.
Acceptance: `grep -n "categories\|categoryMappings" src/lib/state.ts` shows only `importBudgetTransactions`'s param usage (no `AppState` field, no other helper); `npx vitest run src/lib/state.test.ts` green (expect some cross-file red elsewhere until T13 sweep — acceptable intermediate state per this repo's own established convention).

### T10 — `reducer.ts`: drop category-CRUD cases, retarget `IMPORT_BUDGET_TRANSACTIONS`/`REAPPLY_CATEGORY_MAPPINGS`
Deps: T9.
- Remove `ADD_CATEGORY`/`RENAME_CATEGORY`/`UPSERT_CATEGORY_MAPPING`/`UPDATE_CATEGORY_MAPPING`/`ADD_CATEGORY_MAPPING` from `AppAction` union and their `case`s (lines ~51-56, ~209-222) — these no longer touch `AppState`.
- `IMPORT_BUDGET_TRANSACTIONS` action type → `{ type: 'IMPORT_BUDGET_TRANSACTIONS'; rows: {date:string;description:string;amount:number;accountName?:string}[]; categories: Category[]; categoryMappings: CategoryMapping[] }`; case → `StateActions.importBudgetTransactions(state, action.rows, action.categories, action.categoryMappings)`.
- `REAPPLY_CATEGORY_MAPPINGS` stays but payload becomes `{ type: 'REAPPLY_CATEGORY_MAPPINGS'; categoryMappings: CategoryMapping[] }`; case → needs a `state.ts`-level function taking `(state, categoryMappings)` — re-add a THIN wrapper in `state.ts` (not deleted in T9, since it now belongs to `budgetTransactions` mutation, not category CRUD): `export function reapplyCategoryMappingsToState(state: AppState, categoryMappings: CategoryMapping[]): AppState { return { ...state, budgetTransactions: reapplyMappingsToTransactions(state.budgetTransactions, categoryMappings) } }` (imports `reapplyMappingsToTransactions` from `categoryStore.ts` — this is the one deliberate cross-import between the per-portfolio and global-store modules, justified because rewriting `budgetTransactions` is inherently an `AppState` mutation). Add this function to `state.ts` as part of this task (amend T9 if executed strictly in order — sequencing note: do this addition here in T10, not T9, since T9 said "delete `reapplyCategoryMappings` entirely" — that deletion was of the OLD `state.ts`-owned-mappings version; this new wrapper has a different signature/purpose).
- Import `Category` type into `reducer.ts` alongside the existing `CategoryMapping` import (line 5).
Test cases (`src/lib/reducer.test.ts`): `IMPORT_BUDGET_TRANSACTIONS` dispatch test updated to pass `categories`/`categoryMappings` in the action; `REAPPLY_CATEGORY_MAPPINGS` dispatch test updated to pass `categoryMappings` in the action and assert `budgetTransactions` rewritten accordingly; delete the 5 retired action-type dispatch tests (moved to `categoryStore.test.ts` coverage of `categoryStoreReducer`, T2).
Acceptance: `grep -n "ADD_CATEGORY'\|RENAME_CATEGORY'\|UPSERT_CATEGORY_MAPPING'\|UPDATE_CATEGORY_MAPPING'\|ADD_CATEGORY_MAPPING'" src/lib/reducer.ts` returns nothing; `npx vitest run src/lib/reducer.test.ts` green.

### T11 — `persist.ts`: stop emitting `categories`/`categoryMappings` on `AppState`, expose raw-blob access for migration
Deps: T9.
- Delete the `migrateCategoriesIfNeeded` function and its call/output wiring inside `coalesceWithDefaults` (the `categories`/`categoryMappings` lines ~184-185) — `AppState` no longer has these fields, so nothing to assign.
- `coalesceWithDefaults` itself: since `Expense`/`BudgetTransaction` already carry `categoryId` (from the OLD migration, already shipped), a blob that predates even that (bare `category` string, from before `budget-category-mapping` ever landed) is now ONLY handled by the new cross-portfolio migration's own legacy-shape fallback (T7) — `coalesceWithDefaults` itself does NOT attempt any `category`→`categoryId` rewriting anymore; it just passes `budgetExpenses`/`budgetTransactions` through as-is (whatever shape they're in) — the new migration (T7/T13) is solely responsible for both the `category`→`categoryId` legacy rewrite AND the categories-to-global-store move, run together as one step, since a blob that old has never run any category migration before.
- Add `export async function loadRawPersistedBlob(key: CryptoKey): Promise<Partial<AppState> & Record<string, unknown> | null>` — factors the decrypt-only part out of `loadPersistedApp` (decrypt envelope → `JSON.parse` → return the raw parsed object BEFORE `coalesceWithDefaults` runs) so `App.tsx`'s migration-trigger effect (T13) can inspect `categories`/`categoryMappings`/bare-`category` fields that `coalesceWithDefaults` would otherwise have already stripped/defaulted away. `loadPersistedApp` itself becomes a thin wrapper: `const raw = await loadRawPersistedBlob(key); return raw ? coalesceWithDefaults(raw) : null`.
Test cases (`src/lib/persist.test.ts`):
- Delete the old `migrateCategoriesIfNeeded`-specific test block (superseded by `categoryMigration.test.ts`, T7).
- `coalesceWithDefaults` on a blob with old bare `category` strings (no `categoryId`) now passes those rows through UNCHANGED (no more silent rewrite) — new test asserting this is the current (correct, post-this-plan) behavior, replacing the deleted old-migration assertions.
- `loadRawPersistedBlob` returns the raw pre-coalesce object (including any stale `categories`/`categoryMappings` keys if present in the stored envelope); `loadPersistedApp` still round-trips end-to-end (decrypt → coalesce) same as before this task, now via the two-function split.
Acceptance: `grep -n "migrateCategoriesIfNeeded" src/lib/persist.ts` returns nothing; `npx vitest run src/lib/persist.test.ts` green.

### T12 — App.tsx: wire `useGlobalCategories` + per-portfolio migration trigger
Deps: T8, T11.
- `const globalCategories = useGlobalCategories(activePortfolio ? getDriveAuthFor(activePortfolio) : null, connected)` — called unconditionally (hook itself tolerates a `null` driveAuth by just staying local-only), placed near the other top-level hooks, independent of `sessionKey`/`activePortfolio` gating for its OWN hydrate/save/poll effects (only the push/pull effects care about `driveAuth`/`connected`, already handled inside the hook per T8).
- In the existing post-`sessionKey` hydrate effect (where `loadPersistedApp`/`coalesceWithDefaults` currently runs — locate via T11's `loadRawPersistedBlob` split), after obtaining the raw blob, call `globalCategories.seedGlobalCategoriesIfNeeded(activePortfolio, rawBlob)` — no patch callback needed (ids are preserved verbatim, so there is nothing to rewrite on `budgetExpenses`/`budgetTransactions`, and no extra `savePersistedApp` call for this step); fire this once per portfolio-hydrate (guard against re-running on every re-render the same way the existing hydrate effect is already gated, e.g. an `isHydrated` flip or a ref keyed on `activePortfolio.id`).
- Pass `categories={globalCategories.categories}`, `categoryMappings={globalCategories.categoryMappings}`, `categoryDispatch={globalCategories.dispatch}` as new props to `<BudgetPage>` and `<SettingsPage>`.
Test cases (`src/App.test.tsx`): extend existing mocks to include `./hooks/useGlobalCategories` (mock returning a controllable fixture) — assert `BudgetPage`/`SettingsPage` receive the 3 new props; assert `seedGlobalCategoriesIfNeeded` is called exactly once per portfolio activation (not on every re-render) with the raw blob — no patch-callback and no additional `savePersistedApp` call expected from this path.
Acceptance: `npx vitest run src/App.test.tsx` green; `grep -n "useGlobalCategories" src/App.tsx` shows the hook call + prop-passing.

### T13 — `BudgetPage.tsx`: switch to `categories`/`categoryMappings`/`categoryDispatch` props
Deps: T10, T12.
- New props: `categories: Category[]`, `categoryMappings: CategoryMapping[]`, `categoryDispatch: (action: CategoryAction) => void` (import `CategoryAction` type from `categoryStore.ts`).
- Every `state.categories`/`state.categoryMappings` read (lines 105-107, 125, 179, 764, 832, 896, 915, 951 per Facts-checked) → `categories`/`categoryMappings` prop.
- `ADD_CATEGORY` dispatch (line 33) → `categoryDispatch({type:'ADD_CATEGORY', id, name})`.
- `UPSERT_CATEGORY_MAPPING` dispatch (line 315) → `categoryDispatch({type:'UPSERT_CATEGORY_MAPPING', description, categoryId})`.
- `IMPORT_BUDGET_TRANSACTIONS` dispatches (lines 339, 351) → still `dispatch(...)` (main reducer — this action stays on `AppState`) but now include `categories`/`categoryMappings` from props: `dispatch({type:'IMPORT_BUDGET_TRANSACTIONS', rows: parsed, categories, categoryMappings})`.
- Any `REAPPLY_CATEGORY_MAPPINGS`-adjacent call — confirm none exists in `BudgetPage.tsx` (it's Settings-only per Facts-checked); no change needed here.
Test cases (`src/components/BudgetPage.test.tsx`): pass the 3 new props via fixtures in every existing render call (mechanical prop-threading fix); re-verify each of the T13-scope dispatch-shape tests from the ORIGINAL `budget-category-mapping` plan still pass with the new prop-sourced values (category select options come from the `categories` prop not `state.categories`; `ADD_CATEGORY`/`UPSERT_CATEGORY_MAPPING` calls go to `categoryDispatch` not `dispatch`; `IMPORT_BUDGET_TRANSACTIONS`'s dispatched action object includes `categories`/`categoryMappings`).
Acceptance: `grep -n "state\.categories\|state\.categoryMappings" src/components/BudgetPage.tsx` returns nothing; `npx vitest run src/components/BudgetPage.test.tsx` green.

### T14 — `importExport.ts`: drop `categories`/`categoryMappings` from `ExportableState`, add unencrypted JSON download/parse helpers
Deps: T9.
- Remove `categories`/`categoryMappings` fields from `ExportableState`, `buildExportableState`, and the `decrypted.categories ?? []` / `decrypted.categoryMappings ?? []` defaults in `decryptImportEnvelope`.
- Add `export function downloadJsonAsFile(data: unknown, filename: string): void` — factor the shared Blob-creation/anchor-click logic out of `downloadEnvelopeAsFile` into a small private helper both now call (or just duplicate the 4-line Blob dance — either is fine; prefer factoring since it's the same pattern twice).
- Add `export function parseCategoryMappingImportFile(text: string): GlobalCategoryState` — `JSON.parse`, validate shape (`Array.isArray(.categories)`/`.categoryMappings`, each item has the expected keys), throw a new `export class CategoryMappingImportError extends Error {}` on malformed content (mirrors `ImportMalformedFileError` naming convention already used for the backup-file-restore path).
Test cases (`src/lib/importExport.test.ts`): `ExportableState` round-trip no longer includes `categories`/`categoryMappings` (update existing round-trip test); `downloadJsonAsFile` creates and clicks a Blob anchor (same assertion style as the existing `downloadEnvelopeAsFile` test); `parseCategoryMappingImportFile` — valid JSON parses; missing `categories` key throws `CategoryMappingImportError`; non-JSON text throws the same error type; empty-but-valid `{categories:[],categoryMappings:[]}` parses fine (not an error).
Acceptance: `npx vitest run src/lib/importExport.test.ts` green; `grep -n "categories\|categoryMappings" src/lib/importExport.ts` shows only the NEW helpers, no `ExportableState` field.

### T15 — `selectors.ts`: retarget `referencedCategories` to explicit params
Deps: T9.
- `referencedCategories(state: AppState): Category[]` → `referencedCategories(categories: Category[], categoryMappings: CategoryMapping[], budgetExpenses: Expense[], budgetTransactions: BudgetTransaction[]): Category[]` — same body, `state.X` reads become the new params.
- `mappingsForCategory`, `visibleExpenses`, `categoryBreakdown`, `actualByCategory` — confirmed no signature change needed (already param-based per Facts-checked); no edit.
Test cases (`src/lib/selectors.test.ts`): update `referencedCategories`'s existing test fixtures to call the new explicit-params signature instead of building a fixture `AppState`.
Acceptance: `npx vitest run src/lib/selectors.test.ts` green; `grep -n "referencedCategories(state" src/lib/selectors.ts src/components/*.tsx` returns nothing.

### T16 — `Settings.tsx`: categories tab + backup card wiring
Deps: T13 (shares the prop-shape convention), T14, T15.
- New props on `SettingsPage`: `categories: Category[]`, `categoryMappings: CategoryMapping[]`, `categoryDispatch: (action: CategoryAction) => void`, `categoriesHydrated: boolean`.
- Categories tab (~line 420+): `referencedCategories(state)` → `referencedCategories(categories, categoryMappings, state.budgetExpenses, state.budgetTransactions)`; `mappingsForCategory(state.categoryMappings, ...)` → `mappingsForCategory(categoryMappings, ...)`; `dispatch({type:'RENAME_CATEGORY',...})` / `ADD_CATEGORY_MAPPING` / `UPDATE_CATEGORY_MAPPING` → all become `categoryDispatch(...)`; the "Re-apply mappings" button (line 107) → `dispatch({type:'REAPPLY_CATEGORY_MAPPINGS', categoryMappings})` (main reducer, per T10 — this one action DOES still route through the main `dispatch`, not `categoryDispatch`, since it mutates `budgetTransactions`).
- Backup card (~line 247-262): add, gated on `categoriesHydrated`:
  - "Download Category Mapping" button: `downloadJsonAsFile({categories, categoryMappings}, \`category-mappings-${yyyy}-${mm}-${dd}.json\`)` (reuse the existing date-formatting inline snippet from the "Download Backup" button just above it).
  - A file `<input type="file" accept="application/json">` (hidden, triggered by a "Import Category Mapping" button, mirroring whatever existing hidden-file-input pattern this codebase uses elsewhere for uploads — check `BudgetPage.tsx`'s `importFileInputRef` OFX-upload pattern and mirror it exactly) — on file select: read text → `parseCategoryMappingImportFile` → on success, `categoryDispatch({type:'__MERGE_IMPORTED', imported})` (new private action added to `categoryStore.ts`'s `CategoryAction`/`categoryStoreReducer` in this task: `case '__MERGE_IMPORTED': return mergeCategoryState(state, action.imported)` — imports `mergeCategoryState` from `categoryMerge.ts` into `categoryStore.ts`) — on `CategoryMappingImportError`, show an inline error message (mirror the existing inline-error pattern used elsewhere in this file, e.g. `passwordSuccess`-style transient state).
Test cases (`Settings.test.tsx`): existing Categories-tab tests updated to source `categories`/`categoryMappings`/dispatch from the new props instead of `state`; "Re-apply" button test asserts the payload now includes `categoryMappings`. NEW: "Download Category Mapping" button triggers `downloadJsonAsFile` with the current `categories`/`categoryMappings`; selecting a valid JSON file dispatches `__MERGE_IMPORTED` with the parsed content and the resulting merged state reflects both old and imported records (round-trip: export then re-import an unmodified file is a no-op merge); selecting a malformed file shows the inline error and does NOT dispatch; both buttons render only once `categoriesHydrated` is `true` (test with `false` → neither renders, or renders disabled — pick "does not render", simpler and matches requirement 10's wording).
Acceptance: `grep -n "state\.categories\|state\.categoryMappings" src/components/Settings.tsx` returns nothing; `npx vitest run src/components/Settings.test.tsx` green.

### T17 — Reference docs: `design.md`
Deps: T13, T16, plus every module task (T2-T15) for accuracy.
- **Directory structure**: add `src/lib/categoryStore.ts`, `categoryMerge.ts`, `categoryPersist.ts`, `categoryDrive.ts`, `categoryMigration.ts`, `src/hooks/useGlobalCategories.ts` with one-line purposes each.
- **AppState interface**: remove `categories`/`categoryMappings` lines; update the "(N data fields)" count.
- **State management**: describe the new standalone `useGlobalCategories` hook (own `useReducer`, own IDB, own Drive sync, independent of the per-portfolio flow) in a new subsection; note `state.ts` keeps only `reapplyCategoryMappingsToState`/`importBudgetTransactions`'s explicit-param signature as its remaining category-adjacent surface.
- **Action types**: remove the 5 retired category-CRUD action types; update `IMPORT_BUDGET_TRANSACTIONS`/`REAPPLY_CATEGORY_MAPPINGS` payload shapes.
- **Component tree**: `BudgetPage`/`SettingsPage` entries gain the 3 new props each; note the Settings backup card's 2 new controls.
- **Data flow**: rewrite the Budget-categories paragraph to describe global-store sourcing instead of `AppState`; add a new "Global Categories" data-flow block covering hydrate → migration-per-portfolio → local edits → auto-push/poll/pull → merge.
- **Selectors**: update `referencedCategories`'s signature description.
Test: none (docs). Acceptance: full top-to-bottom re-read (major change, per CLAUDE.md) — no stale `AppState.categories` references remain anywhere in the file; terse/table-dense maintained.

### T18 — Reference docs: `schema-spec.md`
Deps: T17 (do together/sequentially; split into its own task for the 30min cap).
- `## Category` table: add `updatedAt`/`deletedAt` rows; note it's no longer part of `AppState`'s persistence envelope — it's the new global store's own record.
- `## CategoryMapping` table: add `deletedAt` row.
- New `## Global Category Store` section (new top-level section, modeled on the existing per-type tables): DB name, two stores (`state`/`meta`), migration-marker shape, Drive file path+shape, merge-algorithm summary (last-write-wins by `id`, `deletedAt ?? updatedAt` comparison, tie→local).
- Update the "Persistence envelope" section's field list to remove `categories`/`categoryMappings` (no longer part of the per-portfolio envelope).
- Update "Action Types" section: same edits as `design.md`'s T17 action-type changes, schema-spec's own copy of that list.
Test: none. Acceptance: full re-read; no contradiction with `design.md`.

### T19 — Reference docs: `product-behavior.md`
Deps: T17, T18.
- **Budget section**: rewrite the "Persisted data" line to remove `categories`/`categoryMappings` from `AppState`'s list, note they're now sourced from the global store via props; update every category-CRUD behavior description (`ADD_CATEGORY`, mapping upsert on Save/edit, live-prefill, import auto-categorization, "Re-apply mappings") to reflect the new dispatch target (`categoryDispatch` vs `dispatch`) where user-facing behavior is unchanged but worth noting the plumbing shift is invisible to the user.
- **Settings page section**: Categories tab paragraph — same plumbing note; Backup card paragraph — add "Download Category Mapping" + import-file behavior (unencrypted JSON, merge not replace, error message on malformed file).
- New note (Budget or a new small "Cross-Portfolio Categories" subsection): categories/mappings are now shared across ALL portfolios in this browser — renaming a category in one portfolio's Settings changes what every other portfolio sees too; migration behavior note per D-MIG (the first portfolio opened after upgrading seeds the global store with its existing categories/mappings as-is; this order is not user-controllable; every other portfolio's own categories/mappings are left behind and never merged in, so its transactions show as uncategorized until the user manually recreates matching categories and re-categorizes).
- **Google Drive Sync section** (wherever the existing per-portfolio sync doc lives, if a top-level section exists — check via `grep -n "Drive" product-behavior.md`): add a short note that `category-mappings.json` at the Drive root is a SEPARATE sync channel from the per-portfolio backup file, syncs opportunistically (auto-push on edit, 60s poll, works with zero portfolios connected).
Test: none. Acceptance: full re-read; 3+ spot-checked facts against the shipped T13/T16 code; no contradictions; terse.

### T20 — Cross-file fixture sweep
Deps: T9, T10, T11, T14, T15.
Files: `src/lib/state.test.ts`, `src/lib/reducer.test.ts`, `src/lib/persist.test.ts`, `src/lib/importExport.test.ts`, `src/lib/selectors.test.ts`, `src/components/BudgetPage.test.tsx`, `src/components/Settings.test.tsx`, `src/App.test.tsx`.
- Grep each for any remaining `categories:`/`categoryMappings:` fixture literal on an `AppState`-shaped object and remove (no longer a field); grep for any remaining `state.categories`/`state.categoryMappings` reads in test assertions and retarget to the new prop-based fixtures.
Test: `npx vitest run src/lib/state.test.ts src/lib/reducer.test.ts src/lib/persist.test.ts src/lib/importExport.test.ts src/lib/selectors.test.ts src/components/BudgetPage.test.tsx src/components/Settings.test.tsx src/App.test.tsx` — full green.
Acceptance: zero remaining `AppState.categories`/`AppState.categoryMappings` fixture references anywhere in the 8 files; all green.

### T21 — Full test + build gate
Deps: T17, T18, T19, T20.
Run `npm run test` (full suite) then `npm run build` (`tsc -b` + `vite build`).
Test: both commands are the gate.
Acceptance: `npm run test` fully green, zero failures; `npm run build` zero `tsc` errors, successful `vite build`.

### T22 — Commit
Deps: T21.
```
git add -A
git commit -m "Move Category/CategoryMapping to a global, cross-portfolio Drive-synced store"
```
Test: `npm run test` green immediately before commit.
Acceptance: commit created on `category-mapping-global/main`, clean working tree.

### T23 — Merge to main, tear down worktree
Deps: T22.
```
cd /home/mohan/owa/portfolio
git merge category-mapping-global/main
git worktree remove ../worktree-category-mapping-global
git branch -d category-mapping-global/main
```
Do NOT push to any remote.
Test: `git log -1` on main shows the merged commit; `git worktree list` no longer lists it; `npm run test` green on main.
Acceptance: main has the change, worktree gone, branch deleted, tests green on main.

## Test strategy

- New unit-test files: `categoryStore.test.ts` (pure CRUD/resolve/reapply/tombstone-filter), `categoryMerge.test.ts` (merge/tombstone precedence, ties, disjoint ids), `categoryPersist.test.ts` (global IDB hydrate/persist round-trip, seeded-marker, drive-sync bookmark, isolation from per-portfolio db), `categoryDrive.test.ts` (pull/push/status against a hand-faked `project.files`, malformed-content swallow vs auth-error propagate), `categoryMigration.test.ts` (seed-from-first-unlocked-portfolio verbatim copy, idempotency once seeded, non-seed-portfolio contributes nothing, no-`categories`-key no-op), `useGlobalCategories.test.ts` (hydrate/save/push/pull/poll wiring, fake timers, offline-only path).
- Updated existing files: `state.test.ts`/`reducer.test.ts`/`persist.test.ts`/`importExport.test.ts`/`selectors.test.ts`/`BudgetPage.test.tsx`/`Settings.test.tsx`/`App.test.tsx` (fixture/signature sweep, T20).
- No new E2E/browser tests (matches existing vitest+jsdom-only convention).
- Gate: `npm run test` + `npm run build` both green before T22's commit (T21).

## Risks / open decisions worth double-checking at execution time

- **T6's exact Drive metadata-read method name** (`files.get` vs `files.status` vs something else) isn't confirmed against `node_modules/@open-webapp/drive-sync`'s actual type surface in this pass — mirror whatever `getBackupFileStatus` in `drive.ts:527` already calls for the per-portfolio file's `modifiedTime`, confirmed at T6 execution time.
- **Which portfolio seeds the store is arbitrary/unlucky**: whichever portfolio the user happens to unlock FIRST after upgrading wins the seed, even if that portfolio has zero or trivial categories while another portfolio has rich, carefully-curated ones — there's no "pick the best source" step, by design (requirement 8). If the first-unlocked portfolio's raw blob has no `categories` key at all (e.g. it predates the category-mapping feature entirely, or is brand-new), the store seeds empty and marks itself seeded anyway — so even a later portfolio with real categories never gets copied in. This is an accepted consequence of the simplified one-shot rule, not a bug — called out in `product-behavior.md` (T19). (Every other portfolio's own categories/mappings stay stranded in that portfolio's own old blob forever, whether or not the user ever reopens it — this is now true by design for ALL non-seed portfolios, not just unopened ones.)
- **`__REPLACE`/`__MERGE_IMPORTED`/`__HYDRATE`-style private action names** in `categoryStore.ts`'s `CategoryAction` union are internal-only (never dispatched by a component, only by `useGlobalCategories.ts`/`Settings.tsx`'s import handler) — naming convention mirrors the existing `__SET_STATE` private action already used in the main `reducer.ts` for the same "whole-state replace, not user-driven" purpose.
- **`fake-indexeddb` availability**: T4/T8's tests assume either a `fake-indexeddb` devDependency already exists (check `package.json`) or that `persist.test.ts`'s existing manual-IDB-mock approach can be copied — confirm at T4 execution time; if neither works cleanly in jsdom, fall back to mocking `categoryPersist.ts`'s exported functions directly in dependent tests (T8) rather than exercising real IndexedDB, and keep only T4's own suite as the real-IDB integration test.
- **Settings.tsx's hidden-file-input pattern for the category-mapping import control** (T16) is described as "mirror `BudgetPage.tsx`'s OFX upload pattern" rather than pinned to exact line numbers — confirm the exact ref/handler shape at T16 execution time, low risk (well-established pattern already used twice in this codebase for CSV/backup-file uploads).
