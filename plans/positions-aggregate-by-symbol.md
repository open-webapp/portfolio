# Positions table: aggregate rows by symbol/asset-class/account-shape

Goal: collapse the Positions table so every row represents a *group* of positions sharing
`symbol + effectiveAssetClass + account.taxCategory + account.retirement`, not one row per
`Position`. Clicking a row opens an overlay listing the group's underlying positions (with the
per-position `AssetClassOverrideSelect`, moved out of the main table). Sorting continues to use
`state.sortKey`/`state.sortDir` via `TOGGLE_SORT`, but now sorts the aggregated rows.

No template file found in `plans/` (`_template.md` doesn't exist) — used structure of other plan
files in `plans/` (e.g. `plans/settings-tabs-and-button-fix.md`).

Files touched:
- `src/components/PositionsTable.tsx` (rewritten grouping/sorting/rendering logic)
- `src/components/PositionGroupOverlay.tsx` (new)
- `src/components/PositionsTable.test.tsx` (new — no prior test file exists for this component)
- `design.md`
- `product-behavior.md`

Explicitly out of scope: `src/components/ClosedPositionsTable.tsx`, `src/components/TransactionsTable.tsx` — do not touch.

## Facts confirmed by reading code first

- `src/lib/selectors.ts` `visiblePositions(state)`: category → retirement filter → asset-class
  filter → search → `sortBy(state.sortKey, state.sortDir)` (last step, on raw `Position[]`). This
  final sort is what currently drives row order; after grouping, this pre-sort is no longer
  meaningful for correctness (a group's aggregate value can differ from any single member's raw
  field), so the plan re-sorts client-side after grouping (see Task 3).
- `src/lib/sort.ts` `sortBy<T>(items, key, dir)`: generic — nulls last/first, numeric/string
  comparison, `localeCompare` for strings. Reusable directly on the array of aggregate-row objects
  as long as the aggregate-row type has a same-named field for each sortable column.
- `src/lib/state.ts`: `sortKey: keyof Position`, `toggleSort(state, newKey)` flips dir if same key
  else resets to `asc`. `TOGGLE_SORT` action stays unchanged — component-level consumption changes,
  not the reducer.
- `src/lib/computations.ts` `computePosition(p)`: returns `p` merged with `marketValue`,
  `costBasis`, `gl`, `glPct` (derived from `shares`, `price`, `avgCost` only; `taxes` unused).
  Aggregate math per the interview: sum `computePosition()` outputs' `shares`/`costBasis`/
  `marketValue` across the group, then derive `price = marketValue/shares`,
  `avgCost = costBasis/shares`, `gl = marketValue - costBasis`,
  `glPct = costBasis === 0 ? 0 : (gl/costBasis)*100`.
- `src/lib/types.ts` `Position`: `{ id, importSessionId, accountId, symbol, name: string | null,
  assetClass, assetClassManualOverride?, shares, avgCost, price, taxes, lastImportedAt }`.
  `Account`: `{ id, accountNumber, name, taxCategory, retirement, createdAt }`.
- `src/components/AssetClassOverrideSelect.tsx`: takes `{ position: Position, dispatch }` — no
  changes needed to this component itself, just where it's rendered (moves into the overlay, one
  instance per underlying position).
- Dialog markup pattern (only existing precedent in the codebase — `src/components/import/ImportDialog.tsx`
  lines ~438–489): `<div className="dialog-backdrop" onClick={handleClose}><div className="dialog blueprint" onClick={(e)=>e.stopPropagation()}>` with 4 `<i className="corner tl/tr/bl/br">` marks, a header row with `<div className="dialog-title">` + an `aria-label="Close"` icon button (X svg, stroke paths `M18 6 6 18` / `m6 6 12 12`), then body content. `styles.css` lines 262–282 define `.dialog-backdrop`, `.dialog`, `.dialog-title`, `.dialog-body`, `.dialog-actions`.
- **No existing Escape-to-close precedent**: grepped `ImportDialog.tsx` and `Settings.tsx` for
  Escape-key dialog handling — `Settings.tsx`'s `Escape` hits (lines ~304, ~325) are inline
  text-field edit-cancel handlers, unrelated to dialog dismissal. `ImportDialog.tsx` closes only via
  backdrop-click and the X button (no `keydown` listener at all). So `PositionGroupOverlay` needs a
  **new** `useEffect` + `window.addEventListener('keydown', ...)` for Escape — copy the
  backdrop-click/X-button parts from `ImportDialog.tsx` exactly, add Escape handling fresh (not
  copied from anywhere, since nothing to copy).
- Dialog-open state precedent: `ImportDialog`'s own open/closed state is local
  (`isOpen`, per `design.md` line 105/120) — confirms overlay's `selectedGroupKey`/similar should be
  `useState` local to `PositionsTable`, not `AppState`. No reducer changes needed.
- No existing "account name, fallback to accountNumber if blank" sort-label helper found in the
  codebase (`ImportDialog.tsx` uses name + appended `#accountNumber`, not a fallback). Overlay's
  sort comparator needs a small local helper: `(a.name.trim() || a.accountNumber)`.
- `PositionsTable.test.tsx` does not exist yet (only `ClosedPositionsTable.test.tsx` and
  `Settings.test.tsx` exist as sibling component test files) — new file, following
  `ClosedPositionsTable.test.tsx`'s pattern (`vitest` + `@testing-library/react`, full literal
  `AppState` fixture object, `afterEach(cleanup)`).
- Current `product-behavior.md` "## Positions table" section (lines 40–47) and `design.md`
  component-tree (lines 93–116) both describe the pre-change one-row-per-position + inline
  `Override` column shape — see Task 8/9 for the exact diff needed.

## Tasks

### 1. Define grouping + aggregation helpers in `PositionsTable.tsx` (~25 min)
No dependency — first task.
- Add a `GroupKey` builder: `` `${symbol}|${effectiveAssetClass}|${account.taxCategory}|${account.retirement}` `` where `effectiveAssetClass = position.assetClassManualOverride || position.assetClass` and `account = state.accounts.find(a => a.id === position.accountId)`. **Resolved:** if `account` is not found (orphaned position — shouldn't happen given cascade-delete invariants, but must not crash), key on sentinel values `taxCategory = 'unknown'`, `retirement = false` so the position forms its own singleton group (never silently merged into another group, never dropped from the table) — this also means it always keys distinctly across positions unless two orphaned positions happen to share the same symbol+assetClass, which is an acceptable edge case.
- Add an `AggregateRow` type: `{ key: string, symbol: string, displayName: string, effectiveAssetClass: string, shares, costBasis, marketValue, price, avgCost, gl, glPct, accountCount: number, positions: Position[] }`.
- Add a `buildAggregateRows(positions: Position[], accounts: Account[]): AggregateRow[]` function: group `visiblePositions(state)` output by the key above, then for each group run `computePosition()` on every member, sum `shares`/`costBasis`/`marketValue`, derive `price`/`avgCost`/`gl`/`glPct` per the formulas in the overview, `displayName = positions[0].name ?? positions[0].symbol` (first found, per interview), `accountCount = new Set(group.map(p => p.accountId)).size`.
- Keep `getDisplayName` helper as-is (still used inside the overlay for per-position rows).

### 2. Column/sort-key mapping (~15 min)
Depends on: Task 1 (needs `AggregateRow` shape).
- Existing `columns` array is typed `key: keyof Position`. Since sorting now operates on `AggregateRow`, decide the mapping explicitly: `symbol→symbol`, `assetClass→effectiveAssetClass`, `shares→shares`, `avgCost→avgCost`, `price→price`. Keep `columns[].key` typed `keyof Position` (unchanged, since `TOGGLE_SORT` dispatch still uses `keyof Position` per `state.ts`), but add a small local `AGGREGATE_SORT_FIELD: Record<string, keyof AggregateRow>` map (e.g. `{ assetClass: 'effectiveAssetClass' }`, identity for the rest) used only when sorting `AggregateRow[]`.
- `Amount Invested`/`Market Value`/`G/L`/`G/L%` stay non-sortable headers (`<th>` without `onClick`), consistent with current behavior (see `product-behavior.md` line 44 — these were already display-only).

### 3. Component-level sort of aggregate rows (~20 min)
Depends on: Tasks 1, 2.
- Replace the current `positions = visiblePositions(state)` → `computedPositions = positions.map(computePosition...)` pipeline with: `visiblePositions(state)` (unfiltered by sort — the trailing `sortBy` inside `visiblePositions` is harmless/ignored since we resort after) → `buildAggregateRows(...)` → `sortBy(aggregateRows, AGGREGATE_SORT_FIELD[state.sortKey] ?? state.sortKey, state.sortDir)` (reuse `sortBy` from `src/lib/sort.ts` directly, it's already generic over `T`).
- `handleHeaderClick` keeps dispatching `TOGGLE_SORT` with the **Position** key exactly as before (unchanged reducer contract) — only the consumption side (Task 3's sort call) changes.
- Verify: sorting by `price`/`avgCost` on aggregate rows sorts by the *derived* `marketValue/shares` and `costBasis/shares`, not any member's raw field — this is what test case 6 checks.

### 4. Rewrite table body rendering (~20 min)
Depends on: Task 3.
- Remove the `Override` `<th>` and its `<td>`/`AssetClassOverrideSelect` usage from the main table entirely.
- Add a new right-aligned `<th>` (no sort, label can be empty or "Accounts") and a `<td>` per row rendering `<span className="tag tag-neutral">{row.accountCount}</span>`.
- Each `<tr>` gets `style={{ cursor: 'pointer' }}` and `onClick={() => setSelectedGroupKey(row.key)}`.
- Row cells: Symbol (`row.symbol` + `row.displayName` sub-line, same markup as today), Asset Class (`row.effectiveAssetClass`), Shares (`row.shares` formatted same as today via `.toLocaleString(...)`), Cost Basis = `avgCostStr` (fmtUSD(row.avgCost)), Current Price (`fmtUSD(row.price)`), Amount Invested (`fmtUSD(row.costBasis)`), Market Value (`fmtUSD(row.marketValue)`, bold), G/L (`fmtUSD(row.gl)` signed + color), G/L% (`fmtPct(row.glPct)` + color), Account-count badge.
- Remove the `AssetClassOverrideSelect` import from `PositionsTable.tsx` (moves to the new overlay file).

### 5. Add `PositionGroupOverlay.tsx` (~30 min)
Depends on: Task 1 (needs `AggregateRow`/grouping shape to know what to pass in), can start in parallel with Tasks 2–4 once Task 1 lands.
- Props: `{ group: AggregateRow, accounts: Account[], dispatch: (action: any) => void, onClose: () => void }`.
- Markup: copy `ImportDialog.tsx`'s backdrop/dialog/corner/title/X-button structure exactly (`dialog-backdrop` onClick=`onClose`, inner `dialog blueprint` onClick=`stopPropagation`, 4 `<i className="corner ...">`, header row with `dialog-title` = `` `${group.symbol} — ${group.displayName} — ${group.effectiveAssetClass}` `` + X close button).
- Add `useEffect` registering a `keydown` listener on `window` for `'Escape'` → `onClose()`, cleaned up on unmount (new code, no existing precedent — see Facts above).
- Body: a `.table` listing one row per `group.positions` member, sorted by owning `Account.name` ascending, fallback to `accountNumber` when `name` is blank (`(a.name.trim() || a.accountNumber).localeCompare(...)`; look up each position's account via `accounts.find(a => a.id === p.accountId)`). Columns: Account name, Shares, Avg Cost, Price, Cost Basis, Market Value, G/L, G/L%, and an `AssetClassOverrideSelect` cell (`<AssetClassOverrideSelect position={p} dispatch={dispatch} />`, unchanged component, same props as it received in the old main-table cell).
- Per-position row values come from `computePosition(p)` (not the group aggregate) — this table shows the real underlying numbers.

### 6. Wire overlay into `PositionsTable.tsx` (~10 min)
Depends on: Tasks 4, 5.
- Add `const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null)`.
- After building `aggregateRows`, find `const selectedGroup = aggregateRows.find(r => r.key === selectedGroupKey) ?? null`.
- Render `{selectedGroup && <PositionGroupOverlay group={selectedGroup} accounts={state.accounts} dispatch={dispatch} onClose={() => setSelectedGroupKey(null)} />}` at the end of the component's returned JSX.
- Import `PositionGroupOverlay` and `Account` type as needed.

### 7. Tests — `src/components/PositionsTable.test.tsx` (new file) (~40 min)
Depends on: Tasks 1–6 complete (needs final DOM/prop shape).
Follow `ClosedPositionsTable.test.tsx`'s pattern: literal `AppState` fixtures (include `accounts`, `positions`, all required `AppState` fields per `state.ts`'s `initialState()` shape — check `AppState` interface for any fields added since that test file was last touched, e.g. `importSessions`, `csvMappings`, `view`, `pendingImport`), `vi.fn()` for `dispatch`, `afterEach(cleanup)`.

Test cases (minimum, from interview):
1. Two positions, different accounts, same `symbol+effectiveAssetClass+taxCategory+retirement` → exactly one `<tr>` in the main table body; assert summed `shares`/`costBasis`/`marketValue` text and derived `price`/`avgCost`/`gl`/`glPct` text match hand-computed expected strings (`fmtUSD`/`fmtPct` formatting).
2. Same symbol, differing in only `taxCategory`, only `retirement`, or only effective asset class (three sub-cases or three separate `it`s) → each produces 2 separate rows, not 1.
3. A single-position group renders as its own row, `accountCount` badge shows "1", row is clickable, opening the overlay shows exactly 1 underlying row.
4. Click a multi-position row → overlay opens with the correct underlying positions (right account names/values), rows sorted by account name ascending (construct accounts with names deliberately out of alphabetical creation order to prove sorting, not insertion order).
5. Overlay closes via: pressing `Escape` (`fireEvent.keyDown(window, { key: 'Escape' })`), clicking the backdrop (`fireEvent.click` on `.dialog-backdrop`), and clicking the explicit close/X button — three separate assertions/`it`s, each re-opening the overlay first.
6. Sort by Market Value (click header) → aggregate rows ordered by summed `marketValue`, verified with a fixture where the per-position raw `price`/`shares` order would give a different (wrong) order if sorting were done pre-aggregation.
7. Account-count badge text matches `Set(accountIds).size` for a 3-position/2-account group (badge shows "2") and a 1-position group (badge shows "1").
8. `AssetClassOverrideSelect` rendered inside the overlay still dispatches `SET_ASSET_CLASS_OVERRIDE` with the same `{ positionId, override }` shape as before — open overlay, interact with the select, assert `mockDispatch` called correctly (adapt/port any pre-existing inline-override test if one existed in a prior version of this file; none currently exists per the repo scan, so this is new coverage).
9. (Regression) Main table has no `Override` column header and no inline `AssetClassOverrideSelect` — assert absence.
10. `grep -ri watchlist src/` still returns nothing (not a unit test — verify manually in Task 9's acceptance pass; this feature doesn't touch anything watchlist-related, just confirming no accidental scope creep).

### 8. Update `design.md` (~15 min)
Depends on: Tasks 1–6 settled.
- Component tree (lines ~93–116): change
  ```
  PositionsTable          (state, dispatch)
    AssetClassOverrideSelect (position, dispatch)  — per row
    ClosedPositionsTable    (state, dispatch)       — when state.showClosed
  ```
  to reflect grouping + overlay, e.g.:
  ```
  PositionsTable          (state, dispatch)  — groups visiblePositions() into aggregate rows (symbol+effectiveAssetClass+taxCategory+retirement); selectedGroupKey is component-local useState
    PositionGroupOverlay   (group, accounts, dispatch, onClose)  — when a row is clicked; lists underlying positions sorted by account name
      AssetClassOverrideSelect (position, dispatch)  — per underlying position, inside the overlay (moved out of the main table)
    ClosedPositionsTable    (state, dispatch)       — when state.showClosed
  ```
- Directory structure section (~line 37–38): add `PositionGroupOverlay.tsx` under `src/components/`.
- Data-flow / Selectors section (~line 132–139): add a note under the `visiblePositions(state)` bullet that `PositionsTable` further groups its output client-side into aggregate rows and sorts those (not the raw positions) by `state.sortKey`/`sortDir` — selectors themselves are unchanged, this grouping/sorting-of-aggregates lives in the component.
- Props convention line (~116): note `PositionGroupOverlay` takes `{ group, accounts, dispatch, onClose }`, following the narrower-props precedent already noted for `AssetClassOverrideSelect`.

### 9. Update `product-behavior.md` (~15 min)
Depends on: Task 8 (keep docs consistent with each other).
Rewrite "## Positions table" section (current lines 40–47):
- State that rows are aggregate groups (`symbol + effective asset class + tax category + retirement`), not individual positions; every group (including size-1) is a row.
- Update columns list: remove `Override` from the column list; add the trailing account-count badge (`.tag.tag-neutral`) column, right-aligned, showing count of distinct accounts in the group (shows "1" for single-account groups). **Resolved:** the `<th>` for this column has no visible label text (blank, matching how the old `Override` column's header was also unlabeled) — keeps the header row visually consistent.
- Update sortable-columns description: sorting now orders by the aggregate/derived group values (e.g. summed Market Value, derived Price = summed value / summed shares), computed client-side in `PositionsTable` after grouping — `TOGGLE_SORT` dispatch and `state.sortKey`/`sortDir` tracking are unchanged.
- Remove the old `**Override** column: ...` bullet; replace with a `**Row click → overlay**` bullet: clicking any row (cursor pointer) opens `PositionGroupOverlay`, a dialog (`.dialog-backdrop`/`.dialog`, closable via Escape/backdrop-click/X button) titled `Symbol — Name — Asset Class`, listing each underlying position (sorted by account name ascending, fallback account number) with Account name, Shares, Avg Cost, Price, Cost Basis, Market Value, G/L, G/L%, and the `AssetClassOverrideSelect` control (same behavior as before, just relocated into the overlay).
- Leave the Closed Positions toggle / `ClosedPositionsTable` bullets unchanged (out of scope).

### 10. Full-file review of both docs (~10 min)
Depends on: Tasks 8, 9.
- Re-read `design.md` and `product-behavior.md` in full. Confirm no stale references remain to "Override column" in the main table, no contradictions between the component-tree and data-flow sections, terse/token-optimized style preserved (no narrative prose creep).
- Fix anything stale found.

### 11. Run tests, build, verify, then commit (~15 min)
Depends on: all above tasks done.
- `npm run test` — all pass, including new `PositionsTable.test.tsx`.
- `npm run build` (typecheck + vite build) — passes; confirms `AggregateRow`/sort-field typing is sound and no `keyof Position` mismatches.
- `npm run lint` — passes.
- `grep -ri watchlist src/` — still empty (regression check per CLAUDE.md's design doc, unrelated to this feature but must not regress).
- Only if tests pass AND both reference docs are updated: commit with a message describing the aggregation + overlay feature, per CLAUDE.md's commit rule.

## Test cases (explicit list, mirrors Task 7)

1. Multi-account, same grouping key → 1 row, correct summed shares/costBasis/marketValue + derived price/avgCost/gl/glPct.
2. Differing taxCategory / retirement / effective asset class → separate rows (3 sub-cases).
3. Single-position group → 1 row, clickable, overlay shows exactly 1 underlying row.
4. Click opens overlay with correct underlying positions, sorted by account name ascending (fallback accountNumber).
5. Overlay closes via Escape, backdrop click, explicit close control (3 assertions).
6. Sort by Market Value orders aggregate rows by summed total, not any single underlying position's raw value.
7. Account-count badge shows correct count (multi-account and single-account cases).
8. `AssetClassOverrideSelect` inside overlay dispatches `SET_ASSET_CLASS_OVERRIDE` with correct `{ positionId, override }`.
9. Main table has no `Override` column / no inline `AssetClassOverrideSelect` (regression check for the removal).

## Acceptance criteria

- [ ] `PositionsTable.tsx` groups `visiblePositions(state)` by `symbol + effectiveAssetClass + account.taxCategory + account.retirement`; every group (size ≥ 1) renders as exactly one `<tr>`.
- [ ] Aggregate values computed as: `shares`/`costBasis`/`marketValue` summed from `computePosition()` per member; `price = marketValue/shares`, `avgCost = costBasis/shares`, `gl = marketValue - costBasis`, `glPct = costBasis === 0 ? 0 : (gl/costBasis)*100`.
- [ ] `Override` column and inline `AssetClassOverrideSelect` removed from the main table; replaced by a right-aligned `.tag.tag-neutral` account-count badge.
- [ ] Every row is clickable (`cursor: pointer`) and opens `PositionGroupOverlay` with that group's underlying positions.
- [ ] `PositionGroupOverlay` is a new file (`src/components/PositionGroupOverlay.tsx`) reusing `.dialog-backdrop`/`.dialog` markup pattern copied from `ImportDialog.tsx`; closable via Escape (new `keydown` listener), backdrop click, and an explicit close/X control.
- [ ] Overlay title identifies the group (`Symbol — Name — Asset Class`); lists underlying positions sorted by account name ascending (fallback accountNumber), with columns Account name/Shares/Avg Cost/Price/Cost Basis/Market Value/G/L/G/L%/`AssetClassOverrideSelect`.
- [ ] Column headers (Symbol, Asset Class, Shares, Cost Basis, Current Price, Amount Invested, Market Value, G/L, G/L%) unchanged in identity; header-click still dispatches `TOGGLE_SORT` with `keyof Position` unchanged; consumption re-sorts the post-grouping `AggregateRow[]` by the mapped field and `state.sortDir`.
- [ ] `selectedGroupKey`/equivalent overlay-open state is `useState` local to `PositionsTable`, not added to `AppState`/reducer.
- [ ] Asset-class filter tags and search box behavior unchanged (still operate pre-grouping on `state.positions`/`visiblePositions`).
- [ ] `ClosedPositionsTable.tsx` and `TransactionsTable.tsx` untouched.
- [ ] `src/components/PositionsTable.test.tsx` created, covering all 9 test cases above.
- [ ] `design.md` component-tree, directory-structure, and data-flow/selectors sections updated to reflect `PositionGroupOverlay` and component-level grouping/sorting.
- [ ] `product-behavior.md` "## Positions table" section rewritten: aggregation, account-count badge, overlay behavior, Override column removal.
- [ ] Full-file review of both docs done post-change; no stale/contradictory content.
- [ ] `npm run test` passes fully.
- [ ] `npm run build` passes (typecheck clean).
- [ ] `npm run lint` passes.
- [ ] `grep -ri watchlist src/` returns nothing.
- [ ] Commit created only after tests pass and docs are updated, not before.
