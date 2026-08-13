# Plan: Undo Closed Positions Feature

Goal: Add a per-row "Undo" button to `ClosedPositionsTable` that reopens a closed position as a new import via `ImportDialog` Step 2 (Review), pre-filled with closed position data, skipping the Setup/account-picker flow.

Caveman rules: short tasks (≤30min each), explicit deps, test per-task, reference docs updates mandatory.

## Key facts (read once, cite by path)

- `ClosedPositionsTable.tsx` (lines 14-83): currently shows symbol, closed date, realized G/L, and a Delete button (trash icon). Need to add Undo button.
- `ClosedPosition` type (types.ts lines 37-46): `id`, `accountId`, `symbol`, `name`, `closedDate`, `assetClass`, `realizedGL`, `realizedGLBasis`. No `shares`, `avgCost`, `price` — these must be synthesized as defaults (0) for import re-entry.
- `ImportDialog.tsx` (lines 58-1351): 2-step flow — Step 1 (Setup: account + entry mode + file) and Step 2 (Review: column mapping + edit + import). Currently Step 1 is mandatory; Step 2 is component-local state driven by `dataType`, `entryMode`, `step`, `csvHeaders`, `csvRows`, `fieldMap`, `importEdits`, etc.
- Entry modes today: `'upload' | 'paste' | 'manual'` (lines 67). Manual mode skips CSV parsing and seeds 10 blank rows (line 318).
- `handleImport()` (lines 405-476): builds final rows from edited preview, dispatches `IMPORT_POSITIONS` action with `mappedRows`, then sets `importDone = true`.
- After successful import dispatch, `DELETE_CLOSED_POSITION` action must fire to remove the closed position (reducer.ts line 43-44).
- No existing "pre-seed Step 2 with data" hook in ImportDialog — all state is seeded on Open/Close or mode switches. Must thread undo data in via callback or lifted state.

## Decisions (implement as-stated, don't re-litigate)

1. **Entry mode**: Use new `'undo'` mode, distinct from `'manual'`. Rationale: `'manual'` implies "user may edit rows freely" (10 blank rows); `'undo'` implies "1 pre-filled closed position, ready-to-reimport". Clear semantics.
2. **Thread undo data via parent prop callback**: Pass `onUndoClosedPosition?: (closedPosition: ClosedPosition, callback: (success: boolean) => void) => void` to `ImportDialog`. Parent (ClosedPositionsTable) calls it; ImportDialog opens, wires the data into Step 2 state, and calls callback with `true` on successful import (triggering parent's `DELETE_CLOSED_POSITION` dispatch).
3. **Synthesize missing fields to zero**: `shares`, `avgCost`, `price` all default to `'0'` (as strings in the raw row for import consistency). No-op position, user can edit in Step 2 if needed.
4. **Step 1 bypass**: Skip Setup entirely — go directly to Step 2. Set `step = 2`, `dataType = 'positions'`, `entryMode = 'undo'` immediately on undo-open.
5. **Account visibility**: Keep account label/display visible in Step 2 for context (user knows which account they're reopening into), even though picker is skipped.
6. **Callback timing — synchronous**: Fire `onUndoClosedPosition` callback immediately after `IMPORT_POSITIONS` dispatch (no async/useEffect wait). Assume dispatch is synchronous; parent's `DELETE_CLOSED_POSITION` dispatch runs in the callback.
7. **Use normal dedup logic**: `IMPORT_POSITIONS` already applies standard dedup (replace if symbol exists in that account). No new dedup code needed.

## Architecture sketch

```
ClosedPositionsTable
  ├─ onClick(undoBtn) → onUndoClosedPosition(closedPos, callback)
  │
App (or parent of ImportDialog)
  ├─ ImportDialog
  │    ├─ entryMode now: 'upload' | 'paste' | 'manual' | 'undo'
  │    ├─ onUndoClosedPosition? callback prop
  │    ├─ Step 2 state: pre-filled with undo data if entryMode === 'undo'
  │    ├─ handleImport → dispatch + callback(true)
  │    └─ [no Step 1 JSX for undo mode]
  │
  └─ dispatch DELETE_CLOSED_POSITION (after callback(true))
```

## Tasks

### T0 — worktree setup
Run:
```
git worktree add ../worktree-undo-closed-positions -b feature/undo-closed-positions
cd ../worktree-undo-closed-positions
```
Acceptance: `git worktree list` shows new worktree; `git status` shows branch `feature/undo-closed-positions`.

### T1 (dep: T0) — add entry mode type, state plumbing
File: `src/components/import/ImportDialog.tsx`
- Change `entryMode` state type from `'upload' | 'paste' | 'manual'` to `'upload' | 'paste' | 'manual' | 'undo'`.
- Add component prop interface: `onUndoClosedPosition?: (closedPosition: ClosedPosition, callback: (success: boolean) => void) => void` to `ImportDialogProps`.
- Add state: `undoClosedPosition: ClosedPosition | null` (default `null`), `undoStep: DialogStep | null` (default `null`). This tracks whether we're in undo mode and which step to render.
- Import `ClosedPosition` type from `../../lib/types`.
Tests: compile check only.
Acceptance: `npx tsc -b` passes.

### T2 (dep: T1) — add undo-open handler
File: `src/components/import/ImportDialog.tsx`
- Add method `handleOpenForUndo(closedPos: ClosedPosition)`:
  - `setIsOpen(true)`, `setUndoClosedPosition(closedPos)`, `setUndoStep(2)`, `setStep(2)`.
  - `setDataType('positions')`, `setEntryMode('undo')`.
  - Seed `csvRows` with 1 row: `[{ symbol: closedPos.symbol, name: closedPos.name || '', assetClass: closedPos.assetClass, shares: '0', avgCost: '0', price: '0' }]` (zero defaults).
  - `setFieldMap({})` (or infer from account's saved mapping if `closedPos.accountId` has one).
  - Auto-select the account: `setImportAccountKey(closedPos.accountId)`.
- Export public method `undoClosedPosition(closedPos: ClosedPosition)` via imperative handle (or wrapper method accessible to parent via ref).
Tests: none yet (no integration until T4).
Acceptance: `npx tsc -b` passes.

### T3 (dep: T2) — wire up handleImport callback
File: `src/components/import/ImportDialog.tsx` (`handleImport` function, lines 405-476)
- At the end of `handleImport()`, after dispatch and `setImportDone(true)`, check if `undoClosedPosition !== null`:
  - If true, call `onUndoClosedPosition?.(undoClosedPosition, (success) => { /* callback */ })` with `success = true`.
  - Reset `undoClosedPosition = null`, `undoStep = null` so subsequent opens don't re-trigger the callback.
- **Callback timing**: fire callback immediately (synchronous) after dispatch — parent's `DELETE_CLOSED_POSITION` dispatch runs in the callback.
Tests: unit test of `handleImport` dispatch with `undoClosedPosition` set (mock dispatch, verify callback called with `true`).
Acceptance: test passes; `npx tsc -b` passes.

### T4 (dep: T3) — update JSX to show/hide Step 2 for undo mode, hide Step 1
File: `src/components/import/ImportDialog.tsx` (JSX section)
- Step display tags (lines 627-639): conditionally render based on `entryMode === 'undo'` — if true, show only Step 2 tag ("2 Review"); hide Step 1.
  - Actually: if undo mode, skip the step display entirely (render a simple heading instead, e.g. "Reopen position").
- Step 1 JSX block (lines 642-1091): wrap with `{step === 1 && entryMode !== 'undo' && (...)}` to hide it when `entryMode === 'undo'`.
- Step 2 JSX block (lines 1095-1346): already wraps `{step === 2 && (...)}` — no change needed (it will render for undo mode since we set `step = 2` in `handleOpenForUndo`).
- Step 2 destination label (lines 1131-1132): keep account display visible (showing which account the position reopens into is helpful context for undo).
- At open/close reset, also reset undo state: in `handleCloseDialog`, add `setUndoClosedPosition(null)`, `setUndoStep(null)`.
Tests: integration test (see T5).
Acceptance: JSX compiles; undo mode skips Step 1 visually; account is shown.

### T5 (dep: T4) — ClosedPositionsTable integration
File: `src/components/ClosedPositionsTable.tsx`
- Add import: `{ useRef } from 'react'`, `ClosedPosition` from `../lib/types`.
- Accept a new optional prop in `ClosedPositionsTableProps`: `onUndoClick?: (closedPosition: ClosedPosition) => void`.
- In each row (lines 35-83), add an Undo button (lucide-react `RotateCcw` or `undo` icon) to the right of or left of the delete Trash icon.
  - Button: `onClick={() => onUndoClick?.(cp)}`, title/aria-label "Reopen this position as an import", same button styling as Trash (icononly, hover color shift).
- Alternatively: add button via a `useRef` to ImportDialog (imperative ref), call `importDialogRef.current?.undoClosedPosition(cp)` on click. But prop callback is cleaner.
Tests: add to `ClosedPositionsTable.test.tsx` (or co-locate new test):
  - Render with `onUndoClick` handler, click Undo button, verify handler called with correct closed position.
Acceptance: button renders, click fires callback with correct data, no errors.

### T6 (dep: T5) — App component wiring
File: `src/App.tsx`
- Get ref to `ImportDialog` component (add `useRef()`, pass as `ref` prop to ImportDialog).
- In the button click handler from ClosedPositionsTable's `onUndoClick`, call `importDialogRef.current?.undoClosedPosition(closedPos)`.
  - Or: lift the callback to App-level, handle the dispatch + ref call there.
- After successful import (via `onUndoClosedPosition` callback in ImportDialog), dispatch `DELETE_CLOSED_POSITION` action with the closed position's `id`.
Tests: end-to-end test in `App.test.tsx`:
  - Render app with a closed position in state.
  - Click Undo button on a closed position.
  - Verify: ImportDialog opens, Step 2 shows with pre-filled row.
  - Map fields (at least symbol).
  - Click Import.
  - Verify dispatch was called with `DELETE_CLOSED_POSITION` (mock dispatch, spy on it).
Acceptance: e2e test passes; no console errors.

### T7 (dep: T6) — handle Step 2 field mapping for undo mode
File: `src/components/import/ImportDialog.tsx`
- When `entryMode === 'undo'`, Step 2's field mapping should auto-populate based on account's saved mapping (if exists).
- Currently `handleContinue()` (lines 313-339) does this for non-manual modes — undo mode should follow the same pattern (fall into the `else` branch that prefills fieldMap).
- Verify: `entryMode === 'undo'` → not treated as `'manual'` in the `if (entryMode === 'manual')` check (line 317).
Tests: test that undo mode auto-maps fields from saved csvMappings (mirrors T6 of paste-mode plan).
Acceptance: field mapping prefills correctly for undo mode.

### T8 (dep: T7) — update ImportDialog to handle undo-data pre-fill
File: `src/components/import/ImportDialog.tsx`
- Modify `handleOpenForUndo` to also prefill `fieldMap` from account's saved mapping (if exists), matching the account's saved `csvMappings` entry where `kind === 'positions'`.
- Set sensible defaults for missing mappings: assume columns are `['symbol', 'name', 'assetClass', 'shares', 'avgCost', 'price']` and auto-map if they exist in saved mapping.
- Fallback: if no saved mapping, leave fieldMap empty (user will manually map on Step 2).
Tests: test that fieldMap is prefilled correctly from saved mapping.
Acceptance: `npx tsc -b` passes; new test passes.

### T9 (dep: T8) — full test suite pass
Run:
```
npm run test
npm run lint
npm run build
```
Fix any failures (type errors, lint, broken tests).
Acceptance: all three commands exit 0.

### T10 (dep: T9) — update reference docs
File: `/Users/mdoraiswamy/owa/portfolio/src/lib/product-behavior.md` (if exists) or create it.
- Add section "Closed Positions — Undo" under the Positions section:
  - "Click Undo on a closed position to reopen it as a new import. Opens ImportDialog Step 2 directly with the position pre-filled (symbol, name, asset class, 0 shares/cost/price). Account is pre-selected; account picker is skipped. User can edit fields or click Import to add it back. After successful import, the closed position is deleted."
File: `/Users/mdoraiswamy/owa/portfolio/src/lib/design.md` (if exists) or create it.
- Add to Component tree section: `ClosedPositionsTable.tsx # table with symbol, closed date, realized G/L, delete + undo buttons`.
- Add to Data flow section: "Undo Closed Position: ClosedPosition → ImportDialog Step 2 (pre-filled row) → IMPORT_POSITIONS + DELETE_CLOSED_POSITION dispatch".
Tests: none (docs-only).
Acceptance: docs are terse, token-optimized, no contradictions; grep for "undo" case-insensitive in both docs finds the new sections.

### T11 (dep: T10) — full verification gate
Run:
```
npm run test
npm run lint
npm run build
```
Acceptance: all three exit 0.

### T12 (dep: T11) — commit
In worktree:
```
git add src/components/import/ImportDialog.tsx src/components/ClosedPositionsTable.tsx src/App.tsx src/lib/product-behavior.md src/lib/design.md
git commit -m "Add Undo button to closed positions, opens ImportDialog Step 2 with pre-filled data"
```
Acceptance: `git log -1` shows the new commit; `git status` clean.

### T13 (dep: T12) — teardown worktree
```
cd /Users/mdoraiswamy/owa/portfolio
git worktree remove ../worktree-undo-closed-positions
```
Acceptance: `git worktree list` no longer shows the worktree; branch `feature/undo-closed-positions` still exists.

## Overall acceptance criteria (plan "done")

1. ClosedPositionsTable renders an Undo button per closed position (left or right of Delete).
2. Clicking Undo opens ImportDialog directly to Step 2 (no Setup/account picker).
3. Step 2 row is pre-filled with closed position data (symbol, name, assetClass, 0 for shares/avgCost/price).
4. Account is pre-selected; account picker is skipped.
5. Field mapping auto-fills from account's saved csvMappings (if exists).
6. User can edit fields or click Import immediately.
7. On successful import, dispatch fires DELETE_CLOSED_POSITION to remove closed position.
8. Step 1 JSX is hidden for undo mode.
9. Reference docs (product-behavior.md, design.md) are updated and consistent.
10. `npm run test`, `npm run lint`, `npm run build` all pass.
11. Change committed on `feature/undo-closed-positions`; worktree torn down.

## Test strategy

- Unit tests in `ImportDialog.test.tsx`: test `handleOpenForUndo`, field mapping prefill, callback firing.
- Unit tests in `ClosedPositionsTable.test.tsx`: test Undo button click → callback.
- Integration test in `App.test.tsx`: full undo flow (render, click, import, delete).
- No new test framework; use existing `vitest` + `jsdom` + `render`/`screen`/`fireEvent`.

## Risks & mitigations

- **Step 2 only for undo**: if Step 1 JSX fails to hide cleanly, may render an empty Setup section. Mitigation: wrap all Step 1 JSX with `entryMode !== 'undo'` check, not just at top level.
- **Account mismatch**: if saved csvMappings doesn't exist for the account, fieldMap stays empty. User must manually map. Acceptable (mirrors manual mode).
- **Default 0 values**: synthesizing shares/cost/price as 0 means re-imported position has 0 value. This is acceptable (closed positions have no current holdings; reimporting them is a data-entry act, not a position correction). User can edit these in Step 2 if desired.

## Out of scope

- Transactions undo (only positions).
- Partial re-import (editing closed position, then re-importing subset of fields).
- Batch undo (button only works per-row).
- Design refinements (button placement, icon choice, color scheme — use existing Trash button as template).

