# Dashboard v8 Layout Rework

Goal: rework the Dashboard page layout to match `design/v8/project/Portfolio Dashboard.dc.html`. Settings page (`SettingsPage.tsx`, Nav's settings-tabs branch) is completely untouched. Requirements below were resolved via an upstream grill-me interview and are FINAL — do not re-litigate. This plan follows `plans/dashboard-v6-layout.md`'s structure/tone.

Caveman plan. Small tasks, each one thing, ≤30 min. Read top to bottom before starting T0.

## Facts checked before writing this plan (discovery)

- No `plans/_template.md` exists; this file follows `plans/dashboard-v6-layout.md`'s section shape.
- `src/components/Nav.tsx` (165 lines): category tabs block is lines 61-84 (`{state.view === 'dashboard' && (<div className="seg">...)}`), directly followed by the settings-tabs block (lines 86-105, untouched). `handleCategoryChange` (lines 40-48) and the `categoryTabs` array (lines 28-33) are only used by the block being removed.
- `src/App.tsx` (343 lines): `retirementFilters` array is lines 15-19. Dashboard body is lines 266-312. Current order: `OverviewCard` (270) → `AllocationChart` wrapper div (273-275) → divider div (278) → retirement-filter-seg + `ImportDialog` row (281-308) → `PositionsTable` (311).
- `src/lib/state.ts` (AppState, ~240 lines): `retirementFilter` field is line 29, default `'All'` is line 63, setter helper `setRetirementFilter` is lines 220-231 (also `setAssetClassFilter`, lines 210-218, stays — untouched, only the retirement one goes).
- `src/lib/reducer.ts` (97 lines): `case 'SET_RETIREMENT_FILTER':` is lines 62-63.
- `src/lib/selectors.ts` (253 lines): `visiblePositions` retirement clause is lines 17-28; `filteredPortfolioTotal` retirement clause is lines 67-78; `segmentSummaryCards` (lines 190-211) currently does `getAccountsForCategory(state)` (category join) THEN a retirement filter — must become retirement-only, no category join, matching `design/v8/...dc.html` `segmentCards(retirement)` (line 786-789): `this.state.positions.filter(p => accounts.find(...).retirement === retirement)`.
- `src/lib/persist.ts` line 64: `retirementFilter: loaded.retirementFilter ?? defaults.retirementFilter,` inside the state-migration/defaulting function — must be removed.
- `src/components/PositionsTable.tsx` (388 lines): `assetClassOptions` computed via `useMemo` at lines 129-132; tag-pill filter UI rendered at lines 192-229 (the whole "Asset class filter tags + search" flex row, including the `<div style={{display:'flex', gap:'6px', ...}}>` wrapping the 'All' + per-class `<span className="tag ...">` pills); `handleAssetClassFilterClick` (134-142) becomes dead once the pills are gone. `assetClassOptions` is also passed to `PositionGroupOverlay` as `existingAssetClasses={assetClassOptions}` (line 366) — this usage must keep working after the computation moves.
- Diffed `design/v7/project/Portfolio Dashboard.dc.html` vs `design/v8/...` directly: confirms (a) category `.seg` block moves from the nav `sc-if isDashboardView` wrapper down into the dashboard body between the allocation section and the old divider, preceded by a zero-height `<div style="background: var(--color-divider); margin: var(--space-6) 0"></div>` spacer (not a `border-top` rule); (b) `retirementFilters`/`SET_RETIREMENT_FILTER` and all `st.retirementFilter` filter clauses (in `visiblePositions`, `filteredPortfolioTotal`, `visibleTransactions`) are deleted outright in v8's JS, no replacement; (c) `segmentCards(retirement)` in v8 drops the `getAccountsForCategory()`/category-join line entirely, filtering positions by retirement only; (d) the old retirement-filter-seg + Import row becomes an `assetClassFilters` seg (`name="assetClassFilter"`) + Import row, and the positions-table-local asset-class tag-pill row (old html's `<div style="display:flex; gap:6px; ...">` block) is deleted from the positions section header, which now holds only the search field; (e) Import button label is already "Accounts & Import" — confirmed matches current `ImportDialog.tsx`, no change needed.
- `grep retirementFilter src/` (complete list, both real logic and incidental fixture references):
  - `src/App.tsx`: lines 15-19 (array), 284, 288, 289 (real usage, in the block being removed).
  - `src/App.test.tsx`: lines 227-256 (`'should render retirement filter .seg-opt labels'` test, real assertions) and 264-286 (`'should dispatch SET_RETIREMENT_FILTER...'` test, real assertions) — both must be rewritten to target the new asset-class seg instead, or removed if redundant with a new asset-class-seg test.
  - `src/components/ClosedPositionsTable.test.tsx`: lines 50, 91, 137, 182, 234 — fixture field only, no logic asserted on it (per grep, only appears as `retirementFilter: 'All'` inside test-state literals).
  - `src/components/PositionsTable.test.tsx`: 23 occurrences, all fixture-field-only (`retirementFilter: 'All'` or `'Retirement'` at line 1555) — no test exercises retirement-filter *behavior* in this file (that's selectors.test.ts's job); safe to delete the field from each fixture literal.
  - `src/lib/state.ts`: line 29 (field decl), 63 (default), 229 (setter body) — real code, removed in T1.
  - `src/lib/reducer.ts`: line 63 — real code, removed in T2.
  - `src/lib/selectors.ts`: lines 18, 23, 68, 73 — real code, removed in T3.
  - `src/lib/persist.ts`: line 64 — real code, removed in T4.
  - `src/components/PositionGroupOverlay.test.tsx`: line 64 (fixture field) and line 1112 (`testState.retirementFilter = 'Non-Retirement'` — a real mutation inside a test; must check in T12 what that test is actually asserting since the field it sets is gone).
  - `src/lib/selectors.test.ts`: lines 331 (`visiblePositions: respects retirement filter` test, real logic), 512/551 (`filteredPortfolioTotal` retirement-only tests, real logic), 611 (`filteredPortfolioTotal: combines category and retirement filters` test, real logic, asserts `total).toBe(2000)` for taxable+non-retirement combo) — all four are dedicated retirement-filter-behavior tests and must be deleted (the behavior no longer exists), not just have a field stripped. Line 715/720 is a *different*, unrelated test (`filteredPortfolioTotal: ignores assetClassFilter`) that must stay — it doesn't test retirement filter, only confirms asset-class filter is ignored by this selector (still true after this change).
  - `src/lib/persist.test.ts`: lines 142, 239, 256, 430 — 142/430 are fixture-field-only; 239+256 are a real round-trip assertion pair (`retirementFilter: 'Retirement'` written, then `expect(loaded?.retirementFilter).toBe('Retirement')` read back) — this whole assertion pair must be deleted, not just the field (the field won't exist on `AppState` anymore).
  - `src/lib/drive.test.ts`: line 283 — fixture-field-only.
- `grep assetClassFilter/assetClassOptions/SET_ASSET_CLASS_FILTER src/`: confirms `assetClassFilter` state/reducer/selector logic (`src/lib/state.ts:28,62,216`; `src/lib/reducer.ts:59-60`; `src/lib/selectors.ts:31-36`) stays completely unchanged per requirement 4 — only the *rendering* of the control (markup/position) changes. `PositionsTable.test.tsx` has no test that clicks the tag-pill UI or otherwise exercises the control's rendering/click behavior (confirmed via grep — only fixture-literal occurrences), so no test logic there needs to change, only the fixture field removal is N/A (assetClassFilter field itself is NOT removed, only retirementFilter is) — i.e. `PositionsTable.test.tsx`'s `assetClassFilter: 'All'` lines stay as-is, untouched.
- Confirmed `product-behavior.md` and `design.md` both live at repo root (`/Users/mdoraiswamy/owa/portfolio/product-behavior.md`, `/Users/mdoraiswamy/owa/portfolio/design.md`), not in a module subdir. Read both in full during discovery; exact current text for affected sections captured below in T16/T17.
- `styles.css` confirmed byte-identical between `design/v7/project/styles.css` and `design/v8/project/styles.css` (per task brief) — no CSS file changes in this plan.

## Design decisions already locked (implement as-is)

1. **Category tabs**: move the whole `.seg` block (currently `Nav.tsx` lines 61-84) into `App.tsx`'s dashboard body, between `<OverviewCard state={state} />` and the `<AllocationChart>` wrapper div — i.e. it renders BEFORE the allocation chart, not after (matches the v8 html: category seg block sits right under the divider that used to be between allocation and the old retirement-filter row, but the divider itself is being repositioned too — see decision 2). `Nav.tsx` keeps everything else (brand, settings-tabs branch, sync icon, gear) untouched.

   Re-reading `design/v8/...dc.html`'s diff more carefully: the new `<div class="seg">` (category tabs) plus its preceding zero-height divider land in the position that in v7 was occupied by the *nav's* category tabs (now gone from nav entirely) — i.e. in the v8 React port, this reads as: `OverviewCard` → zero-height divider → category `.seg` → `AllocationChart`. Follow the exact task-brief instruction: category `.seg` sits between `<OverviewCard>` and the `<AllocationChart>` wrapper div, preceded by the zero-height spacer div.

2. **Divider before the category tabs**: a zero-height spacer, `<div style={{ background: 'var(--color-divider)', margin: 'var(--space-6) 0' }} />` — NOT the `borderTop` pattern used by the other divider on this page (`App.tsx` line 278, which stays as a border-top divider, now sitting between `AllocationChart` and the header row above `PositionsTable`). Implement literally per the CSS spec even though a 0-height div with only a `background` color renders no visible line — this is intentional, not a bug.

3. **Retirement filter removed entirely.** No replacement UI, no replacement state. `Account.retirement` (boolean) stays; `OverviewCard`'s Retirement/Non-Retirement segment clusters stay (they call `segmentSummaryCards(state, true/false)`, unaffected by state.ts's `retirementFilter` removal since they never read that field).

4. **`segmentSummaryCards(state, retirement)`** (`src/lib/selectors.ts`): drop the `getAccountsForCategory(state)` category join entirely. New body filters `state.positions` by retirement status only:
   ```ts
   export function segmentSummaryCards(state: AppState, retirement: boolean) {
     const filteredPositions = state.positions.filter((p) => {
       const account = state.accounts.find((a) => a.id === p.accountId)
       return account?.retirement === retirement
     })
     return valueGlInvestedCards(filteredPositions)
   }
   ```
   `summaryCards()` (All Together cluster) is NOT touched.

5. **Asset-class filter**: state/reducer/filtering logic (`state.assetClassFilter`, `SET_ASSET_CLASS_FILTER`, the filter clause in `visiblePositions`) is UNCHANGED. Only two things change: (a) markup — from `.tag`/`.tag-accent` clickable pills to a `.seg`/`.seg-opt` radio control (same pattern as the old retirement filter / category tabs: `<label class="seg-opt"><input type="radio" name="assetClassFilter" checked={...} readOnly /><span>{label}</span></label>`), options = `"All"` + every distinct effective asset class in `state.positions` (`p.assetClassManualOverride || p.assetClass`), alphabetically sorted (same source list as today's `assetClassOptions`); (b) position — moves from inside `PositionsTable.tsx`'s own header row into `App.tsx`'s header row (where the retirement filter used to be), left-aligned, with `ImportDialog` staying right-aligned in the same row.
   The `assetClassOptions` computation (`useMemo` over `state.positions`, currently local to `PositionsTable.tsx`) moves to a small new selector `assetClassOptions(state: AppState): string[]` in `src/lib/selectors.ts` (same one-line-per-selector convention as the file's other exports) — used by both `App.tsx` (to render the new seg) and `PositionsTable.tsx` (still needs the list for `existingAssetClasses` prop passed to `PositionGroupOverlay`). This is the "small selector, don't over-engineer" option named in the task brief.
   `PositionsTable.tsx`'s header row keeps ONLY the search field after this change (per v8 markup — no filter control renders inside the table component anymore).

## Scope

**In scope**: `src/components/Nav.tsx`, `src/App.tsx`, `src/lib/state.ts`, `src/lib/reducer.ts`, `src/lib/selectors.ts`, `src/lib/persist.ts`, `src/components/PositionsTable.tsx`, and the test files enumerated in "Facts checked" above (`App.test.tsx`, `ClosedPositionsTable.test.tsx`, `PositionsTable.test.tsx`, `PositionGroupOverlay.test.tsx`, `selectors.test.ts`, `persist.test.ts`, `drive.test.ts`), plus `product-behavior.md` and `design.md`.

**Out of scope**: `SettingsPage`/`Settings.tsx`, Nav's settings-tabs branch, sync icon, gear button — untouched. Transactions table, CSV import flow, password gate, `src/styles/styles.css` (already byte-identical to `design/v8/project/styles.css`) — untouched. Watchlist/Alerts stays permanently out of scope (never reintroduce).

## Tasks

### T0. Create isolated git worktree (~5 min)
No dependency.
- From `/Users/mdoraiswamy/owa/portfolio`: `git worktree add ../worktree-dashboard-v8-layout -b dashboard-v8-layout/main`.
- `cd ../worktree-dashboard-v8-layout`. All subsequent implementation tasks (T1-T14) happen here.
- Acceptance: `git status` in the worktree shows a clean tree on the new branch; worktree dir exists as a sibling of `portfolio/`.

### T1. Remove `retirementFilter` from `src/lib/state.ts` (~10 min)
Depends on: T0.
- Delete line 29 (`retirementFilter: 'All' | 'Retirement' | 'Non-Retirement'` field decl from `AppState`).
- Delete line 63 (`retirementFilter: 'All',` default in `initialState()`).
- Delete the `setRetirementFilter` function (lines 220-231, the whole exported helper).
- Test cases: none directly (pure type/default removal); covered transitively by T15's full test run. Edge: ensure `initialState()` still returns a valid object (no dangling comma/syntax error) — verified by `tsc -b` inside `npm run build`/`npm run test` type-checking.
- Acceptance: `grep -n retirementFilter src/lib/state.ts` returns nothing. `npx tsc -b --noEmit` (or full `npm run build`) shows no new errors in `state.ts` itself (other files still reference it until T2-T14 — expect errors elsewhere until those land; don't run a full build gate until T15).

### T2. Remove `SET_RETIREMENT_FILTER` case from `src/lib/reducer.ts` (~5 min)
Depends on: T1.
- Delete lines 62-63 (`case 'SET_RETIREMENT_FILTER': return StateActions.setRetirementFilter(state, action.filter)`).
- Test cases: none directly; a stray dispatch of this action type now silently falls through to `default: return state` (same as any unknown action) — acceptable, no test needed for a removed action type.
- Acceptance: `grep -n RETIREMENT src/lib/reducer.ts` returns nothing.

### T3. Update `src/lib/selectors.ts`: remove retirement clauses, fix `segmentSummaryCards`, add `assetClassOptions` (~25 min)
Depends on: T1.
- `visiblePositions` (lines 11-53): delete the `if (state.retirementFilter === 'Retirement') {...} else if (state.retirementFilter === 'Non-Retirement') {...}` block (lines 17-28). Category filter (line 12-15) and asset-class filter (30-36) and search (41-47) stay, in that order.
- `filteredPortfolioTotal` (lines 61-82): delete the matching retirement clause (lines 67-78). Category filter (62-65) stays; sum-reduce (81) stays.
- `segmentSummaryCards` (lines 190-211): replace body per decision 4 above — drop `getAccountsForCategory(state)` call and the category-join filter, keep only the retirement filter, feeding straight from `state.positions`.
- Add new exported selector `assetClassOptions(state: AppState): string[]` — same logic as `PositionsTable.tsx`'s current `useMemo` (dedupe `p.assetClassManualOverride || p.assetClass` across `state.positions`, sort alphabetically), placed near `allocationBars`/`getAccountsForCategory` (pick a spot consistent with file's existing ordering — e.g. right after `filteredPortfolioTotal`).
- `visibleTransactions` — confirm no retirement clause exists here (grep confirmed none) — leave untouched.
- Test cases (deferred to T8, this task is implementation only):
  - happy: `assetClassOptions` returns sorted unique classes for a mixed-class positions list.
  - edge: `assetClassOptions([])` (empty positions) returns `[]`.
  - edge: `segmentSummaryCards` with a position whose account isn't in category filter still counts it (this is the whole point of the change — verify test at T8 asserts this).
- Acceptance: `grep -n retirementFilter src/lib/selectors.ts` returns nothing; `grep -n "export function assetClassOptions" src/lib/selectors.ts` returns one line; `segmentSummaryCards`'s body no longer calls `getAccountsForCategory`.

### T4. Remove `retirementFilter` from `src/lib/persist.ts` (~5 min)
Depends on: T1.
- Delete line 64 (`retirementFilter: loaded.retirementFilter ?? defaults.retirementFilter,`) from whichever migration/defaulting function contains it (the one that reconstructs `AppState` from a loaded envelope, filling missing collections with `[]`/defaults per CLAUDE.md's migration-tolerance rule).
- Test cases (deferred to T13): a persisted envelope from an OLD version that still contains a `retirementFilter` key loads fine and simply ignores/drops it (no crash) — migration-tolerant per CLAUDE.md.
- Acceptance: `grep -n retirementFilter src/lib/persist.ts` returns nothing.

### T5. Remove category tabs from `src/components/Nav.tsx` (~10 min)
Depends on: none (independent of T1-T4, but do after T3 so `App.tsx` in T6 can pull the tabs markup across cleanly — sequence T5 before T6 regardless).
- Delete the `{state.view === 'dashboard' && (<div className="seg">...</div>)}` block, lines 61-84 (including its `{/* Category tabs (dashboard view) */}` comment).
- Delete the now-unused `categoryTabs` array (lines 28-33) and `handleCategoryChange` callback (lines 40-48) — both only referenced by the deleted block. Keep `settingsTabs` array and everything from line 86 (`{/* Settings tabs (settings view) */}`) onward untouched.
- `useCallback` import (line 1) may become unused if nothing else in the file uses it — check before removing the import (grep `useCallback` in the trimmed file; if zero remaining call sites, remove the import to keep `oxlint` clean).
- Test cases (deferred — no dedicated `Nav.test.tsx` exists per repo structure; covered by `App.test.tsx` in T9, which asserts the category seg no longer renders inside the nav DOM region specifically, and does render elsewhere).
- Acceptance: `grep -n "seg-opt" src/components/Nav.tsx` shows only the settings-tabs occurrences; `npx oxlint src/components/Nav.tsx` reports no unused-import/unused-var warnings.

### T6. Move category tabs into `src/App.tsx`, remove retirement-filter row, add asset-class seg (~25 min)
Depends on: T3, T5.
- Delete the `retirementFilters` array (lines 15-19).
- In the dashboard body (currently lines 266-312): after `<OverviewCard state={state} />` (line 270) and before the `<AllocationChart>` wrapper div (273-275), insert:
  ```tsx
  <div style={{ background: 'var(--color-divider)', margin: 'var(--space-6) 0' }} />
  <div className="seg" style={{ marginBottom: 'var(--space-6)' }}>
    {categoryTabs.map((tab) => (
      <label key={tab.value} className="seg-opt" onClick={() => dispatch({ type: 'SET_CATEGORY', category: tab.value })}>
        <input type="radio" name="category" checked={state.category === tab.value} readOnly />
        <span>{tab.label}</span>
      </label>
    ))}
  </div>
  ```
  where `categoryTabs` is the same 4-option array moved verbatim from the old `Nav.tsx` (`all`/`taxable`/`nonTaxable`/`taxDeferred` — All/Taxable/Non-Taxable/Tax-Deferred), declared as a local const in `App.tsx` (mirrors `retirementFilters`'s old placement style).
- Replace the retirement-filter-seg + `ImportDialog` row (lines 281-308) with an asset-class-seg + `ImportDialog` row: same flex wrapper (`justifyContent: 'space-between'`, etc.), left side now a `.seg` built from `assetClassOptions(state)` (imported from `../lib/selectors`) prefixed with `'All'`, each option dispatching `SET_ASSET_CLASS_FILTER` (name=`"assetClassFilter"`, `checked={state.assetClassFilter === opt}` — `'All'` option checked when `state.assetClassFilter === 'All'`). Right side: `<ImportDialog .../>` unchanged.
- Existing border-top divider (line 278) stays where it is, now sitting between `AllocationChart` and this new asset-class-seg + Import row (its position in the DOM order doesn't move — only what used to be below the retirement-filter row shifts).
- `PositionsTable` (line 311) stays last, unchanged prop signature.
- Test cases (deferred to T9): happy — category seg renders between overview and allocation, clicking a category tab dispatches `SET_CATEGORY`; happy — asset-class seg renders above positions table, clicking an option dispatches `SET_ASSET_CLASS_FILTER`; edge — zero positions in state still renders the asset-class seg with just an "All" option (no crash on empty `assetClassOptions([])`).
- Acceptance: `grep -n retirementFilter src/App.tsx` returns nothing; `grep -n "name=\"category\"" src/App.tsx` returns one hit (inside the new dashboard-body block, not inside a `Nav` import); `grep -n "name=\"assetClassFilter\"" src/App.tsx` returns one hit.

### T7. Strip filter UI out of `src/components/PositionsTable.tsx`, use shared selector (~15 min)
Depends on: T3.
- Delete the tag-pill filter block, lines 192-229 (`{/* Asset class filter tags + search */}` outer div's left-side pills sub-div — the "All" `<span>` and `assetClassOptions.map(...)` `<span>` pills) — keep the search `<div className="field">` (lines 231+) as the row's only remaining child. Simplify the row's flex wrapper if it no longer needs `justifyContent: 'space-between'` for two children (use judgment — a single child can just be the div directly, or keep the wrapper with the search box right-aligned per v8 markup; check `design/v8/...dc.html` line ~131-134 for exact resulting shape — it's just the field div now, no wrapping flex needed unless other siblings remain).
- Delete the local `assetClassOptions` `useMemo` (lines 129-132) and `handleAssetClassFilterClick` callback (134-142) — both now dead.
- Import `assetClassOptions` from `../lib/selectors` instead, call it once (`const assetClassOptions = assetClassOptions(state)` — rename local var if needed to avoid shadowing the import, e.g. `const existingAssetClasses = assetClassOptions(state)`) and pass that to `<PositionGroupOverlay existingAssetClasses={...} .../>` (line 366) exactly as before.
- Test cases (deferred to T10): happy — table renders with only the search box in its header row, no `.tag` pills; happy — `PositionGroupOverlay`'s asset-class override dropdown still lists the same classes as before (via the relocated selector) — existing `PositionGroupOverlay.test.tsx` coverage should catch a regression here without new tests, confirm in T12.
- Acceptance: `grep -n "tag-accent" src/components/PositionsTable.tsx` returns nothing; `grep -n "existingAssetClasses" src/components/PositionsTable.tsx` still shows the prop passed to the overlay.

### T8. Update `src/lib/selectors.test.ts` (~20 min)
Depends on: T3.
- Delete the dedicated retirement-filter-behavior tests (real logic, not just fixture fields):
  - `'visiblePositions: respects retirement filter'` (~line 300-337, ends around 337).
  - `'filteredPortfolioTotal: filters by retirement status only'` and its sibling `'...non-retirement status only'` (~lines 495-552 range, the two tests using `retirementFilter: 'Retirement'`/`'Non-Retirement'` and asserting `total).toBe(2000)`).
  - `'filteredPortfolioTotal: combines category and retirement filters'` (~lines 573-611, asserting the taxable+non-retirement combo).
- Do NOT delete `'filteredPortfolioTotal: ignores assetClassFilter'` (~lines 695-721) — unrelated, still valid after this change.
- Add new test cases for `segmentSummaryCards`'s changed behavior: happy — a position in an account outside the current `category` filter is still counted by `segmentSummaryCards(state, true)` as long as `account.retirement === true` (this is the regression-guard for decision 4 — set `state.category` to something that would have excluded the account under the old category-join logic, confirm the new result includes it anyway). Edge: `segmentSummaryCards(state, true)` with zero retirement accounts returns the zero-value card set (not a crash).
- Add new test cases for `assetClassOptions`: happy — mixed-class positions return sorted unique list; edge — empty positions array returns `[]`; edge — a position using `assetClassManualOverride` is deduped by its override value, not its base `assetClass` (mirrors existing allocation-selector convention).
- Acceptance: `npx vitest run src/lib/selectors.test.ts` passes with the new/removed tests; `grep -n retirementFilter src/lib/selectors.test.ts` returns nothing.

### T9. Update `src/App.test.tsx` (~15 min)
Depends on: T6.
- Delete `'should dispatch SET_RETIREMENT_FILTER when a retirement filter .seg-opt is clicked'` (~lines 264-286) and rewrite `'should render retirement filter .seg-opt labels'` (~lines 227-260) as a new test targeting the asset-class seg instead — e.g. `'should render asset-class filter .seg-opt labels'`, querying `input[name="assetClassFilter"]` instead of `input[name="retirementFilter"]`, asserting at least an "All" option renders. Add a companion `'should dispatch SET_ASSET_CLASS_FILTER when an asset-class filter .seg-opt is clicked'` test mirroring the deleted retirement one's click-and-assert-checked shape.
- `'should render both Retirement and Non-Retirement segment rows'` (~lines 228-238, uses `getAllByText`) stays — it tests `OverviewCard`'s segment clusters, unrelated to the removed filter, still valid.
- Add a new test: category seg (moved from Nav into the dashboard body) still renders and still dispatches `SET_CATEGORY` on click — confirm no existing test already covers this before adding (grep `SET_CATEGORY` in the file first); if one exists and merely asserted it lived inside the nav DOM region, adjust its query instead of duplicating.
- Test cases: happy (asset-class seg renders + dispatches), happy (category seg still works after relocation), edge (Nav region no longer contains category `.seg` — assert `document.querySelector('.nav')` does not contain `input[name="category"]` after relocation, to guard against a copy-paste-without-delete mistake).
- Acceptance: `npx vitest run src/App.test.tsx` passes; `grep -n retirementFilter src/App.test.tsx` returns nothing.

### T10. Strip `retirementFilter` fixture field from `src/components/PositionsTable.test.tsx` (~10 min)
Depends on: T1.
- Remove the `retirementFilter: 'All',` (or `'Retirement'` at the one line-1555 occurrence) line from all ~23 test-state object literals. No other change — grep-confirmed no test in this file exercises retirement-filter *behavior* (that's selectors.test.ts's job) or the tag-pill click UI being removed in T7.
- Test cases: none new; this is a mechanical fixture cleanup. Verify via `npm run test` (T15) that removing the field doesn't orphan a test that implicitly depended on filtering (unlikely, since `visiblePositions`/`filteredPortfolioTotal` no longer read the field at all after T3).
- Acceptance: `grep -n retirementFilter src/components/PositionsTable.test.tsx` returns nothing; `npx vitest run src/components/PositionsTable.test.tsx` passes.

### T11. Strip `retirementFilter` fixture field from `src/components/ClosedPositionsTable.test.tsx` (~5 min)
Depends on: T1.
- Remove the `retirementFilter: 'All',` line from all 5 test-state literals (lines 50, 91, 137, 182, 234). Fixture-only, no logic change.
- Acceptance: `grep -n retirementFilter src/components/ClosedPositionsTable.test.tsx` returns nothing; `npx vitest run src/components/ClosedPositionsTable.test.tsx` passes.

### T12. Fix `src/components/PositionGroupOverlay.test.tsx` (~10 min)
Depends on: T1.
- Remove the `retirementFilter: 'All',` fixture line (line 64).
- Line 1112 (`testState.retirementFilter = 'Non-Retirement'`) is a real mutation inside a test body, not just a fixture literal — read the surrounding test (find its `it(...)` block) to determine what it's actually verifying. Since `retirementFilter` no longer exists on `AppState`, this line must be deleted; if the test's assertion afterward specifically depended on that mutation affecting rendered output (e.g. checking a retirement-scoped label), remove or adjust that assertion too — if the test becomes vacuous/redundant without the mutation, delete the whole `it(...)` block instead of leaving a no-op test. Use judgment based on what the test name/surrounding asserts once read.
- Also re-verify (per T7's note) that this file's existing asset-class-override-dropdown test(s) still pass unmodified now that `existingAssetClasses` is sourced from the new `assetClassOptions` selector instead of `PositionsTable`'s local `useMemo` — same values, different source, should be a no-op for this test file.
- Acceptance: `grep -n retirementFilter src/components/PositionGroupOverlay.test.tsx` returns nothing; `npx vitest run src/components/PositionGroupOverlay.test.tsx` passes.

### T13. Fix `src/lib/persist.test.ts` (~10 min)
Depends on: T4.
- Remove fixture-only `retirementFilter: 'All',` lines (142, 430).
- Delete the real round-trip assertion pair at lines 238-239 (write) and 256 (`expect(loaded?.retirementFilter).toBe('Retirement')`) — the whole scenario this sub-test covers (retirement-filter persists through save/load) no longer applies; if the surrounding `it(...)` block tests multiple fields in one assertion batch, remove only the `retirementFilter`-specific lines and keep the rest of the round-trip test intact for the other fields it covers.
- Test cases: keep migration-tolerance coverage — an old envelope shape containing a stray `retirementFilter` key should still load without throwing (per CLAUDE.md's persist.ts migration-tolerance rule); if no such test currently exists, no need to add one (T4's persist.ts change with `??` defaulting removed means the loader simply won't read that key at all, which is inherently tolerant — nothing to newly test).
- Acceptance: `grep -n retirementFilter src/lib/persist.test.ts` returns nothing; `npx vitest run src/lib/persist.test.ts` passes.

### T14. Fix `src/lib/drive.test.ts` (~5 min)
Depends on: T1.
- Remove the `retirementFilter: 'All',` fixture line (line 283). Fixture-only, no logic change (this file's real focus is the `folderPath` pinning test per CLAUDE.md's drive.ts note — untouched).
- Acceptance: `grep -n retirementFilter src/lib/drive.test.ts` returns nothing; `npx vitest run src/lib/drive.test.ts` passes.

### T15. Run full test suite, confirm all pass (~10 min)
Depends on: T2, T7, T8, T9, T10, T11, T12, T13, T14.
- Run `npm run test` (vitest run, full suite) from the worktree root.
- Also run `npm run build` (tsc -b + vite build) to catch any type errors from the `AppState` field removal that tests alone might not surface (e.g. a stray `state.retirementFilter` read somewhere not caught by the grep passes above).
- If anything fails: fix root cause (not a workaround), re-run both commands until green. Do not proceed to T16 until both are clean.
- Test cases: N/A — this is the verification gate itself. Acceptance: `npm run test` exits 0, all suites pass, zero skipped-due-to-error; `npm run build` exits 0.

### T16. Update `product-behavior.md` (~20 min)
Depends on: T15.
- **Layout** section (line 9): change `Top to bottom: Nav → OverviewCard (3-cluster layout) → AllocationChart (2-column grid) → divider → retirement filter .seg control + "Import" button row → PositionsTable.` to reflect new order: `Nav → OverviewCard (3-cluster layout) → zero-height divider → category .seg tabs → AllocationChart (2-column grid) → divider → asset-class filter .seg control + "Import" button row → PositionsTable.`
- **Nav** section (line 16): remove the "Category tabs" bullet entirely (dashboard view no longer has any nav-level filter control) — keep Brand/Settings tabs/Sync icon/gear bullets as-is.
- **Overview card** section (line 29): update "Card reflects the current category filter only; retirement-segment metrics are derived separately..." — the segment clusters (`Retirement`/`Non-Retirement`) no longer respect the category filter at all (per decision 4); rephrase to state segment cards are retirement-only, ignoring category, while the `All Together` cluster (`summaryCards()`) still respects category.
- **Positions table** section (lines 37, 39, 41): remove the "**Retirement filter**" paragraph (line 37) entirely. Line 39: remove "% of Portfolio reflects positions matching both the current category filter and retirement filter" → now category filter only. Line 41 ("**Filters**: ... + category + retirement filter (.seg control above) all compose"): drop "+ retirement filter (.seg control above)"; also note the asset-class filter's control is now a `.seg` (not tag pills) and lives in the header row above the table (in `App.tsx`), not inside `PositionsTable` itself.
- Read the full file after edits (per CLAUDE.md's "full-file review after major changes" rule) — check no other section (Nav, Settings page, CSV import) references retirement filter or the old tag-pill asset-class UI, and that cross-references between sections stay consistent.
- Acceptance: `grep -in "retirement filter" product-behavior.md` returns nothing; `grep -in "tag.*asset class\|asset class.*tag" product-behavior.md` returns nothing (old pill-based description gone); the Layout section's one-liner matches the new actual DOM order.

### T17. Update `design.md` (~20 min)
Depends on: T15.
- **AppState interface** code block (~lines 61-83): remove `retirementFilter: 'All' | 'Retirement' | 'Non-Retirement'` line.
- **State management** bullet listing helper functions (~line 85): remove `setRetirementFilter` from the list.
- **Action types** list (~line 91): remove `SET_RETIREMENT_FILTER`.
- **Component tree** (~lines 95-113): `Nav` line (101) — remove "category seg tabs" language for dashboard view (it no longer renders any dashboard-specific control); dashboard body lines (102-107) — add the category `.seg` as a new line between `OverviewCard` and `AllocationChart`; the "filter & import row" line (105) — change from "retirement .seg control" to "asset-class .seg control" description; `PositionsTable` line (107) — remove "filtered by retirement filter" language, note it still groups by symbol+effectiveAssetClass and now only reads asset-class filter for its own filtering (category handled upstream via selector).
- **Selectors** section (~lines 145-152): `visiblePositions` bullet — remove "retirement" from the pipeline description (`category → asset-class filter → search → sort`). `filteredPortfolioTotal` bullet — same, drop "retirement". `segmentSummaryCards` bullet — rewrite to state it's retirement-only now (no category scoping), per decision 4. Add a new bullet for `assetClassOptions(state)` — one-line description matching its actual behavior (dedupe + sort effective asset classes across all positions).
- Directory structure tree (~lines 9-51): no changes needed (no new/removed files, only function-level edits inside existing files) — confirm nothing there mentions retirementFilter/asset-class-tags specifically before skipping.
- Read the full file after edits (CLAUDE.md's full-file-review rule) — check the "Component tree" ASCII diagram's prop lists, "Props convention" paragraph, and "Data flow"/"Design patterns" sections don't still reference retirement filtering or contradict the new component tree shape.
- Acceptance: `grep -in retirementFilter design.md` returns nothing; `grep -in SET_RETIREMENT_FILTER design.md` returns nothing; Component tree ASCII diagram shows category seg between `OverviewCard` and `AllocationChart`, and asset-class seg in the filter/import row (not inside `PositionsTable`).

### T18. Commit (~5 min)
Depends on: T15, T16, T17.
- `git add` the specific changed files (not `-A`): `src/components/Nav.tsx`, `src/App.tsx`, `src/lib/state.ts`, `src/lib/reducer.ts`, `src/lib/selectors.ts`, `src/lib/persist.ts`, `src/components/PositionsTable.tsx`, `src/App.test.tsx`, `src/lib/selectors.test.ts`, `src/components/PositionsTable.test.tsx`, `src/components/ClosedPositionsTable.test.tsx`, `src/components/PositionGroupOverlay.test.tsx`, `src/lib/persist.test.ts`, `src/lib/drive.test.ts`, `product-behavior.md`, `design.md`.
- Commit message (via heredoc, per repo convention): summarize the v8 layout move (category tabs relocated to dashboard body, retirement filter removed, asset-class filter converted from tag pills to a relocated `.seg` control, segment cards decoupled from category), ending with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Do NOT push. Do NOT use `--no-verify`/`--amend`.
- Acceptance: `git log -1 --stat` in the worktree shows exactly the intended file list, `git status` shows a clean tree.

### T19. Clean up worktree (~5 min)
Depends on: T18.
- `cd /Users/mdoraiswamy/owa/portfolio` (back to the main worktree).
- `git worktree remove ../worktree-dashboard-v8-layout`.
- Acceptance: `git worktree list` no longer shows the `dashboard-v8-layout` entry; the `../worktree-dashboard-v8-layout` directory no longer exists on disk. The `dashboard-v8-layout/main` branch itself still exists (worktree removal doesn't delete the branch) — leave it for the caller to merge/PR separately; this plan does not include a merge/push step.

## Test strategy

- Unit/selector-level: `src/lib/selectors.test.ts` is the primary place asserting the *behavioral* change (retirement filter gone, `segmentSummaryCards` category-independent, new `assetClassOptions` selector) — see T8.
- Component-level: `src/App.test.tsx` asserts the relocated controls render in the right place and dispatch the right actions — see T9. Other component test files (`PositionsTable.test.tsx`, `ClosedPositionsTable.test.tsx`, `PositionGroupOverlay.test.tsx`) only need fixture cleanup (T10-T12) since none of them exercised retirement-filter *behavior* directly (that's `selectors.test.ts`'s job) — this was confirmed by grep during discovery, not assumed.
- Persistence: `persist.test.ts` (T13) confirms the removed field doesn't break save/load round-trips or migration tolerance.
- Full-suite gate: T15 runs `npm run test` + `npm run build` before any doc/commit work, per CLAUDE.md's "commit only once tests pass and docs are updated" rule.
- No new component test file is added (no `Nav.test.tsx` exists today per repo structure; not introduced here — Nav's post-change behavior is fully covered by removing its category-tab tests' assumptions, if any existed, and relying on `App.test.tsx` for the relocated control).

## Risks

- **`selectors.test.ts` line numbers will drift** as earlier tasks in this same file are deleted — T8 must re-grep/re-locate each test by name (not blindly trust the line numbers cited above) before deleting, since deleting a 30-line block shifts everything below it.
- **`PositionGroupOverlay.test.tsx` line 1112 mutation** might be load-bearing for an assertion further down that isn't obvious from a single grep hit — T12 explicitly calls for reading the whole surrounding test before deciding to delete vs. adjust, to avoid silently breaking real overlay-dropdown coverage.
- **Divider semantics**: the new zero-height spacer div (decision 2) renders no visible line by design — if this is confused for a rendering bug during manual QA, the CLAUDE.md rule "implement literally per the CSS spec" applies; don't second-guess it back into a `border-top` divider to "fix" a phantom bug.
- **`assetClassOptions` selector introduces a public API surface** (`src/lib/selectors.ts`) that both `App.tsx` and `PositionsTable.tsx` now depend on — a future asset-class-related change must update both call sites; not a risk to this plan's execution, but worth flagging in `design.md`'s selector bullet so it doesn't silently drift.
- **`segmentSummaryCards`'s behavior change is a real product behavior change** (segment cards now include positions from ALL categories, not just the selected one) — this is explicitly locked by the user's resolved requirement 3 ("match v8 JS exactly"), not a bug to be "caught" and reverted during T15's test run; if a pre-existing test elsewhere asserts the OLD category-scoped behavior and isn't in the enumerated list above, treat it as a stale test to fix, not a regression to revert.
- **Reference-doc drift risk**: `design.md`'s Component tree ASCII diagram is dense and easy to under-edit (e.g., updating the `PositionsTable` line but forgetting the "filter & import row" line right above it) — T17 explicitly calls for a full-file re-read specifically to catch this.

## Open questions / judgment calls made during discovery

- Exact resulting flex-wrapper shape for `PositionsTable.tsx`'s now-single-child header row (T7) — left as an implementer judgment call bounded by "check v8 html line ~131-134 for exact shape," since the original wrapper's `justifyContent: 'space-between'` becomes moot with only the search box left.
- Whether `App.test.tsx`'s `'should render both Retirement and Non-Retirement segment rows'` test needs any change — determined it does NOT (tests `OverviewCard` output, unrelated to the filter-removal), documented in T9 rather than silently left alone, so a future reader doesn't wonder if it was missed.
