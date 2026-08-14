# Plan: Persist Google Drive Connections Across Page Refreshes

Goal: Load and display stored Drive connection status (driveReady, driveEmail) on initial app load before the password gate is passed, so users see "Already connected as user@gmail.com" on the PasswordGate restore tab without re-prompting for auth. Avoid calling `drive.activate()` or checking backup file ID until the user actually wants to restore.

Caveman rules: short tasks (≤30min each), explicit deps, test per-task, reference docs updates mandatory.

## Key facts (read once, cite by path)

- `App.tsx` (lines 42-113): currently manages `driveReady`, `driveEmail`, `backupFileId` state. Lines 97-113 check Drive status via `getDriveAuthStatus()` + `getBackupFileId()`, **but only after sessionKey is set** (inside a `if (sessionKey === null) return` guard).
- `getDriveAuthStatus()` (drive.ts lines 119-128): non-interactive, never opens a Google auth window. Returns `{ connected, email, expiresAt, needsReauth, tokenValid }`. Safe to call on mount with no sessionKey.
- `getBackupFileId()` (drive.ts lines 225-263): non-interactive lookup. Currently called after `getDriveAuthStatus()` on the post-unlock effect. **Should NOT be auto-called on initial load** — user triggers it via "Restore" button click.
- `drive.activate()` (App.tsx lines 83-88): gated on sessionKey to prevent stale tokens triggering silent reauth prompts before local unlock. Must remain post-unlock-only.
- `PasswordGate.tsx` (lines 1-59): receives `driveReady`, `driveEmail`, `backupFileId` props (lines 12-14, 30-36). Passes them to `SetPasswordScreen` (lines 46-57).
- `SetPasswordScreen` (PasswordGate.tsx lines 171-286): renders tabs including "Restore from Drive" (line 202); shows connection status via `driveReady` + `driveEmail` props (lines 272-275). No connection state until props are populated.

## Decisions (implement as-stated, don't re-litigate)

### Confirmed by user
1. **Keep token warmup cold pre-unlock** (Q1 ✓): Keep `drive.activate()` gated on sessionKey (existing behavior). Connection status check never triggers token refresh or cached-token warmup. Prevents stale-token reauth prompts before local unlock.
2. **Refresh status post-unlock** (Q2 ✓): After password unlock, the post-unlock effect calls `getDriveAuthStatus()` again to refresh connection state (idempotent, safe; clarifies intent).

### Implementation decisions
3. **Parallel, non-blocking load**: Check stored Drive connection in a separate `useEffect` with `[]` dependency (mount-only), no sessionKey guard. Fire-and-forget; errors are logged, not thrown.
4. **Separate `getBackupFileId()` from status check**: Remove `getBackupFileId()` from the post-unlock effect (lines 104-106 in current App.tsx). Only call it when user explicitly clicks "Restore" (via `handleConnect` already in place, or a new restore-specific handler).
5. **State initialization**: On mount, set `driveReady = false`, `driveEmail = null`, `backupFileId = null` (already done). Update these only when `getDriveAuthStatus()` succeeds.
6. **Error handling**: Catch and log `getDriveAuthStatus()` errors. Do not set state on error; leave connection as "unknown" (UI shows "Not connected" or offers "Connect" button).
7. **Token validity check**: Use `tokenValid` flag from `getDriveAuthStatus()` to determine if stored token is still usable. If `tokenValid = false`, show "Connect" button; if `tokenValid = true`, show "Connected as email" without prompting.

## Architecture sketch

```
App.tsx (mount)
  ├─ useEffect([], []) — early Drive status check (no sessionKey guard)
  │    ├─ getDriveAuthStatus() → { connected, email, tokenValid, ... }
  │    ├─ setDriveReady(connected)
  │    ├─ setDriveEmail(email)
  │    └─ catch & log any errors
  │
  ├─ PasswordGate (rendered before unlock)
  │    ├─ receives driveReady, driveEmail, backupFileId props
  │    ├─ SetPasswordScreen renders "Restore from Drive" tab
  │    └─ Shows "Connected as user@gmail.com" or "Connect Google Account" button
  │
  └─ useEffect([sessionKey], [sessionKey]) — post-unlock (existing, lines 83-88)
       ├─ drive.activate() (token warmup, only post-unlock)
       └─ getDriveAuthStatus() + handleConnect (user-triggered restore, NOT auto-lookup of backupFileId)
```

## Tasks

### T0 — worktree setup
Run:
```
git worktree add ../worktree-drive-persistence -b feature/drive-connection-persistence
cd ../worktree-drive-persistence
```
Acceptance: `git worktree list` shows new worktree; `git status` shows branch `feature/drive-connection-persistence`.

### T1 (dep: T0) — add early Drive status check useEffect
File: `src/App.tsx`
- Add new `useEffect` with empty dependency array (`[]`) **before** the existing post-unlock effects (before line 82).
- Inside effect: call `getDriveAuthStatus()` non-blockingly.
  ```typescript
  useEffect(() => {
    const checkDrive = async () => {
      try {
        const authStatus = await getDriveAuthStatus()
        setDriveReady(authStatus.connected)
        setDriveEmail(authStatus.email)
      } catch (error) {
        console.warn('Early Drive status check failed (non-blocking):', error)
        // Leave driveReady/driveEmail at defaults (false/null)
      }
    }
    checkDrive()
  }, [])
  ```
- **Must not open Google auth window** (getDriveAuthStatus is non-interactive).
- **Must not call `drive.activate()`** (still gated on sessionKey later).
- Log errors as warnings (non-fatal).
Tests: compile check only.
Acceptance: `npx tsc -b` passes; code compiles without errors.

### T2 (dep: T1) — remove `getBackupFileId()` from post-unlock effect
File: `src/App.tsx` (lines 96-113)
- In the existing post-unlock `getDriveAuthStatus()` effect (lines 97-113), **remove** the `getBackupFileId()` call (lines 104-106):
  ```typescript
  // DELETE these lines:
  // if (authStatus.connected) {
  //   const fileId = await getBackupFileId()
  //   setBackupFileId(fileId)
  // }
  ```
- Keep the `getDriveAuthStatus()` call and state updates (`setDriveReady`, `setDriveEmail`).
- This effect now just **refreshes** the connection status after unlock; it doesn't look up the backup file.
Tests: compile check.
Acceptance: `npx tsc -b` passes; no `getBackupFileId` calls remain in the post-unlock effect.

### T3 (dep: T2) — handle restore flow (call `getBackupFileId()` only on user action)
File: `src/components/PasswordGate.tsx` or `src/components/DriveRestorePanel.tsx`
- Verify `handleConnect` prop (already passed from App.tsx, line 275) is wired to call `connectDrive()` when user clicks "Connect Google Account" button.
- After `connectDrive()` succeeds in App.tsx's `handleConnect` (lines 129-168), the existing code already calls `getBackupFileId()` (line 151). **Keep this as-is**.
- No change needed in PasswordGate/DriveRestorePanel — the existing button handlers (`handleConnect`, etc.) already trigger `getBackupFileId()` on demand.
Tests: verify existing behavior still works (no new tests, inspection only).
Acceptance: Restore button click → `handleConnect` → `connectDrive()` + `getBackupFileId()` (already wired).

### T4 (dep: T3) — test early Drive status appears on PasswordGate
File: `src/App.test.tsx`
- Add new test: "early Drive status check populates driveReady and driveEmail before password gate is passed"
  - Mock `getDriveAuthStatus()` to return `{ connected: true, email: 'test@gmail.com', tokenValid: true, ... }`
  - Mock `getBackupFileId()` to return `null` (should not be called in this test)
  - Render `<App />`
  - **Before clicking unlock button**, verify `driveReady` and `driveEmail` props are passed to `PasswordGate`:
    - Wait for `getDriveAuthStatus()` to resolve (use `waitFor`)
    - Check that the mocked PasswordGate receives `driveReady={true}` and `driveEmail={'test@gmail.com'}`
  - Then click unlock, verify dashboard renders.
- Acceptance criteria:
  - Early status check succeeds non-blockingly before password gate is unlocked.
  - Props are passed to PasswordGate immediately.
  - No `getBackupFileId()` call happens on initial load.

### T5 (dep: T4) — test error handling in early Drive status check
File: `src/App.test.tsx`
- Add new test: "early Drive status check logs error if getDriveAuthStatus fails, leaves state at defaults"
  - Mock `getDriveAuthStatus()` to reject with an error (e.g., `new Error('Network error')`)
  - Render `<App />`
  - **Before clicking unlock**, verify:
    - `driveReady` prop to PasswordGate is `false` (default, unchanged)
    - `driveEmail` prop to PasswordGate is `null` (default, unchanged)
    - Console warning is logged (check spy on `console.warn`)
  - Click unlock, verify dashboard renders and no further errors.
- Acceptance criteria:
  - Error is caught and logged (not thrown).
  - UI remains usable (PasswordGate still renders, "Connect Google Account" button available).
  - No console errors/uncaught rejections.

### T6 (dep: T5) — verify no auto-call to `getBackupFileId()` on load
File: `src/App.test.tsx`
- Add new test: "post-unlock Drive status check does not call getBackupFileId on initial load"
  - Mock `getDriveAuthStatus()` to return `{ connected: true, email: 'test@gmail.com', tokenValid: true, ... }`
  - Mock `getBackupFileId()` as a spy (not reject, just track calls)
  - Render `<App />`
  - **Before and immediately after unlock**, verify `getBackupFileId()` is **not called**:
    - Assert `getBackupFileId.mock.calls.length === 0`
  - (Existing test "Drive-sync activation" at App.test.tsx line 467+ already covers post-unlock behavior, but this test explicitly documents the non-auto-lookup requirement.)
- Acceptance criteria:
  - `getBackupFileId()` is never called on initial load (before or after unlock).
  - Only called later when user explicitly triggers restore (tested separately, not in scope here).

### T7 (dep: T6) — full test suite pass
Run:
```
npm run test
npm run lint
npm run build
```
Fix any failures (type errors, lint, broken tests).
Acceptance: all three commands exit 0.

### T8 (dep: T7) — update reference docs
File: `src/lib/product-behavior.md`
- Add section "Drive Connection Persistence" under "Google Drive Sync":
  - "On app load, the app checks for a stored Google Drive connection (non-blocking, parallel with other initialization). If a connection exists and the cached token is still valid, the app displays 'Connected as user@gmail.com' on the Restore tab without re-prompting. If the token is expired or no connection exists, the Restore tab shows a 'Connect Google Account' button. The app does NOT automatically look up the backup file ID on load — file lookup only happens when the user clicks 'Restore' and a fresh connection is confirmed."

File: `src/lib/design.md`
- Add to "Data flows" section:
  - "Drive Connection Persistence: on mount, useEffect calls getDriveAuthStatus() non-blockingly, sets driveReady + driveEmail, passes to PasswordGate. No getBackupFileId() auto-call on initial load. Post-unlock, drive.activate() + post-unlock getDriveAuthStatus() run (separate effect) only after sessionKey is set."

Tests: none (docs-only).
Acceptance: docs are terse, token-optimized; no contradictions with existing Drive sections.

### T9 (dep: T8) — full verification gate
Run:
```
npm run test
npm run lint
npm run build
```
Acceptance: all three exit 0; no warnings from linter related to Drive code.

### T10 (dep: T9) — commit
In worktree:
```
git add src/App.tsx src/App.test.tsx src/lib/product-behavior.md src/lib/design.md
git commit -m "Persist Drive connection status on app load; display on password gate without re-prompting"
```
Acceptance: `git log -1` shows the new commit; `git status` clean.

### T11 (dep: T10) — teardown worktree
```
cd /Users/mdoraiswamy/owa/portfolio
git worktree remove ../worktree-drive-persistence
```
Acceptance: `git worktree list` no longer shows the worktree; branch `feature/drive-connection-persistence` still exists.

## Overall acceptance criteria (plan "done")

1. **Early Drive status check**: App calls `getDriveAuthStatus()` on mount in a separate, non-blocking `useEffect([])`.
2. **PasswordGate shows connection status immediately**: `driveReady` and `driveEmail` props are populated before password gate is unlocked, showing user they're already connected (or prompting to connect).
3. **No re-prompt on valid token**: If cached token is still valid, user sees "Connected as user@gmail.com" without Google auth window.
4. **No early `drive.activate()` calls**: Token warmup (`drive.activate()`) is still gated on sessionKey (post-unlock only), preventing stale-token reauth prompts before local unlock.
5. **No auto-lookup of backup file ID on load**: `getBackupFileId()` is removed from initial checks; only called when user explicitly triggers restore via "Restore" button click.
6. **Error handling**: `getDriveAuthStatus()` errors are logged as warnings; UI remains usable (shows "Not connected" or "Connect" button).
7. **Tests pass**: New tests in `App.test.tsx` verify early status check, error handling, and no auto-backup-lookup. All existing tests still pass.
8. **Reference docs updated**: `product-behavior.md` and `design.md` document the persistence behavior and data flows.
9. `npm run test`, `npm run lint`, `npm run build` all pass.
10. Change committed on `feature/drive-connection-persistence`; worktree torn down.

## Test strategy

- Unit test (App.test.tsx): Early status check populates props before unlock; error handling leaves state at defaults.
- Unit test (App.test.tsx): `getBackupFileId()` is not auto-called on initial load.
- Integration test (App.test.tsx): Full flow — load → check Drive status → display on gate → unlock → post-unlock checks run separately.
- No new test framework; use existing `vitest` + `jsdom` + `render`/`screen`/`waitFor`/`vi.mocked`.

## Risks & mitigations

- **Race: early check vs. post-unlock check**: Both effects run independently. Early check fires immediately; post-unlock check fires only after sessionKey is set. No overlap/interference because post-unlock effect also calls `getDriveAuthStatus()` to refresh (second call is a no-op for status display, already done by early check). Mitigation: early check updates state; post-unlock check refreshes state (idempotent). Both are safe.
- **Network latency**: Early check is async; if network is slow, Drive status won't appear immediately. User sees "Not connected" until check resolves. Acceptable (mirrors current post-unlock behavior).
- **Backward compatibility**: Existing Drive flow (handleConnect, handleDisconnect, post-unlock activate) is unchanged. New early check is purely additive.

## Out of scope

- Transactions restore/sync (Drive sync is positions-only; no change).
- Reauth flow refinements (user still manually clicks "Restore" to trigger auth).
- UI components for PasswordGate DriveRestorePanel (already exist; no redesign needed).
- Backup file version/migration (no schema changes).

