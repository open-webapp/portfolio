# Positions overlay: editable position entries (shares/avgCost/price/taxes)

Goal: make `shares`, `avgCost` (Cost Basis column), `price` (Current Price column), and a
**new** `taxes` column inline-editable in `PositionGroupOverlay.tsx` (the per-group dialog
opened from `PositionsTable.tsx`). Click a value → input, Enter/blur commits, Escape cancels —
same pattern as `Settings.tsx`'s `AccountRow` name/accountNumber fields. Persists via the
existing `UPDATE_POSITION` action / `updatePosition()` helper — no new reducer case or
`state.ts` helper needed.

Followed structure of `plans/positions-aggregate-by-symbol.md` (most recent plan in this repo
with this shape; no `_template.md` exists).

Files touched:
- `src/components/PositionGroupOverlay.tsx` (add inline-edit cells, add Taxes column)
- `src/components/PositionGroupOverlay.test.tsx` (new — no test file exists for this component today)
- `design.md`
- `product-behavior.md`

Explicitly out of scope: `src/components/AssetClassOverrideSelect.tsx` (untouched), any
`accountId`/`symbol` reassignment, `src/components/PositionsTable.tsx` grouping/sort logic,
`ClosedPositionsTable.tsx`, `TransactionsTable.tsx`.

## Facts confirmed by reading code first

- `src/components/PositionGroupOverlay.tsx` (current, 161 lines): stateless functional
  component, props `{ group: AggregateRow, accounts: Account[], dispatch, onClose }`. Renders
  one `<tr>` per `group.positions` member (sorted by account name asc, fallback
  `accountNumber`), each row built via `computePosition(p)` → `{...computed, glColor, glStr,
  glPctStr, sharesStr, avgCostStr, costBasisStr, priceStr, marketValueStr, accountName}`. Table
  columns today (line ~124-132): Account, Shares, Cost Basis, Current Price, Amount Invested,
  Market Value, G/L, G/L %, Override. No `taxes` column exists; `taxes` is not read/rendered
  anywhere in this file.
- `src/lib/types.ts` line 43/69: `Position.taxes: number | null`. `computations.ts` line 25/52
  explicitly notes `taxes` is stored but unused in `computePosition`/allocation math — confirms
  taxes is purely a stored/display field, safe to add without touching computation formulas.
- `src/lib/computations.ts` `computePosition(p)`: returns `p` merged with `marketValue,
  costBasis, gl, glPct` derived from `shares/avgCost/price` only. These four are the "computed,
  never directly editable" columns per requirements — they update automatically via normal
  React re-render once `shares`/`avgCost`/`price` change in state, no extra wiring needed.
- `src/lib/reducer.ts` line 32-33: `case 'UPDATE_POSITION': return
  StateActions.updatePosition(state, action.positionId, action.patch)` — already exists, already
  generic `Partial<Position>` patch. `src/lib/state.ts` line 124-134: `updatePosition(state,
  positionId, patch)` does `state.positions.map(p => p.id === positionId ? {...p, ...patch} :
  p)`. Both usable as-is, zero changes needed to `reducer.ts`/`state.ts`.
- Same `UPDATE_POSITION`/`updatePosition` path is already exercised today by a *different*
  action, `SET_ASSET_CLASS_OVERRIDE` (reducer.ts line ~36, also calls `StateActions.
  updatePosition`) — confirms the plumbing is proven/working, this feature just adds a second
  action type (`UPDATE_POSITION` itself, dispatched directly) reusing the identical reducer path.
- Inline-edit precedent: `src/components/Settings.tsx` `AccountRow` (lines ~277-390).
  Per-field: `useState<boolean>` edit-mode flag + `useState<string>` local draft value.
  `handle*Blur`: if new value truthy/valid and different from current, dispatch a patch action;
  either way reset local draft state back to the canonical prop value and exit edit mode.
  `handle*KeyDown`: `Enter` → call the same blur handler; `Escape` → reset draft to canonical
  value and exit edit mode (no dispatch). Display span: `onClick={() => setIsEditing(true)}`,
  `style={{ cursor: 'pointer', textDecoration: 'underline' }}`, `title="Click to edit"`. Input:
  `className="input"`, `onBlur`, `onKeyDown`, `autoFocus`. **Deviation required by this
  feature's spec**: point 2 says no hover affordance at all (cells look identical to today until
  clicked) — so unlike `AccountRow`'s `cursor:pointer`+underline+title, the new cells must omit
  all three (no `cursor`, no `textDecoration`, no `title`) and just be a plain `<span
  onClick={...}>`. Confirmed against interview point 2, not guessed.
- `Settings.tsx`'s fields are `type="text"`; this feature uses `type="number"` per point 2,
  so parsing is `Number(e.target.value)` off `input.value` (a string) rather than the text
  fields' direct string state — need `useState<string>` for the raw input text (to allow
  transient invalid/empty states while typing) and parse only on commit (blur/Enter), matching
  `AccountRow`'s "local string draft, parse/validate on commit" shape.
- No existing numeric-validation helper in the codebase (checked `src/lib/` — no `isValidNumber`
  /`parseNonNegative` utility). This plan adds one small local helper inline in
  `PositionGroupOverlay.tsx` (not `src/lib/`, since it's a one-file UI concern, not shared domain
  logic) — see Task 2.
- Reference-docs location: point 7 in the task assumed no established location exists under
  `src/components/`. **Resolved by reading the repo**: `design.md` and `product-behavior.md`
  already exist at the **repo root** (`/Users/mdoraiswamy/owa/portfolio/design.md`,
  `.../product-behavior.md`), not per-module — confirmed via `find`. The prior plan
  (`plans/positions-aggregate-by-symbol.md`, Tasks 8-9) updated exactly these two root files for
  the previous `PositionGroupOverlay` change (component tree, data flow, "## Positions table"
  section). **No open question**: this plan updates the same two root files, not new
  `src/components/design.md`/`product-behavior.md` files — there is no per-component reference
  doc convention in this repo, only one root-level pair covering the whole app.
- `product-behavior.md` current "## Positions table" section (line 47) already documents the
  overlay's Override column and table columns list ending in `..., G/L%, Override` — needs the
  new Taxes column and edit-behavior bullet added.
- `design.md` line 110/118 already documents `PositionGroupOverlay` in the component tree and
  props convention — needs a note that cells are self-contained edit state, still same props
  signature (no new props needed, `dispatch` already passed in).
- Test-file precedent: `src/components/PositionsTable.test.tsx` (existing, covers the overlay
  indirectly by mounting `PositionsTable` and clicking a row) uses literal `AppState`-adjacent
  `Position`/`Account` fixtures, `vi.fn()` dispatch, `afterEach(cleanup)`,
  `@testing-library/react`'s `render`/`fireEvent`/`screen`/`within`. This plan's new
  `PositionGroupOverlay.test.tsx` renders `PositionGroupOverlay` directly (not through
  `PositionsTable`) with a hand-built `AggregateRow` + `Account[]` + `vi.fn()` dispatch +
  `onClose` — faster/more isolated than mounting the whole table.

## Tasks

### 1. Add `taxes` column to the overlay table (~15 min)
No dependency — first task.
- In `PositionGroupOverlay.tsx`, add `<th style={{ textAlign: 'right' }}>Taxes</th>` to `<thead>`
  between `Current Price` and `Amount Invested` (matches column order convention: raw editable
  fields first, then computed fields) — confirm exact placement doesn't clash with anything, no
  hard requirement on order beyond "add the column," so pick this position and note it in docs.
- In `computedPositions.map`, add `taxesStr: fmtUSD(p.taxes ?? 0)` (display `$0.00` for `null`,
  matching how the rest of the table already formats currency — `taxes` is never actually `null`
  going forward per point 4's exception, but existing/imported data may still have `null`).
- Add corresponding `<td style={{ textAlign: 'right' }}>{p.taxesStr}</td>` in the row map, same
  position as the header.
- This task alone (no edit behavior yet) should compile/render; sanity-check by eyeballing dev
  server or an ad hoc render before layering edit state on top.

### 2. Add local validation helper + edit-cell component (~30 min)
Depends on: Task 1 (touches same file, do sequentially to avoid merge noise — could technically
be parallel but same file, so sequential is simpler).
- Add a small local helper in `PositionGroupOverlay.tsx` (not exported, not in `src/lib/`):
  ```ts
  function parseNonNegative(raw: string): number | null {
    if (raw.trim() === '') return null
    const n = Number(raw)
    if (Number.isNaN(n) || n < 0) return null
    return n
  }
  ```
  Used for `shares`/`avgCost`/`price` (empty or invalid → `null` → revert, no dispatch) and for
  `taxes` with the point-4 exception handled at the call site (empty string → save `0`, not
  revert — do NOT fold the exception into this shared helper, keep it a plain "parse or null"
  utility and special-case taxes at the callsite so the helper stays honest/reusable).
- Add a small reusable inline sub-component `EditableCell` in the same file (function
  component, not exported) to avoid repeating the 4x boilerplate:
  ```ts
  function EditableCell({
    value, positionId, field, dispatch, allowEmptyAsZero,
  }: {
    value: number
    positionId: string
    field: 'shares' | 'avgCost' | 'price' | 'taxes'
    dispatch: (action: any) => void
    allowEmptyAsZero?: boolean
  })
  ```
  Internally: `useState<boolean>` `isEditing`, `useState<string>` `draft` (initialized from
  `String(value)` when entering edit mode, not on every render — set on the click handler that
  flips `isEditing` true, mirroring `AccountRow`'s pattern of resetting draft to canonical value
  around edit-mode transitions).
  - Display mode: `<span onClick={() => { setDraft(String(value)); setIsEditing(true) }}>`
    formatted via the same `fmtUSD`/plain-number logic already used for that column (reuse
    `fmtUSD` for avgCost/price/taxes; shares uses the existing `.toLocaleString(...)` 2-decimal
    format) — **no cursor/underline/title styling**, per point 2's "no hover affordance."
  - Edit mode: `<input type="number" className="input" value={draft}
    onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown}
    autoFocus />`.
  - `commit()`: if `field === 'taxes' && draft.trim() === ''` → dispatch `{ type:
    'UPDATE_POSITION', positionId, patch: { taxes: 0 } }`, exit edit mode. Else `parsed =
    parseNonNegative(draft)`; if `parsed === null` → revert silently (no dispatch, just exit edit
    mode, display reverts to `value` prop automatically since draft is discarded on next render
    once `isEditing` is false). If `parsed !== null` → dispatch `{ type: 'UPDATE_POSITION',
    positionId, patch: { [field]: parsed } }`, exit edit mode.
  - `handleKeyDown`: `Enter` → call `commit()`. `Escape` → `setIsEditing(false)` directly (no
    dispatch, no commit call — draft is simply discarded).
  - Note: `onBlur` and `Enter`'s `commit()` could double-fire (Enter triggers blur too in some
    browsers) — mirror `AccountRow`'s existing behavior exactly (it has the same
    theoretical double-fire and the codebase already accepts that shape), don't over-engineer a
    guard beyond what `AccountRow` has (idempotent dispatch is harmless — dispatching the same
    patch twice is a no-op state-wise).

### 3. Wire `EditableCell` into the four target columns (~15 min)
Depends on: Task 2.
- Replace the plain `{p.sharesStr}` cell with `<EditableCell value={p.shares} positionId={p.id}
  field="shares" dispatch={dispatch} />` (note: pass raw numeric `p.shares`, not the
  pre-formatted `sharesStr`, since `EditableCell` needs the actual number to seed `draft` and to
  format display itself).
- Same for `avgCost` (Cost Basis column), `price` (Current Price column), `taxes` (new column
  from Task 1).
- Leave `Amount Invested`/`Market Value`/`G/L`/`G/L %` cells completely untouched — plain
  `<td>{p.costBasisStr}</td>` etc., no `EditableCell`, confirming they stay read-only/computed.
- Leave `Account` cell and the `Override`/`AssetClassOverrideSelect` cell completely untouched.

### 4. Tests — `src/components/PositionGroupOverlay.test.tsx` (new file) (~40 min)
Depends on: Tasks 1-3 (needs final DOM shape).
Follow `PositionsTable.test.tsx`'s fixture style (literal `Position`/`Account` objects) but
render `PositionGroupOverlay` directly with a hand-built `AggregateRow`. Minimum test cases (per
interview point 6):
1. Clicking the displayed `shares` value renders an `<input>` pre-filled with the current
   shares value (repeat for `avgCost`, `price`, `taxes` — 4 cases or one parameterized `it.each`).
2. Enter with a valid new value dispatches `UPDATE_POSITION` with `{ positionId, patch: {
   [field]: <parsed number> } }` and returns to display mode showing the new formatted value
   (cover at least one field via Enter, one via blur/`fireEvent.blur`, to prove both commit
   paths work).
3. Escape while editing reverts the input/display to the previous value and asserts
   `mockDispatch` was **not** called with an `UPDATE_POSITION` action for that field.
4. Invalid value (negative number, e.g. `-5`) on `shares`/`avgCost`/`price`/`taxes`, blurred →
   reverts silently to previous displayed value, `mockDispatch` not called. Also cover
   empty-string blur for `shares`/`avgCost`/`price` specifically (must revert, NOT save as 0 —
   this is the taxes-only exception, must be distinguished in tests).
5. Empty-string blur for `taxes` specifically → **does** dispatch `{ type: 'UPDATE_POSITION',
   positionId, patch: { taxes: 0 } }` (the point-4 exception) — a dedicated test, not folded into
   case 4, since it's the one case where empty input behaves differently by field.
6. Computed columns (`Amount Invested`/`Market Value`/`G/L`/`G/L %`) render as plain text with no
   click-to-edit: assert no `<input>` appears after clicking those cells' `<td>` (e.g.
   `fireEvent.click` on the cell, then assert `screen.queryByRole('spinbutton')` count is
   unchanged, or more simply assert those `<td>`s contain no `onClick` — least brittle is
   `fireEvent.click(cell); expect(container.querySelectorAll('input')).toHaveLength(0)`).
7. (Regression) `Account` cell and `AssetClassOverrideSelect`/Override cell remain unchanged —
   clicking the account name text does not produce an input; the override `<select>` still
   renders and is untouched by this change (reuse assertions similar to
   `PositionsTable.test.tsx` test 8's override-select check, adapted to render
   `PositionGroupOverlay` directly instead of via `PositionsTable`).

### 5. Update `design.md` (~10 min)
Depends on: Tasks 1-3 settled.
- In the component-tree section (`PositionGroupOverlay` entry, current line ~110), add a short
  clause noting per-cell inline-edit state (`shares`/`avgCost`/`price`/`taxes` editable,
  click-to-edit/Enter-or-blur-commit/Escape-cancel, dispatches `UPDATE_POSITION` directly — reuses
  the same `updatePosition()` reducer path already used by `SET_ASSET_CLASS_OVERRIDE`). No props
  signature change (still `{ group, accounts, dispatch, onClose }`) — note this explicitly so
  it's clear no new prop was added for this feature.
- No change needed to "Action types (reducer.ts)" section — `UPDATE_POSITION` already existed
  there before this feature; confirm by re-reading that section during Task 6's full review and
  only touch it if it's currently missing (check, don't assume).

### 6. Update `product-behavior.md` (~10 min)
Depends on: Task 5 (keep docs consistent with each other).
- In "## Positions table" section, extend the overlay-columns list to include `Taxes` (note its
  position in the column order chosen in Task 1) and mark which columns are click-to-edit:
  Shares, Cost Basis (avgCost), Current Price, Taxes are editable; Account, Amount Invested,
  Market Value, G/L, G/L%, Override are not.
- Add a bullet describing the edit UX: click a value → input (type=number) → Enter or blur
  saves (validated non-negative number required; invalid/empty reverts silently, **except**
  empty `Taxes` saves as `0`) → Escape cancels and reverts, no error UI on invalid input.

### 7. Full-file review of both docs (~10 min)
Depends on: Tasks 5, 6.
- Re-read `design.md` and `product-behavior.md` in full. Confirm no stale references to the old
  non-editable overlay table, no contradictions between component-tree/data-flow and the
  Positions-table section, terse/token-optimized style preserved.
- Fix anything stale found.

### 8. Run tests, build, verify, then commit (~15 min)
Depends on: all above tasks done.
- `npm run test` — all pass, including new `PositionGroupOverlay.test.tsx`; also re-run
  `PositionsTable.test.tsx` to confirm the overlay change didn't break its existing overlay
  interaction tests (it clicks into the overlay and checks the Override select, which is
  untouched, but the DOM shape around it changed).
- `npm run build` (typecheck + vite build) — passes; confirms `EditableCell`'s prop typing and
  `UPDATE_POSITION` patch shapes are sound against `Partial<Position>`.
- `npm run lint` — passes.
- `grep -ri watchlist src/` — still empty (unrelated regression check, per CLAUDE.md).
- Only if tests pass AND both docs are updated: commit with a message describing the
  inline-editable overlay-cell feature.

## Test cases (explicit list, mirrors Task 4)

1. Click on shares/avgCost/price/taxes value → input pre-filled with current value (4 sub-cases).
2. Valid new value + Enter → dispatches `UPDATE_POSITION` with correct `positionId`/`patch`,
   returns to display mode with new value.
3. Valid new value + blur → same dispatch/display behavior as Enter (separate case, proves both
   commit paths work).
4. Escape while editing → reverts to previous value, no dispatch.
5. Invalid (negative) value + blur → reverts silently, no dispatch (per field).
6. Empty value + blur on shares/avgCost/price → reverts silently, no dispatch.
7. Empty value + blur on taxes → dispatches `{ patch: { taxes: 0 } }`.
8. Computed columns (Amount Invested/Market Value/G/L/G/L%) have no click-to-edit behavior.
9. Account cell and Override/`AssetClassOverrideSelect` cell unchanged/untouched by this feature.

## Acceptance criteria

- [ ] `PositionGroupOverlay.tsx` renders a new `Taxes` column (header + per-row value), sourced
      from `Position.taxes` (`null` displayed as `$0.00`).
- [ ] `shares`, `avgCost` (Cost Basis), `price` (Current Price), `taxes` cells are independently
      click-to-edit: click → `<input type="number">` pre-filled with current value, no hover
      affordance (no cursor/underline/title change) before clicking.
- [ ] Enter or blur with a valid non-negative number commits: dispatches `{ type:
      'UPDATE_POSITION', positionId, patch: { <field>: <parsed number> } }` via the existing
      reducer path (`reducer.ts` line ~32-33 → `state.ts`'s `updatePosition`), no new reducer
      case or `state.ts` helper added.
- [ ] Escape cancels: reverts to previous displayed value, no dispatch.
- [ ] Invalid input (negative, non-numeric, empty) on `shares`/`avgCost`/`price` reverts
      silently on blur/Enter — no dispatch, no error UI.
- [ ] Empty input on `taxes` specifically dispatches `patch: { taxes: 0 }` (not a revert, not
      `null`) — the one exception to the revert-on-empty rule.
- [ ] `Amount Invested`, `Market Value`, `G/L`, `G/L %` cells remain plain (non-editable) text;
      they update automatically via re-render once the underlying position's
      `shares`/`avgCost`/`price` change (no manual recompute wiring needed — `computePosition()`
      already derives them fresh each render).
- [ ] `Account` cell and `Override`/`AssetClassOverrideSelect` cell/behavior completely
      unchanged.
- [ ] `AssetClassOverrideSelect.tsx` not modified.
- [ ] `src/components/PositionGroupOverlay.test.tsx` created (new file), covering all 9 test
      cases above.
- [ ] `design.md` updated: `PositionGroupOverlay` component-tree entry notes per-cell inline
      edit behavior; confirms no new props added.
- [ ] `product-behavior.md` "## Positions table" section updated: Taxes column added to the
      overlay column list, editable vs. non-editable columns identified, edit UX (click/Enter or
      blur/Escape/validation/taxes-empty-exception) documented.
- [ ] Full-file review of both docs done post-change; no stale/contradictory content.
- [ ] `npm run test` passes fully, including pre-existing `PositionsTable.test.tsx`.
- [ ] `npm run build` passes (typecheck clean).
- [ ] `npm run lint` passes.
- [ ] `grep -ri watchlist src/` returns nothing.
- [ ] Commit created only after tests pass and docs are updated, not before.
