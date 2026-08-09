# Step 2 Profile Flow (Use Existing vs Create New) — Implementation Plan

Restructure Step 2 ("Map columns") of the unified `ImportDialog` so the user
first chooses between using an existing saved mapping profile or creating a new
one, then goes through the corresponding single-path flow with a save-and-continue
primary action and name-collision overwrite handling.

This plan is written caveman-simple on purpose: small tasks, explicit deps,
concrete types. Read it top to bottom before coding task 1.

## Decisions locked (from requirements interview — do not re-litigate)

1. Step 2 entry: if `listProfilesForKind(state.mappingProfiles, dataType)` is
   non-empty, show a two-button seg control "Use existing" (default) / "Create
   new". If no profiles exist for that data type, hide the control entirely and
   render the create-new grid directly.
2. "Use existing" branch: kind-scoped profile dropdown + a "Continue" button
   disabled until a profile is selected. No mapping grid shown. On Continue,
   load that profile's `fieldMap`/`constants` (mirror `handleProfileSelect`,
   which already does this at `ImportDialog.tsx:347-362`), record its id as
   `selectedProfileId`, and advance to Step 3. No "missing CSV column" warning
   here — Step 3 validation surfaces it.
3. "Create new" branch: always-visible profile-name text input (starts BLANK,
   placeholder "e.g., Fidelity Positions") + the existing mapping grid
   unchanged. Primary button relabeled "Save Profile & Continue", disabled until
   (a) name non-empty (trimmed) AND (b) required fields mapped. **Resolved (was
   an open question):** there is no Step-2 gating today (the plain Continue at
   `ImportDialog.tsx:1104-1116` is ungated) — the plan adds the gating, aligning
   the code with what `product-behavior.md:67` already documents. Use
   `validateProfile` (already handles the avgCost/purchaseAmount and
   price/marketValue alternative pairs).
4. Clicking "Save Profile & Continue" dispatches `ADD_MAPPING_PROFILE`
   (`createProfile(name, dataType, fieldMap, constants)`), sets the new profile's
   id as `selectedProfileId`, then advances to Step 3.
5. Name collision: before dispatching ADD, look up `state.mappingProfiles` for a
   profile of the same `kind` with the same name (trim + case-insensitive). If
   found: `window.confirm("A mapping profile named 'X' already exists. Overwrite
   it with this mapping?")`. Confirm → dispatch `UPDATE_MAPPING_PROFILE` on the
   existing profile (preserve its `id`/`createdAt`, apply new `fieldMap`/
   `constants`/name, fresh `updatedAt` via `updateProfile`) and advance to Step 3.
   Cancel → stay on the grid, name field intact.
6. Toggling between "Use existing" and "Create new" NEVER clears the in-progress
   create-new work (`fieldMap`, `constants`, `profileName`) — the toggle only
   changes the active branch.
7. Back from Step 3 to Step 2 returns to the same branch with work intact:
   create-new → grid still populated; use-existing → that profile still selected.
   (Component state already persists across `handleBack` at `ImportDialog.tsx:263-265`.)
8. Keep existing Step 1/3/4 logic untouched. Cancel/close resets everything as
   today (`handleCloseDialog`, `ImportDialog.tsx:115-141`) plus the new branch
   state.

## Overview

**What we're adding/changing** (all in `src/components/import/ImportDialog.tsx`):
- New `profileMode` state (`'use-existing' | 'create-new'`).
- A seg-style two-button control at the top of Step 2 (replaces the "Use Saved
  Profile" label + dropdown section, `ImportDialog.tsx:796-819`).
- "Use existing" branch: dropdown + gated Continue (no mapping grid).
- "Create new" branch: always-visible name input + mapping grid + gated
  "Save Profile & Continue".
- `handleSaveProfileAndContinue` (replaces `handleSaveProfile`,
  `ImportDialog.tsx:389-407`) with inline name-collision check + `window.confirm`
  overwrite path. The old inline "Save as Profile" toggle UI
  (`ImportDialog.tsx:1007-1088`) and `showSaveProfile` state are removed.
- Reset of `profileMode` in `handleCloseDialog`.

**What we are NOT changing**:
- `MappingProfile` interface / `schema-spec.md` (no schema change).
- Reducer logic — `ADD_MAPPING_PROFILE`/`UPDATE_MAPPING_PROFILE` already exist
  (`src/lib/reducer.ts:94-106`); action shapes unchanged (`action.profile`,
  `action.profileId`).
- `src/lib/mappingProfiles.ts` — no new helpers. Reuse `listProfilesForKind`,
  `createProfile`, `updateProfile`, `validateProfile`. The name-collision check
  is a tiny local `.find(...)` inline in the dialog.
- `handleProfileSelect` (`ImportDialog.tsx:347-362`) — still used by the
  use-existing branch; its `'create-new'` magic-value branch is left in place
  (harmless) or removed at implementer's discretion.
- Steps 1/3/4 render and handlers.

**Source-of-truth references**:
- `src/components/import/ImportDialog.tsx` — `DialogStep` (line 27), Step-2
  state (`selectedProfileId` line 61, `showSaveProfile` line 62, `profileName`
  line 63), `handleContinue` (line 242), `handleBack` (line 263),
  `handleProfileSelect` (line 347), `handleSaveProfile` (line 389),
  `handleCloseDialog` (line 115), Step 2 render (lines 794-1119: profile
  dropdown 796-819, mapping grid 821-1005, save-as-profile 1007-1088, action
  buttons 1090-1117).
- `src/lib/mappingProfiles.ts` — `listProfilesForKind` (line 56),
  `createProfile` (line 8), `updateProfile` (line 30), `validateProfile` (line 103).
- `src/components/import/ImportDialog.test.tsx` — 16 tests; see Task 6 for the
  breakage map.
- `product-behavior.md` — CSV import "Step 2 — Map columns" section (lines 60-67).

## Architecture

```
portfolio/
  src/components/import/
    ImportDialog.tsx             # all code changes (Tasks 1-5)
    ImportDialog.test.tsx        # update broken tests (Task 6) + add new (Task 7)
  product-behavior.md            # Step 2 section rewritten (Task 8)
  src/lib/design.md              # CSV import pipeline line only if stale (Task 8)
```

No new files, no lib changes, no schema changes.

## Tasks

### Task 1: Add `profileMode` state + seg control / entry gate

**File**: `src/components/import/ImportDialog.tsx`
**Depends on**: none

**Changes**:
- Add state near the other Step-2 state (line 63):
  ```ts
  const [profileMode, setProfileMode] = useState<'use-existing' | 'create-new'>('use-existing')
  ```
- In the Step 2 render, compute `const kindProfiles = listProfilesForKind(state.mappingProfiles, dataType)` once. Replace the "Use Saved Profile" label + dropdown block (lines 796-819) with:
  - If `kindProfiles.length === 0`: render nothing (go straight to the create-new grid below; grid renders regardless).
  - Else: a two-button seg control "Use existing" / "Create new" styled like the Step-1 data-type buttons (lines 474-515 — the dialog uses inline styles, stay consistent). `onClick` only calls `setProfileMode(...)`. Toggling touches nothing else (fieldMap/constants/profileName/selectedProfileId are untouched — decision #6).
- When `kindProfiles.length === 0`, treat the branch as create-new even if `profileMode` is `'use-existing'` (guard with `const effectiveMode = kindProfiles.length === 0 ? 'create-new' : profileMode` and render off `effectiveMode`).

**Acceptance**:
- Seg control renders iff profiles exist for the chosen data type; otherwise absent and grid shows directly.
- Toggling the seg control preserves `fieldMap`, `constants`, `profileName`, `selectedProfileId`.

---

### Task 2: "Use existing" branch — dropdown + gated Continue

**File**: `src/components/import/ImportDialog.tsx`
**Depends on**: Task 1

**Changes**:
- When `effectiveMode === 'use-existing'`, render (instead of the mapping grid):
  - A dropdown of `kindProfiles` (`value={selectedProfileId}`, options with no `""`/`"-- Create new mapping --"` sentinel). `onChange` calls the existing `handleProfileSelect(e.target.value)` (loads `fieldMap`/`constants`, lines 347-362).
  - A footer with "Back" and "Continue", Continue `disabled` until `selectedProfileId !== ''`.
- Add handler:
  ```ts
  const handleUseExistingContinue = useCallback(() => {
    if (!selectedProfileId) return
    handleProfileSelect(selectedProfileId)  // idempotent re-load of fieldMap/constants
    setImportEdits({})
    setStep(3)
  }, [selectedProfileId, handleProfileSelect])
  ```
  (No `handleContinue` call needed for step 2→3 — mirror the step-2 branch of
  `handleContinue` at lines 252-255: reset edits, advance. Leave `handleContinue`
  untouched for its Step 1→2 and 3→4 duties.)
- No mapping grid, no "Save as Profile" UI in this branch. No missing-column
  warning (decision #8) — Step 3 validates.

**Acceptance**:
- Dropdown lists only profiles of the current data type; selecting one loads its mapping into state.
- Continue disabled until a profile is selected; clicking it advances to Step 3 with that profile's mapping applied.

---

### Task 3: "Create new" branch — always-visible name input + gated "Save Profile & Continue"

**File**: `src/components/import/ImportDialog.tsx`
**Depends on**: Task 1

**Changes**:
- When `effectiveMode === 'create-new'`, render the existing mapping grid (lines 821-1005) unchanged.
- Remove the `showSaveProfile` toggle + "Save as Profile" button + inline Cancel block (lines 1007-1088). Replace with an always-visible "Profile Name" input bound to `profileName` (placeholder `"e.g., Fidelity Positions"`, starts blank). Keep the `profileName` state (line 63); delete the `showSaveProfile` state (line 62) and its reset in `handleCloseDialog` (line 135).
- Footer: "Back" + primary button relabeled **"Save Profile & Continue"**, `disabled` until:
  ```ts
  const requiredMapped = validateProfile(createProfile(profileName.trim(), dataType, fieldMap, constants), dataType).valid
  const canSaveAndContinue = profileName.trim() !== '' && requiredMapped
  ```
  (`validateProfile` covers the always-required fields plus the avgCost/purchaseAmount and price/marketValue alternatives for positions, and all 6 required fields for transactions — matches the grid's required rows. `createProfile` here is a throwaway object used only for validation.)
- The plain step-2 "Continue" button (lines 1104-1116) is removed from this branch (its job is now the gated Save & Continue).

**Acceptance**:
- Name input always visible, blank by default, typed value survives mode toggles.
- "Save Profile & Continue" disabled until both a non-empty name and complete required mappings (alternative pairs count); enabled once both hold.
- No "Save as Profile"/"Save" buttons remain anywhere in Step 2.

---

### Task 4: `handleSaveProfileAndContinue` with collision overwrite

**File**: `src/components/import/ImportDialog.tsx`
**Depends on**: Task 2, Task 3

**Changes**:
- Replace `handleSaveProfile` (lines 389-407) with:
  ```ts
  const handleSaveProfileAndContinue = useCallback(() => {
    const name = profileName.trim()
    if (!name) return
    if (!validateProfile(createProfile(name, dataType, fieldMap, constants), dataType).valid) return

    const existing = state.mappingProfiles.find(
      (p) => p.kind === dataType && p.name.trim().toLowerCase() === name.toLowerCase()
    )
    if (existing) {
      if (!window.confirm(`A mapping profile named '${existing.name}' already exists. Overwrite it with this mapping?`)) {
        return  // stay on grid; name intact (decision #5 cancel)
      }
      const updated = updateProfile(existing, name, fieldMap, constants)
      dispatch({ type: 'UPDATE_MAPPING_PROFILE', profileId: existing.id, profile: updated })
      setSelectedProfileId(existing.id)
    } else {
      const created = createProfile(name, dataType, fieldMap, constants)
      dispatch({ type: 'ADD_MAPPING_PROFILE', profile: created })
      setSelectedProfileId(created.id)
    }

    setImportEdits({})
    setStep(3)
  }, [profileName, dataType, fieldMap, constants, state.mappingProfiles, dispatch])
  ```
- Wire the "Save Profile & Continue" button to this handler.
- **Resolved (was an open question): profile id tracking.** `pendingImport`/`pendingImport.profileId`
  are legacy (referenced only in `state.ts` + `App.test.tsx`; no live path in this
  dialog). The unified dialog tracks the profile as `selectedProfileId` — that is
  where the id goes in both branches. No `pendingImport` wiring is added.

**Acceptance**:
- No collision → `ADD_MAPPING_PROFILE` with a fresh profile; Step 3 reached.
- Collision + confirm(true) → `UPDATE_MAPPING_PROFILE` on the existing profile's
  id (its `id`/`createdAt` preserved, fresh `updatedAt`); Step 3 reached.
- Collision + confirm(false) → no dispatch, no step change, name field intact.
- Empty name or incomplete required mappings → handler is a no-op (button is disabled anyway).

---

### Task 5: Reset branch state on close; verify Back preservation

**File**: `src/components/import/ImportDialog.tsx`
**Depends on**: Task 1

**Changes**:
- In `handleCloseDialog` (lines 115-141) add `setProfileMode('use-existing')` and remove `setShowSaveProfile(false)` (line 135). Everything else resets as today.
- Verify (no code change needed) that `handleBack` (lines 263-265) needs no change: `profileMode`, `fieldMap`, `constants`, `profileName`, `selectedProfileId` all persist across a step decrement, satisfying decision #7 for both branches.

**Acceptance**:
- Close/Cancel resets branch to "use-existing" and clears all Step-2 state as today.
- Back from Step 3 returns to the same branch with work intact (create-new grid populated; use-existing profile still selected).

---

### Task 6: Update existing tests that break

**File**: `src/components/import/ImportDialog.test.tsx`
**Depends on**: Tasks 1-4 (test expectations must match the final UI)

**Breakage map** (grep targets: `Save as Profile`, `^Save$`, `Create new mapping`, profile dropdown, `Continue`):

1. **Test 5** (lines 224-265): asserts `getByDisplayValue(/-- Create new mapping --/)` and expects "Field Mapping" text. The sentinel option and the grid-in-use-existing-mode are gone. Fix: with profiles present, click "Use existing" (default) → assert the dropdown lists only the positions profile (and NOT the transactions one) → assert no "Field Mapping" grid is visible in this branch.
2. **Test 7** (lines 307-369): clicks "Save as Profile" then `^Save$`. Fix: type name into the always-visible input (`getByPlaceholderText(/e.g., Fidelity Positions/)`), map required fields via the grid, click "Save Profile & Continue", assert `ADD_MAPPING_PROFILE` and Step-3 text.
3. **Test 7b** (lines 374-442): exercises the old update-existing-inline flow. This path no longer exists; update-in-place is now the collision-overwrite flow. Fix: with an existing profile in state, enter create-new mode, map fields, enter the existing profile's name, mock `window.confirm` true, click "Save Profile & Continue", assert `UPDATE_MAPPING_PROFILE` with `profileId: existingProfile.id`. (Optional: add the confirm-false twin in Task 7.)
4. **Tests 10, 11, 12, 13, 14** (lines 539-899): all find the profile select via `getByDisplayValue(/-- Create new mapping --/)` then `selectOptions(profileSelect, profile.id)` then click plain `Continue`. Fix: with `createMockPositionsProfile()` present, click "Use existing" (default), select the profile from the dropdown, click the branch "Continue". The Step-3/4 assertions after that are unchanged.
5. **Tests 8, 9** (lines 447-533): click plain `Continue` on Step 2 with *no fields mapped* to reach Step 3 and observe validation errors. The plain Continue is gone and Save & Continue is gated on required mappings. Fix: either (a) switch these tests to the use-existing branch using `createMockPositionsProfile()`, or (b) map required fields in the grid first, then click "Save Profile & Continue". Prefer (a) — it also exercises the new branch.
6. **Tests 6, 15, 16** (lines 270-302, 904-962): Test 6 uses empty profiles (grid shows directly — should still pass; verify). Tests 15/16 use Back/Cancel (Back still present; Cancel still closes) — verify, expect no change.
7. Remove/replace any remaining `showSaveProfile`-dependent assertions.

**Acceptance**: all 16 tests updated or verified; suite green.

---

### Task 7: Add new tests for the new flows

**File**: `src/components/import/ImportDialog.test.tsx`
**Depends on**: Tasks 1-4

**New test cases** (mirror existing helper style — `createMockState`, `createMockPositionsProfile`, `vi.mocked(parseCsvFile).mockResolvedValue`, `vi.spyOn(window, 'confirm')`):

1. **Seg-control visibility**: (a) profiles exist for data type → both "Use existing" and "Create new" buttons render, default active "Use existing"; (b) no profiles → seg control absent and the mapping grid renders directly.
2. **Use-existing continue gating**: branch Continue disabled before selection, enabled after selecting a profile; click advances to Step 3 with the profile's mapping (assert a Step-3 mapped value, e.g. a cell showing a value only present after mapping).
3. **Create-new gating**: "Save Profile & Continue" disabled when name empty OR required fields unmapped; enabled only when both present (map required fields incl. one alternative pair for positions).
4. **Save-profile-and-continue dispatch**: fill name + required mappings, click → `ADD_MAPPING_PROFILE` dispatched (name/kind/fieldMap) and Step-3 text shown.
5. **Name-collision confirm(true)**: existing same-kind profile named "Default Positions"; enter that name in create-new with a different fieldMap, confirm mocked true → `UPDATE_MAPPING_PROFILE` with `profileId` = existing id, and Step 3 reached.
6. **Name-collision confirm(false)**: same setup, confirm mocked false → no ADD/UPDATE dispatch, still on Step 2, name input still holds the typed value.
7. **Mode-toggle preservation**: in create-new, map some fields + type a name; toggle to "Use existing" then back to "Create new" → grid selects and name input unchanged.
8. **Back-from-Step-3 preservation**: (a) create-new: save-and-continue → Step 3 → Back → create-new grid still populated with name intact; (b) use-existing: select profile → Continue → Step 3 → Back → use-existing branch active with the profile still selected.

**Acceptance**: all 8 new cases pass; no pre-existing suite regressions.

---

### Task 8: Update reference docs, full checks, commit

**Files**: `product-behavior.md`, `src/lib/design.md` (only if stale)
**Depends on**: Tasks 1-7 complete

**Changes**:
- `product-behavior.md` "Step 2 — Map columns" section (lines 60-67): rewrite to describe the seg control (shown only when profiles exist), the "Use existing" branch (dropdown + gated Continue, no grid), the "Create new" branch (always-visible name input + grid + gated "Save Profile & Continue"), the name-collision overwrite `window.confirm` behavior (UPDATE on existing profile, id/createdAt preserved), and that Back preserves the branch + work.
- `src/lib/design.md`: the "CSV Import Pipeline" section (lines 71-87) describes the old `ImportPanel`/`pendingImport`/`accountPromptQueue` flow and mentions profile selection generically in its step 3. Update only that profile-selection step (or add a one-line pointer) to note the new two-branch Step-2 selection; do NOT widen scope to fix the other pre-existing staleness in that section.
- `schema-spec.md`: untouched (no schema change). Verify `git diff schema-spec.md` is empty.

**Steps**:
1. Re-read `product-behavior.md` Step 2 section in full — internal consistency, terse, no stale "Save as Profile"/"Create new mapping" wording.
2. Run `npm run test` — fully green.
3. Run `npm run build` (typecheck) — no new TS errors.
4. Run `npm run lint`.
5. Commit only after 2-4 pass (per CLAUDE.md). Style matches repo history (e.g. `Implement Portfolio Dashboard v2 alignment with unified 4-step import dialog`); suggested message:
   `Add use-existing/create-new profile flow to import Step 2`

**Acceptance**:
- `npm run test`, `npm run build`, `npm run lint` all pass.
- `product-behavior.md` Step 2 section accurate; `schema-spec.md` has zero diff.
- Single commit covering the UI change, test updates/additions, and docs.

## Test cases (consolidated)

**`ImportDialog.test.tsx` — updated existing**:
- Test 5: use-existing branch dropdown filters by kind; no grid in branch.
- Test 7: always-visible name input + "Save Profile & Continue" → `ADD_MAPPING_PROFILE` + Step 3.
- Test 7b: collision-overwrite flow → `UPDATE_MAPPING_PROFILE` on existing id.
- Tests 10/11/12/13/14: use-existing branch select + Continue.
- Tests 8/9: reach Step 3 via use-existing branch (or mapped grid).
- Tests 6/15/16: verify unchanged behavior.

**`ImportDialog.test.tsx` — new**:
1. Seg-control visibility (profiles exist vs none).
2. Use-existing continue gating (disabled → enabled → Step 3).
3. Create-new gating (name + required mappings both required).
4. Save-profile-and-continue dispatches `ADD_MAPPING_PROFILE` + advances.
5. Name collision, confirm true → `UPDATE_MAPPING_PROFILE`, Step 3.
6. Name collision, confirm false → no dispatch, name intact.
7. Mode toggle preserves create-new work.
8. Back from Step 3 preserves branch (both create-new and use-existing).

## Acceptance criteria

- [ ] Step 2 shows the seg control ("Use existing" default / "Create new") only when profiles exist for the chosen data type; otherwise renders the create-new grid directly.
- [ ] "Use existing" branch shows only kind-scoped profiles, no mapping grid; Continue disabled until selection; selecting loads the profile's `fieldMap`/`constants` and Continue advances to Step 3 without a missing-column warning.
- [ ] "Create new" branch shows an always-visible blank name input (placeholder "e.g., Fidelity Positions") and the existing mapping grid; "Save Profile & Continue" is disabled until a non-empty name AND all required fields mapped (`validateProfile` incl. alternative pairs).
- [ ] "Save Profile & Continue" dispatches `ADD_MAPPING_PROFILE` (new) or — on a same-kind, trim+case-insensitive name match with `window.confirm` accepted — `UPDATE_MAPPING_PROFILE` on the existing profile (id/createdAt preserved, fresh updatedAt), sets `selectedProfileId`, and advances to Step 3. Confirm-cancel stays on the grid with the name intact.
- [ ] Toggling between branches preserves `fieldMap`, `constants`, and `profileName`.
- [ ] Back from Step 3 returns to the same branch with work intact (create-new grid populated / use-existing profile still selected).
- [ ] `showSaveProfile` state, "Save as Profile" button, and the plain Step-2 Continue are removed; `handleCloseDialog` resets `profileMode`.
- [ ] No lib changes (`mappingProfiles.ts` untouched), no reducer/schema changes; `MappingProfile` type and `schema-spec.md` unchanged.
- [ ] `ImportDialog.test.tsx` fully updated (all 16 existing) plus 8 new cases, `npm run test` green.
- [ ] `product-behavior.md` Step 2 section rewritten accurately; `src/lib/design.md` profile-selection line updated only if stale.
- [ ] `npm run test`, `npm run build`, `npm run lint` all pass before the single commit.
