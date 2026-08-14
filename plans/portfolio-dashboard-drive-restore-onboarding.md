# Plan: Restore from Google Drive on first-run gate screen

Repo: `/Users/mdoraiswamy/owa/portfolio`.

Today, restoring a Drive backup only exists inside the Settings page, which requires an unlocked session (a password already set). A brand-new user / new device has no way to restore an existing backup except: set a throwaway password, unlock, go to Settings, Connect Drive, Restore, then get dropped into a cross-password prompt anyway. This plan adds a "Restore from Drive" tab directly on the first-run gate screen (`PasswordGate`, `shape === 'absent'`), reusing the exact same Drive-restore UI/logic Settings already has — extracted into one shared component so there is no behavior drift between the two call sites.

## Resolved requirements (do not re-derive — see task prompt for full text)

1. Restore tab appears ONLY on `shape === 'absent'`. Not on `legacy-plaintext`, not on `encrypted`.
2. `.seg`/`.seg-opt` tabs on the absent-shape gate screen: "New Setup" / "Restore from Drive". Freely switchable. `GateShell` (title/subtitle/card/Reset App) stays shared; title/subtitle text changes per tab.
3. Extract shared `DriveRestorePanel` component. Identical behavior at both call sites, no mode-prop branching.
4. Settings.tsx: remove "Sync Now" from the Drive panel (Nav.tsx already has its own). Connect/Disconnect + Restore from Drive + backup link remain.
5. Gate has no real session key. Pass a throwaway/dummy key to the initial `restoreBackup(key)` call so it deterministically throws `DriveDecryptError`, landing on the same cross-password prompt UI used by Settings.
6. On any successful restore (initial key, cross-password retry, or picker fallback), gate calls the existing `onUnlock(key, salt, migratedState)` prop — same adoption path `PasswordGate` already uses, no extra password-setup step.
7. Disconnect available on gate's restore tab too.
8. Reset App unchanged, visible on both tabs.

## Current code (read in full before starting)

- `src/components/PasswordGate.tsx` (347 lines) — `PasswordGate`, `GateShell`, `SetPasswordScreen` (handles both `absent` and `legacy-plaintext`), `EnterPasswordScreen`. `onUnlock: (key: CryptoKey, salt: Uint8Array, migratedState?: AppState) => void`.
- `src/components/Settings.tsx` (432 lines) — `SettingsPage`. Drive panel logic to extract:
  - State: `crossPasswordPrompt` (`{salt, envelope}` or null), `backupPasswordInput`, `crossPasswordError`, `restoringWithBackupPassword`, `noBackupFound`, `pickingFile`.
  - Handlers: `handleRestore` (window.confirm → `restoreBackup(sessionKey)` → dispatch `__SET_STATE` or `DriveDecryptError` → `crossPasswordPrompt`), `handlePickFromDrive` (`pickDriveFile()` → `restoreBackupFromFileId(id, sessionKey)`), `handleCrossPasswordSubmit` (`deriveKey` against `crossPasswordPrompt.salt` → `decryptState` → `onKeyChange` + dispatch).
  - JSX: Google Account block (not connected → `.btn.btn-primary` "Connect Google Account"; connected → green dot + email + text-span "Disconnect"), Drive Sync Actions block (driveReady → "Sync Now" `.btn.btn-primary` **[removed by this plan]** + "Restore from Drive" `.btn.btn-secondary`), backup link, `noBackupFound` fallback (`DrivePickerFallback` local component), `crossPasswordPrompt` block (password field + submit/cancel + chained fallback on `crossPasswordError`).
  - Local `DrivePickerFallback` component at top of file (lines 14-22) — small, move as-is.
- `src/lib/drive.ts` — `restoreBackup(key)`, `restoreBackupFromFileId(fileId, key)`, `pickDriveFile()`, `getDriveAuthStatus()`, `DriveDecryptError` (carries `salt: Uint8Array`, `envelope: EncryptedEnvelope`). Not modified by this plan.
- `src/lib/crypto.ts` — `deriveKey(password, salt)`, `generateSalt()`, `decryptState(envelope, key)`. Not modified.
- `src/App.tsx` — owns `sessionKey`/`sessionSalt`/`gateShape` and lifted Drive state (`syncing`, `driveReady`, `driveEmail`, `backupFileId`) + handlers (`handleConnect`, `handleDisconnect`, `handleSync`). `handleConnect`/`handleDisconnect`/the mount-time `checkDrive()` effect do **not** depend on `sessionKey` — they already run before unlock, so they're safe to hand to `PasswordGate` unmodified.
- `src/components/Nav.tsx` — has its own "Sync now" icon button, calls the same lifted `handleSync`. Unaffected by this plan.

## Design decision: shared component contract

New file `src/components/DriveRestorePanel.tsx`. Exports `DriveRestorePanel`, props:

```ts
export interface DriveRestorePanelProps {
  driveReady: boolean
  driveEmail: string | null
  backupFileId: string | null
  syncing: boolean
  setSyncing: (v: boolean) => void
  handleConnect: () => void
  handleDisconnect: () => void
  restoreKey: CryptoKey        // key to try in the initial restoreBackup() call
  onRestored: (state: AppState, key: CryptoKey, salt: Uint8Array) => void
}
```

`onRestored` is the ONE success callback, fired identically whether the state came from (a) `restoreBackup(restoreKey)` succeeding directly, (b) the cross-password retry, or (c) the picker fallback. Call sites differ only in what they do with it:
- `Settings.tsx`: `onRestored={(state, key, salt) => { dispatch({type:'__SET_STATE', newState: state}); onKeyChange(key, salt) }}` — calling `onKeyChange` even when `key === sessionKey` (the common case) is harmless/idempotent, so no special-casing needed inside the panel.
- `PasswordGate.tsx` (restore tab): `onRestored={(state, key, salt) => onUnlock(key, salt, state)}` — this is the exact adoption path `PasswordGate` already gives `SetPasswordScreen`/`EnterPasswordScreen`.

This keeps `DriveRestorePanel` itself free of any "am I on the gate or in Settings" branching — req 3's hard constraint.

**Connect/Disconnect UI stays exactly as it is in Settings today** (confirmed in follow-up: no restyle). The panel renders today's existing structure verbatim: not connected → `.btn.btn-primary` **"Connect Google Account"**; connected → green dot + `driveEmail` read-only status row, plus a separate muted underlined text-span **"Disconnect"** (not a button, not merged into a toggle). This is the same markup/copy Settings already has — `DriveRestorePanel` just relocates it unchanged, so no `Settings.test.tsx` string assertions need to change for this part (only the Sync Now removal touches that file — see T3). The gate's restore tab renders this identical structure/copy too (req 7 — Disconnect available on the gate).

`window.confirm('Restore will replace all data with the backed-up version. Continue?')` stays in the panel unconditionally (fires on the gate too) — req 3 forbids mode branching, so no gate-only skip of this confirm.

## In scope

- `src/components/DriveRestorePanel.tsx` (new)
- `src/components/DriveRestorePanel.test.tsx` (new)
- `src/components/Settings.tsx` (rewire to use panel, drop Sync Now)
- `src/components/Settings.test.tsx` (update for new copy/structure, remove Sync Now tests)
- `src/components/PasswordGate.tsx` (tab-seg + restore tab on `shape === 'absent'`, dummy key)
- `src/components/PasswordGate.test.tsx` (new tests)
- `src/App.tsx` (thread `driveReady`/`driveEmail`/`backupFileId`/`syncing`/`setSyncing`/`handleConnect`/`handleDisconnect` into `PasswordGate`)
- Root `product-behavior.md` (§Password gate, §Settings page)
- Root `design.md` (component tree, data flow, directory structure comment)

## Out of scope

- `src/lib/drive.ts`, `src/lib/crypto.ts` — no changes.
- `Nav.tsx`'s own Sync Now icon button — untouched (req 4).
- `handleSync`/`syncBackup` wiring in `App.tsx` — untouched (req 4).
- `legacy-plaintext` gate screen — no restore tab, no changes beyond what's incidental to `SetPasswordScreen`'s shared tab-seg gating.
- Any change to `EnterPasswordScreen` (the `encrypted`-shape screen).
- Any change to Drive OAuth scopes, folder path, token refresh logic.

---

## T0 — Create worktree, confirm baseline
**Depends on:** none

```
git worktree add ../worktree-drive-restore-onboarding -b drive-restore-onboarding/gate-tab
cd ../worktree-drive-restore-onboarding
npm install
npm run test
```

**Acceptance:** `npm run test` passes, 0 failures, before any edits. All later tasks run inside this worktree.

---

## T1 — Create `DriveRestorePanel.tsx`
**Depends on:** T0
Files: `src/components/DriveRestorePanel.tsx` (new).

Move into this new file, adapted to the `DriveRestorePanelProps` contract above:
- The local `DrivePickerFallback` component (verbatim from `Settings.tsx` lines 14-22).
- Local state: `crossPasswordPrompt`, `backupPasswordInput`, `crossPasswordError`, `restoringWithBackupPassword`, `noBackupFound`, `pickingFile`.
- `handleRestore`: `window.confirm(...)` → `setSyncing(true)` → `restoreBackup(restoreKey)` → on success with non-null state, call `onRestored(restored, restoreKey, /* salt */)`. **Salt problem**: `restoreBackup` only returns `AppState`, not a salt — in the direct-success case the caller already knows the salt that matches `restoreKey` (Settings passes `sessionSalt`; gate passes the dummy salt it generated, though in practice the gate's dummy key can never hit this success branch, only the `DriveDecryptError` branch — see T4). So add a `restoreSalt: Uint8Array` prop alongside `restoreKey` (update the props list above accordingly) and use it in this call: `onRestored(restored, restoreKey, restoreSalt)`. On `DriveDecryptError`: `setCrossPasswordPrompt({salt: error.salt, envelope: error.envelope})`, clear `crossPasswordError`, clear `backupPasswordInput`. On null (no backup found): `setNoBackupFound(true)`. On other errors: `console.error` + `alert`.
- `handlePickFromDrive`: `pickDriveFile()` → `restoreBackupFromFileId(picked.id, restoreKey)` → on success `onRestored(restored, restoreKey, restoreSalt)`, clear `noBackupFound`/`crossPasswordPrompt`/`crossPasswordError`; on `DriveDecryptError` same reset as `handleRestore`; alert on success/failure exactly as today.
- `handleCrossPasswordSubmit`: `deriveKey(backupPasswordInput, crossPasswordPrompt.salt)` → `decryptState(envelope, retryKey)` → `onRestored(decrypted, retryKey, crossPasswordPrompt.salt)`, clear prompt state, alert; on failure `setCrossPasswordError('Incorrect encryption password')`.
- JSX, top to bottom: not connected → `.btn.btn-primary` "Connect Google Account" (calls `handleConnect`, disabled while `syncing`); connected → green dot + `driveEmail` status row + separate muted underlined "Disconnect" text-span (calls `handleDisconnect`) — this structure/copy is unchanged from today's Settings.tsx, just relocated → when `driveReady`, "Restore from Drive" `.btn.btn-secondary` (label `syncing ? 'Restoring...' : 'Restore from Drive'`, calls `handleRestore`) → backup link (`backupFileId` truthy) → `noBackupFound` fallback block → `crossPasswordPrompt` block (password field, submit/cancel, chained fallback on `crossPasswordError`) — copy identical to today's Settings.tsx JSX, just renamed/relocated.
- No `handleSync`/"Sync Now" anywhere in this file (req 4 — it never existed here to begin with; this file is the panel's first home).

**Tests:** covered by T2 (new dedicated test file).

**Acceptance:** `npx tsc -b --noEmit` has no new errors from this file. `grep -n "Sync Now" src/components/DriveRestorePanel.tsx` → 0 matches. `grep -n "onRestored" src/components/DriveRestorePanel.tsx` → present in all three success paths (direct restore, picker, cross-password).

---

## T2 — `DriveRestorePanel.test.tsx`: dedicated unit tests
**Depends on:** T1
Files: `src/components/DriveRestorePanel.test.tsx` (new).

Mock `../lib/drive` the same way `Settings.test.tsx` does today (see that file's `vi.mock` block for the exact shape/`DriveDecryptError` class to mirror). Render `DriveRestorePanel` directly with a fake `restoreKey`/`restoreSalt` and spy props.

**Test cases:**
- happy: not connected → "Connect Google Account" button visible, no "Restore from Drive" button, no green dot.
- happy: `driveReady=true` → green dot + `driveEmail` shown, separate "Disconnect" text-span visible, "Restore from Drive" button visible.
- happy: clicking "Connect Google Account" calls `handleConnect`; clicking "Disconnect" calls `handleDisconnect`.
- happy: `restoreBackup(restoreKey)` resolves a state → `onRestored(state, restoreKey, restoreSalt)` called once, no cross-password prompt shown.
- edge: `restoreBackup` resolves `null` → "Search Google Drive..." fallback appears; picking a file that decrypts successfully calls `onRestored`.
- error: `restoreBackup` throws `DriveDecryptError` → inline password prompt appears (not `window.confirm`, not full gate).
- error → happy: submitting the cross-password prompt with the correct password calls `onRestored(state, retryKey, promptSalt)` and closes the prompt.
- error → error: wrong password on the cross-password prompt shows "Incorrect encryption password" and keeps the prompt open (retryable), and reveals the picker fallback.
- happy: backup link renders only when `backupFileId` is non-null and `driveReady`.
- busy-label: buttons show "Connecting..."/"Restoring..." while `syncing`/local busy flags are true (mirror existing Settings tests' pattern for this).

**Acceptance:** `npx vitest run src/components/DriveRestorePanel.test.tsx` passes, 0 failures.

---

## T3 — Rewire `Settings.tsx` to use `DriveRestorePanel`, drop Sync Now
**Depends on:** T1
Files: `src/components/Settings.tsx`, `src/components/Settings.test.tsx`.

In `Settings.tsx`:
- Remove all the state/handlers/JSX moved to `DriveRestorePanel.tsx` (see T1's list) and the local `DrivePickerFallback`.
- Remove the "Sync Now" button and `handleSync` prop usage from the Drive panel JSX. **`handleSync` stays in `SettingsPageProps`** only if still needed elsewhere in this file — grep confirms it's Drive-panel-only, so remove it from `SettingsPageProps` entirely and drop the corresponding prop passed from `App.tsx` in T5. (If anything else in the file references `handleSync`, keep the prop — verify by grep before removing.)
- In the `settingsSection === 'drive'` block, render `<DriveRestorePanel driveReady={driveReady} driveEmail={driveEmail} backupFileId={backupFileId} syncing={syncing} setSyncing={setSyncing} handleConnect={handleConnect} handleDisconnect={handleDisconnect} restoreKey={sessionKey} restoreSalt={sessionSalt} onRestored={(state, key, salt) => { dispatch({ type: '__SET_STATE', newState: state }); onKeyChange(key, salt) }} />` inside the existing `<section className="card blueprint elev-sm">` wrapper (keep the `"Google Drive Sync"` card-title).
- Leave `Change Password` section (`settingsSection === 'encryption'`) untouched.

In `Settings.test.tsx`:
- Remove/update every test asserting on `Sync Now` (button presence, click → `handleSync` called, busy label).
- No other copy changes needed — "Connect Google Account" button and "Disconnect" text-span stay exactly as-is (confirmed: no restyle), so existing assertions on those strings keep passing unmodified.
- All Drive-restore behavior tests (cross-password, no-backup-found, picker chaining) keep the same assertions since `DriveRestorePanel`'s behavior and copy are unchanged, only relocated.

**Tests:** run inline as part of this task — don't defer.

**Acceptance:** `npx vitest run src/components/Settings.test.tsx` passes, 0 failures. `grep -n "Sync Now\|handleSync" src/components/Settings.tsx` → 0 matches.

---

## T4 — `PasswordGate.tsx`: tab-seg + restore tab on `shape === 'absent'`
**Depends on:** T1
Files: `src/components/PasswordGate.tsx`.

1. Extend `PasswordGateProps` with the Drive props `SetPasswordScreen` will need to forward: `driveReady`, `driveEmail`, `backupFileId`, `syncing`, `setSyncing`, `handleConnect`, `handleDisconnect` (same shapes as `DriveRestorePanelProps`).
2. In `SetPasswordScreen` (only reachable for `shape: 'absent' | 'legacy-plaintext'`), add local state `const [gateTab, setGateTab] = useState<'new' | 'restore'>('new')`.
3. Render the `.seg`/`.seg-opt` tab control (mirror `Settings.tsx`'s tab-seg markup exactly — `<div className="seg">` wrapping two `<label className="seg-opt"><input type="radio" ... readOnly onClick={...} />...</label>`) **only when `shape === 'absent'`** (req 1) — when `shape === 'legacy-plaintext'`, skip the tab-seg entirely and render the existing form unchanged (today's behavior, byte-for-byte).
4. `GateShell`'s `title`/`subtitle` become conditional on `gateTab`:
   - `gateTab === 'new'`: keep today's exact copy ("Set Encryption Password" / "Choose a password to encrypt your data on this device.").
   - `gateTab === 'restore'`: title `"Restore from Google Drive"`, subtitle `"Load your data stored in Google Drive."` (confirmed copy).
5. `gateTab === 'new'` renders the existing password form (unchanged).
6. `gateTab === 'restore'` renders `<DriveRestorePanel ... restoreKey={dummyKey} restoreSalt={dummySalt} onRestored={(state, key, salt) => onUnlock(key, salt, state)} />`, where `dummyKey`/`dummySalt` are generated once per mount (see step 7) — NOT the real password-derived key, since there is no real key yet (req 5).
7. Dummy key generation: on `SetPasswordScreen` mount (or lazily on first switch to the restore tab — either is fine, pick one and be consistent), do:
   ```ts
   const dummySalt = generateSalt()
   const dummyKey = await deriveKey(crypto.randomUUID(), dummySalt)
   ```
   Store both in state (`useState` + a mount-time effect, or `useState(() => ...)` with a wrapping async init — since `deriveKey` is async, use an effect that sets state once resolved; render nothing restore-tab-specific until it's ready, e.g. a tiny "Loading..." placeholder in the panel's slot, or gate the tab-seg's `disabled` on the radio until ready — implementer's call, not load-bearing for tests). This key can never match a real backup's key (random UUID password against a random salt), so the FIRST `restoreBackup(dummyKey)` call inside `DriveRestorePanel` always throws `DriveDecryptError`, immediately surfacing the cross-password prompt — reusing that code path verbatim, no new branch inside the panel.
8. Switching tabs is free (no confirm, no lock) — clicking either `seg-opt` just flips `gateTab`. Per-tab component state is naturally isolated already: the "New Setup" form's `password`/`confirm`/`error` state lives in `SetPasswordScreen` itself (unchanged, always mounted) — decide here whether `DriveRestorePanel` should stay mounted-but-hidden (state preserved across tab switches) or unmount/remount on tab switch (state reset each time). **Decision: keep both panels always mounted, toggle visibility via CSS (`display: gateTab === 'x' ? 'block' : 'none'`) rather than conditional rendering** — this preserves each tab's in-progress state (e.g. a half-typed cross-password prompt on Restore) if the user flips to New Setup and back, matches "switching tabs preserves independent state" from the task's test-coverage list, and avoids re-running the dummy-key generation effect on every tab flip.
9. `GateShell`'s Reset App link/dialog is unaffected — it wraps both tabs' content already (no change needed there).

**Tests:** covered by T5.

**Acceptance:** `grep -n "gateTab" src/components/PasswordGate.tsx` shows the seg-tabs, both panels, and the visibility toggle. `grep -n "shape === 'absent'" src/components/PasswordGate.tsx` gates the tab-seg render.

---

## T5 — `PasswordGate.test.tsx`: new tests for the restore tab
**Depends on:** T4
Files: `src/components/PasswordGate.test.tsx`.

Extend the existing `vi.mock('../lib/drive', ...)`-style setup (add one, mirroring `Settings.test.tsx`'s drive mock) and pass the new Drive props into every `render(<PasswordGate .../>)` call in this file (`driveReady`, `driveEmail`, `backupFileId`, `syncing`, `setSyncing`, `handleConnect`, `handleDisconnect` — sensible defaults: `driveReady: false`, `syncing: false`, rest `null`/no-op).

**New test cases** (new `describe('shape: absent — restore tab')` block):
- happy: tab-seg with "New Setup" / "Restore from Drive" renders only when `shape="absent"`; absent when `shape="legacy-plaintext"` and absent (no seg at all) when `shape="encrypted"`.
- happy: clicking "Restore from Drive" tab swaps title/subtitle and hides the password-set form; clicking back to "New Setup" restores it, with previously-typed password/confirm values intact (state preserved, not reset — per T4 step 8's always-mounted decision).
- happy (core flow): on the restore tab, connecting Drive (`driveReady` prop flips true via rerender, simulating `handleConnect`) then clicking "Restore from Drive" → mock `restoreBackup` rejects with `DriveDecryptError` → cross-password prompt appears → submit correct password → mock `deriveKey`/`decryptState` resolve → `onUnlock` called with `(retryKey, promptSalt, decryptedState)`.
- edge: wrong password on that same prompt shows "Incorrect encryption password", prompt stays open, `onUnlock` not called; correct password on retry succeeds.
- edge: `restoreBackup` resolves `null` (no backup at all) → "Search Google Drive..." fallback appears; picking a file that decrypts successfully calls `onUnlock` with that file's key/salt/state.
- edge: switching to the restore tab and clicking the "Disconnect" text-span while connected calls `handleDisconnect` (req 7).
- happy: Reset App link/dialog works identically from the restore tab (same assertions as the existing `describe('Reset app')` block, one more render with `gateTab` on restore — can reuse `fireEvent.click(screen.getByText('Restore from Drive'))` before triggering reset).
- regression: all existing tests in this file (New Setup flow, legacy-plaintext, encrypted, existing Reset App tests) still pass unmodified in assertions, only updated for the new required props.

**Acceptance:** `npx vitest run src/components/PasswordGate.test.tsx` passes, 0 failures.

---

## T6 — `App.tsx`: thread Drive props into `PasswordGate`
**Depends on:** T4
Files: `src/App.tsx`.

In the `sessionKey === null` branch's `<PasswordGate .../>` call, add: `driveReady={driveReady} driveEmail={driveEmail} backupFileId={backupFileId} syncing={syncing} setSyncing={setSyncing} handleConnect={handleConnect} handleDisconnect={handleDisconnect}`. All six values/handlers already exist in `App.tsx` state and do not depend on `sessionKey` (confirmed in discovery — `handleConnect`/`handleDisconnect`/the mount-time Drive-status effect run unconditionally). No new state needed in `App.tsx`.

Also: if T3 removed `handleSync` from `SettingsPageProps`, remove the now-unused `handleSync` prop from the `<SettingsPage .../>` call too (grep first — only if T3 actually dropped it from `SettingsPageProps`; `Nav`'s `handleSync` usage is untouched either way).

**Tests:** none new here — covered by T5's `PasswordGate.test.tsx` (component-level) and a smoke check below.

**Acceptance:** `npx tsc -b --noEmit` passes (props satisfy `PasswordGateProps`). Manually grep: `grep -n "driveReady={driveReady}" src/App.tsx` shows both the `PasswordGate` and `Nav`/`SettingsPage` call sites.

---

## T7 — Root `product-behavior.md`: update Password gate + Settings page sections
**Depends on:** T3, T4
Files: `product-behavior.md` (repo root).

`## Password gate` section: add a paragraph after the existing "First run..." bullet describing the new tab-seg (only on first-run/`absent`, not legacy-plaintext): "New Setup" (today's form, unchanged) vs. "Restore from Drive" (new — title "Restore from Google Drive", subtitle "Load your data stored in Google Drive."; describe Connect Google Account/Disconnect (same structure/copy as Settings, unchanged), "Restore from Drive" button, cross-password prompt reached immediately since there's no real password yet, no-backup picker fallback, chaining — same behavior as Settings' Drive panel, just reached before any password exists). Note: on success (any of the three paths), the app unlocks directly with the restored data and the restored backup's own password becomes the session password — no separate "set a new password" step. Note tab switching is free/lossless (typed New-Setup password preserved if user tabs away and back).

`## Settings page` section: remove the "Sync Now" bullet/mention entirely (button set is now Connect Google Account/Disconnect + Restore from Drive + backup link — copy unchanged from today). Note the Drive panel's implementation now lives in a shared `DriveRestorePanel` component also used by the gate's restore tab — behavior described here is authoritative for both.

**Tests:** none (doc-only).

**Acceptance:** `grep -n "Sync Now" product-behavior.md` → 0 matches. `grep -n "Restore from Drive" product-behavior.md` appears in both the Password gate and Settings page sections.

---

## T8 — Root `design.md`: update component tree, data flow, directory structure
**Depends on:** T3, T4, T6
Files: `design.md` (repo root).

- `## Directory structure`: add a line for `DriveRestorePanel.tsx` (shared Drive connect/restore UI: connect/disconnect toggle, restore button, cross-password retry, no-backup picker fallback — used by both `Settings.tsx` and `PasswordGate.tsx`). Update the `PasswordGate.tsx` line's comment to mention the new restore tab. Update the `Settings.tsx` line's comment: drop "Sync Now"/inline Drive-restore-logic wording, note it now renders `DriveRestorePanel`.
- `## Component tree`: update `PasswordGate` entry's prop list to include the new Drive props (`driveReady, driveEmail, backupFileId, syncing, setSyncing, handleConnect, handleDisconnect`) alongside existing `shape, onUnlock, onReset`. Update `SettingsPage` entry's prop list to drop `handleSync` if T3/T6 removed it. Add a `DriveRestorePanel` entry: `(driveReady, driveEmail, backupFileId, syncing, setSyncing, handleConnect, handleDisconnect, restoreKey, restoreSalt, onRestored)` — used inside both `PasswordGate`'s restore tab and `SettingsPage`'s Drive section.
- Props-convention line (currently listing every component's prop signature in one dense paragraph): add `DriveRestorePanel`'s and update `PasswordGate`'s/`SettingsPage`'s entries to match the above.
- `## Data flow` → **Password gate & hydration** paragraph: add a sentence on the new restore tab — dummy key/salt generated via `generateSalt()`/`deriveKey(crypto.randomUUID(), dummySalt)` so the first `restoreBackup()` call always throws `DriveDecryptError`, reusing the existing cross-password-prompt code path; success calls the same `onUnlock` the rest of the gate uses.
- `## Data flow` → **Drive sync** paragraph: note `DriveRestorePanel` is now the single implementation of connect/disconnect/restore/cross-password/picker-fallback, shared by `SettingsPage` and `PasswordGate`; `onRestored(state, key, salt)` is its one success callback, wired differently per call site (`SettingsPage` dispatches `__SET_STATE` + `onKeyChange`; `PasswordGate` calls `onUnlock`). Remove "Sync Now" wording from `SettingsPage`'s described button set (stays only on `Nav`).

**Tests:** none (doc-only).

**Acceptance:** `grep -n "DriveRestorePanel" design.md` → present in directory structure, component tree, and data flow sections (at least 3 hits). `grep -n "Sync Now" design.md` → only appears in the `Nav` description, not `SettingsPage`'s.

---

## T9 — Full-file re-read of both updated docs (staleness check)
**Depends on:** T7, T8
Files: `product-behavior.md`, `design.md` (read-only, full file each).

Per CLAUDE.md's mandatory rule for behavior changes: re-read both files in full after T7/T8's edits. Check specifically:
- No leftover "Sync Now" reference inside `SettingsPage`'s description in either file.
- "Connect Google Account" / "Disconnect" copy is described consistently (and correctly, as unchanged) everywhere it's mentioned — no doc drift implying a toggle button that doesn't exist.
- `design.md`'s directory-structure comment and component-tree prop lists agree with each other (same prop names, same order doesn't matter but no contradictions).
- Terse/token-optimized style preserved, no narrative bloat introduced by the rewrite.

**Tests:** none.

**Acceptance:** `grep -n "Sync Now" product-behavior.md design.md` → only in `Nav`-related mentions (its own Sync now icon button is untouched), never under `SettingsPage`/Drive panel description. Any additional stale references found are fixed in this same task before moving on.

---

## T10 — Full test/lint/build gate
**Depends on:** T2, T3, T5, T6, T9
Files: none (verification only).

```
npm run test
npm run lint
npm run build
```

Fix any failures before proceeding.

**Acceptance:** all three exit 0 with 0 failures/errors.

---

## T11 — Commit
**Depends on:** T10
Files: none (git operation).

```
git add -A
git commit -m "$(cat <<'EOF'
Add Restore from Google Drive tab to first-run gate screen

- Extract Settings.tsx's Drive connect/restore/cross-password UI into a
  shared DriveRestorePanel, used identically by Settings and the new gate tab
- PasswordGate (shape: absent) gets a New Setup / Restore from Drive tab-seg;
  restore uses a throwaway key so the first restoreBackup() call always hits
  the existing cross-password-prompt flow, then adopts the result via onUnlock
- Settings.tsx: drop the redundant "Sync Now" button (Nav already has one)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git status
```

**Acceptance:** commit created, `git status` clean (aside from expected worktree artifacts, if any).

**Note:** this task only commits to the local worktree branch. Merging to `main` is a separate, human-reviewed step — not automated here.

---

## T12 — Remove worktree
**Depends on:** T11
Files: none (git operation).

```
cd /Users/mdoraiswamy/owa/portfolio
git worktree remove ../worktree-drive-restore-onboarding
```

**Acceptance:** `git worktree list` no longer shows the removed worktree; `/Users/mdoraiswamy/owa/portfolio` is the active working directory.

---

## Acceptance criteria (tied to resolved requirements)

1. `grep -n "shape === 'absent'" src/components/PasswordGate.tsx` gates the tab-seg; `legacy-plaintext`/`encrypted` renders show no tab-seg (T5 tests).
2. Tab-seg uses `.seg`/`.seg-opt` markup (T4); freely switchable, no confirm (T5 test); `GateShell` shared, title/subtitle swap per tab (T4).
3. `DriveRestorePanel.tsx` has one implementation, imported by both `Settings.tsx` and `PasswordGate.tsx`, no prop resembling a "mode"/"isGate" flag (T1, T3, T4 — grep for absence of such a prop as part of T10's review).
4. `grep -n "Sync Now" src/components/Settings.tsx` → 0 matches; Nav's Sync Now untouched (T3).
5. Dummy key/salt generated via `generateSalt()`/`deriveKey(crypto.randomUUID(), ...)`, guaranteed to trigger `DriveDecryptError` on first restore attempt (T4 step 7, T5 test).
6. `onRestored` → `onUnlock(key, salt, state)` on the gate, all three success paths (T4 step 6, T5 tests).
7. Disconnect button present and wired on the gate's restore tab (T4, T5 test).
8. Reset App link/dialog unchanged, present on both tabs (T4 step 9, T5 test).

---

## Decisions confirmed via follow-up interview (no longer open)

1. **Settings' Connect/Disconnect UI is unchanged** — stays "Connect Google Account" button + separate "Disconnect" text-span, exactly as today. `DriveRestorePanel` relocates this structure/copy verbatim for both call sites (Settings and the gate); no toggle-button restyle anywhere.
2. **Restore-tab copy confirmed**: title "Restore from Google Drive", subtitle "Load your data stored in Google Drive."
3. **Tab-switch state preservation confirmed**: both tabs stay mounted, toggled via CSS `display` — in-progress state on either tab survives switching away and back.
4. **`restoreSalt` prop confirmed as the right approach**: no change to `drive.ts`'s `restoreBackup` return type; `DriveRestorePanel` tracks/threads the salt itself via the `restoreSalt` prop (Settings passes `sessionSalt`; the gate passes its generated `dummySalt`).
5. **`handleSync` prop removal from `SettingsPageProps` confirmed**: verified by grep — `handleSync` is only used by the Sync Now button being removed in T3; `Settings.tsx:195`'s direct `syncBackup(...)` call (password-change re-sync) is a separate code path and unaffected. `handleSync` stays defined in `App.tsx`, passed to `Nav` only.
