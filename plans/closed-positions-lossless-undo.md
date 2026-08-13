# Plan: Closed Positions — Lossless/Exact Undo

Goal: make closing a position lossless (snapshot shares/avgCost/price/override/lastImportedAt at close time) and make Undo instant/exact — a direct `RESTORE_CLOSED_POSITION` dispatch with dedup handling, replacing the current `ImportDialog` Step-2 detour.

Caveman rules: short tasks (≤30min each), explicit deps, test per-task, reference docs updates mandatory.

## Discovery notes

**`Position` (src/lib/types.ts:24-35)**: `id, accountId, symbol, name, assetClass, assetClassManualOverride?, shares, avgCost, price, lastImportedAt`.

**`ClosedPosition` (src/lib/types.ts:37-46), current**: `id, accountId, symbol, name, closedDate, assetClass, realizedGL, realizedGLBasis`. Missing `shares/avgCost/price/assetClassManualOverride/lastImportedAt` — this is the bug. Adding these 5 fields per requirement #1.

**Creation sites that build `ClosedPosition`** (both need new-field population):
- `closePosition()` — `src/lib/state.ts:139-157`
- reimport auto-close diff — `src/lib/positionsImport.ts:103-134` (inside `newClosedPositions` map)

**`state.ts` helper pattern**: plain exported functions `(state: AppState, ...args) => AppState`, JSDoc one-liner above each, pure/immutable spread. `deleteClosedPosition` (line 129) and `closePosition` (line 139) are the closest siblings for the new `restoreClosedPosition` helper (inverse of `closePosition`) and the dedup-match helper.

**`reducer.ts` dispatch pattern**: one `case 'ACTION_NAME': return StateActions.helperName(state, action.field, ...)` line per action, grouped under a comment (`// Position management`). `CLOSE_POSITION` is line 40-41, `DELETE_CLOSED_POSITION` is line 43-44 — `RESTORE_CLOSED_POSITION` goes right after those.

**Dedup helper home: `src/lib/state.ts`, not `selectors.ts`.** `selectors.ts` exports are all "derive a view/list/total from `AppState` for rendering" (`visiblePositions`, `summaryCards`, `allocationBars`, etc.) — none of them are pre-dispatch mutation-decision helpers. `state.ts` already contains the exact sibling shape needed (`closePosition`, `deleteClosedPosition` — pure functions that inspect state and decide what changes). The match-check helper (`findMatchingOpenPosition` or similar) is conceptually "is this closed-position snapshot restorable as-is, or does it collide" — same family as `closePosition`, so it lives in `state.ts` alongside `restoreClosedPosition`.

**Dead code to remove — `src/components/import/ImportDialog.tsx`** (grep `-i undo` confirmed exact set, 17 hits):
- Line 20: `onUndoClosedPosition?: ...` prop on `ImportDialogProps`
- Lines 59-62: `forwardRef<{ undoClosedPosition: ... }, ImportDialogProps>` generic + destructure `onUndoClosedPosition` — collapse to plain `function ImportDialog({ state, dispatch, onClose }: ImportDialogProps)`, drop `forwardRef`/`useImperativeHandle` entirely (nothing else uses the ref — confirmed below)
- Line 71: entry mode union `'upload' | 'paste' | 'manual' | 'undo'` → drop `'undo'`
- Line 72: `undoClosedPosition` state
- Lines 73-74: `_undoStep` state + `void _undoStep` placeholder comment
- Lines 106-146: `handleOpenForUndo` callback (entire body)
- Lines 148-150: `useImperativeHandle(ref, ...)`
- Lines 180-181: `setUndoClosedPosition(null)`, `setUndoStep(null)` inside `handleCloseDialog`
- Lines 523-532: the `if (undoClosedPosition !== null) { onUndoClosedPosition?.(...) }` block inside `handleImport`
- Lines 547-548: `undoClosedPosition, onUndoClosedPosition` in `handleImport`'s `useCallback` deps array
- Also: `import { forwardRef, useImperativeHandle }` from `'react'` (line 1) becomes unused — drop from the import line
- Also: `ClosedPosition` import from `'../../lib/types'` (line 4) — check still used elsewhere in file before dropping (it is NOT used elsewhere per grep, so drop it too)

**Dead code to remove — `src/App.tsx`** (grep `-i undo` confirmed, plus `importDialogRef` grep):
- Line 6: `import type { ClosedPosition } from './lib/types'` — check other uses before dropping (none found — drop)
- Line 53: `importDialogRef` declaration
- Lines 157-160: `handleUndoClosedPosition` callback
- Lines 163-170: `handleOnUndoClosedPosition` callback
- Line 325: `ref={importDialogRef}` on `<ImportDialog>`
- Line 329: `onUndoClosedPosition={handleOnUndoClosedPosition}` on `<ImportDialog>`
- Line 334: `<PositionsTable ... onUndoClick={handleUndoClosedPosition} />` → the `onUndoClick` prop itself STAYS (PositionsTable/ClosedPositionsTable still need an undo-click hook), only the VALUE changes — new task wires it to dispatch `RESTORE_CLOSED_POSITION` + run dedup check instead of `handleUndoClosedPosition`

**Repo-wide grep confirms no other consumer** of `onUndoClosedPosition` or `importDialogRef` outside `ImportDialog.tsx`/`ImportDialog.test.tsx`/`App.tsx`. `ImportDialog.test.tsx` has undo-specific tests at lines ~1537-1705 (tests `'53.'`, `'53b.'`, and two more referencing `importDialogRef`/`undoClosedPosition`) that must be deleted alongside the dead code (they'll fail to compile/pass once the ref and prop are gone).

**`PositionsTable.tsx`** (line 13, `onUndoClick` prop; line 305, passes it through to `ClosedPositionsTable`) — prop plumbing stays as-is, just forwards through; no changes needed here beyond what already exists.

**`ClosedPositionsTable.tsx`** — `onUndoClick?: (closedPosition: ClosedPosition) => void` (line 9), `RotateCcw` button `onClick={() => onUndoClick?.(cp)}` (line 59-76). The dedup-confirm logic (per requirement #5) must run BEFORE dispatch, so `onUndoClick` in this component's usage needs to become the place the dedup-check + `window.confirm` + dispatch happens — either inline in `ClosedPositionsTable` itself (mirroring `handleDeleteClosedPosition`'s local pattern, lines 17-24) or in the callback passed down from `App.tsx`. Plan puts the confirm/dispatch logic directly in `ClosedPositionsTable.handleUndoClosedPosition` (new local function, sibling to `handleDeleteClosedPosition`), calling the new `state.ts` pure match helper — keeps `App.tsx` free of feature logic and mirrors the existing delete-confirm pattern in the same file.

**`persist.ts` migration pattern** (`coalesceWithDefaults`, lines 42-69): collections default via `??`; per-item field defaults use `.map()` (see `accounts.institution` at lines 46-49: `accounts: (loaded.accounts ?? defaults.accounts).map((a) => ({ ...a, institution: a.institution ?? '' }))`). New `ClosedPosition` fields need the same `.map()` treatment on `closedPositions` (line 51 currently just `loaded.closedPositions ?? defaults.closedPositions` with no per-item defaulting).

**`plans/_template.md` does not exist in this repo** — no template file found at that path or anywhere under `/Users/mdoraiswamy/owa/portfolio`. This plan follows the caveman/T0..Tn/tests/acceptance-criteria structure from the task instructions and from the closest existing precedent in this repo, `plans/undo-closed-positions.md` (the original, now-being-undone plan for the ImportDialog-detour version of Undo).

## Decisions (implement as-stated, don't re-litigate)

1. New `ClosedPosition` fields: `shares: number`, `avgCost: number`, `price: number`, `assetClassManualOverride?: string`, `lastImportedAt: string`.
2. Restored `Position` gets a FRESH `uid('position')` id — never reuses the original. No `originalPositionId` field added to `ClosedPosition`.
3. Restored `Position.lastImportedAt` = the value stored in the `ClosedPosition` snapshot (original import time), not `new Date().toISOString()`.
4. Dedup match is symbol + exact equality on `shares`, `avgCost`, `assetClass` (per requirement #5 — NOT `assetClassManualOverride`, NOT `price`; only those three fields decide "same position lot").
5. Three dedup outcomes: no match → silent restore; exact match → `window.confirm`, Yes replaces existing position with restored one, No is a total no-op (no dispatch); partial mismatch (symbol matches, other fields don't) → silent restore as a second row (duplicate symbol allowed).
6. Dead ImportDialog-undo-detour code fully removed (see Discovery notes for exact lines).

## Open questions — resolved

Four items were flagged after the first draft. Walked through each; decisions below are final, plan already reflects them (cross-refs given so nothing drifts):

1. **`plans/_template.md` doesn't exist in this repo.** Decision: no template to conform to — keep this plan's caveman/T0..Tn/tests/acceptance-criteria structure as-is, modeled on the closest in-repo precedent (`plans/undo-closed-positions.md`). See Discovery notes, line ~54. No plan change needed.
2. **Dedup helper location: `state.ts` vs `selectors.ts`.** Decision: `state.ts`. Reasoning already in Discovery notes (line ~21): `selectors.ts` only holds render-derivation helpers (`visiblePositions`, `summaryCards`, etc.), never pre-dispatch mutation-decision helpers; `state.ts` already has the matching sibling shape (`closePosition`, `deleteClosedPosition`). `findMatchingOpenPosition`/`isExactLotMatch` land in `state.ts` (T5). No plan change needed.
3. **`PositionsTable.tsx` is part of the undo chain, not just `ClosedPositionsTable.tsx`/`App.tsx`.** Confirmed real — `onUndoClick` is threaded through `PositionsTable.tsx` (line 13 prop, line 305 pass-through) on its way from `App.tsx` to `ClosedPositionsTable.tsx`. Decision: include it. T9 now explicitly removes `onUndoClick` from `PositionsTableProps` and from its pass-through JSX (see T9, "File: `src/components/PositionsTable.tsx`" block) — already in the plan, confirmed correct, no change needed.
4. **`ImportDialog.test.tsx` has undo-specific tests (~lines 1537-1705) that aren't in the original brief.** Decision: include their removal — they reference `importDialogRef`/`undoClosedPosition` and will fail to compile once T9's dead-code removal lands. T9 already has a dedicated "File: `src/components/import/ImportDialog.test.tsx`" bullet calling this out. No change needed.

Net effect: all four items were already correctly folded into T9 (items 2-4) and the Discovery notes (item 1) in the first draft. This section exists so the resolution is explicit and auditable, not implicit.

## Tasks

### T0 — worktree setup
Run:
```
git worktree add ../worktree-closed-positions-undo -b closed-positions-lossless-undo/main
cd ../worktree-closed-positions-undo
```
Acceptance: `git worktree list` shows the new worktree; `git status` inside it shows branch `closed-positions-lossless-undo/main`, clean tree matching `main`.
All subsequent tasks run inside this worktree.

### T1 (dep: T0) — extend `ClosedPosition` type
File: `src/lib/types.ts`
- Add to `ClosedPosition` interface (after `assetClass`, before `realizedGL` — order doesn't matter functionally, keep grouped near other snapshot fields): `shares: number`, `avgCost: number`, `price: number`, `assetClassManualOverride?: string`, `lastImportedAt: string`.
Tests: none (type-only change); `npx tsc -b` will fail until T2/T3 populate the new required fields at both construction sites — that's expected and resolved by T2.
Acceptance: file edited; do not run `tsc -b` standalone yet (will show errors in state.ts/positionsImport.ts until T2 lands) — just eyeball the diff.

### T2 (dep: T1) — capture snapshot in `closePosition()`
File: `src/lib/state.ts` (~line 139-157)
- In `closePosition()`, when building `closed: ClosedPosition`, add: `shares: position.shares`, `avgCost: position.avgCost`, `price: position.price`, `assetClassManualOverride: position.assetClassManualOverride`, `lastImportedAt: position.lastImportedAt`.
Tests (new, in `src/lib/state.test.ts`):
- Happy: `closePosition()` on a position with `shares: 10, avgCost: 5, price: 7, assetClassManualOverride: 'Equity', lastImportedAt: '2026-01-01'` produces a `ClosedPosition` with all 5 fields matching exactly.
- Edge: position with no `assetClassManualOverride` (undefined) → closed snapshot's `assetClassManualOverride` is `undefined` (not `null`, not throwing).
Acceptance: new tests pass; `npx vitest run src/lib/state.test.ts` green.

### T3 (dep: T1) — capture snapshot in reimport auto-close diff
File: `src/lib/positionsImport.ts` (~line 103-134, inside `newClosedPositions` map)
- Add the same 5 fields to the returned `ClosedPosition` object, sourced from `oldPosition` (already in scope as `oldPositions.find((p) => p.symbol === symbol)!`): `shares: oldPosition.shares`, `avgCost: oldPosition.avgCost`, `price: oldPosition.price`, `assetClassManualOverride: oldPosition.assetClassManualOverride`, `lastImportedAt: oldPosition.lastImportedAt`.
Tests (new, in `src/lib/positionsImport.test.ts`):
- Happy: reimporting an account's positions without a previously-held symbol auto-closes it; assert the resulting `ClosedPosition` has `shares/avgCost/price/lastImportedAt` matching the pre-reimport `Position`.
- Edge: symbol had `assetClassManualOverride` set before disappearing → preserved on the closed snapshot.
Acceptance: new tests pass; `npx vitest run src/lib/positionsImport.test.ts` green. `npx tsc -b` now passes (both construction sites satisfy the type from T1).

### T4 (dep: T1) — migration tolerance in `persist.ts`
File: `src/lib/persist.ts`, `coalesceWithDefaults()` (~line 51)
- Change `closedPositions: loaded.closedPositions ?? defaults.closedPositions` to `.map()` over each loaded item and default missing fields, mirroring the `accounts.institution` pattern (lines 46-49):
```ts
closedPositions: (loaded.closedPositions ?? defaults.closedPositions).map((cp) => ({
  ...cp,
  shares: cp.shares ?? 0,
  avgCost: cp.avgCost ?? 0,
  price: cp.price ?? 0,
  assetClassManualOverride: cp.assetClassManualOverride,
  lastImportedAt: cp.lastImportedAt ?? '',
})),
```
Tests (new, in `src/lib/persist.test.ts`):
- Happy: loading a persisted blob whose `closedPositions` entries are the OLD (pre-this-feature) shape (no `shares/avgCost/price/lastImportedAt`) doesn't throw, and each entry gets `shares: 0, avgCost: 0, price: 0, lastImportedAt: ''`, `assetClassManualOverride: undefined`.
- Edge: a mix of old-shape and new-shape entries in the same array loads correctly (new-shape entries keep their real values, old-shape entries get defaults).
Acceptance: new tests pass; `npx vitest run src/lib/persist.test.ts` green.

### T5 (dep: T2, T3) — dedup match helper in `state.ts`
File: `src/lib/state.ts`
- Add pure exported function, e.g.:
```ts
/**
 * Find an existing OPEN position in the same account with the same symbol as
 * a ClosedPosition snapshot, for restore-time dedup decisions.
 * Returns null if no same-symbol position exists in that account.
 */
export function findMatchingOpenPosition(state: AppState, closed: ClosedPosition): Position | null {
  return state.positions.find(
    (p) => p.accountId === closed.accountId && p.symbol === closed.symbol
  ) ?? null
}

/**
 * True if an existing open position is an exact-lot match for a closed
 * snapshot (same shares, avgCost, assetClass) — the "safe to silently
 * overwrite after confirm" case. False means "different lot, coexist".
 */
export function isExactLotMatch(position: Position, closed: ClosedPosition): boolean {
  return (
    position.shares === closed.shares &&
    position.avgCost === closed.avgCost &&
    position.assetClass === closed.assetClass
  )
}
```
Tests (new, in `src/lib/state.test.ts`):
- Happy: `findMatchingOpenPosition` returns the matching position when accountId+symbol match.
- Edge: no match (different account, same symbol) → `null`.
- Edge: `isExactLotMatch` true when shares/avgCost/assetClass all equal.
- Edge: `isExactLotMatch` false when any one of the three differs (3 sub-cases: shares differs, avgCost differs, assetClass differs).
- Edge: `isExactLotMatch` ignores `assetClassManualOverride`/`price` differences (per decision #4) — still true even if those differ.
Acceptance: new tests pass; `npx vitest run src/lib/state.test.ts` green.

### T6 (dep: T5) — `restoreClosedPosition` helper in `state.ts`
File: `src/lib/state.ts`
- Add:
```ts
/**
 * Restore a ClosedPosition back into open positions (inverse of closePosition).
 * Always assigns a fresh id. If replaceExistingPositionId is given, that
 * position is removed and replaced by the restored one (exact-match-confirmed
 * overwrite case); otherwise the restored position is simply added.
 */
export function restoreClosedPosition(
  state: AppState,
  closedPositionId: string,
  replaceExistingPositionId?: string
): AppState {
  const closed = state.closedPositions.find((cp) => cp.id === closedPositionId)
  if (!closed) return state
  const restored: Position = {
    id: uid('position'),
    accountId: closed.accountId,
    symbol: closed.symbol,
    name: closed.name,
    assetClass: closed.assetClass,
    assetClassManualOverride: closed.assetClassManualOverride,
    shares: closed.shares,
    avgCost: closed.avgCost,
    price: closed.price,
    lastImportedAt: closed.lastImportedAt,
  }
  return {
    ...state,
    positions: [
      ...state.positions.filter((p) => p.id !== replaceExistingPositionId),
      restored,
    ],
    closedPositions: state.closedPositions.filter((cp) => cp.id !== closedPositionId),
  }
}
```
Tests (new, in `src/lib/state.test.ts`):
- Happy: no `replaceExistingPositionId` → restored position added to `positions`, matching closed snapshot on `symbol/name/assetClass/assetClassManualOverride/shares/avgCost/price/lastImportedAt`; `closedPositions` no longer contains the entry.
- Happy: fresh id — restored `Position.id` is NOT equal to the original (now-deleted) `Position.id` that was closed, and is not equal to `closedPositionId`.
- Happy: `lastImportedAt` on restored position equals the `ClosedPosition.lastImportedAt` snapshot value, not a freshly-generated timestamp (assert against a fixed fixture value, don't compare to `Date.now()`).
- Happy: `replaceExistingPositionId` given → that position removed from `positions`, restored position added, closed entry removed.
- Edge: `closedPositionId` not found → state unchanged (same reference or deep-equal), no throw.
Acceptance: new tests pass; `npx vitest run src/lib/state.test.ts` green.

### T7 (dep: T6) — reducer action `RESTORE_CLOSED_POSITION`
File: `src/lib/reducer.ts`
- Add case, right after `DELETE_CLOSED_POSITION` (~line 44):
```ts
case 'RESTORE_CLOSED_POSITION':
  return StateActions.restoreClosedPosition(state, action.closedPositionId, action.replaceExistingPositionId)
```
Tests (new, in `src/lib/reducer.test.ts` if it exists, else colocate in `state.test.ts` calling `appReducer` directly — check which file already has reducer-level tests for `CLOSE_POSITION`/`DELETE_CLOSED_POSITION` and mirror it):
- Happy: dispatching `{ type: 'RESTORE_CLOSED_POSITION', closedPositionId }` through `appReducer` produces the same result as calling `restoreClosedPosition` directly.
- Happy: dispatching with `replaceExistingPositionId` set replaces correctly through the reducer.
Acceptance: new tests pass; `npx tsc -b` passes.

### T8 (dep: T7) — wire `ClosedPositionsTable` Undo button to dedup + dispatch
File: `src/components/ClosedPositionsTable.tsx`
- Import `findMatchingOpenPosition`, `isExactLotMatch` from `../lib/state`.
- Add local `handleUndoClosedPosition(cp: ClosedPosition)` (sibling to existing `handleDeleteClosedPosition`, same file):
  - `const match = findMatchingOpenPosition(state, cp)`
  - If `!match` → `dispatch({ type: 'RESTORE_CLOSED_POSITION', closedPositionId: cp.id })` (silent restore).
  - Else if `isExactLotMatch(match, cp)` → `window.confirm('An open position already exists for <symbol> with the same shares and cost basis. Restore this closed position and replace the existing one?')`; if confirmed → `dispatch({ type: 'RESTORE_CLOSED_POSITION', closedPositionId: cp.id, replaceExistingPositionId: match.id })`; if declined → no dispatch at all (return).
  - Else (partial mismatch) → `dispatch({ type: 'RESTORE_CLOSED_POSITION', closedPositionId: cp.id })` (silent restore, duplicate symbol coexists).
- Change the `RotateCcw` button's `onClick` from `() => onUndoClick?.(cp)` to `() => handleUndoClosedPosition(cp)`.
- Keep the `onUndoClick` prop in `ClosedPositionsTableProps` only if still needed by a caller — check `PositionsTable.tsx` usage; per requirement #4/discovery, this prop chain (`App.tsx handleUndoClosedPosition` → `PositionsTable onUndoClick` → `ClosedPositionsTable onUndoClick`) is being replaced by local logic, so remove the `onUndoClick` prop entirely from `ClosedPositionsTableProps` and from `PositionsTable`'s pass-through (see T9).
Tests (new/updated, in `src/components/ClosedPositionsTable.test.tsx` — create if it doesn't exist yet, check first):
- Happy: click Undo on a closed position with no same-symbol open position in the account → dispatches `RESTORE_CLOSED_POSITION` with just `closedPositionId`, no confirm shown.
- Edge: click Undo where an exact-lot match exists, user confirms (mock `window.confirm` → `true`) → dispatches `RESTORE_CLOSED_POSITION` with both `closedPositionId` and `replaceExistingPositionId`.
- Edge: click Undo where an exact-lot match exists, user declines (mock `window.confirm` → `false`) → no dispatch at all.
- Edge: click Undo where a same-symbol position exists but with different shares/avgCost/assetClass → dispatches silent restore (no confirm shown), duplicate symbol allowed.
Acceptance: new tests pass; `npx vitest run src/components/ClosedPositionsTable.test.tsx`.

### T9 (dep: T8) — remove dead undo-detour code: `ImportDialog.tsx`, `App.tsx`, `PositionsTable.tsx`
Grep first to confirm scope, then delete:
```
grep -rn -i undo src/components/import/ImportDialog.tsx src/App.tsx
grep -rn "onUndoClosedPosition\|importDialogRef" src/
```
(Expect the results enumerated in Discovery notes above — if anything new shows up, stop and re-check before deleting.)

File: `src/components/import/ImportDialog.tsx`
- Remove `onUndoClosedPosition` prop from `ImportDialogProps`.
- Change `export const ImportDialog = forwardRef<{...}, ImportDialogProps>(function ImportDialog({ state, dispatch, onClose, onUndoClosedPosition }, ref) {` to a plain function component: `export function ImportDialog({ state, dispatch, onClose }: ImportDialogProps) {`.
- Remove the closing `})` pairing for `forwardRef` at the end of the component (adjust to plain function close).
- Remove `entryMode` union's `'undo'` member.
- Remove `undoClosedPosition` and `_undoStep` state.
- Remove `handleOpenForUndo` callback in full.
- Remove `useImperativeHandle(...)` call.
- Remove the two `setUndoClosedPosition(null)`/`setUndoStep(null)` lines in `handleCloseDialog`.
- Remove the `if (undoClosedPosition !== null) { onUndoClosedPosition?.(...) }` block in `handleImport`.
- Remove `undoClosedPosition, onUndoClosedPosition` from `handleImport`'s deps array.
- Drop now-unused imports: `forwardRef`, `useImperativeHandle` from `'react'`; `ClosedPosition` from `'../../lib/types'` (re-grep the file after edits to confirm truly unused before removing each).

File: `src/App.tsx`
- Remove `importDialogRef` declaration.
- Remove `handleUndoClosedPosition` and `handleOnUndoClosedPosition` callbacks.
- Remove `ref={importDialogRef}` and `onUndoClosedPosition={handleOnUndoClosedPosition}` from the `<ImportDialog>` JSX.
- Remove `onUndoClick={handleUndoClosedPosition}` from `<PositionsTable>` JSX (see next bullet — prop removed entirely).
- Drop now-unused `import type { ClosedPosition } from './lib/types'` if nothing else in the file uses it (re-grep to confirm).

File: `src/components/PositionsTable.tsx`
- Remove `onUndoClick` from `PositionsTableProps` and from the pass-through to `<ClosedPositionsTable ... onUndoClick={onUndoClick} />` (drop the prop from that JSX call too, since `ClosedPositionsTable` no longer accepts it per T8).

File: `src/components/import/ImportDialog.test.tsx`
- Delete the undo-specific tests (search `-i undo`; covers the `'53.'`/`'53b.'`-numbered tests and any test referencing `importDialogRef`/`undoClosedPosition`/`onUndoClosedPosition`).

Tests: no new tests added in this task (pure deletion) — but this task's acceptance IS the test:
Acceptance: `grep -rn -i undo src/components/import/ImportDialog.tsx src/App.tsx src/components/PositionsTable.tsx` returns nothing; `grep -rn "onUndoClosedPosition\|importDialogRef" src/` returns nothing; `npx tsc -b` passes (no orphaned imports/types); `npx vitest run src/components/import/ImportDialog.test.tsx` passes with the undo tests gone and all remaining tests green.

### T10 (dep: T9) — update `src/lib/design.md`
- Rewrite the "Undo Closed Position" Data Flow section (currently: `ClosedPosition → ImportDialog Step 2 (pre-filled row) → IMPORT_POSITIONS + DELETE_CLOSED_POSITION dispatch`) to describe the new flow, e.g.:
  `ClosedPosition → ClosedPositionsTable Undo click → findMatchingOpenPosition/isExactLotMatch dedup check (state.ts) → [window.confirm if exact-lot match] → RESTORE_CLOSED_POSITION dispatch → restoreClosedPosition (state.ts)`.
- Update the `ClosedPositionsTable.tsx` Component Tree line (currently: "table with symbol, closed date, realized G/L, delete + undo buttons") only if the one-line description needs a behavior note — keep terse, likely no change needed beyond confirming accuracy.
- If `design.md` documents `ClosedPosition`/`Position` field lists anywhere else in the file, update them to include the 5 new fields (re-read full file first — it's short, ~14 lines currently, but check for drift).
Tests: none (doc-only).
Acceptance: full re-read of `design.md` after edit; no stale references to `ImportDialog Step 2`, `IMPORT_POSITIONS`, `undoClosedPosition`, or `importDialogRef` remain anywhere in the file.

### T11 (dep: T9) — update `src/lib/product-behavior.md`
- Rewrite "Closed Positions — Undo" section (currently describes ImportDialog Step-2 pre-fill flow with 0 shares/cost/price) to describe:
  - Click Undo restores the position instantly with its exact original shares/avgCost/price/assetClass/lastImportedAt — no dialog opens.
  - No same-symbol open position in the account → silent restore.
  - Same-symbol open position with identical shares/avgCost/assetClass → confirm dialog asking to overwrite; Yes replaces the existing position with the restored one and removes the closed entry; No cancels entirely (closed position stays closed, nothing changes).
  - Same-symbol open position with different shares/avgCost/assetClass → silent restore as a second, separate lot (duplicate symbol rows coexist).
  - Restored position always gets a new internal id (not user-visible).
Tests: none (doc-only).
Acceptance: full re-read of `product-behavior.md` after edit; section accurately covers all 3 dedup outcomes; no stale references to ImportDialog/Step 2/zero-value pre-fill remain anywhere in the file.

### T12 (dep: T10, T11) — full test/build/lint pass
Run in the worktree:
```
npm run test
npm run build
npm run lint
```
Acceptance: all three succeed with zero failures/errors. If any fail, fix root cause in the relevant task's files (not by weakening tests) and re-run until clean. Per CLAUDE.md, do not proceed to commit until this task is fully green.

### T13 (dep: T12) — commit
This task is a plan artifact — actual commit execution happens when this plan is run, not now.
When executed: stage the changed files (`src/lib/types.ts`, `src/lib/state.ts`, `src/lib/state.test.ts`, `src/lib/positionsImport.ts`, `src/lib/positionsImport.test.ts`, `src/lib/persist.ts`, `src/lib/persist.test.ts`, `src/lib/reducer.ts`, `src/components/ClosedPositionsTable.tsx`, `src/components/ClosedPositionsTable.test.tsx`, `src/components/import/ImportDialog.tsx`, `src/components/import/ImportDialog.test.tsx`, `src/App.tsx`, `src/components/PositionsTable.tsx`, `src/lib/design.md`, `src/lib/product-behavior.md`), commit with a message describing the lossless-snapshot + instant-exact-undo change, on branch `closed-positions-lossless-undo/main`.
Acceptance: `git status` clean; `git log -1` shows the new commit on the correct branch.

### T14 (dep: T13) — cleanup worktree
Run from the main working directory (`/Users/mdoraiswamy/owa/portfolio`):
```
cd /Users/mdoraiswamy/owa/portfolio
git worktree remove ../worktree-closed-positions-undo
```
Acceptance: `git worktree list` no longer shows the removed worktree; branch `closed-positions-lossless-undo/main` still exists (not deleted) with the commit from T13.

## Out of scope

- Hard "Delete" (Trash icon, `DELETE_CLOSED_POSITION`) — untouched, stays permanent.
- `originalPositionId` field on `ClosedPosition` — explicitly rejected.
- Any change to `realizedGL`/`realizedGLBasis` computation — untouched.
- Any change to the manual-close entry point (`PositionGroupOverlay` calling `CLOSE_POSITION`) beyond the snapshot fields already captured by `closePosition()`.
