# Plan: v11 Design Sync — Theme, OverviewCard, AccountsPage

Pixel reference: `design/v11/project/Portfolio Dashboard.dc.html` (1648 lines).
Repo: `/Users/mdoraiswamy/owa/portfolio`.

## In Scope

- `src/styles/styles.css` — byte-for-byte port of `design/v11/project/styles.css` (fonts, color palette, radii, corner-mark retirement), mandated by CLAUDE.md's own Styling bullet, not optional — plus two interpolated `--space-5`/`--space-7` tokens the source file omits but its own markup depends on (see Open Question 4, resolved).
- Dead corner-mark JSX (`<i className="corner tl/tr/bl/br">`) removal across `src/components/**/*.tsx` and `src/App.tsx`, now that CSS sets `.corner { display: none }`.
- `src/components/OverviewCard.tsx` — 2-segment rewrite (drop "All Together", drop "Amount Invested").
- `src/components/AccountsPage.tsx` — full rewrite: 2-column layout, category cards, allocation, filter/search, aggregate positions table.
- `src/components/AllocationChart.tsx` — generalize from `{state}` to `{positions, title}` props.
- `src/lib/selectors.ts` — add `segmentCards`, `positionsForCategory`, `categoryCards`, `acctScopedPositions`, `acctFilteredPositions`, `acctAssetClassOptions`, `acctAllocationTitle`; generalize `allocationBars`; remove `summaryCards`, `segmentSummaryCards`, `accountsSections`, `computeCashInvestment` (after grep-verified dead).
- `src/lib/state.ts` / `src/lib/reducer.ts` / `src/lib/persist.ts` — 4 new `AppState` fields + helpers + reducer cases + migration defaults.
- `src/lib/aggregateRows.ts` (new) — extraction of `buildAggregateRows`/`AggregateRow`/`AGGREGATE_SORT_FIELD` out of `PositionsTable.tsx` for reuse in `AccountsPage.tsx`.
- `src/lib/computations.ts` — new shared `GAIN_COLOR`/`LOSS_COLOR`/`glColor()` (T3a), matching v11's literal hex exactly (see Open Question 1). Single-line G/L-color-only edits to `PositionsTable.tsx`, `PositionGroupOverlay.tsx`, `ClosedPositionsTable.tsx` to consume it — their other behavior/logic stays untouched (still "reused as-is" per Out of Scope below for everything except this one color constant).
- `src/App.tsx` — Dashboard's `<AllocationChart state={state}/>` call site updated to the new props shape.
- Root `design.md`, root `product-behavior.md` — updated sections. `src/lib/design.md`/`src/lib/product-behavior.md` — verify no change needed (they're Undo-Closed-Position-scoped).
- Root `CLAUDE.md` — Styling bullet updated (T2a), by explicit user instruction.
- Tests: `selectors.test.ts`, `state.test.ts`, `reducer.test.ts`, `persist.test.ts`, `AccountsPage.test.tsx`, `PositionsTable.tsx`'s existing tests (import path only).

## Out of Scope

`Nav.tsx`, `Settings.tsx`, `ImportDialog.tsx` (any mode — reused as-is, second instance only), `PositionsTable.tsx`'s own table/closed-positions/overlay behavior (beyond the aggregateRows extraction, the T3a G/L-color-constant swap, and reuse of global `sortKey`/`sortDir`), `PositionGroupOverlay.tsx`/`ClosedPositionsTable.tsx`'s own behavior (beyond the T3a G/L-color-constant swap). `styles.css` port (T1) and corner-mark JSX removal (T2) ARE in scope (see In Scope above) — ordinary code/asset changes. **Editing CLAUDE.md's own Styling bullet (T2a) is also in scope**, by explicit user instruction overriding the general default that no agent edits checked-in project instructions autonomously — see Open Question 5 (resolved).

## Test Strategy

Unit tests for every new/changed pure function in `selectors.ts`/`state.ts`/`reducer.ts`/`persist.ts` (happy path, empty/edge case, and — where meaningful — an error/invalid case) colocated in the matching `*.test.ts`. Component tests for `OverviewCard`, `AllocationChart`, `AccountsPage` via `@testing-library/react` (render + `fireEvent` for clicks/inputs). Full-suite gate (`npm run test`, `npm run lint`, `npm run build`) required before the commit task, per CLAUDE.md. No new doc files.

## Risks

- **Shared sort state across views**: `AccountsPage`'s aggregate table now reads/writes the same `state.sortKey`/`state.sortDir` as Dashboard's `PositionsTable`. Sorting on one view changes the other view's table order on next visit. This is required by the spec (v11 script reuses `sk`/`sd` verbatim for both `aggregateRows` and `acctAggregateRows`, `Portfolio Dashboard.dc.html:1271-1341`) — accepted, not a bug.
- **Two independent `ImportDialog` instances** (Dashboard + Accounts page) each carry their own component-local `isOpen`/wizard state — opening one has no effect on the other. Matches current single-instance behavior duplicated, not a regression, but worth a smoke check that nothing throws with two mounted instances (they were previously always mutually exclusive by view, still are — only one instance is ever mounted at a time since `state.view` renders one branch — so no real concurrency risk).
- **`AGGREGATE_SORT_FIELD`/`buildAggregateRows` extraction** touches `PositionsTable.tsx`'s only currently-passing import path — must re-run `PositionsTable`'s existing tests untouched in logic, only import source changes.
- Removing `summaryCards`/`segmentSummaryCards`/`accountsSections`/`computeCashInvestment` is irreversible within this change-set; each removal task grep-verifies zero remaining references first.

## Open Questions

1. **glStr/glColor composition — RESOLVED, overriding an earlier wrong recommendation**: an earlier draft of this plan recommended keeping `var(--color-accent-700)`/`#8a3c2e` instead of v11's literal `GAIN='#1fa971'`/`LOSS='#e2574c'` hex constants (`Portfolio Dashboard.dc.html:751-752`, used at lines 1036/1285/1327/1351). That recommendation is **wrong and reversed**: `var(--color-accent-700)` is `#416180` (muted blue-gray) today but becomes `#2c53c4` (a saturated blue) once T1 ports v11's palette — so keeping it would make every positive G/L value in the app render **blue**, not green, post-theme-swap. v11 uses `#8a3c2e` for a *different, unrelated* purpose (form/validation error text — `passwordError`/`importFileError`/`cell.error` at lines 438/577/600/646 — never G/L), so there's no actual conflict in adopting the literal GAIN/LOSS hexes for G/L specifically while leaving `#8a3c2e` exactly where it is for form errors. **Resolution: adopt v11's literal `GAIN_COLOR='#1fa971'`/`LOSS_COLOR='#e2574c'` exactly, app-wide for every G/L-colored value — not just in the new `segmentCards()`.** This expands scope beyond the two components being rewritten: `PositionsTable.tsx:246`, `PositionGroupOverlay.tsx:343`, and `ClosedPositionsTable.tsx:38` all currently compute G/L color as `gl >= 0 ? 'var(--color-accent-700)' : '#8a3c2e'` and must switch to the same shared constant, or the app ships with inconsistent G/L coloring (new surfaces green/red, old surfaces blue/brown) — see new task **T3a** and the updated Scope section below.
2. **`lastImportedAt` field name** — confirmed via `src/lib/types.ts:34`: `Position.lastImportedAt: string`. Category-card "Updated {date}" uses `Math.max` over each account's positions' `lastImportedAt`, formatted `en-US` `{month:'short', day:'numeric', year:'numeric'}`, or `—` if the account has zero positions. (v11's own mockup uses a different fake field `a.lastUpdated` directly on its mock Account object, line 984 — not applicable, real schema has no such Account field; positions are the only place a date lives.)
3. **Empty-state table-vs-message** — resolved by reading v11 lines 296-333: the `<table>` (headers + `sc-for` rows) always renders, and the "No positions to show." message is a **sibling block after the table**, shown only when `acctAggregateRows.length === 0` (`acctNoPositions`, line 1458). Plan uses this shape (approach (a) from the task brief): table shell always renders, empty message appended below when `rows.length === 0`.
4. **`--space-5`/`--space-7` gap tokens — RESOLVED**: neither `design/v11/project/styles.css` nor the current `src/styles/styles.css` defines `--space-5` or `--space-7` (both skip straight from `--space-4` to `--space-6` to `--space-8`), yet v11's markup uses `var(--space-5)`/`var(--space-7)` extensively. Decision: T1 adds two interpolated tokens to the ported stylesheet (`--space-5: 20px`, `--space-7: 28px`), following v11's own round-number spacing convention (`4px × step`) — the one deliberate, documented deviation from strict byte-identity in the port. Component tasks (T4, T17-T21) use `var(--space-5)`/`var(--space-7)` directly wherever v11's markup does, no nearest-token substitution needed.
5. **CLAUDE.md's Styling-bullet wording — RESOLVED, by explicit user instruction**: after T2 removes corner-mark JSX (backed by T1's CSS making `.corner` `display:none`), CLAUDE.md's Styling section would otherwise describe "four `<i class="corner tl/tr/bl/br">` marks" as part of the class vocabulary components consume — no longer true. The user explicitly instructed the CLAUDE.md edit be made as part of this work, overriding the general default that no agent edits checked-in project instructions autonomously. **T2a** (new task, depends on T1+T2 so it lands atomically with the code change, not before) makes this edit with exact replacement text drafted in the task itself.

---

## T0 — Create worktree, confirm baseline
**Depends on:** none
Run:
```
git worktree add ../worktree-portfolio-v11-design-sync -b portfolio-v11-design-sync/implement-v11-overview-accounts
cd ../worktree-portfolio-v11-design-sync
npm install
npm run test
```
**Acceptance:** `npm run test` passes with 0 failures on the fresh worktree before any edits. All subsequent tasks run inside this worktree.

---

## T1 — Port `design/v11/project/styles.css` byte-for-byte into `src/styles/styles.css`
**Depends on:** T0
Files: `src/styles/styles.css` (153-line replacement of the current 286-line file).

Current `src/styles/styles.css` is the *old* Industry theme (Barlow/Barlow Condensed fonts, `--color-accent:#5980a6`, `--radius-sm/md/lg: 2/4/7px`, visible corner-marks via `.blueprint > .corner` border-drawing rules). `design/v11/project/styles.css` is a materially different theme (Poppins/Inter fonts, `--color-accent:#3b6ef6`, full indigo/white palette incl. new `--color-sidebar`/`--color-sidebar-text` tokens, `--radius-sm/md/lg: 8/12/20px`, `.blueprint > .corner, .corner { display: none; }` — confirmed via direct diff, not assumption). Per CLAUDE.md's Styling section ("`src/styles/styles.css` ... must stay byte-identical to [the design bundle's CSS]"), copy `design/v11/project/styles.css` over `src/styles/styles.css` verbatim (byte-for-byte, no hand-edits, no selective merging).

**Resolved (Open Question 4)**: v11's HTML file (`Portfolio Dashboard.dc.html`) references `var(--space-5)`/`var(--space-7)` extensively in inline styles even though neither token is defined in either the old or new `styles.css` (both jump `--space-4` → `--space-6` → `--space-8`). Decision: copy `design/v11/project/styles.css` verbatim first, then append two interpolated tokens to the `:root` block, following v11's own round-number spacing convention (`--space-1:4px, --space-2:8px, --space-3:12px, --space-4:16px, --space-6:24px, --space-8:32px` — each step is `4px × step`): add `--space-5: 20px;` and `--space-7: 28px;` immediately after `--space-4`/before `--space-6` and after `--space-6`/before `--space-8` respectively, keeping the file's existing formatting style. This is a deliberate, documented deviation from strict byte-identity — the only one in this port — needed because v11's own markup depends on tokens its own stylesheet omits; do not add any other tokens or values beyond these two.

**Tests:** none (CSS-only change, no test file covers `styles.css` content). Visual regression is out of scope for automated tests here — verified by T29's full build (typecheck won't catch CSS issues, but confirms nothing references now-removed/renamed CSS custom properties in a way TypeScript can catch, which is minimal) and manual spot-check is optional.

**Acceptance:** `diff "design/v11/project/styles.css" src/styles/styles.css` shows exactly two added lines (`--space-5: 20px;` and `--space-7: 28px;`) and no other differences. `grep -n "Barlow\|#5980a6" src/styles/styles.css` → 0 matches (old theme fully replaced). `grep -n -- "--space-5\|--space-7" src/styles/styles.css` → both present.

---

## T2 — Remove dead corner-mark JSX (`<i className="corner ...">`)
**Depends on:** T1
Files: all `src/components/**/*.tsx` and `src/App.tsx` that render `<i className="corner tl/tr/bl/br">` marks (grep to find the full list — known current renderers include `OverviewCard.tsx`, `AccountsPage.tsx`'s category-section cards, `AllocationChart.tsx`, and likely others per `.card.blueprint.elev-sm` usage across the app).

T1's ported `styles.css` sets `.blueprint > .corner, .corner { display: none; }` (v11 line 83) — the blueprint-corner visual motif is retired in this theme. The 4 `<i className="corner tl/tr/bl/br">` elements per card are now always-invisible dead markup. Run `grep -rln 'className="corner' src/` and remove the 4 `<i>` tags from every match (keep the surrounding `.card.blueprint.elev-sm` wrapper div and its class name as-is — only the corner-mark children are dead, not the card class itself, since `.blueprint`/`.elev-sm` may still carry other styling).

**Tests:** for any component with an existing test that asserts on `.corner`/`className="corner"` presence (grep `*.test.tsx` for `corner`), update those assertions to expect absence, or remove the assertion if it was purely incidental.

**Acceptance:** `grep -rn 'className="corner' src/` → 0 matches repo-wide. `npm run build` still typechecks clean (verified in T29).

---

## T2a — CLAUDE.md: update the Styling bullet to drop stale corner-mark language
**Depends on:** T1, T2 (must land atomically with the code it describes, not before — editing CLAUDE.md while the code still renders corner-marks would make the file self-contradictory)
Files: `CLAUDE.md` (root).

Per explicit user instruction this project-instructions file may be edited as part of this plan (overriding the earlier default of leaving it to a human). Replace the current Styling bullet (line 46):

> **Styling**: `src/styles/styles.css` is a verbatim port of the design bundle's CSS (see below) and must stay byte-identical to it — don't hand-edit design tokens inline in components. Components consume the existing class vocabulary (`.card.blueprint.elev-sm` + four `<i class="corner tl/tr/bl/br">` marks, `.tag`/`.tag-accent`/`.tag-outline`, `.seg`/`.seg-opt`, `.table`, `.nav`, `.field`/`.input`, `.dialog-backdrop`/`.dialog`) rather than inline styles or new CSS.

with:

> **Styling**: `src/styles/styles.css` is a verbatim port of the design bundle's CSS (see below), kept byte-identical to it aside from two interpolated `--space-5`/`--space-7` tokens the design bundle's own markup depends on but its stylesheet omits — don't hand-edit design tokens inline in components. Components consume the existing class vocabulary (`.card.blueprint.elev-sm`, `.tag`/`.tag-accent`/`.tag-outline`, `.seg`/`.seg-opt`, `.table`, `.nav`, `.field`/`.input`, `.dialog-backdrop`/`.dialog`) rather than inline styles or new CSS. The `.blueprint` corner-bracket marks (`<i class="corner tl/tr/bl/br">`, four per element) are retired as of the v11 theme — CSS hides them (`.corner { display: none }`) and components no longer render them; `.blueprint` is now a hook class with no corner visual.

**Tests:** none (prose-only doc edit).

**Acceptance:** `grep -n 'corner tl/tr/bl/br' CLAUDE.md` shows the corner-marks described as retired, not as a current class-vocabulary item components must render. `grep -n 'byte-identical' CLAUDE.md` reflects the two-token exception.

---

## T3a — computations.ts: shared GAIN/LOSS color constants, applied app-wide
**Depends on:** T0
Files: `src/lib/computations.ts`, `src/lib/computations.test.ts`, `src/components/PositionsTable.tsx`, `src/components/PositionGroupOverlay.tsx`, `src/components/ClosedPositionsTable.tsx`.

Resolves Open Question 1, overriding an earlier (wrong) recommendation to keep `var(--color-accent-700)`/`#8a3c2e`. After T1 ports v11's palette, `var(--color-accent-700)` becomes `#2c53c4` (saturated blue) instead of today's `#416180` (muted blue-gray) — keeping it for gains would render every positive G/L value blue. v11's script defines and consistently uses literal `GAIN='#1fa971'` (green) / `LOSS='#e2574c'` (red) for every G/L-colored value it renders (`Portfolio Dashboard.dc.html:751-752`, used at lines 1036/1285/1327/1351: segment cards, both aggregate positions tables, closed positions). `#8a3c2e` is unaffected — v11 keeps it for a *different* role, form/validation error text only (lines 438/577/600/646), never G/L, so this change does not touch error-text styling anywhere.

Add to `src/lib/computations.ts`: `export const GAIN_COLOR = '#1fa971'`, `export const LOSS_COLOR = '#e2574c'`, `export function glColor(gl: number): string` returning `gl >= 0 ? GAIN_COLOR : LOSS_COLOR`.

Replace the existing `gl >= 0 ? 'var(--color-accent-700)' : '#8a3c2e'` (and `cp.realizedGL`/`computed.gl` equivalents) with `glColor(...)` in exactly three spots: `PositionsTable.tsx:246`, `PositionGroupOverlay.tsx:343`, `ClosedPositionsTable.tsx:38`. Do not touch any other `#8a3c2e`/`var(--color-accent-700)` usage in these or any other file (form-error text, hover states, links) — those are unrelated and v11 leaves them as-is.

**Tests** (`computations.test.ts`, new `describe('glColor')` block): `glColor(100)` → `GAIN_COLOR`; `glColor(-1)` → `LOSS_COLOR`; `glColor(0)` → `GAIN_COLOR` (>= 0 tie-break, matches the existing tie-break convention elsewhere in the codebase for `gl === 0`).

**Acceptance:** `npx vitest run src/lib/computations.test.ts` passes. `grep -n "var(--color-accent-700)\|#8a3c2e" src/components/PositionsTable.tsx src/components/PositionGroupOverlay.tsx src/components/ClosedPositionsTable.tsx` shows zero G/L-related matches remaining (any non-G/L matches in these files, if present, are untouched — verify none exist before/after via manual read).

---

## T3 — selectors.ts: add `segmentCards()` + `positionsForCategory()`
**Depends on:** T0, T3a
Files: `src/lib/selectors.ts`, `src/lib/selectors.test.ts`.

Add a private helper `valueGlSummary(positions: Position[]): { totalValueStr: string; glStr: string; glColor: string }` mirroring v11's `valueGlInvestedCards` (`Portfolio Dashboard.dc.html:1028-1038`) but using the shared `GAIN_COLOR`/`LOSS_COLOR`/`glColor()` from `src/lib/computations.ts` (T3a) — matches v11's literal hex exactly. `glStr = (gl>=0?'+':'') + fmtUSD(gl) + ' (' + fmtPct(glPct) + ')'`.

Add exported `segmentCards(state: AppState, retirement: boolean): { totalValueStr: string; glStr: string; glColor: string }` — filters `state.positions` by `account.retirement === retirement`, calls `valueGlSummary`.

Add exported `positionsForCategory(state: AppState): Position[]` — extracts the body of the existing private `getAccountsForCategory`-based filter (used today inline in `allocationBars`/`visiblePositions`/`filteredPortfolioTotal`) into one reusable function so `App.tsx` can pass explicit positions into the generalized `AllocationChart`.

**Tests** (`selectors.test.ts`, new `describe('segmentCards')` and `describe('positionsForCategory')` blocks):
- happy: `segmentCards(state, true)` sums only `retirement: true` accounts' positions; `glStr` format `'+$X.XX (+Y.YY%)'` for positive GL.
- edge: zero positions for that retirement bucket → `totalValueStr: '$0.00'`, `glStr: '+$0.00 (0.00%)'` (cost basis 0 guard), `glColor` = GAIN (gl >= 0 tie-break).
- edge: `positionsForCategory(state)` with `state.category: 'all'` returns all positions; with a specific category returns only that category's accounts' positions (reuse existing `accountsInCategory` fixtures from current `allocationBars` tests).

**Acceptance:** `npx vitest run src/lib/selectors.test.ts` passes; `segmentCards` and `positionsForCategory` are exported; 0 changes yet to `summaryCards`/`segmentSummaryCards`/`allocationBars` (next tasks).

---

## T4 — OverviewCard.tsx: 2-segment rewrite
**Depends on:** T3, T2 (styles.css must be ported before component visuals are rewritten)
Files: `src/components/OverviewCard.tsx`.

Replace 3-column grid (`repeat(3,1fr)`) with 2-column (`repeat(2,1fr)`). Remove the "All Together" cluster entirely. Render exactly `Retirement` then `Non-Retirement`, each: label (`text-muted`, 10px uppercase, `letter-spacing:0.08em`) → value block: `.card.blueprint.elev-sm`'s inner div showing `seg.summary.totalValueStr` (`font-family:var(--font-heading); font-size:15px; font-weight:600; color:var(--color-text)`) → below it a `<span className="tag">` with `style={{ marginTop:'4px', fontSize:'10px', color: summary.glColor, borderColor: summary.glColor }}` containing `summary.glStr` (per `Portfolio Dashboard.dc.html:62-70`). Use `segmentCards(state, true)`/`segmentCards(state, false)` from T3. Delete the `renderCluster`/`showSub`/`card-kicker` machinery — no longer needed since each segment only shows one composed value+tag, not 3 sub-cards.

**Tests** — no `OverviewCard.test.tsx` exists; per task brief judgment call, **do not create one** (non-bug design-sync change, not required by CLAUDE.md). Verify manually via T30's full build/lint pass and a quick `npm run dev` visual spot-check is optional, not required.

**Acceptance:** `grep -c "All Together\|Amount Invested\|card-kicker" src/components/OverviewCard.tsx` → 0. Component renders a `div` with `gridTemplateColumns: 'repeat(2, 1fr)'` and exactly 2 children (Retirement, Non-Retirement). `npm run build` typechecks clean for this file (verified in T30, not blocking here).

---

## T5 — Remove `summaryCards`/`segmentSummaryCards` (grep-verified dead)
**Depends on:** T4
Files: `src/lib/selectors.ts`, `src/lib/selectors.test.ts`.

Run `grep -rn "summaryCards\|segmentSummaryCards" src/` (excluding `valueGlInvestedCards`/`segmentCards`/`valueGlSummary` name collisions) to confirm zero remaining call sites outside `selectors.ts`'s own definitions and `selectors.test.ts`. Delete `summaryCards()`, `segmentSummaryCards()`, and the now-orphaned `valueGlInvestedCards()` private helper (superseded by T3's `valueGlSummary`) from `selectors.ts`. Delete their corresponding `describe`/`it` blocks from `selectors.test.ts` (`'summaryCards: returns exactly 3 cards with correct labels'` at line ~240, plus any `segmentSummaryCards` tests found by grep).

**Tests:** none new — this is a removal task. Confirm `npx vitest run src/lib/selectors.test.ts` still passes with the reduced test count and no import errors.

**Acceptance:** `grep -rn "summaryCards\|segmentSummaryCards\|valueGlInvestedCards" src/` returns 0 matches anywhere in the repo.

---

## T6 — selectors.ts: generalize `allocationBars`
**Depends on:** T3
Files: `src/lib/selectors.ts`, `src/lib/selectors.test.ts`.

Change signature from `allocationBars(state: AppState)` to `allocationBars(positions: Position[]): Array<{ label: string; value: string; pct: string; pctNum: number }>`. Move the `allocationByAssetClass`/`fmtUSD`/`fmtPct` body as-is, just drop the `getAccountsForCategory`/`state.positions` filtering step (caller now passes already-scoped positions). Add `pctNum: number` field (raw percentage, needed by both Dashboard and Accounts page bar-width rendering — currently `AllocationChart.tsx` re-parses `bar.pct` via regex; this removes that hack).

**Tests** (`selectors.test.ts`, update existing `'allocationBars: returns formatted allocation data'` at line ~306): change call from `allocationBars(state)` to `allocationBars(positions)` using the same fixture positions array directly. Add:
- happy: 2 asset classes, verify `pctNum` sums to ~100.
- edge: empty positions array → `[]` (matches existing zero-total guard).

**Acceptance:** `allocationBars` takes `Position[]`, returns `pctNum` field; `npx vitest run src/lib/selectors.test.ts` passes.

---

## T7 — AllocationChart.tsx: generalize props to `{positions, title}`
**Depends on:** T6
Files: `src/components/AllocationChart.tsx`.

Change `AllocationChartProps` from `{ state: AppState }` to `{ positions: Position[]; title: string }`. Call `allocationBars(positions)` (T6's new signature). Replace the regex `parseFloat(bar.pct.replace(...))` hack with `bar.pctNum` directly. Replace hardcoded `card-title` text "Allocation" with the `title` prop.

**Tests:** none new (no existing `AllocationChart.test.tsx` — grep confirms). Visual/behavioral parity verified via T8's App.tsx wiring + T30 full build.

**Acceptance:** `grep -n "state: AppState" src/components/AllocationChart.tsx` → 0 matches. `grep -n "parseFloat(bar.pct" src/components/AllocationChart.tsx` → 0 matches.

---

## T8 — App.tsx: update Dashboard's AllocationChart call site
**Depends on:** T7
Files: `src/App.tsx`.

Replace `<AllocationChart state={state} />` (line ~305) with `<AllocationChart positions={positionsForCategory(state)} title="Allocation" />`. Import `positionsForCategory` from `./lib/selectors` (already imports `assetClassOptions, CATEGORY_LABEL` from there — add to that import line).

**Tests:** none new. Existing `App.test.tsx` (if it renders Dashboard view) must still pass — check via T30.

**Acceptance:** `grep -n "AllocationChart" src/App.tsx` shows the new `positions=`/`title=` props, zero `state={state}` on that line.

---

## T9 — state.ts: add 4 new AppState fields + defaults + helpers
**Depends on:** T0 (parallelizable with T3-T8)
Files: `src/lib/state.ts`, `src/lib/state.test.ts`.

Add to `AppState` interface (after `showClosed`, line ~32):
```ts
selectedAccountId: string | null
expandedCategories: Record<string, boolean>
acctAssetClassFilter: string
acctPosSearch: string
```
Add matching defaults to `initialState()` (after `showClosed: false,`): `selectedAccountId: null, expandedCategories: {}, acctAssetClassFilter: 'All', acctPosSearch: '',`.

Add 4 pure helpers, following `setAssetClassFilter`/`setPositionsSearch`/`toggleSort` pattern (lines 200-226):
```ts
export function selectAccount(state: AppState, accountId: string): AppState {
  return { ...state, selectedAccountId: state.selectedAccountId === accountId ? null : accountId }
}
export function toggleCategoryExpanded(state: AppState, categoryKey: string): AppState {
  return { ...state, expandedCategories: { ...state.expandedCategories, [categoryKey]: !state.expandedCategories[categoryKey] } }
}
export function setAcctAssetClassFilter(state: AppState, filter: string): AppState {
  return { ...state, acctAssetClassFilter: filter }
}
export function setAcctPosSearch(state: AppState, search: string): AppState {
  return { ...state, acctPosSearch: search }
}
```

**Tests** (`state.test.ts`, new `describe` blocks following existing style, e.g. `describe('setView')` at line 184):
- `selectAccount`: happy (selecting a new id sets it), edge (selecting the already-selected id toggles back to `null`), edge (state otherwise unchanged — other fields reference-equal).
- `toggleCategoryExpanded`: happy (toggles `false`→`true` for a key not yet in the map, i.e. `undefined`→`true`), edge (toggling twice returns to `false`), edge (other category keys in the map untouched).
- `setAcctAssetClassFilter`/`setAcctPosSearch`: happy (sets the field), edge (empty string / `'All'` round-trips).

**Acceptance:** `npx vitest run src/lib/state.test.ts` passes; `initialState()` includes all 4 new fields with the specified defaults.

---

## T10 — reducer.ts: add 4 new action cases
**Depends on:** T9
Files: `src/lib/reducer.ts`, `src/lib/reducer.test.ts`.

Add cases, following `SET_ASSET_CLASS_FILTER`/`TOGGLE_SORT` pattern (reducer.ts lines 56-63):
```ts
case 'SELECT_ACCOUNT':
  return StateActions.selectAccount(state, action.accountId)
case 'TOGGLE_CATEGORY_EXPANDED':
  return StateActions.toggleCategoryExpanded(state, action.categoryKey)
case 'SET_ACCT_ASSET_CLASS_FILTER':
  return StateActions.setAcctAssetClassFilter(state, action.filter)
case 'SET_ACCT_POS_SEARCH':
  return StateActions.setAcctPosSearch(state, action.search)
```

**Tests** (`reducer.test.ts`, following `describe('SET_ASSET_CLASS_FILTER')` pattern at line 61):
- `SELECT_ACCOUNT`: happy (dispatch sets `selectedAccountId`), edge (dispatching same id twice toggles to `null`).
- `TOGGLE_CATEGORY_EXPANDED`: happy (toggles the named key), edge (unrelated keys unaffected).
- `SET_ACCT_ASSET_CLASS_FILTER`: happy (sets from `action.filter`).
- `SET_ACCT_POS_SEARCH`: happy (sets from `action.search`).

**Acceptance:** `npx vitest run src/lib/reducer.test.ts` passes; all 4 action types wired.

---

## T11 — persist.ts: migration defaults for 4 new fields
**Depends on:** T9
Files: `src/lib/persist.ts`.

In `coalesceWithDefaults` (lines 57-67), add 4 lines in the same style as `assetClassFilter`/`showClosed`:
```ts
selectedAccountId: loaded.selectedAccountId ?? defaults.selectedAccountId,
expandedCategories: loaded.expandedCategories ?? defaults.expandedCategories,
acctAssetClassFilter: loaded.acctAssetClassFilter ?? defaults.acctAssetClassFilter,
acctPosSearch: loaded.acctPosSearch ?? defaults.acctPosSearch,
```

**Tests:** none in this task — covered by T12/T13.

**Acceptance:** `coalesceWithDefaults` returns all 4 fields regardless of whether `loaded` has them.

---

## T12 — persist.test.ts: roundtrip + preserves-UI-state coverage for 4 new fields
**Depends on:** T11
Files: `src/lib/persist.test.ts`.

Read the file's fixture at line ~141-145 (full-state roundtrip object) and the `'preserves UI state accurately'` test at line 230-257. Add the 4 new fields to the roundtrip fixture object (non-default values, e.g. `selectedAccountId: 'acc-1', expandedCategories: { taxable: true }, acctAssetClassFilter: 'Equities', acctPosSearch: 'aapl'`) and to the `'preserves UI state accurately'` test's saved-state object + its `expect(loaded?.X).toBe(...)` assertions (mirroring `assetClassFilter`/`showClosed` at lines 237/241/253/257).

**Tests:**
- happy: `'saves then loads all collections byte-for-byte'` (line 185) — extend fixture, still passes byte-for-byte.
- happy: `'preserves UI state accurately'` (line 230) — add assertions for all 4 new fields with non-default values.

**Acceptance:** `npx vitest run src/lib/persist.test.ts` passes with the extended fixtures.

---

## T13 — persist.test.ts: missing-field-defaults + shared-coalesce coverage
**Depends on:** T11
Files: `src/lib/persist.test.ts`.

In the `'handles missing collections with defaults'` test (line 205) and the `'silently drops a stale legacy collection key...'` test's missing-field-defaults fixture (line ~426-430), **omit** the 4 new fields from the stored blob (proving backfill) and assert `loaded?.selectedAccountId === null`, `loaded?.expandedCategories` deep-equals `{}`, `loaded?.acctAssetClassFilter === 'All'`, `loaded?.acctPosSearch === ''`. Also extend the `describe('coalesceWithDefaults is shared between the legacy and encrypted paths')` block (line 502) similarly if it has its own field-presence fixture.

**Tests:**
- happy/edge: missing-field defaults test — new fields absent from stored blob, backfilled to `initialState()` defaults after load.
- edge: `expandedCategories` deep-equality (`{}`, not `undefined`) since it's an object not a primitive.

**Acceptance:** `npx vitest run src/lib/persist.test.ts` passes; a blob missing all 4 new fields loads without throwing and backfills exact defaults.

---

## T14 — aggregateRows.ts: extract shared aggregate-row logic
**Depends on:** T0
Files: new `src/lib/aggregateRows.ts`, `src/components/PositionsTable.tsx`.

Move `buildGroupKey`, `AggregateRow` interface, `AGGREGATE_SORT_FIELD` const, and `buildAggregateRows` function (currently `PositionsTable.tsx` lines 22-114) verbatim into new `src/lib/aggregateRows.ts`, exported (`export function buildGroupKey`, `export interface AggregateRow`, `export const AGGREGATE_SORT_FIELD`, `export function buildAggregateRows`). Update `PositionsTable.tsx` to `import { buildAggregateRows, AGGREGATE_SORT_FIELD, type AggregateRow } from '../lib/aggregateRows'` and delete the moved code, keeping the rest of the file (JSX, `handleHeaderClick`, etc.) unchanged.

**Tests:** no existing test file for this logic (`buildAggregateRows` was previously private/untested per module — confirm via `grep -rn "buildAggregateRows" src/**/*.test.ts`). If none exist, no test obligation is broken; if `PositionsTable.test.tsx` exists and imports these internals directly, update its import path only, no assertion changes.

**Acceptance:** `grep -n "function buildAggregateRows\|AGGREGATE_SORT_FIELD" src/components/PositionsTable.tsx` → 0 matches (both now imported). `npx vitest run src/components/PositionsTable.test.tsx` (if it exists) passes unchanged.

---

## T15 — selectors.ts: `categoryCards()` selector
**Depends on:** T9 (needs `expandedCategories`/`selectedAccountId` on AppState)
Files: `src/lib/selectors.ts`, `src/lib/selectors.test.ts`.

Add exported `categoryCards(state: AppState): Array<{ key: TaxCategory; label: string; totalStr: string; accountCount: number; expanded: boolean; accounts: Array<{ id: string; institution: string; name: string; accountNumber: string; updatedStr: string; totalStr: string; selected: boolean }>; hasAccounts: boolean; noAccounts: boolean }>`. Order: `taxable`, `nonTaxable`, `taxDeferred` (derive from `Object.keys(CATEGORY_LABEL)` — already in that order per `CATEGORY_LABEL` definition, selectors.ts lines 9-13). Per account: `totalStr = fmtUSD(sum of shares*price across that account's positions)`; `updatedStr` = max `lastImportedAt` across that account's positions formatted `en-US {month:'short',day:'numeric',year:'numeric'}`, or `'—'` if the account has zero positions; `selected = state.selectedAccountId === account.id`. Category `totalStr` = sum of all its accounts' totals. `expanded = !!state.expandedCategories[catKey]`.

**Tests** (`selectors.test.ts`, new `describe('categoryCards')`):
- happy: 2 accounts in `taxable` with positions, verify per-account `totalStr` and category `totalStr` sum correctly, order is Taxable/Non-Taxable/Tax-Deferred.
- edge: category with zero accounts → `hasAccounts: false`, `noAccounts: true`, `accounts: []`, `totalStr: '$0.00'`.
- edge: account with zero positions → `updatedStr: '—'`.
- edge: `expanded` reflects `state.expandedCategories[catKey]` true/false/missing(→false).

**Acceptance:** `npx vitest run src/lib/selectors.test.ts` passes; `categoryCards` exported with the shape above.

---

## T16 — selectors.ts: accounts-page position-scoping selectors
**Depends on:** T9
Files: `src/lib/selectors.ts`, `src/lib/selectors.test.ts`.

Add 4 exported functions:
- `acctScopedPositions(state: AppState): Position[]` — `state.selectedAccountId` set → that account's positions; else all `state.positions`. (No category filter — Accounts page has none.)
- `acctAssetClassOptions(positions: Position[]): string[]` — distinct effective asset classes (`assetClassManualOverride || assetClass`) among the given positions, sorted alphabetically (mirrors `assetClassOptions` but takes positions directly instead of `state`, since Accounts page's options must be scoped-positions-derived per the task brief, not global).
- `acctFilteredPositions(state: AppState): Position[]` — `acctScopedPositions(state)` further filtered by `state.acctAssetClassFilter` (skip if `'All'`) and `state.acctPosSearch` (case-insensitive substring on symbol/name, skip if blank). Mirrors `visiblePositions`'s filter logic minus category/sort.
- `acctAllocationTitle(state: AppState): string` — `state.selectedAccountId` set → `` `Allocation — ${account.name}` ``; else `'Allocation — All Accounts'`.

**Tests** (`selectors.test.ts`, new `describe` blocks):
- `acctScopedPositions`: happy (selected account → only its positions), edge (`selectedAccountId: null` → all positions).
- `acctAssetClassOptions`: happy (dedupes + sorts), edge (empty positions array → `[]`).
- `acctFilteredPositions`: happy (asset-class + search compose), edge (`acctAssetClassFilter: 'All'` + empty search → same as `acctScopedPositions`), edge (search matches name but not symbol, case-insensitive).
- `acctAllocationTitle`: happy (selected account present → uses `account.name`), edge (`selectedAccountId` set but account not found — defensive, falls back to `''` name concatenation, not a crash), edge (no selection → `'Allocation — All Accounts'`).

**Acceptance:** `npx vitest run src/lib/selectors.test.ts` passes; all 4 functions exported with the shapes above.

---

## T17 — AccountsPage.tsx: left column (category cards)
**Depends on:** T15, T10, T2 (styles.css must be ported before component visuals are rewritten)
Files: `src/components/AccountsPage.tsx`.

Replace current single-`useState` local `selectedAccountId` + `accountsSections`-driven 3-table render with: left column `div` (`flex; flex-direction:column; gap:var(--space-4)`) mapping `categoryCards(state)`. Each card: `.card.blueprint.elev-sm` (`padding:0`) + 4 corner marks, header row (`onClick` dispatches `TOGGLE_CATEGORY_EXPANDED` with `categoryKey: cat.key`) containing chevron `<svg>` (rotate 90deg via inline `style.transform` when `cat.expanded`), label pill (`background:var(--color-accent); color:#fff; border-radius:999px; padding:6px 14px`), `.tag.tag-neutral` account count, right-aligned `cat.totalStr`. When `cat.expanded`: divider + either account rows (each `onClick` dispatches `SELECT_ACCOUNT` with `accountId: acc.id`; background `var(--color-accent-100)` when `acc.selected`; shows `{institution} — {name}` ellipsis-truncated + right-aligned `acc.totalStr`, plus 2 `.tag.tag-outline` rows `#{accountNumber}` / `Updated {updatedStr}`) or `.text-muted` "No accounts in this category." when `cat.noAccounts`.

This task only wires the left column — right column and overlay are stubbed/deferred to T19-T21 (component will not compile standalone yet; that's fine, whole file lands across T17-T21 then verified in T22).

**Tests:** deferred to T23 (full `AccountsPage.test.tsx` rewrite covers this).

**Acceptance:** Left column JSX present matching the structure above; `grep -n "TOGGLE_CATEGORY_EXPANDED\|SELECT_ACCOUNT" src/components/AccountsPage.tsx` → both present.

---

## T18 — AccountsPage.tsx: right column allocation card + filter/import row
**Depends on:** T17, T7 (generalized AllocationChart), T16
Files: `src/components/AccountsPage.tsx`.

Add right column: `<AllocationChart positions={acctScopedPositions(state)} title={acctAllocationTitle(state)} />` (T7/T16). Below it: divider (`background:var(--color-divider); margin:var(--space-6) 0`), then a flex row: left `.seg` built from `['All', ...acctAssetClassOptions(acctScopedPositions(state))]`, each option `onClick` dispatches `SET_ACCT_ASSET_CLASS_FILTER`; right a second `<ImportDialog state={state} dispatch={dispatch} onClose={() => {}} />` instance (same component App.tsx already uses for Dashboard at `src/App.tsx:324-330`, minus `ref`/`onUndoClosedPosition` — Accounts page has no closed-positions/undo flow). Import `ImportDialog` from `'./import/ImportDialog'`.

**Tests:** deferred to T23.

**Acceptance:** `grep -n "ImportDialog\|SET_ACCT_ASSET_CLASS_FILTER\|acctAllocationTitle\|acctScopedPositions" src/components/AccountsPage.tsx` → all present.

---

## T19 — AccountsPage.tsx: search input + aggregate positions table
**Depends on:** T18, T14, T16
Files: `src/components/AccountsPage.tsx`.

Add search `.field`/`.input` bound to `state.acctPosSearch`, `onChange` dispatches `SET_ACCT_POS_SEARCH`, placeholder `"Search symbol or name"` (matches `PositionsTable.tsx:192`). Below it: full `<table className="table">` — headers from the same 5 sortable columns as `PositionsTable.tsx` (`columns` array, lines 159-169) each `onClick` dispatching `TOGGLE_SORT` (same global `state.sortKey`/`state.sortDir`, reused verbatim — see Risks), plus static `Amount Invested`/`Market Value`/`% of Selection`/`G/L`/`G/L %`/blank headers (note: `% of Portfolio` renamed to `% of Selection`). Body: `buildAggregateRows(acctFilteredPositions(state))` (T14, T16) sorted via `sortBy(rows, AGGREGATE_SORT_FIELD[state.sortKey] ?? state.sortKey, state.sortDir)` (same pattern as `PositionsTable.tsx:127`), row cells identical to `PositionsTable.tsx:253-273` except `% of Selection` uses a **new local denominator** `acctFilteredPositions(state).reduce((s,p)=>s+p.shares*p.price,0)` (not `filteredPortfolioTotal`, which is category-scoped — per task brief) via `fmtPortfolioPercent(row.marketValue, acctPortfolioTotal)`. Table always renders (headers + body, even 0 rows) — after the `</table>`, render `.text-muted` "No positions to show." only when `rows.length === 0` (Open Question 3 resolution).

**Tests:** deferred to T23.

**Acceptance:** `grep -n "% of Selection\|No positions to show" src/components/AccountsPage.tsx` → both present. `grep -n "filteredPortfolioTotal" src/components/AccountsPage.tsx` → 0 matches (must use the local scoped total, not the category-scoped one).

---

## T20 — AccountsPage.tsx: row-click overlay wiring
**Depends on:** T19
Files: `src/components/AccountsPage.tsx`.

Wire each aggregate row's `onClick` to open `PositionGroupOverlay`, same pattern as `PositionsTable.tsx:309-322`: component-local `useState<string|null>` for `selectedGroupKey` (this one stays component-local — it's not part of `AppState`, matches `PositionsTable`'s own pattern, not the removed `selectedAccountId`), title `` `${symbol} — ${displayName} — ${effectiveAssetClass}` ``, props `positions`, `title`, `accounts={state.accounts}`, `dispatch`, `onClose`, `existingAssetClasses={assetClassOptions(state)}`, `state={state}` — **no `sortPositions` prop** (task brief: "minus the custom sortPositions prop"; default overlay sort order applies).

**Tests:** deferred to T23.

**Acceptance:** `grep -n "PositionGroupOverlay\|sortPositions" src/components/AccountsPage.tsx` → `PositionGroupOverlay` present, `sortPositions` absent (0 matches).

---

## T21 — AccountsPage.tsx: wire global `selectedAccountId`, finalize props/imports
**Depends on:** T20
Files: `src/components/AccountsPage.tsx`.

Remove the old component-local `useState<string|null>(null)` for `selectedAccountId` entirely (superseded by global `state.selectedAccountId` + `SELECT_ACCOUNT` dispatch wired in T17). Clean up imports: drop `accountsSections`, add `categoryCards, acctScopedPositions, acctFilteredPositions, acctAssetClassOptions, acctAllocationTitle, assetClassOptions` from `'../lib/selectors'`, add `buildAggregateRows, AGGREGATE_SORT_FIELD` from `'../lib/aggregateRows'`, add `sortBy` from `'../lib/sort'`, add `computePosition, fmtUSD, fmtPct, fmtPortfolioPercent` from `'../lib/computations'` as needed, add `ImportDialog` import. Verify file compiles (`npx tsc -b --noEmit` or rely on T30's full build).

**Tests:** deferred to T23.

**Acceptance:** `grep -n "useState<string | null>(null)" src/components/AccountsPage.tsx` → 0 matches (old local `selectedAccountId` gone). File has no unused imports (oxlint clean, verified in T30).

---

## T22 — selectors.ts + PositionsTable.tsx: final `accountsSections`/`computeCashInvestment` removal
**Depends on:** T21
Files: `src/lib/selectors.ts`, `src/lib/selectors.test.ts`.

Run `grep -rn "accountsSections\|computeCashInvestment" src/` to confirm zero remaining call sites outside `selectors.ts`'s own definitions and `selectors.test.ts`. Delete both functions from `selectors.ts`. Delete their `describe`/`it` blocks from `selectors.test.ts` (`'accountsSections: ...'` tests around lines 745-1090, `'computeCashInvestment: ...'` tests around lines 852-1014 — read exact ranges before deleting, don't over-delete adjacent unrelated tests).

**Tests:** none new — removal task. Confirm `npx vitest run src/lib/selectors.test.ts` passes with reduced test count.

**Acceptance:** `grep -rn "accountsSections\|computeCashInvestment" src/` → 0 matches anywhere in the repo.

---

## T23 — AccountsPage.test.tsx: full rewrite (state + left column)
**Depends on:** T21
Files: `src/components/AccountsPage.test.tsx`.

Rewrite the existing 485-line test file (keep the `buildAppStateWithAccounts` fixture helper, adapt as needed) to cover the new component. This task: left-column/category-card behavior + global state wiring.

**Tests:**
- happy: category cards render collapsed by default (`state.expandedCategories: {}`), clicking header expands (dispatch fires `TOGGLE_CATEGORY_EXPANDED`, or with a real reducer/dispatch harness, DOM shows account rows after click).
- happy: clicking an account row selects it (`SELECT_ACCOUNT` dispatched with correct `accountId`); clicking the same row again deselects (dispatched again, resulting `selectedAccountId: null` via reducer round-trip test or a wrapper harness using `useReducer`).
- edge: category with 0 accounts shows "No accounts in this category." when expanded.
- edge: account `updatedStr` shows "—" when the account has 0 positions; shows formatted date when it has positions with `lastImportedAt`.

**Acceptance:** `npx vitest run src/components/AccountsPage.test.tsx` passes (this subset of tests green; full-file pass confirmed after T24).

---

## T24 — AccountsPage.test.tsx: full rewrite (right column + table + overlay)
**Depends on:** T23
Files: `src/components/AccountsPage.test.tsx`.

Continue the rewrite: right-column allocation/table/overlay coverage.

**Tests:**
- happy: no account selected → allocation title "Allocation — All Accounts", table shows aggregate rows for all positions.
- happy: account selected → allocation title `"Allocation — {name}"`, table scoped to that account's positions only.
- happy: typing in search filters rows by symbol/name (case-insensitive).
- happy: asset-class `.seg` filter narrows rows.
- edge: filtered-to-zero-rows state shows "No positions to show." below a table that still renders its headers.
- happy: clicking an aggregate row opens `PositionGroupOverlay` with the right title/positions; no `sortPositions` prop passed (can assert via a lightweight overlay stub/mock or by checking rendered order defaults to overlay's own default sort — pick whichever the existing `PositionGroupOverlay` test pattern uses, if any).
- edge: `% of Selection` header text present, `% of Portfolio` absent.

**Acceptance:** `npx vitest run src/components/AccountsPage.test.tsx` passes in full (all tests from T23 + T24 green together).

---

## T25 — Root design.md: update Component Tree, AppState, Props sections
**Depends on:** T4, T7, T21, T22
Files: `design.md` (repo root).

Update `### AppState interface` code block (~line 63+) to add the 4 new fields (`selectedAccountId`, `expandedCategories`, `acctAssetClassFilter`, `acctPosSearch`) with the same style as existing entries. Update the bullet under it listing helper names to add `selectAccount, toggleCategoryExpanded, setAcctAssetClassFilter, setAcctPosSearch`. Update `### Action types (reducer.ts)` list to add `SELECT_ACCOUNT, TOGGLE_CATEGORY_EXPANDED, SET_ACCT_ASSET_CLASS_FILTER, SET_ACCT_POS_SEARCH`. Rewrite the `OverviewCard` line in `## Component tree` (currently "3-cluster single-card layout...") to describe the 2-segment shape. Rewrite the `AllocationChart` line to `(positions, title)` props and note it's reused on both Dashboard and Accounts page. Rewrite the `AccountsPage` line (currently "read-only: renders 3 sections...") to describe the 2-column category-cards + allocation + table shape, referencing `categoryCards`/`acctScopedPositions`/`acctFilteredPositions`/`buildAggregateRows` reuse. Update the "Props convention" paragraph's `AllocationChart` (add: now `positions`, `title`) and `AccountsPage` (unchanged signature `state, dispatch` — confirm still accurate) entries.

**Tests:** none (doc-only task).

**Acceptance:** Full-file re-read after edit: no reference to "3-cluster"/"All Together"/"Amount Invested" remains in the `OverviewCard` line; no reference to the removed 3-section cash/investment/total table remains in the `AccountsPage` line; `AllocationChart` line shows `(positions, title)`.

---

## T26 — Root product-behavior.md: rewrite Overview/Allocation/Accounts sections
**Depends on:** T25
Files: `product-behavior.md` (repo root).

Rewrite `## Overview card` (lines 21-30) for the 2-segment shape: single card, 2 clusters (Retirement/Non-Retirement only), each showing total value + a colored `.tag` combining signed G/L $ and %, computed via `segmentCards()`. Note "All Together" and "Amount Invested" no longer shown anywhere on this card. Update `## Allocation chart` (lines 31-34) to note it's a reusable component now taking explicit `positions`/`title` props, used on Dashboard (category-scoped, title "Allocation") and Accounts page (account-or-all-scoped, title `"Allocation — {account.name}"`/`"Allocation — All Accounts"`). Rewrite `## Accounts page` (lines 55-67) entirely: 2-column layout (360px category cards + flexible allocation/table column), default-collapsed category cards with account-count badge and click-to-expand, account rows with institution—name/total/account-number-tag/updated-date-tag, click-to-select (global `state.selectedAccountId`, toggle semantics), right column allocation card + asset-class filter + Accounts & Import button (same `ImportDialog` component, second instance) + search + aggregate positions table (`% of Selection` column, same `buildAggregateRows`/global sort as Dashboard's Positions table) + "No positions to show." empty state. Update the top `## Layout` line's "Accounts view: read-only 3-section account summary table..." description to match.

**Tests:** none (doc-only task).

**Acceptance:** Full-file re-read after edit: no reference to "Subtotal row", "Cash/Investment/Total columns", "3 sections (Taxable/Non-Taxable/Tax-Deferred)" table shape remains under `## Accounts page`; `## Overview card` describes exactly 2 clusters.

---

## T27 — src/lib/design.md / product-behavior.md: verify no change needed
**Depends on:** T22
Files: `src/lib/design.md`, `src/lib/product-behavior.md` (read-only verification).

Read both files in full (13 and 9 lines respectively). Both are scoped narrowly to the "Undo Closed Position" data flow, not a general selectors/state reference. None of this task's changes (selector additions/removals, new state fields, `AllocationChart` generalization) touch the Undo-Closed-Position flow (`ClosedPosition → ImportDialog Step 2 → IMPORT_POSITIONS + DELETE_CLOSED_POSITION`). No edits needed.

**Tests:** none.

**Acceptance:** Explicit confirmation recorded (in this task's completion, not a new file): "No change needed — both docs scoped to Undo Closed Position flow, unaffected by this change-set."

---

## T28 — Full test/lint/build gate
**Depends on:** T1, T2, T2a, T3a, T5, T8, T12, T13, T14, T22, T24, T25, T26, T27
Files: none (verification only, whole repo).

Run in the worktree:
```
npm run test
npm run lint
npm run build
```
Fix any failures (test regressions, oxlint violations, `tsc -b` type errors) before proceeding. Do not proceed to T29 until all three pass clean.

**Acceptance:** `npm run test` exits 0 with 0 failures, `npm run lint` exits 0 with 0 errors, `npm run build` exits 0 (typecheck + production build succeed).

---

## T29 — Commit
**Depends on:** T28
Files: none (git operation).

```
git add -A
git commit -m "$(cat <<'EOF'
Sync theme, OverviewCard, and AccountsPage to v11 design

- Port design/v11 styles.css byte-for-byte (new fonts/palette/radii, retires blueprint corner marks)
- Remove dead corner-mark JSX now that CSS hides it; update CLAUDE.md's Styling bullet to match
- Unify G/L coloring app-wide on v11's literal GAIN/LOSS hex (was theme-accent-derived, would've gone blue)
- OverviewCard: drop All Together/Amount Invested, 2-segment (Retirement/Non-Retirement) layout
- AccountsPage: 2-column layout with collapsible category cards, reusable AllocationChart, aggregate positions table
- Generalize AllocationChart to (positions, title) props, reused on both views
- Add selectedAccountId/expandedCategories/acctAssetClassFilter/acctPosSearch to AppState with persistence migration
- Extract buildAggregateRows/AGGREGATE_SORT_FIELD to src/lib/aggregateRows.ts for reuse
- Remove dead summaryCards/segmentSummaryCards/accountsSections/computeCashInvestment selectors

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git status
```

**Acceptance:** Commit created, `git status` shows clean working tree (only the worktree's own untracked artifacts, if any, remain).

---

## T30 — Remove worktree
**Depends on:** T29
Files: none (git operation).

```
cd /Users/mdoraiswamy/owa/portfolio
git worktree remove ../worktree-portfolio-v11-design-sync
```

**Acceptance:** `git worktree list` no longer shows the removed worktree; original directory (`/Users/mdoraiswamy/owa/portfolio`) is the active working directory.
