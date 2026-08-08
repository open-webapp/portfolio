# Mapping Profile Name Uniqueness + Delete — Implementation Plan

Enforce unique (per-`kind`, trim+case-insensitive) `MappingProfile.name`, with a
conflict-resolution dialog at save time, and add a delete affordance for profiles
in the profile-select step of both import dialogs.

This plan is written caveman-simple on purpose: small tasks, explicit deps,
concrete types. Read it top to bottom before coding task 1.

## Decisions locked (from requirements interview — do not re-litigate)

1. Uniqueness scoped per `kind` only; comparison trim + case-insensitive; a
   profile being edited never conflicts with itself (exclude its own id).
2. Conflict check happens at Save-time in the parent dialog's `handleProfileSave`,
   not live-as-you-type, via a new pure helper `findNameConflict`.
3. On conflict, show new `ProfileConflictDialog` component (modal, using existing
   `.dialog-backdrop`/`.dialog` classes) showing both fieldMaps side by side, with
   "Keep Existing" (no dispatch, return to editor, fieldMap/accountNumberColumn
   preserved, name cleared) and "Overwrite" (dispatch `UPDATE_MAPPING_PROFILE` for
   the *existing* profile's id with merged fields; if editing a *different*
   profile than the one collided with, also dispatch `DELETE_MAPPING_PROFILE` for
   the edited-source profile so exactly one profile with that name remains).
4. Add a small delete/trash button next to each profile row in profile-select
   step of both `ImportPositionsDialog` and `ImportTransactionsDialog`; confirms
   via `window.confirm`, dispatches existing `DELETE_MAPPING_PROFILE`.
5. `MappingProfile` type is unchanged — this is UI-behavior only.

## Overview

**What we're adding**:
- `findNameConflict(profiles, kind, name, excludeId?)` pure helper in
  `src/lib/mappingProfiles.ts`.
- `ProfileConflictDialog` component (`src/components/import/ProfileConflictDialog.tsx`),
  exported from `src/components/import/index.ts`.
- Conflict-aware `handleProfileSave` in `ImportPositionsDialog.tsx` and
  `ImportTransactionsDialog.tsx` (identical pattern in both), including a new
  dialog step (or overlay flag) to render `ProfileConflictDialog` and the
  "clear name on Keep Existing" behavior fed back into `MappingProfileEditor`.
- Trash/delete icon button next to each profile row in both dialogs'
  profile-select step, using `window.confirm` + existing `DELETE_MAPPING_PROFILE`.
- Reference doc updates: `product-behavior.md` (CSV import section).

**What we are NOT changing**:
- `MappingProfile` interface / `schema-spec.md` (no schema change).
- Reducer logic — `ADD_MAPPING_PROFILE`/`UPDATE_MAPPING_PROFILE`/`DELETE_MAPPING_PROFILE`
  already exist and are sufficient (`src/lib/reducer.ts:100-119`).
- `validateProfile` (unrelated — field-mapping completeness, not name uniqueness).
- Any CSV parsing / import-apply logic.

**Source-of-truth references**:
- `src/lib/mappingProfiles.ts` — add `findNameConflict` here, alongside
  `createProfile`/`updateProfile`/`deleteProfile`/`listProfilesForKind`.
- `src/components/import/MappingProfileEditor.tsx` — `handleSave` (~line 63),
  `profileName` state (~line 35). Needs a way for the parent to force-clear
  `profileName` after "Keep Existing" without losing `fieldMap`/`accountNumberColumn`.
- `src/components/import/ImportPositionsDialog.tsx` — `handleProfileSave` (~line 75),
  `DialogStep` type (~line 13), profile-select step render (~line 207-253).
- `src/components/import/ImportTransactionsDialog.tsx` — mirror of the above,
  transactions-scoped.
- `src/components/import/index.ts` — barrel export.
- `product-behavior.md` — CSV import section (~line 49 onward).

## Architecture

```
portfolio/
  src/
    lib/
      mappingProfiles.ts            # + findNameConflict()
      mappingProfiles.test.ts       # + findNameConflict test cases
    components/
      import/
        ProfileConflictDialog.tsx    # NEW: side-by-side fieldMap diff + Keep/Overwrite
        ProfileConflictDialog.test.tsx  # NEW
        MappingProfileEditor.tsx     # + forceClearName mechanism (prop or key-remount)
        MappingProfileEditor.test.tsx   # + tests for clear-on-conflict behavior
        ImportPositionsDialog.tsx    # + conflict step, + delete button in profile-select
        ImportTransactionsDialog.tsx # same, transactions-scoped
        index.ts                     # + ProfileConflictDialog export
  product-behavior.md                # CSV import section updated
```

## Tasks

### Task 1: Add `findNameConflict` helper + tests

**File**: `src/lib/mappingProfiles.ts`
**Depends on**: none

**Changes**: Add pure function:
```ts
export function findNameConflict(
  profiles: MappingProfile[],
  kind: 'positions' | 'transactions',
  name: string,
  excludeId?: string
): MappingProfile | undefined {
  const target = name.trim().toLowerCase()
  return profiles.find(
    (p) =>
      p.kind === kind &&
      p.id !== excludeId &&
      p.name.trim().toLowerCase() === target
  )
}
```

**File**: `src/lib/mappingProfiles.test.ts`
**Add test cases** (append to existing describe block):
1. Same-kind name collision detected (two `positions` profiles, same name) →
   returns the conflicting profile.
2. Different-kind, same name → returns `undefined` (a `positions` profile named
   "Foo" does not conflict with a `transactions` profile named "Foo").
3. Case/whitespace insensitivity: `"  My Profile  "` conflicts with `"my profile"`.
4. `excludeId` self-match: profile being edited (its own id passed as
   `excludeId`) does not conflict with itself even though the name is identical.
5. No conflict when name is unique within kind → returns `undefined`.

**Acceptance**:
- `findNameConflict` exported and typed as above.
- All 5 new tests pass; existing tests unaffected.

---

### Task 2: Build `ProfileConflictDialog` component

**File**: `src/components/import/ProfileConflictDialog.tsx` (new)
**Depends on**: Task 1 (uses `MappingProfile` type; no direct call to
`findNameConflict` inside the component — parent passes both profiles in)

**Props**:
```ts
export interface ProfileConflictDialogProps {
  existingProfile: MappingProfile   // the one already in state with that name
  newProfile: MappingProfile        // the one the user just tried to save
  onKeepExisting: () => void
  onOverwrite: () => void
}
```

**Render**: Use `.dialog-backdrop` / `.dialog` classes (per CLAUDE.md styling
rule — no new inline-style modal markup). Body shows two columns/lists,
"Existing: <name>" vs "New: <name>", each rendering
`Object.entries(profile.fieldMap).map(([csvCol, field]) => csvCol + ' → ' + field)`
in the same compact list format used by the Review step in the import dialogs
(`ImportPositionsDialog.tsx` ~line 306-313). Footer: two buttons, "Keep Existing"
(calls `onKeepExisting`) and "Overwrite" (calls `onOverwrite`). No dispatch
inside this component — it is presentation + callback only, all state
mutation happens in the parent dialog (Task 3/4).

**File**: `src/components/import/index.ts`
**Changes**: add
```ts
export { ProfileConflictDialog } from './ProfileConflictDialog'
export type { ProfileConflictDialogProps } from './ProfileConflictDialog'
```

**Acceptance**:
- Component renders both fieldMaps distinctly labeled existing vs new.
- Clicking each button invokes the corresponding callback exactly once, no
  dispatch/side effects inside the component itself.
- Exported from barrel.

---

### Task 3: Wire conflict detection + clear-name-on-Keep into `MappingProfileEditor`

**File**: `src/components/import/MappingProfileEditor.tsx`
**Depends on**: Task 1

**Changes**: The editor itself does not call `findNameConflict` (per decision
#2, the check happens in the parent's `handleProfileSave`, which receives the
already-built `newProfile` object from `onSave`). What the editor needs is a
way to be told "the name you just tried was rejected, clear it and let the user
retry" without losing `fieldMap`/`accountNumberColumn`. Add:
```ts
export interface MappingProfileEditorProps {
  // ...existing props
  clearNameSignal?: number   // parent increments this to force-clear name
}
```
In the component, add a `useEffect` keyed on `clearNameSignal` that calls
`setProfileName('')` when it changes (but not on initial mount — guard with a
ref or skip if `clearNameSignal === undefined`). `fieldMap` and
`accountNumberColumn` state are untouched by this effect — they remain exactly
as the user left them.

*Rationale for `clearNameSignal` over a boolean*: parent may need to trigger
the clear multiple times in a row (retry → conflict again → Keep Existing
again) and a boolean toggling true/false could collide with React batching;
an incrementing counter guarantees the effect fires every time.

**Acceptance**:
- Passing an incrementing `clearNameSignal` clears `profileName` to `''` on
  each change, `fieldMap`/`accountNumberColumn` state unchanged.
- Omitting `clearNameSignal` (existing callers/tests) — no behavior change.

---

### Task 4: Wire conflict flow into `ImportPositionsDialog`

**File**: `src/components/import/ImportPositionsDialog.tsx`
**Depends on**: Task 1, Task 2, Task 3

**Changes**:
- Add `'profile-conflict'` to `DialogStep` union (~line 13).
- Add state: `const [conflict, setConflict] = useState<{ existing: MappingProfile; incoming: MappingProfile } | null>(null)` and `const [clearNameSignal, setClearNameSignal] = useState(0)`.
- Rewrite `handleProfileSave` (~line 75):
  ```ts
  const handleProfileSave = useCallback((profile: MappingProfile) => {
    const conflicting = findNameConflict(
      state.mappingProfiles,
      'positions',
      profile.name,
      editingProfile?.id
    )
    if (conflicting) {
      setConflict({ existing: conflicting, incoming: profile })
      setStep('profile-conflict')
      return
    }
    if (profile.id.startsWith('map-') /* still relying on same new-vs-update check already in code */) {
      dispatch({ type: 'ADD_MAPPING_PROFILE', profile })
    } else {
      dispatch({ type: 'UPDATE_MAPPING_PROFILE', profileId: profile.id, profile })
    }
    setSelectedProfile(profile)
    setStep('review')
  }, [state.mappingProfiles, editingProfile, dispatch])
  ```
  (Note: existing `profile.id.startsWith('map-')` new/update check is pre-existing
  code, kept as-is — not part of this feature, do not "fix" it here.)
- Add handlers:
  ```ts
  const handleKeepExisting = useCallback(() => {
    setConflict(null)
    setClearNameSignal((n) => n + 1)
    setStep('profile-editor')
  }, [])

  const handleOverwrite = useCallback(() => {
    if (!conflict) return
    const { existing, incoming } = conflict
    const merged: MappingProfile = {
      ...existing,
      name: incoming.name,
      fieldMap: incoming.fieldMap,
      accountNumberColumn: incoming.accountNumberColumn,
      updatedAt: new Date().toISOString(),
    }
    dispatch({ type: 'UPDATE_MAPPING_PROFILE', profileId: existing.id, profile: merged })
    // Edge case: editingProfile is a different profile than the one we collided with
    if (editingProfile && editingProfile.id !== existing.id) {
      dispatch({ type: 'DELETE_MAPPING_PROFILE', profileId: editingProfile.id })
    }
    setConflict(null)
    setSelectedProfile(merged)
    setStep('review')
  }, [conflict, editingProfile, dispatch])
  ```
- Import `findNameConflict` and `ProfileConflictDialog`.
- Render `'profile-conflict'` step:
  ```tsx
  {step === 'profile-conflict' && conflict && (
    <ProfileConflictDialog
      existingProfile={conflict.existing}
      newProfile={conflict.incoming}
      onKeepExisting={handleKeepExisting}
      onOverwrite={handleOverwrite}
    />
  )}
  ```
- Pass `clearNameSignal={clearNameSignal}` to the `<MappingProfileEditor>` in
  the `'profile-editor'` step render.
- Update `handleCloseDialog` to also reset `conflict` and `clearNameSignal`... 
  (clearNameSignal reset not strictly required since it's a monotonically
  increasing counter with no leak, but reset `conflict` to `null` on close).

**Acceptance**:
- Saving a profile whose (trimmed, lowercased) name matches another profile of
  the same kind (excluding self when editing) shows `ProfileConflictDialog`
  instead of dispatching.
- "Keep Existing" returns to `'profile-editor'` step with fieldMap/
  accountNumberColumn intact and name field cleared.
- "Overwrite" dispatches `UPDATE_MAPPING_PROFILE` for the existing profile's id
  with merged name/fieldMap/accountNumberColumn + fresh updatedAt, preserving
  existing profile's `id`/`createdAt`; when editing a different profile than
  the collision target, also dispatches `DELETE_MAPPING_PROFILE` for the
  edited-source profile's id.
- Non-conflicting save dispatches exactly as before (no regression).

---

### Task 5: Wire conflict flow into `ImportTransactionsDialog`

**File**: `src/components/import/ImportTransactionsDialog.tsx`
**Depends on**: Task 1, Task 2, Task 3 (same pattern as Task 4, transactions-scoped)

**Changes**: Identical structure to Task 4 — read the current file first to
confirm exact state/prop names (dialog step union, `handleProfileSave`,
`selectedProfile`/`editingProfile` state) since this file may not be byte-identical
to `ImportPositionsDialog.tsx`, then mirror every change from Task 4 with
`kind: 'transactions'` in the `findNameConflict` call and dispatch payloads.

**Acceptance**: same acceptance bullets as Task 4, transactions-scoped.

---

### Task 6: Add delete button to profile-select step (both dialogs)

**Files**: `src/components/import/ImportPositionsDialog.tsx`,
`src/components/import/ImportTransactionsDialog.tsx`
**Depends on**: none (independent of Tasks 2-5, can be done in parallel with them)

**Changes** (in `ImportPositionsDialog.tsx`, profile-select step ~line 216-234;
mirror in transactions dialog):
- Wrap each profile row in a flex container holding the existing select
  button plus a new small trash/delete button:
  ```tsx
  <div key={profile.id} style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
    <button
      onClick={() => handleSelectExistingProfile(profile.id)}
      style={{ flex: 1, /* ...existing button styles... */ }}
    >
      {profile.name}
    </button>
    <button
      onClick={() => handleDeleteProfile(profile.id, profile.name)}
      aria-label={`Delete profile ${profile.name}`}
      title="Delete profile"
      style={{ padding: '8px 10px', border: '1px solid var(--color-divider)', background: 'var(--color-surface)', borderRadius: '4px', cursor: 'pointer' }}
    >
      🗑
    </button>
  </div>
  ```
- Add handler:
  ```ts
  const handleDeleteProfile = useCallback((profileId: string, profileName: string) => {
    if (!window.confirm(`Delete mapping profile "${profileName}"? This cannot be undone.`)) {
      return
    }
    dispatch({ type: 'DELETE_MAPPING_PROFILE', profileId })
  }, [dispatch])
  ```
- No reducer changes — `DELETE_MAPPING_PROFILE` case already exists
  (`src/lib/reducer.ts:115-119`).

**Acceptance**:
- Each profile row in profile-select shows both a select button and a delete
  button, independently clickable.
- Clicking delete without confirming (`window.confirm` returns false) leaves
  `state.mappingProfiles` unchanged.
- Confirming dispatches `DELETE_MAPPING_PROFILE` with the correct `profileId`;
  the deleted profile no longer renders in the list on next render.
- Deleting a profile does not affect `selectedProfile`/`editingProfile` state
  of an unrelated in-progress import (only matters if user deletes a profile
  other than the one they're mid-flow with — no special handling needed since
  profile-select is the only step where delete is exposed).

---

### Task 7: Update `product-behavior.md`

**File**: `product-behavior.md`, CSV import section (~line 49 onward)
**Depends on**: Tasks 4, 5, 6 (describes final behavior)

**Changes**: Extend the "Profile select" step description (~line 54) to note:
- Each profile row has a delete (trash) action with a `window.confirm`
  guard; deleting removes it from `state.mappingProfiles` immediately, no undo.
- Add a new bullet/subsection describing name-uniqueness: names must be unique
  per `kind` (positions vs transactions checked independently), comparison is
  trim + case-insensitive, checked at Save time (not while typing). On
  conflict, a `ProfileConflictDialog` appears showing both fieldMaps side by
  side with "Keep Existing" (returns to editor, fieldMap preserved, name
  cleared, no state change) and "Overwrite" (replaces the existing profile's
  fieldMap/name/accountNumberColumn under its original `id`, and — if the
  conflict arose from renaming a different profile into the collision — deletes
  the original source profile so only one profile with that name remains).

**Note**: `schema-spec.md` MappingProfile section is unchanged — no schema
change in this feature; explicitly do not edit it (avoid doc drift from
touching something that didn't change).

**Acceptance**:
- `product-behavior.md` CSV import section accurately describes delete +
  uniqueness/conflict behavior.
- `schema-spec.md` left untouched, verified by `git diff schema-spec.md`
  showing no changes from this feature's commits.

---

### Task 8: Tests — `MappingProfileEditor.test.tsx` / `ProfileConflictDialog.test.tsx`

**Files**: `src/components/import/MappingProfileEditor.test.tsx` (extend),
`src/components/import/ProfileConflictDialog.test.tsx` (new)
**Depends on**: Task 2, Task 3

**Add to `MappingProfileEditor.test.tsx`**:
1. Passing an incrementing `clearNameSignal` prop clears the name input value
   while `fieldMap`/`accountNumberColumn`-derived UI selections remain intact
   (assert via rendered `<select>` values, not internal state).
2. Omitting `clearNameSignal` — existing tests all still pass unmodified (no
   regression from optional prop).

**Add to `ProfileConflictDialog.test.tsx`** (new file):
1. Renders both `existingProfile.fieldMap` and `newProfile.fieldMap` entries,
   labeled distinctly (e.g. query for "Existing" and "New" section headers).
2. Clicking "Keep Existing" calls `onKeepExisting` exactly once, does not call
   `onOverwrite`.
3. Clicking "Overwrite" calls `onOverwrite` exactly once, does not call
   `onKeepExisting`.

**Acceptance**: all new/updated tests pass; `npm run test` green.

---

### Task 9: Tests — dialog-level conflict + delete flows

**Files**: `ImportPositionsDialog.test.tsx`, `ImportTransactionsDialog.test.tsx`
(create if they don't already exist — check first; if genuinely absent, add
minimal new test files covering only this feature's flows, not a full
retrofit of existing behavior)
**Depends on**: Task 4, Task 5, Task 6

**Test cases** (per dialog):
1. Saving a new profile with a name matching an existing same-kind profile
   (case/whitespace-insensitive) shows `ProfileConflictDialog` instead of
   dispatching `ADD_MAPPING_PROFILE`.
2. "Keep Existing" from the conflict dialog returns to the profile editor step
   with no dispatch and the previously-entered fieldMap intact (only name
   cleared).
3. "Overwrite" dispatches `UPDATE_MAPPING_PROFILE` targeting the *existing*
   (colliding) profile's id, with the new fieldMap/name/accountNumberColumn.
4. Edge case: editing profile A, renaming it to collide with profile B,
   choosing "Overwrite" → dispatches both `UPDATE_MAPPING_PROFILE` (for B's id)
   and `DELETE_MAPPING_PROFILE` (for A's id).
5. Saving a genuinely non-conflicting name dispatches normally
   (`ADD_MAPPING_PROFILE` or `UPDATE_MAPPING_PROFILE` as appropriate), no
   conflict dialog shown — regression check.
6. Clicking the delete/trash button on a profile row, confirming via mocked
   `window.confirm` returning `true`, dispatches `DELETE_MAPPING_PROFILE` with
   that profile's id.
7. Clicking delete, mocked `window.confirm` returning `false`, dispatches
   nothing.

**Acceptance**: all 7 cases pass per dialog (14 total); `npm run test` green
with no regressions in pre-existing suites.

---

### Task 10: Full doc review + final test run + commit

**Depends on**: Tasks 1-9 complete

**Steps**:
1. Re-read `product-behavior.md` CSV import section in full — check for
   internal consistency (no contradictions between the delete bullet and the
   uniqueness bullet), terseness, no stale references to the old single-button
   profile row.
2. Confirm `schema-spec.md` has zero diff from this feature (per Task 7 note).
3. Run `npm run test` — must be fully green.
4. Run `npm run build` (typecheck) — must pass with no new TS errors (the
   `clearNameSignal` optional prop, `findNameConflict` signature, and new
   component must all type-check cleanly).
5. Run `npm run lint`.
6. Commit only once 3-5 all pass, per CLAUDE.md's commit rule.

**Acceptance**:
- `npm run test`, `npm run build`, `npm run lint` all pass.
- `product-behavior.md` updated and internally consistent; `schema-spec.md`
  unchanged.
- Single commit (or small set) covering helper, component, both dialog
  wirings, delete UI, docs, and tests together — feature is complete and
  documented, not partial.

## Test cases (consolidated)

**`mappingProfiles.test.ts` — `findNameConflict`**:
- Same-kind conflict detected.
- Different-kind, same name → no conflict.
- Case/whitespace insensitivity.
- `excludeId` prevents self-match.
- Unique name → no conflict.

**`MappingProfileEditor.test.tsx`**:
- `clearNameSignal` increment clears name, preserves fieldMap/accountNumberColumn.
- Omitted `clearNameSignal` → no regression.

**`ProfileConflictDialog.test.tsx`**:
- Renders both fieldMaps, distinctly labeled.
- "Keep Existing" → `onKeepExisting` only.
- "Overwrite" → `onOverwrite` only.

**`ImportPositionsDialog.test.tsx` / `ImportTransactionsDialog.test.tsx`**:
- Conflicting save → conflict dialog, no dispatch.
- Keep Existing → back to editor, fieldMap preserved, no dispatch.
- Overwrite → `UPDATE_MAPPING_PROFILE` on existing/target id.
- Overwrite + renamed-different-source edge case → `UPDATE_MAPPING_PROFILE` +
  `DELETE_MAPPING_PROFILE`.
- Non-conflicting save → normal dispatch, no conflict dialog (regression check).
- Delete button + confirm(true) → `DELETE_MAPPING_PROFILE`.
- Delete button + confirm(false) → no dispatch.

## Acceptance criteria

- [ ] `findNameConflict(profiles, kind, name, excludeId?)` exists in
      `src/lib/mappingProfiles.ts`, trims + lowercases both sides, scoped by
      `kind`, excludes `excludeId`.
- [ ] Saving a mapping profile whose name collides (per above rules) with an
      existing same-kind profile shows `ProfileConflictDialog` instead of
      silently creating/updating a duplicate-named profile.
- [ ] `ProfileConflictDialog` shows both profiles' fieldMaps side by side using
      existing `.dialog-backdrop`/`.dialog` CSS classes (no new inline-style
      modal markup).
- [ ] "Keep Existing" never dispatches, returns user to the profile editor
      with `fieldMap`/`accountNumberColumn` untouched and only the name field
      cleared.
- [ ] "Overwrite" always preserves the *existing* (target) profile's `id` and
      `createdAt`, applies the new name/fieldMap/accountNumberColumn, and sets
      a fresh `updatedAt`.
- [ ] Overwrite's rename-into-collision edge case results in exactly one
      profile with the final name (source profile deleted).
- [ ] Both `ImportPositionsDialog` and `ImportTransactionsDialog` implement
      identical conflict-handling and delete-button behavior (positions- and
      transactions-scoped respectively).
- [ ] Profile-select step in both dialogs shows a delete/trash action per
      profile row, guarded by `window.confirm`, dispatching the existing
      `DELETE_MAPPING_PROFILE` action — no new reducer logic added.
- [ ] `MappingProfile` type in `src/lib/types.ts` and `schema-spec.md` are
      unchanged by this feature.
- [ ] `product-behavior.md` CSV import section documents uniqueness,
      conflict-dialog behavior, and the delete action.
- [ ] `npm run test`, `npm run build`, `npm run lint` all pass before commit.
