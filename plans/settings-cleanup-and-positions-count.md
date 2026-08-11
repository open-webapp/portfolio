# Settings Cleanup and Positions Row-Count

Caveman plan. Small tasks, each one thing, each with deps and tests. Read top
to bottom before starting task 1. No `plans/_template.md` exists in repo
(checked) — this plan follows the shape of `plans/import-sessions-and-settings.md`
(closest prior art: Overview / Facts checked / Tasks w/ deps / Test cases /
Acceptance criteria).

This plan is the reverse of `plans/import-sessions-and-settings.md` — it rips
out the Import Sessions feature that plan added, plus three unrelated small
additions (Accounts section removal from Settings, Positions table last-column
semantics change, and a new delete-position-from-overlay feature appended at
the end of this document — Tasks 12-16 — added after the original three items
were already planned).

## Facts checked before writing this plan (so nobody re-derives them)

- `importSessionId`/`ImportSession`/`importSession` touches these files
  (grepped case-insensitive across `src/`, confirmed one-by-one):
  - `src/lib/types.ts` — `ImportSession` interface (line ~16) + `importSessionId: string`
    field on `Position` (~35), `ClosedPosition` (~50), `Transaction` (~62),
    `PortfolioSnapshot` (~76).
  - `src/lib/state.ts` — `importSessions: ImportSession[]` on `AppState` (~20),
    `initialState()` seed `importSessions: []` (~56), the `AppState` destructure at
    ~113, `addImportSession` (~275) and `deleteImportSession` (~286-293) helper
    functions.
  - `src/lib/reducer.ts` — `ADD_IMPORT_SESSION` case (~87-88) and
    `DELETE_IMPORT_SESSION` case (~90-91). Also note: the `IMPORT_POSITIONS`
    (~82) and `IMPORT_TRANSACTIONS` (~85) cases forward `action.importSessionId`
    into `importPositions`/`importTransactions` — those two reducer cases stay,
    only the `importSessionId` arg goes away (positional param, see below).
  - `src/lib/positionsImport.ts` — `importSessionId: string` param (~24) on
    `importPositions(...)`, and it's stamped onto every created `Position` (~68),
    `ClosedPosition` (~115), and `PortfolioSnapshot` (~141).
  - `src/lib/transactionsImport.ts` — `importSessionId: string` param (~42) on
    `importTransactions(...)`, stamped onto every created `Transaction` (~81).
  - `src/components/import/ImportDialog.tsx` — generates `const importSessionId
    = uid('import')` (~384) and passes it in both the `IMPORT_POSITIONS` (~394)
    and `IMPORT_TRANSACTIONS` (~402) dispatch payloads. **Finding**: ImportDialog
    never dispatches `ADD_IMPORT_SESSION` — the actual session *record* is only
    ever created by `App.tsx`'s `processPendingImport` helper, which itself has
    **zero real call sites** outside `App.test.tsx` (grepped `processPendingImport(`
    across `src/**/*.tsx` — only the definition, its export, and 7 calls in
    `App.test.tsx`). In the running app, `state.importSessions` is always `[]`;
    the Import Sessions tab has never actually populated in production use. This
    makes the removal lower-risk than it looks (no live behavior/data-loss
    concern), but doesn't reduce the number of files touched.
  - `src/App.tsx` — `import { initialState, addImportSession } from './lib/state'`
    (~3), `import type { ImportSession } from './lib/types'` (~15),
    `processPendingImport` function definition (~32-67) and its `export {
    processPendingImport }` (~380).
  - `src/lib/persist.ts` — **not in the original task list, found by grep**:
    `coalesceWithDefaults()` has `importSessions: loaded.importSessions ??
    defaults.importSessions` (~54). Must be deleted or `AppState`/`initialState()`
    changes will make this a type error (property doesn't exist on the narrowed
    type once `ImportSession`/`importSessions` are gone from `state.ts`).
  - Test files referencing `importSession`/`ImportSession`/`processPendingImport`
    (all need edits or deletion of specific cases, not whole-file deletion unless
    noted): `src/App.test.tsx`, `src/components/import/ImportDialog.test.tsx`,
    `src/components/PositionGroupOverlay.test.tsx`, `src/components/
    AssetClassOverrideSelect.test.tsx` (one fixture field, line ~11), `src/
    components/Settings.test.tsx`, `src/lib/persist.test.ts` (lines ~132, ~267-288,
    ~441, ~486-512), `src/lib/positionsImport.test.ts`, `src/lib/
    transactionsImport.test.ts`, `src/lib/state.test.ts`, `src/lib/reducer.test.ts`
    (check for `ADD_IMPORT_SESSION`/`DELETE_IMPORT_SESSION` cases — verify file
    exists/has cases in Task 6).
  - **Pre-existing oddity, out of scope**: `src/components/Settings.test.tsx.bak`
    is a stray `.bak` file that is git-tracked (confirmed via `git ls-files`).
    Vitest doesn't pick up `.bak` files so it's inert, but it still contains
    `importSession`-referencing test code that will look stale/misleading after
    this plan lands. Not touched by this plan (not asked for) — flagged as a
    known repo wart for a future cleanup, not this one.

- `src/components/Settings.tsx` Accounts section: rendered inside `{activeTab
  === 'general' && ( ... )}` as a `<section className="card blueprint elev-sm">`
  block (~247-273) containing a `<table>` (or "No accounts yet." when empty)
  whose rows are the `AccountRow` sub-component (defined ~526-end of file,
  roughly 150 lines: local `isEditingName`/`editedName`/`isEditingAccountNumber`/
  `editedAccountNumber` state, `handleNameBlur`/`handleNameKeyDown`/
  `handleAccountNumberBlur`/`handleAccountNumberKeyDown`/`handleTaxCategoryChange`/
  `handleInstitutionChange`/`handleRetirementChange`/`handleDelete` handlers, and
  the `<tr>` JSX). `AccountRow` is used **only** from this one Accounts section
  — confirmed via grep, `<AccountRow` has exactly one call site. Deleting the
  Accounts section means the whole `AccountRow` function becomes dead code and
  must be deleted too (not just its call site) — otherwise TypeScript is fine
  (it'd just be an unused top-level function, which oxlint/tsc may or may not
  flag) but it's confusing dead weight the task explicitly wants gone
  ("Remove now-dead code this leaves behind").
  - `InstitutionSelect` is imported and used by `AccountRow` (~663) — but the
    task explicitly says do NOT touch `InstitutionSelect.tsx` itself, and it's
    still used elsewhere (`ImportDialog.tsx`'s new-account form) so the *import*
    of `InstitutionSelect` in `Settings.tsx` becomes dead once `AccountRow` is
    deleted and must be removed from `Settings.tsx`'s import list (leaving the
    file itself untouched).
  - `ADD_ACCOUNT`/`UPDATE_ACCOUNT`/`DELETE_ACCOUNT` reducer cases and their
    `state.ts` helpers (`addAccount`/`updateAccount`/`deleteAccount`) are NOT
    touched — `ADD_ACCOUNT` is still dispatched by `ImportDialog.tsx`'s
    new-account commit path (confirmed, `dispatch({ type: 'ADD_ACCOUNT', ... })`
    at `ImportDialog.tsx` ~380).

- `src/components/Settings.tsx` tab structure: currently a `.seg` row (~223-236)
  with two tab options, `activeTab` local `useState<'general' |
  'importSessions'>('general')` (~33). After removing the Import Sessions tab
  there is exactly one tab left (General) — per the task's own framing, the
  cleanest move is to delete the `.seg` tab-selector UI entirely and the
  `activeTab` state, and just always render what was the General-tab content
  unconditionally (no `{activeTab === 'general' && (...)}` wrapper needed either).
  This plan takes that approach (delete the selector + state, unwrap the
  General content) rather than keeping a single dead tab.

- `src/components/PositionsTable.tsx`:
  - Header: `<th style={{ textAlign: 'right' }}>Accounts</th>` at line ~290.
    Blank-header precedent already in the codebase: `ClosedPositionsTable.tsx`
    line 31 uses `<th style={{ textAlign: 'right', width: '40px' }}></th>` for
    an unlabeled action column. This plan uses `<th style={{ textAlign: 'right'
    }}></th>` (keep the alignment style, just empty the label, no need to add
    `width` — the task didn't ask for a width change and the column isn't an
    icon-button column).
  - Aggregate computation: `const accountCount = new Set(groupPositions.map((p)
    => p.accountId)).size` at line ~95, included in the returned aggregate row
    object at ~109 as `accountCount,`, and rendered at ~319 as `<span
    className="tag tag-neutral">{row.accountCount}</span>`. The aggregate row's
    TypeScript type declares `accountCount: number` at line ~41. Renaming to
    `rowCount` (per the task's suggestion) for clarity since it no longer means
    "distinct accounts" — change is: type field (~41), computation (~95, drop
    the `new Set(...).size`, use `groupPositions.length`), object literal key
    (~109), and the render (~319). All four must use the same new name.

## Decisions locked (from task — do not re-litigate)

- Settings page ends up with a single unconditional "General" section (no tab
  selector at all), containing Google Drive Sync then Change Password (Accounts
  section removed, nothing replaces it).
- `ImportSession` type, `AppState.importSessions`, `addImportSession`/
  `deleteImportSession`, `ADD_IMPORT_SESSION`/`DELETE_IMPORT_SESSION`,
  `importSessionId` field on all 4 domain types, and `processPendingImport` are
  fully deleted, not deprecated/hidden.
- `ADD_ACCOUNT`/`UPDATE_ACCOUNT`/`DELETE_ACCOUNT` action types and their
  `state.ts` helpers are NOT removed (still used by `ImportDialog.tsx`).
- `InstitutionSelect.tsx` is NOT touched.
- PositionsTable's last column keeps its position/styling, only the header
  text goes blank and the badge's underlying number changes from distinct
  account count to total underlying-position-row count in the group. Renamed
  to `rowCount` throughout `PositionsTable.tsx` and its test file.

## Tasks

### Task 0 — Create git worktree

Make an isolated worktree so this work doesn't collide with other in-flight
changes on `main`.

```
git worktree add ../worktree-settings-cleanup -b settings-cleanup/remove-import-sessions
cd ../worktree-settings-cleanup
npm install
```

- Depends on: none.
- Test cases: none (setup task).
- Acceptance: `../worktree-settings-cleanup` exists, `npm install` completes,
  `npm run test` passes on the unmodified checkout (baseline green before any
  edits — if it's not green here, stop and flag it, don't build on a red
  baseline).

### Task 1 — `src/lib/types.ts`: remove `ImportSession` type + `importSessionId` fields

Remove the whole `ImportSession` interface (~line 16). Remove the
`importSessionId: string` field from `Position`, `ClosedPosition`,
`Transaction`, and `PortfolioSnapshot` interfaces (4 removals total).

No other file touched in this task — this intentionally breaks the build at
every call site that still references `ImportSession` or sets
`importSessionId`. That's expected; Tasks 2-7 fix each site. Don't run
`npm run build`/`npm run test` until Task 8.

- Depends on: Task 0.
- Test cases: none (type-only change, no runtime behavior to test yet).
- Acceptance: `ImportSession` no longer exported from `types.ts`; grep for
  `importSessionId` in `types.ts` returns nothing. Diff touches only this file.

### Task 2 — `src/lib/state.ts`: remove `importSessions` state + helpers

Depends on: Task 1.

Changes:
1. Remove `ImportSession` from the `import type { ... } from './types'` list.
2. Remove `importSessions: ImportSession[]` from the `AppState` interface.
3. Remove `importSessions: []` from `initialState()`.
4. Remove `importSessions: state.importSessions` if present in any object-spread
   return inside other helpers (check the ~113 destructure/spread context found
   in exploration — likely just needs the field deleted from whatever object
   literal it's part of, not a functional change to that helper's logic).
5. Delete `addImportSession(...)` function entirely (~275-283).
6. Delete `deleteImportSession(...)` function entirely (~286-294) — note this
   function currently also does cascade-filtering of positions/closedPositions/
   transactions/snapshots by `importSessionId`; that cascade behavior is not
   needed anywhere else (account cascade delete filters by `accountId` directly,
   confirmed in Task 4/design.md, not by session), so this is a clean delete,
   not a partial-extract.

- Test cases: none new here — `state.test.ts` fixes land in Task 6.
- Acceptance: `state.ts` has no `importSessions`/`ImportSession`/
  `addImportSession`/`deleteImportSession` references (grep confirms zero).

### Task 3 — `src/lib/reducer.ts`: remove `ADD_IMPORT_SESSION`/`DELETE_IMPORT_SESSION` cases

Depends on: Task 2.

Delete the `case 'ADD_IMPORT_SESSION':` block (~87-88) and the
`case 'DELETE_IMPORT_SESSION':` block (~90-91) entirely. Leave `IMPORT_POSITIONS`
(~82) and `IMPORT_TRANSACTIONS` (~85) cases in place for now — their
`action.importSessionId` argument gets dropped in Task 4 when the underlying
`importPositions`/`importTransactions` function signatures change; don't edit
the reducer's call expression until that task so the two edits (function
signature + call site) land together and stay easy to verify.

- Test cases: none new here — `reducer.test.ts` fixes (if that file exists and
  has cases for these two actions) land in Task 6.
- Acceptance: grep for `IMPORT_SESSION` in `reducer.ts` returns nothing.

### Task 4 — `src/lib/positionsImport.ts` and `src/lib/transactionsImport.ts`: drop `importSessionId` param and stamping

Depends on: Task 3.

`positionsImport.ts`:
- Remove `importSessionId: string` from `importPositions(...)`'s parameter list
  (~24).
- Remove the `importSessionId,` key from the `Position` object literal (~68),
  the `ClosedPosition` object literal (~115), and the `PortfolioSnapshot`
  object literal (~141).

`transactionsImport.ts`:
- Remove `importSessionId: string` from `importTransactions(...)`'s parameter
  list (~42).
- Remove the `importSessionId,` key from the `Transaction` object literal (~81).

`reducer.ts` (finish what Task 3 deferred):
- Update the `IMPORT_POSITIONS` case call to `importPositions(state,
  action.accountId, action.mappedRows, action.importDate)` (drop the trailing
  `action.importSessionId` arg).
- Update the `IMPORT_TRANSACTIONS` case call to `importTransactions(state,
  action.accountId, action.mappedRows)` (drop the trailing `action.importSessionId`
  arg).

- Test cases: none new here — `positionsImport.test.ts`/`transactionsImport.test.ts`
  fixes land in Task 6.
- Acceptance: grep for `importSessionId` across `positionsImport.ts`,
  `transactionsImport.ts`, `reducer.ts` returns nothing. Function signatures
  have one fewer parameter each.

### Task 5 — `src/components/import/ImportDialog.tsx` and `src/App.tsx`: drop `importSessionId` generation, `processPendingImport`

Depends on: Task 4.

`ImportDialog.tsx`:
- Remove `const importSessionId = uid('import')` (~384).
- Remove the `importSessionId,` key from the `IMPORT_POSITIONS` dispatch
  payload (~394) and the `IMPORT_TRANSACTIONS` dispatch payload (~402).
- If removing this leaves `uid` imported-but-unused for any other reason, check
  — `uid` is also used elsewhere in this file for `uid('acc')` (new-account id,
  confirmed at ~373), so the import stays; only the one call site goes.

`App.tsx`:
- Remove `import { initialState, addImportSession } from './lib/state'` →
  becomes `import { initialState } from './lib/state'` (keep `initialState`,
  drop only `addImportSession`).
- Remove `import type { ImportSession } from './lib/types'` (~15) entirely (no
  other type from that import is needed — confirm no other named type is bundled
  in that same import statement before deleting the whole line; if it is a
  multi-type import, only drop `ImportSession` from the list).
- Delete the `processPendingImport` function definition (~32-67) including its
  doc comment.
- Delete `export { processPendingImport }` (~380).

- Test cases: none new here — `App.test.tsx`/`ImportDialog.test.tsx` fixes land
  in Task 6.
- Acceptance: grep for `importSessionId`/`processPendingImport`/`ImportSession`
  in `ImportDialog.tsx` and `App.tsx` returns nothing.

### Task 6 — `src/lib/persist.ts`: drop `importSessions` from hydration defaults

Depends on: Task 2 (needs `AppState` to no longer have `importSessions` so this
is a real fix, not a speculative one).

Remove the `importSessions: loaded.importSessions ?? defaults.importSessions,`
line (~54) from `coalesceWithDefaults()`.

- Test cases: none new here — `persist.test.ts` fixes land in Task 7.
- Acceptance: grep for `importSessions` in `persist.ts` returns nothing.

### Task 7 — Fix/remove all test references to the removed import-session code

Depends on: Task 6 (all production code must be settled first so tests aren't
chasing a moving target).

Go file by file (all found in exploration grep) and remove/update the specific
test cases, not the whole file, unless a whole file's *only* purpose was
import-session behavior:

- `src/lib/state.test.ts` — remove any `describe`/`it` blocks for
  `addImportSession`/`deleteImportSession`; remove `importSessions` from any
  `initialState()`/`AppState` fixture object literals.
- `src/lib/reducer.test.ts` (if it exists — confirm first with `ls
  src/lib/reducer.test.ts`) — remove `ADD_IMPORT_SESSION`/`DELETE_IMPORT_SESSION`
  test cases if present.
- `src/lib/positionsImport.test.ts` — remove `importSessionId` from test
  fixtures/args passed to `importPositions(...)`; remove any assertion checking
  `.importSessionId` on the result.
- `src/lib/transactionsImport.test.ts` — same, for `importTransactions(...)`.
- `src/lib/persist.test.ts` — remove `importSessions: []` / `importSessions:
  [...]` from fixture objects (~132, ~270, ~441); delete or rewrite the
  `'round-trips populated importSessions and non-default view'` test (~267-288)
  — since `importSessions` no longer exists, keep the "non-default view"
  round-trip coverage but drop the importSessions half (rename test if needed,
  e.g. `'round-trips non-default view'`); delete or rewrite `'loads missing
  importSessions and view with defaults'` (~486-512) similarly — keep the
  "missing view defaults" coverage, drop the importSessions assertion (~501).
- `src/components/AssetClassOverrideSelect.test.tsx` — remove the
  `importSessionId: 'sess-1'` line (~11) from whatever position fixture it's
  part of.
- `src/App.test.tsx` — delete every test that calls `processPendingImport(...)`
  (7 call sites found: lines ~105, ~152, ~199, ~235, ~281, ~311, ~321) — these
  are entire test cases (e.g. "logs an import session", "caps at 50", etc.),
  not just isolated lines; read each surrounding `it(...)` block and delete the
  whole block. If any of these blocks also incidentally test something still
  relevant (e.g. general import-commit dispatch behavior unrelated to sessions),
  flag it instead of silently deleting — but based on the function's sole
  purpose (building/logging an `ImportSession`), expect all 7 to be pure
  session-logging tests safe to delete outright.
- `src/components/import/ImportDialog.test.tsx` — remove any assertion that
  checks a dispatched action's `importSessionId` field, or that
  `uid('import')` was called for a session id. Import-commit tests should still
  assert the `IMPORT_POSITIONS`/`IMPORT_TRANSACTIONS` dispatch happens, just
  without an `importSessionId` field in the expected payload.
- `src/components/PositionGroupOverlay.test.tsx` — remove `importSessionId`
  from position fixtures.
- `src/components/Settings.test.tsx` — remove any Import-Sessions-tab test
  cases (tab switch, session list render, delete-session dialog) — this
  overlaps with Task 9's Settings.tsx UI removal, but do the test-side cleanup
  here so Task 7 leaves the whole `importSession` grep clean across `src/`
  test files; Task 9 will do the parallel Accounts-section test removal
  separately since that's an unrelated section of the same file.

- Test cases: this task's own "test" is verification — after edits,
  `grep -rli "importsession" src/` must return **zero** files (the `.bak` file
  is git-tracked but per the Facts section is explicitly left alone — confirm
  it's still the *only* remaining hit, or if it truly returns zero because
  `.bak` isn't matched by whatever glob you use, that's fine too, just don't
  edit it).
- Acceptance: `grep -rli "importsession" src/*.ts src/**/*.ts src/**/*.tsx`
  (excluding `.bak`) returns nothing. `npx vitest run src/lib/state.test.ts
  src/lib/reducer.test.ts src/lib/positionsImport.test.ts
  src/lib/transactionsImport.test.ts src/lib/persist.test.ts
  src/components/AssetClassOverrideSelect.test.tsx src/App.test.tsx
  src/components/import/ImportDialog.test.tsx
  src/components/PositionGroupOverlay.test.tsx` all pass (Settings.test.tsx
  verified in Task 9 once its own edits land, since it has unrelated
  in-flight changes).

### Task 8 — `src/components/Settings.tsx`: remove Import Sessions tab + tab selector entirely

Depends on: Task 7 (all underlying `state.importSessions` data is gone by now,
so this UI removal doesn't need to coexist with dead data).

- Delete the `{activeTab === 'importSessions' && ( ... )}` block (~460 onward)
  — the whole Import Sessions section/table.
- Delete the `.seg` tab-selector JSX (~223-236) that renders the General/Import
  Sessions radio buttons.
- Delete `const [activeTab, setActiveTab] = useState<'general' |
  'importSessions'>('general')` (~33).
- Unwrap the General-tab content: remove the `{activeTab === 'general' && (
  <>...</> )}` wrapper (~245 onward) so its children (Accounts section — until
  Task 9 removes it, Google Drive Sync, Change Password) render unconditionally.
- Leave the Accounts section itself alone in this task — Task 9 handles it
  separately so each task's diff stays reviewable as one concern.

- Test cases:
  - Settings page renders with no tab selector visible (no "General"/"Import
    Sessions" `.seg` radios in the DOM).
  - Settings page renders Google Drive Sync and Change Password sections
    unconditionally (no tab-click needed to see them).
- Acceptance: `grep -n "importSessions\|Import Sessions\|activeTab" src/components/Settings.tsx`
  returns nothing. `npx vitest run src/components/Settings.test.tsx` — expect
  failures here still from the now-stale Accounts-section tests and any
  tab-related assertions Task 7 didn't already remove; that's expected, Task 9
  finishes the Settings.test.tsx cleanup. Don't chase Settings.test.tsx to fully
  green in this task.

### Task 9 — `src/components/Settings.tsx`: remove Accounts section + `AccountRow` + fix Settings.test.tsx

Depends on: Task 8.

- Delete the Accounts `<section className="card blueprint elev-sm">` block
  (~247-273 pre-Task-8-line-numbers; re-locate after Task 8's edits) — the
  "No accounts yet." / accounts `<table>` with `AccountRow` rows.
- Delete the entire `AccountRow` function (~526 to end-of-function, roughly 150
  lines) — confirmed single call site (the section just deleted), safe to
  delete in full including its local state/handlers
  (`isEditingName`/`editedName`/`isEditingAccountNumber`/`editedAccountNumber`,
  `handleNameBlur`/`handleNameKeyDown`/`handleAccountNumberBlur`/
  `handleAccountNumberKeyDown`/`handleTaxCategoryChange`/
  `handleInstitutionChange`/`handleRetirementChange`/`handleDelete`).
- Remove the now-unused `import { InstitutionSelect } from './InstitutionSelect'`
  line from `Settings.tsx` (do NOT touch `InstitutionSelect.tsx` itself).
- Check whether `import type { TaxCategory } from '../lib/types'` becomes
  unused once `AccountRow`'s `handleTaxCategoryChange` (which used
  `TaxCategory`) is deleted — grep the rest of `Settings.tsx` for `TaxCategory`
  after the deletion; remove the import only if genuinely unused elsewhere in
  the file.
- `src/components/Settings.test.tsx`: remove every test case covering the
  Accounts section (rendering account rows, click-to-edit account
  number/name, institution change, tax category change, retirement checkbox,
  delete-account confirm dialog). Keep Drive-sync and Change-Password test
  coverage untouched.

- Test cases:
  - Settings page renders with no "Accounts" heading/table in the DOM.
  - Settings page with `state.accounts` populated does not render any account
    rows or delete buttons.
- Acceptance: `grep -n "AccountRow\|Accounts</h2>\|No accounts yet" src/components/Settings.tsx`
  returns nothing. `npx vitest run src/components/Settings.test.tsx` passes
  fully (green, not just "expected failures" like Task 8).

### Task 10 — `src/lib/reducer.ts`/`src/lib/state.ts` sanity check: `ADD_ACCOUNT`/`UPDATE_ACCOUNT`/`DELETE_ACCOUNT` untouched

Depends on: Task 9.

Pure verification task, no edits expected:
- Confirm `ADD_ACCOUNT`, `UPDATE_ACCOUNT`, `DELETE_ACCOUNT` still exist in
  `reducer.ts`'s action-type list and `state.ts`'s `addAccount`/`updateAccount`/
  `deleteAccount` helpers are unchanged.
- Confirm `ImportDialog.tsx`'s new-account commit path (`dispatch({ type:
  'ADD_ACCOUNT', account: newAccount })`) still works — run
  `npx vitest run src/components/import/ImportDialog.test.tsx` and confirm the
  new-account creation tests still pass (they should be untouched by this plan,
  this is just confirming Task 8/9's edits to a *different* file didn't
  regress this one).

- Test cases: `npx vitest run src/components/import/ImportDialog.test.tsx`
  green.
- Acceptance: no code changes in this task; if anything is broken, that's a
  signal Task 8 or 9 over-deleted something and must be fixed before
  continuing — do not proceed to Task 11 on a red run here.

### Task 11 — `src/components/PositionsTable.tsx`: blank header + `accountCount` → `rowCount`

Depends on: Task 0 (independent of the import-session removal work — can
actually run in parallel with Tasks 1-10 if using separate agents, but listed
sequentially here since this is a single-plan document; no shared files with
Tasks 1-10).

- Line ~41: rename the aggregate row type's `accountCount: number` field to
  `rowCount: number`.
- Line ~95: replace `const accountCount = new Set(groupPositions.map((p) =>
  p.accountId)).size` with `const rowCount = groupPositions.length`.
- Line ~109: rename the object-literal key from `accountCount,` to `rowCount,`.
- Line ~290: change `<th style={{ textAlign: 'right' }}>Accounts</th>` to
  `<th style={{ textAlign: 'right' }}></th>` (blank label, same alignment
  style, matching the blank-header convention already used in
  `ClosedPositionsTable.tsx` line 31).
- Line ~319: change `<span className="tag tag-neutral">{row.accountCount}</span>`
  to `<span className="tag tag-neutral">{row.rowCount}</span>`.
- Grep the file afterward for `accountCount` to confirm zero remaining
  references.

- Test cases (`PositionsTable.test.tsx`):
  - A group with 3 positions across 2 distinct accounts (e.g. 2 positions in
    account A, 1 in account B) now shows the badge as `3` (total row count),
    not `2` (old distinct-account behavior) — this is the core behavior-change
    assertion, replace/update whatever test currently asserts the old `2`.
  - A group with 1 underlying position shows badge `1` (unchanged either way,
    but confirms no off-by-one in the new computation).
  - The header row no longer contains the text "Accounts" (assert absence, or
    assert the relevant `<th>`'s `textContent` is empty string).
- Acceptance: `npx vitest run src/components/PositionsTable.test.tsx` passes.
  `grep -n "accountCount\|>Accounts<" src/components/PositionsTable.tsx
  src/components/PositionsTable.test.tsx` returns nothing.

### Task 12 — `src/lib/state.ts`: add `closePosition` helper (new feature — delete position from overlay)

Depends on: Task 9 (by here, `ImportSession`/`importSessionId` removal is fully
done — including the field being gone from `ClosedPosition` in `types.ts` since
Task 1 — so the `ClosedPosition` object literal built here needs no
`importSessionId` key and there's zero risk of building against a stale type.
Not dependent on Task 11 — unrelated file, no shared code).

This is a new feature, unrelated to the import-session removal / rowCount
rename above: let the user delete a position row from `PositionGroupOverlay`.
Per the resolved requirements: this is NOT a hard delete — it converts the
`Position` into a `ClosedPosition` (same shape convention as the automatic
close-on-reimport path in `positionsImport.ts`, just without that path's
transaction-matching heuristic, since there's no Sell transaction to match for
a manual UI delete).

Add a new exported function in `state.ts`, next to `updatePosition`/
`deleteClosedPosition` (~line 126-147):

```ts
export function closePosition(state: AppState, positionId: string): AppState {
  const position = state.positions.find((p) => p.id === positionId)
  if (!position) return state
  const closed: ClosedPosition = {
    id: uid('closed'),
    accountId: position.accountId,
    symbol: position.symbol,
    name: position.name,
    closedDate: new Date().toISOString().slice(0, 10),
    assetClass: position.assetClassManualOverride || position.assetClass,
    realizedGL: null,
    realizedGLBasis: 'unknown',
  }
  return {
    ...state,
    positions: state.positions.filter((p) => p.id !== positionId),
    closedPositions: [...state.closedPositions, closed],
  }
}
```

Notes on exact shapes used (confirmed by reading the current code, not
guessed):
- `position.assetClassManualOverride || position.assetClass` is the
  "effective asset class" pattern used verbatim in 6+ other places in this
  codebase (`computations.ts` ~92, `selectors.ts` ~34/~237,
  `AssetClassOverrideSelect.tsx` ~20, `PositionsTable.tsx` ~22/~101/~129) —
  there is no shared extracted helper for this, every call site inlines the
  `||`. Match that convention here; do not create a new shared helper as part
  of this task (out of scope, would touch unrelated files).
- `uid('closed')` — `uid` is already imported in `state.ts` (used by other
  helpers), one-arg-prefix convention matches `uid('closed')` style used
  nowhere yet for this collection but consistent with `uid('acc')`/
  `uid('import')` elsewhere in the codebase; any short unique prefix is fine,
  use `'closed'`.
- Missing-id case (`position` not found) returns `state` unchanged — a
  defensive no-op, consistent with how `.filter()`-based helpers in this file
  already no-op silently on a non-matching id (e.g. `deleteClosedPosition`
  with an unknown id just filters nothing out).
- Single atomic object literal return — both the `positions` removal and the
  `closedPositions` append happen in one state transition, not two chained
  dispatches (per the resolved requirement: "This must be a single atomic
  state transition").

- Test cases: none new here — `state.ts` tests for `closePosition` land in
  Task 14.
- Acceptance: `closePosition` is exported from `state.ts` with the signature
  `(state: AppState, positionId: string): AppState`; `npx tsc -b` on this file
  in isolation shows no new type errors (`ClosedPosition` import already
  present in `state.ts`'s type-import list — confirm, add if missing).

### Task 13 — `src/lib/reducer.ts`: add `CLOSE_POSITION` action case

Depends on: Task 12.

Add a new case, near the existing Position-management cases (`UPDATE_POSITION`
~32, `SET_ASSET_CLASS_OVERRIDE` ~35, `DELETE_CLOSED_POSITION` ~40):

```ts
case 'CLOSE_POSITION':
  return StateActions.closePosition(state, action.positionId)
```

Action shape dispatched by callers: `{ type: 'CLOSE_POSITION', positionId: string }`.
Chosen action name is `CLOSE_POSITION` (not `DELETE_POSITION`) — matches the
actual semantics (convert to closed, not remove), matches the state helper's
name `closePosition`, and avoids confusion with the existing hard-delete
action `DELETE_CLOSED_POSITION` which operates on the *other* collection.
Use `CLOSE_POSITION` consistently everywhere in the remaining tasks (reducer
case, dispatch call site in `PositionGroupOverlay.tsx`, test assertions, docs)
— do not introduce a second name for the same thing.

- Test cases: none new here — `reducer.ts` tests for `CLOSE_POSITION` land in
  Task 14.
- Acceptance: `grep -n "CLOSE_POSITION" src/lib/reducer.ts` shows exactly one
  case block calling `StateActions.closePosition`.

### Task 14 — `src/lib/state.test.ts` + `src/lib/reducer.test.ts`: tests for `closePosition`/`CLOSE_POSITION`

Depends on: Task 13.

`state.test.ts` — add a `describe('closePosition', ...)` block:
- Happy path: state with one `Position` (fixture with `accountId`, `symbol`,
  `name`, `assetClass`, `assetClassManualOverride: undefined`) → after
  `closePosition(state, position.id)`, `positions` is empty and
  `closedPositions` has length 1 with `accountId`/`symbol`/`name` matching the
  original position, `realizedGL: null`, `realizedGLBasis: 'unknown'`,
  `closedDate` matching `new Date().toISOString().slice(0, 10)` (today, use a
  fixed/mocked date or just assert format `YYYY-MM-DD` + assert it equals
  `new Date().toISOString().slice(0, 10)` computed in the test itself to avoid
  flakiness across a midnight boundary).
- Effective-asset-class case: position has both `assetClass: 'Equity'` and
  `assetClassManualOverride: 'Bond'` set → resulting `ClosedPosition.assetClass`
  is `'Bond'` (the override wins), not `'Equity'`.
- Existing-closedPositions-preserved case: state already has one unrelated
  `ClosedPosition` in `closedPositions` → after closing a different position,
  `closedPositions` has length 2, original entry untouched.
- Missing-id case: `closePosition(state, 'nonexistent-id')` returns `state`
  unchanged (`positions` and `closedPositions` arrays are the same content/
  length as before — reference equality not required, just value equality).

`reducer.test.ts` (confirm file exists first — Task 7 already checked this
once; if it still doesn't exist, add this coverage as a `describe('CLOSE_POSITION
action', ...)` inside `state.test.ts` instead and note the substitution in the
commit message):
- `appReducer(state, { type: 'CLOSE_POSITION', positionId: <id> })` produces
  the same result as calling `closePosition(state, <id>)` directly (thin
  dispatch-table pass-through, mirrors how other reducer cases are tested in
  this file).

- Test cases: listed above (5 total across both files, or folded into
  `state.test.ts` if `reducer.test.ts` doesn't exist).
- Acceptance: `npx vitest run src/lib/state.test.ts src/lib/reducer.test.ts`
  (or just `state.test.ts` if the other doesn't exist) passes, all new cases
  green.

### Task 15 — `src/components/PositionGroupOverlay.tsx`: add delete-position column

Depends on: Task 13 (needs the `CLOSE_POSITION` action to dispatch).

Add a 9th, right-most column to the overlay's table (currently 8 columns:
Account, Symbol, Name, Shares, Avg Cost, Current Price, Taxes, Override — table
markup ~406-482):

- Header row (~406-415): add `<th style={{ textAlign: 'center' }}></th>` after
  the existing `<th style={{ textAlign: 'center' }}>Override</th>` — blank,
  icon-only column, matching the blank-header convention already used for
  action columns (`ClosedPositionsTable.tsx` line 31).
- Body row (~470-478, after the `AssetClassOverrideSelect` `<td>`): add a new
  `<td style={{ textAlign: 'center' }}>` containing a delete button, matching
  `ClosedPositionsTable.tsx`'s `handleDeleteClosedPosition` button
  (~55-75) as closely as possible:
  ```tsx
  <td style={{ textAlign: 'center' }}>
    <button
      onClick={() => handleDeletePosition(p.id)}
      className="btn-icon"
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: '4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--color-text-secondary)',
        transition: 'color 0.2s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = '#8a3c2e')}
      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-secondary)')}
      title="Delete this position"
    >
      <Trash size={16} />
    </button>
  </td>
  ```
- Add `import { Trash } from 'lucide-react'` to the top of the file (not
  currently imported here — confirm via grep before adding, avoid a duplicate
  import if it's already pulled in for some other reason).
- Add a handler function inside the component (or at module scope taking
  `dispatch` as a param, matching whatever style `AccountDropdown`/other
  in-file helpers already use — check the file's existing pattern for
  handlers that need `dispatch` before picking):
  ```ts
  const handleDeletePosition = (positionId: string) => {
    const confirmed = window.confirm(
      'Delete this position? It will be moved to Closed Positions.'
    )
    if (confirmed) {
      dispatch({ type: 'CLOSE_POSITION', positionId })
    }
  }
  ```
- No special "close the overlay" or "remove this row from local state" logic
  needed — per the resolved requirement, once the position is gone from
  `state.positions`, it naturally disappears from `computedPositions`/the
  row list on next render, same side-effect pattern already documented for
  Symbol/Account edits changing a position's group key.

- Test cases: none new here — `PositionGroupOverlay.test.tsx` coverage lands
  in Task 16.
- Acceptance: overlay renders 9 columns (one blank trailing header); each row
  has a trash-icon button; clicking it without confirming (mock
  `window.confirm` to return `false`) does not dispatch; clicking it and
  confirming (mock returns `true`) dispatches exactly
  `{ type: 'CLOSE_POSITION', positionId: <that row's id> }`.

### Task 16 — `src/components/PositionGroupOverlay.test.tsx`: tests for delete column

Depends on: Task 15.

Add test cases (mock `window.confirm` per-test with `vi.spyOn(window,
'confirm')`, mirroring however `ClosedPositionsTable.test.tsx` already mocks
it for its own delete-button tests — check that file first and match its
mocking style exactly rather than inventing a new one):

- Renders a 9th column: table has 9 `<th>` elements, the last one's
  `textContent` is empty string.
- Renders a trash-icon delete button in each row (one per position in the
  group).
- Clicking delete + confirming dispatches `{ type: 'CLOSE_POSITION',
  positionId: <id of the clicked row's position> }` exactly once.
- Clicking delete + cancelling (`window.confirm` mocked to return `false`)
  does not dispatch anything.
- Multi-row group: deleting one row's position only dispatches with that
  row's `positionId`, not another row's.

- Test cases: listed above (5 total).
- Acceptance: `npx vitest run src/components/PositionGroupOverlay.test.tsx`
  passes, all new cases green, no regressions in the file's existing cases
  (Task 7 already touched this file for `importSessionId` fixture cleanup —
  confirm those edits are still intact and unaffected).

### Task 17 — Update reference docs: `product-behavior.md`

Depends on: Task 9, Task 11, Task 16 (needs the final shape of Settings.tsx,
PositionsTable.tsx, AND the new PositionGroupOverlay delete column to describe
accurately).

Per `CLAUDE.md`'s Reference Docs rule ("Auto-update after every change" — not
optional, required regardless of explicit ask), edit
`/Users/mdoraiswamy/owa/portfolio/product-behavior.md`:

- **Settings page** section (~lines 91-100):
  - Remove "Two-tab structure via `.seg` radios: **General** (default) and
    **Import Sessions**. Tab state is a component-local `useState`... resets to
    General every time." Replace with a plain statement: single unconditional
    page, no tabs.
  - Remove the "**Accounts**:" bullet entirely from the General-tab description
    (the account-number/name/institution/tax-category/retirement/delete row
    list).
  - Update the section intro sentence ("General tab — Accounts section, then
    Google Drive Sync, then Change Password:") to drop "Accounts section,
    then" → becomes "Google Drive Sync, then Change Password:".
  - Delete the entire "**Import Sessions tab** (unchanged behavior): ..."
    paragraph (~line 100).
- **Positions table** section (~line 45): update the columns bullet's last
  clause — "Account count badge (right-aligned, `.tag.tag-neutral`, showing
  count of distinct accounts in the group; column header is blank)" is already
  half-correct (header blank was the *target* state, not current — verify
  current wording first, it may currently say "column header reads 'Accounts'"
  or similar depending on doc drift) → update to: "Row-count badge
  (right-aligned, `.tag.tag-neutral`, showing count of underlying position rows
  merged into the aggregate group; column header is blank)."
- **PositionGroupOverlay** description (same paragraph as the "Row click →
  overlay" bullet, ~line 47): change "**Overlay columns** (8): Account,
  Symbol, Name, Shares, Avg Cost, Current Price, Taxes, Override." to
  "**Overlay columns** (9): Account, Symbol, Name, Shares, Avg Cost, Current
  Price, Taxes, Override, Delete." Add a new sentence describing the delete
  column: "**Delete column**: blank header, trash-icon button per row;
  clicking prompts `window.confirm('Delete this position? It will be moved to
  Closed Positions.')`; on confirm, dispatches `CLOSE_POSITION` which converts
  the position into a `ClosedPosition` (`realizedGL: null`,
  `realizedGLBasis: 'unknown'`, `closedDate` = today) rather than hard-deleting
  it — the row then disappears from the overlay on next render as a natural
  consequence of no longer being in `state.positions` (same side-effect
  pattern as editing Symbol/Account)."

- Test cases: none (doc-only task).
- Acceptance: re-read the full `product-behavior.md` file after editing (per
  CLAUDE.md's "Full-file review after major changes" rule) — confirm no
  remaining mentions of "Import Sessions", "ImportSession", account
  list/edit/delete UI in Settings, or "distinct accounts" language in the
  Positions table section. Confirm doc still reads terse/structured, no
  narrative bloat introduced.

### Task 18 — Update reference docs: `design.md`

Depends on: Task 9, Task 11, Task 16 (same reason as Task 17 — needs final
shape of Settings.tsx, PositionsTable.tsx, and the new PositionGroupOverlay
delete column).

Edit `/Users/mdoraiswamy/owa/portfolio/design.md`:

- **Directory structure** section: update the `Settings.tsx` comment line
  (~45) from `# 2 tabs via .seg (local activeTab): General (Accounts, Google
  Drive Sync + cross-password restore prompt, Change Password) / Import
  Sessions` to something like `# single page, no tabs: Google Drive Sync +
  cross-password restore prompt, Change Password`.
- **State management → AppState interface** code block (~lines 62-87): remove
  `importSessions: ImportSession[]` from the `// Data collections` list; update
  the "(7)" collection count comment to "(6)".
- **State management** bullet list (~line 89): remove `addImportSession`,
  `deleteImportSession` from the helper-function list.
- **Action types (reducer.ts)** list (~line 95): remove `ADD_IMPORT_SESSION`,
  `DELETE_IMPORT_SESSION` from the comma-separated list.
- **Component tree** (~line 122): update the `SettingsPage` tree comment from
  `2 tabs via .seg (activeTab is local useState, not in AppState): General
  (Accounts, then Google Drive Sync incl. cross-password restore prompt, then
  Change Password) / Import Sessions` to `single page, no tabs: Google Drive
  Sync incl. cross-password restore prompt, then Change Password`.
- **Data flow → CSV import** numbered list (~lines 129-140): delete step 4,
  "**Session logging**: `processPendingImport(...)`..." entirely; renumber if
  the list is numbered sequentially (steps 1-3 stay, step 4 removed, no step 5
  exists per current doc so no renumbering needed beyond deletion — verify this
  when editing).
- Also in that same numbered list, step 3 "Commit" (~line 139) currently reads
  "...and fresh `uid('import')` `importSessionId` tagging every created row." —
  remove that clause since `ImportDialog.tsx` no longer generates or threads an
  `importSessionId`.
- **Key Invariants** section (~lines 165-169):
  - Delete the "**Import session tagging**: ..." bullet entirely.
  - Delete the "**Session cascade delete**: ..." bullet entirely.
  - Edit the "**Account cascade delete**: ..." bullet — remove the trailing
    clause "and `ImportSession`s (those with the account in
    `importSession.accountIds`)" so it ends at "...`SavedCsvMapping`s." (cascade
    by `accountId` for the remaining 5 collections is unaffected by this plan).
- **State management → AppState interface** code block: no field changes
  needed for the new feature (`closePosition` doesn't add a collection, it
  moves entries between two existing ones) — but update the **State
  management** bullet list (~line 89, same spot as the `addImportSession`/
  `deleteImportSession` removal above) to add `closePosition` to the
  helper-function list.
- **Action types (reducer.ts)** list (~line 95, same spot as the
  `ADD_IMPORT_SESSION`/`DELETE_IMPORT_SESSION` removal above): add
  `CLOSE_POSITION` to the comma-separated list.
- **Component tree** (~line 117, `PositionGroupOverlay` line): update "8-column
  table: Account ... Override (asset class)." to "9-column table: Account ...
  Override (asset class), Delete (trash-icon button, `window.confirm` then
  dispatches `CLOSE_POSITION`, converting the position to a `ClosedPosition`
  rather than removing it outright)." Also update the trailing sentence about
  Symbol/Account edits causing a row to disappear from the overlay — note that
  `CLOSE_POSITION` causes the same disappearance, for the same reason (row no
  longer present in `state.positions`).
- **Key Invariants** section: add one bullet documenting the new invariant,
  e.g. "**Position delete = close, not hard delete**: deleting a position from
  `PositionGroupOverlay` (`CLOSE_POSITION` action) converts it to a
  `ClosedPosition` with `realizedGL: null`, `realizedGLBasis: 'unknown'`
  (never transaction-matched, unlike the reimport-driven auto-close path in
  `positionsImport.ts`) — same target shape, different trigger and always-
  unknown basis."

- Test cases: none (doc-only task).
- Acceptance: re-read the full `design.md` file after editing (CLAUDE.md's
  "Full-file review after major changes" rule) — confirm no remaining mentions
  of `ImportSession`/`importSessionId`/`ADD_IMPORT_SESSION`/
  `DELETE_IMPORT_SESSION`/`processPendingImport`/"Import Sessions" tab
  anywhere in the file, and that the AppState code block, action-type list,
  and component tree all match the actual post-change code (including the new
  `closePosition`/`CLOSE_POSITION`/9-column overlay). Confirm doc stays
  terse/structured.

### Task 19 — Full test suite + build gate

Depends on: Task 17, Task 18 (all code + doc edits — both the import-session
removal work and the new delete-position feature — must be in before the
final gate, per CLAUDE.md: "commit it — but only once all tests pass ... and
all relevant reference docs are updated").

- Run `npm run test` (full vitest run, not per-file) — must be 100% green, zero
  skipped/broken tests left over from this plan's removals or additions.
- Run `npm run build` (tsc -b + vite build) — must succeed with zero type
  errors (this is the real proof that every `importSessionId`/`ImportSession`/
  `accountCount` reference was caught, not just the ones vitest happens to
  exercise, and that the new `closePosition`/`CLOSE_POSITION` code type-checks).
- Run `npm run lint` (oxlint) — must be clean (no new lint errors from unused
  imports like the `InstitutionSelect`/`TaxCategory` removals in Task 9, dead
  `uid` imports in Task 5, or an unused `Trash` import if Task 15's JSX ended
  up not using it).
- Final grep sweep: `grep -rli "importsession" src/ | grep -v '\.bak$'` must
  return nothing. `grep -rn "accountCount" src/components/PositionsTable.tsx
  src/components/PositionsTable.test.tsx` must return nothing.
  `grep -rn "CLOSE_POSITION" src/lib/reducer.ts src/lib/state.ts
  src/components/PositionGroupOverlay.tsx` must return at least one hit per
  file (confirms the new feature's wiring didn't get lost).

- Test cases: this task IS the test gate — no new test code, just running
  everything.
- Acceptance: `npm run test`, `npm run build`, `npm run lint` all exit 0. All
  three greps return the expected (empty / non-empty) results as specified
  above.

### Task 20 — Commit

Depends on: Task 19 (must be fully green first — no partial/doc-stale commits
per CLAUDE.md).

Stage all changed files (types.ts, state.ts, reducer.ts, positionsImport.ts,
transactionsImport.ts, App.tsx, ImportDialog.tsx, persist.ts, Settings.tsx,
PositionsTable.tsx, PositionGroupOverlay.tsx, all touched `*.test.ts`/
`*.test.tsx` files, product-behavior.md, design.md). Do not stage
`Settings.test.tsx.bak` (untouched, pre-existing, out of scope).

Commit message should explain the "why" in 1-2 sentences and cover both
pieces of work in this plan (e.g.: removing an import-session tracking
feature that was never actually reachable in the running app, simplifying
Settings to a single page, changing the Positions table's last column from a
distinct-account count to a total-row count for clearer aggregate-group
sizing, and adding the ability to delete a position from the group overlay
by converting it to a closed position).

- Test cases: none (git operation).
- Acceptance: `git status` shows a clean tree after commit (nothing untracked
  except the pre-existing `.bak` file, nothing unstaged). `git log -1` shows
  the new commit on the `settings-cleanup/remove-import-sessions` branch.

### Task 21 — Teardown worktree

Depends on: Task 20.

```
cd /Users/mdoraiswamy/owa/portfolio
git worktree remove ../worktree-settings-cleanup
```

- Test cases: none (teardown task).
- Acceptance: `git worktree list` no longer shows the removed worktree path.
  The `settings-cleanup/remove-import-sessions` branch still exists (worktree
  removal doesn't delete the branch) for the user to merge/PR from main repo.

## Test strategy summary

- Type-only removals (Task 1) are unverified by tests directly — verified
  transitively by `npm run build` succeeding in Task 19.
- Each production-code task (2-6, 8, 9, 11, 12, 13, 15) has its own narrow
  vitest target to run so failures are caught close to their cause, not all
  at once at the end.
- Task 7 is dedicated to catching every test-side reference the grep found —
  this is the task most likely to have a missed spot, since test fixtures
  duplicate shapes rather than importing types, so a stale `importSessionId:
  'x'` in a fixture object won't always fail to compile (only fails if the
  destination type is checked strictly) — rely on the grep sweep in Task 19 as
  the backstop, not just "tests pass."
- Tasks 14 and 16 cover the new delete-position feature end to end: state
  helper + reducer case (14), then UI + interaction (16) — same
  narrow-target-first philosophy as the import-session removal tasks.
- Task 19 is the hard gate: full `npm run test` + `npm run build` + `npm run
  lint` + three targeted greps, all must be clean before Task 20's commit.

## Risks / open questions

1. **`processPendingImport` was already effectively dead code** (no call site
   in the running app, only in tests) — confirmed via grep, documented in
   Facts section. This means removing it is safe from a "losing live user
   data" perspective, but it also means the Import Sessions tab in Settings
   has probably always shown "No imports yet." in real usage. Worth flagging
   to the user in case this contradicts their mental model of the feature
   ("wait, was this ever working?") — not a plan defect, just a surprising
   finding worth surfacing before/during implementation.
2. **`src/components/Settings.test.tsx.bak`** is a stray, git-tracked `.bak`
   file containing a full duplicate/old copy of Settings tests (1458 lines,
   including `importSession` references). It's inert (vitest won't run it) but
   will look increasingly stale after this plan. Left untouched per scope
   discipline — flagging in case the user wants a follow-up cleanup task.
3. **`reducer.test.ts` existence unconfirmed** — exploration didn't verify
   whether this file exists or has explicit `ADD_IMPORT_SESSION`/
   `DELETE_IMPORT_SESSION` test cases; Task 7 has a first-check step for this,
   but if the file doesn't exist at all, that sub-bullet is a no-op (not an
   error).
4. **Line numbers throughout this plan are from the current `main` checkout
   as of this writing** (2026-08-10) — they will drift as earlier tasks in
   this same plan edit these files. Every task re-locates its target lines by
   grep/content-match, not by trusting the line number literally; the numbers
   are there to help a human/agent find the spot fast, not as exact coordinates.
5. **`fileName` dispatch payload becomes partially vestigial**: `ImportDialog.tsx`
   dispatches `IMPORT_POSITIONS`/`IMPORT_TRANSACTIONS` with a `fileName` field
   (added originally to support `ImportSession.fileName`), but `reducer.ts`'s
   call into `importPositions`/`importTransactions` never actually forwards
   `action.fileName` into those functions — it was already unused by the
   import logic itself, only ever consumed by the (already-dead)
   `processPendingImport`. This plan does **not** remove `fileName` from the
   dispatch payload or type signatures since it wasn't named in the task's
   scope and removing it could ripple into `ImportDialog.tsx`'s local state
   (`fileName` is likely also used for the "file selected" UI display, not
   just the dispatch). Flagging as a small leftover dead field for the user's
   awareness — not addressed here.
6. **`CLOSE_POSITION` action name chosen over `DELETE_POSITION`** (Task 13) —
   picked to match the actual semantics (convert-to-closed, not remove) and
   the state helper's name (`closePosition`), and to avoid confusion with the
   pre-existing `DELETE_CLOSED_POSITION` action which hard-deletes from the
   *other* collection. Flagging in case the user has a strong preference for
   `DELETE_POSITION` instead — purely a naming choice, no behavior difference.
7. **Task 12 depends on Task 9** (full import-session removal chain, not just
   Task 1's `types.ts` edit) even though strictly only `types.ts` needs to
   have dropped `ClosedPosition.importSessionId` for Task 12's object literal
   to type-check. Chosen for safety/simplicity given this plan's tasks run
   sequentially in one worktree anyway — not a hard technical requirement,
   just avoids interleaving two independent workstreams' edits to the same
   files mid-flight.
8. **`closedDate` format**: uses `new Date().toISOString().slice(0, 10)`
   (`YYYY-MM-DD`), matching the format already used for `ClosedPosition.closedDate`
   elsewhere (confirmed against `ClosedPositionsTable.tsx`'s rendering of
   `cp.closedDate` as plain text with no reformatting, implying the stored
   format is already display-ready `YYYY-MM-DD` — same format this task
   produces). No open question here, just noting the format was verified
   against existing usage, not assumed.
9. **No test currently exists confirming `state.positions.find()`'s"not found"
   branch matches an established no-op convention elsewhere in `state.ts`** —
   Task 12's missing-id behavior (return `state` unchanged) is a reasonable
   default consistent with `.filter()`-based helpers' implicit no-op behavior,
   but there's no other `.find()`-based helper in this file to copy the exact
   pattern from. Low risk (defensive branch, not on the main happy path) but
   flagging since it's a design choice made without a direct precedent to
   point to.
