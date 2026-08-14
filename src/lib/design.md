# design.md

Directory structure, API contract, component tree, state management, data model, data flows, design patterns.

## Component Tree

- `ClosedPositionsTable.tsx` — table with symbol, closed date, realized G/L, delete + undo buttons

## Data Flows

### Undo Closed Position

ClosedPosition → ClosedPositionsTable Undo click → findMatchingOpenPosition/isExactLotMatch dedup check (state.ts) → [window.confirm if exact-lot match] → RESTORE_CLOSED_POSITION dispatch → restoreClosedPosition (state.ts)

- No same-symbol open position in account → silent restore.
- Same-symbol position, identical shares/avgCost/assetClass (exact-lot match) → confirm dialog; Yes replaces existing position, No is a no-op.
- Same-symbol position, different shares/avgCost/assetClass → silent restore as separate duplicate-symbol row.

### Drive Connection Persistence

On mount, `App.tsx` calls `getDriveAuthStatus()` non-blockingly in parallel with other initialization (sets `driveReady` + `driveEmail`, passes to `PasswordGate`). No `getBackupFileId()` auto-call on initial load.

Post-unlock, `drive.activate()` + post-unlock `getDriveAuthStatus()` run in a separate effect only after `sessionKey` is set. No blocking waits on Drive connection status — initialization proceeds independently.
