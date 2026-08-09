# Data encryption at rest (password gate + AES-GCM)

## Overview

App store all data plain in IndexedDB + Drive JSON backup. Add password gate.
User set password on first run. App derive AES key from password via PBKDF2,
encrypt whole `AppState` blob (one ciphertext, not field-level) before every
IndexedDB write and Drive backup write. Decrypt on load after password entry.
Wrong password = GCM auth tag fail = "wrong password," no separate check
needed. Key lives in memory only (React state in `App.tsx`), never persisted,
lost on refresh/tab-close by design. No lock button.

Crypto: native `SubtleCrypto` only, zero new deps. AES-256-GCM for
encrypt/decrypt. PBKDF2-SHA256 for key derivation, **600,000 iterations**
(OWASP 2023 minimum recommendation for PBKDF2-HMAC-SHA256).

Files in play:
- `src/lib/crypto.ts` — NEW. PBKDF2 derive, AES-GCM encrypt/decrypt, envelope
  type, structural envelope-shape detector (encrypted vs legacy-plaintext vs
  absent). Colocated `crypto.test.ts`.
- `src/lib/persist.ts` — envelope shape change (`{version, salt, iv,
  ciphertext}` instead of raw `AppState`), load/save take a `CryptoKey`
  param, new "peek envelope shape without decrypting" export for the gate.
- `src/lib/drive.ts` — `syncBackup`/`restoreBackup` write/read same envelope
  shape (encrypted), take/return key material as needed.
- `src/lib/state.ts` / `src/lib/reducer.ts` — no new AppState fields (key
  material is explicitly NOT AppState per requirements); may need action
  types only if gate/settings dispatch through the existing reducer for
  `__SET_STATE` (it already exists, reuse it).
- `src/App.tsx` — gate screen wiring (view-ternary pattern, before
  Nav/dashboard), in-memory key + `isUnlocked` state, debounce-save encrypts.
- `src/components/PasswordGate.tsx` — NEW. First-run "set password" screen +
  "enter password" screen + reset-app escape hatch. Colocated
  `PasswordGate.test.tsx`.
- `src/components/Settings.tsx` — password-change UI in General tab (new
  section after Google Drive Sync), Drive-restore cross-password prompt.
- `product-behavior.md`, `design.md`, `schema-spec.md` (repo root) — update
  per CLAUDE.md reference-docs rule, same change not follow-up.

Do NOT touch: `positionsImport.ts`/`transactionsImport.ts`/`csv.ts` (import
pipeline unaffected — it only ever touches in-memory `AppState`, encryption
happens at the persist/drive boundary only). Do NOT add a lock button. Do NOT
add password complexity rules beyond 6-char minimum. Do NOT do field-level
encryption.

**Design decision — key parameter threading**: `loadPersistedApp`/
`savePersistedApp` currently take no key (raw `AppState`). New signatures:
`loadPersistedApp(key: CryptoKey): Promise<AppState | null>` (throws/rejects
on decrypt failure — caller's job to catch and show "wrong password", not
persist.ts's) and `savePersistedApp(state: AppState, key: CryptoKey):
Promise<void>`. A separate cheap `peekEnvelopeShape(): Promise<'absent' |
'legacy-plaintext' | 'encrypted'>` reads the IndexedDB record WITHOUT any
crypto (just inspects whether it has `{salt,iv,ciphertext}` keys) — this is
what the gate uses to decide which screen to show, before any key exists.

**Design decision — legacy plaintext auto-migration**: on first-run password
set, if `peekEnvelopeShape()` returns `'legacy-plaintext'`, read the raw
`AppState` via a new `loadLegacyPlaintextApp()` persist.ts export (old
`store.get` with no decrypt), then immediately `savePersistedApp(legacyState,
newKey)` to overwrite it with the encrypted envelope. Silent, no prompt.

**Design decision — Drive cross-password restore**: `restoreBackup(key:
CryptoKey)` attempts decrypt with the given key; on GCM auth-tag failure it
throws a new named error `DriveDecryptError` (distinct from other restore
failures) carrying the backup's own `salt` so the caller can re-derive with a
user-supplied password without a second Drive round-trip. Settings.tsx
catches specifically `DriveDecryptError`, prompts inline (small prompt, not
full gate) for that backup's password, derives key from typed password +
`error.salt`, retries decrypt client-side (no `restoreBackup` re-call needed
since it already has the ciphertext — expose a pure `decryptEnvelope`-from-
`crypto.ts` helper for this retry path), and on success adopts that key as
the new session key (replaces, does not merge with, current key).

## Tasks

Do in order. Each ≤30 min.

### 1. `src/lib/crypto.ts`: envelope type + shape detector [depends on: nothing]
- Define `interface EncryptedEnvelope { version: 1; salt: string; iv: string;
  ciphertext: string }` (salt/iv/ciphertext as base64 strings — `SubtleCrypto`
  works on `ArrayBuffer`/`Uint8Array`, IndexedDB can store binary directly,
  but Drive backup is JSON text so base64 the binary fields for both stores
  to share one shape/one code path).
- `function detectEnvelopeShape(value: unknown): 'absent' | 'legacy-plaintext'
  | 'encrypted'` — `undefined`/`null` → `'absent'`; object with string
  `salt`/`iv`/`ciphertext` keys and `version === 1` → `'encrypted'`; anything
  else (an `AppState`-shaped object, e.g. has `accounts` array) →
  `'legacy-plaintext'`. Pure function, no I/O, no crypto calls.

### 2. `src/lib/crypto.ts`: PBKDF2 key derivation [depends on: 1]
- `const PBKDF2_ITERATIONS = 600_000`
- `function generateSalt(): Uint8Array` — `crypto.getRandomValues(new
  Uint8Array(16))`.
- `async function deriveKey(password: string, salt: Uint8Array):
  Promise<CryptoKey>` — `crypto.subtle.importKey('raw', utf8(password),
  'PBKDF2', false, ['deriveKey'])` then `crypto.subtle.deriveKey({name:
  'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256'}, baseKey,
  {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt'])`. Key
  non-extractable (`false` extractable flag) — never needs to leave
  SubtleCrypto, matches "never persisted" requirement structurally.

### 3. `src/lib/crypto.ts`: encrypt/decrypt AppState [depends on: 2]
- `function generateIv(): Uint8Array` — `crypto.getRandomValues(new
  Uint8Array(12))` (96-bit IV, GCM standard). Fresh IV every call — never
  reuse.
- `async function encryptState(state: AppState, key: CryptoKey, salt:
  Uint8Array): Promise<EncryptedEnvelope>` — JSON.stringify state, utf8-encode,
  `crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, data)`, base64-encode
  iv/salt/ciphertext, return envelope with `version: 1`.
- `async function decryptState(envelope: EncryptedEnvelope, key: CryptoKey):
  Promise<AppState>` — base64-decode iv/ciphertext, `crypto.subtle.decrypt`
  (throws `OperationError` on auth-tag mismatch — let it propagate, caller
  interprets as wrong password), JSON.parse, return as `AppState`. Do NOT
  catch-and-wrap here — CLAUDE.md's persist.ts pattern is "rethrow, no
  silent success," keep decrypt failures loud all the way to the UI layer
  that shows the inline error.
- base64 helpers: use `btoa(String.fromCharCode(...bytes))` /
  atob-reverse, or `Uint8Array` → base64 via a small local helper — no new
  dep.

### 4. `src/lib/crypto.test.ts`: tests for tasks 1-3 [depends on: 3]
- `detectEnvelopeShape`: absent (undefined/null) → `'absent'`; legacy
  `AppState`-shaped object → `'legacy-plaintext'`; `{version:1,salt,iv,
  ciphertext}` → `'encrypted'`.
- `deriveKey` same password+salt → key that can decrypt what the other
  derivation's key encrypted (round-trip via encryptState/decryptState).
- `deriveKey` same password, different salt → keys are NOT interchangeable
  (encrypt with key A, decrypt with key B from same password different salt
  → throws).
- `encryptState`/`decryptState` round-trip: encrypt an `AppState` fixture,
  decrypt with same key → deep-equal to original.
- Wrong password → decrypt throws (derive a second key from a different
  password + the SAME salt used to encrypt, attempt decrypt, expect reject).
- IV uniqueness: two `encryptState` calls with same state+key → different
  `iv` and different `ciphertext` in the envelope (sanity check fresh IV
  per call).
- Envelope never contains the plaintext password anywhere (grep the
  serialized envelope JSON for the password substring — expect not found).

### 5. `src/lib/persist.ts`: encrypted envelope read/write [depends on: 3]
- Import `encryptState`/`decryptState`/`detectEnvelopeShape`/`EncryptedEnvelope`
  from `./crypto`.
- New export `async function peekEnvelopeShape(): Promise<'absent' |
  'legacy-plaintext' | 'encrypted'>` — open DB, `store.get(STATE_KEY)`, run
  `detectEnvelopeShape` on the raw result, return it. No crypto calls, no key
  param — this is what the gate calls before any password exists.
- New export `async function loadLegacyPlaintextApp(): Promise<AppState |
  null>` — same as current `loadPersistedApp` body today (the coalesce-
  against-`initialState()`-defaults logic), renamed/kept for the one-time
  auto-migration read path. Keep the migration-tolerant field coalescing
  logic here (moves, doesn't duplicate).
- Rewrite `loadPersistedApp(key: CryptoKey): Promise<AppState | null>` —
  `store.get(STATE_KEY)`, if absent return `null`, if shape isn't
  `'encrypted'` throw (caller bug — gate must never call this on a
  legacy/absent envelope), else `decryptState(raw as EncryptedEnvelope,
  key)`, then run the SAME migration-tolerant field coalescing against
  `initialState()` defaults that `loadLegacyPlaintextApp` uses (extract to a
  shared private `coalesceWithDefaults(loaded: Partial<AppState>): AppState`
  helper, call from both paths — don't duplicate the 20-line field list).
- Rewrite `savePersistedApp(state: AppState, key: CryptoKey, salt:
  Uint8Array): Promise<void>` — `encryptState(state, key, salt)`, `store.put`
  the envelope object directly (IndexedDB stores objects natively, no need
  to stringify — base64 fields inside are already strings). Keep existing
  rethrow-on-failure behavior (CLAUDE.md-pinned).
- Note: salt must be stable per-session (same salt reused across saves until
  password change rotates it) — caller (`App.tsx`) holds the salt alongside
  the key in memory, threads it into every `savePersistedApp` call. Persist.ts
  itself is stateless/pure I/O, doesn't cache salt.

### 6. `src/lib/persist.test.ts`: update for encrypted envelope [depends on: 5]
- Update existing round-trip tests to derive a key via `crypto.ts`'s
  `deriveKey`, pass to `savePersistedApp`/`loadPersistedApp`.
- New: `peekEnvelopeShape` returns `'absent'` on empty DB, `'legacy-plaintext'`
  after a raw `store.put(plainAppStateObject)`, `'encrypted'` after a
  `savePersistedApp` call.
- New: `loadLegacyPlaintextApp` reads a raw plaintext blob (old-style
  `store.put(state)`) correctly, with existing migration-tolerance behavior
  (missing collections default) — port the existing coalesce test cases from
  before this change onto this function.
- New: `loadPersistedApp` with wrong key rejects (auth tag fail propagates).
- New: verify saved IndexedDB record contains no substring of the plaintext
  password anywhere in its serialized form (grep the raw stored object).
- Existing migration-tolerance test cases (missing collections default to
  `[]`, institution field defaulting, etc.) must still pass via
  `loadLegacyPlaintextApp` and via `loadPersistedApp` post-decrypt (both go
  through the shared `coalesceWithDefaults` helper from Task 5).

### 7. `src/lib/drive.ts`: encrypted backup read/write [depends on: 3]
- `syncBackup(state: AppState, key: CryptoKey, salt: Uint8Array):
  Promise<string>` — build envelope via `encryptState(state, key, salt)`,
  `JSON.stringify(envelope)` as the file content (was
  `JSON.stringify(state, null, 2)`), rest unchanged (folder ensure, file
  write, return file id).
- New error class `class DriveDecryptError extends Error { salt: Uint8Array
  }` exported from `drive.ts` (or re-exported from `crypto.ts` if cleaner —
  keep it where `restoreBackup` throws it, imports from crypto.ts for the
  base64-decode-salt helper).
- `restoreBackup(key: CryptoKey): Promise<AppState | null>` — unchanged
  connection/folder/file-list logic, but after reading `content`: `JSON.parse`
  it as `EncryptedEnvelope` (was `AppState` directly), decode its salt, try
  `decryptState(envelope, key)`; on `OperationError` (auth tag mismatch)
  catch and rethrow as `new DriveDecryptError('backup encrypted with a
  different password', decodedSalt)`; on any other parse/decrypt error
  rethrow as-is (network/malformed-file cases keep existing generic error
  path). On success return decrypted `AppState`.
- Keep `getBackupFileId`/`getDriveConnection`/`connectDrive`/
  `disconnectDrive`/`getDriveAuthStatus` untouched — they never touch file
  content.

### 8. `src/lib/drive.test.ts`: update for encrypted backup [depends on: 7]
- Update existing `syncBackup`/`restoreBackup` round-trip tests to pass a
  derived key + salt, assert the mocked Drive file's written content is the
  `{version,salt,iv,ciphertext}` JSON shape (not raw `AppState` JSON) —
  grep the written content string for a known plaintext field name (e.g. an
  account name from the fixture) and assert NOT found, proving it's
  encrypted.
- New: `restoreBackup` with correct key round-trips.
- New: `restoreBackup` with wrong key throws `DriveDecryptError` carrying the
  backup's `salt` (base64-decodable, matches the salt used at encrypt time).
- New: `restoreBackup` on a non-decrypt failure (e.g. mocked network error
  from `files.read`) still throws the original error, NOT wrapped as
  `DriveDecryptError`.
- Existing folderPath-pinning test (per CLAUDE.md's drive.ts comment) stays
  untouched — verify still passes, this change doesn't touch `folderPath`.

### 9. `src/components/PasswordGate.tsx`: new component [depends on: 5, 7 not required, can start once crypto.ts (3) lands]
- Props: `{ shape: 'absent' | 'legacy-plaintext' | 'encrypted', onUnlock:
  (key: CryptoKey, salt: Uint8Array, migratedState?: AppState) => void,
  onReset: () => void }`. Caller (`App.tsx`) decides which `shape` to pass
  based on `peekEnvelopeShape()` result (treat `'absent'` and
  `'legacy-plaintext'` the same for which sub-screen renders — both are
  "first-run set password," per requirements — but `PasswordGate` needs to
  know which so it knows whether to attempt the legacy-blob read+migrate).
- **Set-password screen** (`shape !== 'encrypted'`): two fields (new
  password, confirm password), inline error if `password.length < 6`
  ("Password must be at least 6 characters") or if `password !== confirm`
  ("Passwords do not match") on submit. Explanatory note text: password is
  used to encrypt your data locally, it is never saved anywhere, and you
  need it every time you open the app — if you forget it your data cannot
  be recovered (state this plainly, don't soften it — matches "no lockout,
  no recovery" reality of the design). On valid submit: `generateSalt()`,
  `deriveKey(password, salt)`; if `shape === 'legacy-plaintext'`, call
  `loadLegacyPlaintextApp()` from persist.ts, pass that as `migratedState`
  to `onUnlock`; else pass `undefined` (App.tsx treats `undefined` as
  "start from `initialState()`"). Call `onUnlock(key, salt, migratedState)`.
- **Enter-password screen** (`shape === 'encrypted'`): single password
  field. On submit: need the stored salt — component calls a new
  lightweight persist.ts export `async function peekStoredSalt():
  Promise<Uint8Array | null>` (reads raw envelope, base64-decodes `salt`
  field, no full decrypt) to get it, `deriveKey(password, salt)`, then
  attempts `loadPersistedApp(key)`; on success calls
  `onUnlock(key, salt, loadedState)`; on rejection (wrong password) shows
  inline error "Incorrect password" and clears the field, allows unlimited
  retries (no attempt counter, no lockout — per requirement).
- **Reset-app escape hatch** (both screens): a small "Reset app" link/button.
  `window.confirm('This will permanently delete all locally stored data on
  this device. Your Google Drive backup (if any) is not affected but will
  require its own password to restore. Continue?')` — match existing native-
  confirm destructive pattern (see `Settings.tsx`'s account-delete confirm).
  On confirm: new persist.ts export `async function clearPersistedApp():
  Promise<void>` (delete the IndexedDB record entirely — `store.delete
  (STATE_KEY)`, not just overwrite), then call `onReset()` (App.tsx re-
  renders the gate at `shape: 'absent'`).
- Follow existing dialog/field styling conventions (`.field`/`.input`
  classes per CLAUDE.md styling rules — no new inline design tokens, reuse
  the class vocabulary already used elsewhere e.g. in `ImportDialog.tsx`).

### 10. `src/lib/persist.ts`: add `peekStoredSalt` + `clearPersistedApp` [depends on: 5]
- `peekStoredSalt()`: `store.get(STATE_KEY)`, if shape (via
  `detectEnvelopeShape`) isn't `'encrypted'` return `null`, else base64-decode
  and return the `salt` field as `Uint8Array`. (Small enough to fold into
  Task 5's edit pass instead of a separate commit if convenient — listed
  separately here because Task 9 depends on it directly.)
- `clearPersistedApp()`: open DB, `store.delete(STATE_KEY)` in a readwrite
  transaction, resolve/reject on request events (mirror existing
  open/transaction boilerplate in the file).

### 11. `src/components/PasswordGate.test.tsx`: tests [depends on: 9]
- `shape: 'absent'`: renders set-password screen with explanatory note.
- Set-password: submit with <6 chars shows inline error, does not call
  `onUnlock`.
- Set-password: submit with mismatched confirm shows inline error, does not
  call `onUnlock`.
- Set-password: valid submit with `shape: 'absent'` calls `onUnlock(key,
  salt, undefined)` — mock `deriveKey`/`generateSalt` or use real
  `crypto.subtle` (jsdom supports Web Crypto — verify, else mock).
- Set-password: valid submit with `shape: 'legacy-plaintext'` calls
  `loadLegacyPlaintextApp()` (mock persist.ts) and passes its result as
  `migratedState` to `onUnlock`.
- `shape: 'encrypted'`: renders enter-password screen (single field).
- Enter-password: correct password (mock `peekStoredSalt`/
  `loadPersistedApp` to succeed) calls `onUnlock` with loaded state.
- Enter-password: incorrect password (mock `loadPersistedApp` to reject)
  shows "Incorrect password" inline, does NOT call `onUnlock`, field clears,
  resubmitting is allowed (no lockout — assert can retry immediately).
- Reset-app: confirms via `window.confirm` mock, calls `clearPersistedApp()`
  (mocked) then `onReset()`. Declining `confirm` calls neither.
- Reset-app available and wired identically on both set-password and
  enter-password screens.

### 12. `src/App.tsx`: gate wiring + key lifecycle [depends on: 9, 10]
- New state: `const [sessionKey, setSessionKey] = useState<CryptoKey |
  null>(null)`, `const [sessionSalt, setSessionSalt] = useState<Uint8Array |
  null>(null)`, `const [gateShape, setGateShape] = useState<'absent' |
  'legacy-plaintext' | 'encrypted' | null>(null)` (`null` = still checking).
- New effect (runs before/instead of the old hydration effect): on mount,
  call `peekEnvelopeShape()`, set `gateShape`. Do NOT call
  `loadPersistedApp` here — no key yet.
- Replace the old unconditional hydration `useEffect` (lines 90-108 today):
  hydration now only runs AFTER `sessionKey` is set (i.e. after
  `PasswordGate`'s `onUnlock` fires), since decrypt needs the key. Simplest
  shape: `PasswordGate`'s `onUnlock` callback directly receives the already-
  loaded/migrated `AppState` (Task 9's `migratedState`/loaded-state param) —
  dispatch `__SET_STATE` with it right there, no separate hydration effect
  needed. Set `isHydrated = true` in the same callback. This replaces the
  old fire-and-forget `hydrate()` async IIFE entirely.
- Render logic: before the existing `if (!isHydrated)` loading check, add:
  if `gateShape === null` → loading placeholder (reuse existing "Loading
  dashboard..." text/markup); if `sessionKey === null` → render
  `<PasswordGate shape={gateShape} onUnlock={(key, salt, loadedState) => {
  setSessionKey(key); setSessionSalt(salt); if (loadedState) dispatch({type:
  '__SET_STATE', newState: loadedState}); setIsHydrated(true) }}
  onReset={() => { setGateShape('absent'); setSessionKey(null);
  setSessionSalt(null); dispatch({type: '__SET_STATE', newState:
  initialState()}); setIsHydrated(false) }} />` INSTEAD of the
  Nav/dashboard/settings tree (full replacement render, matches existing
  `state.view` ternary pattern per requirements — not a router change).
- Debounce-save effect (lines 155-177 today) and flush-on-unmount effect
  (lines 129-153 today): both currently call `savePersistedApp(state)` with
  no key. Guard both with `if (!sessionKey || !sessionSalt) return` (mirrors
  existing `if (!isHydrated) return` guard) and change calls to
  `savePersistedApp(state, sessionKey, sessionSalt)`. Add `sessionKey`/
  `sessionSalt` to effect dependency arrays where read via closure (the flush
  effect uses refs today for `state`/`isHydrated` — do the same for
  `sessionKey`/`sessionSalt`, i.e. `sessionKeyRef`/`sessionSaltRef`, so the
  flush handler registered once on mount still sees the latest key after
  unlock without re-registering listeners).
- Pass `sessionKey`/`sessionSalt` down to `SettingsPage` as new props (it
  needs them for password-change re-encrypt and Drive sync/restore calls).
- `drive.activate()` wiring (lines 116-121) unaffected — token warm-up has
  nothing to do with encryption.

### 13. `src/App.test.tsx`: update/add tests for gate wiring [depends on: 12]
- Locate existing hydration tests (grep `App.test.tsx` for `loadPersistedApp`/
  `hydrate` mocks) — update mocks to the new `peekEnvelopeShape` +
  `PasswordGate`-driven flow.
- New: on mount with `peekEnvelopeShape` → `'absent'`, renders
  `PasswordGate` (not Nav/dashboard) before any unlock.
- New: completing set-password (simulate `PasswordGate`'s `onUnlock` via
  its own test coverage — at App level, mock `PasswordGate` or drive it via
  its real rendered fields) results in Nav/dashboard rendering and
  `savePersistedApp` being called with a key on subsequent state changes.
- New: debounce-save effect does not call `savePersistedApp` before unlock
  (assert not called while gate is showing, even if `state` changes via
  some pre-unlock dispatch path — should be none, but guards the invariant).
- Existing "Drive-sync activation" test (`drive.activate()` on mount) still
  passes unmodified — confirm activation is independent of gate state.

### 14. `src/components/Settings.tsx`: password-change section [depends on: 5, 7]
- New props: `sessionKey: CryptoKey`, `sessionSalt: Uint8Array`,
  `onKeyChange: (newKey: CryptoKey, newSalt: Uint8Array) => void` (lets
  `Settings` hand the rotated key back up to `App.tsx` state after a
  successful change — mirrors how `dispatch` is already threaded down).
- New section in General tab, placed after "Google Drive Sync" section
  (per requirement ordering): `<h2>Change Password</h2>`, three fields
  (current password, new password, confirm new password), submit button.
- Flow on submit:
  1. `deriveKey(currentPasswordInput, sessionSalt)` → attempt
     `decryptState` against the currently-stored envelope (read raw via a
     persist.ts helper, or simpler: attempt decrypt against the in-memory
     `state` re-encrypted — cleanest is to just verify the CURRENT password
     by comparing whether `deriveKey(currentPasswordInput, sessionSalt)`
     produces a key that successfully decrypts a fresh `peekStoredSalt`-
     sourced envelope read; simplest correct approach: call
     `loadPersistedApp(candidateKey)` and check it resolves vs rejects).
     Reject with inline error "Current password is incorrect" if it throws.
  2. Client-side check: `newPassword.length >= 6` and `newPassword ===
     confirmNewPassword`, inline errors matching `PasswordGate`'s wording,
     same 6-char minimum.
  3. `generateSalt()` — FRESH salt, do not reuse `sessionSalt` (required:
     salt rotation on every password change).
  4. `deriveKey(newPassword, newSalt)` → `newKey`.
  5. `savePersistedApp(state, newKey, newSalt)` (current in-memory `state`
     — the freshest data, not a re-read from disk).
  6. Check Drive connection via existing `getDriveAuthStatus()`; if
     `connected`, call `syncBackup(state, newKey, newSalt)`. If this
     throws, catch it, show a non-blocking inline warning ("Password
     changed locally, but Drive re-sync failed: {message}. Sync manually
     from Google Drive Sync above.") — explicitly do NOT roll back the
     local re-encrypt from step 5 (local password change is not undone by
     a remote sync failure — decided, matches plan requirement).
  7. On local success (step 5 done, regardless of step 6 outcome): call
     `onKeyChange(newKey, newSalt)`, clear all three fields, show success
     message ("Password changed" or similar, distinct from the Drive-
     re-sync-failed warning if that also fired).
- Reuse `.field`/`.input`/`.btn` classes per CLAUDE.md styling rules.

### 15. `src/components/Settings.tsx`: Drive-restore cross-password prompt [depends on: 7, 14]
- Update `handleRestore` (currently line ~59-77): change `restoreBackup()`
  call to `restoreBackup(sessionKey)`. Catch specifically
  `DriveDecryptError` (import from `drive.ts`) separately from the generic
  catch: on that error, prompt inline (small text input, not the full gate
  — e.g. a local `useState` toggling a small inline form, or `window.prompt`
  if that matches the "separate small prompt" requirement more literally —
  prefer inline form for testability, consistent with rest of file's
  patterns) for "This backup was saved with a different password. Enter
  that password to restore:". On submit: `deriveKey(backupPassword,
  error.salt)`, retry decrypt via `crypto.ts`'s `decryptState` directly
  against the already-fetched envelope (avoid a second Drive network
  round-trip — requires `restoreBackup` or a sibling function to expose the
  raw envelope on `DriveDecryptError`, OR simplest: have
  `DriveDecryptError` carry the full `envelope` object, not just `salt`, so
  the retry is pure local `decryptState(error.envelope, retryKey)` with no
  Drive I/O). Revisit Task 7's `DriveDecryptError` shape to include
  `envelope: EncryptedEnvelope` alongside `salt` for this reason.
  On successful retry: dispatch `__SET_STATE` with the decrypted state,
  call `onKeyChange(retryKey, decode(error.envelope.salt))` (adopt as new
  session key going forward — do NOT keep the old key, per requirement),
  show success. On repeated wrong password: inline error, allow retry (same
  no-lockout spirit as the gate).

### 16. `src/components/Settings.test.tsx`: tests for 14-15 [depends on: 14, 15]
- Password-change happy path: correct current password, valid new password,
  Drive not connected → `savePersistedApp` called with new key/salt (mock),
  `onKeyChange` called, success message shown, fields cleared.
- Password-change: wrong current password → inline error, `savePersistedApp`
  NOT called, `onKeyChange` NOT called.
- Password-change: new password <6 chars → inline error, no save attempted.
- Password-change: new password / confirm mismatch → inline error, no save
  attempted.
- Password-change: Drive connected, sync succeeds → `syncBackup` called with
  new key/salt, success message (no warning).
- Password-change: Drive connected, `syncBackup` throws → local
  `savePersistedApp` still happened (assert called), warning message shown,
  `onKeyChange` still called (local change stands per decision in Task 14).
- Drive restore: `restoreBackup` resolves normally (same password) →
  existing behavior unchanged, dispatches `__SET_STATE`.
- Drive restore: `restoreBackup` throws `DriveDecryptError` → inline
  cross-password prompt appears (not `window.confirm`, not full gate
  remount).
- Drive restore: submitting correct backup-password in the prompt →
  decrypts locally (assert no second `restoreBackup`/network call),
  dispatches `__SET_STATE`, calls `onKeyChange` with the new key/salt.
- Drive restore: submitting wrong backup-password in the prompt → inline
  error, prompt stays open, can retry.

### 17. Reference docs update [depends on: 1-16 done, code stable]
- **`product-behavior.md`** (repo root): new top-level section "## Password
  gate" (placed logically, e.g. right after "## Nav" or before "## Settings
  page" since it's the first thing a user sees) — describe: first-run set-
  password screen (fields, 6-char minimum, note text, legacy-blob silent
  migration), enter-password screen (single field, unlimited retries, no
  lockout), reset-app escape hatch (native confirm, wipes IndexedDB only,
  Drive backup untouched), in-memory-only key (lost on refresh/close,
  no manual lock). Update "## Settings page" General-tab bullet to add the
  new Change Password section (fields, current-password verification, salt
  rotation, Drive re-sync-on-change behavior including the sync-failure-
  keeps-local-change decision) and note the Drive-restore cross-password
  inline-prompt behavior in the existing Google Drive Sync bullet.
- **`design.md`** (repo root): add `src/lib/crypto.ts` and
  `src/components/PasswordGate.tsx` to directory structure / component tree.
  Update data flow section: hydration now gated behind unlock (describe new
  sequence: mount → `peekEnvelopeShape` → gate screen → `onUnlock` →
  `__SET_STATE` dispatch with decrypted/migrated state → dashboard).
  Update persist.ts / drive.ts API-contract descriptions (new function
  signatures with `key`/`salt` params, new exports
  `peekEnvelopeShape`/`peekStoredSalt`/`loadLegacyPlaintextApp`/
  `clearPersistedApp`, new `DriveDecryptError`). Note session-key lifecycle
  as a design pattern (in-memory only, threaded via props/refs, not in
  `AppState`/reducer).
- **`schema-spec.md`** (repo root): rewrite "## Persistence envelope"
  section — new shape `{version: 1, salt: string (base64), iv: string
  (base64), ciphertext: string (base64)}` replacing raw `AppState` blob,
  for BOTH IndexedDB (`persist.ts`) and Drive backup (`drive.ts`, same
  shape as the JSON file content instead of plaintext `JSON.stringify
  (state)`). Note legacy-plaintext detection is structural (presence/absence
  of `salt`/`iv`/`ciphertext` keys), migration-tolerant coalescing against
  `initialState()` defaults still happens post-decrypt (unchanged from
  today, just moved after a decrypt step). Note PBKDF2 iteration count
  (600,000) and AES-256-GCM as fixed algorithm choices (not configurable).
- Full read-through of all three files after edits (CLAUDE.md "full-file
  review after major changes" rule) — check no stale/contradicting section,
  still terse/structured, no narrative drift.

### 18. Full test run + commit [depends on: 17]
- `npm run test` — must be fully green (all new + updated test files).
- `npm run build` (typecheck) — must pass; check `CryptoKey`/`SubtleCrypto`
  types resolve under the project's `tsconfig` lib target (may need `"lib":
  [...,"DOM"]` already present — verify, don't guess).
- `npm run lint` — should pass, no new lint debt.
- Grep sanity check across test fixtures: no test literal password string
  ever appears in an asserted "saved to IndexedDB" or "written to Drive"
  blob (spot-check per Task 4/6/8's dedicated tests, but do one more repo-
  wide grep of the test files for the fixture password value against
  mocked storage call args as final gate before commit).
- Commit only after all pass and all three reference docs are current
  (CLAUDE.md rule — no partial/doc-stale commits).

## Test Cases

1. `detectEnvelopeShape`: absent/legacy-plaintext/encrypted classified
   correctly from raw stored values.
2. `deriveKey` + `encryptState`/`decryptState` round-trip with correct
   password succeeds; deep-equal to original `AppState`.
3. Decrypt with wrong password (different derived key, same salt) throws.
4. Two encrypts of the same state produce different IV and different
   ciphertext (fresh IV per call, no reuse).
5. No plaintext password substring ever appears in a serialized envelope
   (IndexedDB record or Drive JSON content).
6. First-run (`peekEnvelopeShape` → `'absent'`): set-password screen shown;
   valid submit creates encrypted envelope with empty initial state, no
   `migratedState`.
7. First-run with legacy plaintext blob present (`'legacy-plaintext'`):
   set-password screen shown; valid submit silently reads the legacy blob,
   encrypts it under the new password, saves — original data intact after
   round-trip through `PasswordGate`'s migration path.
8. Returning user (`'encrypted'`): enter-password screen shown; correct
   password unlocks (dispatches decrypted state); incorrect password shows
   inline error, allows immediate retry with no lockout/attempt limit.
9. Reset-app escape hatch: confirm dialog shown on both gate screens;
   accepting wipes the IndexedDB record (`clearPersistedApp`) and returns to
   first-run `'absent'` state; declining does nothing.
10. Debounce-save (`App.tsx`) never calls `savePersistedApp` before
    `onUnlock` fires; calls it with `(state, sessionKey, sessionSalt)` after.
11. Flush-on-unmount/pagehide/visibilitychange-hidden path also gated on
    session key presence and uses the latest key via ref (survives an
    unlock that happens after the listeners are first registered).
12. Drive backup round-trip: `syncBackup` writes `{version,salt,iv,
    ciphertext}` JSON (not plaintext), `restoreBackup` with the same key
    decrypts back to the original `AppState`.
13. Drive restore with a key derived from a different password than the
    backup's throws `DriveDecryptError` carrying that backup's `salt` (and
    `envelope`); a non-decrypt failure (e.g. network error) is NOT wrapped
    as `DriveDecryptError`.
14. Settings.tsx: Drive-restore cross-password inline prompt appears only
    on `DriveDecryptError`; correct backup-password decrypts locally
    (no second Drive network call) and adopts the new key as the session
    key going forward (dispatches `__SET_STATE`, calls `onKeyChange`).
15. Settings.tsx: password-change happy path — correct current password
    verifies, new password (≥6 chars, matching confirm) triggers fresh-salt
    re-derive, re-encrypt, save; in-memory session key replaced.
16. Settings.tsx: password-change rejects wrong current password with
    inline error, no save/key-change occurs.
17. Settings.tsx: password-change with Drive connected triggers
    `syncBackup` with the new key/salt immediately after local save.
18. Settings.tsx: password-change with Drive `syncBackup` failure surfaces
    a warning but the local password change (already saved) is NOT rolled
    back; session key still updated to the new one.
19. Salt rotates (new random salt, not reused) on every password change —
    assert the salt passed to the post-change `savePersistedApp`/
    `syncBackup` differs from the pre-change salt.
20. Existing migration-tolerance test cases (missing collections default to
    `[]`, `institution` field defaulting, etc.) still pass, now exercised
    through `loadLegacyPlaintextApp` (pre-migration read) and post-decrypt
    `loadPersistedApp` (both via the shared `coalesceWithDefaults` helper).
21. Existing `drive.ts` `folderPath` pinning test unaffected/still passing.
22. `npm run test`, `npm run build`, `npm run lint` all green.

## Acceptance Criteria

- [ ] `src/lib/crypto.ts` created: PBKDF2 (600,000 iterations, SHA-256) key
      derivation, AES-256-GCM encrypt/decrypt, `EncryptedEnvelope` type,
      `detectEnvelopeShape` structural detector. Colocated `crypto.test.ts`,
      all passing.
- [ ] `persist.ts`: envelope shape is `{version, salt, iv, ciphertext}`;
      `loadPersistedApp`/`savePersistedApp` take a `CryptoKey` (+ `salt` for
      save); new `peekEnvelopeShape`, `peekStoredSalt`,
      `loadLegacyPlaintextApp`, `clearPersistedApp` exports; existing
      rethrow-on-failure and migration-tolerant coalescing behavior
      preserved (now shared via one helper, exercised by both legacy and
      encrypted load paths).
- [ ] `drive.ts`: `syncBackup`/`restoreBackup` read/write the same encrypted
      envelope shape as the Drive JSON file content; `DriveDecryptError`
      (carrying `salt` + `envelope`) thrown specifically on cross-password
      decrypt failure, distinct from other restore failures.
- [ ] `PasswordGate.tsx`: full-replacement gate screen (App.tsx view-ternary
      pattern) shown before Nav/dashboard on every load until unlocked;
      set-password screen (6-char minimum, confirm match, note text, silent
      legacy-blob auto-migration) and enter-password screen (unlimited
      retries, no lockout) both implemented; reset-app escape hatch on both
      (native confirm, wipes IndexedDB only, Drive untouched).
- [ ] `App.tsx`: derived key + salt + `isUnlocked` state live in component
      state only (not in `AppState`/reducer), lost on refresh/unmount by
      design, no manual lock control; debounce-save and flush-on-unmount
      paths encrypt with the session key and never fire before unlock.
- [ ] `Settings.tsx`: Change Password section added to General tab (after
      Google Drive Sync) — current-password verification, fresh salt on
      every change, local re-encrypt-and-save, conditional Drive re-sync
      (failure surfaces a warning but does not roll back the local change),
      session key replaced on success. Drive restore flow prompts inline for
      a backup's password on cross-password failure and adopts the new key.
- [ ] Data is unreadable in both IndexedDB and the Drive backup file without
      the correct password (verified by tests asserting no plaintext field/
      password substrings appear in stored/written blobs).
- [ ] Password itself is never persisted anywhere (IndexedDB, Drive,
      `AppState`) — verified by grep-style test assertions.
- [ ] Existing users' legacy plaintext `AppState` blob is transparently
      migrated to the encrypted envelope on first password set, no separate
      migration screen/step, no data loss (round-trip verified in tests).
- [ ] `npm run test`, `npm run build`, `npm run lint` all green.
- [ ] `product-behavior.md`, `design.md`, `schema-spec.md` (repo root)
      updated per CLAUDE.md's reference-docs rule as part of this same
      change (not a follow-up), full-file reviewed for staleness/
      consistency after edits.
- [ ] Commit made only after tests pass, build/lint clean, and all three
      reference docs are current (CLAUDE.md rule — no partial/doc-stale
      commits).
