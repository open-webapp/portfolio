# Remove Dashboard Tab and Make Accounts the Default Landing Page

Caveman plan. Modeled on existing plans in this repo (e.g., `nav-accounts-settings-v9.md`) — small, concrete tasks, ≤30min each. Read top to bottom before starting task 1.

**Cleanup depth (decided): full purge.** Delete dashboard-only components, selectors, and state fields — no orphaned dead code left behind.

## Scope

**In scope**:
- `src/components/Nav.tsx` — remove Dashboard tab
- `src/App.tsx` — remove dashboard branch, imports, `categoryTabs`
- `src/lib/state.ts` — remove `category`, `assetClassFilter`, `posSearch`, `showClosed`, `tab` fields + their helpers; default `view: 'accounts'`
- `src/lib/reducer.ts` — remove `SET_CATEGORY`, `SET_ASSET_CLASS_FILTER`, `SET_POSITIONS_SEARCH`, `TOGGLE_SHOW_CLOSED`, `SET_TAB`
- `src/lib/selectors.ts` — delete `visiblePositions`, `positionsForCategory`, `segmentCards`, `valueGlSummary`, `getAccountsForCategory`; **refactor** `filteredPortfolioTotal` (still used by `PositionGroupOverlay`)
- `src/lib/persist.ts` — drop removed fields from `coalesceWithDefaults` **and normalize a stored `view: 'dashboard'` → `'accounts'`**
- **Delete files**: `src/components/OverviewCard.tsx`, `src/components/PositionsTable.tsx`, `src/components/PositionsTable.test.tsx`
- Test updates: `Nav.test.tsx`, `App.test.tsx`, `reducer.test.ts`, `state.test.ts`, `selectors.test.ts`, `persist.test.ts`, plus stale state literals in `drive.test.ts`, `PositionGroupOverlay.test.tsx`, `ClosedPositionsTable.test.tsx`
- Reference docs: `design.md`, `product-behavior.md`, **`schema-spec.md`** (all at repo root)

**Out of scope**:
- `AccountsPage.tsx`, `SettingsPage.tsx`, import dialog flow — unchanged
- AccountsPage-scoped state (`selectedAccountId`, `selectedCategoryKey`, `expandedCategories`, `acctAssetClassFilter`, `acctPosSearch`) — unchanged
- `sortKey`/`sortDir`/`TOGGLE_SORT` — still used by `AccountsPage.tsx`. Keep.
- `assetClassOptions`, `CATEGORY_LABEL`, `allocationBars`, `AllocationChart`, `ClosedPositionsTable`, `PositionGroupOverlay` — all still used by AccountsPage. Keep.
- `TransactionsTable.tsx` and `txSearch`/`txTypeFilter`/`visibleTransactions` — **already** dead code today (no importer, pre-existing). Not caused by this change; leave alone and note it.
- `src/lib/design.md`, `src/lib/product-behavior.md` — verified: contain no Dashboard/`category`/`assetClassFilter` references. No edit needed.

## Facts Verified Against Current Code (2026-08-14, `main` @ 6e3b20d)

**Baseline**: `npm run test` → **24 files, 601 tests, all passing**. Working tree clean apart from untracked `plans/*.md`.

**Typecheck reality**: `tsconfig.app.json` has `"exclude": ["src/**/*.test.ts", "src/**/*.test.tsx"]` — **test files are NOT typechecked by `npm run build`**, and vitest does not typecheck either. Consequence: the ~40 test-file `AppState` literals containing `category: 'all'` / `assetClassFilter: 'All'` (in `ClosedPositionsTable.test.tsx`, `PositionsTable.test.tsx`, `PositionGroupOverlay.test.tsx`, `selectors.test.ts`, `drive.test.ts`, `persist.test.ts`) will **not** break the build or the tests. They become harmless stale props. Only tests that *assert on removed behavior* actually fail.

**Line-number facts** (verified):
- `src/App.tsx:5` imports `assetClassOptions, CATEGORY_LABEL, positionsForCategory`; `:7-9` import `OverviewCard`, `AllocationChart`, `PositionsTable`; `:18-21` `categoryTabs`; `:317-366` the dashboard branch; `:329`/`:349` the two removed dispatches. `CATEGORY_LABEL` is used **only** by `categoryTabs` in App.tsx → its import goes too (but the export stays; `selectors.ts:224,254` still use it).
- `src/components/Nav.tsx:23-26` `mainNavTabs`.
- `src/lib/state.ts`: `:23` `category`, `:24` `tab`, `:25` `view`, `:28` `assetClassFilter`, `:29` `posSearch`, `:32` `showClosed`; inits `:61`, `:62`, `:63` (`view: 'dashboard'`), `:66`, `:67`, `:71`. Helpers: `setCategory` (~234), `setAssetClassFilter` (~285), plus the `SET_TAB`/`SET_POSITIONS_SEARCH`/`TOGGLE_SHOW_CLOSED` helpers (`state.ts:328` is `toggleShowClosed`).
- `src/lib/reducer.ts`: union entries `:16` `SET_CATEGORY`, `:17` `SET_TAB`, `:20` `SET_ASSET_CLASS_FILTER`, `:21` `SET_POSITIONS_SEARCH`, `:24` `TOGGLE_SHOW_CLOSED`; cases at `:74-75`, `:86-87`, and the corresponding `SET_TAB`/`SET_POSITIONS_SEARCH`/`TOGGLE_SHOW_CLOSED` cases.
- `AppState.view` is `'dashboard' | 'settings' | 'accounts'` → becomes `'settings' | 'accounts'`.

**Gaps the previous draft missed** (each is now a task):
1. **`persist.ts` migration bug.** `coalesceWithDefaults` (`persist.ts:48`, `:70` `view: loaded.view ?? defaults.view`) is the single normalization path for *both* local unlock *and* Drive restore. An existing user's stored blob has `view: 'dashboard'`. With a two-way ternary (`accounts` else `settings`), that stale value lands the user on **Settings** on first load after upgrade. Must coerce any non-`'accounts'`/non-`'settings'` view to `'accounts'`. Also drop `category`/`assetClassFilter`/`posSearch`/`showClosed`/`tab` lines (`persist.ts:70,71,75,76,79`).
2. **`selectors.ts` was entirely absent from the old plan** yet reads both removed fields: `:27,30` (`state.assetClassFilter` in `visiblePositions`) and `:455,458` (`state.category` in `getAccountsForCategory`). Removing the fields without touching selectors = `npm run build` failure.
3. **`filteredPortfolioTotal` must survive.** `PositionGroupOverlay.tsx:6,317` calls it, and `PositionGroupOverlay` is rendered by `AccountsPage.tsx:304`. It currently filters through `getAccountsForCategory(state)`. Since `state.category` was always `'all'` on the Accounts page, dropping the category filter is **behavior-preserving**: it becomes "sum of all positions' market values". Do not delete it.
4. **Components are not deleted by removing the App.tsx branch.** `OverviewCard.tsx` and `PositionsTable.tsx` become orphaned files that still typecheck against removed state (`PositionsTable.tsx:23,27,73,93,198,204` read `visiblePositions`, `sortKey`, `posSearch`, `showClosed`). They must be explicitly deleted, along with `PositionsTable.test.tsx` (1544 lines). `OverviewCard` has no test file.
5. **`schema-spec.md` was missing from the doc list** — `:178,179,192` list the removed actions and the `view: 'dashboard'` type.
6. **Nav becomes a one-tab `.seg`.** Also update the Nav doc comment (`Nav.tsx:13`) and App.tsx's `{/* Navigation: Dashboard/Accounts tabs … */}` comment (`App.tsx:304`).
7. The old plan's "expect many tests to fail / build errors in tests" premise was wrong (see Typecheck reality). The failing set is bounded and enumerated in T9.

## Locked Decisions

1. Dashboard tab removed from Nav — only Accounts and Settings reachable.
2. Default landing page is Accounts; persisted `'dashboard'` migrates to `'accounts'`.
3. Full purge of dashboard-only state, actions, selectors, and components.
4. `filteredPortfolioTotal` refactored (not deleted) — denominator becomes all positions.
5. `sortKey`/`sortDir` retained (AccountsPage dependency).
6. Reference docs `design.md`, `product-behavior.md`, `schema-spec.md` updated.
7. 100% test pass rate at end (no carve-out). Final count will be below 601 — that is expected; record the new number.

## Tasks

### T0. Create isolated git worktree (~5 min)
No dependency.
- From `/Users/mdoraiswamy/owa/portfolio`: `git worktree add ../worktree-dashboard-removal -b dashboard-removal/main`.
- `cd ../worktree-dashboard-removal`. All of T1–T11 happen there.
- Acceptance: clean tree on the new branch; worktree dir is a sibling of `portfolio/`.

### T1. `state.ts` — default view + field/helper removal (~15 min)
Depends on: T0.
- `view: 'dashboard'` → `'accounts'` (init, ~line 63).
- Narrow the `view` type to `'settings' | 'accounts'`.
- Remove interface fields `category`, `assetClassFilter`, `posSearch`, `showClosed`, `tab` and their four/five initializers.
- Remove helpers `setCategory`, `setAssetClassFilter`, `setTab`, `setPositionsSearch`, `toggleShowClosed`.
- Drop the now-unused `TaxCategory` import **only if** nothing else in the file uses it (`selectedCategoryKey` still does — verify before deleting; `noUnusedLocals` is on).
- Acceptance: `grep -n "category\b\|assetClassFilter\|posSearch\|showClosed\|\btab\b" src/lib/state.ts` returns only `selectedCategoryKey`/`expandedCategories` hits.

### T2. `reducer.ts` — remove action types and cases (~10 min)
Depends on: T1.
- Remove union members and `case` blocks for `SET_CATEGORY`, `SET_ASSET_CLASS_FILTER`, `SET_POSITIONS_SEARCH`, `TOGGLE_SHOW_CLOSED`, `SET_TAB`.
- Acceptance: grep count 0 for all five in the file.

### T3. `selectors.ts` — delete dashboard selectors, refactor `filteredPortfolioTotal` (~20 min)
Depends on: T1.
- Delete `visiblePositions`, `positionsForCategory`, `segmentCards`, the private `valueGlSummary`, and the private `getAccountsForCategory`.
- Rewrite `filteredPortfolioTotal(state)` to `state.positions.reduce((sum, p) => sum + computePosition(p).marketValue, 0)` and update its docstring (no more category/asset-class language).
- Keep `assetClassOptions`, `CATEGORY_LABEL`, `allocationBars`, `categoryCards`, `closedPositionsCard`, all `acct*` selectors, `visibleTransactions`.
- Remove any now-unused imports (`sortBy` may become unused — check; `noUnusedLocals` will catch it at build).
- Acceptance: no reference to `state.category` or `state.assetClassFilter` in `src/lib/`.

### T4. `persist.ts` — drop fields + migrate stale view (~15 min)
Depends on: T1.
- In `coalesceWithDefaults`, delete the `category`, `tab`, `assetClassFilter`, `posSearch`, `showClosed` lines.
- Replace `view: loaded.view ?? defaults.view` with a normalizing form, e.g.
  `view: loaded.view === 'accounts' || loaded.view === 'settings' ? loaded.view : defaults.view`
  (`loaded` is `Partial<AppState>`, so a stored `'dashboard'` arrives as an unlisted string — cast as needed).
- Add a short comment explaining the `'dashboard'` migration.
- Acceptance: `coalesceWithDefaults({ view: 'dashboard' } as any).view === 'accounts'`.

### T5. Delete dashboard-only components (~5 min)
Depends on: T0.
- `git rm src/components/OverviewCard.tsx src/components/PositionsTable.tsx src/components/PositionsTable.test.tsx`.
- Acceptance: files gone; `grep -rn "OverviewCard\|PositionsTable" src/` returns only incidental comment mentions in `App.test.tsx` (cleaned in T10) and `ClosedPositionsTable`/`AccountsPage` hits that are unrelated substrings.

### T6. `Nav.tsx` — remove Dashboard tab (~10 min)
Depends on: T0.
- `mainNavTabs` → `[{ value: 'accounts', label: 'Accounts' }]`.
- Update the component docstring (`Nav.tsx:13`) and the `{/* Main navigation tabs (Dashboard / Accounts) */}` comment.
- A single-item `.seg` radio group is acceptable; do not restructure the markup.
- Acceptance: exactly one `.seg-opt` rendered; no "Dashboard" string in the file.

### T7. `App.tsx` — remove dashboard branch (~20 min)
Depends on: T2, T3, T5, T6.
- Remove imports of `OverviewCard`, `AllocationChart`, `PositionsTable`, and the `positionsForCategory` / `CATEGORY_LABEL` / `assetClassOptions` selector imports (App.tsx no longer needs any of them — `AllocationChart` and `assetClassOptions` remain imported by `AccountsPage.tsx`, not App).
- Remove the `categoryTabs` const (lines 18–21).
- Delete the whole `state.view === 'dashboard' ? (…)` branch (lines ~317–366), collapsing the three-way ternary to `state.view === 'accounts' ? <AccountsPage…/> : <SettingsPage…/>`.
- Note: the dashboard branch also hosted an `<ImportDialog>` instance. Confirm the Accounts page still exposes an Import affordance (`AccountsPage.tsx` filter row) — if not, this is a **functional regression**: stop and flag before continuing.
- Update the `{/* Navigation: Dashboard/Accounts tabs … */}` comment.
- Acceptance: `grep -in "dashboard" src/App.tsx` returns only the "Loading dashboard..." gate strings (see T10 note); two-way conditional only.

### T8. `Nav.test.tsx` (~15 min)
Depends on: T6.
- Delete the `state.view = "dashboard"` case and the "clicking Dashboard tab dispatches SET_VIEW" case.
- Rewrite the remaining cases: `view: 'accounts'` → Accounts radio checked; `view: 'settings'` → Accounts radio unchecked; clicking Accounts dispatches `{ type: 'SET_VIEW', view: 'accounts' }`.
- Add: the `.seg` renders exactly one option (guards against a Dashboard tab creeping back).
- Run `npx vitest run src/components/Nav.test.tsx` — green.

### T9. Library tests (~25 min)
Depends on: T2, T3, T4.
- `reducer.test.ts`: delete the `SET_ASSET_CLASS_FILTER` describe block (~lines 154–161).
- `selectors.test.ts`: delete every `visiblePositions`, `positionsForCategory`, and `segmentCards` test; update the `filteredPortfolioTotal` tests to the new all-positions semantics (the "ignores asset class filter" test at ~485 and the category-filter tests at ~381 need rewriting or deleting).
- `persist.test.ts`: delete assertions on `loaded.category` / `loaded.assetClassFilter` round-trip (~lines 306, 310, 461); change stored-fixture `view: 'dashboard'` values (~141, 261, 484, 646, 669) to `'accounts'`, **and add a new test**: a persisted blob with `view: 'dashboard'` coalesces to `view: 'accounts'` (this is the regression test for the T4 bug).
- `state.test.ts`: delete any `setCategory`/`setAssetClassFilter`/`toggleShowClosed`/`setTab` tests; add a test that `initialState().view === 'accounts'`.
- Optional tidy: strip the now-meaningless `category`/`assetClassFilter` props from state literals in `drive.test.ts`, `PositionGroupOverlay.test.tsx`, `ClosedPositionsTable.test.tsx` (harmless — tests aren't typechecked — but stale).
- Run `npx vitest run src/lib` — green.

### T10. `App.test.tsx` (~25 min)
Depends on: T7, T8, T9.
- Delete the "renders dashboard view by default with OverviewCard and AllocationChart" test (~181) and the "returns to dashboard when Dashboard tab is clicked" test (~219).
- Rewrite the `describe('view switching (dashboard vs settings)')` block as accounts-vs-settings.
- Delete the four category / asset-class filter tests (~270, ~295, ~325, ~341).
- Rewrite tests that assert "dashboard content is gone" (~202, 214, 231, 273, 325, 372, 387) to key off Accounts-page content instead.
- **Leave the `"Loading dashboard..."` gate-string assertions alone** (~80, 404, 411, 416, 536, 640) unless you also change that literal in `App.tsx`/`PasswordGate.tsx`. Decide once: either keep the literal as-is (simplest — it's a loading message, not a view name) or rename to `"Loading..."` and update all six assertions together.
- Add: default state renders AccountsPage (assert on an Accounts-page-only element, e.g. a category card).
- Run `npx vitest run src/App.test.tsx` — green.

### T11. Full verification (~15 min)
Depends on: T1–T10.
- `npm run build` — clean. Expect `noUnusedLocals` to surface leftover imports; fix them.
- `npm run test` — 100% green. Record the new file/test counts (down from 24/601; `PositionsTable.test.tsx`'s removal alone drops a large block).
- `npm run lint` — clean.
- Sanity check via `npm run dev`: fresh load lands on Accounts; a pre-existing IndexedDB blob with `view: 'dashboard'` also lands on Accounts (covered by the T9 test, but eyeball it).
- Acceptance: three clean commands, zero carve-outs.

### T12. Reference docs (~25 min)
Depends on: T11.
All three live at the repo **root**.
- `design.md`: `:36` Nav description (drop "Dashboard/"), `:39` AllocationChart "reused on Dashboard and Accounts page" → Accounts page only, `:78` view type, `:77`/`:81` remove `category`/`assetClassFilter` from the AppState block (also `posSearch`, `showClosed`, `tab`), `:100` action list (drop the five removed actions), `:110-114` component tree (drop the `[view === 'dashboard']` subtree and the Dashboard tab wording), `:165` remove `positionsForCategory`, `:167` drop "Dashboard-scoped", `:168` rewrite `filteredPortfolioTotal` to the new semantics. Also remove the `OverviewCard.tsx` / `PositionsTable.tsx` directory-structure entries.
- `product-behavior.md`: `:9` Layout (drop the Dashboard row, make Accounts the described default view), `:13-16` Nav section (one tab), `:36` AllocationChart usage, `:75-77` remove the "same as Dashboard" comparisons, `:131` Settings back-navigation now goes via the Accounts tab. Note the new default-landing behavior and the `'dashboard'`→`'accounts'` migration.
- `schema-spec.md`: `:178-179` action lists, `:192` UI-state field list (remove `category`, `assetClassFilter`, `posSearch`, `showClosed`, `tab`; `view` → `'settings' | 'accounts'`). Note: line 192 already contains stale entries (`range`, `retirementFilter`) that don't exist in code — fix those too while editing.
- Titles ("Portfolio Dashboard") are the product name, not the view — leave them.
- Per CLAUDE.md, re-read all three in full after editing (this is a major change).
- Acceptance: `grep -rni "dashboard" *.md` returns only product-name/prototype-path hits.

### T13. Commit (~10 min)
Depends on: T11, T12.
- Re-run `npm run test`, `npm run build`, `npm run lint` — do not commit unless all three pass.
- Stage explicitly (no `git add -A`): the modified sources, the three deleted files, the modified tests, and `design.md` / `product-behavior.md` / `schema-spec.md`.
- Message: `Remove Dashboard view: default to Accounts, purge dashboard-only state, selectors, and components`
- Do not push.

### T14. Worktree teardown (~5 min)
Depends on: T13.
- `cd /Users/mdoraiswamy/owa/portfolio`; `git worktree remove ../worktree-dashboard-removal`.
- Acceptance: worktree gone from `git worktree list`; branch `dashboard-removal/main` retains the commit.

## Acceptance Criteria

1. Nav renders exactly one tab (Accounts); no Dashboard string anywhere in `src/`.
2. `App.tsx` is a two-way conditional: `accounts` → `AccountsPage`, else `SettingsPage`.
3. `initialState().view === 'accounts'`; `AppState.view` type is `'settings' | 'accounts'`.
4. `category`, `assetClassFilter`, `posSearch`, `showClosed`, `tab` gone from state, reducer, selectors, and persist.
5. A persisted/Drive-restored blob with `view: 'dashboard'` loads into the Accounts page (covered by a test).
6. `OverviewCard.tsx`, `PositionsTable.tsx`, `PositionsTable.test.tsx` deleted; no orphaned imports.
7. `filteredPortfolioTotal` still works for `PositionGroupOverlay` on the Accounts page; `% of Portfolio` values unchanged.
8. Import affordance still reachable from the Accounts page.
9. `npm run test` 100% green (new count recorded), `npm run build` and `npm run lint` clean.
10. `design.md`, `product-behavior.md`, `schema-spec.md` accurate to the new code.
