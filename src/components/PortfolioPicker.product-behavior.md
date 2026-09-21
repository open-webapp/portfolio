# PortfolioPicker — Product Behavior

Sibling doc: `PortfolioPicker.design.md` (props, state, data flow).

## Overview

Landing page at the `picker` route. A centered Ledger heading precedes an always-visible `Open` / `Create` / `Google Drive` segmented control; only the selected panel renders. Local-file import is an action within Create. Mode switches preserve all in-progress panel state. Global Mapping remains a separate, unchanged section below this picker.

## Existing portfolios list

| Condition | Behavior |
|---|---|
| `portfolios` empty | Open panel shows italic "No portfolios yet. Create one to get started." |
| Portfolio row | Name (click to rename inline), "Created {date}" (localized `createdAt`), "Delete" text link, "Open" button |
| Click name | Turns into a text input, autofocus |
| Rename: Enter | Commits if trimmed name is non-empty and differs (case-insensitive) from current name; calls `onRename(id, trimmed)` |
| Rename: blur | Same commit logic as Enter |
| Rename: Escape | Cancels, discards draft |
| Rename: blank or unchanged (case-insensitive) trim | No-op, no `onRename` call |
| Click "Delete" | `window.confirm('Delete portfolio "{name}"? This cannot be undone.')`; on confirm calls `onDelete(id)`; on cancel, no-op |
| Click "Open" | Calls `onOpen(id)` immediately, no confirmation |

## Flow 1 — Create

1. Select `Create`, enter a name in the `e.g. Retirement` field, then click "Create" (or press Enter in the name field).
2. Blank/whitespace-only name: no-op, panel does not open.
3. Opens inline password + confirm panel below (name field becomes disabled).
4. Validation on "Set password & create":
   - Password < 6 chars → **"Password must be at least 6 characters"**, no submit.
   - Password !== confirm → **"Passwords do not match"**, no submit.
5. On submit, calls `onCreateNew(name, password)`; button label changes to "Creating..." and disables while pending.
6. On success: `App.tsx` opens the new portfolio directly (see design doc) — picker itself does not need to reset, since it unmounts (route changes).
7. On rejection (e.g. name collision surfaced from `portfolioRegistry.createPortfolio`): shows the thrown error's message inline (falls back to **"A portfolio with this name already exists."** if the error has no message), clears both password fields, panel stays open for retry.
8. "Cancel" closes the password panel, clears password/confirm/error, re-enables the name field.
9. Name-collision check is enforced by the backend (`createPortfolio`), not client-side in the picker — the picker just relays whatever message the rejection carries.

## Flow 2 — Import from Google Drive folder

1. Select `Google Drive`, then its default `My portfolios` submode; the "Load from Google Drive" button opens that panel.
   - **Offline** (`isOnline === false`): button disabled, `title="Connect to the internet to import from Google Drive"`.
   - **Loading**: label becomes "Loading Google Drive...", button disabled during the list fetch.
2. On click, calls `onListDriveFolders()`, then filters out any folder whose name matches (case-insensitive, trimmed) an existing local portfolio's name.
3. Outcomes after the list resolves:
   - Raw list empty → **"No portfolios found in Google Drive."** (italic, no rows shown).
   - Raw list non-empty but every folder filtered out as a local-name match → **"All Google Drive portfolios are already in Your Portfolios."**
   - Otherwise → each remaining folder renders as its own row with an "Import" button. No empty-state message shown.
4. On rejection (auth/connect failure) → **"Couldn't connect to Google Drive."** shown as a dismissible tag; no folder rows are rendered. "Dismiss" closes the whole Drive panel (closes `driveFoldersOpen`).
5. Malformed/unreadable individual folders are never surfaced as errored rows — `listPortfolioFoldersOnDrive` silently drops folders it can't read; the picker only ever sees the clean list or a hard connect failure.
6. Per-row Import:
   - Click a row's "Import" button → reveals *that row's own* password field (placeholder "Enter the portfolio's password"); other rows are unaffected.
   - Clicking the row's "Import" trigger again (label toggles) or "Cancel" collapses that row's password field and clears its error — independent per row.
   - Submit (button or Enter in the password field) calls `onImportFromDriveFolder(folder, password)`; button label becomes "Importing...", disabled while pending.
   - Wrong password → **"Incorrect password."**, scoped to that row only; password cleared, field stays open for retry. Other rows' state is untouched.
   - Any other import failure (e.g. malformed backup discovered only at import time) → row shows the error's message, or **"Could not import this portfolio."** as fallback.
   - On success, `App.tsx` opens the new portfolio directly (see design doc).

## Flow 3 — Import from file

1. In the `Create` panel, "Import from file" triggers a hidden `<input type="file" accept=".json,application/json">`.
2. Picking a file that fails to parse as an encrypted envelope (`ImportMalformedFileError`) → shows **"This is not a valid backup file."**; no name/password panel opens; any previous file-import state is reset.
3. Any other parse failure while reading the file → shows the error's message, or **"Could not read the selected file."** as fallback.
4. Picking a valid envelope:
   - Panel reveals an editable "Portfolio name" field prefilled with the filename minus its extension (e.g. `MyBackup.json` → `MyBackup`).
   - A "Password" field appears (placeholder "Enter the backup's password"), autofocused.
5. Submit (button or Enter in the password field) requires a non-blank trimmed name; calls `onImportFromFile(envelope, name, password)`; button label becomes "Importing...", disabled while pending.
6. Wrong password (`ImportDecryptError`) → **"Incorrect password."**; password field cleared and stays open; envelope and name are preserved so the user can just retype the password.
7. Any other import failure → shows the error's message, or **"Could not import this file."** as fallback.
8. "Cancel" resets all file-import state and clears the file input's value (so re-picking the same file re-triggers the change handler).
9. On success, resets file-import state and clears the file input; `App.tsx` opens the new portfolio directly (see design doc).

## Cross-flow notes

- While the Create password panel is open, the name field and "Import from file" action are disabled (mutually exclusive with editing the create name).
- Google Drive has `My portfolios` and `Shared portfolio` submodes. Shared uses the unscoped folder Picker, then the existing password form.
- Each panel tracks its own error/loading state; switching away and back preserves it.
- No flow shows a global spinner/overlay; all pending states are local button-label changes ("Creating...", "Importing...", "Loading Google Drive...").
