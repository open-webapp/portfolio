# Unify Import Dialogs

## Overview

`src/components/import/ImportPositionsDialog.tsx` and `ImportTransactionsDialog.tsx` are near-byte-identical (both ~349 lines). Diffing them shows the *only* differences are: the literal string `'positions'` vs `'transactions'` (used to filter `listProfilesForKind`, passed to `MappingProfileEditor`'s `kind` prop, and set as `pendingImport.kind`), and a handful of copy strings ("Import Positions" vs "Import Transactions" button/heading text, "position data" vs "transaction data" file-picker description).

**Correction vs. initial framing:** both dialogs already dispatch the *same* `SET_PENDING_IMPORT` action shape (`{ kind, rows, profileId }`) — there is no separate "final import action" branching inside the dialog components themselves. The kind-specific dispatch to `importPositions()` vs `importTransactions()` happens later, in `App.tsx`'s `pendingImport`-processing `useEffect` (reads `state.pendingImport.kind`), which is untouched by this refactor. So the unified `ImportDialog` needs only a single `kind: 'positions' | 'transactions'` prop — no `onImport` callback is required.

Both dialogs render an identical 4-step state machine (`closed → file-picker → profile-select → profile-editor? → review → closed`) and an identical profile-select list of profile buttons + "Create New Profile", already delegating the actually-kind-branching bits (required fields, validation) to the shared `MappingProfileEditor` (parameterized by `kind`) and shared `src/lib/mappingProfiles.ts` helpers.

**Ordering dependency:** this plan is queued *after* `plans/mapping-profile-uniqueness.md` (in flight as of this writing — adds a trash-icon delete button and a name-conflict dialog to the profile-select step inside both existing dialog files). Do not start Task 1 until that plan has landed and merged. This plan's Task 1 explicitly re-reads the post-merge dialog files to capture the exact delete/conflict markup and state before extracting the shared `ImportDialog`. The goal is to consolidate that logic into one shared profile-select block (write once, not twice) — not to remove or regress it.

**Existing tests:** as of writing, there is no `ImportPositionsDialog.test.tsx` or `ImportTransactionsDialog.test.tsx` in the repo. If `mapping-profile-uniqueness` adds test files for the delete/conflict behavior to either dialog, Task 6 below must consolidate/rewrite those into a single `ImportDialog.test.tsx` covering both `kind` values — no stale per-dialog test files should remain after this plan.

## Tasks

1. **Re-read post-merge dialog files** — Confirm `plans/mapping-profile-uniqueness.md` has landed. Read the current `src/components/import/ImportPositionsDialog.tsx` and `ImportTransactionsDialog.tsx` in full to capture the exact trash-icon delete button + name-conflict-dialog markup/state/handlers added by that plan (expected in the `profile-select` step region). Note whether it added new dispatch action types (e.g. `DELETE_MAPPING_PROFILE`) or local state (e.g. conflict-dialog open/close, pending-rename). No code changes in this task.
   - Depends on: none (blocked on external plan landing).

2. **Create `src/components/import/ImportDialog.tsx`** — New file. Copy the structure of one post-merge dialog file as the base. Props: `{ kind: 'positions' | 'transactions'; state: AppState; dispatch: (action: any) => void }`. Derive from `kind`:
   - `listProfilesForKind(state.mappingProfiles, kind)` (single call site, was duplicated).
   - Button/heading copy via a small lookup (e.g. `kind === 'positions' ? 'Import Positions' : 'Import Transactions'`, `'position data'` / `'transaction data'`).
   - `MappingProfileEditor kind={kind}`.
   - `pendingImport: { kind, rows: mapped, profileId }` in the `SET_PENDING_IMPORT` dispatch.
   All other logic (file parsing, step transitions, profile-select list rendering including the delete/conflict behavior from Task 1, profile-editor step, review step, apply-mapping/close) is kind-agnostic and copied over unchanged, once.
   - Depends on: 1.

3. **Update `src/components/import/index.ts`** — Remove the `ImportPositionsDialog`/`ImportTransactionsDialog` exports (and their prop-type exports). Add `export { ImportDialog } from './ImportDialog'` and `export type { ImportDialogProps } from './ImportDialog'`.
   - Depends on: 2.

4. **Update `src/App.tsx` call sites** — Remove the two old imports (`import { ImportPositionsDialog } from './components/import/ImportPositionsDialog'` and the transactions equivalent), add `import { ImportDialog } from './components/import/ImportDialog'`. Replace the positions-tab render (`<ImportPositionsDialog state={state} dispatch={dispatch} />`) with `<ImportDialog kind="positions" state={state} dispatch={dispatch} />`, and the transactions-tab render similarly with `kind="transactions"`.
   - Depends on: 3.

5. **Delete old dialog files** — Remove `src/components/import/ImportPositionsDialog.tsx` and `ImportTransactionsDialog.tsx` (and any per-dialog test files left by `mapping-profile-uniqueness`, once their coverage is confirmed ported in Task 6).
   - Depends on: 4, 6 (delete test files only after replacement tests exist and pass).

6. **Write `src/components/import/ImportDialog.test.tsx`** — New consolidated test file (or rewrite of any per-dialog test file added by `mapping-profile-uniqueness`) covering both `kind` values per the Test cases section below. Use `@testing-library/react` per repo convention (see `MappingProfileEditor.test.tsx`).
   - Depends on: 2, 3.

7. **Update reference docs** — Per CLAUDE.md's reference-doc rule:
   - `product-behavior.md` — "CSV import (Positions / Transactions)" section: update any remaining references that imply two separate components to instead describe the single `ImportDialog` parameterized by `kind`.
   - `design.md` — "Directory structure" (`import/` listing: replace `ImportPositionsDialog.tsx`/`ImportTransactionsDialog.tsx` with `ImportDialog.tsx`), "Component tree" (replace the two `ImportPositionsDialog`/`ImportTransactionsDialog` entries with a single `ImportDialog (kind, state, dispatch)` entry per tab), and "Data flow" CSV-import section (replace "`ImportPositionsDialog`/`ImportTransactionsDialog` local state machine" wording with "`ImportDialog` (kind-parameterized) local state machine").
   - Re-read both docs in full after editing (CLAUDE.md's "full-file review after major changes" rule) to confirm no other section still names the two old components and no narrative drift was introduced.
   - Depends on: 5.

8. **Run tests, lint, build; commit** — `npm run test` (all green), `npm run lint`, `npm run build`. Run `grep -ri watchlist src/` and confirm empty. Confirm no remaining references to `ImportPositionsDialog`/`ImportTransactionsDialog` anywhere in `src/` (`grep -rn "ImportPositionsDialog\|ImportTransactionsDialog" src/` empty). Commit once all pass and docs are updated (per CLAUDE.md: never commit partial or doc-stale work).
   - Depends on: 6, 7.

## Test cases

- `kind="positions"`, closed state: renders an "Import Positions" button.
- `kind="transactions"`, closed state: renders an "Import Transactions" button.
- File-picker step: selecting a CSV file parses it (`parseCsvFile`) and advances to `profile-select`, for both kinds.
- Profile-select step, `kind="positions"`: lists only profiles returned by `listProfilesForKind(state.mappingProfiles, 'positions')` (transactions-kind profiles in state must not appear).
- Profile-select step, `kind="transactions"`: lists only transactions-kind profiles (positions-kind profiles in state must not appear).
- "Create New Profile" → `profile-editor` step renders `MappingProfileEditor` with `kind` matching the dialog's `kind` prop (assert via required-field labels, e.g. positions shows `assetClass`, transactions does not).
- Delete (trash-icon) on a profile row in profile-select removes it from the list for both `kind` values (behavior ported from `mapping-profile-uniqueness`).
- Saving a profile whose name collides with an existing profile (same `kind`) opens the name-conflict dialog, identically for both `kind` values (behavior ported from `mapping-profile-uniqueness`).
- Review step: displays the selected profile's name, row count, and CSV-header → field list.
- Review step, `kind="positions"`: clicking "Import" dispatches `SET_PENDING_IMPORT` with `pendingImport.kind === 'positions'`.
- Review step, `kind="transactions"`: clicking "Import" dispatches `SET_PENDING_IMPORT` with `pendingImport.kind === 'transactions'`.
- "Back" from review returns to `profile-select` without losing the previously parsed CSV rows/headers.
- "Cancel" from any step closes the dialog and resets all internal state (`csvHeaders`, `csvRows`, `selectedProfile`, `editingProfile`) for both kinds.

## Acceptance criteria

- `src/components/import/ImportPositionsDialog.tsx` and `ImportTransactionsDialog.tsx` no longer exist; `src/components/import/ImportDialog.tsx` is the sole dialog component, rendered from `App.tsx` twice with `kind="positions"` / `kind="transactions"`.
- `src/components/import/index.ts` exports `ImportDialog`/`ImportDialogProps` only — no leftover exports referencing the deleted components.
- `grep -rn "ImportPositionsDialog\|ImportTransactionsDialog" src/` returns nothing.
- The trash-icon delete button and name-conflict dialog (from `mapping-profile-uniqueness`) work identically for both `kind` values inside the single shared profile-select block — not removed, not regressed, not duplicated.
- No stale per-dialog test files remain; all prior + new coverage lives in `ImportDialog.test.tsx`.
- `npm run test` passes in full, including all cases listed above.
- `npm run build` (tsc -b + vite build) succeeds with no type errors.
- `grep -ri watchlist src/` returns nothing (unaffected, but re-verified per CLAUDE.md out-of-scope rule).
- `product-behavior.md`'s "CSV import" section and `design.md`'s directory-structure/component-tree/data-flow sections describe the single `ImportDialog(kind)` component, with no remaining mention of the two old component names.
- Commit created only after all tests pass and reference docs are updated (per CLAUDE.md commit rule) — no partial/doc-stale commit.
