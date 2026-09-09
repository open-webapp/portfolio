# Plan: Drive Connect — Phase 3 (Portfolio migration)

Goal: move portfolio off its hand-rolled Google-Drive **auth** code and onto the `@open-webapp/drive-connect` package built in Phase 1 and already proven on notesdiary in Phase 2. Portfolio keeps 100% of its **content** logic (sync, restore, picker, cross-password, conflict reconcile). Only auth — status, connect, disconnect, token freshness, the in-flight guard, the warm-up listeners, and the connect/disconnect UI — moves into the package.

Caveman rules: short tasks (~30min each), explicit `T#` deps, exact file paths per task, test per task (happy + edge + error), reference docs mandatory. Commit ONLY after `npm run test` + `npm run build` both pass and every reference doc is current. FIRST task = create isolated git worktree; LAST task = merge to local `main` and tear it down. NEVER push.

Phases 1 (package) and 2 (notesdiary) are DONE before this starts. Portfolio is the **most demanding consumer** and migrates **LAST** — see Risks.

## Scope

IN:
- `src/lib/drive.ts` — delete the auth half, create the auth handle, rewire the four content ops.
- `src/components/DriveRestorePanel.tsx` — split: connect/disconnect block deleted, restore block kept.
- `src/components/Settings.tsx` — mount `<GoogleDriveWidget>`; rewire `handleChangePassword`.
- `src/components/PasswordGate.tsx` — mount `<GoogleDriveWidget>` PRE-UNLOCK; resolve the dummyKey question.
- `src/App.tsx` — delete `driveReady`/`driveEmail` + two status effects + `handleConnect`/`handleDisconnect` + the `drive.activate()` boot effect; keep everything else.
- `src/components/Nav.tsx` — `driveReady` prop renamed `connected` (sourced from the package hook); Sync button always rendered, disabled when disconnected.
- `src/index.css` — package `dist/styles.css` import + `--owa-drive-*` token mapping (NOT `styles.css`).
- Tests: `drive.test.ts`, `DriveRestorePanel.test.tsx`, `PasswordGate.test.tsx`, `Settings.test.tsx`, `Nav.test.tsx`, `App.test.tsx`.
- Reference docs: `src/lib/design.md`, `src/lib/product-behavior.md`, root `product-behavior.md`.

OUT (do NOT touch):
- `src/lib/crypto.ts` — untouched, zero changes. Package has no crypto.
- `src/components/SyncConflictDialog.tsx` + the whole `RemoteChangedError` reconcile flow (fileId resolve chain, spurious-drift auto-recover, dialog copy/semantics) — **RETAINED BYTE-FOR-BYTE**.
- `GateRestoreFromFilePanel`, the picker-only restore flow, the cross-password prompt — retained as-is.
- `src/styles/styles.css` — CLAUDE.md says it is a byte-identical port of the design bundle. Do not edit.
- Redesigning the package API. It is fixed by Phase 1.
- Any auto-sync (there is none). Price sync, register, quotes — untouched.

## Key facts (read once, cite by path)

- `src/lib/drive.ts`:
  - line 1: `import { createDriveSync, NeedsReauthError, PickerCancelledError } from '@open-webapp/drive-sync'` + `import type { Connection }`.
  - line 28 `const driveSync = createDriveSync({ appId: 'portfolio', clientId: VITE_GOOGLE_CLIENT_ID, folderPath: ['OpenWebApp','Portfolio'] })`.
  - line 39 `export const drive = { ...driveSync, project: (id) => ({ ...driveSync.project(id), pickFile: <override> }) }` — only `pickFile` overridden.
  - line 101 `APP_STATE_FILENAME = 'portfolio-state.json'`, line 102 `APP_PROJECT_ID = 'app'`, line 109 `TOKEN_REAUTH_BUFFER_MS = 5*60*1000`, line 115 `DRIVE_IO_TIMEOUT_MS = 30*1000`, line 135 `withTimeout`.
  - **TO DELETE**: `isTokenUsable` (169), `DriveAuthStatus` (178), `getDriveAuthStatus` (190), `connectInFlight` (203), `ensureFreshConnection` (210), `connectDrive` (227), `disconnectDrive` (235), `TOKEN_REAUTH_BUFFER_MS` (109).
  - **TO KEEP**: `DriveDecryptError` (13), `drive` + `pickFile` shim (39), `decryptBackupEnvelope` (157), `syncBackup` (252), `getBackupFileId` (308, has a `NeedsReauthError` catch at 329), `getBackupFileStatus` (366), `readAndDecryptFile` (390, private), `restoreBackupFromFileId`, `overwriteLocalWithRemote`, `overwriteRemoteWithLocal`, `createPortfolioSyncDocument`, `withTimeout`.
  - Four content ops call `await ensureFreshConnection()` first: `syncBackup` (254), `restoreBackupFromFileId`, `overwriteLocalWithRemote`, `overwriteRemoteWithLocal`.
- `src/App.tsx`:
  - state ~53-63: `syncing`, `driveReady`, `driveEmail`, `backupFileId`, `syncConflict`.
  - ~95-107: early Drive status effect (`getDriveAuthStatus()` on mount, pre-gate) — DELETE.
  - ~110-125: `drive.activate()` effect gated on `sessionKey !== null` — DELETE (moves into the handle's `activate()`), **timing preserved: warm-up starts only AFTER unlock**.
  - ~260: post-unlock status effect (`getDriveAuthStatus()` + `getBackupFileId()`) — DELETE.
  - ~279 `handleSync` — KEEP (whole `RemoteChangedError` block untouched).
  - ~339-351 `handleConflictTakeRemote` / `handleConflictPushLocal` — KEEP.
  - ~352 `handleConnect` (alerts + timeout race + `getBackupFileId` lookup in its own try/catch) — DELETE.
  - ~396 `handleDisconnect` (alerts) — DELETE.
  - render sites: `<PasswordGate>` (~533), `<Nav driveReady=… />` (~560), `<SettingsPage>` (~600), `<SyncConflictDialog>` (~619).
- `src/components/Nav.tsx`: `driveReady` prop (line 6/18), gates the Sync button at line 120. Must still get a boolean.
- `src/components/DriveRestorePanel.tsx`: props interface line 68 (`driveReady`, `driveEmail`, `backupFileId`, `syncing`, `setSyncing`, `handleConnect`, `handleDisconnect`, `restoreKey`, `restoreSalt`, `onRestored`). Lines 132-165 = connect/disconnect block (DELETE). Lines 166+ = restore button, backup link, `DriveFilePickerDialog`, cross-password prompt (KEEP). Restore button and backup link are both gated on `driveReady` today.
- `src/components/PasswordGate.tsx`: `gateTab === 'restore'` block at 301-330, inside `shape === 'absent'`. Mounts `DriveRestorePanel` with `dummyKey`/`dummySalt` (state at 167-169, gated on `dummyKeyReady`) under a `"Google Drive"` `.card-title`, then a separate `"Backup file"` card with `GateRestoreFromFilePanel`.
- `src/components/Settings.tsx`: "Google Drive Sync" card ~194-300 mounts `DriveRestorePanel` with the Drive props threaded down from App. `handleChangePassword` (~95-150) calls `getDriveAuthStatus()` then `syncBackup` and on failure sets `driveSyncWarning`.
- Styling: `src/main.tsx` imports `./styles/styles.css` then `./index.css`. `index.css` is app-owned and NOT part of the design-bundle port → **that is where `--owa-drive-*` mapping goes**.
- Docs: `src/lib/design.md` §"Drive Connection Persistence" (37), §"Restore from Drive" (43), §"Sync Conflict" (61). `src/lib/product-behavior.md` §"Google Drive Sync" (153) with §"Drive Connection Persistence" (155). Root `product-behavior.md` §"Password gate" (127) and §"Settings page" (143) — both describe the Connect/Disconnect buttons in detail.
- Stale artifact: `src/components/Settings.test.tsx.bak` exists. Ignore it; do not update it, do not delete it as part of this plan.

## Package API (fixed by Phase 1 — do NOT redesign)

```
createDriveAuth({ drive, projectId, tokenBufferMs?, beforeInteractive? })
  -> plain NON-React handle (callable from plain module fns like syncBackup):
     getStatus() connect() disconnect() ensureFresh() refresh() subscribe() activate()
  owns: connection status store, the single connectInFlight guard, visibility/pageshow warm-up
  activate() is HOST-CALLED — the widget NEVER calls it on mount (see Decision 17)

<GoogleDriveWidget auth onConnected onDisconnected classNames description />
  renders all four states itself; errors inline with role="alert"; NEVER window.alert

useDriveConnection(auth) -> { connected, email, connecting, error, needsReauth, refresh }

CSS: prefixed owa-drive-* classes, themed via var(--owa-drive-*, fallback) + classNames override bag
```

HOST creates the drive-sync facade and passes it in. Package owns ALL auth, NOTHING about content.

## Decisions (implement as-stated; do NOT re-litigate)

1. **Handle lives in `src/lib/drive.ts`**, immediately after `const driveSync = createDriveSync(...)`:
   `export const driveAuth = createDriveAuth({ drive: driveSync, projectId: APP_PROJECT_ID, tokenBufferMs: 5 * 60 * 1000 })`.
   Reason: the four content ops in this same module need `ensureFresh()`. A separate `src/lib/driveAuth.ts` would import `drive.ts` and `drive.ts` would import it back → import cycle. One module, no cycle. `APP_PROJECT_ID`/`TOKEN_REAUTH_BUFFER_MS` constant declarations move above the handle as needed; the 5-minute buffer value is preserved exactly (as the `tokenBufferMs` arg), the module-level `TOKEN_REAUTH_BUFFER_MS` const itself goes away.
2. **Delete** from `src/lib/drive.ts`: `getDriveAuthStatus`, `isTokenUsable`, `connectDrive`, `disconnectDrive`, `ensureFreshConnection`, `connectInFlight`, `TOKEN_REAUTH_BUFFER_MS`, `interface DriveAuthStatus`. Drop the now-unused `import type { Connection }` if nothing else uses it. Keep the `NeedsReauthError` import (still used at line 329).
3. **All four content ops** (`syncBackup`, `restoreBackupFromFileId`, `overwriteLocalWithRemote`, `overwriteRemoteWithLocal`) swap `await ensureFreshConnection()` → `await driveAuth.ensureFresh()`. **This is the critical line of the whole phase**: it is what collapses the double-auth-popup hazard, because the widget's Connect button and the content ops must share ONE in-flight guard. There must be exactly ZERO remaining `ensureFreshConnection` references in `src/`.
4. **`drive.activate()` boot effect deleted from App.tsx**; the handle's `activate()` replaces it. Timing decision is PRESERVED: App calls `driveAuth.activate()` in an effect gated on `sessionKey !== null`, returning its dispose. Warm-up must NOT start on mount / pre-unlock (pre-unlock listeners previously caused a silent-reauth Google prompt on every tab-focus of the password screen).
5. **`DriveRestorePanel` split.** Delete lines 132-165 (the connect/disconnect block) and the props `driveReady`, `driveEmail`, `handleConnect`, `handleDisconnect`. New prop: `auth` (the handle). Inside, `const { connected } = useDriveConnection(auth)`. The restore button and the "View backup in Google Drive" link gate on `connected` instead of `driveReady`. Everything else in the file (picker, confirm, `DriveDecryptError` → cross-password prompt, fallback picker, alerts) is untouched.
6. **Delete from `src/App.tsx`**: `driveReady` state, `driveEmail` state, the early Drive status effect, the post-unlock status effect, `handleConnect`, `handleDisconnect`, and the `drive.activate()` effect body (replaced per Decision 4). **KEEP**: `backupFileId`, `syncing`, `syncConflict`, `handleSync`, `handleConflictTakeRemote`, `handleConflictPushLocal`.
7. **Nav Sync button: DISABLED when disconnected, NOT hidden.** `src/components/Nav.tsx:120` today renders the Sync button only when `driveReady` is true. That changes: `Nav`'s prop is renamed `connected` (fed by `const { connected } = useDriveConnection(driveAuth)` in `App.tsx`), the button renders **always**, with `disabled={!connected || syncing}`. This is a **deliberate visible behavior change**, not a faithful port — same category as the dropped `syncing` cross-disable (Decision 9). Root `product-behavior.md` §"Nav" and §"Settings page" must describe it.
8. **`backupFileId` lifecycle**: repopulated in the widget's `onConnected` callback using portfolio's existing lookup, in its own try/catch so a failed lookup does not forget the connection:
   `onConnected={async () => { try { setBackupFileId(await getBackupFileId()) } catch (e) { console.warn(...); setBackupFileId(null) } }}`.
   Cleared in `onDisconnected={() => setBackupFileId(null)}`. Both widget mounts (Settings + PasswordGate) get these; App passes them down as props (`onDriveConnected` / `onDriveDisconnected`) so there is ONE implementation.
9. **`syncing` cross-disable is DROPPED.** The widget's `connecting` state no longer greys out the Restore button, and connect/disconnect no longer flip App's `syncing`. This was incidental coupling from one flag serving two jobs. **Deliberate, accepted, visible change** — the Restore button stays clickable while a connect is in flight (safe: the shared in-flight guard means the connect is reused, not duplicated). `syncing` survives, but now means only "a sync/restore content op is running".
10. **Alerts GONE**: `alert('Connected to Drive')`, `alert('Connect failed: …')`, `alert('Disconnected from Drive')`, `alert('Disconnect failed: …')`. Replaced by the widget's inline error/status rendering (`role="alert"`). Portfolio **KEEPS** its own alerts for the paths it still owns: `alert('Synced to Drive')`, `alert('Sync failed: …')`, `alert('Restored from Drive')`, `alert('Restore failed: …')`. Also gone: App's 10-second `Google auth timed out` `Promise.race` in `handleConnect` — timeout behavior on connect is now the package's business.
11. **Widget mount sites** (exactly two):
    - `src/components/Settings.tsx`, the "Google Drive Sync" card: `<GoogleDriveWidget>` replaces the connect/disconnect half; `<DriveRestorePanel>` stays below it inside the same card.
    - `src/components/PasswordGate.tsx`, `gateTab === 'restore'` block, directly under the `"Google Drive"` `.card-title`, with `<DriveRestorePanel>` below it. **PRE-UNLOCK mount is safe: the package has no crypto.**
12. **dummyKey/dummySalt question — RESOLVED: the hack STAYS.** It is a *content* concern, not an auth one: the retained restore block still calls `restoreBackupFromFileId(fileId, restoreKey)`, and pre-unlock there is no real session key, so a throwaway key is still needed to force the guaranteed decrypt failure that lands the user on the cross-password prompt. What DOES change: the `dummyKeyReady && dummyKey && dummySalt` conditional (and its "Loading restore options..." placeholder) now wraps **only `<DriveRestorePanel>`**, not the whole card. `<GoogleDriveWidget>` mounts unconditionally above it, so Connect is usable the instant the Restore tab renders instead of waiting on a PBKDF2 derivation. Document this in root `product-behavior.md`.
13. **`Settings.handleChangePassword`**: `const driveStatus = await getDriveAuthStatus()` → `const driveStatus = await driveAuth.getStatus()`; the `if (driveStatus.connected)` guard and the `syncBackup(state, newKey, newSalt)` re-sync are unchanged. `driveSyncWarning` copy stays byte-for-byte, including "…Sync manually from Google Drive Sync above."
14. **`refresh()` on reauth failure** — hosts must not keep showing "Connected" while sync is failing. Add `if ((e as {name?:string})?.name === 'NeedsReauthError') driveAuth.refresh()` to EXACTLY these catch blocks (fire-and-forget, never awaited into the user path, never swallowing the original error handling):
    - `src/App.tsx` `handleSync` catch (before the existing `RemoteChangedError` branch check; a `NeedsReauthError` is not a `RemoteChangedError`, so ordering is safe).
    - `src/App.tsx` `handleConflictTakeRemote` and `handleConflictPushLocal` — wrap the body in `try { … } catch (e) { <refresh check>; throw e }` so `SyncConflictDialog`'s own inline-error handling still sees the original throw unchanged.
    - `src/components/DriveRestorePanel.tsx` `DriveFilePickerDialog.onSelect` catch, in the non-`DriveDecryptError` branch (next to the existing `alert('Restore failed: …')`).
    - `src/components/Settings.tsx` `handleChangePassword`'s Drive re-sync catch (next to setting `syncWarning`).
    Nowhere else. `getBackupFileId`'s existing internal `NeedsReauthError` catch (drive.ts:329) stays as-is — it is a passive probe and deliberately silent.
15. **Styling**: portfolio's Drive card WILL change appearance — its buttons stop being `.btn.btn-primary.blueprint`. ACCEPTED. Token mapping goes in **`src/index.css`** (app-owned, imported after `styles/styles.css` in `src/main.tsx`), NOT in `src/styles/styles.css` (CLAUDE.md: byte-identical port of the design bundle, do not hand-edit). Map `--owa-drive-*` onto existing tokens (`--space-3`, `--space-4`, `--color-success`, `--sans-serif`, `--text-muted`) under `:root`. Use the `classNames` bag only for anything the custom properties can't reach. No new `.blueprint` corner marks (retired in v11).
16. **`RemoteChangedError` reconcile flow is UNTOUCHED.** Same for the picker-only restore flow, the cross-password prompt, and `GateRestoreFromFilePanel`. None of it moves into the package. A diff of `SyncConflictDialog.tsx` must be empty; the diff of `handleSync` must show only the Decision-14 refresh line.
17. **`activate()` is HOST-CALLED — the widget never calls it on mount.** This matters more in portfolio than anywhere else: the widget mounts in `PasswordGate` **PRE-UNLOCK**, and portfolio deliberately delays Drive warm-up until after unlock. Wire `driveAuth.activate()` into the EXISTING post-unlock effect (`useEffect(… , [sessionKey])` gated on `sessionKey !== null`), replacing today's `drive.activate()` call and returning its dispose. Mounting `<GoogleDriveWidget>` pre-unlock must start NO warm-up, register NO visibility/pageshow listeners, and trigger NO silent reauth. Test-enforced in T12.
18. **`ensureFresh()` rule (explicit, so Phase 2 and Phase 3 don't read as disagreeing):** *user-triggered* operations call `ensureFresh()` — it may open an interactive Google window; *background/scheduled* work must NOT, and uses a non-interactive status check (`getStatus()`) instead. Portfolio's four content ops (`syncBackup`, `restoreBackupFromFileId`, `overwriteLocalWithRemote`, `overwriteRemoteWithLocal`) are ALL reached only from a user gesture (Sync button, Restore button, conflict-dialog buttons, Change-Password submit), so all four call `ensureFresh()`. Phase 2's notesdiary timer-driven `runSyncCycle` deliberately does NOT — that is the same rule applied to background work, not a contradiction.
19. **Consumption model: pinned published npm version `^0.1.0`** — NOT a `file:`/workspace link, matching how `@open-webapp/drive-sync` and `@open-webapp/project-sync` are consumed. **Phase 3 is BLOCKED until `@open-webapp/drive-connect` v0.1.0 is published.** The package ships its CSS as an explicit `dist/styles.css` import (it is NOT bundled into the JS), so portfolio must add `import '@open-webapp/drive-connect/dist/styles.css'` alongside the `--owa-drive-*` mapping (see Decision 15 / T4). Exact custom-property names and `classNames` slot keys stay unresolved by design — read the shipped package CSS, do not guess.

## Architecture sketch

```
src/lib/drive.ts
  const driveSync = createDriveSync({ appId:'portfolio', folderPath:['OpenWebApp','Portfolio'] })
  + export const driveAuth = createDriveAuth({ drive: driveSync, projectId: 'app', tokenBufferMs: 5*60*1000 })
  - getDriveAuthStatus / isTokenUsable / connectDrive / disconnectDrive / ensureFreshConnection
  - connectInFlight / TOKEN_REAUTH_BUFFER_MS / interface DriveAuthStatus
  = drive (pickFile shim), syncBackup, getBackupFileId, getBackupFileStatus, readAndDecryptFile,
    restoreBackupFromFileId, overwriteLocalWithRemote, overwriteRemoteWithLocal,
    createPortfolioSyncDocument, DriveDecryptError, decryptBackupEnvelope, withTimeout
    ...all four content ops now: await driveAuth.ensureFresh()      <-- ONE shared in-flight guard

src/App.tsx
  - driveReady/driveEmail state, early status effect, post-unlock status effect, handleConnect, handleDisconnect
  + const { connected } = useDriveConnection(driveAuth)  -> <Nav connected> (button always rendered, disabled={!connected||syncing})
  + useEffect(sessionKey !== null) -> driveAuth.activate()                 (HOST-called; widget never self-activates)
  + onDriveConnected / onDriveDisconnected  -> backupFileId set/clear      (passed to PasswordGate + Settings)
  = backupFileId, syncing, syncConflict, handleSync, handleConflict*       (+ refresh-on-NeedsReauth)

src/components/Settings.tsx        "Google Drive Sync" card
  <GoogleDriveWidget auth={driveAuth} onConnected onDisconnected classNames description />
  <DriveRestorePanel auth={driveAuth} backupFileId syncing setSyncing restoreKey restoreSalt onRestored />
  handleChangePassword: getDriveAuthStatus() -> driveAuth.getStatus()

src/components/PasswordGate.tsx    gateTab==='restore', card-title "Google Drive"  (PRE-UNLOCK)
  <GoogleDriveWidget auth={driveAuth} … />                     always mounted
  {dummyKeyReady && dummyKey && dummySalt ? <DriveRestorePanel …/> : "Loading restore options..."}

src/components/DriveRestorePanel.tsx
  - lines 132-165 connect/disconnect block; - driveReady/driveEmail/handleConnect/handleDisconnect props
  + auth prop; const { connected } = useDriveConnection(auth)  -> gates restore button + backup link
  = picker / confirm / cross-password / alerts  UNCHANGED

src/index.css
  import '@open-webapp/drive-connect/dist/styles.css'   (CSS is a separate entry, NOT bundled into the JS)
  :root { --owa-drive-gap: var(--space-3); --owa-drive-ok: var(--color-success); … }
```

## Tasks

### T0 — Create isolated git worktree
- **Deps**: none
- **Do**: from `/home/mohan/owa/portfolio`, run `git worktree add ../worktree-drive-connect-p3 -b drive-connect/p3-portfolio`, then `cd ../worktree-drive-connect-p3`. All later tasks run inside this worktree. Run `npm install` if node_modules is not shared.
- **Caveman**: dig own cave. work here. main cave stay clean.
- **Test**: `git worktree list` shows the new worktree on branch `drive-connect/p3-portfolio`; `git status` clean; `npm run test` baseline green (**record the pass count**); `npm run build` green.
- **Acceptance**: worktree exists on its own branch; baseline test + build pass before any change.

### T1 — Add `@open-webapp/drive-connect` dep + API smoke-spike
- **Deps**: T0
- **BLOCKED UNTIL** `@open-webapp/drive-connect` **v0.1.0 is published to npm** (Decision 19).
- **Do**: add `"@open-webapp/drive-connect": "^0.1.0"` to `package.json` dependencies — **pinned published npm version, NOT a `file:`/workspace link** — matching how `@open-webapp/drive-sync` ^0.5.0 and `@open-webapp/project-sync` ^0.1.0 are consumed. `npm install`. Write a THROWAWAY scratch check (a temp file or a `tsc` scratch, deleted at the end of the task) importing `createDriveAuth`, `GoogleDriveWidget`, `useDriveConnection` and confirming: (a) the module resolves, (b) `createDriveAuth({ drive, projectId })` typechecks against portfolio's `driveSync` object, (c) the handle exposes all seven methods, (d) the widget's prop names match Decision 11.
- **Caveman**: get new tool from shed. check it fit portfolio hand BEFORE me rip old tool out.
- **Test**: `npx tsc -b` clean with the scratch import present; `node -e "require.resolve('@open-webapp/drive-connect')"` (or the ESM equivalent) resolves; scratch file deleted before task end.
- **Acceptance**: dep installed and lockfile updated; the package's `drive` param accepts portfolio's `driveSync` with no cast; any mismatch found here is written into "Risks / API gaps" at the bottom of this plan, NOT worked around.

### T2 — Create `driveAuth` handle + delete the auth surface from `src/lib/drive.ts`
- **Deps**: T1
- **Do**: in `src/lib/drive.ts` — import `createDriveAuth`; add `export const driveAuth = createDriveAuth({ drive: driveSync, projectId: APP_PROJECT_ID, tokenBufferMs: 5 * 60 * 1000 })` right after the `driveSync` creation (move `APP_PROJECT_ID` above it if needed). Delete everything in Decision 2. Swap all four `ensureFreshConnection()` call sites for `driveAuth.ensureFresh()` (Decision 3). Drop the now-dead `import type { Connection }` if unused; KEEP the `NeedsReauthError` import.
- **Caveman**: new brain do auth. old auth bones out. four hungry ops now ask new brain for fresh token. all four. same guard.
- **Test**: `grep -rn "ensureFreshConnection\|getDriveAuthStatus\|connectDrive\|disconnectDrive\|connectInFlight\|TOKEN_REAUTH_BUFFER_MS\|DriveAuthStatus" src/` returns hits ONLY in test files and components not yet migrated (T5-T11 clear those) — zero in `src/lib/drive.ts`. `npx tsc -b` fails only in the not-yet-migrated components/tests (expected mid-flight; record the list).
- **Acceptance**: `src/lib/drive.ts` exports `driveAuth`; all four content ops call `driveAuth.ensureFresh()`; every deleted symbol is gone from that file; `crypto.ts` untouched (`git diff --stat src/lib/crypto.ts` empty).

### T3 — Update `src/lib/drive.test.ts`
- **Deps**: T2
- **Do**: delete/replace the tests covering the removed exports. Mock `@open-webapp/drive-connect` so `createDriveAuth` returns a fake handle with `ensureFresh: vi.fn()` etc. Keep the `@open-webapp/project-sync/testing` suites for `createPortfolioSyncDocument` and every existing content-op test green.
- **Caveman**: old auth test dead, bury. new test: each content op poke `ensureFresh` before touch drive.
- **Test** (`src/lib/drive.test.ts`): (happy) each of `syncBackup`, `restoreBackupFromFileId`, `overwriteLocalWithRemote`, `overwriteRemoteWithLocal` calls `driveAuth.ensureFresh()` exactly once, and calls it BEFORE any `project.files.*` call (assert call ordering). (edge) `ensureFresh()` resolving a connection does not change any existing content behavior — existing conflict-helper tests still green unmodified. (error) `ensureFresh()` rejecting → the content op rejects with that error and never touches `files.*`. (regression) `getBackupFileId`'s `NeedsReauthError` catch still returns `null` silently.
- **Acceptance**: `npx vitest run src/lib/drive.test.ts` green; no test references a deleted export.

### T4 — `--owa-drive-*` token mapping in `src/index.css`
- **Deps**: T1
- **Do**: add `import '@open-webapp/drive-connect/dist/styles.css'` to `src/index.css` (the package ships CSS as an explicit `dist/styles.css` entry, NOT bundled into the JS — without this import the widget renders unstyled). Then add a `:root` block in the same file mapping the package's `--owa-drive-*` custom properties onto portfolio's tokens (spacing → `--space-3`/`--space-4`, connected indicator → `--color-success`, font → `--sans-serif`, secondary text → `--text-muted`). Read the package's own CSS to get the exact custom-property names — do not guess. Do NOT edit `src/styles/styles.css`.
- **Caveman**: new tool wear portfolio paint. paint bucket live in index.css. holy styles.css no touch.
- **Test**: `git diff --stat src/styles/styles.css` is EMPTY (this is the CLAUDE.md gate). `npm run build` green. Manual: `npm run dev`, open Settings > Backup — widget uses portfolio spacing/colors, no unstyled flash. Every custom property written matches a name that actually appears in the package's CSS (grep the package).
- **Acceptance**: mapping lives only in `src/index.css`; `styles.css` byte-identical to `main`; no inline design tokens added to any component.

### T5 — Split `src/components/DriveRestorePanel.tsx`
- **Deps**: T2
- **Do**: per Decision 5 — delete lines 132-165 and the four props; add `auth` prop; `const { connected } = useDriveConnection(auth)`; gate the restore button and the backup link on `connected`. Leave the picker/confirm/cross-password/alert code untouched.
- **Caveman**: cut connect-button half off panel. keep restore half. panel now ask hook "we connected?" instead of ask boss.
- **Test** (`src/components/DriveRestorePanel.test.tsx`, updated in T6): compile check only in this task — `npx tsc -b` shows errors ONLY at the two mount sites (Settings, PasswordGate) and in the not-yet-updated test file.
- **Acceptance**: no `Connect Google Account` / `Disconnect` string remains in the file; no `driveReady`/`driveEmail`/`handleConnect`/`handleDisconnect` prop remains; `git diff` of the picker + cross-password region is empty.

### T6 — Update `src/components/DriveRestorePanel.test.tsx`
- **Deps**: T5
- **Do**: replace `driveReady`/`driveEmail`/`handleConnect`/`handleDisconnect` props with a mocked `auth` handle; mock `useDriveConnection` (or drive `subscribe`) to control `connected`. Delete the connect/disconnect assertions (that behavior belongs to the package now, tested there).
- **Caveman**: test no more poke connect button — button not live here. test poke restore.
- **Test**: (happy) `connected: true` → "Restore from Drive" renders; clicking it opens the picker; picking a file runs the existing confirm → `restoreBackupFromFileId` → `onRestored` → `alert('Restored from Drive')` path. (gating) `connected: false` → NO "Restore from Drive" button and NO "View backup in Google Drive" link, even with a non-null `backupFileId`. (edge) `connected: true` + `backupFileId` set → backup link renders with the right href. (error) restore throws `DriveDecryptError` → cross-password prompt appears, wrong password → "Incorrect encryption password" + fallback picker (unchanged behavior). (error) restore throws a plain error → `alert('Restore failed: …')` AND `auth.refresh` called once (Decision 14). (regression) `connecting: true` from the hook does NOT disable the Restore button (Decision 9).
- **Acceptance**: `npx vitest run src/components/DriveRestorePanel.test.tsx` green; zero references to deleted props.

### T7 — Mount widget in `src/components/Settings.tsx` + rewire `handleChangePassword`
- **Deps**: T5
- **Do**: in the "Google Drive Sync" card (~194-300) render `<GoogleDriveWidget auth={driveAuth} onConnected={onDriveConnected} onDisconnected={onDriveDisconnected} classNames={…} description={…} />` above `<DriveRestorePanel auth={driveAuth} … />`; drop the removed props from the `DriveRestorePanel` call and from `SettingsPageProps` (`driveReady`, `driveEmail`, `handleConnect`, `handleDisconnect`), adding `onDriveConnected`/`onDriveDisconnected`. In `handleChangePassword`, `getDriveAuthStatus()` → `driveAuth.getStatus()` (Decision 13) and add the Decision-14 `refresh()` to its re-sync catch. `driveSyncWarning` copy unchanged.
- **Caveman**: settings card now show package widget on top, portfolio restore below. password-change still ask "we connected?" — just ask new brain.
- **Test** (`src/components/Settings.test.tsx`, updated in T8): compile check — `npx tsc -b` errors now only in PasswordGate, App, and stale tests.
- **Acceptance**: no `alert('Connected to Drive')`/`alert('Disconnected from Drive')` reachable from Settings; `driveSyncWarning` string unchanged (`git diff` shows no edit to that literal); the card still renders one heading "Google Drive Sync".

### T8 — Update `src/components/Settings.test.tsx`
- **Deps**: T7
- **Do**: mock `@open-webapp/drive-connect` (`GoogleDriveWidget` → a shim that exposes buttons calling `onConnected`/`onDisconnected`; `useDriveConnection` → controllable). Delete connect/disconnect-alert assertions. Update `handleChangePassword` tests to stub `driveAuth.getStatus`.
- **Caveman**: settings test learn new widget shape. old alert test dead.
- **Test**: (happy) change password while `getStatus()` says connected → `syncBackup` called with the NEW key+salt, no warning shown. (edge) `getStatus()` says NOT connected → `syncBackup` NOT called, no warning, password change still succeeds. (error) `syncBackup` rejects → exact existing `driveSyncWarning` copy rendered (assert the string ends with "Sync manually from Google Drive Sync above.") and, when the rejection is a `NeedsReauthError`, `driveAuth.refresh` called once. (wiring) firing the widget shim's `onConnected` calls `getBackupFileId` and surfaces the backup link; `onDisconnected` clears it.
- **Acceptance**: `npx vitest run src/components/Settings.test.tsx` green; no assertion references a deleted export.

### T9 — Mount widget in `src/components/PasswordGate.tsx` (PRE-UNLOCK) + dummyKey scoping
- **Deps**: T5
- **Do**: in the `gateTab === 'restore'` block (301-330), under the `"Google Drive"` `.card-title`, render `<GoogleDriveWidget auth={driveAuth} onConnected={onDriveConnected} onDisconnected={onDriveDisconnected} … />` UNCONDITIONALLY, then keep the `dummyKeyReady && dummyKey && dummySalt ? <DriveRestorePanel …/> : "Loading restore options..."` conditional around ONLY the panel (Decision 12). Remove `driveReady`/`driveEmail`/`handleConnect`/`handleDisconnect` from both `PasswordGateProps` (14-20, 32-38, 52-58) and the inner screen props (139-156). Keep `backupFileId`/`syncing`/`setSyncing`. The `"Backup file"` card + `GateRestoreFromFilePanel` are untouched.
- **Caveman**: connect button now live pre-unlock — safe, package hold no secret. dummy key stay: restore still need fake key to trip wrong-password door. dummy wait now only block restore panel, not connect.
- **Test** (`src/components/PasswordGate.test.tsx`, updated in T10): compile check — `npx tsc -b` errors only in `src/App.tsx` and stale tests.
- **Acceptance**: widget renders before `dummyKeyReady` resolves; `shape === 'absent'` gating unchanged; no crypto import added to the widget path.

### T10 — Update `src/components/PasswordGate.test.tsx`
- **Deps**: T9
- **Do**: mock `@open-webapp/drive-connect` as in T8; drop the deleted props from every render helper; delete connect/disconnect-alert assertions.
- **Caveman**: gate test learn new shape. check connect button show up early, restore box show up late.
- **Test**: (happy) Restore tab renders the widget IMMEDIATELY, before the dummy key resolves; once resolved, `DriveRestorePanel` appears in the same card. (edge) while the dummy key is pending, "Loading restore options..." shows but the widget is still interactive. (gating) `connected: false` → no "Restore from Drive". (regression) tab-switch New Setup ↔ Restore is still lossless; `GateRestoreFromFilePanel` behavior and the `shape === 'absent'`-only rendering are unchanged. (error) no `window.alert` is called on any connect path.
- **Acceptance**: `npx vitest run src/components/PasswordGate.test.tsx` green.

### T11 — Gut the Drive-auth wiring in `src/App.tsx`
- **Deps**: T3, T6, T7, T9
- **Do**: per Decisions 4, 6, 7, 8, 14 — delete `driveReady`/`driveEmail` state, the early status effect (~95-107), the post-unlock status effect (~260), `handleConnect` (~352), `handleDisconnect` (~396); replace the `drive.activate()` effect body with `driveAuth.activate()` keeping the `sessionKey !== null` gate and the dispose return (Decision 17 — HOST-called; the widget never self-activates on mount); add `const { connected } = useDriveConnection(driveAuth)` and pass it to `<Nav connected={connected} />`; in `src/components/Nav.tsx`, rename the `driveReady` prop to `connected` and change line ~120 from `{driveReady && (<button …/>)}` to an always-rendered `<button … disabled={!connected || syncing}>` (Decision 7); add `onDriveConnected`/`onDriveDisconnected` callbacks (Decision 8) and thread them to `<PasswordGate>` and `<SettingsPage>` in place of the removed props; add the Decision-14 refresh calls in `handleSync`, `handleConflictTakeRemote`, `handleConflictPushLocal`. Drop now-unused imports (`getDriveAuthStatus`, `ensureFreshConnection`, `Connection`).
- **Caveman**: boss stop doing auth. boss only hold file-id, sync flag, conflict box. hook tell nav if drive awake. warm-up still wait for unlock — no early wake.
- **Test** (`src/App.test.tsx`, updated in T12): compile check — `npx tsc -b` clean except stale tests.
- **Acceptance**: `grep -rn "driveReady\|driveEmail\|handleConnect\|handleDisconnect" src/App.tsx src/components/Nav.tsx` returns NOTHING; `handleSync`'s `RemoteChangedError` block diff shows only the added refresh line; `SyncConflictDialog.tsx` diff empty; `driveAuth.activate()` still gated on `sessionKey`.

### T12 — Update `src/App.test.tsx` + `src/components/Nav.test.tsx`
- **Deps**: T11
- **Do**: update `src/App.test.tsx`'s `vi.mock('./lib/drive', …)` — drop `getDriveAuthStatus`, add `driveAuth: { activate: vi.fn(() => () => {}), getStatus: vi.fn(), ensureFresh: vi.fn(), refresh: vi.fn(), subscribe: vi.fn(() => () => {}) }`; mock `@open-webapp/drive-connect`. Update `Nav.test.tsx` for the renamed `connected` prop and the always-rendered-but-disabled Sync button.
- **Caveman**: boss test learn new mock. conflict test must still pass untouched — that the proof we broke nothing. sync button now always there, just grey when drive asleep.
- **Test**: (regression, HIGHEST VALUE) every existing `SyncConflictDialog` / `RemoteChangedError` App test passes **with no edit to its assertions** — only the mock block changes. (behavior change, `Nav.test.tsx`) `connected: false` → the Sync button IS in the DOM and IS `disabled`; clicking it does not call `handleSync`. (happy, `Nav.test.tsx`) `connected: true` → button enabled, click calls `handleSync`; `syncing: true` → disabled again. (timing, Decision 17) rendering `<GoogleDriveWidget>` pre-unlock (PasswordGate path) calls `driveAuth.activate` ZERO times — assert explicitly, not just via the post-unlock counter. (wiring) widget `onConnected` → `getBackupFileId` called, `backupFileId` set; a rejecting `getBackupFileId` still leaves the connection intact (no throw, `backupFileId` null). (wiring) `onDisconnected` → `backupFileId` cleared. (timing) `driveAuth.activate` NOT called before `onUnlock`; called exactly once after; dispose called on unmount. (error) `handleSync` rejecting with `NeedsReauthError` → `driveAuth.refresh` called once and the existing `alert('Sync failed: …')` still fires. (regression) spurious-version-drift auto-recover path unchanged.
- **Acceptance**: `npm run test` green across the whole suite (pass count ≥ T0 baseline minus the deliberately-deleted auth tests, plus the new ones — record the delta and justify each removal).

### T13 — Single-auth-popup race test (the headline guarantee)
- **Deps**: T12
- **Do**: add a test proving the widget's Connect button and a content op share ONE in-flight guard. Best home: `src/lib/drive.test.ts` with a REAL `createDriveAuth` (not the mocked handle) over a fake `driveSync` whose `project().connect()` is a `vi.fn()` returning a deferred promise and whose `getConnection()` returns an expired/absent connection.
- **Caveman**: two hand grab same rope at same time. only ONE google window open. prove it, or whole phase pointless.
- **Test**: (headline) call `driveAuth.connect()` and `syncBackup(...)` in the same tick with no cached token → the underlying `project.connect()` is called EXACTLY ONCE; both callers resolve off the same connection. (edge) same race with a still-valid cached token → `project.connect()` called ZERO times. (error) the shared connect rejects → BOTH callers reject, and a subsequent connect attempt starts a NEW `project.connect()` (in-flight guard cleared in `finally`, no permanent poisoning). (edge) `ensureFresh()` called twice sequentially with a valid token → still zero interactive connects.
- **Acceptance**: 4 tests green; a deliberate revert of Decision 3 (putting back a second private guard) makes the headline test fail — verify once by hand, then restore.

### T14 — Reference doc updates
- **Deps**: T13
- **Do**:
  - `src/lib/design.md` §"Drive Connection Persistence" (37) — REWRITE: `driveAuth = createDriveAuth({ drive: driveSync, projectId: 'app', tokenBufferMs: 5min })` lives in `drive.ts` (co-located to avoid an import cycle); it owns status/connect/disconnect/ensureFresh/refresh/subscribe/activate and the single in-flight guard; `App.tsx` holds NO Drive auth state — `useDriveConnection(driveAuth)` feeds Nav, `driveAuth.activate()` runs in a `sessionKey !== null` effect (warm-up only after unlock); `backupFileId` set in the widget's `onConnected` (own try/catch) and cleared in `onDisconnected`; the four content ops call `driveAuth.ensureFresh()`; hosts call `driveAuth.refresh()` in the four `NeedsReauthError` catch sites (list them).
  - `src/lib/design.md` §"Restore from Drive" (43) — `DriveRestorePanel` no longer owns connect/disconnect; restore + backup link gate on `useDriveConnection(auth).connected`; picker chain unchanged.
  - `src/lib/design.md` §"Sync Conflict" (61) — one line only: `ensureFreshConnection` → `driveAuth.ensureFresh()` in the two overwrite helpers. Everything else unchanged.
  - `src/lib/product-behavior.md` §"Google Drive Sync" / "Drive Connection Persistence" (153-160) — connect/disconnect UI is now the package widget: four states rendered by the widget, inline `role="alert"` errors, NO alert dialogs; connect no longer greys out Restore.
  - Root `product-behavior.md` §"Password gate" (127) — Restore tab's "Google Drive" card now stacks the package widget above the portfolio restore panel; widget is interactive immediately while "Loading restore options..." may still show below; describe the four widget states; drop the `.btn.btn-primary` / muted-underlined-Disconnect description.
  - Root `product-behavior.md` §"Nav" (13) — the Sync button is now **always rendered** and **disabled while Drive is not connected** (previously hidden entirely); still disabled while a sync is in flight.
  - Root `product-behavior.md` §"Settings page" (143) — same widget rewrite for the Backup tab; keep the "View backup in Google Drive" link, the auth-token/in-flight-guard sentence (now attributed to the package), and every restore/cross-password sentence; note the dropped `syncing` cross-disable and the new always-visible/disabled Nav Sync button.
  - Add `src/index.css` `--owa-drive-*` mapping to `src/lib/design.md` (or the styling note in root `design.md`, wherever styling architecture already lives).
- **Caveman**: write down truth in all doc. terse. no story. say package do auth, portfolio do content.
- **Test**: `npm run test` still green (docs are `.md`). Manual read-back: every sentence about Connect/Disconnect matches the shipped widget; zero surviving mentions of `getDriveAuthStatus`, `ensureFreshConnection`, `connectDrive`, `disconnectDrive`, `handleConnect`, `handleDisconnect`, or the connect alerts — `grep -rn` those names across all four docs and confirm only intentional historical-free text remains.
- **Acceptance**: all four docs updated; token-optimized (bullets/tables, no narrative); no contradictions between them.

### T15 — Full-file doc review, final test/build, commit
- **Deps**: T14
- **Do**: this is a MAJOR change (CLAUDE.md) — re-read `src/lib/design.md`, `src/lib/product-behavior.md`, root `product-behavior.md`, and root `design.md` IN FULL. Fix stale/contradicted content, cross-section drift, and any slide into prose. Run `npm run lint`, `npm run test`, `npm run build`; fix anything red. Then `git add -A && git commit` with a message ending in the required `Co-Authored-By` / `Claude-Session` trailers.
- **Caveman**: read every doc whole. no lie hide in corner. lint green, test green, build green. then freeze.
- **Test**: `npm run test` all green (≥ T0 baseline adjusted for the recorded delta); `npm run build` typecheck + build clean; `npm run lint` clean; `git log -1` shows the commit with both trailers; `git diff main --stat -- src/styles/styles.css src/lib/crypto.ts src/components/SyncConflictDialog.tsx` is EMPTY (the three untouchables).
- **Acceptance**: clean working tree; all three commands pass; commit present on `drive-connect/p3-portfolio`.

### T16 — Merge into local `main`, tear down worktree, delete branch
- **Deps**: T15
- **Do**: `cd /home/mohan/owa/portfolio` (original main worktree). Confirm on `main` and clean. `git merge --no-ff drive-connect/p3-portfolio`. **Do NOT push to any remote.** Then `git worktree remove ../worktree-drive-connect-p3` and `git branch -d drive-connect/p3-portfolio`.
- **Caveman**: bring work home to main. NO send to sky. kill cave. kill branch.
- **Test**: `git log --oneline -5` on `main` shows the merge + the T15 commit; `git worktree list` no longer lists `../worktree-drive-connect-p3`; `git branch` no longer lists the feature branch; the directory is gone; `npm run test` on `main` green.
- **Acceptance**: merged into local `main` (no remote push); worktree removed; branch deleted; `main` tests pass.

## Test strategy

- Per-task tests above (happy + edge + error each).
- **The four new must-prove behaviors**:
  0. **Nav Sync button present-but-disabled while disconnected** — T12 (`Nav.test.tsx`), the one deliberate UI behavior change beyond styling.
  1. **One auth popup when Connect and a content op race** — T13, real `createDriveAuth` over a fake `driveSync`. This is the headline guarantee of the whole phase.
  2. **Restore gated on connection** — T6 (`connected: false` → no Restore button, no backup link) and T10 (gate screen).
  3. **`backupFileId` repopulated via `onConnected`** — T12, including the failed-lookup case that must NOT forget the connection.
  4. **Conflict flow unchanged** — T12, existing `RemoteChangedError` / `SyncConflictDialog` assertions pass with zero edits (mock block aside).
- Deliberate deletions: every connect/disconnect-alert assertion in `DriveRestorePanel.test.tsx`, `PasswordGate.test.tsx`, `Settings.test.tsx`, `App.test.tsx`, and the auth-surface tests in `drive.test.ts`. That behavior is the package's and is tested in Phase 1. Record the removed-test count in the T15 commit message.
- Gate: `npm run lint` + `npm run test` + `npm run build` all green before the T15 commit.

## Risks / notes

- **BLOCKER: Phase 3 cannot start until `@open-webapp/drive-connect` v0.1.0 is published to npm** (Decision 19). No `file:`/workspace-link shortcut.
- **Portfolio is the most demanding consumer and migrates LAST — an API gap is LIKELY.** If the package can't express something portfolio needs (e.g. a status field, a `classNames` slot, a `beforeInteractive` hook shape), the fix is a **`@open-webapp/drive-connect` minor bump in the owa repo**, then bump the dep here — NOT a workaround in portfolio. Any gap found in T1 (or later) gets written down here and fixed upstream. Do not fork the widget, do not re-add a local guard.
- **Double-popup regression is the top hazard.** It reappears the instant anything in portfolio holds its own connect promise. Decision 3 + T13 exist solely to prevent this. Any future "just call connect() directly here" is a bug.
- **Import cycle**: putting `createDriveAuth` in a separate `src/lib/driveAuth.ts` creates `drive.ts ↔ driveAuth.ts`. Decision 1 (co-locate in `drive.ts`) is the fix; do not "clean it up" into a separate file.
- **Pre-unlock widget mount** is safe ONLY because the package has no crypto. If a future package version touches app data, revisit.
- **Warm-up timing**: `activate()` is HOST-called (Decision 17) — the widget never self-activates, which is exactly what makes the PRE-UNLOCK PasswordGate mount safe. `driveAuth.activate()` must stay gated on `sessionKey`. Registering its visibility/pageshow listeners pre-unlock previously popped a Google auth prompt on every tab-focus of the password screen. Regression-tested in T12.
- **Accepted visible changes** (call these out in the commit message): **Nav's Sync button is now always rendered and merely disabled while disconnected, instead of hidden** (Decision 7 — deliberate, not a faithful port); Drive card restyled off `.btn.btn-primary.blueprint`; the four connect/disconnect `alert()`s replaced by inline widget errors; the `syncing` cross-disable of the Restore button dropped; App's 10s connect timeout race removed.
- **Phase 2 vs Phase 3 `ensureFresh()` divergence is intentional** (Decision 18): portfolio's four content ops are all user-triggered so all call `ensureFresh()`; notesdiary's timer-driven `runSyncCycle` is background work and deliberately does not. Same rule, different trigger class — not two plans disagreeing.
- **`styles.css` byte-identity** is a CLAUDE.md hard rule — T4's diff check and T15's `git diff --stat` gate enforce it.
- `src/components/Settings.test.tsx.bak` is a stale artifact — out of scope, leave it alone.
- No `plans/_template.md` exists — this plan follows the house style of `plans/drive-sync-conflict-reconcile.md`.

## Post-change doc updates (must be done before commit — T14/T15)

- `src/lib/design.md` §"Drive Connection Persistence" (rewrite), §"Restore from Drive" (amend), §"Sync Conflict" (one line), + `--owa-drive-*` styling note.
- `src/lib/product-behavior.md` §"Google Drive Sync" → §"Drive Connection Persistence" (rewrite).
- Root `product-behavior.md` §"Nav" (Sync button always rendered, disabled when disconnected), §"Password gate" (Restore tab / Google Drive card) and §"Settings page" (Backup tab).
- Full-file review of all four (MAJOR change).
