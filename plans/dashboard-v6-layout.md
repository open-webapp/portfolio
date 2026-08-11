# Dashboard v6 Layout Rework

Goal: rework the Dashboard page layout to match `design/v6/project/Portfolio Dashboard.dc.html`. No behavior changes to Settings, CSV import wizard, position editing, or Drive sync. Positions-only dashboard (Transactions tab removed from rendering). Read `design/v6/README.md` and the `.dc.html` file in full before starting — this plan references specific line numbers in both which may drift if the design file changes.

Supersedes the relevant "Layout"/"Nav"/"Summary cards"/"Segment summary card rows"/"Allocation chart" sections of `product-behavior.md` and the matching "Component tree" section of `design.md` once done (updated in T11).

## Decisions (resolved up front, do not re-litigate during implementation)

1. **OverviewCard component split**: retire `SummaryCards.tsx` and `SegmentSummaryCards.tsx`; add one new `src/components/OverviewCard.tsx` that renders the single 3-cluster card (`All Together` / `Retirement` / `Non-Retirement`). It takes `{ state: AppState }`, and internally calls `summaryCards(state)` (existing selector — use only the 3 non-Day-Change cards, see T3) and `segmentSummaryCards(state, true/false)` (existing selector, unchanged) — no new selector code, no recomputation. This matches `src/components/` convention (one file per rendered unit) and cleanly removes the two old per-row corner-marked cards in favor of v6's one-card-three-clusters shape.
2. **`.nav-brand` margin override**: `styles.css` must stay byte-identical to the design bundle's CSS (CLAUDE.md), and `.nav-brand` has no inline margin in the current stylesheet. Do NOT edit `styles.css`. Apply `style={{ marginRight: 'var(--space-5)' }}` directly on the `<div className="nav-brand">` in `Nav.tsx` (mirrors the v6 mock's own `style="margin-right:var(--space-5) !important;"` inline override — component-level inline style, not a class change).
3. **Test coverage for SummaryCards/AllocationChart/Nav (currently no dedicated test files)**: do not add new dedicated `OverviewCard.test.tsx` / `AllocationChart.test.tsx` / `Nav.test.tsx` files as part of this rework — the existing pattern for these three is coverage-via-`App.test.tsx` integration tests (they've never had colocated tests, and this plan already requires touching `App.test.tsx` extensively for the layout change). Do extend `App.test.tsx` assertions to cover the new Overview card's 3-cluster structure and the new `.seg` retirement filter, per T10. If the user wants dedicated component tests later, that's a separate follow-up, not in scope here.
4. **`AppState.tab` / `SET_TAB` / `TransactionsTable` plumbing**: NOT removed. The task's dead-code cleanup instruction is scoped explicitly to `range` (item 3 in the task). `tab`, `SET_TAB`, `setTab`, `TransactionsTable.tsx`, `visibleTransactions()` all stay exactly as-is in `state.ts`/`reducer.ts`/`selectors.ts`/`components/` — only the Dashboard's *rendering* of the tab selector and the transactions branch in `App.tsx` is removed (per the task's explicit scope note). `state.tab` becomes inert (still persisted, still defaults to `'positions'`, never read after this change since `App.tsx` no longer branches on it) — this is intentional, not an oversight.
5. **Retirement filter tags → `.seg` control**: the tags array (`retirementFilters` in `App.tsx`) moves as-is (value/label pairs) into a `.seg`/`seg-opt` radio rendering, same pattern as `Nav.tsx`'s category tabs. Dispatch stays `SET_RETIREMENT_FILTER`.

## Grep findings (confirms what's truly dead vs. what must stay)

- `visibleTransactions` (`src/lib/selectors.ts:88`): used only by `TransactionsTable.tsx`. `TransactionsTable.tsx` itself is used only by `App.tsx`. Per Decision 4, `TransactionsTable` stays mounted in source but its render call is deleted from `App.tsx`'s dashboard body — so after this change `visibleTransactions`/`TransactionsTable` become effectively dead code paths in the running app, but per the task's explicit scope note ("do NOT delete `TransactionsTable.tsx`... since transactions still feed G/L calcs") they are NOT deleted. No action needed beyond removing the `App.tsx` render call and the `.seg` tab selector.
- `state.range` / `SET_RANGE` / `setRange`: used in `Nav.tsx` (the range `<select>`), `src/lib/state.ts` (field + `setRange` helper), `src/lib/reducer.ts` (`SET_RANGE` case), `src/lib/selectors.ts` (`totalValueSeriesInRange`, consumed only by `performanceLinePoints`), `src/lib/persist.ts` (`range: loaded.range ?? defaults.range` migration line). `totalValueSeriesInRange`/`performanceLinePoints` have ZERO callers outside `selectors.ts`/`selectors.test.ts` (confirmed by grep — `performanceLinePoints` is already dead per design.md's own note "currently unused by any component"). Safe to delete all of the above. Test-fixture-only references to a `range: '...'` field appear in (must all be edited, not source, but part of the AppState-shaped test fixtures that will fail to typecheck once the field is removed from the interface): `src/lib/drive.test.ts` (1), `src/lib/persist.test.ts` (7 — includes migration-semantics tests specifically about `range`, needs judgment call, see T8), `src/components/ClosedPositionsTable.test.tsx` (5), `src/components/PositionsTable.test.tsx` (23), `src/components/PositionGroupOverlay.test.tsx` (1), `src/components/SegmentSummaryCards.test.tsx` (1 — this whole file is also being deleted, see T3/T9).
- `watchlist` grep: still zero matches in `src/` — no action needed, just don't reintroduce it.

## Out of scope

- `Settings.tsx` / `SettingsPage` — not touched at all, despite v6 mock's placeholder Settings view.
- `TransactionsTable.tsx`, `transactionsImport.ts`, `Transaction` type, `visibleTransactions()` selector — not deleted, not modified.
- `AppState.tab`, `SET_TAB`/`setTab` — not deleted (Decision 4).
- CSV import wizard, `PositionGroupOverlay`, `PositionsTable` internals (columns/sorting/grouping), `ClosedPositionsTable` — unchanged except where the retirement filter's container markup shifts (T7).
- Drive sync, password gate, encryption — untouched.

## Tasks

### T0 — set up isolated worktree
Dependencies: none.
Create a new git worktree so this work doesn't touch the main checkout:
```
git worktree add ../worktree-dashboard-v6 -b dashboard-v6/layout-rework
cd ../worktree-dashboard-v6
```
Acceptance: `git worktree list` shows the new worktree; `git branch --show-current` inside it prints `dashboard-v6/layout-rework`. All subsequent tasks run inside this worktree.

### T1 — remove `range` plumbing from `state.ts` / `reducer.ts` / `selectors.ts` / `persist.ts`
Dependencies: T0.
- `src/lib/state.ts`: remove `range: string` field from `AppState` interface; remove `range: '1y',` from `initialState()`; delete the `setRange()` function.
- `src/lib/reducer.ts`: delete the `case 'SET_RANGE':` block.
- `src/lib/selectors.ts`: delete `totalValueSeriesInRange()` and `performanceLinePoints()` (confirmed zero callers outside selectors.ts/selectors.test.ts by grep above). Keep `totalValueSeries()` — still used by `summaryCards()`'s Day Change... wait, Day Change is being dropped (T2), recheck: `totalValueSeries()` is called by `summaryCards()` for Day Change math. Once Day Change is dropped in T2, re-grep `totalValueSeries` before deciding whether to keep it — `filteredPortfolioTotal`/`allocationBars` don't use it, only `summaryCards()`'s Day Change branch does. If T2 removes that branch, `totalValueSeries()` may become dead too; re-grep at that point and delete it in T2 if so (don't delete here — T1 only touches range-specific functions).
- `src/lib/persist.ts`: remove the `range: loaded.range ?? defaults.range,` line from `coalesceWithDefaults()`.
- Test: `npx vitest run src/lib/selectors.test.ts src/lib/state.test.ts src/lib/reducer.test.ts` will fail to compile until T8 (test fixture cleanup) — that's expected; don't chase these failures yet, just confirm the source files above have no other range references via `grep -rn "range" src/lib/state.ts src/lib/reducer.ts src/lib/persist.ts src/lib/selectors.ts` (should show zero hits, or only unrelated substring matches like "arrange" — verify none exist).
Acceptance: grep for `\brange\b` (word-boundary) in the four files above returns nothing; `tsc -b` will still fail until later tasks (test fixtures, Nav.tsx) — that's fine, don't run full typecheck until T9.

### T2 — drop Day Change from `summaryCards()`, used only for the new Overview's "All Together" cluster
Dependencies: T1.
- `src/lib/selectors.ts`: edit `summaryCards()` to return only 3 cards (Total Value, Total Gain/Loss, Amount Invested) — i.e. just call and return `valueGlInvestedCards(state.positions)` directly, deleting the Day Change computation block (series lookup, `dayChangeCard` construction, the 4-element return array). This makes `summaryCards()` structurally identical in shape to `segmentSummaryCards()` (which is correct — v6's "All Together" cluster uses the same 3-card shape).
- Re-grep `totalValueSeries` (per the note left in T1): if `summaryCards()` was its only remaining caller, delete `totalValueSeries()` too from `selectors.ts`. Re-grep `PortfolioSnapshot` and `state.snapshots` usage elsewhere (e.g. `positionsImport.ts` still writes snapshots — that's fine, untouched) to confirm nothing else in `selectors.ts`/components reads `totalValueSeries` directly.
- Test: update `src/lib/selectors.test.ts`'s `summaryCards` test cases — find tests asserting a 4-card array / a `'Day Change'` label / `dayChangeStr`/`N/A` semantics and rewrite them to assert the 3-card shape (mirror how `segmentSummaryCards` tests already assert 3 cards). Do not delete the Day Change test coverage silently — the plan is explicit that Day Change is a removed *feature*, so its dedicated test cases (whichever assert `'Day Change'` specifically, the `< 2 snapshot dates → N/A` case, the sign-coloring case) should be deleted, not adapted, since the feature no longer exists.
Acceptance: `npx vitest run src/lib/selectors.test.ts` passes (after T1+T2 edits; may still show unrelated range-test failures until T8 — track separately). `grep -n "Day Change" src/lib/selectors.ts` returns nothing.

### T3 — new `OverviewCard.tsx`, delete `SummaryCards.tsx` + `SegmentSummaryCards.tsx`
Dependencies: T2.
- Create `src/components/OverviewCard.tsx`:
  - Props: `{ state: AppState }`.
  - Outer: single `<div className="card blueprint elev-sm">` + 4 `<i className="corner ..." />` marks (existing pattern, copy from `AllocationChart.tsx`).
  - Inner: `display:grid; gridTemplateColumns:'repeat(3,1fr)'; gap:'var(--space-5)'` (v6 line 43).
  - Cluster 1 ("All Together"): kicker div (`text-muted`, `fontSize:10px`, `letterSpacing:0.08em`, `textTransform:uppercase`, `marginBottom:6px` — v6 line 45) + `display:flex; gap:var(--space-4)` row of `summaryCards(state)` (now 3 cards after T2), each cell: `card-kicker` (fontSize 10px per v6 line 49) + value line (`fontFamily:var(--font-heading); fontSize:15px; fontWeight:600; color:{card.color}`, with `card.sub` rendered inline via `<span className="card-meta">` at `fontSize:10px; marginLeft:4px` when present — v6 line 50).
  - Cluster 2/3 ("Retirement" / "Non-Retirement"): same kicker + flex-row shape, sourced from `segmentSummaryCards(state, true)` / `segmentSummaryCards(state, false)` — no `sub` rendering needed here since `segmentSummaryCards` cards can still have `sub` (Total Gain/Loss %) per its existing selector contract; render it the same way as cluster 1 for consistency (v6's segment loop at line 59-64 does NOT show `sub` in the mock's inner markup — read v6 lines 55-67 again before implementing: the segment cards in v6 render ONLY `card-kicker` + value line, no `sub`/percent line shown at all, unlike cluster 1 which does show `sub`). Match v6 exactly: cluster 1 shows `sub`, clusters 2/3 do not display `sub` in the value line (the underlying `segmentSummaryCards()` selector data still includes `sub` — just don't render it in this component's segment-cluster branch, matching the visual mock).
  - Sizes: card-kicker override to `fontSize:10px` (v6 lines 49/61 both override the class default of 10px — actually `.card-kicker` in styles.css is already `font-size:10px` per grep, so no override needed here — verify against `src/styles/styles.css:210` before writing, drop the inline override if redundant).
- Delete `src/components/SummaryCards.tsx` and `src/components/SegmentSummaryCards.tsx`.
- Delete `src/components/SegmentSummaryCards.test.tsx` (component no longer exists) — its test *intent* (3-card row per retirement segment, kicker label, color coding) is preserved via new assertions added to `App.test.tsx` in T10, not via a new dedicated file (Decision 3).
- Test: none yet at this task (component-level rendering verified via App.test.tsx in T10) — do a manual `npx tsc -b` sanity pass is deferred to T9; for now just confirm no remaining imports of the deleted files: `grep -rln "SummaryCards\|SegmentSummaryCards" src` should show only `OverviewCard.tsx` (internal selector import names are fine, e.g. `import { summaryCards, segmentSummaryCards } from '../lib/selectors'` — those are the selector functions, not the deleted components; make sure the grep distinguishes component files from selector function names, e.g. grep specifically for `from '\./SummaryCards'` / `from '\./SegmentSummaryCards'` style imports).
Acceptance: `src/components/SummaryCards.tsx`, `src/components/SegmentSummaryCards.tsx`, `src/components/SegmentSummaryCards.test.tsx` no longer exist; `src/components/OverviewCard.tsx` exists and imports `summaryCards`/`segmentSummaryCards` from `../lib/selectors` (no recomputation).

### T4 — restructure `AllocationChart.tsx` to 2-column grid + thinner bar
Dependencies: none (independent of T1-T3; can run in parallel with them, but sequenced here for clarity — no shared files).
- `src/components/AllocationChart.tsx`: wrap the `bars.map(...)` output in `<div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:'var(--space-3) var(--space-6)' }}>` (v6 line 75).
- Per-bar markup: label + value inline on one line (v6 line 78-79: `<span>{label} <span class="text-muted" style="font-size:11px;">{value}</span></span>` then pct on the right of the same flex row), replacing the current stacked label-then-value-below layout (current `AllocationChart.tsx` lines 42-47 put `bar.value` in a `<div>` below the label — change to inline `<span>`).
- Bar height: change `height: '8px'` → `height: '6px'` (current line ~54; v6 line 82 uses 6px).
- Card title / corner marks / outer card wrapper: unchanged.
- Test: no dedicated `AllocationChart.test.tsx` exists (Decision 3 — not adding one); verify visually via `App.test.tsx`'s existing `expect(screen.getByText('Allocation')).toBeTruthy()` assertion (already present, still valid, no new assertion strictly required, but T10 may add a bar-shape smoke check if convenient).
Acceptance: `AllocationChart.tsx` renders a 2-column grid; bar height is 6px; label+value render on one line via inline `<span>` nesting (matches v6 lines 76-87 structure).

### T5 — remove Nav's date-range `<select>`, restyle Nav gear icon, `.nav-brand` margin
Dependencies: T1 (range plumbing must be gone from `state.ts` before `Nav.tsx` stops referencing `state.range`).
- `src/components/Nav.tsx`:
  - Delete `rangeOptions` array, `handleRangeChange`, and the `<select className="input" ...>` block entirely (current lines 20-25, 37-45, 81-93).
  - Add `style={{ marginRight: 'var(--space-5)' }}` to the `<div className="nav-brand">` (Decision 2).
  - Replace the `⚙️` emoji button contents with the SVG gear icon from v6 lines 31 (`viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"` — circle + path exactly as in the v6 markup, converted to JSX attribute casing `strokeWidth`/`strokeLinecap`/`strokeLinejoin`, matching the convention already used in `PositionsTable.tsx`/`ImportDialog.tsx`). Keep the existing button's `onClick`/`title="Settings"`/hover-color behavior — only the icon child changes from text emoji to `<svg>`.
- Test: no dedicated `Nav.test.tsx` (Decision 3). `App.test.tsx`'s `screen.getByTitle('Settings')` lookup still works unchanged since `title` attribute is untouched.
Acceptance: `grep -n "range\|⚙️" src/components/Nav.tsx` returns nothing; gear button renders an `<svg>` child; `.nav-brand` has inline `marginRight`.

### T6 — remove Transactions tab rendering + portfolio header block from `App.tsx`, mount `OverviewCard`
Dependencies: T3, T5.
- `src/App.tsx`:
  - Delete the "Portfolio header" block (kicker `Portfolio` + `<h1>Ledger</h1>`, current lines 191-204).
  - Replace the `<SummaryCards state={state} />` + two `<SegmentSummaryCards .../>` lines (207-211) with a single `<OverviewCard state={state} />`; add the import, remove the `SummaryCards`/`SegmentSummaryCards` imports.
  - Delete the "Tabs row" block's Positions/Transactions `.seg` selector (current lines 227-253) — keep the `ImportDialog` mount but relocate it (see T7).
  - Delete the `{state.tab === 'transactions' && <TransactionsTable .../>}` line (289) and its now-orphaned `TransactionsTable` import.
  - Change `{state.tab === 'positions' && <PositionsTable ... />}` to unconditional `<PositionsTable state={state} dispatch={dispatch} />` (no `state.tab` gate — Positions is the only view now).
- Test: covered by T10's `App.test.tsx` rewrite (this task doesn't run tests standalone since the file won't compile cleanly until T7 also lands — both touch `App.tsx`'s same render block).
Acceptance: `grep -n "Transactions\|Portfolio</div>\|<h1>Ledger" src/App.tsx` (adjust pattern to actual JSX) shows no remaining tab-selector or header-block JSX; `OverviewCard` is imported and rendered once.

### T7 — divider + retirement `.seg` filter + Import button row in `App.tsx`
Dependencies: T6 (same file, same region — do in one sitting/commit-worthy chunk, but tracked as a separate task for clarity of acceptance criteria).
- Directly below the `<AllocationChart>` render, add the divider: `<div style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 'var(--space-5)', marginTop: 'var(--space-6)' }} />` (v6 line 91).
- Below the divider, add one row: `display:flex; justifyContent:space-between; alignItems:center; gap:var(--space-3); marginBottom:var(--space-4); flexWrap:wrap` containing:
  - Left: `.seg` control with `retirementFilters.map(...)` rendered as `<label className="seg-opt"><input type="radio" name="retirementFilter" checked={state.retirementFilter === filter.value} readOnly /><span>{filter.label}</span></label>`, `onClick` on the label dispatching `SET_RETIREMENT_FILTER` (same pattern as `Nav.tsx`'s category `.seg`) — replaces the old `.tag` pills block entirely (old lines 259-283 in `App.tsx`, gated on `state.tab === 'positions'` — that gate is now removed since Positions is unconditional).
  - Right: the existing `<ImportDialog state={state} dispatch={dispatch} onClose={() => {}} />` mount, moved here from the old tabs row.
- `PositionsTable` render stays directly below this row, unchanged.
Acceptance: `App.tsx` renders, top to bottom, inside the dashboard body: `OverviewCard` → `AllocationChart` → divider → (retirement `.seg` left, Import button right) → `PositionsTable`. `grep -n "tag-accent\|className=\"tag" src/App.tsx` returns nothing (old pill markup fully replaced by `.seg-opt`).

### T8 — clean up `range` field from test fixtures
Dependencies: T1.
- Remove the `range: '...'` line from every `AppState`-shaped literal in: `src/lib/drive.test.ts` (1 occurrence), `src/components/ClosedPositionsTable.test.tsx` (5), `src/components/PositionsTable.test.tsx` (23), `src/components/PositionGroupOverlay.test.tsx` (1). These are pure fixture cleanups — the field is gone from the type, so TS will error on excess/unknown property until removed; no test *behavior* changes.
- `src/lib/persist.test.ts` (7 occurrences) needs judgment, not blind deletion — read each of the 7 surrounding tests first:
  - Fixture-only occurrences (state literal just needs a valid `AppState` shape, value like `'1y'` is incidental) → delete the `range:` line, same as above.
  - Any test whose *name or assertions specifically exercise range migration/coalescing* (e.g. asserting that a legacy/partial blob missing `range` gets defaulted, or that an odd stored value like `'5y'` round-trips) → since `range` no longer exists on `AppState`, that specific migration scenario is gone; either (a) delete the test if its sole purpose was range-migration semantics with no other assertions worth keeping, or (b) repoint the same test to exercise migration-tolerance on a *different* still-existing optional-ish field (e.g. `customInstitutions` or `retirementFilter`) if the test's real intent was "coalesceWithDefaults fills in missing fields" generically — use judgment per-test, don't mechanically strip. Flag which choice was made in the commit message /PR description.
- `src/lib/selectors.test.ts`: delete the `totalValueSeriesInRange` describe/it blocks (3 tests, lines ~578-624 per earlier read) and the `performanceLinePoints` describe/it blocks (4 tests, lines ~319-370, ~531, ~626-648) entirely — these functions no longer exist (T1). Remove their imports from the top of the file too.
Acceptance: `npx vitest run src/lib/persist.test.ts src/lib/selectors.test.ts src/components/ClosedPositionsTable.test.tsx src/components/PositionsTable.test.tsx src/components/PositionGroupOverlay.test.tsx src/lib/drive.test.ts` passes with zero references to `range` remaining (`grep -rn "\brange\b" <those files>` returns nothing except unrelated substrings if any).

### T9 — rewrite `App.test.tsx`'s dashboard-layout assertions
Dependencies: T6, T7, T8.
- `renderUnlockedApp()` helper currently waits for `screen.getByText('Positions')` (a text label that no longer renders anywhere — the Positions/Transactions `.seg` is gone and there's no standalone "Positions" heading in v6). Change the wait condition to something guaranteed present post-rework, e.g. `screen.getByText('Show Closed Positions')` (unconditionally rendered by `PositionsTable`, confirmed via grep) or `screen.getByText('Allocation')` (from `AllocationChart`'s card title, unconditional). Pick one and use it consistently.
- `'should render dashboard view by default with Nav and SummaryCards'`: rename/update — assert `OverviewCard`'s presence (e.g. `screen.getByText('All Together')`) instead of the old `Positions`/`Transactions` seg text; keep the `Allocation` assertion; keep the "Performance chart should NOT render" assertion (still true, unrelated to this rework).
- `'should switch to settings page...'` / `'should return to dashboard...'`: replace `screen.getByText('Positions')`/`screen.queryByText('Transactions')` assertions with the new wait-target text (e.g. `Allocation` or `Show Closed Positions`), since those are the durable markers now.
- `'should render both Retirement and Non-Retirement segment rows'`: still valid conceptually (now sourced from `OverviewCard`'s two segment clusters) — update to assert cluster kicker text `screen.getAllByText('Retirement')` / `screen.getAllByText('Non-Retirement')` still resolves to ≥1 each (will now match both the `OverviewCard` cluster kicker AND the `.seg-opt` retirement-filter label — both legitimately render the word "Retirement", so `getAllByText` with `length >= 1` still holds; consider tightening to `>= 2` if you want to assert both surfaces are present).
- `'should render retirement filter tags above PositionsTable when Positions tab is active'`: rename (no more "tab" concept) to something like `'should render the retirement .seg filter above PositionsTable'`; replace the `.tag`-class-filtering assertions with `.seg-opt` assertions, e.g. `screen.getByRole('radio', { name: 'All' })`, `screen.getByRole('radio', { name: 'Retirement' })`, `screen.getByRole('radio', { name: 'Non-Retirement' })` all present and unchecked/checked appropriately (default `state.retirementFilter === 'All'` → the "All" radio is checked).
- `'should hide retirement filter tags when Transactions tab is active'`: DELETE this test — there is no Transactions tab anymore, so this scenario is gone entirely (not adapted).
- `'should dispatch SET_RETIREMENT_FILTER when a retirement tag is clicked'`: update to click the `.seg-opt` radio/label instead of the old `.tag` span, e.g. `fireEvent.click(screen.getByRole('radio', { name: 'Retirement' }))` (or its parent `<label>`, matching how `Nav.tsx`'s category `.seg` is clicked elsewhere in tests if a precedent exists — check `Nav`-related click patterns in other test files for the exact idiom used with `.seg-opt`), then assert `state`-driven UI change (e.g. the radio's `checked` becomes true) rather than a `tag-accent` className (that class no longer applies to this control).
- `'password gate'` describe block's two `screen.queryByText('Transactions')` assertions (lines ~314, ~188 area): replace with an assertion against the new wait-target text instead (or simply drop the `Transactions` half of those combined assertions, keeping only the `Positions`-replacement check).
Acceptance: `npx vitest run src/App.test.tsx` passes; `grep -n "'Transactions'" src/App.test.tsx` returns zero matches (all Transactions-tab-specific assertions removed); `grep -n "'Positions'" src/App.test.tsx` returns zero matches unless intentionally repointed to a still-valid string.

### T10 — full test suite + typecheck
Dependencies: T2, T3, T4, T5, T6, T7, T8, T9.
- Run `npm run test` (all vitest suites) — fix any remaining fallout not caught by the targeted runs in earlier tasks (e.g. cross-file fixture drift, snapshot-style assertions elsewhere referencing removed components).
- Run `npm run build` (tsc -b + vite build) — fix any type errors (e.g. missed `range`/`SummaryCards`/`SegmentSummaryCards` references, `Day Change` card-count assumptions elsewhere).
- Run `npm run lint` (oxlint) — fix any new lint findings (e.g. unused imports left behind from deleted components).
Acceptance: all three commands exit 0.

### T11 — update reference docs (`design.md`, `product-behavior.md`)
Dependencies: T10 (docs should describe the final, tested state — do this after the code is confirmed working, but BEFORE the commit task, per CLAUDE.md).
- `design.md`:
  - Directory structure: remove `SummaryCards.tsx`, `SegmentSummaryCards.tsx` lines; add `OverviewCard.tsx`.
  - `AppState` interface code block: remove `range: string`.
  - Action types list: remove `SET_RANGE`.
  - Component tree diagram: remove the portfolio-header-row line, replace `SummaryCards`/two `SegmentSummaryCards` lines with one `OverviewCard (state)` line, remove the Positions/Transactions `.seg` + `[tab === 'transactions'] TransactionsTable` branch (replace with unconditional `PositionsTable`), update the retirement-filter-tags line to describe the new `.seg` control, update Nav's one-line description to drop "range select" and mention the SVG gear icon.
  - Selectors section: remove `totalValueSeriesInRange`/`performanceLinePoints` entries; note `summaryCards()` is now 3 cards (Total Value / Total Gain-Loss / Amount Invested — no Day Change), matching `segmentSummaryCards()`'s shape.
  - Full-file re-read after edits (per AGENTS.md rule) to check no stale cross-references remain (e.g. anything still saying "4-column SummaryCards grid" or "Day Change").
- `product-behavior.md`:
  - "Layout" section: rewrite the top-to-bottom flow to: `Nav → OverviewCard (3 clusters) → AllocationChart (2-col) → divider → retirement .seg filter + Import button row → PositionsTable`.
  - "Nav" section: remove the "Date range select" bullet entirely; update "Settings gear" bullet to mention the SVG icon if worth noting (optional, keep terse).
  - Delete "Portfolio header" section entirely (feature removed).
  - Replace "Summary cards" and "Segment summary card rows" sections with one new "Overview card" section describing the 3-cluster single-card layout, sourced from `summaryCards()`/`segmentSummaryCards()`, no Day Change.
  - "Allocation chart" section: update bar height (8px → 6px) and layout (single column → 2-column grid, label+value inline).
  - "Positions table" section: update the "Retirement filter tags" paragraph — no longer `.tag` pills, now a `.seg` radio control; drop the "Only shown on the Positions tab" caveat (there's no other tab to gate on anymore, it's always shown).
  - "Transactions table" section: leave as-is (component/behavior unchanged, just unreachable from the Dashboard now) — optionally add one line noting it's no longer rendered in the Dashboard (kept for data-model/other-surface reasons) so a future reader isn't confused about why the section exists with no way to reach it in the UI. Judgment call: include this note for clarity.
  - Full-file re-read after edits per AGENTS.md rule.
Acceptance: both docs re-read start to finish; no remaining mentions of Day Change, the range select, the Positions/Transactions tab selector, `.tag` retirement pills, or the old portfolio header block; terse/token-optimized style preserved (no narrative prose added).

### T12 — commit
Dependencies: T10, T11 (tests passing AND docs updated — CLAUDE.md's commit gate).
- `git add` the changed/added/deleted files (explicit paths, not `-A`).
- Commit with a message describing the v6 layout rework (Overview card consolidation, Transactions-tab removal from Dashboard, range/date-filter removal, Allocation 2-col restyle, retirement `.seg` filter, Nav gear icon).
Acceptance: `git log -1` shows the new commit on `dashboard-v6/layout-rework`; `git status` clean.

### T13 — exit worktree
Dependencies: T12.
```
cd /Users/mdoraiswamy/owa/portfolio
git worktree remove ../worktree-dashboard-v6
```
Acceptance: `git worktree list` no longer shows the removed worktree; the `dashboard-v6/layout-rework` branch still exists (worktree removal doesn't delete the branch) with the new commit, ready for the user to merge/PR at their discretion (this plan does not include merging to `main`).

## Test strategy summary

- No new dedicated component test files (Decision 3) — `OverviewCard`, restructured `AllocationChart`, restructured `Nav` are covered via `App.test.tsx` integration assertions (T9), matching the pre-existing pattern for these three components.
- `selectors.test.ts` loses `totalValueSeriesInRange`/`performanceLinePoints` tests (dead code removed) and gains updated `summaryCards` 3-card assertions (T2).
- `SegmentSummaryCards.test.tsx` is deleted outright (component deleted); its coverage intent folds into `App.test.tsx`'s existing/updated segment-cluster assertions (T9).
- Fixture-only `range:` cleanup across 5+ test files is mechanical (T8), except `persist.test.ts` which needs a per-test judgment call on whether a range-specific migration test should be deleted or repointed to another field (T8).
