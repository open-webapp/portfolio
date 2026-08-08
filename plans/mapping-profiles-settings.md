# Mapping Profiles Settings Section

Caveman plan. Small tasks, one thing each, with deps and tests. Read top to bottom before starting task 1.

## Facts checked before writing this plan

- `src/components/Settings.tsx` exists and is already rendered in `src/App.tsx` (full-page Settings view, switched via `state.view`).
- `MappingProfileEditor` component exists at `src/components/import/MappingProfileEditor.tsx` and is fully reusable — takes `kind`, `csvHeaders`, `existingProfile?`, `onSave`, `onCancel` props; no rework needed.
- `src/lib/mappingProfiles.ts` exports `deleteProfile`, `listProfilesForKind`, `updateProfile` — all the CRUD helpers needed.
- Settings page currently has 3 sections: Drive Backup, Import Sessions, Accounts (Mapping Profiles will be section 4).
- `MappingProfile` type already has `id`, `name`, `kind`, `createdAt`, `updatedAt` fields in `schema-spec.md`.
- No existing "Saved Mappings" section in Settings yet — this adds it fresh.

## Open questions

None — requirements fully specified. Clear scope: list profiles, edit (modal), delete (confirm), no create button.

## Decisions locked (from requirements)

- Display order: `updatedAt` descending (most recent first).
- Edit opens `MappingProfileEditor` in a modal, reusing existing component, not duplicating.
- Delete uses `window.confirm()` (match style in Accounts delete).
- No create-new-profile button in Settings.
- No prevent-delete logic based on usage.
- Columns: Name, Kind (Positions/Transactions), Updated date (formatted like other app dates).
- Actions: Edit (pencil icon), Delete (trash icon) — per row.

## Tasks

### Task 1 — `src/components/Settings.tsx`: Saved Mappings section + modal state

Depends on: none.

1. Add local state:
   - `const [mappingProfilesModalOpen, setMappingProfilesModalOpen] = useState(false)`
   - `const [editingProfile, setEditingProfile] = useState<MappingProfile | undefined>(undefined)`
2. Create a new `<section>` for "Saved Mappings" after Accounts section (or 4th section if reordering).
3. Empty state: render "No saved profiles yet." when `state.mappingProfiles.length === 0`.
4. When profiles exist: render a table (`<table className="table">`) with columns: Name, Kind, Updated, Edit, Delete (no sorting — display `listProfilesForKind(state.mappingProfiles).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())` to ensure newest-first).
5. Each row: show `profile.name`, `profile.kind` (formatted "Positions" or "Transactions"), `profile.updatedAt` (formatted as ISO string like Closed Positions' `closedDate`), pencil icon button (sets `editingProfile` + opens modal), trash icon button (delete handler with confirm, see below).
6. Delete handler inline:
   ```ts
   const handleDeleteProfile = (profileId: string) => {
     if (!window.confirm('Delete this saved profile? It will no longer be available for import.')) return
     // Task 2 will add action dispatch here
   }
   ```
7. Render the modal conditionally (when `mappingProfilesModalOpen` && `editingProfile`):
   ```tsx
   {mappingProfilesModalOpen && editingProfile && (
     <div className="dialog-backdrop" onClick={() => { /* close */ }}>
       <MappingProfileEditor
         kind={editingProfile.kind}
         csvHeaders={Object.keys(editingProfile.fieldMap)}
         existingProfile={editingProfile}
         onSave={/* Task 2 */}
         onCancel={() => { setMappingProfilesModalOpen(false); setEditingProfile(undefined) }}
       />
     </div>
   )}
   ```

- Test cases: verify section renders with empty state, then with profiles; pencil/trash buttons present; modal opens/closes.
- Acceptance: Settings.tsx compiles. Empty state message visible when no profiles. Table renders with correct columns when profiles present.

### Task 2 — `src/components/Settings.tsx`: wire up Edit and Delete actions

Depends on: Task 1 (UI structure exists).

1. **Edit handler** — finish the `onSave` callback in the modal:
   ```ts
   const handleSaveProfile = (updatedProfile: MappingProfile) => {
     dispatch({ type: 'UPDATE_MAPPING_PROFILE', profile: updatedProfile })
     setMappingProfilesModalOpen(false)
     setEditingProfile(undefined)
   }
   ```
2. **Edit button click** — fill in the pencil button handler:
   ```ts
   onClick={() => { setEditingProfile(profile); setMappingProfilesModalOpen(true) }}
   ```
3. **Delete handler** — fill in the `handleDeleteProfile` from Task 1:
   ```ts
   const handleDeleteProfile = (profileId: string) => {
     if (!window.confirm('Delete this saved profile? It will no longer be available for import.')) return
     dispatch({ type: 'DELETE_MAPPING_PROFILE', profileId })
   }
   ```

- Test cases (add to `Settings.test.tsx`):
  - Profiles list renders one row per profile, ordered by `updatedAt` descending (newest first).
  - Clicking pencil icon opens modal with `MappingProfileEditor` showing the selected profile.
  - Modal's cancel button closes without dispatching anything.
  - Modal's save button dispatches `UPDATE_MAPPING_PROFILE` with the edited profile and closes modal.
  - Clicking trash icon shows `window.confirm()` prompt. If user clicks "Cancel" → no dispatch. If user clicks "OK" → dispatches `DELETE_MAPPING_PROFILE` with the profile id.
  - Empty state message displays when `state.mappingProfiles` is empty.
- Acceptance: `npx vitest run src/components/Settings.test.tsx` includes new cases and all pass. Manual check: edit a profile name in the modal and verify it updates; delete prompts before removing.

### Task 3 — Test coverage + full build gate

Depends on: Task 2.

1. `npm run test` — all green.
2. `npm run lint` — no errors.
3. `npm run build` — tsc + vite, no type errors.
4. Verify Settings component renders correctly in the app: in dev mode, navigate to Settings, confirm Saved Mappings section visible with profiles list (if any exist).

- Test cases: none new — covered by Task 2.
- Acceptance: all three commands clean. Settings page manually verified in browser.

### Task 4 — Reference doc updates + full-file review

Depends on: Task 3.

1. **`product-behavior.md`** — "Settings page" section:
   - Add subsection/detail for **Saved Mappings**: "A list of all saved mapping profiles (created during CSV import wizard), ordered by most recently updated first. Each row shows: Name, Kind (Positions/Transactions), Updated date (ISO string). Each row has an Edit button (pencil icon, opens `MappingProfileEditor` modal to update name/mapping) and a Delete button (trash icon, prompts with `window.confirm()` before removing). Empty state: 'No saved profiles yet.' when no profiles exist. No create-new-profile button in Settings (profiles are created only during the import wizard)."
2. **`design.md`** — "Component tree" section:
   - Update the `SettingsPage` note to include: "4 sections: Drive backup / Import Sessions / Accounts / Saved Mappings (with modal `MappingProfileEditor` on edit)."
3. **Full-file review**:
   - Re-read both docs top-to-bottom: no section describes non-existent create buttons, no contradictions on how/where profiles are managed.

- Acceptance: both docs updated and internally consistent. No narrative drift.

### Task 5 — Commit

Depends on: Task 4.

One commit: "Add Saved Mappings section to Settings page with edit/delete actions". Message describes: profiles listed newest-first, reuses `MappingProfileEditor` modal for edits, delete prompts before removing, profiles created only in import wizard (not in Settings).

## Test cases (rollup)

- Settings component (new `Settings.test.tsx` cases, extend existing file):
  - Empty `mappingProfiles` → empty-state text, no table.
  - Non-empty `mappingProfiles` → table with one row per profile, sorted by `updatedAt` descending (newest first).
  - Each row shows correct name, kind (formatted as "Positions"/"Transactions"), updated date (ISO string).
  - Pencil icon click: opens modal with `MappingProfileEditor` showing the selected profile.
  - Modal cancel button: closes without dispatch.
  - Modal save button: dispatches `UPDATE_MAPPING_PROFILE` with the edited profile, closes modal.
  - Trash icon click with `window.confirm` → false: no dispatch.
  - Trash icon click with `window.confirm` → true: dispatches `DELETE_MAPPING_PROFILE` with correct profileId.

## Acceptance criteria (whole plan)

- "Saved Mappings" section renders in Settings page as 4th section.
- Profiles list displays all `state.mappingProfiles` ordered by `updatedAt` descending (newest first).
- Empty state message shown when no profiles exist.
- Each profile row shows: Name, Kind (formatted), Updated date (ISO string).
- Pencil icon button opens `MappingProfileEditor` modal for the selected profile.
- Modal reuses existing `MappingProfileEditor` component (no duplication).
- Trash icon button prompts with `window.confirm()` then dispatches `DELETE_MAPPING_PROFILE`.
- No create-new-profile button in Settings.
- `npm run test`, `npm run lint`, `npm run build` all green.
- `product-behavior.md` and `design.md` updated and internally consistent (Task 4 full-file review done).
- Commit created only after build gate passes (CLAUDE.md rule).
