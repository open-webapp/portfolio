# Plan: Drive Picker fallback on decrypt failure + drop Picker dev-key requirement

Repo: `/Users/mdoraiswamy/owa/portfolio`.

Two things, done together:

1. Today the Google Drive file picker fallback ("Search Google Drive...") only shows up when `restoreBackup` finds **no file at all** (`noBackupFound`). It does NOT show up when a file is found but fails to decrypt twice in a row (wrong password on the cross-password retry, `crossPasswordError`). Make it show in both cases, one button, chainable (pick A, wrong password, pick B, wrong password, pick C...).
2. `pickDriveFile()` currently requires `VITE_GOOGLE_PICKER_API_KEY` and calls `.setDeveloperKey(...)`. Drop that requirement entirely — Picker works fine off the cached OAuth token alone (`.setOAuthToken(...)`, already called). Remove the const, the throw-if-missing guard, the `.setDeveloperKey()` call, and the `.env` entry.

## In Scope

- `src/lib/drive.ts` — `pickDriveFile()`: remove `GOOGLE_PICKER_API_KEY` const (import.meta.env read), remove the throw-if-missing guard, remove `.setDeveloperKey(...)` call and the `setDeveloperKey` members of the `GooglePickerNamespace`/`PickerBuilderChain` hand-typed interfaces.
- `src/lib/drive.test.ts` — remove the now-false "throws without VITE_GOOGLE_PICKER_API_KEY" test; update the two other `pickDriveFile()` tests to drop `vi.stubEnv('VITE_GOOGLE_PICKER_API_KEY', ...)` and assert `setDeveloperKey` is never called.
- `.env` (repo root, untracked) — remove the `VITE_GOOGLE_PICKER_API_KEY=` line and its preceding comment block.
- `src/components/Settings.tsx` — unify the "no backup found" picker button and a new "decrypt failed twice" picker button into one code path/component, rendered whenever `noBackupFound` OR `crossPasswordPrompt && crossPasswordError` is true. On a freshly-picked file that also fails to decrypt with the current session key, blank the password field (already mostly true — verify/adjust) instead of pre-filling the just-typed wrong password.
- `src/components/Settings.test.tsx` — new tests for: fallback button appears after cross-password retry fails; clicking it opens picker; picking a new file resets to a blank password prompt on decrypt failure; chaining (pick A fails, pick B fails, pick B's blank prompt shown, not A's leftover value).
- Root `product-behavior.md`, `design.md` — update the two paragraphs that currently describe "no backup found" and cross-password restore as two separate, differently-triggered flows, and remove the dev-key requirement mention in `design.md`.

## Out of Scope

- Any change to the first cross-password retry step (default file fails to decrypt → inline password prompt). Unchanged.
- Any change to `restoreBackupFromFileId`/`readAndDecryptFile`/`DriveDecryptError`/`restoreBackup` in `drive.ts` — their signatures and behavior stay as-is.
- Any change to `syncBackup`, `getBackupFileId`, `getDriveAuthStatus`, `connectDrive`, token-refresh logic.
- `Settings.test.tsx.bak` (stale 1458-line leftover from an earlier refactor, still tracked in git per `git log`) — not touched. Flagged as an open question below, not part of this work.
- Change Encryption Password section, PasswordGate, any non-Settings/non-drive.ts file.

## Current code (read, exact line refs)

`src/lib/drive.ts`:
- `368`: `const GOOGLE_PICKER_API_KEY = import.meta.env.VITE_GOOGLE_PICKER_API_KEY as string | undefined`
- `393-394`, `406-407`: `setDeveloperKey(key: string): ...` in `GooglePickerNamespace.PickerBuilder` and `PickerBuilderChain` interfaces
- `477-482`: `pickDriveFile()` signature + throw-if-missing guard
- `499`: `.setDeveloperKey(GOOGLE_PICKER_API_KEY!)` in the builder chain

`src/lib/drive.test.ts`:
- `548-553`: test `'throws a clear error when VITE_GOOGLE_PICKER_API_KEY is not configured'`
- `555-576`: test `'resolves with the picked file id/name...'` — has `vi.stubEnv('VITE_GOOGLE_PICKER_API_KEY', 'test-picker-key')` (556) and `expect(chain.setDeveloperKey).toHaveBeenCalledWith('test-picker-key')` (574)
- `578-589`: test `'resolves null when the user cancels the picker'` — has `vi.stubEnv(...)` (579)
- `499-519`: `installPickerFake()` helper builds a `chain` with a `setDeveloperKey: vi.fn().mockReturnThis()` spy (510) — keep the spy in the fake (harmless, just assert it's never called), don't remove it from the fake itself.

`src/components/Settings.tsx`:
- `61-74`: state — `crossPasswordPrompt`, `backupPasswordInput`, `crossPasswordError`, `restoringWithBackupPassword`, `noBackupFound`, `pickingFile`
- `76-101`: `handleRestore()` — sets `noBackupFound` true when `restoreBackup` resolves `null`; on `DriveDecryptError` sets `crossPasswordPrompt`/clears `crossPasswordError`/clears `backupPasswordInput`
- `103-125`: `handlePickFromDrive()` — calls `pickDriveFile()`, then `restoreBackupFromFileId(picked.id, sessionKey)`; on success dispatches + `setNoBackupFound(false)`; on `DriveDecryptError` sets `crossPasswordPrompt`/clears `crossPasswordError`/clears `backupPasswordInput` (same reset as `handleRestore`'s catch — this already blanks the password field, confirm it survives the refactor)
- `127-146`: `handleCrossPasswordSubmit()` — on failure sets `crossPasswordError = 'Incorrect encryption password'`, prompt stays open
- `311-325`: `noBackupFound` block — copy + `Search Google Drive...` button (`handlePickFromDrive`, disabled while `pickingFile`)
- `328-367`: `crossPasswordPrompt` block — password field, submit/cancel buttons, `crossPasswordError` message at `363-365` (no fallback button today — this is what's missing)

`src/components/Settings.test.tsx`:
- `262-276`: `'shows the "Search Google Drive..." fallback (not an alert) if restore returns null'`
- `277-296`: `'picking a file via "Search Google Drive..." restores and dispatches __SET_STATE'`
- `297-314`: `'does nothing when the user cancels the Drive picker'`
- `315-339`: `'a wrong-password backup picked via the Drive picker opens the cross-password prompt'`
- `621-750`: `describe('Cross-password Drive restore')` — `718-749` is `'shows an inline error and keeps the prompt open (retryable) on a wrong backup password'`; no test today covers a fallback button appearing here — new tests land in/after this describe block.

`.env` (untracked, repo root):
```
VITE_GOOGLE_CLIENT_ID=308299244860-aon0lkcjf1fo81pqlvhi9si93ddgjnp8.apps.googleusercontent.com
# Google Cloud Console (same project as the client id above) > APIs & Services
# > Library > enable "Google Picker API" > Credentials > Create Credentials >
# API key. Restrict it to the Picker API + your dev/prod origins. Required
# for Settings > "Search Google Drive..." (restoring a backup someone else
# shared with this account) — see pickDriveFile() in src/lib/drive.ts.
VITE_GOOGLE_PICKER_API_KEY=
```
Lines 2-7 to remove (comment block + the key line), line 1 stays.

Root `design.md` line `153` (Drive sync data-flow paragraph) ends with a `.env` requirement sentence covering `VITE_GOOGLE_CLIENT_ID` only — fine, unaffected. Root `design.md` line `154` (picker paragraph) says: `"(requires VITE_GOOGLE_PICKER_API_KEY in .env, throws a clear error if unset)"` — this must go.

Root `product-behavior.md` line `121` (the whole `Settings page` bullet paragraph) has two sentences to rewrite: the "**No backup found fallback**" sentence (mentions "requires `VITE_GOOGLE_PICKER_API_KEY`") and needs a new/merged description covering the crossPasswordError-triggered case too.

## Design for the unified fallback (Settings.tsx)

Add one small local component (in the same file, no new file needed — it's ~15 lines) or an inline extracted render function:

```tsx
function DrivePickerFallback({ pickingFile, onPick }: { pickingFile: boolean; onPick: () => void }) {
  return (
    <div style={{ marginTop: 'var(--space-3)' }}>
      <button className="btn btn-secondary" onClick={onPick} disabled={pickingFile}>
        {pickingFile ? 'Opening Drive...' : 'Search Google Drive...'}
      </button>
    </div>
  )
}
```

Render it in two places, each keeping its own lead-in copy (the two cases have different explanatory sentences, only the button+behavior unify):
- Inside the existing `noBackupFound` block (`311-325`) — same copy as today, swap the raw `<button>` for `<DrivePickerFallback pickingFile={pickingFile} onPick={handlePickFromDrive} />`.
- Inside the `crossPasswordPrompt` block, gated on `crossPasswordError` being set (i.e. after `363-365`'s error message), with new copy: something like "Still not the right password? If this backup came from a different Google account, search Drive for the right file instead:" — exact wording is a copy/UX call for whoever implements, not load-bearing for tests (tests assert on the button, not this sentence).

`handlePickFromDrive` behavior already does the right thing on a decrypt-error from the picked file (blanks `backupPasswordInput`, clears `crossPasswordError`, sets a fresh `crossPasswordPrompt` with the new salt/envelope) — this is what makes chaining work, since each pick just overwrites `crossPasswordPrompt` wholesale. Verify (via new tests, T7) this holds when `crossPasswordPrompt` was already non-null before the pick (the chained case) — no special-casing should be needed since the state setters are unconditional, but confirm with a real test rather than assuming.

One gap: `handlePickFromDrive`'s success path (`109-112`) does `dispatch(...)`, `setNoBackupFound(false)`, `alert(...)` — it does NOT clear `crossPasswordPrompt`/`crossPasswordError` if the pick was launched from the crossPasswordError fallback (as opposed to the noBackupFound fallback). Add `setCrossPasswordPrompt(null)` and `setCrossPasswordError(null)` to the success path so a successful chained pick actually closes the prompt instead of leaving a stale error message behind under the now-restored state.

## Test Strategy

- `drive.test.ts`: full `npm run test` gate; the 3 touched `pickDriveFile()` tests must pass with no env var involved at all (delete one, edit two).
- `Settings.test.tsx`: extend `describe('Cross-password Drive restore')` with the chained-fallback scenarios (happy: button appears + works; edge: chain twice; edge: blank password field, not pre-filled/stale).
- Full-suite gate (`npm run test`, `npm run lint`, `npm run build`) before commit, per CLAUDE.md.
- No new test file — both target files already exist and are extended.

## Risks

- **Copy/text duplication drift**: two lead-in sentences (noBackupFound vs. crossPasswordError) must both stay accurate if `pickDriveFile()`'s behavior changes later — low risk, both point at the same button/handler.
- **Chained state resets**: `handlePickFromDrive`'s DriveDecryptError catch already does the blank-password reset unconditionally; the risk is only in the *success* path forgetting to close a pre-existing `crossPasswordPrompt` (called out above, T4 must add this).
- **Runtime Picker failure without a dev key**: removing `.setDeveloperKey()` is per Google's own Picker docs (an OAuth token alone is sufficient for `drive.file`-scoped picks) but this plan does not add any new runtime guard for a hypothetical Google-side rejection — per explicit resolved requirement #5, any such failure just surfaces through the existing generic `Restore failed: ${error.message}` alert path. Accepted, not a bug to pre-empt.

## Open Questions

1. `src/components/Settings.test.tsx.bak` (1458 lines, tracked in git, last touched by commit `a827b9d` "Restructure Settings page tabs from 3 to 2") looks like dead leftover — the live `Settings.test.tsx` is 751 lines and clearly the active file (imported/run by vitest; `.bak` is not picked up by vitest's default glob). Not in scope per the task brief's explicit instruction, but worth a human decision on whether to `git rm` it in a separate cleanup — flagging, not acting.
2. Exact lead-in copy for the new crossPasswordError fallback sentence is left as a judgment call for the implementing task (T5) — not specified by the user, and none of the planned tests assert on its exact wording (only on the button's accessible name `Search Google Drive...`, matching the existing pattern).
3. Branch naming: repo's existing branches don't follow one single convention (`feature/x`, `bugfix/x`, `x-y-z/main`, `x/descriptor`); this plan uses `drive-picker-oauth-fallback/main`, matching the `<topic>/<descriptor>` shape of the most recent branch (`portfolio-v11-design-sync/implement-v11-overview-accounts`). Adjust at T0 if this doesn't match whatever the team is doing by the time this plan is picked up.

---

## T0 — Create worktree, confirm baseline
**Depends on:** none

```
git worktree add ../worktree-drive-picker-oauth-fallback -b drive-picker-oauth-fallback/main
cd ../worktree-drive-picker-oauth-fallback
npm install
npm run test
```

**Acceptance:** `npm run test` passes with 0 failures on the fresh worktree before any edits. All later tasks run inside this worktree.

---

## T1 — drive.ts: remove Picker dev-key requirement
**Depends on:** T0
Files: `src/lib/drive.ts`.

Remove:
- Line `368`: `const GOOGLE_PICKER_API_KEY = import.meta.env.VITE_GOOGLE_PICKER_API_KEY as string | undefined`
- Lines `393-394` and `406-407`: the `setDeveloperKey(key: string): ...` interface members on `GooglePickerNamespace.PickerBuilder`'s return type and `PickerBuilderChain`
- Lines `477-482`: the `if (!GOOGLE_PICKER_API_KEY) { throw ... }` guard at the top of `pickDriveFile()`
- Line `499`: `.setDeveloperKey(GOOGLE_PICKER_API_KEY!)` from the builder chain

Also update the JSDoc on `pickDriveFile()` (currently `474-476`: `@throws If VITE_GOOGLE_PICKER_API_KEY is not configured, the Picker script fails to load, or acquiring a token fails.`) — drop the dev-key clause, keep the script-load/token clauses.

**Tests:** covered by T2 (same PR, `drive.test.ts` updated together — don't run tests standalone here, this task alone leaves `drive.test.ts` red).

**Acceptance:** `grep -n "GOOGLE_PICKER_API_KEY\|setDeveloperKey" src/lib/drive.ts` → 0 matches.

---

## T2 — drive.test.ts: update pickDriveFile() tests
**Depends on:** T1
Files: `src/lib/drive.test.ts`.

- Delete the test at `548-553`: `'throws a clear error when VITE_GOOGLE_PICKER_API_KEY is not configured'`.
- In `'resolves with the picked file id/name, loading gapi + picker and requesting a token'` (`555-576`): remove `vi.stubEnv('VITE_GOOGLE_PICKER_API_KEY', 'test-picker-key')` (line 556). Remove `expect(chain.setDeveloperKey).toHaveBeenCalledWith('test-picker-key')` (line 574) and replace with `expect(chain.setDeveloperKey).not.toHaveBeenCalled()`. Keep `expect(chain.setOAuthToken).toHaveBeenCalledWith('mock-access-token')` (573) as-is.
- In `'resolves null when the user cancels the picker'` (`578-589`): remove `vi.stubEnv('VITE_GOOGLE_PICKER_API_KEY', 'test-picker-key')` (line 579).
- Leave `installPickerFake()`'s `chain.setDeveloperKey: vi.fn().mockReturnThis()` (line 510) in place — it's a harmless unused-if-uncalled spy, useful for the `.not.toHaveBeenCalled()` assertion above. Don't delete it.
- Leave the `afterEach`'s `vi.unstubAllEnvs()` (line 493) in place — harmless no-op once nothing stubs env vars in this `describe` block, and other tests in the file may still rely on env stubbing elsewhere (none do today per grep, but it's a no-cost no-op either way).

**Tests:**
- happy: `pickDriveFile()` resolves the picked file without any `VITE_GOOGLE_PICKER_API_KEY` env var set at all (ambient — nothing stubs it anymore).
- happy: `setOAuthToken` called with the token; `setDeveloperKey` never called.
- happy: cancel path still resolves `null`.

**Acceptance:** `npx vitest run src/lib/drive.test.ts` passes, 0 failures. `grep -n "VITE_GOOGLE_PICKER_API_KEY" src/lib/drive.test.ts` → 0 matches.

---

## T3 — .env: remove the Picker API key entry
**Depends on:** T0 (independent of T1/T2, can run any time, but sequenced here for a clean diff review)
Files: `.env` (repo root, untracked).

Remove lines 2-7 (the 5-line comment block + `VITE_GOOGLE_PICKER_API_KEY=`), keep line 1 (`VITE_GOOGLE_CLIENT_ID=...`) untouched. Final file is 1 line.

**Tests:** none (untracked local config file, no test reads its content beyond `VITE_GOOGLE_CLIENT_ID` which is untouched — `drive.test.ts`'s `'drive clientId is configured via VITE_GOOGLE_CLIENT_ID in .env'` test still passes).

**Acceptance:** `cat .env` shows exactly the `VITE_GOOGLE_CLIENT_ID=...` line, nothing else. `npx vitest run src/lib/drive.test.ts` still passes (client-id test unaffected).

---

## T4 — Settings.tsx: unify the picker fallback button + fix success-path prompt reset
**Depends on:** T1 (so the underlying `pickDriveFile()` no longer needs a dev key — not strictly required for this task to compile, but keeps the two changes landing together for one coherent diff)
Files: `src/components/Settings.tsx`.

1. Add a small local component near the top of the file (after imports, before `SettingsPageProps`, or just above `SettingsPage` — either is fine, pick one):
   ```tsx
   function DrivePickerFallback({ pickingFile, onPick }: { pickingFile: boolean; onPick: () => void }) {
     return (
       <div style={{ marginTop: 'var(--space-3)' }}>
         <button className="btn btn-secondary" onClick={onPick} disabled={pickingFile}>
           {pickingFile ? 'Opening Drive...' : 'Search Google Drive...'}
         </button>
       </div>
     )
   }
   ```
2. In the `noBackupFound` block (`311-325`), replace the raw `<button className="btn btn-secondary" onClick={handlePickFromDrive} disabled={pickingFile}>...</button>` with `<DrivePickerFallback pickingFile={pickingFile} onPick={handlePickFromDrive} />`. Keep the surrounding `<p>` copy exactly as-is.
3. In the `crossPasswordPrompt` block (`328-367`), after the `crossPasswordError` paragraph (`363-365`), add: `{crossPasswordError && (<><p style={{marginTop:'var(--space-3)', marginBottom:'var(--space-2)', fontSize:'13px'}}>If this backup came from a different Google account, search Drive for the right file instead:</p><DrivePickerFallback pickingFile={pickingFile} onPick={handlePickFromDrive} /></>)}` — i.e. the fallback shows immediately after the "Incorrect encryption password" message, only when `crossPasswordError` is truthy (exact copy text is a judgment call, see Open Question 2 — not asserted by tests).
4. In `handlePickFromDrive`'s success branch (`109-112`, inside the `try`), add `setCrossPasswordPrompt(null)` and `setCrossPasswordError(null)` alongside the existing `setNoBackupFound(false)` — so a successful pick-and-restore closes any lingering cross-password prompt from a prior failed attempt (this is the gap called out in the plan's Design section above; without it a chained success would leave a stale error message on screen even though state was replaced).
5. Confirm (read-through, no code change needed if already true) that `handlePickFromDrive`'s `DriveDecryptError` catch (`114-119`) sets `crossPasswordPrompt` to the *new* file's salt/envelope, blanks `backupPasswordInput`, and clears `crossPasswordError` — this is what gives the "blank password field for the newly-picked file" behavior from resolved requirement #3. It already does; just verify no change is needed here.

**Tests:** covered by T5 (component tests land together with this task's behavior — don't try to hand-verify via `npm run dev`, use the test suite).

**Acceptance:** `grep -n "DrivePickerFallback" src/components/Settings.tsx` → 3 matches (definition + 2 usages). `grep -n "setCrossPasswordPrompt(null)" src/components/Settings.tsx` → present inside `handlePickFromDrive`'s success branch, not just its cancel/no-op path.

---

## T5 — Settings.test.tsx: new tests for the chained fallback
**Depends on:** T4
Files: `src/components/Settings.test.tsx`.

Add tests inside (or immediately after) `describe('Cross-password Drive restore')` (starts line `621`), following the existing pattern used by `'shows an inline error and keeps the prompt open (retryable) on a wrong backup password'` (`718-749`) and the noBackupFound-picker tests at `262-339` for how to mock `driveModule.pickDriveFile`/`restoreBackupFromFileId`.

**Test cases:**
- happy: after a failed cross-password retry (`crossPasswordError` set, same setup as the existing 718 test), `screen.getByRole('button', { name: 'Search Google Drive...' })` is now present (it wasn't before this change — assert it wasn't rendered pre-retry-failure, i.e. absent right after the first `DriveDecryptError`, only appears after `handleCrossPasswordSubmit` fails).
- happy: clicking that button calls `pickDriveFile()`; picking a file that decrypts successfully with `sessionKey` dispatches `__SET_STATE` and closes the prompt (`crossPasswordPrompt` gone — assert the "This backup was saved with a different encryption password" text is no longer in the document).
- edge (the core new scenario): clicking that button, picking a file that ALSO fails to decrypt (`DriveDecryptError` from `restoreBackupFromFileId`) — assert the password input is blank (`value === ''`) and `crossPasswordError` is cleared (the old "Incorrect encryption password" text is gone), i.e. a fresh, non-pre-filled prompt for the new file.
- edge (chaining): pick file A → fails → password field blank → type a value → submit → fails again (`crossPasswordError` set) → fallback button present again → click → pick file B → fails → assert the password field is blank again (not the value typed for file A) and the prompt now carries file B's salt/envelope (can assert indirectly: a subsequent correct-password submit for file B's actual password succeeds and dispatches file B's state, not file A's).
- edge: cancelling the picker (resolves `null`) from the crossPasswordError fallback does nothing — prompt/error state unchanged, mirroring the existing noBackupFound cancel test at `297-314`.

**Acceptance:** `npx vitest run src/components/Settings.test.tsx` passes, 0 failures, including all pre-existing tests.

---

## T6 — Root product-behavior.md: rewrite the Settings page paragraph
**Depends on:** T4
Files: `product-behavior.md` (repo root), line `121` (the long `Settings page` bullet under `## Settings page`).

Rewrite the "**Cross-password restore**" and "**No backup found fallback**" sentences into one coherent description:
- Keep the existing first-attempt cross-password prompt description as-is (unchanged behavior).
- Add: if that retry ALSO fails (`crossPasswordError` set), the same "Search Google Drive..." fallback used for the no-backup-found case now also appears here, letting the user pick a different file; picking one always retries with the current session key first, and on a second decrypt failure shows a **blank** password prompt for the newly-picked file (not pre-filled with the password just tried) — this can chain across multiple picks.
- Update the "No backup found fallback" sentence to note it's the same underlying button/component as the cross-password-retry-failure case, not a separate one.
- Remove the parenthetical `(requires VITE_GOOGLE_PICKER_API_KEY)` — that requirement is gone.

**Tests:** none (doc-only).

**Acceptance:** `grep -n "VITE_GOOGLE_PICKER_API_KEY" product-behavior.md` → 0 matches. The paragraph describes one fallback button reachable from two trigger conditions.

---

## T7 — Root design.md: drop dev-key mention, note the unified fallback
**Depends on:** T4
Files: `design.md` (repo root), line `154` (the `pickDriveFile` data-flow paragraph in `## Data flow` → `**Restoring a backup shared by another account**`).

Remove `(requires VITE_GOOGLE_PICKER_API_KEY in .env, throws a clear error if unset)`. Add a short clause noting `Settings.tsx` now offers this picker fallback both when no default-location backup exists (`noBackupFound`) and when a cross-password retry has also failed (`crossPasswordError`), via one shared `DrivePickerFallback` component. Check `## Component tree` and the `Settings.tsx` one-line summary (line `46`: `Google Drive Sync + cross-password restore prompt, Change Password`) — leave as-is, still accurate at that level of granularity (no need to enumerate the new fallback button there).

**Tests:** none (doc-only).

**Acceptance:** `grep -n "VITE_GOOGLE_PICKER_API_KEY" design.md` → 0 matches.

---

## T8 — Full-file re-read of both updated docs (staleness check)
**Depends on:** T6, T7
Files: `product-behavior.md`, `design.md` (read-only, full file each).

Per CLAUDE.md's mandatory rule for behavior changes: re-read both files in full after T6/T7's edits. Check specifically:
- No other paragraph anywhere in either file still references `VITE_GOOGLE_PICKER_API_KEY` (grep both files, not just the touched lines — `design.md`'s `.env` config summary near the top, if any, could also mention it).
- No leftover reference to the picker fallback being "only when no backup found" elsewhere in either file (e.g. a summary/TOC-style line earlier in `product-behavior.md`'s `## Layout` section, or `design.md`'s directory-structure comment for `drive.ts` at line `23`, which currently just lists function names — confirm it doesn't need a dev-key mention removed too).
- Terse/token-optimized style preserved, no narrative bloat introduced by the rewrite.

**Tests:** none.

**Acceptance:** `grep -rn "VITE_GOOGLE_PICKER_API_KEY" product-behavior.md design.md` → 0 matches, confirmed by direct grep, not just the earlier targeted edits. Any additional stale references found are fixed in this same task before moving on.

---

## T9 — Full test/lint/build gate
**Depends on:** T2, T3, T5, T8
Files: none (verification only).

```
npm run test
npm run lint
npm run build
```

Fix any failures before proceeding.

**Acceptance:** all three exit 0 with 0 failures/errors.

---

## T10 — Commit
**Depends on:** T9
Files: none (git operation).

```
git add -A
git commit -m "$(cat <<'EOF'
Extend Drive picker fallback to cross-password retry failures; drop Picker dev-key requirement

- Settings: unify the "Search Google Drive..." fallback so it also appears after a failed cross-password retry, not just when no default backup is found; chainable across multiple picks, blanks the password field for each newly-picked file
- drive.ts: pickDriveFile() no longer requires/uses VITE_GOOGLE_PICKER_API_KEY — OAuth token alone is sufficient for the Picker
- Remove the now-unused .env entry and its setup comment

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git status
```

**Acceptance:** commit created, `git status` clean (aside from expected worktree artifacts, if any).

**Note:** this task only commits to the local worktree branch. Merging to `main` is a separate, human-reviewed PR step — not automated here.

---

## T11 — Remove worktree
**Depends on:** T10
Files: none (git operation).

```
cd /Users/mdoraiswamy/owa/portfolio
git worktree remove ../worktree-drive-picker-oauth-fallback
```

**Acceptance:** `git worktree list` no longer shows the removed worktree; `/Users/mdoraiswamy/owa/portfolio` is the active working directory.
