# Positions overlay: editable position entries (all fields, incl. Account/Symbol)

Goal: make **every non-computed field** in `PositionGroupOverlay.tsx` (the per-group dialog
opened from `PositionsTable.tsx`) inline-editable: `shares`, `avgCost` (Cost Basis column),
`price` (Current Price column), a **new** `taxes` column, plus (per revised scope) `symbol`
(text) and `accountId` (dropdown, with inline "create new account" support). Click a value →
input, Enter/blur commits, Escape cancels — same pattern as `Settings.tsx`'s `AccountRow`
name/accountNumber fields. Persists via the existing `UPDATE_POSITION` action /
`updatePosition()` helper (plus `ADD_ACCOUNT` for the new-account-creation sub-flow) — no new
reducer case or `state.ts` helper needed for either.

Followed structure of `plans/positions-aggregate-by-symbol.md` (most recent plan in this repo
with this shape; no `_template.md` exists).

**Revision note**: this plan originally scoped only `shares`/`avgCost`/`price`/`taxes`. The user
clarified "ALL fields must be editable — including the account and symbol." This revision adds
Symbol (text) and Account (dropdown + inline account-creation) editing, and a test for the
group-membership-change side effect that editing either one causes. Everything else from the
original plan (shares/avgCost/price/taxes editing, `EditableCell` pattern, doc updates) is
unchanged.

Files touched:
- `src/components/PositionGroupOverlay.tsx` (add inline-edit cells, Taxes column, Symbol text
  edit, Account dropdown + create-new-account mini-form)
- `src/components/PositionGroupOverlay.test.tsx` (new — no test file exists for this component
  today)
- `src/components/import/ImportDialog.tsx` (export `TAX_CATEGORY_LABELS` so it can be reused —
  see Task 3a; no behavior change in this file otherwise)
- `design.md`
- `product-behavior.md`

Explicitly out of scope: `src/components/AssetClassOverrideSelect.tsx` (untouched, its own
already-fully-editable control), `src/components/PositionsTable.tsx` grouping/sort logic itself
(read from, not modified — `buildGroupKey`/`buildAggregateRows` stay as-is; the overlay's
group-membership-drop behavior falls out of them naturally), `ClosedPositionsTable.tsx`,
`TransactionsTable.tsx`. The base (pre-override) `assetClass` field remains not directly
user-editable anywhere — unchanged by this plan.

## Facts confirmed by reading code first

- `src/components/PositionGroupOverlay.tsx` (current, 161 lines): stateless functional
  component, props `{ group: AggregateRow, accounts: Account[], dispatch, onClose }`. Renders
  one `<tr>` per `group.positions` member (sorted by account name asc, fallback
  `accountNumber`), each row built via `computePosition(p)` → `{...computed, glColor, glStr,
  glPctStr, sharesStr, avgCostStr, costBasisStr, priceStr, marketValueStr, accountName}`. Table
  columns today (line ~124-132): Account, Shares, Cost Basis, Current Price, Amount Invested,
  Market Value, G/L, G/L %, Override. No `taxes` column exists; `taxes` is not read/rendered
  anywhere in this file. `accounts: Account[]` is already a prop — no new prop needed for the
  Account dropdown.
- `src/lib/types.ts` line 43/69: `Position.taxes: number | null`. `computations.ts` line 25/52
  explicitly notes `taxes` is stored but unused in `computePosition`/allocation math — confirms
  taxes is purely a stored/display field, safe to add without touching computation formulas.
- `src/lib/computations.ts` `computePosition(p)`: returns `p` merged with `marketValue,
  costBasis, gl, glPct` derived from `shares/avgCost/price` only. These four are the "computed,
  never directly editable" columns — see explicit note below; they update automatically via
  normal React re-render once `shares`/`avgCost`/`price` change in state, no extra wiring needed.
- `src/lib/reducer.ts` line 32-33: `case 'UPDATE_POSITION': return
  StateActions.updatePosition(state, action.positionId, action.patch)` — already exists, already
  generic `Partial<Position>` patch, so it accepts `{ symbol }` and `{ accountId }` patches with
  zero changes. `src/lib/state.ts` line 124-134: `updatePosition(state, positionId, patch)` does
  `state.positions.map(p => p.id === positionId ? {...p, ...patch} : p)`. Both usable as-is for
  every field in this plan's scope, including `symbol`/`accountId`.
- `ADD_ACCOUNT` reducer case (checked `reducer.ts`) dispatches to a `state.ts` helper that
  appends to `state.accounts` — already exercised by `ImportDialog.tsx`'s new-account flow (see
  below). No new reducer/state.ts code needed for account creation either.
- Same `UPDATE_POSITION`/`updatePosition` path is already exercised today by a *different*
  action, `SET_ASSET_CLASS_OVERRIDE` (reducer.ts line ~36, also calls `StateActions.
  updatePosition`) — confirms the plumbing is proven/working, this feature just adds more
  fields to the patch shapes dispatched through the identical reducer path.
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
  onClick={...}>`. Confirmed against interview point 2, not guessed. This applies to the Symbol
  text cell too (same `EditableCell`-style pattern, `type="text"` variant). The Account cell is a
  dropdown, not a click-to-edit span — see below — so "no hover affordance" doesn't apply to it
  the same way; it keeps its own natural dropdown affordance (matching `AssetClassOverrideSelect`
  precedent, which does show a clickable button).
- `Settings.tsx`'s fields are `type="text"`; the shares/avgCost/price/taxes cells in this
  feature use `type="number"`, so parsing is `Number(e.target.value)` off `input.value` (a
  string) rather than the text fields' direct string state — need `useState<string>` for the raw
  input text (to allow transient invalid/empty states while typing) and parse only on commit
  (blur/Enter), matching `AccountRow`'s "local string draft, parse/validate on commit" shape.
  `symbol` reuses the same `EditableCell`-style local-draft-string pattern but with
  `type="text"` and string (not numeric) validation (non-empty after trim).
- No existing numeric-validation helper in the codebase (checked `src/lib/` — no `isValidNumber`
  /`parseNonNegative` utility). This plan adds one small local helper inline in
  `PositionGroupOverlay.tsx` (not `src/lib/`, since it's a one-file UI concern, not shared domain
  logic) — see Task 2.
- `src/components/AssetClassOverrideSelect.tsx` (161 lines, read in full): the dropdown pattern
  to follow for the Account selector. Shape: `useState<boolean> isOpen` + a trigger `<button>`
  (`onClick={() => setIsOpen(!isOpen)}`) that shows the current value; when `isOpen`, an
  absolutely-positioned `<div>` panel (`position: 'absolute', top: '100%', ...`) lists options as
  clickable `<div>` rows with `onClick={() => handleSelect(...)}`, hover background-color via
  `onMouseEnter`/`onMouseLeave` inline handlers, closes (`setIsOpen(false)`) on selection. This
  plan's `AccountDropdown` sub-component reuses this exact shape: trigger button shows current
  account's name (+ number), panel lists `accounts.map(...)` as clickable rows plus one extra
  "+ Create new account" row at the bottom (styled like `AssetClassOverrideSelect`'s "+ Use ..."
  new-value row — italic, top border, accent color). No search/free-type input needed for
  Account (unlike asset class) — it's a closed list from `accounts` plus the one "create new"
  affordance, so the `searchTerm`/`filteredOptions`/`isNewValue` machinery is not reused, just
  the open/close + option-row visual style.
- `src/components/import/ImportDialog.tsx` (relevant lines read): `NewAccountFields` interface
  (line ~21-26): `{ name: string; number: string; category: TaxCategory; retirement: boolean }`.
  `TAX_CATEGORY_LABELS` (line ~28-32): `Record<TaxCategory, string>` = `{ taxable: 'Taxable',
  nonTaxable: 'Non-Taxable', taxDeferred: 'Tax-Deferred' }` — **currently not exported** (no
  `export` keyword). This plan adds `export` to that one declaration in `ImportDialog.tsx` (Task
  3a) so `PositionGroupOverlay.tsx` can `import { TAX_CATEGORY_LABELS } from
  './import/ImportDialog'` rather than duplicating the object — smallest possible touch to that
  file, no other change to it. New-account creation (line ~319-330, inside `handleImport`):
  ```ts
  const newAccount: Account = {
    id: uid('acc'),
    accountNumber: newAccountFields.number,
    name: newAccountFields.name,
    taxCategory: newAccountFields.category,
    retirement: newAccountFields.retirement,
    createdAt: new Date().toISOString(),
  }
  dispatch({ type: 'ADD_ACCOUNT', account: newAccount })
  ```
  `uid` is imported from `src/lib/seed.ts` (`uid(prefix) => prefix + '-' + Math.random()
  .toString(36).slice(2, 9)`) — this plan's inline mini-form uses the identical `uid('acc')`
  call, imported the same way. The category `<select>` (line ~653-666) has exactly three
  `<option>`s: `taxable`/`nonTaxable`/`taxDeferred` with labels `Taxable`/`Non-Taxable`/
  `Tax-Deferred` (matches `TAX_CATEGORY_LABELS`) — this plan's mini-form select reuses the same
  three options (can render via `Object.entries(TAX_CATEGORY_LABELS).map(...)` instead of
  hand-writing three `<option>` tags, slightly more DRY than `ImportDialog.tsx`'s own
  hand-written version, but functionally identical). Retirement is a plain `<input
  type="checkbox">` bound to `newAccountFields.retirement`. `Account` type (from `types.ts`):
  `{ id, accountNumber, name, taxCategory, retirement, createdAt }` — `createdAt: new
  Date().toISOString()`, matching `ImportDialog.tsx` exactly.
- `src/components/PositionsTable.tsx` `buildGroupKey(position, accounts)` (confirmed by reading
  the file in full): key = `` `${symbol}|${effectiveAssetClass}|${taxCategory}|${retirement}` ``
  where `effectiveAssetClass = position.assetClassManualOverride || position.assetClass`, and
  `taxCategory`/`retirement` come from the position's resolved `Account` (sentinel
  `unknown`/`false` if account not found). `PositionsTable` recomputes `aggregateRows` fresh
  every render via `buildAggregateRows(visiblePositions(state), state.accounts)` (not memoized
  beyond plain recompute-per-render) and re-derives `selectedGroup = aggregateRows.find(r =>
  r.key === selectedGroupKey)`, passing `group={selectedGroup}` to `<PositionGroupOverlay>`.
  Confirms: editing `symbol` or `accountId` on a position changes its `buildGroupKey()` output on
  the next render (since `symbol` is a direct key component, and `accountId` changes which
  account's `taxCategory`/`retirement` are looked up), so the position moves to a different (or
  brand-new) `AggregateRow.positions` array. Since `PositionGroupOverlay`'s row loop maps over
  the live `group.positions` prop (not a locally cached copy — confirmed no `useState` copy of
  `group.positions` exists or is added by this plan), the edited position naturally disappears
  from the currently-open overlay's table on the next render once its group key no longer
  matches `selectedGroupKey`. **No code change is required for the disappearing behavior itself**
  — only a test asserting it (Task 4a) and a doc note (Task 6).
- Reference-docs location: `design.md` and `product-behavior.md` already exist at the **repo
  root** (`/Users/mdoraiswamy/owa/portfolio/design.md`, `.../product-behavior.md`), not
  per-module — confirmed via `find`. The prior plan (`plans/positions-aggregate-by-symbol.md`,
  Tasks 8-9) updated exactly these two root files for the previous `PositionGroupOverlay` change
  (component tree, data flow, "## Positions table" section). This plan updates the same two root
  files.
- `product-behavior.md` current "## Positions table" section already documents the overlay's
  Override column and table columns list ending in `..., G/L%, Override` — needs the new Taxes
  column, Symbol/Account edit behavior, and edit-behavior bullets added.
- `design.md` already documents `PositionGroupOverlay` in the component tree and props
  convention — needs a note that cells are self-contained edit state, still same props signature
  (no new props needed — `accounts` and `dispatch` were already passed in), plus a note that the
  Account dropdown can trigger an `ADD_ACCOUNT` dispatch (new account creation) in addition to
  `UPDATE_POSITION`.
- Test-file precedent: `src/components/PositionsTable.test.tsx` (existing, covers the overlay
  indirectly by mounting `PositionsTable` and clicking a row) uses literal `AppState`-adjacent
  `Position`/`Account` fixtures, `vi.fn()` dispatch, `afterEach(cleanup)`,
  `@testing-library/react`'s `render`/`fireEvent`/`screen`/`within`. This plan's new
  `PositionGroupOverlay.test.tsx` renders `PositionGroupOverlay` directly (not through
  `PositionsTable`) with a hand-built `AggregateRow` + `Account[]` + `vi.fn()` dispatch +
  `onClose` — faster/more isolated than mounting the whole table. The group-membership-change
  test (Task 4a) is the one exception: it needs to observe the overlay's row *disappearing* after
  an edit, which requires re-deriving `group.positions` the way `PositionsTable` does — see Task
  4a for exact approach (render `PositionsTable`, not `PositionGroupOverlay` directly, for that
  one test).

## Fields that remain NOT directly editable (explicit — not a scope gap)

Per CLAUDE.md: "Computed position fields (marketValue, costBasis, gl, glPct) are derived in
`src/lib/computations.ts`, never stored on the `Position` itself." The overlay's `Amount
Invested` (total costBasis), `Market Value`, `G/L`, `G/L%` columns are these derived values —
they are recomputed by `computePosition()` fresh every render from `shares`/`avgCost`/`price`
and are **not fields on `Position` at all**, so they cannot be made directly editable; editing
`shares`/`avgCost`/`price` already changes them indirectly via normal re-render. This is a hard
architectural invariant, not a remaining scope item, and this plan does not touch it.
`assetClassManualOverride` stays exactly as-is via its existing dedicated
`AssetClassOverrideSelect` control (already fully editable, untouched by this plan). The base
(pre-override) `assetClass` field itself is not user-editable anywhere in the app, and this plan
does not add that either.

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

### 2. Add local validation helper + numeric `EditableCell` component (~30 min)
Depends on: Task 1 (touches same file, do sequentially to avoid merge noise).
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
    browsers) — mirror `AccountRow`'s existing behavior exactly (it has the same theoretical
    double-fire and the codebase already accepts that shape), don't over-engineer a guard beyond
    what `AccountRow` has (idempotent dispatch is harmless — dispatching the same patch twice is
    a no-op state-wise).

### 3. Add `EditableTextCell` for Symbol (~20 min)
Depends on: Task 2 (sibling component in the same file, same conventions).
- Add a second small sub-component `EditableTextCell` (function component, not exported) — same
  `isEditing`/`draft` local-state shape as `EditableCell`, but `type="text"` and string
  validation instead of numeric:
  ```ts
  function EditableTextCell({
    value, positionId, field, dispatch,
  }: {
    value: string
    positionId: string
    field: 'symbol'
    dispatch: (action: any) => void
  })
  ```
  - Display mode: plain `<span onClick={...}>{value}</span>`, no hover affordance (same "no
    cursor/underline/title" rule as the numeric cells, per point 2).
  - Edit mode: `<input type="text" className="input" value={draft} onChange={...} onBlur={commit}
    onKeyDown={handleKeyDown} autoFocus />`.
  - `commit()`: `trimmed = draft.trim()`; if `trimmed === ''` → revert silently (no dispatch,
    matching the other fields' empty-input-reverts rule — no taxes-style zero-value exception for
    text). Else if `trimmed !== value` → dispatch `{ type: 'UPDATE_POSITION', positionId, patch: {
    symbol: trimmed } }`. Exit edit mode either way.
  - `handleKeyDown`: `Enter` → `commit()`. `Escape` → `setIsEditing(false)` directly, no dispatch.
  - Field is generic-typed as `'symbol'` only (not a union like `EditableCell`'s) since this is
    presently the only text field in scope — keep it that way rather than over-generalizing for
    a hypothetical second text field.
- Symbol is not a currency/number value, so it does not reuse `EditableCell` — a distinct
  component avoids threading number-vs-string parsing branches through one component.

### 3a. Account dropdown + inline "create new account" mini-form (~50 min)
Depends on: Task 3 (same file, keep sequential). Also touches `ImportDialog.tsx` (one-line
export addition — independent, can be done any time before this task's PositionGroupOverlay
import statement is added).
- In `src/components/import/ImportDialog.tsx`, add `export` to the `TAX_CATEGORY_LABELS`
  declaration (line ~28) so it reads `export const TAX_CATEGORY_LABELS: Record<TaxCategory,
  string> = {...}`. No other change to that file. Re-run `ImportDialog.test.tsx` (if it exists)
  after this to confirm the export doesn't collide with anything — it's additive so it shouldn't.
- In `PositionGroupOverlay.tsx`, add `import { TAX_CATEGORY_LABELS } from
  './import/ImportDialog'` and `import { uid } from '../lib/seed'` and `import type { Account,
  TaxCategory } from '../lib/types'` (types likely already partially imported — check and extend
  the existing type-only import rather than adding a duplicate one).
- Add a new sub-component `AccountDropdown` (function component, not exported), following
  `AssetClassOverrideSelect.tsx`'s dropdown shape (read in full — see Facts section):
  ```ts
  function AccountDropdown({
    position, accounts, dispatch,
  }: {
    position: Position
    accounts: Account[]
    dispatch: (action: any) => void
  })
  ```
  - `useState<boolean> isOpen`, `useState<boolean> isCreatingNew`.
  - Trigger: a `<button onClick={() => setIsOpen(!isOpen)}>` showing the current account's
    `name` (+ `accountNumber` if present), styled like `AssetClassOverrideSelect`'s trigger
    button (reuse the same inline-style shape: border, radius, padding — not the accent-color
    "override active" styling, since there's no "unset" state for account, every position always
    has one).
  - Panel (when `isOpen`, `isCreatingNew` false): absolutely positioned `<div>` (same
    `position:absolute; top:100%` shape as `AssetClassOverrideSelect`), listing `accounts.map(a
    => <div onClick={() => handleSelectAccount(a)}>{a.name}{a.accountNumber ? ` • #${a
    .accountNumber}` : ''}</div>)` with the same hover background-color treatment, plus a final
    row `<div onClick={() => setIsCreatingNew(true)}>+ Create new account</div>` styled like
    `AssetClassOverrideSelect`'s "+ Use ..." new-value row (italic, top border, accent color).
  - `handleSelectAccount(account)`: dispatch `{ type: 'UPDATE_POSITION', positionId: position.id,
    patch: { accountId: account.id } }`, `setIsOpen(false)`.
  - When `isCreatingNew` is true, the panel instead renders a small inline mini-form (in place of
    the option list) reusing `ImportDialog.tsx`'s new-account fields exactly:
    - `useState<{ name: string; number: string; category: TaxCategory; retirement: boolean }>`
      (mirrors `ImportDialog.tsx`'s `NewAccountFields` shape — this plan does not need to import
      that interface since it's a 4-field object literal type, but keep field names identical:
      `name`, `number`, `category`, `retirement`).
    - Inputs: `name` (`type="text"`, label "New account name"), `number` (`type="text"`, label
      "Account number"), `category` (`<select>` built from `Object.entries(TAX_CATEGORY_LABELS)
      .map(([value, label]) => <option value={value}>{label}</option>)`), `retirement`
      (`type="checkbox"`, label "Retirement Account") — same labels/placeholders style as
      `ImportDialog.tsx` lines ~611-683, condensed to fit the smaller dropdown-panel footprint.
    - A "Create" button (or Enter-to-submit on the name field) calling `handleCreateAccount()`:
      - Guard: if `name.trim() === ''` do nothing (no dispatch) — minimal validation, mirroring
        the "empty reverts silently" convention used elsewhere in this plan.
      - Build `const newAccount: Account = { id: uid('acc'), accountNumber: number,
        name: name.trim(), taxCategory: category, retirement, createdAt: new Date()
        .toISOString() }` — identical shape/id-convention to `ImportDialog.tsx`'s
        `handleImport`.
      - Dispatch `{ type: 'ADD_ACCOUNT', account: newAccount }`, **then** dispatch `{ type:
        'UPDATE_POSITION', positionId: position.id, patch: { accountId: newAccount.id } }` (two
        sequential dispatches, in that order — account must exist in `state.accounts` before the
        position is reassigned to it, matching `ImportDialog.tsx`'s own
        create-then-reference-by-id ordering).
      - Reset `isCreatingNew` to `false`, `isOpen` to `false`, clear the mini-form's local state.
    - A "Cancel" affordance (small "back" link/button) sets `isCreatingNew` back to `false`
      without dispatching, returning to the option list.
  - No "no hover affordance" constraint applies to this dropdown (unlike the plain-text/number
    `EditableCell`/`EditableTextCell` cells) — it follows `AssetClassOverrideSelect`'s existing
    always-visible button affordance, since that's the established pattern for dropdown-style
    editable fields in this codebase (distinct from the click-to-reveal-input pattern used for
    text/number fields).

### 4. Wire `EditableCell`/`EditableTextCell`/`AccountDropdown` into the table (~20 min)
Depends on: Tasks 2, 3, 3a.
- Replace the plain `{p.sharesStr}` cell with `<EditableCell value={p.shares} positionId={p.id}
  field="shares" dispatch={dispatch} />` (note: pass raw numeric `p.shares`, not the
  pre-formatted `sharesStr`, since `EditableCell` needs the actual number to seed `draft` and to
  format display itself).
- Same for `avgCost` (Cost Basis column), `price` (Current Price column), `taxes` (new column
  from Task 1).
- Replace the plain symbol display (wherever it's rendered per-row — check if the overlay shows
  symbol per-row or only in a header; if per-row, wrap it: `<EditableTextCell value={p.symbol}
  positionId={p.id} field="symbol" dispatch={dispatch} />`).
- Replace the plain Account cell (`{p.accountName}` or similar) with `<AccountDropdown
  position={p} accounts={accounts} dispatch={dispatch} />`.
- Leave `Amount Invested`/`Market Value`/`G/L`/`G/L %` cells completely untouched — plain
  `<td>{p.costBasisStr}</td>` etc., no `EditableCell`, confirming they stay read-only/computed.
- Leave the `Override`/`AssetClassOverrideSelect` cell completely untouched.

### 4a. Tests — `src/components/PositionGroupOverlay.test.tsx` (new file) (~55 min)
Depends on: Task 4 (needs final DOM shape).
Follow `PositionsTable.test.tsx`'s fixture style (literal `Position`/`Account` objects) but
render `PositionGroupOverlay` directly with a hand-built `AggregateRow`, **except** the
group-membership test, which renders `PositionsTable` (see below). Minimum test cases:
1. Clicking the displayed `shares` value renders an `<input>` pre-filled with the current
   shares value (repeat for `avgCost`, `price`, `taxes`, `symbol` — 5 cases or one parameterized
   `it.each` for the 4 numeric fields plus one dedicated case for symbol given its different
   input type).
2. Enter with a valid new value dispatches `UPDATE_POSITION` with `{ positionId, patch: {
   [field]: <parsed number> } }` and returns to display mode showing the new formatted value
   (cover at least one numeric field via Enter, one via blur/`fireEvent.blur`, plus one
   dedicated symbol case, to prove both commit paths work for both cell types).
3. Escape while editing (numeric field and symbol field) reverts the input/display to the
   previous value and asserts `mockDispatch` was **not** called with an `UPDATE_POSITION` action
   for that field.
4. Invalid value (negative number, e.g. `-5`) on `shares`/`avgCost`/`price`/`taxes`, blurred →
   reverts silently to previous displayed value, `mockDispatch` not called. Also cover
   empty-string blur for `shares`/`avgCost`/`price` specifically (must revert, NOT save as 0 —
   this is the taxes-only exception, must be distinguished in tests). Also cover empty-string
   (whitespace-only) blur for `symbol` → reverts silently, no dispatch.
5. Empty-string blur for `taxes` specifically → **does** dispatch `{ type: 'UPDATE_POSITION',
   positionId, patch: { taxes: 0 } }` (the point-4 exception) — a dedicated test, not folded into
   case 4, since it's the one case where empty input behaves differently by field.
6. Computed columns (`Amount Invested`/`Market Value`/`G/L`/`G/L %`) render as plain text with no
   click-to-edit: assert no `<input>` appears after clicking those cells' `<td>` (e.g.
   `fireEvent.click` on the cell, then assert `screen.queryByRole('spinbutton')` count is
   unchanged, or more simply assert those `<td>`s contain no `onClick` — least brittle is
   `fireEvent.click(cell); expect(container.querySelectorAll('input')).toHaveLength(0)`).
7. (Regression) `Override`/`AssetClassOverrideSelect` cell remains unchanged — the override
   `<select>`/button still renders and is untouched by this change (reuse assertions similar to
   `PositionsTable.test.tsx` test 8's override-select check, adapted to render
   `PositionGroupOverlay` directly instead of via `PositionsTable`).
8. Account dropdown: clicking the trigger button opens a panel listing all `accounts` passed in;
   clicking an existing account's row dispatches `{ type: 'UPDATE_POSITION', positionId, patch: {
   accountId: <that account's id> } }` and closes the panel.
9. Account dropdown "create new account": clicking "+ Create new account" reveals the mini-form
   (assert name/number/category/retirement inputs render); filling in a name and submitting
   dispatches, **in order**, `{ type: 'ADD_ACCOUNT', account: { id: expect.any(String), name:
   <entered name>, accountNumber: <entered number>, taxCategory: <selected category>, retirement:
   <checked value>, createdAt: expect.any(String) } }` followed by `{ type: 'UPDATE_POSITION',
   positionId, patch: { accountId: <the id from the ADD_ACCOUNT call's account.id> } }` (assert
   via `mockDispatch.mock.calls` ordering/index, and cross-reference the id from the first call
   into the second call's patch — cannot hardcode the id since `uid()` is random). Also cover:
   submitting the mini-form with an empty name does not dispatch anything.
10. **Group-membership-change side effect** (new for this revision): render `PositionsTable`
    (not `PositionGroupOverlay` directly — needs the live `aggregateRows` recompute-on-render
    behavior described in the Facts section), with `state.positions` containing at least two
    positions that share a group (same symbol/effectiveAssetClass/taxCategory/retirement) plus a
    distinct-group position. Click the aggregate row to open the overlay, confirm both grouped
    positions render as table rows inside it. Edit one of those positions' `symbol` (or trigger
    an `AccountDropdown` selection that changes its `taxCategory`/`retirement`) via the same
    click-to-edit flow, using a `dispatch` that's wired to a real (or realistic fake) reducer so
    `state.positions` actually updates and the component re-renders with new props (this test
    needs an actual reducer call, not just an assertion on a mock — either import
    `appReducer`/`updatePosition` from `src/lib/reducer.ts`/`state.ts` and drive a real
    `useReducer` harness component, or use a small wrapper component holding `useState` for
    `state.positions` seeded from the initial fixture and updating it via `updatePosition()`
    directly in the test's dispatch mock). Assert: after the edit, the overlay is **still open**
    (not closed — `onClose` not called), and the edited position's row (and only that row) no
    longer appears in the overlay's table, while the other, unedited grouped position's row still
    does.

### 5. Update `design.md` (~15 min)
Depends on: Tasks 1-4 settled.
- In the component-tree section (`PositionGroupOverlay` entry), add a short clause noting
  per-cell inline-edit state (`shares`/`avgCost`/`price`/`taxes`/`symbol` editable via
  click-to-edit/Enter-or-blur-commit/Escape-cancel; `accountId` editable via a dropdown
  (`AccountDropdown`) that can also create a new `Account` inline — dispatches `UPDATE_POSITION`
  directly (and `ADD_ACCOUNT` for new-account creation), reusing the same reducer paths already
  used by `SET_ASSET_CLASS_OVERRIDE`/`ImportDialog`). No props signature change (still `{ group,
  accounts, dispatch, onClose }`) — note this explicitly so it's clear no new prop was added for
  this feature.
- Add a note that editing `symbol`/`accountId` on a position changes its aggregate group key
  (`PositionsTable.tsx`'s `buildGroupKey`), so the edited position drops out of the *currently
  open* overlay's `group.positions` on the next render (overlay itself stays open, since it's
  keyed by `selectedGroupKey`, not by the edited position) — this is existing
  `PositionsTable`/`PositionGroupOverlay` data-flow behavior, not new wiring.
- No change needed to "Action types (reducer.ts)" section — `UPDATE_POSITION` and `ADD_ACCOUNT`
  already existed there before this feature; confirm by re-reading that section during Task 7's
  full review and only touch it if something is missing (check, don't assume).
- Note the one-line `ImportDialog.tsx` change (`TAX_CATEGORY_LABELS` now exported) if
  `design.md` documents that file's exports anywhere; otherwise skip (it's a minor implementation
  detail, not a design-level change).

### 6. Update `product-behavior.md` (~15 min)
Depends on: Task 5 (keep docs consistent with each other).
- In "## Positions table" section, extend the overlay-columns list to include `Taxes` (note its
  position in the column order chosen in Task 1) and mark which columns are click-to-edit:
  Symbol, Shares, Cost Basis (avgCost), Current Price, Taxes are editable (click-to-edit
  text/number cells); Account is editable via a dropdown (with inline new-account creation);
  Amount Invested, Market Value, G/L, G/L%, Override are not.
- Add a bullet describing the numeric/text edit UX: click a value → input (type=number or
  type=text for Symbol) → Enter or blur saves (validated non-negative number required for
  numeric fields, non-empty trimmed string for Symbol; invalid/empty reverts silently, **except**
  empty `Taxes` saves as `0`) → Escape cancels and reverts, no error UI on invalid input.
- Add a bullet describing the Account dropdown UX: click the account trigger to open a list of
  all accounts; selecting one reassigns the position; selecting "+ Create new account" reveals an
  inline form (name, account number, tax category, retirement checkbox — same fields as the
  Import dialog's new-account flow) that creates the account and reassigns the position to it on
  submit.
- Add a bullet noting: editing Symbol or Account can move a position out of the aggregate group
  currently shown in the overlay; when that happens the position's row disappears from the open
  overlay (the overlay itself stays open) since it now belongs to a different aggregate row.

### 7. Full-file review of both docs (~10 min)
Depends on: Tasks 5, 6.
- Re-read `design.md` and `product-behavior.md` in full. Confirm no stale references to the old
  non-editable overlay table, no contradictions between component-tree/data-flow and the
  Positions-table section, terse/token-optimized style preserved, and that the new Symbol/Account
  edit behavior and group-membership-change note read consistently with the rest of each file.
- Fix anything stale found.

### 8. Run tests, build, verify, then commit (~20 min)
Depends on: all above tasks done.
- `npm run test` — all pass, including new `PositionGroupOverlay.test.tsx`; also re-run
  `PositionsTable.test.tsx` to confirm the overlay change didn't break its existing overlay
  interaction tests (it clicks into the overlay and checks the Override select, which is
  untouched, but the DOM shape around it changed); if `ImportDialog.test.tsx` exists, re-run it
  too to confirm exporting `TAX_CATEGORY_LABELS` didn't break anything.
- `npm run build` (typecheck + vite build) — passes; confirms `EditableCell`/`EditableTextCell`/
  `AccountDropdown`'s prop typing and `UPDATE_POSITION`/`ADD_ACCOUNT` patch/action shapes are
  sound against `Partial<Position>`/`Account`.
- `npm run lint` — passes.
- `grep -ri watchlist src/` — still empty (unrelated regression check, per CLAUDE.md).
- Only if tests pass AND both docs are updated: commit with a message describing the
  inline-editable overlay-cell feature (including Symbol/Account/new-account-creation scope).

## Test cases (explicit list, mirrors Task 4a)

1. Click on shares/avgCost/price/taxes/symbol value → input pre-filled with current value (5
   sub-cases; symbol gets `type="text"`, others `type="number"`).
2. Valid new value + Enter → dispatches `UPDATE_POSITION` with correct `positionId`/`patch`,
   returns to display mode with new value (numeric + symbol).
3. Valid new value + blur → same dispatch/display behavior as Enter (separate case, proves both
   commit paths work; numeric + symbol).
4. Escape while editing → reverts to previous value, no dispatch (numeric + symbol).
5. Invalid (negative) value + blur → reverts silently, no dispatch (per numeric field).
6. Empty value + blur on shares/avgCost/price → reverts silently, no dispatch.
7. Empty (whitespace-only) value + blur on symbol → reverts silently, no dispatch.
8. Empty value + blur on taxes → dispatches `{ patch: { taxes: 0 } }`.
9. Computed columns (Amount Invested/Market Value/G/L/G/L%) have no click-to-edit behavior.
10. Override/`AssetClassOverrideSelect` cell unchanged/untouched by this feature.
11. Account dropdown opens on click, lists all `accounts`; selecting one dispatches
    `UPDATE_POSITION` with `patch: { accountId }`.
12. Account dropdown "+ Create new account" reveals a mini-form; valid submit dispatches
    `ADD_ACCOUNT` then `UPDATE_POSITION` (in that order, second call referencing the first
    call's generated account id); empty name does not dispatch.
13. Editing a grouped position's symbol or account inside the overlay causes that position's row
    to disappear from the still-open overlay on the next render (via `PositionsTable`-level
    integration test), while other rows in the group remain and the overlay does not close.

## Acceptance criteria

- [ ] `PositionGroupOverlay.tsx` renders a new `Taxes` column (header + per-row value), sourced
      from `Position.taxes` (`null` displayed as `$0.00`).
- [ ] `shares`, `avgCost` (Cost Basis), `price` (Current Price), `taxes` cells are independently
      click-to-edit: click → `<input type="number">` pre-filled with current value, no hover
      affordance (no cursor/underline/title change) before clicking.
- [ ] `symbol` is click-to-edit: click → `<input type="text">` pre-filled with current value, no
      hover affordance before clicking; empty/whitespace-only input reverts silently; non-empty
      trimmed value dispatches `UPDATE_POSITION` with `patch: { symbol: <trimmed> } }`.
- [ ] Account is editable via a dropdown (`AccountDropdown`, styled per
      `AssetClassOverrideSelect.tsx`'s pattern) listing all `accounts`; selecting one dispatches
      `UPDATE_POSITION` with `patch: { accountId } }`.
- [ ] Account dropdown includes a "+ Create new account" option that reveals an inline mini-form
      (name, account number, tax category select reusing `TAX_CATEGORY_LABELS`, retirement
      checkbox — matching `ImportDialog.tsx`'s new-account fields); submitting with a non-empty
      name dispatches `ADD_ACCOUNT` (new `Account` built with `uid('acc')`, matching
      `ImportDialog.tsx`'s id-generation convention and field shape) followed by
      `UPDATE_POSITION` reassigning the position to the new account's id; empty name does not
      dispatch.
- [ ] `ImportDialog.tsx`'s `TAX_CATEGORY_LABELS` is exported and reused by
      `PositionGroupOverlay.tsx` rather than duplicated.
- [ ] Enter or blur with a valid value commits (numeric fields: non-negative number; symbol:
      non-empty trimmed string): dispatches `{ type: 'UPDATE_POSITION', positionId, patch: {
      <field>: <value> } }` via the existing reducer path (`reducer.ts` → `state.ts`'s
      `updatePosition`), no new reducer case or `state.ts` helper added.
- [ ] Escape cancels: reverts to previous displayed value, no dispatch (all editable fields).
- [ ] Invalid input (negative, non-numeric, empty) on `shares`/`avgCost`/`price` reverts
      silently on blur/Enter — no dispatch, no error UI.
- [ ] Empty input on `taxes` specifically dispatches `patch: { taxes: 0 }` (not a revert, not
      `null`) — the one exception to the revert-on-empty rule.
- [ ] `Amount Invested`, `Market Value`, `G/L`, `G/L %` cells remain plain (non-editable) text;
      they update automatically via re-render once the underlying position's
      `shares`/`avgCost`/`price` change (no manual recompute wiring needed — `computePosition()`
      already derives them fresh each render). Explicit note: this is because these fields are
      not stored on `Position` at all (computed in `computations.ts`), not a scope omission.
- [ ] `Override`/`AssetClassOverrideSelect` cell/behavior completely unchanged.
- [ ] `AssetClassOverrideSelect.tsx` not modified.
- [ ] Editing `symbol` or `accountId` on a position that changes its `buildGroupKey()` result
      causes that position's row to disappear from the currently-open overlay's table on the
      next render, without closing the overlay (verified by an integration-style test rendering
      `PositionsTable`).
- [ ] `src/components/PositionGroupOverlay.test.tsx` created (new file), covering all 13 test
      cases above.
- [ ] `design.md` updated: `PositionGroupOverlay` component-tree entry notes per-cell inline
      edit behavior for all fields including Symbol/Account/new-account-creation, notes the
      group-membership-change/row-disappears behavior, confirms no new props added.
- [ ] `product-behavior.md` "## Positions table" section updated: Taxes column added to the
      overlay column list, all editable vs. non-editable columns identified (including Symbol
      and Account), edit UX for text/number cells and the Account dropdown + new-account mini-form
      documented, group-membership-change behavior documented.
- [ ] Full-file review of both docs done post-change; no stale/contradictory content.
- [ ] `npm run test` passes fully, including pre-existing `PositionsTable.test.tsx` and (if
      present) `ImportDialog.test.tsx`.
- [ ] `npm run build` passes (typecheck clean).
- [ ] `npm run lint` passes.
- [ ] `grep -ri watchlist src/` returns nothing.
- [ ] Commit created only after tests pass and docs are updated, not before.
</content>
