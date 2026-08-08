# Import Sessions and Settings Page

Caveman plan. Small tasks, each one thing, each with deps and tests. Read
top to bottom before starting task 1. No `plans/_template.md` exists in
repo (checked) — this plan follows the shape of `plans/unify-import-dialogs.md`
(closest prior art: Overview / Tasks w/ deps / Test cases / Acceptance criteria).

## Facts checked before writing this plan (so nobody re-derives them)

- `src/components/Settings.tsx` exists but **is not currently rendered anywhere**
  in `src/App.tsx` (grepped, zero hits). So "gear button opens Settings" does
  not exist today — this plan adds it fresh, not "converts" an existing button.
- `src/App.tsx` still uses two separate dialog components,
  `src/components/import/ImportPositionsDialog.tsx` and
  `ImportTransactionsDialog.tsx` (the `plans/unify-import-dialogs.md` merge
  has NOT landed). This plan edits both files directly, not a unified `ImportDialog`.
- Neither dialog currently captures the uploaded file's name anywhere. It must
  be added to make `ImportSession.fileName` possible.
- No `src/lib/state.test.ts` file exists yet. `state.ts` has zero direct unit
  tests today. This plan creates that file.
- `src/lib/persist.test.ts` already looks stale vs. current `types.ts` (uses
  field names like `number`/`quantity`/`totalCost` that don't exist in the
  current schema). Not this plan's job to fix that pre-existing drift — flagged
  as a heads-up, not addressed here. This plan only adds the two new fields
  (`importSessions`, `view`) to `persist.ts` and its round-trip test.
- No app-level "view" / page-routing state exists (`grep -n "view" state.ts App.tsx`
  = nothing). Adding a full Settings *page* needs a new `AppState.view` flag.
- `uid(prefix)` (`src/lib/seed.ts`) is generic — new prefix `'import'` is free to use.

## Open questions (need user input before/while implementing — flagged, not guessed away)

1. **Zero-row / zero-account sessions**: if a CSV upload results in 0 rows actually
   imported (all rows skipped for missing/invalid fields, or no account ever
   resolved), should an `ImportSession` still be logged (with `rowCount: 0`,
   `accountIds: []`)? This plan's default (Task 9) is **yes, always log one
   session per file upload that reaches the point of calling
   `importPositions`/`importTransactions` at least once**, per requirement 1's
   "log it once" framing. Confirm this is desired before Task 9 lands.
2. **Settings page navigation UX**: requirement 6 says gear button "navigates to
   a full page/view" replacing the dropdown. This plan reuses `AppState.tab`-style
   pattern with a new `AppState.view: 'dashboard' | 'settings'` flag and hides the
   whole dashboard body (Nav + charts + tables) when `view === 'settings'`,
   showing a "Back" button instead. Confirm this is the intended layout (vs.
   e.g. Settings as an overlay on top of the dashboard, or keeping Nav visible).

## Decisions locked (from requirements doc — do not re-litigate)

- `ImportSession` fields exactly: `id`, `importedAt`, `kind`, `fileName`,
  `accountIds: string[]`, `rowCount`.
- `importSessions` capped at 50, newest first, oldest dropped via slice, no warning.
- `importSessionId: string` (required, not optional) added to `Position`,
  `ClosedPosition`, `Transaction`, `PortfolioSnapshot`.
- `deleteImportSession` is forward-only cleanup, not undo. No blocking/special-casing
  for already-superseded rows.
- Deleting an account also prunes `importSessions`: drop the account id from
  `accountIds` on every session; if a session's `accountIds` becomes empty, drop
  the whole session entry.

## Tasks

### Task 1 — `src/lib/types.ts`: new `ImportSession` type + `importSessionId` fields

Add:
```ts
export interface ImportSession {
  id: string
  importedAt: string
  kind: 'positions' | 'transactions'
  fileName: string
  accountIds: string[]
  rowCount: number
}
```
Add `importSessionId: string` field to `Position`, `ClosedPosition`,
`Transaction`, `PortfolioSnapshot` interfaces (put it near `id`/`accountId`,
doesn't matter exactly where).

No behavior change yet — this only makes the codebase fail to typecheck at
every call site that constructs one of these 4 shapes without the new field.
That's intentional; Tasks 5/6 fix the two real construction sites
(`positionsImport.ts`, `transactionsImport.ts`). Don't fix other files in this task.

- Depends on: none.
- Test cases: none (type-only change, no runtime behavior).
- Acceptance: `ImportSession` type exported from `types.ts`. `npm run build`
  will fail after this task alone (expected, fixed by later tasks) — don't
  run full build/test gate until Task 8 is done. Just eyeball the diff.

### Task 2 — `src/lib/state.ts`: `importSessions`/`view` state + helpers

Depends on: Task 1.

Changes:
1. Add to `AppState`: `importSessions: ImportSession[]` and
   `view: 'dashboard' | 'settings'`.
2. Add to `pendingImport`'s inline type: `fileName: string` (required —
   every uploaded file has a name).
3. `initialState()`: `importSessions: []`, `view: 'dashboard'`.
4. New helper `addImportSession(state, session: ImportSession): AppState` —
   prepends (`[session, ...state.importSessions]`), then `.slice(0, 50)` to
   cap at 50, newest first.
5. New helper `deleteImportSession(state, sessionId: string): AppState` —
   filters `positions`, `closedPositions`, `transactions`, `snapshots` to
   drop rows where `importSessionId === sessionId`, and filters `sessionId`
   out of `importSessions`.
6. New helper `setView(state, view: 'dashboard' | 'settings'): AppState`.
7. Update existing `deleteAccount(state, accountId)`: after the existing
   4-collection cascade (unchanged), also update `importSessions`:
   - map each session: `{ ...session, accountIds: session.accountIds.filter(id => id !== accountId) }`
   - then filter out any session whose resulting `accountIds.length === 0`.

- Test cases (write in Task 9's new `state.test.ts`, not here — this task is
  the implementation only):
  - covered by Task 9.
- Acceptance: `state.ts` compiles. `initialState().importSessions` is `[]`,
  `initialState().view` is `'dashboard'`. `addImportSession`/`deleteImportSession`/
  `setView` exported. `deleteAccount` still passes its existing behavior
  (positions/closedPositions/transactions/snapshots cascade untouched).

### Task 3 — `src/lib/reducer.ts`: new dispatch cases

Depends on: Task 2.

Add three cases:
```ts
case 'ADD_IMPORT_SESSION':
  return StateActions.addImportSession(state, action.session)
case 'DELETE_IMPORT_SESSION':
  return StateActions.deleteImportSession(state, action.sessionId)
case 'SET_VIEW':
  return StateActions.setView(state, action.view)
```

- Test cases: none new (reducer is a thin dispatch table per CLAUDE.md — logic
  lives in state.ts, already tested there). Optionally covered indirectly by
  App.test.tsx in Task 11.
- Acceptance: three new cases present, each a one-line call into `state.ts`.

### Task 4 — `src/lib/persist.ts`: migration-tolerant load/save for new fields

Depends on: Task 2.

In `loadPersistedApp()`'s `migrated` object literal, add:
```ts
importSessions: loaded.importSessions ?? defaults.importSessions,
view: loaded.view ?? defaults.view,
```
`savePersistedApp` needs no change (it already `put`s the whole state object).

- Test cases (add to `src/lib/persist.test.ts`):
  - Loading a blob missing `importSessions`/`view` (simulate pre-migration
    data, same pattern as the existing "loads a minimal state..." test)
    defaults them to `[]` / `'dashboard'`.
  - Round-trip: save a state with a populated `importSessions` array and
    non-default `view`, reload, assert deep-equal.
  - NOTE: the existing "saves then loads all collections byte-for-byte"
    round-trip test constructs a full literal `AppState` object — it must
    be updated to include `importSessions: []` and `view: 'dashboard'` or it
    will fail `toEqual` after this change. Do this edit as part of this task,
    not a separate one. (Don't otherwise "fix" that test file's pre-existing
    stale field names — out of scope, flagged above.)
- Acceptance: all `persist.test.ts` cases pass, including the pre-existing
  ones (after the literal-object edit above).

### Task 5 — `src/lib/positionsImport.ts`: stamp `importSessionId`

Depends on: Task 1.

1. Add a 5th parameter: `importSessionId: string` to `importPositions()`.
2. Stamp it on every `newPositions.push({...})` object.
3. Stamp it on every object inside `newClosedPositions` (the `.map(...)` that
   builds closed positions).
4. Stamp it on the `newSnapshot` object.
5. Update every call site in `src/lib/positionsImport.test.ts` (currently 23
   call sites) to pass a session id string, e.g. `'import-test1'` — mechanical
   find/replace, `importPositions(state, accountId, newRows, '2026-08-08')` →
   `importPositions(state, accountId, newRows, '2026-08-08', 'import-test1')`.
6. Add new test cases (see below).

- Test cases (add to `positionsImport.test.ts`):
  - New position rows get `importSessionId` equal to the value passed in.
  - New `ClosedPosition` rows (symbol disappeared) get the *current* call's
    `importSessionId`, not the old position's.
  - New `PortfolioSnapshot` gets the current call's `importSessionId`.
  - Two sequential imports with different session ids: second import's
    positions carry the second id, first import's now-closed positions carry
    the second id too (they were created during the second call).
- Acceptance: `npx vitest run src/lib/positionsImport.test.ts` green.
  `importPositions` signature is `(state, accountId, mappedRows, importDate, importSessionId)`.

### Task 6 — `src/lib/transactionsImport.ts`: stamp `importSessionId`

Depends on: Task 1.

1. Add a 4th parameter: `importSessionId: string` to `importTransactions()`.
2. Stamp it on every `newTransaction` object.
3. Update every call site in `src/lib/transactionsImport.test.ts` (currently
   18 call sites) similarly to Task 5's mechanical edit.
4. Add new test cases.

- Test cases (add to `transactionsImport.test.ts`):
  - New transaction rows get `importSessionId` equal to the value passed in.
  - Deduped (skipped) rows don't produce a phantom session-tagged row.
  - Two sequential imports with different session ids on the same account:
    each import's newly-inserted rows carry their own session id; pre-existing
    rows from the first import keep their original session id (not overwritten).
- Acceptance: `npx vitest run src/lib/transactionsImport.test.ts` green.
  `importTransactions` signature is `(state, accountId, mappedRows, importSessionId)`.

### Task 7 — Capture `fileName` in both import dialogs

Depends on: Task 2 (for the `pendingImport.fileName` type).

Files: `src/components/import/ImportPositionsDialog.tsx`,
`src/components/import/ImportTransactionsDialog.tsx` (same edit, twice).

1. Add local state `const [fileName, setFileName] = useState('')`.
2. In `handleFileSelect`, after `parseCsvFile(file)` succeeds, `setFileName(file.name)`.
3. In `handleApplyMapping`'s `SET_PENDING_IMPORT` dispatch, add `fileName` to
   the `pendingImport` payload.
4. In `handleCloseDialog`, reset `setFileName('')`.

- Test cases: if either dialog has an existing test file, add "dispatches
  `SET_PENDING_IMPORT` with `pendingImport.fileName` equal to the selected
  file's name" for both kinds. (Checked: no `ImportPositionsDialog.test.tsx`/
  `ImportTransactionsDialog.test.tsx` exist today — if still true when this
  task starts, skip adding a new test file just for this; it's covered
  end-to-end by Task 11's App-level test instead.)
- Acceptance: both dialogs compile; `pendingImport.fileName` is set to the
  uploaded file's `.name` by the time `SET_PENDING_IMPORT` fires.

### Task 8 — `src/App.tsx`: generate session id, thread it through, log the session

Depends on: Tasks 3, 5, 6, 7.

In `processPendingImport()`, right before the `for (const [accountNumber, accountRows] of rowsByAccount)` loop (i.e. only once we know there's no `accountsNeedingPrompt` early-return left to hit):

1. `const importSessionId = uid('import')` — import `uid` from `./lib/seed`.
2. Track `const affectedAccountIds = new Set<string>()`, add `accountId` to it
   inside the loop right after resolving it.
3. Pass `importSessionId` as the new trailing arg to both
   `importPositions(...)` and `importTransactions(...)` calls inside the loop.
4. After the loop, compute `rowCount` by filtering `updatedState` for rows
   tagged with `importSessionId` (don't try to sum returned counts from the
   import functions — simplest correct approach, works regardless of internal
   replace/merge semantics):
   ```ts
   const rowCount = kind === 'positions'
     ? updatedState.positions.filter(p => p.importSessionId === importSessionId).length
       + updatedState.closedPositions.filter(c => c.importSessionId === importSessionId).length
     : updatedState.transactions.filter(t => t.importSessionId === importSessionId).length
   ```
5. Build the `ImportSession` and fold it in via the existing state helper
   before dispatching:
   ```ts
   const session: ImportSession = {
     id: importSessionId,
     importedAt: new Date().toISOString(),
     kind,
     fileName: state.pendingImport!.fileName,
     accountIds: Array.from(affectedAccountIds),
     rowCount,
   }
   updatedState = addImportSession(updatedState, session)
   ```
   (import `addImportSession` and `ImportSession` type at the top of App.tsx)
6. Leave the existing final `dispatch({ type: '__SET_STATE', newState: { ...updatedState, pendingImport: undefined, accountPromptQueue: undefined } })` as-is — `updatedState` already includes the new session.
7. Resolve Open Question 1 (above) per its stated default: this code path
   only runs after `rowsByAccount` has at least one entry with a resolved
   `accountId` (the loop already `continue`s past unresolved ones), so a
   session is logged whenever at least one account's rows were handed to the
   importer, even if that importer skipped every row internally (rowCount
   would be 0 in that edge case, accountIds non-empty).

- Test cases (add to `src/App.test.tsx` — check existing pending-import tests
  there first and extend the same fixtures/pattern):
  - Completing a positions import appends exactly one `ImportSession` to
    `state.importSessions` with `kind: 'positions'`, correct `fileName`,
    `accountIds` containing every account touched, and `rowCount` equal to
    positions+closedPositions created.
  - Completing a transactions import appends one session with
    `kind: 'transactions'` and `rowCount` equal to transactions inserted
    (post-dedup — duplicates don't inflate the count).
  - A CSV spanning multiple accounts produces exactly ONE session listing
    all affected account ids, not one session per account.
  - Every `Position`/`ClosedPosition`/`Transaction`/`PortfolioSnapshot`
    created by this import carries the same `importSessionId` as the logged
    session's `id`.
  - 51st import evicts the oldest session from `state.importSessions` (list
    stays at 50, newest first) — this can be a `state.test.ts` case instead
    (Task 9) if easier to set up there; don't duplicate, pick one file.
- Acceptance: `npx vitest run src/App.test.tsx` green. Manually trace: import
  a CSV in dev mode, confirm `state.importSessions` gets one entry (can be
  verified via the Settings page once Task 13 lands, or via a temporary
  console.log removed before commit).

### Task 9 — New `src/lib/state.test.ts`: helper unit tests

Depends on: Task 2.

This file doesn't exist yet — create it (CLAUDE.md wants one `*.test.ts` per
`src/lib/*.ts` module).

- Test cases:
  - `addImportSession`: appends new session at front (newest-first ordering).
  - `addImportSession`: pushing a 51st session drops the oldest (list length
    stays 50, the dropped one is the one that was previously oldest/last).
  - `addImportSession`: pushing when list has fewer than 50 just appends, no
    eviction.
  - `deleteImportSession`: removes the `ImportSession` entry from `importSessions`.
  - `deleteImportSession`: removes all `Position`/`ClosedPosition`/`Transaction`/
    `PortfolioSnapshot` rows with matching `importSessionId`, leaves rows from
    other sessions untouched.
  - `deleteImportSession`: no-op-safe when called on a session whose rows were
    already superseded by a later import on the same account (i.e. nothing
    currently in `state.positions` has that `importSessionId` anymore) — doesn't
    throw, just removes the now-orphaned `ImportSession` log entry.
  - `deleteImportSession`: calling with an unknown `sessionId` is a no-op
    (returns state with same collections, doesn't throw).
  - `deleteAccount`: a session touching only the deleted account is removed
    entirely from `importSessions`.
  - `deleteAccount`: a session touching the deleted account AND another
    surviving account keeps the entry, with the deleted id removed from
    `accountIds` (and the other id still present).
  - `setView`: toggles between `'dashboard'` and `'settings'`.
- Acceptance: `npx vitest run src/lib/state.test.ts` green, all cases above present.

### Task 10 — `src/components/Settings.tsx`: strip dropdown, become a page, add Disconnect

Depends on: Task 3.

1. Remove `isOpen` state, the toggle button's dropdown/backdrop markup, and
   the `position: relative`/`position: absolute` dropdown styling.
2. Rename the exported component to `SettingsPage` (update the file's
   `export function` and its `SettingsPageProps` interface name — old
   `SettingsProps`/`Settings` name goes away, nothing currently imports it so
   no other call site to fix yet — Task 13 adds the only one).
3. Render Drive section unconditionally (no open/close), as a `<section>` /
   `<div className="card blueprint elev-sm">` per the styling class vocabulary
   in `design.md` — Connect / Disconnect / Sync Now / Restore, same handlers
   as today (`handleConnect`, `handleSync`, `handleRestore`), reusing existing
   `getDriveConnection`/`connectDrive`/`syncBackup`/`restoreBackup` from `drive.ts`.
4. **New**: add a Disconnect button (not present today) — `driveReady && (<button onClick={handleDisconnect}>Disconnect</button>)`. New handler:
   ```ts
   const handleDisconnect = useCallback(async () => {
     setSyncing(true)
     try {
       await disconnectDrive()
       setDriveReady(false)
       alert('Disconnected from Drive')
     } catch (error) {
       console.error('Drive disconnect failed:', error)
       alert(`Disconnect failed: ${error instanceof Error ? error.message : String(error)}`)
     } finally {
       setSyncing(false)
     }
   }, [])
   ```
   Import `disconnectDrive` from `../lib/drive` (already exported there — checked).
5. Leave Import Sessions / Accounts sections as `{/* Task 11 */}` /
   `{/* Task 12 */}` placeholders for now — this task is Drive-section-only.

- Test cases (new `src/components/Settings.test.tsx`):
  - Renders "Not connected" state initially (mock `getDriveConnection` → `null`):
    shows Connect button, no Sync/Restore/Disconnect buttons.
  - Renders connected state (mock `getDriveConnection` → a connection object):
    shows Sync Now, Restore from Drive, and Disconnect buttons, no Connect button.
  - Clicking Disconnect calls `disconnectDrive()` and flips UI back to
    "not connected" (Connect button reappears).
  - Clicking Sync Now calls `syncBackup(state)`.
  - Clicking Restore from Drive, after `window.confirm` returns true, calls
    `restoreBackup()` and dispatches `__SET_STATE`.
- Acceptance: `npx vitest run src/components/Settings.test.tsx` green.
  `SettingsPage` exported, `Settings`/`SettingsProps` names gone.

### Task 11 — `Settings.tsx`: Import Sessions section

Depends on: Task 2 (data shape), Task 10 (page shell exists).

Add a section rendering `state.importSessions` (already newest-first per
`addImportSession`, no extra sort needed):
- Empty state: plain text, e.g. "No imports yet." when `state.importSessions.length === 0`.
- Otherwise a `<table className="table">` (per `design.md` class vocabulary)
  with columns: Date/Time (format via existing `toLocaleDateString`-style
  convention used elsewhere, or raw ISO — match whatever `product-behavior.md`
  says once Task 15 writes it; simplest: reuse the raw-ISO convention already
  used for Closed Positions' `closedDate` per `product-behavior.md`'s
  formatting-conventions section), Kind, File Name, Accounts (resolve each id
  in `accountIds` via `state.accounts.find(a => a.id === id)?.name`, join with
  ", "; an id with no matching account — e.g. deleted account whose id
  wasn't pruned for some reason — falls back to showing nothing for that
  slot, not a crash), Row Count, Delete button.
- Delete button: `window.confirm(`Delete this import? This will remove ${session.rowCount} positions/transactions.`)`
  then `dispatch({ type: 'DELETE_IMPORT_SESSION', sessionId: session.id })`.
  Confirm-cancel does nothing.

- Test cases (extend `Settings.test.tsx`):
  - Empty `importSessions` → shows empty-state text, no table.
  - Non-empty `importSessions` → one row per session, correct kind/fileName/rowCount.
  - Account name resolution: `accountIds: ['acc1','acc2']` with those accounts
    in `state.accounts` renders both names.
  - Delete button: mocks `window.confirm` to return `false` → no dispatch.
  - Delete button: mocks `window.confirm` to return `true` → dispatches
    `DELETE_IMPORT_SESSION` with the right `sessionId`.
- Acceptance: `npx vitest run src/components/Settings.test.tsx` green including
  new cases. Manual check: table matches `.table` class vocabulary, no inline
  ad-hoc styling beyond what other tables in the codebase already do.

### Task 12 — `Settings.tsx`: Accounts section

Depends on: Task 10 (page shell exists). Independent of Task 11 (can be built
in parallel once Task 10 lands).

Add a section listing `state.accounts`:
- Each row: name (editable inline — click to turn into a text `<input className="input">`,
  blur/submit dispatches `UPDATE_ACCOUNT` with `{ patch: { name } }`), taxCategory
  (editable via a `<select>` of the 3 `TaxCategory` values, same pattern as
  elsewhere in the codebase, dispatches `UPDATE_ACCOUNT`), retirement (checkbox,
  dispatches `UPDATE_ACCOUNT`), and a Delete button.
- Delete button: `window.confirm` (e.g. "Delete this account? This removes all
  its positions, closed positions, transactions, and snapshots.") then
  `dispatch({ type: 'DELETE_ACCOUNT', accountId: account.id })`. The
  import-session cleanup (Task 2's `deleteAccount` update) happens automatically
  inside that existing action — no extra dispatch needed here.
- Empty state: "No accounts yet." when `state.accounts.length === 0`.

- Test cases (extend `Settings.test.tsx`):
  - Renders one row per account with current name/taxCategory/retirement values.
  - Editing name and blurring dispatches `UPDATE_ACCOUNT` with the new name.
  - Changing taxCategory dispatches `UPDATE_ACCOUNT` with the new category.
  - Toggling retirement checkbox dispatches `UPDATE_ACCOUNT` with the new boolean.
  - Delete with `window.confirm` → `false`: no dispatch.
  - Delete with `window.confirm` → `true`: dispatches `DELETE_ACCOUNT` with
    the right `accountId`.
- Acceptance: `npx vitest run src/components/Settings.test.tsx` green including
  new cases.

### Task 13 — `src/App.tsx`: gear button + view switch

Depends on: Tasks 3, 10, 11, 12 (needs the finished `SettingsPage`).

1. Import `SettingsPage` from `./components/Settings`.
2. Add a gear button above `<SummaryCards>` (per `product-behavior.md`'s
   documented layout: "right-aligned Settings button" above the 5 summary
   cards), `onClick` dispatches `{ type: 'SET_VIEW', view: 'settings' }`.
3. Wrap the current dashboard body (everything currently inside the outer
   `<div style={{ maxWidth: '1400px', ... }}>` below the two account-prompt
   modals) in a conditional: render it when `state.view === 'dashboard'`;
   render `<SettingsPage state={state} dispatch={dispatch} />` plus a "Back"
   button (dispatches `SET_VIEW` back to `'dashboard'`) when
   `state.view === 'settings'`. Modals (`ManualAccountNumberPrompt`,
   `AccountResolvePrompt`) stay mounted regardless of `view` (an import can
   still be pending while on the Settings page — don't special-case this,
   just don't unmount them).

- Test cases (extend `src/App.test.tsx`):
  - Default `state.view` is `'dashboard'`: renders Nav/SummaryCards, no
    Settings page content.
  - Clicking gear button switches to Settings page: Nav/SummaryCards/tables
    disappear, Settings page content (Drive section heading, at minimum)
    appears.
  - Clicking Back from Settings page returns to dashboard view.
- Acceptance: `npx vitest run src/App.test.tsx` green including new cases.
  `grep -n "Settings" src/App.tsx` shows the gear button and `SettingsPage` render.

### Task 14 — Full test + build + lint gate

Depends on: all of Tasks 1–13.

1. `npm run test` — all green, no leftover `.only`/`.skip`.
2. `npm run lint`.
3. `npm run build` (tsc -b + vite build) — no type errors. This is the first
   point where the Task 1 type-only change from earlier is fully load-bearing
   and verified.
4. `grep -ri watchlist src/` — must stay empty (unrelated invariant, re-verify
   per CLAUDE.md ground rule since this plan touches many files).
5. `grep -rn "ImportPositionsDialog\.tsx\|ImportTransactionsDialog\.tsx" src/` —
   confirm both still exist and still compile (this plan does NOT merge them;
   don't let an editor autofix/rename accidentally break that).

- Acceptance: all four commands clean.

### Task 15 — Reference doc updates + full-file review

Depends on: Task 14 (do this only once code is green — CLAUDE.md: don't commit
doc-stale work, and full-file review happens after the change, not mid-change).

1. **`schema-spec.md`**:
   - New `## ImportSession` section (field table, uid prefix `import`), placed
     after `## PortfolioSnapshot` (natural grouping) or after `## MappingProfile`
     — either is fine, pick one and be consistent with the doc's existing order.
   - Add `importSessionId` row to the field tables for `Position`, `ClosedPosition`,
     `Transaction`, `PortfolioSnapshot`.
   - Update the "AppState UI/filter fields" section: add `view: 'dashboard' | 'settings'`,
     add `importSessions: ImportSession[]` to the "Persistence envelope" section's
     collection count (currently says "6 collections" — becomes 7), and update
     `pendingImport`'s inline type shown there to include `fileName: string`.
   - Add `import` to the uid-prefix list in the doc's opening paragraph.
2. **`design.md`**:
   - `AppState` interface block: add `importSessions: ImportSession[]` and `view`.
   - Component tree: add `SettingsPage` (replacing the old bare `Settings` leaf)
     with a one-line note on its 3 sections (Drive backup / Import Sessions / Accounts).
   - Key Invariants: add a line for `importSessionId` tagging + the forward-only
     `deleteImportSession` semantics + the account-delete cascade rule for sessions.
   - Data Flow / CSV Import Pipeline: add a step noting session-id generation
     and `ImportSession` logging happens once per file upload in `App.tsx`'s
     `pendingImport` effect (step 8, after "State merge").
3. **`product-behavior.md`**:
   - Replace the entire "Settings (Drive backup)" section with a new "Settings
     page" section describing: gear button navigates to the page (not a modal/dropdown
     anymore), the 3 sections and their behavior (Drive backup incl. new
     Disconnect button; Import Sessions table incl. delete + confirm copy;
     Accounts list incl. inline edit + delete + cascade note), and the Back
     button returning to the dashboard.
   - Update the "Layout" section's one-liner that currently says "a right-aligned
     `Settings` button" opens something — adjust wording to "navigates to the
     Settings page" instead of whatever it currently implies (re-read it first,
     it may already say "button" generically — just make sure it doesn't still
     describe dropdown/modal behavior).
4. **Full-file review** (CLAUDE.md rule, this is a major change): re-read all
   three docs in full after editing. Check: no section still describes the old
   dropdown Settings, no stale collection count, no contradiction between
   `schema-spec.md`'s field list and `design.md`'s `AppState` block, terse/no
   narrative drift introduced.

- Acceptance: all three docs updated and internally consistent; a fresh read
  top-to-bottom of each doesn't contradict itself or the code.

### Task 16 — Commit

Depends on: Task 15.

Only after Task 14's gate is green AND Task 15's docs are updated (CLAUDE.md:
never commit partial or doc-stale work). One commit for the whole feature (or
a few logically-grouped commits if the diff is large — user's call at commit
time), message describing "why" (import history + audit trail for CSV imports,
plus a real Settings page to manage it and accounts).

## Test cases (rollup — see per-task lists above for detail)

- `state.test.ts`: `addImportSession` (append, cap-at-50 eviction, no eviction
  under 50), `deleteImportSession` (removes session + tagged rows, no-op-safe
  on unknown id / already-superseded rows), `deleteAccount` (session pruning:
  fully removed when it was the only account, `accountIds` trimmed when others remain).
- `positionsImport.test.ts`: `importSessionId` stamped on new positions, new
  closed positions, new snapshot; two sequential imports carry distinct ids correctly.
- `transactionsImport.test.ts`: `importSessionId` stamped on new transactions
  only (not on deduped/skipped rows); sequential imports don't overwrite older rows' ids.
- `persist.test.ts`: migration defaults for `importSessions`/`view`; round-trip
  with populated `importSessions` and non-default `view`.
- `App.test.tsx`: one `ImportSession` logged per completed file upload (single
  entry even for multi-account CSVs), `rowCount`/`accountIds`/`fileName`/`kind`
  correctness, gear button + Back button view switching.
- `Settings.test.tsx` (new file): Drive section connect/disconnect/sync/restore
  states and handlers; Import Sessions table rendering/empty-state/delete+confirm;
  Accounts list rendering/inline-edit/delete+confirm.

## Acceptance criteria (whole plan)

- `ImportSession` type exists in `types.ts`; `importSessionId` present on
  `Position`, `ClosedPosition`, `Transaction`, `PortfolioSnapshot`.
- `AppState.importSessions` persisted, capped at 50, newest-first.
- Every row created by `importPositions`/`importTransactions` carries the
  session id of the file upload that created it.
- One `ImportSession` logged per file upload (not per account) via `App.tsx`'s
  pending-import effect.
- `deleteImportSession` and the `deleteAccount` session-pruning rule both
  implemented and unit-tested per the Decisions Locked section.
- Gear button navigates to a full `SettingsPage` (no dropdown remains) with
  Drive backup (incl. new Disconnect button), Import Sessions (list + delete),
  and Accounts (inline edit + delete) sections.
- `npm run test`, `npm run lint`, `npm run build` all green.
- `grep -ri watchlist src/` empty.
- `schema-spec.md`, `design.md`, `product-behavior.md` all updated and
  internally consistent (Task 15's full-file review done).
- Commit created only after the above gate passes (CLAUDE.md rule).
