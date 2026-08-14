# Plan: Replace Drive Picker with paste-URL restore in DriveRestorePanel

Repo: `/Users/mdoraiswamy/owa/portfolio`.

## Feature

In "Restore from Google Drive" (shared `src/components/DriveRestorePanel.tsx`, used by both `PasswordGate.tsx`'s New Setup/Restore tab and `Settings.tsx`'s Drive section), when the default folder/file lookup fails (`noBackupFound`) or a cross-password retry also fails (`crossPasswordPrompt && crossPasswordError`), replace the "Search Google Drive..." Picker button with a text field where the user pastes a Drive file URL or bare file ID, and the app extracts the file id itself and restores via the existing `restoreBackupFromFileId(fileId, key)`.

## Resolved decisions (implement as-stated, do not re-litigate)

1. Only `DriveRestorePanel.tsx` + `drive.ts` need logic changes. `PasswordGate.tsx`/`Settings.tsx` need no code changes (confirmed: neither references `pickDriveFile`/`DrivePickerFallback` directly — both just render `<DriveRestorePanel .../>`), only their test files change.
2. Delete Picker entirely from `src/lib/drive.ts`: `pickDriveFile()`, `loadPickerApi()`, `pickerApiLoadPromise`, `GooglePickerNamespace`/`PickerDoc`/`PickerResponse`/`PickerInstance`/`DocsViewChain`/`PickerBuilderChain`/`GapiWindow` (current lines ~375-536, confirmed by read). `restoreBackupFromFileId(fileId, key)` (lines 361-373) is unchanged and is the reuse target.
3. Add pure exported `extractDriveFileId(input: string): string | null` to `drive.ts`:
   - Trim input.
   - Match `/file/d/FILE_ID/` pattern (regex on `/file/d/([a-zA-Z0-9_-]+)/`) → return `FILE_ID`.
   - Match `?id=FILE_ID` or `&id=FILE_ID` (regex `[?&]id=([a-zA-Z0-9_-]+)`) → return `FILE_ID`.
   - Else, if the whole trimmed input looks like a plausible bare file id (`^[a-zA-Z0-9_-]{10,}$`), return it as-is.
   - Else return `null`.
4. In `DriveRestorePanel.tsx`, replace `DrivePickerFallback` (lines 11-19, the "Search Google Drive..." button using `pickDriveFile`) with a new fallback component: `<input className="input">` (placeholder "Paste Google Drive file link or ID") + `<button className="btn btn-secondary">Load file</button>` (disabled while restoring). Rendered under the identical two trigger conditions as today: `noBackupFound` (current line ~197) and `crossPasswordPrompt && crossPasswordError` (current line ~239).
5. On submit: `extractDriveFileId(inputValue)`. `null` → inline validation error under the field ("Couldn't find a file ID in that link"), no restore attempt. Valid → same `window.confirm('Restore will replace all data with the backed-up version. Continue?')` used by `handleRestore`, then `restoreBackupFromFileId(fileId, restoreKey)`, following the existing success/`DriveDecryptError`/generic-error pattern from `handlePickFromDrive` (onRestored callback + alert on success; `DriveDecryptError` → sets `crossPasswordPrompt`/clears error/blanks password field; generic error → `alert`).
6. `.env` (repo root, untracked) already has no `VITE_GOOGLE_PICKER_API_KEY` line (verified — file is a single `VITE_GOOGLE_CLIENT_ID=...` line). No edit needed there; just confirm via grep that nothing else references it after `drive.ts` changes.
7. Delete `plans/portfolio-drive-picker-oauth-fallback.md` (superseded — its premise was fixing the Picker, which is now deleted).
8. Update root `product-behavior.md` (lines 113 and 124 — both mention "Search Google Drive...", picker, `pickDriveFile()`, `noBackupFound`) and root `design.md` (line 46 directory comment, lines 147/154/156 — Picker mechanics, dev-key mention, `DrivePickerFallback` two-context description) to describe the paste-URL flow instead.
9. Rewrite tests:
   - `src/lib/drive.test.ts`: remove `installPickerFake()` helper (lines ~498-547) and the three `pickDriveFile()` tests (lines ~549-589: picked-file resolve, cancel; note the "throws without VITE_GOOGLE_PICKER_API_KEY" test referenced in the superseded plan is already gone — verify). Add tests for `extractDriveFileId`: `/file/d/ID/view` URL, `?id=ID` URL, bare valid id (≥10 chars alnum/-/_), garbage input → null, empty string → null.
   - `src/components/DriveRestorePanel.test.tsx` (521 lines): rewrite the picker-flow tests — `'edge: restoreBackup resolves null → "Search Google Drive..." fallback appears...'` (~215), the `'error → error: ... reveals the picker fallback'` (~307), `describe('Picker fallback chaining')` (~344-463 incl. `'does nothing when the user cancels the Drive picker'` and `'T5.5: Cancelling the picker...'`) — replace Picker-mock interactions with paste-input `fireEvent.change`/submit-button-click interactions; keep the same trigger/outcome assertions (fallback appears on `noBackupFound` and on `crossPasswordError`, successful restore calls `onRestored`, decrypt failure re-opens cross-password prompt blanked, chaining across multiple pastes).
   - `src/components/Settings.test.tsx` (1016 lines): same treatment for its Picker-flow tests (lines ~244-339, ~750-1010 incl. `T5.2`/chaining/`T5.5` blocks) — swap `pickDriveFile` mocking for paste-input interaction.
   - `src/components/PasswordGate.test.tsx` (628 lines): same treatment for lines ~502-570 (`'restoreBackup resolves null shows "Search Google Drive..." fallback button'` and the picker-pick-and-restore test).
10. `plans/portfolio-drive-picker-oauth-fallback.md`'s note about `Settings.test.tsx.bak` — leave untouched, out of scope here too.

## Out of scope

- Any change to `restoreBackup`, `restoreBackupFromFileId`, `readAndDecryptFile`, `DriveDecryptError`, `ensureFreshConnection`, `syncBackup`, `getBackupFileId`, `getDriveAuthStatus`, `connectDrive`, token-refresh logic.
- Any change to `handleRestore`'s direct-restore path or the cross-password-prompt UI beyond swapping the fallback button under it.
- `PasswordGate.tsx`/`Settings.tsx` component code (no picker references there to remove).
- `Settings.test.tsx.bak`.

## Current code map (already read in full this session)

- `src/components/DriveRestorePanel.tsx` (244 lines): imports `pickDriveFile` (line 6); `DrivePickerFallback` component (11-19); `pickingFile` state (59); `handlePickFromDrive` (88-112) — calls `pickDriveFile()`, then `restoreBackupFromFileId(picked.id, restoreKey)`, handles `DriveDecryptError` (101-106) vs generic error (107-108); rendered at `noBackupFound` (197) and inside `crossPasswordPrompt` block gated on `crossPasswordError` (239).
- `src/lib/drive.ts`: `restoreBackupFromFileId` (361-373, keep); Picker types/helpers (375-536, delete): `PickerDoc`/`PickerResponse`/`PickerInstance`/`GooglePickerNamespace`/`DocsViewChain`/`PickerBuilderChain`/`GapiWindow` interfaces (381-418), `pickerApiLoadPromise` + `loadPickerApi()` (420-466), `pickDriveFile()` (468-536).

## Test strategy

- `drive.test.ts`: full-suite gate; new `extractDriveFileId` tests (happy ×2 URL shapes, happy bare id, edge garbage → null, edge empty → null) plus removal of now-dead picker tests.
- `DriveRestorePanel.test.tsx`, `Settings.test.tsx`, `PasswordGate.test.tsx`: same scenarios as today's picker tests (fallback visibility on both triggers, successful restore, decrypt-failure re-prompt with blanked password, chaining, plus new: invalid pasted input shows inline error and does not call `restoreBackupFromFileId`).
- `npm run test`, `npm run lint`, `npm run build` all green before commit, per CLAUDE.md.

## Risks

- **Test-file interaction pattern drift**: three separate test files (`DriveRestorePanel`, `Settings`, `PasswordGate`) all currently drive the same underlying component's picker flow via `driveModule.pickDriveFile` mocks — each must be updated to drive the new input+button UI consistently (same placeholder/button text) or accessibility-role queries (`getByRole('button', { name: 'Load file' })`, `getByPlaceholderText(...)`) will diverge across files. Use one exact copy (input placeholder + button label) and reuse literally in all three test files.
- **Regex false-positives**: a bare pasted string that happens to be ≥10 alnum/-/_ chars but isn't actually a valid Drive file id will be "accepted" by `extractDriveFileId` and only fail later at Drive read time (surfacing as a generic "Restore failed" alert) — acceptable per resolved requirement #3 (no live ID-validity check specified), not a bug to pre-empt.

## Open questions

- None — all decisions resolved by the task brief; note only that `.env` already lacks `VITE_GOOGLE_PICKER_API_KEY` (T7 becomes a verify-only no-op rather than an edit).

---

## T0 — Create worktree, confirm baseline
**Depends on:** none

```
git worktree add ../worktree-drive-restore-paste-url -b drive-restore-paste-url/main
cd ../worktree-drive-restore-paste-url
npm install
npm run test
```

**Acceptance:** `npm run test` passes with 0 failures before any edits. All later tasks run inside this worktree.

---

## T1 — drive.ts: delete Picker code, add `extractDriveFileId`
**Depends on:** T0
Files: `src/lib/drive.ts`.

1. Delete lines ~375-536: `PickerDoc`/`PickerResponse`/`PickerInstance`/`GooglePickerNamespace`/`DocsViewChain`/`PickerBuilderChain`/`GapiWindow` interfaces, `pickerApiLoadPromise`, `loadPickerApi()`, `pickDriveFile()`.
2. Keep `restoreBackupFromFileId` (361-373) untouched — but its JSDoc references `pickDriveFile()`; update the doc comment to describe pasted URL/ID input instead of Picker, without changing the function signature/body.
3. Add near the bottom of the file (or near `restoreBackupFromFileId`):
   ```ts
   /**
    * Extracts a Google Drive file id from a pasted Drive URL or bare file id.
    * Supports `.../file/d/FILE_ID/...` and `...?id=FILE_ID` (or `&id=FILE_ID`)
    * URL shapes; falls back to accepting the whole trimmed input as a bare id
    * if it looks plausible (alnum + `-`/`_`, 10+ chars, no spaces/slashes).
    * Returns null if nothing usable is found.
    */
   export function extractDriveFileId(input: string): string | null {
     const trimmed = input.trim()
     if (!trimmed) return null

     const fileDMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
     if (fileDMatch) return fileDMatch[1]

     const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/)
     if (idParamMatch) return idParamMatch[1]

     if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed

     return null
   }
   ```

**Tests:** covered by T2 (same PR — this task alone leaves `drive.test.ts` red).

**Acceptance:** `grep -n "pickDriveFile\|loadPickerApi\|GooglePickerNamespace\|pickerApiLoadPromise" src/lib/drive.ts` → 0 matches. `grep -n "extractDriveFileId" src/lib/drive.ts` → export present.

---

## T2 — drive.test.ts: remove Picker tests, add `extractDriveFileId` tests
**Depends on:** T1
Files: `src/lib/drive.test.ts`.

1. Delete `installPickerFake()` helper (~498-547) and the `pickDriveFile()` tests (~549-589: picked-file resolve, cancel-resolves-null).
2. Add a `describe('extractDriveFileId', ...)` block with:
   - happy: `extractDriveFileId('https://drive.google.com/file/d/1AbC-XyZ_123/view?usp=sharing')` → `'1AbC-XyZ_123'`.
   - happy: `extractDriveFileId('https://drive.google.com/open?id=1AbC-XyZ_123')` → `'1AbC-XyZ_123'`.
   - happy: `extractDriveFileId('1AbC-XyZ_1234567890')` (bare id, ≥10 chars) → same string.
   - edge: `extractDriveFileId('not a url or id!!')` → `null`.
   - edge: `extractDriveFileId('')` / `extractDriveFileId('   ')` → `null`.
   - edge: short bare string (<10 chars, e.g. `'abc123'`) → `null`.

**Acceptance:** `npx vitest run src/lib/drive.test.ts` passes, 0 failures. `grep -n "pickDriveFile\|installPickerFake" src/lib/drive.test.ts` → 0 matches.

---

## T3 — DriveRestorePanel.tsx: paste-URL fallback UI + submit handler
**Depends on:** T1
Files: `src/components/DriveRestorePanel.tsx`.

1. Update import (line 6): replace `pickDriveFile` with `extractDriveFileId`.
2. Replace `DrivePickerFallback` (11-19) with a new component, e.g.:
   ```tsx
   function DrivePasteFallback({
     value,
     onChange,
     onSubmit,
     error,
     restoring,
   }: {
     value: string
     onChange: (v: string) => void
     onSubmit: () => void
     error: string | null
     restoring: boolean
   }) {
     return (
       <div style={{ marginTop: 'var(--space-3)' }}>
         <input
           className="input"
           value={value}
           onChange={(e) => onChange(e.target.value)}
           placeholder="Paste Google Drive file link or ID"
           disabled={restoring}
           style={{ marginBottom: 'var(--space-2)', width: '100%' }}
         />
         {error && (
           <div style={{ color: 'var(--color-error)', fontSize: '0.85rem', marginBottom: 'var(--space-2)' }}>
             {error}
           </div>
         )}
         <button className="btn btn-secondary" onClick={onSubmit} disabled={restoring}>
           {restoring ? 'Loading...' : 'Load file'}
         </button>
       </div>
     )
   }
   ```
3. Replace `pickingFile` state (59) with `pasteInput`/`pasteError`/`loadingPastedFile` state (names are implementation's call; keep behavior equivalent).
4. Replace `handlePickFromDrive` (88-112) with a `handleLoadPastedFile` callback:
   - `extractDriveFileId(pasteInput)` → if `null`, `setPasteError("Couldn't find a file ID in that link")`, return (no restore attempt).
   - Else `window.confirm('Restore will replace all data with the backed-up version. Continue?')`; if declined, return.
   - Same body shape as old `handlePickFromDrive`'s try/catch: `restoreBackupFromFileId(fileId, restoreKey)` → on success `onRestored(...)`, `setNoBackupFound(false)`, `setCrossPasswordPrompt(null)`, `setCrossPasswordError(null)`, `alert('Restored from Drive')`; on `DriveDecryptError` → set `crossPasswordPrompt`/clear error/blank password field (same as today); on generic error → `alert('Restore failed: ...')`.
5. Update both render sites (current lines ~197 and ~239) to use `<DrivePasteFallback ... />` instead of `<DrivePickerFallback ... />`.

**Tests:** covered by T4 (this task alone breaks `DriveRestorePanel.test.tsx` — expected, don't run standalone).

**Acceptance:** `grep -n "pickDriveFile\|DrivePickerFallback\|pickingFile" src/components/DriveRestorePanel.tsx` → 0 matches. `grep -n "extractDriveFileId\|DrivePasteFallback" src/components/DriveRestorePanel.tsx` → present.

---

## T4 — DriveRestorePanel.test.tsx: rewrite Picker tests for paste-URL flow
**Depends on:** T3
Files: `src/components/DriveRestorePanel.test.tsx`.

Replace `driveModule.pickDriveFile` mocking with direct `extractDriveFileId`/`restoreBackupFromFileId` mocking (mock `driveModule.restoreBackupFromFileId` to resolve/reject as needed; `extractDriveFileId` can run for real since it's pure, or be mocked — prefer real, it's cheap and exercises the actual parsing).

Rewrite scenarios (same trigger/outcome coverage as before, new interaction mechanics):
- happy: `restoreBackup` resolves null → paste-fallback input+button appear; typing a valid Drive URL and clicking "Load file" confirms, calls `restoreBackupFromFileId` with the extracted id, and on success calls `onRestored`.
- edge: typing garbage (no extractable id) and clicking "Load file" shows the inline "Couldn't find a file ID in that link" error and does NOT call `restoreBackupFromFileId`.
- error → error: wrong password on cross-password prompt reveals the paste-fallback; pasting a file that also fails to decrypt re-opens a blanked cross-password prompt (no stale password value).
- chaining: paste A fails decrypt → blanked prompt → paste B (different id) → still works, previous state discarded.
- edge: `window.confirm` declined → no `restoreBackupFromFileId` call.
- Remove the old `describe('Picker fallback chaining')`'s Picker-cancel test (`'does nothing when the user cancels the Drive picker'`, `'T5.5: Cancelling the picker...'`) — no equivalent concept for a text input; replace with the garbage-input and confirm-declined cases above instead.

**Acceptance:** `npx vitest run src/components/DriveRestorePanel.test.tsx` passes, 0 failures. `grep -n "pickDriveFile\|Search Google Drive" src/components/DriveRestorePanel.test.tsx` → 0 matches.

---

## T5 — Settings.test.tsx: update Picker-flow tests
**Depends on:** T3
Files: `src/components/Settings.test.tsx`.

Same treatment as T4 for this file's picker-flow tests (lines ~244-339 and ~750-1010, including the `T5.2`/chaining/`T5.5` blocks) — since `Settings.tsx` just renders `DriveRestorePanel` unchanged, these tests only need their interaction mechanics swapped (paste input + "Load file" button instead of picker mock), not new component-level assertions.

**Acceptance:** `npx vitest run src/components/Settings.test.tsx` passes, 0 failures. `grep -n "pickDriveFile\|Search Google Drive" src/components/Settings.test.tsx` → 0 matches.

---

## T6 — PasswordGate.test.tsx: update Picker-flow tests
**Depends on:** T3
Files: `src/components/PasswordGate.test.tsx`.

Same treatment for lines ~502-570 (`'restoreBackup resolves null shows "Search Google Drive..." fallback button'` and the pick-and-restore test).

**Acceptance:** `npx vitest run src/components/PasswordGate.test.tsx` passes, 0 failures. `grep -n "pickDriveFile\|Search Google Drive" src/components/PasswordGate.test.tsx` → 0 matches.

---

## T7 — .env: verify no Picker key remains
**Depends on:** T1
Files: `.env` (repo root, untracked, verify-only — already confirmed clean before this plan was written).

```
cat .env   # expect exactly: VITE_GOOGLE_CLIENT_ID=...
grep -rn "VITE_GOOGLE_PICKER_API_KEY" . --include="*.ts" --include="*.tsx" --include="*.md" --include=".env*"
```

**Acceptance:** grep returns 0 matches outside of `plans/portfolio-drive-picker-oauth-fallback.md` (deleted in T8) and this plan file itself.

---

## T8 — Delete superseded plan
**Depends on:** none (can run any time; sequenced late for a clean diff)
Files: `plans/portfolio-drive-picker-oauth-fallback.md`.

```
git rm plans/portfolio-drive-picker-oauth-fallback.md
```

**Acceptance:** file no longer exists; `git status` shows it staged for deletion.

---

## T9 — product-behavior.md: describe paste-URL flow
**Depends on:** T3
Files: `product-behavior.md` (repo root), lines 113 and 124.

- Line 113 (PasswordGate Restore tab paragraph): replace "**No-backup fallback**: if no backup exists, **Search Google Drive...** button appears; picking a file chains to the same cross-password flow" with a description of the paste-input fallback (input + "Load file" button; invalid input shows inline error; valid input follows the same confirm → restore → cross-password-retry chain).
- Line 124 (Settings Drive section paragraph): replace the "**No-backup fallback**" sentence (mentions `pickDriveFile()`, "opening Google's file picker") with the paste-URL description: inline text input + "Load file" button, `extractDriveFileId()` parsing, invalid-input inline error, same confirm/restore/cross-password-retry/chaining behavior as today's picker fallback.

**Acceptance:** `grep -n "Search Google Drive\|picker\|Picker\|pickDriveFile" product-behavior.md` → 0 matches.

---

## T10 — design.md: describe paste-URL flow, drop Picker mechanics
**Depends on:** T3
Files: `design.md` (repo root), lines 46, 147, 154, 156.

- Line 46 (`DriveRestorePanel.tsx` directory comment): replace "no-backup picker fallback" with "no-backup paste-URL fallback".
- Line 147 (PasswordGate absent-state paragraph): replace "picker-fallback paths" with "paste-URL-fallback paths" (or equivalent).
- Line 154 (Drive sync paragraph, "Restore flow (shared DriveRestorePanel component)"): replace "picker-fallback logic" with "paste-URL-fallback logic".
- Line 156 (the whole "Restoring a backup shared by another account" paragraph): rewrite entirely — remove Picker/`apis.google.com`/`google.picker.PickerBuilder`/`setOrigin`/`getAccessToken()` mechanics; describe `extractDriveFileId(input)` (pure regex-based URL/id parser, no network/token involved) feeding `restoreBackupFromFileId(fileId, key)` (unchanged), and that `DriveRestorePanel` renders a shared `DrivePasteFallback` input+button in the same two contexts (`noBackupFound`, `crossPasswordError`).

**Acceptance:** `grep -n "Search Google Drive\|picker\|Picker\|pickDriveFile\|setOAuthToken\|PickerBuilder" design.md` → 0 matches.

---

## T11 — Full-file re-read of updated docs (staleness check)
**Depends on:** T9, T10
Files: `product-behavior.md`, `design.md` (read-only, full file each).

Per CLAUDE.md's mandatory rule for behavior changes: re-read both files in full. Check:
- No other paragraph anywhere in either file still mentions Picker/`pickDriveFile`/dev-key.
- Paste-URL flow description is consistent between the two files (same trigger conditions, same button/field naming) and consistent with T4-T6's test assertions (input placeholder, button label "Load file").
- Terse/token-optimized style preserved.

**Acceptance:** `grep -rn "picker\|Picker\|pickDriveFile\|PICKER" product-behavior.md design.md` → 0 matches. Any additional stale references found are fixed here before moving on.

---

## T12 — Full test/lint/build gate
**Depends on:** T2, T4, T5, T6, T7, T11
Files: none (verification only).

```
npm run test
npm run lint
npm run build
```

Fix any failures before proceeding.

**Acceptance:** all three exit 0 with 0 failures/errors.

---

## T13 — Commit
**Depends on:** T8, T12
Files: none (git operation).

```
git add -A
git commit -m "$(cat <<'EOF'
Replace Google Drive picker with paste-URL restore fallback

- DriveRestorePanel: swap the Picker-based "Search Google Drive..." button for a
  paste-a-link/ID text field, used by both PasswordGate and Settings restore flows
- drive.ts: add extractDriveFileId() (pure URL/ID parser); delete pickDriveFile(),
  loadPickerApi(), and all Google Picker API loading/types
- Update product-behavior.md and design.md to describe the paste-URL flow
- Delete the now-superseded portfolio-drive-picker-oauth-fallback.md plan

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git status
```

**Acceptance:** commit created; `git status` clean aside from expected worktree artifacts.

---

## T14 — Remove worktree
**Depends on:** T13
Files: none (git operation).

```
cd /Users/mdoraiswamy/owa/portfolio
git worktree remove ../worktree-drive-restore-paste-url
```

**Acceptance:** `git worktree list` no longer shows the removed worktree; `/Users/mdoraiswamy/owa/portfolio` is the active working directory.
