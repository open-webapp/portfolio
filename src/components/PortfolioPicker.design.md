# PortfolioPicker — Design

Sibling doc: `PortfolioPicker.product-behavior.md` (user-visible behavior, edge cases, exact copy).

## Location

`src/components/PortfolioPicker.tsx` — rendered by `App.tsx` when `route.name === 'picker'`, in place of the gate/app shell. `activePortfolio` stays `null` while this route is active (no per-portfolio load/persist/drive effects run).

## Props (`PortfolioPickerProps`)

| Prop | Type | Purpose |
|---|---|---|
| `portfolios` | `Portfolio[]` | Existing local portfolios to list |
| `onCreateNew` | `(name: string, password: string) => Promise<void>` | Submit handler for the Create panel |
| `onRename` | `(id: string, newName: string) => Promise<void>` | Inline rename on the list |
| `onDelete` | `(id: string) => Promise<void>` | Delete on the list (after `window.confirm`) |
| `onOpen` | `(id: string) => void` | Open an existing portfolio |
| `onImportFromDriveFolder` | `(folder: {name: string; id: string}, password: string) => Promise<void>` | Submit handler for a Drive-folder row |
| `onImportFromFile` | `(envelope: EncryptedEnvelope, name: string, password: string) => Promise<void>` | Submit handler for the file-import panel |
| `onListDriveFolders` | `() => Promise<{name: string; id: string}[]>` | Lists Drive subfolders of `OpenWebApp/Portfolio` |
| `isOnline` | `boolean` | Gates the "Load from Google Drive" trigger |

## Local state

**Mode controls / list / rename** (top-level):
- `pickerMode: 'open' | 'create' | 'drive' | 'settings'` — defaults to `open`; controls the only rendered top-level panel
- `renamingId: string | null`, `renameDraft: string`
- `createDraft: string`, `error: string | null` (unused by current create-error path; create errors go through `createError`)

**Create panel:**
- `creatingPasswordOpen: boolean`
- `newPassword: string`, `newConfirm: string`
- `createError: string | null`
- `creating: boolean`

**File-import panel:**
- `fileInputRef: RefObject<HTMLInputElement>` (hidden `<input type="file">`)
- `fileImportEnvelope: EncryptedEnvelope | null` — gates whether the name/password panel renders
- `fileImportName: string` — prefilled from filename minus extension, editable
- `fileImportPassword: string`
- `fileImportError: string | null`
- `fileImporting: boolean`

**Drive-folder panel (`pickerMode === 'drive'`):**
- `driveFoldersOpen: boolean` — whether the panel (rows or error) is shown
- `driveFolders: {name: string; id: string}[] | null` — post-filter list, `null` on connect error
- `driveListError: string | null` — "Couldn't connect to Google Drive."
- `driveListLoading: boolean`
- `driveEmptyMessage: string | null` — one of the two empty-state strings, or `null`
- `driveRowState: Record<folderId, DriveRowState>` — **per-row**, keyed by folder id:
  ```ts
  interface DriveRowState {
    password: string
    error: string | null
    importing: boolean
    passwordOpen: boolean
  }
  ```

## Panel state machines

- **Top-level modes**: `Open`, `Create`, `Google Drive`, and icon-only `Settings` (gear, `aria-label="Settings"`) are radio-backed `.seg` options below the centered `Ledger` / `Your portfolios` heading. Text tabs share width (`flex: 1`, centered); the gear tab is narrow (`flex: 0 0 48px`, `justify-content: flex-end`) so it never overlaps the Drive label. The tab bar stays visible in every mode. Changing a mode only changes which panel is rendered; it does not reset inactive panel state. The Drive card renders labeled `My portfolios` restore and `Shared portfolio` Picker/password sections sequentially, separated by `.hr`.
- **Create**: `closed` (name field enabled, "Create" button) → `open` (password+confirm shown, name field disabled) on Create click with non-blank name → `submitting` (`creating=true`, button "Creating...") on valid submit → **success**: unmounts via route change in `App.tsx`, no local reset needed → **error**: `createError` set, `newPassword`/`newConfirm` cleared, stays `open`. "Cancel" from `open` → `closed`, clearing password state.
- **File import**: `idle` (no envelope) → on file pick, either `error` (`fileImportError` set, envelope stays `null`, stays effectively `idle`) or `open` (envelope set, name prefilled, password field shown) → `submitting` (`fileImporting=true`) on submit → **success**: `resetFileImport()` + clears file input value, then route change → **error**: `fileImportError` set, `fileImportPassword` cleared, envelope/name preserved, stays `open`. "Cancel" from `open` → `idle` via `resetFileImport()` + clears file input value.
- **Drive folders**: `closed` → `loading` (`driveListLoading=true`) on trigger click → either `error` (`driveListError` set, `driveFolders=null`, `driveFoldersOpen=true`) or `listed` (`driveFolders` = filtered array, `driveEmptyMessage` set if applicable, `driveFoldersOpen=true`). "Dismiss" on `error` → `closed` (`driveFoldersOpen=false`). Each row within `listed` has its **own independent** sub-machine keyed by folder id in `driveRowState`: `collapsed` (`passwordOpen=false`) → `open` (`passwordOpen=true`) on that row's Import click → `submitting` (`importing=true`) on submit → **success**: route change (no local row reset needed, component unmounts) → **error**: that row's `error` set, `password` cleared, `passwordOpen` stays `true`. Toggling one row's `passwordOpen` never touches any other row's entry in the map.

## Data flow

`PortfolioPicker` never talks to Drive, IndexedDB, or crypto directly — every panel submit calls one of its callback props and lets the returned promise reject to drive that panel's inline error UI. The chain for all three flows is: **`PortfolioPicker` (panel submit: `onCreateNew` / `onImportFromDriveFolder` / `onImportFromFile`) → `App.tsx` handler (`handleCreateNewPortfolio` / `handleImportFromDriveFolder` / `handleImportFromFile`) derives/decrypts key+salt+state (via `lib/crypto.ts` `deriveKey`/`generateSalt`, or `lib/drive.ts` `decryptDriveFolderBackup`, or `lib/importExport.ts` `decryptImportEnvelope`/`getEnvelopeSaltBytes`) → `lib/portfolioRegistry.ts` `createPortfolio(name)` registers the new portfolio (rejects on name collision) → `lib/persist.ts` `savePersistedApp` writes the encrypted state to the new portfolio's own IndexedDB → `App.tsx` `handleOpenUnlocked(portfolio, key, salt, state)` activates the portfolio, sets session key/salt, dispatches `__SET_STATE`, sets `gateShape('encrypted')` as a placeholder → router `navigateToPortfolio(portfolio.id)`** — landing directly in the unlocked app shell; `PasswordGate` is never rendered for this first open.

## Error-type mapping (submit handlers → inline message)

| Source | Error type | Panel | Message |
|---|---|---|---|
| `onCreateNew` reject | any `Error` | Create | `err.message`, else "A portfolio with this name already exists." |
| `onImportFromDriveFolder` reject | `DriveDecryptError` | Drive row | "Incorrect password." |
| `onImportFromDriveFolder` reject | `DriveMalformedBackupError` | Drive row | "Could not import this portfolio." |
| `onImportFromDriveFolder` reject | other `Error` | Drive row | `err.message` |
| `onListDriveFolders` reject | any | Drive panel | "Couldn't connect to Google Drive." |
| file pick / `parseImportFile` throw | `ImportMalformedFileError` | File import | "This is not a valid backup file." |
| file pick throw | other `Error` | File import | `err.message`, else "Could not read the selected file." |
| `onImportFromFile` reject | `ImportDecryptError` | File import | "Incorrect password." |
| `onImportFromFile` reject | other `Error` | File import | `err.message`, else "Could not import this file." |

## Design patterns

- Controlled inputs throughout; no uncontrolled form state beyond the file `<input>` itself (cleared imperatively via `fileInputRef.current.value = ''` on cancel/success so re-picking the same filename re-fires `onChange`).
- Uses existing design-system classes only (`card blueprint elev-sm`, `seg`/`seg-opt`, `field`/`input`, `btn`/`btn-primary`/`btn-secondary`/`btn-ghost`/`btn-icon`, `tag tag-outline`); layout/spacing via inline `style` on wrapper `div`s. Picker column max width is 520px. Settings has a heading and import/download local-file icon actions (no Close button — tab switching is the exit); explanatory copy, summary/Manage, and `.hr` precede its separate Drive-sharing control. `showCategoryMappings` renders `CategoryMappingsDialog` with live global mappings; its update/delete callbacks derive, persist, then replace picker-local global state.
- Drive-folder name-collision filtering (`nameKey` from `lib/portfolioRegistry.ts`) happens client-side in the picker after `onListDriveFolders()` resolves — the callback itself returns the unfiltered Drive listing.
- Per-row keyed state (`Record<folderId, DriveRowState>`) is the pattern for any future list-of-independent-inline-forms UI in this component.
