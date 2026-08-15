# design.md

Directory structure, API contract, component tree, state management, data model, data flows, design patterns.

## Component Tree

- `ClosedPositionsTable.tsx` — table with symbol, closed date, realized G/L, delete + undo buttons; takes `positions` prop (caller-supplied ClosedPosition[])
  - Used by `PositionsTable.tsx` (passes `state.closedPositions`)
  - Used by `AccountsPage.tsx` (passes `acctFilteredClosedPositions(state)`)

## Data Flows

### Undo Closed Position

ClosedPosition → ClosedPositionsTable Undo click → findMatchingOpenPosition/isExactLotMatch dedup check (state.ts) → [window.confirm if exact-lot match] → RESTORE_CLOSED_POSITION dispatch → restoreClosedPosition (state.ts)

- No same-symbol open position in account → silent restore.
- Same-symbol position, identical shares/avgCost/assetClass (exact-lot match) → confirm dialog; Yes replaces existing position, No is a no-op.
- Same-symbol position, different shares/avgCost/assetClass → silent restore as separate duplicate-symbol row.

### Account Selection

SELECT_ACCOUNT (accountId, categoryKey) → selectAccount (state.ts) → sets selectedAccountId + selectedCategoryKey (toggle if same pair) → categoryCards/closedPositionsCard `selected` fields react → AccountsPage branches main panel on selectedCategoryKey

- Same account + categoryKey clicked again → toggle: clear selection (both null).
- Different account or categoryKey → replace selection.
- Null selection → main panel shows portfolio-level view.

### Drive Connection Persistence

On mount, `App.tsx` calls `getDriveAuthStatus()` non-blockingly in parallel with other initialization (sets `driveReady` + `driveEmail`, passes to `PasswordGate`). No `getBackupFileId()` auto-call on initial load.

Post-unlock, `drive.activate()` + post-unlock `getDriveAuthStatus()` run in a separate effect only after `sessionKey` is set. No blocking waits on Drive connection status — initialization proceeds independently.

### Restore from Drive

RestorePanel → [Restore from Drive button clicked] → showPicker = true → DrivePickerFallback
  ├─ Picker opens immediately (async via openDrivePicker) — no by-name lookup first
  ├─ getDriveConnection() retrieves OAuth token; openDrivePicker() resolves the
  │  OpenWebApp/Portfolio folder id via ensureFolderPath() and sets it as Picker's
  │  starting parent (DocsView.setParent) — user can still navigate elsewhere
  ├─ Picker init requires both setOAuthToken(token) and setDeveloperKey(apiKey)
  │  (VITE_GOOGLE_PICKER_API_KEY) — both required, not optional
  ├─ Picker rendered in-browser; user selects file (from default folder or elsewhere)
  └─ onSelect callback → confirm dialog → restoreBackupFromFileId(fileId, key)
     ├─ Success: onRestored() → state hydrated
     ├─ DriveDecryptError (password mismatch): setCrossPasswordPrompt() → user enters backup password → deriveKey + decryptState
     └─ Error: alert + Picker remains closed, user can click "Restore from Drive" to retry

Also applies to cross-password flow: after wrong-password error, Picker reopens (same as primary path).
