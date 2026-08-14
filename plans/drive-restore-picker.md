# Plan: Replace Paste-URL Fallback with Google Picker for Drive Restore

Goal: Replace the current paste-URL/file-ID fallback in DriveRestorePanel with Google Picker API, allowing users to browse and select files directly from Google Drive with OAuth-authenticated access. Picker is the ONLY restore entry point: clicking "Restore from Drive" always opens Picker immediately (no silent by-name lookup first). Picker defaults to the app's `OpenWebApp/Portfolio` Drive folder but lets the user browse to any other folder. A Google Picker API key is required (confirmed, not optional) alongside the existing OAuth token.

Caveman rules: short tasks (≤30min each), explicit deps, test per-task, reference docs updates mandatory.

## Key facts (read once, cite by path)

- `src/components/DriveRestorePanel.tsx` (lines 1-293): currently renders `DrivePasteFallback` component (lines 11-44) on `noBackupFound` (line 231) and inside `crossPasswordPrompt && crossPasswordError` block (line 281); `handleRestore()` (button click handler) currently calls `restoreBackup()` (by-name lookup) and only falls to the fallback UI when that returns null. **This lookup-first call is being removed**: the button click will directly open Picker, no `restoreBackup()` call, no `noBackupFound` state. `handleLoadPastedFile` (lines 115-145) calls `extractDriveFileId()` then `restoreBackupFromFileId(fileId, restoreKey)` — being removed along with paste UI.
- `src/lib/drive.ts` (lines 1-439): `ensureFreshConnection()` (139-150) guarantees usable token; `getDriveConnection()` (89-91) reads cached connection with email; no Picker API functions currently exist. `restoreBackupFromFileId(fileId, key)` (405-417) is the existing restore target for file-by-id — stays, becomes the only restore path (fed by Picker selection). `restoreBackup(key)` (358-389, by-name lookup in the app's own folder) has **no callers outside `DriveRestorePanel.tsx`'s `handleRestore()`** (confirmed by grep — only call site is the one being deleted); it becomes dead code from this UI path. `project.ensureFolderPath()` (used in `syncBackup`/`getBackupFileId`/`restoreBackup`, e.g. lines 187-190, 229-232, 364-367) resolves the `OpenWebApp/Portfolio` folder id and is what Picker's default-folder scoping (Fix 2) will reuse — call it once inside `openDrivePicker()` to get the folder id for the Picker's starting view.
- `src/App.tsx`: wires `DriveRestorePanel` props including `handleConnect`/`handleDisconnect` callbacks that manage OAuth flow via `connectDrive()`/`disconnectDrive()`. Also imports `getBackupFileId` (a *different* function than `restoreBackup`, used for the "View in Google Drive" link) — not touched by this plan, confirmed no relation to the by-name restore lookup being removed.
- `src/lib/product-behavior.md` (lines 16-22): documents Drive sync behavior; currently mentions no backup fallback (paste-URL flow).
- `src/lib/design.md`: current component tree and data flows; currently describes paste-URL fallback.
- `.env` (repo root): currently one line, `VITE_GOOGLE_CLIENT_ID=...`. **No `.env.example` file exists in this repo** (confirmed via `ls -la .env*`) — nothing to update there; the new `VITE_GOOGLE_PICKER_API_KEY` var is documented in this plan and added directly to `.env`.

## Google Cloud setup requirements

**Picker API enablement** (confirm before starting):
1. Google Picker API must be enabled in the project's Google Cloud Console (projects page).
2. The existing `VITE_GOOGLE_CLIENT_ID` (in `.env`) must have Picker API scope included (`https://www.googleapis.com/auth/drive.readonly` or `https://www.googleapis.com/auth/drive`).
   - Verify in Google Cloud Console: OAuth 2.0 Client ID configuration for "Web application".
3. **A Picker API key is required** (confirmed with user, not a hypothesis to test). Get one from Google Cloud Console > Credentials > Create Credentials > API Key, then restrict it to: the Picker API, and the app's HTTP referrer origin(s) (`http://localhost:5173` for dev, production domain in deployed build). Store it as `VITE_GOOGLE_PICKER_API_KEY` in `.env` (see T8).
4. JavaScript origin in Google Cloud Console must include the app's domain (e.g., `http://localhost:5173` for dev, production domain in deployed build).

**Decision**: Implement Picker with both OAuth token (`setOAuthToken()`) and API key (`setDeveloperKey()`) from the start — this is required, not a follow-up.

## Resolved decisions (implement as-stated, do not re-litigate)

1. **Picker is the only restore entry point**: Clicking "Restore from Drive" always opens the Picker dialog immediately — no `restoreBackup()` by-name lookup call, no `noBackupFound` intermediate state. Replace both render sites of `DrivePasteFallback` (line 231 previously gated on `noBackupFound`, line 281 on `crossPasswordError`) with `DrivePickerFallback`, gated on a new `showPicker` state (site 1) and on `crossPasswordError` (site 2, unchanged trigger — cross-password retry still reopens Picker).
2. **OAuth + API key for Picker initialization**: Use the cached/refreshed token from `ensureFreshConnection()` to initialize Picker; fetch token via `getDriveConnection()` and pass to Picker's `setOAuthToken()`. Additionally call `setDeveloperKey()` with `VITE_GOOGLE_PICKER_API_KEY` from env — both are required together.
3. **Default folder scope**: `openDrivePicker()` resolves the `OpenWebApp/Portfolio` folder id via `project.ensureFolderPath()` and configures Picker's `DocsView` with `.setParent(folderId)` so Picker opens there by default. User can still navigate to any other folder they have access to via Picker's built-in "up"/navigation UI — nothing is restricted (`setSelectFolderEnabled`/similar left untouched).
4. **Picker file selection**: User selects a file from any folder → file id is extracted and passed to `restoreBackupFromFileId(fileId, restoreKey)` → existing confirm/restore/cross-password-retry flow applies.
5. **Remove paste component and state entirely**: Delete `DrivePasteFallback`, `pasteInput`, `pasteError`, `loadingPastedFile` state, and `handleLoadPastedFile` callback from `DriveRestorePanel.tsx`. Also remove the `restoreBackup()` call and `noBackupFound` state from `handleRestore()` (Fix 1) — replace with a `showPicker` boolean set directly on button click.
6. **Picker cancellation**: User closes Picker dialog → no-op (Picker UI dismisses, `showPicker` resets to false / cross-password-error state unchanged, Picker can be re-opened by clicking "Restore from Drive" again).
7. **No new state in DriveRestorePanel beyond `showPicker`**: Picker dialog's own open/loading/error state is managed by the `DrivePickerFallback` component internally; the parent only tracks whether the fallback should render (`showPicker`) plus existing `crossPasswordPrompt`/`crossPasswordError`.

## Architecture sketch

```
DriveRestorePanel (state: showPicker, crossPasswordPrompt+crossPasswordError)
  ├─ User clicks "Restore from Drive" button
  │  └─ handleRestore() → setShowPicker(true)   [no restoreBackup() lookup — Picker ALWAYS opens]
  │
  ├─ DrivePickerFallback rendered (line ~231, gated on showPicker; or line ~281, gated on crossPasswordError)
  │  ├─ Picker dialog opens immediately on render, defaulting to OpenWebApp/Portfolio folder
  │  │  (openDrivePicker() resolves folder id via ensureFolderPath(), sets DocsView parent)
  │  ├─ User selects file from that folder or navigates elsewhere in Drive
  │  ├─ Picker returns file id
  │  ├─ DrivePickerFallback calls onSelect(fileId)
  │  └─ onSelect callback invokes restore flow: confirm → restoreBackupFromFileId(fileId, restoreKey)
  │
  └─ On restore success/error, existing handlers (`onRestored`, cross-password-retry) apply
```

## Tasks

### T0 — worktree setup
Run:
```
git worktree add ../worktree-drive-restore-picker -b feature/drive-restore-picker
cd ../worktree-drive-restore-picker
npm install
```
Acceptance: `git worktree list` shows new worktree; `git status` shows branch `feature/drive-restore-picker`.

---

### T1 (dep: T0) — add Picker types and `openDrivePicker()` to drive.ts
File: `src/lib/drive.ts`

1. Add TypeScript interface definitions for Google Picker API at the top of the file (after imports, before the `drive` singleton):
   ```typescript
   /**
    * Google Picker API types and window augmentation.
    * The Picker library is loaded dynamically; these interfaces
    * support type-checking the initialization and picker builder.
    */
   interface GooglePickerDocsView {
     setParent(folderId: string): GooglePickerDocsView
   }

   interface GooglePickerBuilder {
     addView(view: GooglePickerDocsView): GooglePickerBuilder
     setOAuthToken(token: string): GooglePickerBuilder
     setDeveloperKey(apiKey: string): GooglePickerBuilder
     setOrigin(origin: string): GooglePickerBuilder
     setCallback(callback: (data: GooglePickerResponse) => void): GooglePickerBuilder
     build(): GooglePickerInstance
   }

   interface GooglePickerInstance {
     setVisible(visible: boolean): void
   }

   interface GooglePickerResponse {
     action: string
     docs?: Array<{
       id: string
       name: string
       mimeType: string
       type: string
     }>
   }

   interface GapiWindow extends Window {
     gapi?: {
       load: (lib: string, opts: { callback: () => void }) => void
       picker?: {
         PickerBuilder: new () => GooglePickerBuilder
         DocsView: new () => GooglePickerDocsView
       }
     }
   }
   ```
   Note: `DocsView` (constructible, supports `.setParent(folderId)`) replaces the earlier `ViewId.DOCS` enum-only approach — required for Fix 2's default-folder scoping.

2. Add module-level state variables (after the `TOKEN_REAUTH_BUFFER_MS` constant):
   ```typescript
   // Picker API loader cache: prevent multiple concurrent loadPickerApi() calls
   let pickerApiLoadPromise: Promise<void> | null = null

   /**
    * Tracks if Picker library is available (gapi.picker loaded).
    * Once loaded, remains loaded for the lifetime of the app.
    */
   let isPickerApiLoaded = false

   /**
    * Picker API key, required alongside the OAuth token (Google Picker
    * rejects init without both). Read once from env; undefined here means
    * misconfiguration, not "optional" — Picker will fail to open and
    * openDrivePicker() throws a descriptive error (see below).
    */
   const PICKER_API_KEY = import.meta.env.VITE_GOOGLE_PICKER_API_KEY as string | undefined
   ```

3. Add `loadPickerApi()` function (near the end of file, before or after `extractDriveFileId`) — unchanged from prior draft (loads `gapi.picker` from Google's CDN, caches the load promise).

4. Add `openDrivePicker()` exported function (near end of file, after `loadPickerApi`):
   ```typescript
   /**
    * Open a Google Picker dialog to select a file from the user's Drive.
    * Always starts in the `OpenWebApp/Portfolio` folder (same folder
    * syncBackup/restoreBackup use), resolved via ensureFolderPath(), but
    * the user can navigate to any other folder they have access to using
    * Picker's built-in navigation — nothing is restricted beyond the
    * starting view.
    *
    * Requires a valid, fresh OAuth token AND a Picker API key
    * (VITE_GOOGLE_PICKER_API_KEY) — Picker needs both to initialize.
    * Call `ensureFreshConnection()` before calling this to guarantee a
    * usable token.
    *
    * @param token The OAuth access token to authenticate Picker with
    * @param onSelect Callback when user selects a file: passed the Drive file id
    * @param onCancel Callback when user closes Picker without selecting
    * @throws Throws if Picker library fails to load, or if
    *   VITE_GOOGLE_PICKER_API_KEY is not configured
    */
   export async function openDrivePicker(
     token: string,
     onSelect: (fileId: string) => void,
     onCancel: () => void
   ): Promise<void> {
     if (!PICKER_API_KEY) {
       throw new Error('VITE_GOOGLE_PICKER_API_KEY is not set — Google Picker requires an API key')
     }

     await loadPickerApi()

     const gapiWindow = window as GapiWindow
     if (!gapiWindow.gapi?.picker?.PickerBuilder) {
       throw new Error('Google Picker API not available')
     }

     // Default Picker's starting folder to the app's own OpenWebApp/Portfolio
     // Drive folder — same folder syncBackup/restoreBackup read/write.
     const project = drive.project(APP_PROJECT_ID)
     const folderId = await withTimeout(
       project.ensureFolderPath(),
       DRIVE_IO_TIMEOUT_MS,
       'ensureFolderPath'
     )

     const docsView = new gapiWindow.gapi.picker.DocsView().setParent(folderId)

     // Callback from Picker: check action and extract file id
     const handlePickerResponse = (data: GooglePickerResponse) => {
       if (data.action === 'picked' && data.docs && data.docs.length > 0) {
         const fileId = data.docs[0].id
         onSelect(fileId)
       } else if (data.action === 'cancel') {
         onCancel()
       }
     }

     // Configure Picker: OAuth token + API key are both required
     const picker = new gapiWindow.gapi.picker.PickerBuilder()
       .setOAuthToken(token)
       .setDeveloperKey(PICKER_API_KEY)
       .setOrigin(window.location.origin)
       .addView(docsView)
       .setCallback(handlePickerResponse)
       .build()

     // Show the Picker dialog
     picker.setVisible(true)
   }
   ```

**Tests**: covered by T2 (this task alone leaves files in an intermediate state, no `restoreBackup` removal yet — that's T3/T4).

**Acceptance**:
- `grep -n "GooglePickerBuilder\|GooglePickerInstance\|openDrivePicker\|loadPickerApi\|setDeveloperKey\|setParent" src/lib/drive.ts` → all present.
- `npx tsc -b` passes with no errors.

---

### T2 (dep: T1) — add Picker-related tests to drive.test.ts
File: `src/lib/drive.test.ts`

1. Add test suite for `openDrivePicker()`:
   ```typescript
   describe('openDrivePicker', () => {
     let mockGapi: any
     let builderCalls: any

     beforeEach(() => {
       vi.stubEnv('VITE_GOOGLE_PICKER_API_KEY', 'fake-api-key')
       builderCalls = {}
       mockGapi = {
         load: vi.fn((lib, opts) => {
           if (lib === 'picker' && opts.callback) opts.callback()
         }),
         picker: {
           PickerBuilder: class {
             addView(view: any) { builderCalls.view = view; return this }
             setOAuthToken(token: string) { builderCalls.token = token; return this }
             setDeveloperKey(key: string) { builderCalls.apiKey = key; return this }
             setOrigin(origin: string) { builderCalls.origin = origin; return this }
             setCallback(cb: any) { builderCalls.callback = cb; return this }
             build() { return { setVisible: vi.fn() } }
           },
           DocsView: class {
             setParent(folderId: string) { builderCalls.parentFolderId = folderId; return this }
           },
         },
       }
       ;(window as any).gapi = mockGapi
     })

     afterEach(() => {
       delete (window as any).gapi
       vi.unstubAllEnvs()
     })

     it('passes OAuth token, API key, and default folder id to the Picker builder', async () => {
       // Assumes the module's Drive mock already returns a folder id from
       // project.ensureFolderPath() (same mock used by syncBackup/restoreBackup tests).
       await openDrivePicker('fake-token', vi.fn(), vi.fn())

       expect(builderCalls.token).toBe('fake-token')
       expect(builderCalls.apiKey).toBe('fake-api-key')
       expect(builderCalls.parentFolderId).toBeTruthy() // OpenWebApp/Portfolio folder id
     })

     it('throws a descriptive error when VITE_GOOGLE_PICKER_API_KEY is not set', async () => {
       vi.unstubAllEnvs()
       vi.stubEnv('VITE_GOOGLE_PICKER_API_KEY', '')
       await expect(openDrivePicker('fake-token', vi.fn(), vi.fn())).rejects.toThrow(/API key/i)
     })

     it('calls onSelect with the picked file id when Picker callback fires with action "picked"', async () => {
       const onSelect = vi.fn()
       await openDrivePicker('fake-token', onSelect, vi.fn())
       builderCalls.callback({ action: 'picked', docs: [{ id: 'picked-file-id', name: 'x', mimeType: 'application/json', type: 'file' }] })
       expect(onSelect).toHaveBeenCalledWith('picked-file-id')
     })

     it('calls onCancel when Picker callback fires with action "cancel"', async () => {
       const onCancel = vi.fn()
       await openDrivePicker('fake-token', vi.fn(), onCancel)
       builderCalls.callback({ action: 'cancel' })
       expect(onCancel).toHaveBeenCalled()
     })

     it('loads the Picker API library only once across repeated calls', async () => {
       await openDrivePicker('fake-token', vi.fn(), vi.fn())
       const firstLoadCalls = mockGapi.load.mock.calls.length
       await openDrivePicker('fake-token', vi.fn(), vi.fn())
       expect(mockGapi.load.mock.calls.length).toBe(firstLoadCalls) // cached, no second load
     })
   })
   ```

2. Keep existing `extractDriveFileId` tests (already present, lines ~420-439) — `extractDriveFileId` itself is unrelated to Fix 1's `restoreBackup` removal and still used to normalize a raw file id if ever needed; leave untouched unless T3/T4 find it dead too (check at that point).

**Acceptance**:
- `npx vitest run src/lib/drive.test.ts` passes with new Picker tests.
- `grep -n "openDrivePicker\|loadPickerApi\|setDeveloperKey" src/lib/drive.test.ts` → new tests present.

---

### T3 (dep: T1, T2) — create DrivePickerFallback component, remove restoreBackup-by-name call path
File: `src/components/DriveRestorePanel.tsx`

1. Replace the `DrivePasteFallback` component (lines 11-44) with a new `DrivePickerFallback` component:
   ```typescript
   function DrivePickerFallback({
     onSelect,
     onCancel,
     restoring,
   }: {
     onSelect: (fileId: string) => void
     onCancel: () => void
     restoring: boolean
   }) {
     const [error, setError] = useState<string | null>(null)
     const [pickerLoading, setPickerLoading] = useState(false)

     useEffect(() => {
       // Open Picker immediately when this component mounts (i.e. as soon
       // as the user clicks "Restore from Drive" — no lookup step first).
       const openPicker = async () => {
         if (pickerLoading || restoring) return

         setPickerLoading(true)
         setError(null)
         try {
           const conn = await getDriveConnection()
           if (!conn || !conn.accessToken) {
             setError('No Drive connection available. Please reconnect.')
             return
           }
           await openDrivePicker(
             conn.accessToken,
             (fileId: string) => {
               setPickerLoading(false)
               onSelect(fileId)
             },
             () => {
               setPickerLoading(false)
               onCancel()
             }
           )
         } catch (err) {
           setPickerLoading(false)
           setError(`Failed to open file picker: ${err instanceof Error ? err.message : String(err)}`)
         }
       }

       openPicker()
     }, [onSelect, onCancel, pickerLoading, restoring])

     if (error) {
       return (
         <div style={{ marginTop: 'var(--space-3)', color: 'var(--color-error)', fontSize: '0.9rem' }}>
           {error}
           <button
             className="btn btn-secondary"
             onClick={() => setError(null)}
             style={{ marginTop: 'var(--space-2)' }}
           >
             Retry
           </button>
         </div>
       )
     }

     if (pickerLoading) {
       return (
         <div style={{ marginTop: 'var(--space-3)', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
           Opening file picker...
         </div>
       )
     }

     return null
   }
   ```

2. Update imports at the top of file — **drop `restoreBackup`** (no longer called from this file), keep the rest:
   ```typescript
   import { useEffect } from 'react'
   import {
     restoreBackupFromFileId,
     openDrivePicker,
     getDriveConnection,
     DriveDecryptError,
   } from '../lib/drive'
   ```

3. Remove `DrivePasteFallback` (old lines 11-44).

4. Remove paste-related imports (e.g., `extractDriveFileId` if it's still there — confirm with grep in T2 whether it's used elsewhere first; if `extractDriveFileId` has no other callers after this change, remove it and its tests too, same treatment as `restoreBackup`).

**Tests**: covered by T5.

**Acceptance**:
- `grep -n "DrivePasteFallback\|pasteInput\|pasteError\|loadingPastedFile" src/components/DriveRestorePanel.tsx` → 0 matches.
- `grep -n "DrivePickerFallback" src/components/DriveRestorePanel.tsx` → component present.
- `grep -n "^import.*restoreBackup[^F]" src/components/DriveRestorePanel.tsx` → 0 matches (only `restoreBackupFromFileId` remains, not `restoreBackup`).
- `npx tsc -b` passes.

---

### T4 (dep: T3) — wire "Restore from Drive" button to open Picker immediately, remove paste + lookup state/handlers
File: `src/components/DriveRestorePanel.tsx`

1. Remove the paste-related state (lines 84-86):
   ```typescript
   // DELETE:
   // const [pasteInput, setPasteInput] = useState('')
   // const [pasteError, setPasteError] = useState<string | null>(null)
   // const [loadingPastedFile, setLoadingPastedFile] = useState(false)
   ```

2. Remove `handleLoadPastedFile` callback (lines 115-145).

3. Replace `noBackupFound` state and the `restoreBackup()`-calling `handleRestore()` with a `showPicker` boolean set directly on click — **no lookup call, no async gate before Picker opens**:
   ```typescript
   // DELETE:
   // const [noBackupFound, setNoBackupFound] = useState(false)
   // async function handleRestore() {
   //   setSyncing(true)
   //   try {
   //     const restored = await restoreBackup(restoreKey)
   //     if (!restored) { setNoBackupFound(true); return }
   //     ...
   //   } finally { setSyncing(false) }
   // }

   // NEW:
   const [showPicker, setShowPicker] = useState(false)

   function handleRestore() {
     // Picker is the only restore entry point — always open it immediately,
     // no by-name lookup in the app's own Drive folder first.
     setShowPicker(true)
   }
   ```

4. Replace both render sites of `DrivePasteFallback` with `DrivePickerFallback`:

   **Site 1** (current line ~231, was gated on `noBackupFound` — now gated on `showPicker`):
   ```typescript
   {showPicker && (
     <DrivePickerFallback
       onSelect={async (fileId: string) => {
         if (!window.confirm('Restore will replace all data with the backed-up version. Continue?')) return

         setSyncing(true)
         try {
           const restored = await restoreBackupFromFileId(fileId, restoreKey)
           onRestored(restored, restoreKey, restoreSalt)
           setShowPicker(false)
           setCrossPasswordPrompt(null)
           setCrossPasswordError(null)
           alert('Restored from Drive')
         } catch (error) {
           if (error instanceof DriveDecryptError) {
             setCrossPasswordPrompt({ salt: error.salt, envelope: error.envelope })
             setCrossPasswordError(null)
             setBackupPasswordInput('')
             return
           }
           console.error('Restore from picked file failed:', error)
           alert(`Restore failed: ${error instanceof Error ? error.message : String(error)}`)
         } finally {
           setSyncing(false)
         }
       }}
       onCancel={() => {
         // User closed Picker without selecting — reset so "Restore from
         // Drive" can be clicked again to reopen it.
         setShowPicker(false)
       }}
       restoring={syncing}
     />
   )}
   ```

   **Site 2** (current line ~281, inside cross-password-error block — trigger condition unchanged, still `crossPasswordError`):
   ```typescript
   {crossPasswordError && (
     <DrivePickerFallback
       onSelect={async (fileId: string) => {
         if (!window.confirm('Restore will replace all data with the backed-up version. Continue?')) return

         setSyncing(true)
         try {
           const restored = await restoreBackupFromFileId(fileId, restoreKey)
           onRestored(restored, restoreKey, restoreSalt)
           setCrossPasswordPrompt(null)
           setCrossPasswordError(null)
           setBackupPasswordInput('')
           alert('Restored from Drive')
         } catch (error) {
           if (error instanceof DriveDecryptError) {
             setCrossPasswordPrompt({ salt: error.salt, envelope: error.envelope })
             setCrossPasswordError(null)
             setBackupPasswordInput('')
             return
           }
           console.error('Restore from picked file failed:', error)
           alert(`Restore failed: ${error instanceof Error ? error.message : String(error)}`)
         } finally {
           setSyncing(false)
         }
       }}
       onCancel={() => {
         // User closed Picker during cross-password retry — state unchanged
       }}
       restoring={syncing}
     />
   )}
   ```

**Tests**: covered by T5.

**Acceptance**:
- `grep -n "pasteInput\|pasteError\|loadingPastedFile\|handleLoadPastedFile\|extractDriveFileId\|noBackupFound\|restoreBackup(" src/components/DriveRestorePanel.tsx` → 0 matches (note: `restoreBackupFromFileId` is a different string and will still match `restoreBackup` as a substring — use `restoreBackup(` with the paren to exclude it).
- `grep -n "showPicker" src/components/DriveRestorePanel.tsx` → present, drives both the click handler and site-1 render gate.
- File compiles: `npx tsc -b`.

---

### T5 (dep: T4) — rewrite DriveRestorePanel.test.tsx for Picker flow
File: `src/components/DriveRestorePanel.test.tsx`

1. Update imports: replace `extractDriveFileId`/`restoreBackup` mocks with `openDrivePicker`:
   ```typescript
   import { openDrivePicker, getDriveConnection, restoreBackupFromFileId, DriveDecryptError } from '../lib/drive'
   ```

2. Remove all mocks/tests related to paste-input flow (e.g., "garbage input shows error", "invalid input doesn't call restore") and to the old by-name lookup (e.g., any test that mocked `restoreBackup` to resolve/reject and asserted on `noBackupFound` UI). Keep structural tests but rewrite interaction mechanics:

   Old flow: click "Restore" → `restoreBackup()` lookup → null → paste input shown → type/submit → restore.
   New flow: click "Restore" → Picker opens immediately (no lookup) → select file → callback → confirm → restore.

3. Rewrite existing tests to mock `openDrivePicker` instead of paste interactions and instead of `restoreBackup`. Example test structure:

   ```typescript
   it('opens Picker immediately when "Restore from Drive" is clicked — no lookup first', async () => {
     const mockOpenPicker = vi.mocked(openDrivePicker)
     mockOpenPicker.mockImplementation(async (_token, onSelect, _onCancel) => {
       // resolved lazily; test drives onSelect directly below
     })

     const onRestored = vi.fn()
     render(
       <DriveRestorePanel
         driveReady={true}
         driveEmail="user@gmail.com"
         backupFileId={null}
         syncing={false}
         setSyncing={vi.fn()}
         handleConnect={vi.fn()}
         handleDisconnect={vi.fn()}
         restoreKey={mockKey}
         restoreSalt={mockSalt}
         onRestored={onRestored}
       />
     )

     // Click "Restore from Drive"
     fireEvent.click(screen.getByRole('button', { name: /Restore from Drive/i }))

     // Picker opens immediately — no by-name lookup call of any kind first
     await waitFor(() => expect(mockOpenPicker).toHaveBeenCalled())

     // Confirm restore in the dialog
     vi.spyOn(window, 'confirm').mockReturnValue(true)

     // Simulate file selection callback from Picker
     const [, onSelect] = mockOpenPicker.mock.calls[0]
     await onSelect('picked-file-id')

     // Wait for restore to complete
     await waitFor(() => expect(onRestored).toHaveBeenCalled())
   })
   ```

4. Remove old Picker-related tests if they exist from any attempted Picker implementation with stale assumptions (e.g., tests keyed off `noBackupFound`).

5. Ensure test coverage for:
   - Picker opens immediately when "Restore from Drive" is clicked (no `restoreBackup` lookup call at all — assert it's never invoked, or that the import doesn't even exist in the component anymore)
   - Picker opens when `crossPasswordError` is non-null (cross-password retry path, unchanged trigger)
   - User cancels Picker → no-op, "Restore from Drive" can be clicked again to reopen
   - User selects file → confirm → restore (success)
   - User selects file → user declines confirm → no-op
   - Restore from picked file throws `DriveDecryptError` → cross-password prompt
   - Restore from picked file throws generic error → alert + UI remains in fallback state
   - Multiple Picker open/cancel cycles

**Acceptance**:
- `npx vitest run src/components/DriveRestorePanel.test.tsx` passes, 0 failures.
- `grep -n "pasteInput\|pasteError\|DrivePasteFallback\|extractDriveFileId\|noBackupFound" src/components/DriveRestorePanel.test.tsx` → 0 matches.
- Test suite includes an explicit assertion that `restoreBackup` (by-name lookup) is never called from this component's restore path.

---

### T6 (dep: T4) — update Settings.test.tsx for Picker flow
File: `src/components/Settings.test.tsx`

Since `Settings.tsx` just renders `<DriveRestorePanel ... />` unchanged, its tests that exercise the restore flow need to be updated to mock `openDrivePicker` instead of paste interactions or the removed `restoreBackup` lookup (same approach as T5).

1. Update imports: use `openDrivePicker` mock instead of paste-related mocks; drop any `restoreBackup` mock setup tied to the old lookup-first flow.
2. Rewrite any tests that used to simulate paste-input interactions (fireEvent.change, button clicks) or that asserted on `noBackupFound`-driven UI to instead simulate Picker callbacks triggered directly off the "Restore from Drive" click.
3. Keep same outcome assertions (file-select → restore flow, error handling, etc.).

**Acceptance**:
- `npx vitest run src/components/Settings.test.tsx` passes, 0 failures.
- `grep -n "pasteInput\|pasteError\|DrivePasteFallback\|extractDriveFileId\|noBackupFound" src/components/Settings.test.tsx` → 0 matches.

---

### T7 (dep: T4) — update PasswordGate.test.tsx for Picker flow
File: `src/components/PasswordGate.test.tsx`

Same treatment as T6: update Picker-flow tests (lines in PasswordGate where `DriveRestorePanel` is rendered) to mock `openDrivePicker` callbacks — triggered directly by the "Restore from Drive" click, not by a lookup result — instead of paste interactions or `noBackupFound`-gated assertions.

**Acceptance**:
- `npx vitest run src/components/PasswordGate.test.tsx` passes, 0 failures.
- `grep -n "pasteInput\|pasteError\|DrivePasteFallback\|extractDriveFileId\|noBackupFound" src/components/PasswordGate.test.tsx` → 0 matches.

---

### T8 (dep: T1) — wire the required Picker API key into `.env`
Files: `.env` (repo root)

**Note**: no `.env.example` exists in this repo (confirmed) — nothing to update there. `VITE_GOOGLE_CLIENT_ID` is the only precedent for how an env var is documented (inline in this plan / README, not a template file).

1. Obtain a Picker API key from Google Cloud Console (Credentials > Create Credentials > API Key), restricted to the Picker API and the app's origin(s) — see "Google Cloud setup requirements" above.
2. Add it to `.env`:
   ```
   VITE_GOOGLE_CLIENT_ID=...
   VITE_GOOGLE_PICKER_API_KEY=...
   ```
3. Confirm `openDrivePicker()` (T1) reads it via `import.meta.env.VITE_GOOGLE_PICKER_API_KEY` and calls `setDeveloperKey()` with it — this code is already in place from T1; this task is about the actual key value existing in the environment, not writing new code.
4. Restart the dev server (`npm run dev`) so Vite picks up the new env var, and manually confirm Picker opens without the "API key is not set" error from T1.

**Acceptance**:
- `grep -n "VITE_GOOGLE_PICKER_API_KEY" .env` → present with a non-empty value.
- `grep -n "VITE_GOOGLE_PICKER_API_KEY" src/lib/drive.ts` → present (from T1), confirms the code path is wired to this var.
- Manual check: dev server run, "Restore from Drive" clicked, Picker dialog opens (no API-key error).

---

### T9 (dep: T8) — update product-behavior.md for Picker-based restore
File: `src/lib/product-behavior.md`

Add/update section under "Google Drive Sync" (around line 16-22):

```markdown
### Restore from Google Drive

When the user clicks "Restore from Drive" on the Restore tab (PasswordGate) or Settings > Drive, a Google File Picker dialog opens immediately — there is no automatic lookup of a backup by name in the app's own folder first. Picker is the only restore entry point.

1. **Picker opens on click**: Picker's starting folder defaults to the app's own `OpenWebApp/Portfolio` Drive folder, but the user can navigate to any other folder they have access to using Picker's built-in navigation.
2. **File selection**: After the user picks a file, the app asks for confirmation ("Restore will replace all data..."). Restore proceeds with the current session password via `restoreBackupFromFileId`.
3. **Cross-password restore**: If the backup was encrypted with a different password, the app prompts "This backup was saved with a different encryption password. Enter that password to restore:". After the user enters the backup's password and confirms, the app reattempts restore. If the password is wrong, the error is shown and Picker reopens for another attempt.

### Restore Behavior Details

- **No automatic file lookup, ever**: The app never automatically probes for a backup file by name, neither on app startup nor on Restore click. Picker is always the mechanism for choosing which file to restore.
- **Picker cancellation**: If the user closes the Picker dialog without selecting a file, the Picker can be reopened by clicking "Restore from Drive" again.
- **OAuth + API key required**: Picker needs both a valid Google OAuth token and a configured Picker API key (`VITE_GOOGLE_PICKER_API_KEY`) to open. If a valid cached OAuth token exists, no auth window appears — Picker opens directly with the cached token. If the token is expired, the standard Google auth flow runs before Picker opens. A missing API key surfaces as an explicit error in the Picker fallback UI, not a silent failure.
```

**Acceptance**:
- Section is added/updated; grammar/clarity correct.
- No mentions of "paste URL", "paste file ID", "DrivePasteFallback", "lookup by name", or "noBackupFound" remain in this file.
- No language suggesting the API key is optional.

---

### T10 (dep: T8) — update design.md for Picker-based restore data flows
File: `src/lib/design.md`

1. Update component tree or comments mentioning `DrivePasteFallback` to describe `DrivePickerFallback`.
2. Update "Data Flows" or "Restore Flow" section (if present) to describe the always-open, folder-scoped, API-key-backed Picker flow:

   ```markdown
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
   ```

3. Remove/update any mentions of `extractDriveFileId`, paste-URL parsing, `DrivePasteFallback`, the by-name `restoreBackup()` lookup path, or API-key-as-optional framing.

**Acceptance**:
- `grep -n "paste\|Paste\|DrivePasteFallback\|extractDriveFileId\|noBackupFound" src/lib/design.md` → 0 matches related to Drive restore.
- `grep -n "optional" src/lib/design.md` → no hits framing the Picker API key as optional.
- Picker flow is documented; no stale references remain.

---

### T11 (dep: T9, T10) — full-file re-read of updated docs (staleness check)
Files: `src/lib/product-behavior.md`, `src/lib/design.md` (read-only, full file each).

Per CLAUDE.md's mandatory rule for feature changes: re-read both files in full. Check:
- No other paragraph anywhere mentions paste-URL, `extractDriveFileId`, `DrivePasteFallback`, `noBackupFound`, or the old by-name-lookup-first restore flow.
- No paragraph frames the Picker API key as optional, a nice-to-have, or a "follow-up if testing reveals it's necessary."
- Picker flow description is consistent between the two files: always opens on click, defaults to `OpenWebApp/Portfolio` with browse-elsewhere allowed, requires OAuth token + API key together.
- Terse/token-optimized style preserved.
- New Picker flow accurately reflects behavior in code (T1, T3, T4).

**Acceptance**:
- `grep -rn "paste\|Paste\|DrivePasteFallback\|extractDriveFileId\|noBackupFound" src/lib/product-behavior.md src/lib/design.md` → 0 matches (except in comments explaining why it was removed, if any).
- `grep -rn "optional" src/lib/product-behavior.md src/lib/design.md` → no hits framing the Picker API key as optional.
- Any inconsistencies or stale content found is fixed here.

---

### T12 (dep: T5, T6, T7, T11) — full test/lint/build gate
Files: none (verification only).

```
npm run test
npm run lint
npm run build
```

Fix any failures (type errors, lint, broken tests). Confirm the build doesn't warn about an unused `VITE_GOOGLE_PICKER_API_KEY` reference and that `restoreBackup`/`extractDriveFileId` removal (if applicable, per T3/T4) didn't leave orphaned imports.

**Acceptance**: all three exit 0 with 0 failures/warnings.

---

### T13 (dep: T12) — commit
Files: none (git operation).

```
git add -A
git commit -m "$(cat <<'EOF'
Replace paste-URL fallback with Google Picker for Drive restore

- DriveRestorePanel: "Restore from Drive" now always opens Google
  Picker immediately (no more silent by-name lookup in the app's own
  Drive folder before falling back); paste-input field removed entirely
- drive.ts: add Picker API setup (loadPickerApi, openDrivePicker);
  Picker defaults to the OpenWebApp/Portfolio folder via
  ensureFolderPath()/DocsView.setParent() but allows browsing elsewhere;
  requires both an OAuth token and a Picker API key
  (VITE_GOOGLE_PICKER_API_KEY, setDeveloperKey) — API key is required,
  not optional; remove restoreBackup()/extractDriveFileId() (dead code,
  no remaining callers)
- DrivePickerFallback: new component that opens Picker on mount,
  calls onSelect(fileId) when file is picked, streams file selection
  to existing restore flow
- .env: add required VITE_GOOGLE_PICKER_API_KEY
- Update product-behavior.md and design.md to document the always-open,
  folder-scoped, API-key-backed Picker flow

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
EOF
)"
git status
```

**Acceptance**: commit created; `git status` clean.

---

### T14 (dep: T13) — remove worktree
Files: none (git operation).

```
cd /Users/mdoraiswamy/owa/portfolio
git worktree remove ../worktree-drive-restore-picker
```

**Acceptance**: `git worktree list` no longer shows the removed worktree.

---

## Overall acceptance criteria (plan "done")

1. **Google Picker integration**: `openDrivePicker()` function exists in `drive.ts`, accepts OAuth token and callbacks, opens Picker dialog in-browser, defaulting to the `OpenWebApp/Portfolio` folder.
2. **Picker is the only restore entry point**: Clicking "Restore from Drive" always opens Picker immediately — no `restoreBackup()` by-name lookup call anywhere in this path, no `noBackupFound` state.
3. **Folder-scoped default, browsable**: Picker's starting view is `OpenWebApp/Portfolio` (via `ensureFolderPath()` + `DocsView.setParent()`); user can navigate to any other folder they have access to.
4. **API key required**: `VITE_GOOGLE_PICKER_API_KEY` is a required env var; `openDrivePicker()` calls `setDeveloperKey()` with it alongside `setOAuthToken()`; missing key throws a descriptive error surfaced in the UI, not silently ignored.
5. **Restore flow**: Picker opens on "Restore from Drive" click OR when cross-password error occurs (after wrong-password attempt). Same restore logic as before (confirm → restoreBackupFromFileId → decrypt → cross-password-retry on mismatch).
6. **No paste fallback, no dead lookup code**: `DrivePasteFallback`, paste state, `extractDriveFileId`, and `restoreBackup()` (by-name lookup) are removed from the codebase (confirmed no other callers via grep before removal).
7. **Tests pass**: All existing tests pass with new Picker mocks. Coverage includes Picker opening immediately on click, cancel, file selection, restore success/error, cross-password flow, multiple pick cycles, and API-key-missing error.
8. **Reference docs updated**: `product-behavior.md` and `design.md` describe the always-open, folder-scoped, API-key-required Picker flow with no stale paste or lookup-first references.
9. `npm run test`, `npm run lint`, `npm run build` all pass.
10. Change committed on `feature/drive-restore-picker`; worktree torn down.

## Test strategy

- Unit tests (drive.test.ts): `openDrivePicker()` calls correct Picker builders, passes OAuth token + API key, sets the default folder parent via `ensureFolderPath()`/`DocsView.setParent()`, invokes callbacks on pick/cancel, throws when the API key is missing.
- Component tests (DriveRestorePanel.test.tsx, Settings.test.tsx, PasswordGate.test.tsx): mock `openDrivePicker` to verify Picker opens immediately on "Restore from Drive" click (never gated behind a lookup) and on `crossPasswordError`; file selection invokes restore, error handling re-opens Picker or shows cross-password prompt.
- Integration test (manual): Open app, click Restore, verify Picker dialog opens immediately with Google's UI defaulting to the `OpenWebApp/Portfolio` folder, navigate to another folder and back, select a file, confirm restore, verify state hydration.
- No new test framework; use existing vitest + jsdom + `vi.mocked` for Picker mock.

## Risks & mitigations

- **Picker API availability**: Depends on gapi.picker being available from Google's CDN. If CDN is down or browser blocks the script, Picker fails to load. Mitigation: `loadPickerApi()` throws descriptive error; `DrivePickerFallback` catches and displays error with "Retry" button.
- **OAuth token expiry during Picker use**: User opens Picker, token expires, Picker becomes unusable. Mitigation: `openDrivePicker()` always receives token from `getDriveConnection()` at call time (never cached in Picker); if token expires mid-Picker, Picker's callback silently fails or shows error (Google's behavior, not our control). Acceptable because Picker error handling already surfaces a retry.
- **Missing/misconfigured API key**: Picker requires `VITE_GOOGLE_PICKER_API_KEY` to be set and correctly restricted in Google Cloud Console. Mitigation: `openDrivePicker()` throws a specific, greppable error string ("VITE_GOOGLE_PICKER_API_KEY is not set...") rather than failing silently or with an opaque Google error; T8's manual check catches misconfiguration before commit.
- **Backward compatibility**: Existing restore flow (`restoreBackupFromFileId`, cross-password-retry, sync, etc.) is unchanged. `restoreBackup()` (by-name lookup) and `extractDriveFileId()` are removed as dead code — confirmed via grep to have no other callers before deletion (T1's Key Facts section, re-verify in T3/T4 if code has drifted since planning).

## Out of scope

- Reauth flow refinements (user still clicks "Restore from Drive" → Picker opens; if token is expired, Google auth window runs first).
- Changes to `restoreBackupFromFileId`, `readAndDecryptFile`, `DriveDecryptError`, `ensureFreshConnection`, token refresh logic.
- Changes to PasswordGate/Settings component structure (only their test files change).
- Transactions restore/sync (positions-only, no change).
- Backup file version/migration (no schema changes).
