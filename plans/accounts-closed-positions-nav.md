# Accounts Closed Positions Nav Card

## Overview / Goal

Add a 4th "Closed Positions" card to the Accounts page's left-nav column (`src/components/AccountsPage.tsx`), after Taxable/Non-Taxable/Tax-Deferred. Same visual/interaction pattern (pill header, rotating chevron, bordered account sub-list on expand). Reuse `.card.blueprint.elev-sm` markup shape. No new CSS.

## Resolved Requirements

1. Placement: 4th and last card in the left-nav list, after Taxable/Non-Taxable/Tax-Deferred.
2. Account scope in expanded list: only accounts with ≥1 `ClosedPosition` (`state.closedPositions.filter(cp => cp.accountId === account.id)`).
3. State model: `'closedPositions'` becomes a 4th `categoryKey` value structurally parallel to the 3 `TaxCategory` values. Add `state.selectedCategoryKey: TaxCategory | 'closedPositions' | null`, set together with `selectedAccountId` in the same dispatch whenever an account row is clicked (mirrors `selectAccount` toggle semantics — clicking same account again clears both to null). Needed because same accountId can appear under both its tax-category card AND Closed Positions card.
   - `acc.selected` highlight (`AccountsPage.tsx:126`, currently `state.selectedAccountId === account.id`) becomes `state.selectedAccountId === account.id && state.selectedCategoryKey === cat.key` — no double-highlight across cards.
   - Main panel branches: when `state.selectedCategoryKey === 'closedPositions'`, render `ClosedPositionsTable` (scoped) instead of the aggregate open-positions table. When nothing selected, keep existing default (all open positions, unfiltered) — no "view all closed positions across every account" mode.
4. Card totals: card header total and each account-row total = sum of `realizedGL` across that account's/category's closed positions (parallel to today's market-value total), not market value. Exclude `ClosedPosition`s with `realizedGLBasis === 'unknown'` (`realizedGL === null`) from the sum. If ALL of an account's/card's closed positions are unknown-basis, show `—` instead of `$0`.
5. Filtering: `ClosedPositionsTable` currently has no filtering — unconditionally maps `state.closedPositions`. Extend it to accept a `positions: ClosedPosition[]` prop (caller-supplied, pre-filtered) instead of reading `state.closedPositions` directly. `PositionsTable.tsx` (Dashboard) passes `state.closedPositions` explicitly, unchanged behavior.
   - On Accounts page, when `selectedCategoryKey === 'closedPositions'`, add scoping/filtering mirroring `acctScopedPositions`/`acctFilteredPositions`: new `acctScopedClosedPositions(state)` (filter `state.closedPositions` by `state.selectedAccountId`) and `acctFilteredClosedPositions(state)` (apply `state.acctAssetClassFilter` and `state.acctPosSearch` on top — same shared filter/search fields the open-positions view already uses).
   - `acctAssetClassOptions` (selectors.ts:279) needs to work against `ClosedPosition[]` too (only reads `.assetClass`/`.assetClassManualOverride`, structurally compatible with `Position[]`) — widen its param type to a small structural alias.
   - Existing asset-class filter `.seg` and search box stay visible/functional when viewing Closed Positions, driven off the closed list's own options/results.

## Out of Scope

- No "view all closed positions across every account" mode — must pick a specific account under Closed Positions to see its closed positions.
- No CSS changes — reuse existing `.card.blueprint.elev-sm` class vocabulary.
- No changes to `PositionsTable.tsx`'s Dashboard UI/behavior beyond the `positions` prop threading to `ClosedPositionsTable`.
- No changes to how `ClosedPosition`s are created/imported/deleted/undone (`CLOSE_POSITION`, `DELETE_CLOSED_POSITION`, `RESTORE_CLOSED_POSITION` logic untouched).

## Architecture / Design Decisions

### 1. `AppState` gains `selectedCategoryKey`

`src/lib/state.ts:22-36` (`AppState` interface) and `initialState()` defaults `~state.ts:69-73`:

```ts
selectedCategoryKey: TaxCategory | 'closedPositions' | null // paired with selectedAccountId
```

Default `null`. `TaxCategory` import already present in `state.ts`.

**`src/lib/persist.ts:47-84` must also change.** `coalesceWithDefaults` rebuilds `AppState` field-by-field from a fixed whitelist, so a new interface field that isn't added there is a missing required property on the returned object literal → `npm run build` fails. It is also the only path Drive restore uses (`drive.ts:22`), so omitting it silently drops the field on every restore/reload. Add alongside `selectedAccountId` (line 80):

```ts
selectedCategoryKey: loaded.selectedCategoryKey ?? defaults.selectedCategoryKey,
```

### 2. `selectAccount` helper + `SELECT_ACCOUNT` action gain `categoryKey`

`src/lib/state.ts:333-338`:

```ts
export function selectAccount(
  state: AppState,
  accountId: string,
  categoryKey: TaxCategory | 'closedPositions'
): AppState {
  const isSame = state.selectedAccountId === accountId && state.selectedCategoryKey === categoryKey
  return {
    ...state,
    selectedAccountId: isSame ? null : accountId,
    selectedCategoryKey: isSame ? null : categoryKey,
  }
}
```

`reducer.ts:30` action type gains `categoryKey: any`; `reducer.ts:123-124` case passes `action.categoryKey` through.

### 3. `closedPositionsCard(state)` selector — sibling to `categoryCards`

`src/lib/selectors.ts`, after `categoryCards` (~line 263). Same return shape as one `categoryCards` entry (`key`, `label`, `totalStr`, `accountCount`, `expanded`, `accounts[]`, `hasAccounts`, `noAccounts`), built from `state.closedPositions`/`state.accounts` instead of `state.positions`:

- `key: 'closedPositions'`, `label: 'Closed Positions'`.
- Only include accounts with ≥1 closed position.
- `totalStr`/`account.totalStr` = sum of `realizedGL` where not null, formatted `fmtUSD`; `'—'` when every closed position for that scope has `realizedGL === null`.
- `updatedStr` = latest `lastImportedAt`/`closedDate` across that account's closed positions (mirror existing `updatedStr` logic using whichever field `ClosedPosition` has — `lastImportedAt`).
- `expanded: !!state.expandedCategories['closedPositions']` (existing `Record<string, boolean>` keying already supports the new string key, no reducer change needed for `TOGGLE_CATEGORY_EXPANDED`).
- `selected: state.selectedAccountId === account.id && state.selectedCategoryKey === 'closedPositions'`.
- Totals use `fmtUSD`, which renders negatives as `-$1,234.00` and gains with **no** `+` prefix — deliberately unlike `ClosedPositionsTable`'s per-row `+$…`. Card/row totals are plain `fmtUSD`; do not add a `+` prefix.
- Empty card (`hasAccounts: false`): `AccountsPage.tsx:153-155` renders the shared copy "No accounts in this category." This is reused as-is for the Closed Positions card — no per-card copy branch.

`AccountsPage.tsx` renders `[...categoryCards(state), closedPositionsCard(state)]` for the left column loop — keeps `categoryCards`'s `TaxCategory`-only typing untouched.

### 4. `acctScopedClosedPositions` / `acctFilteredClosedPositions` selectors

`src/lib/selectors.ts`, alongside `acctScopedPositions`/`acctFilteredPositions` (~line 269-310):

```ts
export function acctScopedClosedPositions(state: AppState): ClosedPosition[] {
  if (state.selectedAccountId) {
    return state.closedPositions.filter((cp) => cp.accountId === state.selectedAccountId)
  }
  return state.closedPositions
}
// Note: the no-selection branch is unreachable in the UI (closed mode requires a
// selected account — see Out of Scope), but mirrors acctScopedPositions' shape.

export function acctFilteredClosedPositions(state: AppState): ClosedPosition[] {
  let results = acctScopedClosedPositions(state)
  if (state.acctAssetClassFilter !== 'All') {
    results = results.filter((cp) => (cp.assetClassManualOverride || cp.assetClass) === state.acctAssetClassFilter)
  }
  if (state.acctPosSearch.trim()) {
    const searchLower = state.acctPosSearch.toLowerCase()
    results = results.filter(
      (cp) => cp.symbol.toLowerCase().includes(searchLower) || (cp.name?.toLowerCase().includes(searchLower) ?? false)
    )
  }
  return results
}
```

### 5. `acctAssetClassOptions` widened to structural type

`src/lib/selectors.ts:279`. Add a structural alias (only fields the function reads):

```ts
type AssetClassed = { assetClass: string; assetClassManualOverride?: string }
export function acctAssetClassOptions(positions: AssetClassed[]): string[] { ... } // body unchanged
```

`Position[]` and `ClosedPosition[]` both satisfy `AssetClassed[]` structurally — no call-site cast needed.

### 6. `ClosedPositionsTable` prop change

`src/components/ClosedPositionsTable.tsx`:

```ts
export interface ClosedPositionsTableProps {
  state: AppState
  dispatch: (action: any) => void
  positions: ClosedPosition[] // NEW — caller-supplied, pre-filtered
}
```

Line 58 `state.closedPositions.map(...)` → `positions.map(...)`. `handleDeleteClosedPosition`/`handleUndoClosedPosition` (lines 17-45) unchanged — they operate by id/`cp` and still need full `state` for `findMatchingOpenPosition`.

`PositionsTable.tsx:205` call site → `<ClosedPositionsTable state={state} dispatch={dispatch} positions={state.closedPositions} />`.

### 7. `AccountsPage.tsx` main-panel branch

Main panel (currently lines 163-299, allocation chart / filter row / search / aggregate table / overlay) branches on `state.selectedCategoryKey === 'closedPositions'`:

- Allocation chart title/positions: keep existing behavior for open-positions branch; for closed-positions branch, either skip the chart or keep it hidden — no spec given for chart-in-closed-mode, so simplest: keep `AllocationChart` fed by `scopedPositions` (open positions) always, unaffected by the closed-positions branch, since `ClosedPosition` doesn't feed the allocation chart today and adding that is not in requirements.
- Asset-class `.seg` options + selected filtered results:
  - open mode (default): `acctAssetClassOptions(scopedPositions)` / `acctFilteredPositions(state)` (existing).
  - closed mode: `acctAssetClassOptions(acctScopedClosedPositions(state))` / `acctFilteredClosedPositions(state)`.
- Table area: closed mode renders `<ClosedPositionsTable state={state} dispatch={dispatch} positions={acctFilteredClosedPositions(state)} />` instead of the aggregate `<table className="table">` block (lines 228-278) and its `PositionGroupOverlay` (lines 285-298) — closed positions have no group-overlay in this feature.
- Search box / empty-state text stay generic (already say "Search symbol or name" / "No positions to show.", both accurate for closed positions too — no copy changes needed).

### 8. Card-row click dispatch

`AccountsPage.tsx:121` (`dispatch({ type: 'SELECT_ACCOUNT', accountId: acc.id })`) — the `cat.key` is already in scope from the `.map((cat) => ...)` closure, so add `categoryKey: cat.key` to the dispatch payload. Works unchanged for both `categoryCards` entries (`cat.key: TaxCategory`) and the new `closedPositionsCard` entry (`cat.key: 'closedPositions'`) since both feed the same loop.

## Existing tests that WILL break (must be updated, not just added to)

These are pre-existing green tests that the changes above turn red. Each is listed again in its owning task.

| File / line | Break | Fix |
|---|---|---|
| `src/lib/state.test.ts:388, 398, 407` | Three 2-arg `selectAccount(state, 'acc1')` calls. The toggle test (line 392) genuinely fails: `selectedCategoryKey` is `null` but the omitted arg arrives `undefined`, so `isSame` is false and it never clears. | Pass an explicit `categoryKey` (e.g. `'taxable'`) at all three call sites. |
| `src/lib/reducer.test.ts:168, 176` | Same `null !== undefined` failure in "toggles to null when selecting the same account twice". | Add `categoryKey: 'taxable'` to both dispatches. |
| `src/lib/selectors.test.ts:727` | `categoryCards: selected reflects state.selectedAccountId` fails once `selected` also requires `selectedCategoryKey === catKey` (T9). | Add `selectedCategoryKey: 'taxable'` to the test state; rename the case to reflect the pair. |
| `src/components/ClosedPositionsTable.test.tsx` — **10** `<ClosedPositionsTable state dispatch />` render sites | New required `positions` prop missing → `positions.map` on `undefined` → the entire 521-line file fails. | Add `positions={state.closedPositions}` to all 10 render calls. |

Note: `tsconfig.app.json` **excludes** `src/**/*.test.ts(x)`, so none of this surfaces as a type error — test files are only checked at vitest runtime.

## Test Strategy

Run `npm run test` for the full suite; `npx vitest run <file>` for touched files during development. Before final commit, `npm run build` (tsc -b + vite build) must also pass — matches CLAUDE.md's commit gate.

Typecheck-only spot checks must use `npx tsc -b` (or `npm run build`). **Not** `npx tsc --noEmit -p .` — the root `tsconfig.json` is `{"files": [], "references": [...]}`, so without `-b` it compiles nothing and always exits 0. Per CLAUDE.md TDD discipline, each implementation task below writes/adjusts its test alongside the code change (see per-task "Test case(s)"), not only at the end.

## Risks

- **Highlight leakage across cards**: same `accountId` can appear in both a tax-category card and the Closed Positions card. If the `selected` check only compares `accountId` (forgetting `selectedCategoryKey`), the account row highlights in both cards simultaneously. T4/T9 tests specifically cover this.
- **`realizedGL` null-handling for totals**: easy to get subtly wrong — summing `null` as `0` silently, or showing `$0` instead of `—` when everything is unknown-basis. Must explicitly filter `realizedGL !== null` before summing, and check "any non-null value existed" (not "sum !== 0", since a real sum can legitimately be `0` or negative) to decide `—` vs a real dollar string.
- **`acctAssetClassOptions` type widening**: must stay structurally compatible with both `Position[]` and `ClosedPosition[]` without runtime cast — a mistake here (e.g. narrowing to a `ClosedPosition`-only field) breaks the existing open-positions call site.
- **`coalesceWithDefaults` whitelist**: `persist.ts`'s field-by-field rebuild is the single easiest thing to forget when adding an `AppState` field. Forgetting it fails the build outright (missing required property), which is the good case; the bad case is "fixing" the type error by casting instead of adding the line, which silently drops `selectedCategoryKey` on every IndexedDB load and Drive restore.
- **Existing-test breakage is invisible to the typechecker**: tests are excluded from `tsconfig.app.json`, so `npm run build` stays green while four test files are red. See the "Existing tests that WILL break" table — do not treat a clean build as evidence the suite passes.
- **`categoryKey` threading gap**: `SELECT_ACCOUNT` dispatch, `selectAccount` helper, and reducer case all need the new field in sync — missing it in any one place silently defaults to `undefined`, breaking toggle semantics without a compile error (dispatch payloads are `any`-typed per `design.md`'s "Props convention" note).

## Tasks

### T0 — Create isolated worktree
Make a new git worktree so this feature doesn't touch the main checkout while in progress.
- Run: `git worktree add ../worktree-accounts-closed-positions-nav -b accounts-closed-positions-nav/feature`
- All subsequent tasks operate inside `/Users/mdoraiswamy/owa/worktree-accounts-closed-positions-nav`, not the main checkout.
- Acceptance: `git worktree list` shows the new worktree; `cd` into it, `git status` clean on the new branch.

### T1 — Add `selectedCategoryKey` to `AppState` (+ persist whitelist)
Files: `src/lib/state.ts`, **`src/lib/persist.ts`**.
Depends on: T0.
- Add `selectedCategoryKey: TaxCategory | 'closedPositions' | null` to the `AppState` interface (line 33-36 block, near `selectedAccountId`).
- Add `selectedCategoryKey: null` to `initialState()` defaults (~line 69-73).
- **`persist.ts:80`** — add `selectedCategoryKey: loaded.selectedCategoryKey ?? defaults.selectedCategoryKey,` to `coalesceWithDefaults`'s whitelist, next to `selectedAccountId`. Non-optional: the whitelist is exhaustive, so omitting it is a missing-required-property type error that fails `npm run build`, and `drive.ts:22` restores through the same function.
- Test: in `src/lib/state.test.ts`, add a case checking `initialState().selectedCategoryKey === null`.
- Edge case: existing persisted state blobs (pre-migration) missing this field — add a `persist.test.ts` case loading a state object without `selectedCategoryKey` and asserting it hydrates to `null`, not `undefined`/crash. (Migration tolerance comes from the whitelist line above, not automatically.)
- Acceptance: `npx vitest run src/lib/state.test.ts src/lib/persist.test.ts` passes; `npx tsc -b` clean.

### T2 — `selectAccount` helper gains `categoryKey` param
File: `src/lib/state.ts` (~line 333-338).
Depends on: T1.
- Change signature to `selectAccount(state, accountId, categoryKey: TaxCategory | 'closedPositions')`.
- Toggle logic: same-account-and-same-category click clears both `selectedAccountId`/`selectedCategoryKey` to `null`; otherwise sets both to the clicked values (see Architecture #2 for exact code).
- **Update existing tests first**: `src/lib/state.test.ts:388, 398, 407` call `selectAccount(state, 'acc1')` with 2 args. Add an explicit `categoryKey` (e.g. `'taxable'`) to all three, and for the toggle case (line 392) also seed `selectedCategoryKey: 'taxable'` in the state — otherwise `isSame` compares `null` against `undefined`, stays false, and the test fails.
- Test: in `src/lib/state.test.ts`, add cases: (a) selecting a fresh account sets both fields; (b) selecting same account+category again clears both; (c) selecting same accountId but a DIFFERENT categoryKey (the two-card overlap case) does NOT clear — it switches to the new category, both fields updated to the new selection.
- Acceptance: `npx vitest run src/lib/state.test.ts` passes — 3 updated cases + 3 new cases green.

### T3 — `SELECT_ACCOUNT` action + reducer case gain `categoryKey`
Files: `src/lib/reducer.ts` (type ~line 30, case ~line 123-124).
Depends on: T2.
- Action type: `{ type: 'SELECT_ACCOUNT'; accountId: string; categoryKey: any }`.
- Case: `StateActions.selectAccount(state, action.accountId, action.categoryKey)`.
- **Update existing tests first**: `src/lib/reducer.test.ts:168, 176` dispatch `SELECT_ACCOUNT` without `categoryKey`. Add `categoryKey: 'taxable'` to both, and seed `selectedCategoryKey: 'taxable'` in the line-174 state — the "toggles to null" case fails otherwise (same `null` vs `undefined` mismatch as T2).
- Test: in `src/lib/reducer.test.ts`, add a case dispatching `SELECT_ACCOUNT` with `categoryKey: 'taxable'` and asserting resulting state's `selectedCategoryKey === 'taxable'`.
- Acceptance: `npx vitest run src/lib/reducer.test.ts` passes — both updated cases + the new case green.

### T4 — `acctAssetClassOptions` structural widening
File: `src/lib/selectors.ts` (~line 279).
Depends on: T0 (independent of T1-T3, sequenced for review clarity).
- Add `type AssetClassed = { assetClass: string; assetClassManualOverride?: string }` near the function.
- Change param type from `Position[]` to `AssetClassed[]`. Function body unchanged.
- Test: in `src/lib/selectors.test.ts`, add a case calling `acctAssetClassOptions` with a `ClosedPosition[]` array directly (not cast) and asserting it returns the expected distinct sorted classes — proves structural compatibility compiles and works.
- Edge case: empty array returns `[]`.
- Acceptance: `npx vitest run src/lib/selectors.test.ts` passes; `npx tsc -b` shows no new errors from existing `Position[]` call sites of `acctAssetClassOptions`.

### T5 — `acctScopedClosedPositions` / `acctFilteredClosedPositions` selectors
File: `src/lib/selectors.ts`, near `acctScopedPositions`/`acctFilteredPositions` (~line 269-310).
Depends on: T4.
- Add both functions per Architecture #4 exactly.
- Test: in `src/lib/selectors.test.ts`:
  - `acctScopedClosedPositions`: with `selectedAccountId` set, returns only that account's closed positions; with `selectedAccountId: null`, returns all.
  - `acctFilteredClosedPositions`: asset-class filter narrows correctly; search text matches symbol and name (case-insensitive); combining both narrows further.
  - Edge case: account with zero closed positions and `selectedAccountId` set to it → both selectors return `[]`, no crash.
- Acceptance: `npx vitest run src/lib/selectors.test.ts` passes.

### T6 — `closedPositionsCard(state)` selector
File: `src/lib/selectors.ts`, after `categoryCards` (~line 263).
Depends on: T5.
- Implement per Architecture #3: filter to accounts with ≥1 closed position; `totalStr`/`account.totalStr` = sum of non-null `realizedGL`, formatted `fmtUSD`, or `'—'` if every closed position in scope is unknown-basis; `updatedStr` from latest `lastImportedAt`; `expanded`/`selected` wired to `state.expandedCategories['closedPositions']` and `state.selectedAccountId`/`state.selectedCategoryKey === 'closedPositions'`.
- Test: in `src/lib/selectors.test.ts`:
  - Happy path: 2 accounts, one with 2 closed positions (both `realizedGLBasis: 'transactions'`, known values) → `accounts` list has exactly that one account (the other, with 0 closed positions, excluded), `totalStr` = correct dollar sum.
  - Edge case: account with closed positions ALL `realizedGLBasis: 'unknown'` (`realizedGL: null`) → that account's `totalStr === '—'`.
  - Edge case: account with a MIX of known and unknown-basis closed positions → sum excludes the unknown ones, still shows a real dollar string (not `—`).
  - Edge case: card-level total across multiple accounts also excludes unknown-basis entries the same way.
  - Edge case: `selected` is `true` only when both `selectedAccountId` matches AND `selectedCategoryKey === 'closedPositions'` — verify an account selected under its tax-category card (same accountId, `selectedCategoryKey: 'taxable'`) shows `selected: false` here.
- Acceptance: `npx vitest run src/lib/selectors.test.ts` passes, all new cases green.

### T7 — `ClosedPositionsTable` accepts `positions` prop
File: `src/components/ClosedPositionsTable.tsx`.
Depends on: T0 (independent of T1-T6, sequenced for review clarity).
- Add `positions: ClosedPosition[]` to `ClosedPositionsTableProps`.
- Line 58: `state.closedPositions.map(...)` → `positions.map(...)`.
- `handleDeleteClosedPosition`/`handleUndoClosedPosition` unchanged (still use `state`/`dispatch`).
- **Update existing tests first**: `src/components/ClosedPositionsTable.test.tsx` has **10** `<ClosedPositionsTable state={state} dispatch={mockDispatch} />` render sites (first at line 59) with no `positions` prop. All 10 must gain `positions={state.closedPositions}` — otherwise `positions.map` runs on `undefined` and the whole 521-line file fails. This is not caught by the typechecker (`tsconfig.app.json` excludes `*.test.tsx`).
- Test: in `src/components/ClosedPositionsTable.test.tsx`, add a case passing a `positions` array that's a STRICT SUBSET of `state.closedPositions` and asserting only the passed subset renders (proves it reads the prop, not `state.closedPositions` directly).
- Edge case: `positions={[]}` renders an empty `<tbody>`, no crash, no rows.
- Acceptance: `npx vitest run src/components/ClosedPositionsTable.test.tsx` passes — all 10 updated render sites + 2 new cases green. Note: this task alone breaks compilation at the `PositionsTable.tsx` call site (missing required prop) — expected, fixed in T8, do not fix here.

### T8 — Update `PositionsTable.tsx` call site (Dashboard regression)
File: `src/components/PositionsTable.tsx` (~line 205).
Depends on: T7.
- Change `<ClosedPositionsTable state={state} dispatch={dispatch} />` to `<ClosedPositionsTable state={state} dispatch={dispatch} positions={state.closedPositions} />`.
- Test: in `src/components/PositionsTable.test.tsx`, verify existing "Show Closed Positions" toggle test(s) still pass unchanged (regression, not new behavior) — re-run file, confirm no new failures.
- Acceptance: `npx vitest run src/components/PositionsTable.test.tsx` passes; `npx tsc -b` shows zero errors in the `PositionsTable.tsx`/`ClosedPositionsTable.tsx` pair.

### T9 — Wire 4th card + categoryKey dispatch + highlight fix in `AccountsPage.tsx`
File: `src/components/AccountsPage.tsx`.
Depends on: T3, T6.
- Import `closedPositionsCard` from `../lib/selectors`.
- Change `const cards = categoryCards(state)` (line 32) to `const cards = [...categoryCards(state), closedPositionsCard(state)]`.
- Line 121 dispatch: add `categoryKey: cat.key` to the `SELECT_ACCOUNT` payload.
- Line 126 highlight (`background: acc.selected ? ... : undefined`) needs no code change — `acc.selected` is computed in the selectors. But `categoryCards` must be fixed here: `selectors.ts:248` currently reads `selected: state.selectedAccountId === account.id`; change it to `state.selectedAccountId === account.id && state.selectedCategoryKey === catKey` (small, colocated fix — not worth a separate task).
- **Update existing test**: `src/lib/selectors.test.ts:727` (`categoryCards: selected reflects state.selectedAccountId`) sets only `selectedAccountId: 'acc-1'` and asserts `selected === true` — it fails after the line-248 change. Add `selectedCategoryKey: 'taxable'` to that test state and rename the case to reflect the accountId+categoryKey pair. Add a companion case asserting `selected === false` when `selectedCategoryKey` is `'closedPositions'` for the same accountId.
- Test: in `src/components/AccountsPage.test.tsx`:
  - 4th card renders with label "Closed Positions", positioned after the 3 tax-category cards.
  - Card only lists accounts with ≥1 closed position (account with 0 closed positions absent from expanded list).
  - Clicking an account row under Closed Positions sets `selectedCategoryKey: 'closedPositions'` (assert via dispatch mock call args, or via rendered highlight/table-branch effect).
  - Edge case (two-card overlap): account with BOTH open and closed positions appears in its tax-category card AND Closed Positions card; select it under one card, assert the OTHER card's row is NOT highlighted (no leaked `background: var(--color-accent-100)`).
  - Edge case: card/account totals show `—` when all closed positions for that scope are unknown-basis (render-level check, complements T6's selector-level check).
- Acceptance: `npx vitest run src/components/AccountsPage.test.tsx src/lib/selectors.test.ts` passes, updated + new cases green. Existing `AccountsPage.test.tsx:74` ("renders Taxable, Non-Taxable, Tax-Deferred labels in that order") asserts on those three labels only and should still pass with a 4th card present — verify, don't assume.

### T10 — Main-panel branch: render `ClosedPositionsTable` when `selectedCategoryKey === 'closedPositions'`
File: `src/components/AccountsPage.tsx` (right column, lines 163-299).
Depends on: T9.
- Import `acctScopedClosedPositions`, `acctFilteredClosedPositions`, `ClosedPositionsTable`.
- Add `const isClosedView = state.selectedCategoryKey === 'closedPositions'`.
- Asset-class `.seg` options (line 182): when `isClosedView`, source from `acctAssetClassOptions(acctScopedClosedPositions(state))` instead of `acctAssetClassOptions(scopedPositions)`.
- Table area: when `isClosedView`, render `<ClosedPositionsTable state={state} dispatch={dispatch} positions={acctFilteredClosedPositions(state)} />` instead of the aggregate `<table>`/`sortedRows` block and its `PositionGroupOverlay`. When NOT `isClosedView`, keep existing rendering exactly as-is (default: all open positions, unfiltered, when nothing selected).
- Search box / empty-state copy stay generic, no changes needed (already scope-agnostic wording).
- Test: in `src/components/AccountsPage.test.tsx`:
  - Selecting an account under Closed Positions renders `ClosedPositionsTable` rows (symbol/closed date/realized G/L columns) instead of the aggregate open-positions table.
  - Asset-class filter narrows the closed-positions list correctly when applied in this mode.
  - Search box narrows the closed-positions list correctly when applied in this mode.
  - Edge case: deselecting (click same account again) returns to default open-positions view, `selectedCategoryKey` back to `null`.
  - Edge case: switching from an account selected under Closed Positions directly to an account under a tax-category card (different account, different categoryKey) correctly swaps the main panel from closed-table to open-table view.
- Acceptance: `npx vitest run src/components/AccountsPage.test.tsx` passes, all new cases green.

### T11 — Full test suite + build gate
Depends on: T1-T10.
- Run `npm run test` (full vitest run) — all files pass, not just touched ones.
- Run `npm run build` (tsc -b + vite build) — zero type errors.
- Run `npm run lint` (oxlint) — zero errors on touched files.
- If anything fails, fix and re-run before proceeding — do not move to docs/commit with a red gate.
- Acceptance: all three commands exit 0.

### T12 — Update `design.md` (root)
File: `/Users/mdoraiswamy/owa/portfolio/design.md`.
Depends on: T11.
- `AppState interface` code block (~line 64-91): add `selectedCategoryKey: TaxCategory | 'closedPositions' | null`.
- `src/lib/state.ts` bullet (~line 93): add `selectAccount`'s new `categoryKey` param to its description (helper list itself doesn't need signature detail, but note the param addition inline if the bullet already describes `selectAccount`'s toggle semantics — check current wording and extend it).
- `Action types (reducer.ts)` line (~line 99): no new action type added (still `SELECT_ACCOUNT`), but note its payload gained `categoryKey` if this list currently annotates payload shapes anywhere; otherwise leave as-is (list is action names only).
- Component tree (~line 101-125): update the `AccountsPage` line (~124) to mention the 4th Closed Positions card, the closed-positions main-panel branch, and that `PositionGroupOverlay` is NOT used in closed-positions mode.
- Full-file re-read after edits per CLAUDE.md's "Full-file review after major changes" — confirm no other section contradicts the new `selectedCategoryKey` field or the closed-positions branch, prose stays terse.
- Acceptance: file matches code exactly; no stale references to `categoryCards` as the sole card source for `AccountsPage`.

### T13 — Update `product-behavior.md` (root)
File: `/Users/mdoraiswamy/owa/portfolio/product-behavior.md`.
Depends on: T11.
- "Accounts page" section (~line 60-78): extend "Left panel — Category cards" bullet list to mention the 4th "Closed Positions" card (after Tax-Deferred), its account-scope rule (only accounts with ≥1 closed position), and its totals being realized G/L sums (with `—` for all-unknown-basis) instead of market value.
- Extend "Right panel" bullets: when Closed Positions + an account is selected, the aggregate positions table is replaced by the Closed Positions table (Security / Closed / Realized G/L / actions columns, same as Dashboard's), asset-class filter and search still apply, scoped to that account's closed positions; no `PositionGroupOverlay` in this mode.
- Note the two-card overlap behavior: an account with both open and closed positions appears under two cards; selecting it under one does not highlight it under the other.
- Full-file re-read after edits — confirm no contradiction with the existing "Accounts page" prose (e.g. the "No longer shown" list, "Account CRUD" note) and no narrative drift.
- Acceptance: file accurately describes new card, its scoping/totals rule, and the main-panel branch; matches code in `AccountsPage.tsx`/`ClosedPositionsTable.tsx`.

### T14 — Update `src/lib/design.md`
File: `/Users/mdoraiswamy/owa/portfolio/src/lib/design.md`.
Depends on: T11.
- "Component Tree" section (~line 5-7): extend the `ClosedPositionsTable.tsx` bullet to note it now takes a `positions` prop (caller-supplied), used both by `PositionsTable.tsx` (passes `state.closedPositions`) and `AccountsPage.tsx` (passes `acctFilteredClosedPositions(state)`).
- Add a short "Data Flows" entry (mirroring the existing "Undo Closed Position" flow's format) for the new selection flow, e.g.: `SELECT_ACCOUNT (accountId, categoryKey) → selectAccount (state.ts) → sets selectedAccountId + selectedCategoryKey (toggle if same pair) → categoryCards/closedPositionsCard `selected` fields react → AccountsPage branches main panel on selectedCategoryKey`.
- Full-file re-read — confirm consistency with the existing "Undo Closed Position" flow description (no contradiction on `ClosedPositionsTable`'s props).
- Acceptance: file reflects the new prop and selection flow; terse, no narrative.

### T15 — Update `src/lib/product-behavior.md`
File: `/Users/mdoraiswamy/owa/portfolio/src/lib/product-behavior.md`.
Depends on: T11.
- Under "Positions" section (~line 5-14, near "Closed Positions — Undo"), add a short subsection "Closed Positions — Accounts Page Scoping" describing: closed positions are viewable per-account via the Accounts page's Closed Positions card; only accounts with ≥1 closed position are listed; totals are realized-G/L sums excluding unknown-basis entries, showing `—` when all entries in scope are unknown-basis.
- Full-file re-read — confirm no contradiction with the existing "Closed Positions — Undo" subsection (undo/delete behavior itself is unchanged, just now also reachable from this new scoped view).
- Acceptance: file accurately describes the new scoping/totals behavior; terse.

### T15b — `schema-spec.md` (root) — decide, don't silently skip
File: `/Users/mdoraiswamy/owa/portfolio/schema-spec.md`.
Depends on: T11.
- Line 190's "AppState UI/filter fields" list is **already stale** — it omits `selectedAccountId`, `expandedCategories`, `acctAssetClassFilter`, `acctPosSearch`, and lists a `range`/`retirementFilter` that no longer exist in `state.ts`.
- Minimum: append `selectedCategoryKey: TaxCategory | 'closedPositions' | null` so the new field isn't the only recent one missing. Do NOT undertake a full reconciliation of that list as part of this feature — out of scope; note the drift to the user instead.
- Acceptance: the new field appears in the list; no other section of `schema-spec.md` contradicts it.

### T16 — Commit
Depends on: T11 (tests/build/lint green), T12, T13, T14, T15, T15b (all 5 docs updated).
- Stage changed files explicitly (not `-A`): `src/lib/state.ts`, `src/lib/state.test.ts`, `src/lib/reducer.ts`, `src/lib/reducer.test.ts`, `src/lib/selectors.ts`, `src/lib/selectors.test.ts`, `src/lib/persist.ts`, `src/lib/persist.test.ts`, `src/components/ClosedPositionsTable.tsx`, `src/components/ClosedPositionsTable.test.tsx`, `src/components/PositionsTable.tsx`, `src/components/PositionsTable.test.tsx`, `src/components/AccountsPage.tsx`, `src/components/AccountsPage.test.tsx`, `design.md`, `product-behavior.md`, `schema-spec.md`, `src/lib/design.md`, `src/lib/product-behavior.md`.
- Commit message describing the feature (4th Closed Positions nav card on Accounts page, scoped realized-G/L totals, `ClosedPositionsTable` generalized to accept a `positions` prop).
- Acceptance: `git log -1 --stat` shows exactly the intended files; `git status` clean.

### T17 — Teardown worktree (final task)
Depends on: T16.
- Switch back to the main worktree directory: `/Users/mdoraiswamy/owa/portfolio`.
- Remove the feature worktree: `git worktree remove ../worktree-accounts-closed-positions-nav`.
- Acceptance: `git worktree list` no longer shows `worktree-accounts-closed-positions-nav`; branch `accounts-closed-positions-nav/feature` still exists with the T16 commit.

## Acceptance Criteria

- Accounts page left column shows 4 cards: Taxable, Non-Taxable, Tax-Deferred, Closed Positions (in that order).
- Closed Positions card expanded list includes only accounts with ≥1 `ClosedPosition`.
- Card/account totals in the Closed Positions card are realized-G/L sums (unknown-basis entries excluded), showing `—` when every entry in scope is unknown-basis.
- Clicking an account under Closed Positions replaces the main-panel aggregate table with `ClosedPositionsTable`, scoped to that account, filterable by the existing asset-class `.seg` and search box.
- An account appearing under both its tax-category card and the Closed Positions card never shows highlighted in both simultaneously.
- No "view all closed positions across every account" mode exists — selection of a specific account is required.
- Dashboard's existing Closed Positions toggle/table behavior (`PositionsTable.tsx`) is unchanged — proven by regression tests.
- `npm run test`, `npm run build`, `npm run lint` all pass.
- `selectedCategoryKey` survives a save→load round trip and a Drive restore (it is on `coalesceWithDefaults`'s whitelist).
- `design.md`, `product-behavior.md`, `schema-spec.md`, `src/lib/design.md`, `src/lib/product-behavior.md` all accurately describe the new card, selection state, and scoping/filtering behavior.
- Work was done in and committed from `../worktree-accounts-closed-positions-nav`, then the worktree was removed.
