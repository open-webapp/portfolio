# Replace Performance Chart with Retirement-Segmented Card Rows

Caveman plan. Kill `PerformanceChart`. Put two new card rows (Retirement / Non-Retirement) in its spot. Move `AllocationChart` to full width below them. Move retirement filter tags down to sit above `PositionsTable`. Small tasks, each one thing. Read top to bottom before starting task 1. Requirements below are already locked via a user interview (grill-me) — do not re-litigate them.

## Facts checked before writing this plan

- `performanceLinePoints()` and `totalValueSeriesInRange()` (`src/lib/selectors.ts` ~L252, ~L288) are used **only** by `PerformanceChart.tsx` and by `src/lib/selectors.test.ts`. Nothing else in `src/` imports them. Decision: **leave them in `selectors.ts`** (dead-but-harmless) rather than deleting — spec says don't guess, and deleting risks breaking the existing selector tests for no functional gain. Their tests stay as-is.
- No `src/components/PerformanceChart.test.tsx` exists — nothing to delete there.
- `src/lib/selectors.test.ts` exists (932 lines) — new tests go here.
- `src/App.test.tsx` (317 lines) has no test asserting the retirement tags' exact DOM position or referencing `PerformanceChart` by name — only a generic "renders dashboard view by default with Nav and SummaryCards" test (~L157). No test currently pins the old header location, so relocation won't break an existing assertion, but we still add a new assertion for the new location.
- `summaryCards()` (`src/lib/selectors.ts` L148-216) currently returns 4 cards: Total Value, Day Change, Total Gain/Loss (+sub %), Amount Invested. No "Total Taxes Paid" card in code (removed in prior commits). `product-behavior.md` L24-30 and `design.md` L107/L159 still describe 5 cards including "Total Taxes Paid" — pre-existing doc drift, fixed in this plan's doc task.
- `getAccountsForCategory(state)` (`selectors.ts` L325-330) + inline retirement-boolean filtering (pattern at `visiblePositions()` L11-28) is the composition to mirror for the new selector.
- `Account.retirement: boolean` (`src/lib/types.ts` L12).
- Portfolio header block lives in `App.tsx` L191-237 (kicker+title left, retirement `.tag` pills right, dispatching `SET_RETIREMENT_FILTER`). Charts grid is `App.tsx` L242-253 (`2fr 1fr`, `PerformanceChart` + `AllocationChart`). Tabs row is L255-294. `PositionsTable` render is L297.
- `SummaryCards.tsx` is the visual pattern to mirror for card markup (`.card.blueprint.elev-sm` + 4 `<i class="corner ..">` + `.card-kicker` + value + optional `.card-meta` sub).
- Existing uncommitted changes in the repo (`git status`: `PositionGroupOverlay.test.tsx`, `reducer.ts`, `selectors.ts`, `state.ts`, `types.ts`) are from unrelated prior work — **do not touch or revert them**; this plan's diffs land on top.
- No `plans/_template.md` exists in this repo; this plan follows the structure of `plans/portfolio-percentage-column.md` instead.

## Design decisions locked in (from interview + planner's call where interview left it open)

- New selector `segmentSummaryCards(state: AppState, retirement: boolean)` in `selectors.ts`, returning the same 3-card shape (`{label, value, sub?, color}`) as `summaryCards()`'s Total Value / Total Gain-Loss / Amount Invested, computed only over positions where `account.retirement === retirement` AND the account is in the current category filter (mirrors `visiblePositions`'s category+retirement composition). No Day Change card.
- Shared math extracted into a private helper `valueGlInvestedCards(positions: Position[])` in `selectors.ts`, called by both `summaryCards()` (which still adds Day Change as its 2nd card) and `segmentSummaryCards()`. No copy-pasted arithmetic.
- New component `src/components/SegmentSummaryCards.tsx`, props `{ state: AppState, retirement: boolean, label: string }`. Renders a bordered container (`.card.blueprint.elev-sm` reused for consistency with existing visual language, 4 corner marks) with a muted-uppercase kicker heading (`label`, styled like the "Portfolio" kicker in `App.tsx` L203-210) above a 3-column grid of cards (same inline style as `SummaryCards.tsx` per-card markup, minus the wrapping div — extract per-card JSX into a small local helper to avoid duplicating the card markup twice in the same file).
- Row order in `App.tsx`: `SummaryCards` (unchanged, still 4 cards) → `SegmentSummaryCards` "Retirement" row → `SegmentSummaryCards` "Non-Retirement" row → full-width `AllocationChart` row → tabs row.
- `PerformanceChart.tsx` deleted entirely; its import and JSX usage removed from `App.tsx`; charts grid (`2fr 1fr`) replaced by a plain full-width block for `AllocationChart`.
- Retirement filter tags: relocated to directly above `PositionsTable`, rendered **only when `state.tab === 'positions'`** (they don't affect Transactions — `visibleTransactions` never reads `retirementFilter`, confirmed in `product-behavior.md` L53 — showing them on the Transactions tab would misleadingly imply they filter it). Same `.tag`/`.tag-accent` markup and `SET_RETIREMENT_FILTER` dispatch as today, just moved. `state.retirementFilter`, the reducer case, and `visiblePositions()` are untouched.
- Portfolio header row keeps kicker + `<h1>Ledger</h1>` only, no longer flex-space-between with tags — becomes a simple block (or keeps flex with just one child; planner's call: simplify to non-flex block since there's nothing to space against).

## Tasks

### T0. Create git worktree for isolated work (~5 min)
No dependency — prerequisite for safe parallel-safe work.
- Run `git worktree add ../worktree-perf-cards -b feature/performance-chart-to-card-rows` from the main repo root (`/Users/mdoraiswamy/owa/portfolio`).
- `cd ../worktree-perf-cards` to switch into the worktree.
- All subsequent tasks execute in this worktree; at the end (T12), switch back and remove it.

---

### T1. Extract shared card-math helper + add `segmentSummaryCards()` selector (~25 min)
Depends on: T0.

In `src/lib/selectors.ts`:
- Add private (non-exported) helper `function valueGlInvestedCards(positions: Position[]): Array<{ label: string; value: string; sub?: string; color: string }>` containing the Total Value / Total Gain-Loss / Amount Invested math currently inlined in `summaryCards()` (L159-162, L178-191, L193-216 minus the Day Change entry) — same `GAIN`/`LOSS` color constants, same `fmtUSD`/`fmtPct` calls.
- Refactor `summaryCards(state)` to call `valueGlInvestedCards(state.positions)` and splice the existing Day Change card in at index 1 (between Total Value and Total Gain/Loss) to preserve current card order: Total Value, Day Change, Total Gain/Loss, Amount Invested.
- Add new exported function `segmentSummaryCards(state: AppState, retirement: boolean)`:
  - Get `accountsInCategory = getAccountsForCategory(state)`.
  - Filter `state.positions` to those whose owning account is in `accountsInCategory` AND has `account.retirement === retirement` (look up account via `state.accounts.find`, same pattern as `visiblePositions` L18-28).
  - Return `valueGlInvestedCards(filteredPositions)`.
- Do not change `summaryCards()`'s public behavior/output (same 4 cards, same values) — this is a pure refactor plus one new function.

**Test cases** (written in T2):
- `segmentSummaryCards(state, true)` only includes positions from retirement accounts.
- `segmentSummaryCards(state, false)` only includes positions from non-retirement accounts.
- Respects `state.category` filter same as `visiblePositions` (e.g. category='Taxable' excludes non-taxable accounts' positions even if retirement matches).
- Zero matching positions → all 3 cards render with zero values (`$0.00`, `+$0.00`/`0.00%` sub, `$0.00`), not omitted.
- `summaryCards(state)` still returns exactly 4 cards in the same order/values as before the refactor (regression check).

---

### T2. Write selector tests for `segmentSummaryCards` (~20 min)
Depends on: T1.

In `src/lib/selectors.test.ts`:
- Add `describe('segmentSummaryCards', ...)` block near the existing `summaryCards` tests (~L270-470).
- Cover the 5 test cases listed in T1.
- Add a regression test asserting `summaryCards(state)` output is unchanged (same 4 labels, same values) for a fixture state used by an existing `summaryCards` test, to catch any refactor slip.
- Run `npx vitest run src/lib/selectors.test.ts` — all pass.

---

### T3. Create `SegmentSummaryCards` component (~20 min)
Depends on: T1.

Create `src/components/SegmentSummaryCards.tsx`:
- Props: `{ state: AppState; retirement: boolean; label: string }`.
- Calls `segmentSummaryCards(state, retirement)`.
- Renders a container `div` with `className="card blueprint elev-sm"` + 4 corner-mark `<i>` elements (same pattern as `SummaryCards.tsx`/`PerformanceChart.tsx`), containing:
  - A kicker heading: `<div className="text-muted" style={{ fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 'var(--space-3)' }}>{label}</div>` (mirrors the "Portfolio" kicker in `App.tsx` L203-210).
  - A 3-column grid (`display: grid, gridTemplateColumns: repeat(3, 1fr), gap: var(--space-4)`) of card cells, each cell reusing the exact inner markup `SummaryCards.tsx` uses per card (`.card-kicker` + value div + optional `.card-meta` sub) — but without the outer `.card.blueprint.elev-sm` wrapper/corner marks per cell (those belong to the row container only, not each of the 3 inner cells, per interview: "each row wrapped in its own container... following the existing card/blueprint visual language" — one blueprint container per row, not per card).
- Export `SegmentSummaryCards`.

**Test cases** (written in T4).

---

### T4. Component test for `SegmentSummaryCards` (~15 min)
Depends on: T3.

Create `src/components/SegmentSummaryCards.test.tsx` (vitest + jsdom + React Testing Library, matching conventions in `src/components/SummaryCards.test.tsx` if it exists — check first; otherwise mirror `PositionGroupOverlay.test.tsx`'s render setup):
- Renders the row `label` as a heading/kicker.
- Renders exactly 3 card values: Total Value, Total Gain/Loss (with `%` sub), Amount Invested — no Day Change card.
- With a fixture state containing one retirement-account position and one non-retirement-account position: `retirement={true}` shows only the retirement position's numbers; `retirement={false}` shows only the other.
- Run `npx vitest run src/components/SegmentSummaryCards.test.tsx` — all pass.

---

### T5. Wire new rows into `App.tsx`, delete `PerformanceChart` (~25 min)
Depends on: T3.

In `src/App.tsx`:
- Remove `import { PerformanceChart } from './components/PerformanceChart'` (L7).
- Add `import { SegmentSummaryCards } from './components/SegmentSummaryCards'`.
- Replace the charts grid block (L242-253, the `2fr 1fr` grid containing `<PerformanceChart />` + `<AllocationChart />`) with:
  - `<SegmentSummaryCards state={state} retirement={true} label="Retirement" />`
  - `<SegmentSummaryCards state={state} retirement={false} label="Non-Retirement" />`
  - a full-width block: `<div style={{ marginBottom: 'var(--space-6)' }}><AllocationChart state={state} /></div>`
  - each row/component wrapped with bottom margin (`var(--space-4)` between the two segment rows, `var(--space-6)` before Allocation) consistent with existing spacing conventions in the file.
- Delete `src/components/PerformanceChart.tsx` (`rm`).
- Leave `src/lib/selectors.ts`'s `performanceLinePoints`/`totalValueSeriesInRange` and their tests untouched (see Facts).

**Test cases**: covered by T7 (App.test.tsx) — grep confirms no remaining reference to `PerformanceChart` in `src/` after this task: `grep -rn "PerformanceChart" src/` returns nothing.

---

### T6. Relocate retirement filter tags above `PositionsTable` (~15 min)
Depends on: T5 (same file, sequenced to avoid merge conflicts within the task list — not a logical dependency).

In `src/App.tsx`:
- Remove the retirement-tags `<div>` block (the right-hand side of the portfolio header flex row, originally L215-236) from the portfolio header; simplify the header row to no longer need `justifyContent: 'space-between'` (just the kicker+title block remains).
- Keep the `retirementFilters` array constant (L23-27) — still needed, just rendered from a new location.
- Immediately before the `{state.tab === 'positions' && <PositionsTable ... />}` line (originally L297), and gated on `state.tab === 'positions'`, render the same tags markup (same `.tag`/`.tag-accent` classes, same `onClick` dispatching `SET_RETIREMENT_FILTER`) in a `<div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>`.
- Do not render the tags when `state.tab === 'transactions'`.
- No changes to `src/lib/reducer.ts`, `src/lib/state.ts`, or `visiblePositions()` — `SET_RETIREMENT_FILTER` and `state.retirementFilter` behavior are identical, only JSX location moves.

**Test cases** (written in T7):
- Retirement tags no longer render inside the portfolio header block (query by a stable selector/testid or structural assertion).
- Retirement tags render directly above `PositionsTable` when `state.tab === 'positions'`.
- Retirement tags do NOT render when `state.tab === 'transactions'`.
- Clicking a tag still dispatches `SET_RETIREMENT_FILTER` with the correct filter value (existing behavior, re-verified at new location).

---

### T7. Update `App.test.tsx` (~20 min)
Depends on: T6.

In `src/App.test.tsx`:
- Add/extend a test asserting the dashboard view (existing test ~L157 "renders dashboard view by default with Nav and SummaryCards") also does NOT render anything with `PerformanceChart`'s old distinguishing content (e.g. no `card-title` text "Performance" — grep `PerformanceChart.tsx` before deletion for its exact rendered heading text, which is `"Performance"` per L34, and assert `screen.queryByText('Performance')` is null).
- Add a test that `AllocationChart` still renders (`screen.getByText('Allocation')` — see `AllocationChart.tsx` L24 `card-title` text).
- Add tests for the 4 T6 cases above (tag location + tab-gating + click behavior), using a fixture state with `tab: 'positions'` and one with `tab: 'transactions'`.
- Add a test that both segment rows render with their labels "Retirement" and "Non-Retirement" present on the dashboard.
- Run `npx vitest run src/App.test.tsx` — all pass.

---

### T8. Update `product-behavior.md` (~25 min)
Depends on: T5, T6.

Edit `product-behavior.md`:
- **Layout** (L7-9): update the top-to-bottom description — `Nav` → portfolio header (kicker + title only, no tags) → `SummaryCards` (4-card row) → "Retirement" `SegmentSummaryCards` row → "Non-Retirement" `SegmentSummaryCards` row → full-width `AllocationChart` → retirement filter tags → tabs row → active tab's table.
- **Portfolio header** (L18-20): remove mention of retirement tags on the right; now just kicker "Portfolio" + `<h1>Ledger</h1>`, no filtering behavior at this location.
- **Summary cards** (L22-30): fix the pre-existing drift — remove item 5 "Total Taxes Paid" (code only ever returns 4 cards: Total Value, Day Change, Total Gain/Loss, Amount Invested); update the "single row of 5 equal columns" line to say 4.
- Add new subsection **"Segment summary card rows"** (replacing "Performance chart", L32-34, which is deleted): describe the two rows (Retirement / Non-Retirement), each showing Total Value / Total Gain-Loss (+ % sub) / Amount Invested computed via `segmentSummaryCards(state, retirement)`, filtered by both the row's retirement flag and the current category tab; no Day Change card in these rows; visual container is a bordered blueprint card with an uppercase kicker row label.
- **Allocation chart** (L36-38): note it's now a full-width row below the two segment rows, no longer paired with Performance in a `2fr 1fr` grid.
- Add a line near the Positions table section noting the retirement filter tags now render directly above the table (Positions tab only; not shown/not applicable on Transactions tab since they don't filter transactions).

---

### T9. Update `design.md` (~20 min)
Depends on: T5, T6.

Edit `design.md`:
- **Component tree** (L96-122): remove the `PerformanceChart` line; replace the "charts row ... grid 2fr 1fr" block with the new structure: two `SegmentSummaryCards` rows (props: `state`, `retirement`, `label`) directly after `SummaryCards`, then a full-width `AllocationChart` row; move the retirement `.tag` pills out of the "portfolio header row" line and into a new line directly above the `[tab === 'positions'] PositionsTable` entry, noting they're gated on `tab === 'positions'`.
- **Data flow / Selectors list** (L154-162): add `segmentSummaryCards(state, retirement)` with a one-line description ("Same math as summaryCards' Total Value/Total Gain-Loss/Amount Invested, scoped to positions whose account.retirement matches, within the current category filter; no Day Change."). Leave `performanceLinePoints`/`totalValueSeriesInRange` entries as-is (still exist, just unused by any component — optionally add a one-word note "(currently unused by any component)" if that reads clearly, planner's call, keep terse).
- Fix the `summaryCards(state)` line (L159) to drop "Total Taxes Paid" from its description (matches T8's fix).
- **Directory structure** section: remove `PerformanceChart.tsx` from the component file listing if individually listed; add `SegmentSummaryCards.tsx`.

---

### T10. Full test suite + lint (~15 min)
Depends on: T2, T4, T7, T8, T9.

- Run `npm run test` — all tests pass (no leftover references to deleted `PerformanceChart.tsx` anywhere, including `App.test.tsx`, `selectors.test.ts`).
- Run `npm run lint` — oxlint passes, no unused-import warnings (verify `App.tsx` doesn't still import `PerformanceChart`).
- Run `npm run build` — `tsc -b` typecheck passes (catches any stale type references) then `vite build` succeeds.
- Fix any regressions found before proceeding.

---

### T11. Commit (~10 min)
Depends on: T10.

```bash
npm run test   # re-verify green
npm run lint   # re-verify green
git add -A
git commit -m "$(cat <<'EOF'
Replace Performance chart with retirement-segmented summary card rows

Remove PerformanceChart (unused snapshot-history line chart) and add
Retirement/Non-Retirement SegmentSummaryCards rows showing Total Value,
Total Gain/Loss, and Amount Invested per segment. AllocationChart moves
to a full-width row; retirement filter tags relocate above
PositionsTable (Positions tab only). Fixes pre-existing doc drift
(stale "Total Taxes Paid" 5th summary card reference).
EOF
)"
git status   # verify clean
```

---

### T12. Teardown: switch back, remove worktree (~5 min)
Depends on: T11 (commit done).
- Switch back to original directory: `cd /Users/mdoraiswamy/owa/portfolio`.
- Remove worktree: `git worktree remove ../worktree-perf-cards`.
- Acceptance: worktree removed cleanly, main repo working tree unaffected, branch `feature/performance-chart-to-card-rows` still exists with the commit (not deleted) for later PR/merge.

---

## Test cases (final checklist)

- [ ] `segmentSummaryCards(state, true)` includes only retirement-account positions
- [ ] `segmentSummaryCards(state, false)` includes only non-retirement-account positions
- [ ] `segmentSummaryCards` respects `state.category` filter same as `visiblePositions`
- [ ] `segmentSummaryCards` with zero matching positions renders 3 zero-value cards (not omitted)
- [ ] `summaryCards(state)` unchanged after refactor (4 cards, same order/values)
- [ ] `SegmentSummaryCards` component renders row label + 3 cards, no Day Change
- [ ] `SegmentSummaryCards` with `retirement={true}` vs `retirement={false}` shows different numbers from a mixed fixture
- [ ] `PerformanceChart.tsx` deleted; no remaining `grep -rn "PerformanceChart" src/` hits
- [ ] "Performance" heading text no longer renders anywhere on dashboard
- [ ] "Allocation" heading still renders, now full-width (not in a 2-col grid)
- [ ] Retirement tags no longer render in portfolio header
- [ ] Retirement tags render directly above `PositionsTable` when `tab === 'positions'`
- [ ] Retirement tags do NOT render when `tab === 'transactions'`
- [ ] Clicking a retirement tag at its new location still dispatches `SET_RETIREMENT_FILTER` correctly
- [ ] `visiblePositions()`/`state.retirementFilter`/reducer case unchanged and still work (existing tests for these still pass untouched)
- [ ] Transactions tab, `TransactionsTable`, CSV import, `Transaction` type, dedup, realized-G/L: byte-for-byte untouched (no diff in `git diff` for transaction-related files)
- [ ] `npm run test` passes
- [ ] `npm run lint` passes
- [ ] `npm run build` passes

## Acceptance criteria

- Dashboard no longer renders `PerformanceChart` in any form; file deleted.
- Two new card rows ("Retirement", "Non-Retirement") appear where the charts grid used to be, each with Total Value / Total Gain-Loss (+ %) / Amount Invested, filtered by retirement flag + current category tab.
- `AllocationChart` renders full-width below the two new rows.
- Retirement filter tags moved to directly above `PositionsTable`, shown only on the Positions tab; `state.retirementFilter` behavior and `visiblePositions()` filtering unchanged.
- No Transactions-related code, tests, or docs touched.
- `product-behavior.md` and `design.md` updated and internally consistent (including the pre-existing "Total Taxes Paid" drift fix).
- All tests pass (`npm run test`), lint passes (`npm run lint`), build passes (`npm run build`).
- Changes committed with a clear message; worktree cleaned up.
