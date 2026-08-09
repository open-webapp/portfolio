# Import: manual entry mode for positions (no CSV file)

## Overview

Right now the import dialog only accepts a CSV file. User wants an alternate
path for Positions imports: skip the file entirely and hand-type rows into
the same Step 2 review grid. Step 1 gets a new "Upload CSV file" / "Enter
manually" toggle (positions only); picking manual skips the dropzone and the
account-resolved check alone unlocks Continue. Step 2 in manual mode seeds
exactly 10 blank rows, hides the per-field CSV-column mapping `<select>`
(nothing to map from), and otherwise reuses the existing edit/validate/import
machinery untouched. No mapping gets saved for manual sessions. Also: the
dialog's trigger button and title get relabeled from "Import CSV"/"Import
from CSV" to just "Import", independent of this feature but bundled into the
same pass since both touch the same lines.

Files in play:
- `src/components/import/ImportDialog.tsx` — dialog component, all state and
  Step 1/Step 2 JSX.
- `src/lib/importPreview.ts` — `isReviewValid` (see design decision below),
  `applyFieldMap`/`validatePreviewRow`/`isBlankRow` (unaffected, reused as-is).
- `src/components/import/ImportDialog.test.tsx` — new manual-mode tests, plus
  fixes for existing tests asserting the old "Import CSV" label/aria-label.
- `src/components/import/product-behavior.md`, `src/components/import/design.md`
  — do not exist yet; must be created per CLAUDE.md's reference-docs rule
  (this module currently has none).

Do NOT touch: Transactions import flow (file-upload only, toggle never
renders), upload-mode behavior, mapping-profile prefill logic, the
asset-class-header-required gate, `AssetClassOverrideSelect.tsx`. This is
additive UI + one new mode branch.

**Design decision on `isReviewValid` in manual mode**: `isReviewValid`
checks `fieldMap` for symbol/shares/avgCost-or-purchaseAmount/price-or-
marketValue *column mappings*. In manual mode `fieldMap` stays `{}` forever
(there are no CSV columns to map), so `isReviewValid('positions', {})`
returns `false` unconditionally — that would permanently disable the Import
button regardless of what the user types into cells. Do NOT try to make
`isReviewValid` synthesize a fake fieldMap from typed cell values; keep it a
pure fieldMap-shape validator (its existing contract, matching the precedent
set by the assetClass-header plan). Instead, in the component's Import-button
`disabled` expression, skip the `isReviewValid(...)` call entirely when
`entryMode === 'manual'` — per-row validity is already fully covered by
`validatePreviewRow`/`hasImportErrors` and `previewRows.length === 0`, which
run against `importEdits`-merged values regardless of where those values came
from. This mirrors how `validatePreviewRow` already doesn't care about
`fieldMap` at all — only `isReviewValid` does, and it's the one being bypassed.

## Tasks

Do in order. Each ≤30 min.

### 1. `ImportDialog.tsx`: add `entryMode` state + reset [depends on: nothing]
- Add `const [entryMode, setEntryMode] = useState<'upload' | 'manual'>('upload')`
  near the other Step 1 state (~line 81, after `file`/`fileName` or alongside
  `dataType`/`accountMode`).
- Add `setEntryMode('upload')` to `handleCloseDialog`'s reset block (~line
  99-123), matching the existing plain-`setX` reset style.
- Add a `setEntryMode('upload')` call inside the `dataType` radio's
  `onChange` when switching to `'transactions'` (~line 516), so leaving
  positions always drops back to upload mode — transactions must never see
  `entryMode === 'manual'` internally even transiently.

### 2. `ImportDialog.tsx`: Step 1 toggle UI [depends on: 1]
- Add a new `<div className="field">` block directly above the "CSV file"
  dropzone field (before line ~655), rendered only when
  `dataType === 'positions'`. Copy the seg-control markup/style used for
  "Destination account" (~line 532-554): label "How would you like to add
  positions?", two `seg-opt` radios named e.g. `importEntryMode`, options
  "Upload CSV file" (`entryMode === 'upload'`) / "Enter manually"
  (`entryMode === 'manual'`), `onChange` calls `setEntryMode(...)`.
- Wrap the existing "CSV file" field block (~line 655-703) in
  `{entryMode === 'upload' && (...)}` — when manual mode is active, don't
  render the dropzone, hidden `<input type="file">`, or file-error text at
  all (not just visually hidden).

### 3. `ImportDialog.tsx`: `isStep1Complete` drops file requirement in manual mode [depends on: 1]
- Update `isStep1Complete()` (~line 196-206): change
  `const fileSelected = file !== null && csvRows.length > 0` to
  `const fileSelected = entryMode === 'manual' || (file !== null && csvRows.length > 0)`.
  Return `accountResolved && fileSelected` as before.

### 4. `ImportDialog.tsx`: seed 10 blank rows on Continue in manual mode [depends on: 1, 3]
- In `handleContinue` (~line 208-230), after the `isStep1Complete()` guard
  and before/alongside the existing fieldMap-prefill logic, branch on
  `entryMode`:
  - `'manual'`: `setCsvRows(Array.from({ length: 10 }, () => ({})))`, leave
    `csvHeaders` as `[]` (already its default — no file was ever parsed).
    Skip the saved-mapping prefill entirely (there's nothing to prefill
    against, and Task 6 means manual sessions never write a saved mapping
    either — no `UPSERT_CSV_MAPPING` round-trip to prefill from in the first
    place, but even a stale saved mapping from a prior *upload* import to
    this same account should NOT be applied here since `fieldMap` must stay
    `{}` for manual mode's `applyFieldMap` to yield blank cells).
  - `'upload'`: existing behavior unchanged.
  - Add `entryMode` to the `useCallback` dependency array.

### 5. `ImportDialog.tsx`: hide column-mapping `<select>` in Step 2 for manual mode [depends on: 1]
- In the `<th>` render (~line 794-827), the existing branch is
  `field === 'assetClass' && dataType === 'positions' ? <input .../> : <select ...>`.
  Add a manual-mode branch: when `entryMode === 'manual'` (implies
  `dataType === 'positions'` per scope) and `field !== 'assetClass'`, render
  nothing in place of the `<select>` (e.g. `null`, or an empty `<div>` if a
  layout placeholder is needed to keep header height consistent with rows
  that do show the assetClass input — check visually/in test whether an
  empty node is needed for consistent `<th>` height, otherwise just `null`).
  Final ternary shape: assetClass+positions → text input; manual mode
  (non-assetClass field) → nothing; otherwise → existing `<select>`.
- Leave the asset-class free-text header input completely untouched — it
  already works off `importEdits`/`touchedAssetClassRows`, not `fieldMap` or
  `csvHeaders`, so it broadcasts into manually-entered rows exactly the same
  way it does for uploaded ones.
- Verify: `mappedColumnFor(field)` is simply unused/irrelevant when the
  `<select>` isn't rendered — no crash risk, it's a pure lookup function.

### 6. `ImportDialog.tsx`: skip `UPSERT_CSV_MAPPING` in manual mode [depends on: 1]
- In `handleImport` (~line 296-364), wrap the existing
  `dispatch({ type: 'UPSERT_CSV_MAPPING', ... })` call (~line 350) in
  `if (entryMode === 'upload') { ... }`. Add `entryMode` to the `useCallback`
  dependency array.

### 7. `ImportDialog.tsx`: bypass `isReviewValid` in manual mode for the Import-button disabled check, and disable Import when all rows are blank [depends on: 1]
- Per the design decision above: update the Import button's `disabled`
  expression (~line 951-958). Change
  `!isReviewValid(dataType, fieldMap) || hasImportErrors || previewRows.length === 0 || (dataType === 'positions' && !assetClassHeaderValue.trim())`
  to skip the `isReviewValid` clause when `entryMode === 'manual'`, e.g.:
  `(entryMode === 'upload' && !isReviewValid(dataType, fieldMap)) || hasImportErrors || previewRows.length === 0 || (dataType === 'positions' && !assetClassHeaderValue.trim())`.
- Do not change `isReviewValid`'s signature or body — it stays a pure
  fieldMap-shape validator, used only for upload-mode.
- Double-check `hasImportErrors`/`rowValidations` (~line 409-417) already run
  `validatePreviewRow(dataType, { ...previewRow, ...importEdits[idx] })` per
  row — this is what actually enforces symbol/assetClass/shares/cost/price
  per manually-typed row, so the bypass above doesn't weaken validation, it
  only removes a fieldMap-shaped check that's meaningless when there's no
  fieldMap.
- **Decided**: Import must stay disabled while all 10 manual rows are blank
  (a 0-row import is not allowed — same spirit as the existing
  `previewRows.length === 0` guard for upload mode, which doesn't fire here
  because `previewRows` always has 10 entries in manual mode, just
  all-blank). Add an explicit clause: compute
  `const hasNoValidManualRows = entryMode === 'manual' && rowValidations.every((v, idx) => isBlankRow({ ...previewRows[idx], ...importEdits[idx] }))`
  (or equivalent — count rows that are both valid and non-blank, disable if
  zero) and OR it into the `disabled` expression. Implementation detail
  (exact variable naming/placement) is up to the implementer, but the
  observable behavior is fixed: Import is disabled until at least one row
  is filled in with valid, non-blank data.

### 8. `applyFieldMap`/empty-row sanity check [depends on: nothing, can run parallel with 1-7]
- Confirm (read `src/lib/importPreview.ts` — already reviewed: `applyFieldMap`
  iterates `Object.entries(fieldMap)`, so with `fieldMap === {}` it returns
  `{}` regardless of `row` contents — safe for the 10 blank `{}` row objects).
  No code change needed here, just a verification step; note the confirmation
  in the commit/PR description if useful.
- Confirm no other Step 2 code path assumes `csvHeaders.length > 0` (grep
  `csvHeaders` usages in `ImportDialog.tsx` — expected hits: the dropzone's
  row-count display (now hidden in manual mode via Task 2), the `<select>`
  options map (now skipped in manual mode via Task 5), and the fieldMap
  prefill filter in `handleContinue` (now skipped in manual mode via Task 4)
  — verify no stray fourth usage exists that would break on an empty array).

### 9. Text relabeling [depends on: nothing, can run parallel with 1-8]
- Line ~377: `aria-label="Import CSV"` → `aria-label="Import"`.
- Line ~397: visible text `Import CSV` → `Import`.
- Line ~460: `<div className="dialog-title">Import from CSV</div>` →
  `<div className="dialog-title">Import</div>`.

### 10. Tests [depends on: 1-9]
- Fix existing tests keyed on old text (grep confirmed these need updates):
  - Test file line 43 (`beforeEach`/helper `openDialog()` or similar) — uses
    `screen.getByRole('button', { name: 'Import CSV' })`.
  - Test `'1. closed state renders a single "Import CSV" trigger...'`
    (line 159-171) — rename test description, update
    `getAllByRole('button', { name: 'Import CSV' })` → `'Import'`.
  - Line 179 — `screen.getByText('Import from CSV')` → `screen.getByText('Import')`.
    Careful: `'Import'` may now ambiguously match the Import button on Step 2
    too if both are mounted in the same query scope at test time — check
    each call site's DOM state before blindly renaming, use a more specific
    query (e.g. scope to `.dialog-title` or use `getByRole('heading')` if the
    title element supports it) if collisions occur.
  - Line 560, 723 — same `getByRole('button', { name: 'Import CSV' })` →
    `'Import'` renames (these are helper-open-dialog call sites, not the
    Step-2 Import button, so no collision expected, but verify).
- Add new tests (colocate near the Step 1/Step 2 tests, after test 30):
  - Manual-entry toggle only renders when `dataType === 'positions'`; not
    present for `'transactions'`.
  - Selecting "Enter manually" hides the CSV-file dropzone entirely (assert
    absence, not just a hidden style) and Continue becomes enabled with just
    an account chosen (existing account selected, or new-account
    name+number filled) and no file.
  - Switching `dataType` to `'transactions'` while `entryMode === 'manual'`
    was active resets to upload mode (toggle gone, and if switched back to
    positions, defaults back to "Upload CSV file" selected — confirm via
    Task 1's reset-on-dataType-change wiring).
  - Continuing from Step 1 in manual mode renders Step 2 with exactly 10
    editable rows, all initially blank, and no per-field mapping `<select>`
    elements anywhere in the table (assert `container.querySelectorAll('select')`
    count matches expectations — likely zero, since assetClass is an input
    and all other fields skip the select in manual mode).
  - Typing into a cell (e.g. symbol) and the asset-class header, for enough
    rows to have at least one fully-valid row, then clicking Import:
    dispatches `IMPORT_POSITIONS` with `mappedRows` containing only the
    valid, non-blank rows (correct field values from `importEdits`), and
    does NOT dispatch `UPSERT_CSV_MAPPING` at all (assert on the full
    dispatched-action-types list, not just presence/absence, matching the
    style of existing tests like '14'/'14b'/'15').
  - Import button stays disabled while all 10 rows are blank. Decided:
    `previewRows.length === 0` doesn't fire in manual mode (rows always
    exist), so a dedicated "no valid non-blank rows" clause is required (see
    Task 7) — assert the button is disabled with all 10 rows untouched, and
    becomes enabled as soon as one row is filled in validly (with
    asset-class header also filled).
  - Deleting rows down from 10 still works via the existing trash icon in
    manual mode (re-key behavior unaffected, reuses `handleDeleteRow`
    unchanged).
  - Button/dialog text: closed-state button reads "Import" (not "Import
    CSV"), `aria-label="Import"`, dialog title reads "Import" (not "Import
    from CSV").
- Run `npx vitest run src/components/import/ImportDialog.test.tsx` after
  writing to confirm both fixed and new tests pass.

### 11. Reference docs: create `product-behavior.md` and `design.md` [depends on: 1-10 done, code stable]
- Module currently has neither file (confirmed: no existing
  `src/components/import/product-behavior.md` or `design.md`). Per
  CLAUDE.md's reference-docs rule, create both now, documenting current
  behavior including manual entry — not a delta/changelog, current-state
  only.
- `product-behavior.md`: user-visible behavior — Step 1 fields (data type,
  destination account, entry-mode toggle for positions, CSV dropzone for
  upload mode), Step 1 completion gating, Step 2 review grid (column-mapping
  selects for upload mode, none for manual mode, asset-class free-text
  header + broadcast/sticky-row behavior, per-row validation/error display,
  row delete), Import button disabled logic (including the upload-vs-manual
  `isReviewValid` bypass), completion state, Back/Close behavior and what
  resets.
- `design.md`: directory structure (`src/components/import/`), component
  tree (single `ImportDialog.tsx`, no sub-components currently), state
  shape (all `useState` hooks including `entryMode`), data flow
  (Step 1 → `csvRows`/`csvHeaders` populated either by `parseCsvFile` or by
  the 10-blank-row seed → `applyFieldMap` → `importEdits` overlay →
  `validatePreviewRow`/`isBlankRow` → dispatch), dependency on
  `src/lib/importPreview.ts`, `src/lib/csv.ts`, `src/lib/mappingProfiles.ts`
  equivalents (note `UPSERT_CSV_MAPPING` only fires for upload mode).
- Full read-through of both new files after writing (CLAUDE.md's "full-file
  review after major changes" rule) — check no section is stale/contradicts
  another, terse and structured per the file's stated purpose.

### 12. Full test run + commit [depends on: 11]
- `npm run test` — must be fully green.
- `npm run build` (typecheck) — must pass.
- `npm run lint` — should pass (no new lint debt).
- Commit only after all pass and both reference docs exist and are current
  (CLAUDE.md rule — no partial/doc-stale commits).

## Test Cases

1. Manual-entry toggle renders only for `dataType === 'positions'`; absent
   for `'transactions'`.
2. Default `entryMode` is `'upload'`.
3. Selecting "Enter manually" hides the CSV-file dropzone field completely.
4. In manual mode, Continue is enabled once an account is resolved
   (existing selected, or new account name+number filled) — no file needed.
5. In upload mode, Continue still requires a loaded file (unchanged).
6. Continuing in manual mode seeds Step 2 with exactly 10 blank rows;
   `csvHeaders` stays empty.
7. Step 2 in manual mode renders no column-mapping `<select>` for any field;
   the asset-class free-text header input still renders and still works
   (broadcast + sticky-row-override, same as upload mode).
8. Typing directly into a row's cells populates that row via `importEdits`
   with no CSV/`fieldMap` involvement.
9. Import with valid manually-typed rows dispatches `IMPORT_POSITIONS` with
   correct `mappedRows`, and does NOT dispatch `UPSERT_CSV_MAPPING`.
10. Import button is not permanently disabled in manual mode despite
    `fieldMap` being `{}` (verifies the `isReviewValid` bypass) — enabled
    once at least one row is valid and non-blank, assuming asset-class
    header is filled and no row errors.
11. Import button stays disabled when all 10 rows remain blank (decided:
    0-row imports are not allowed), and becomes enabled once at least one
    row has valid, non-blank data.
12. Deleting rows in manual mode works identically to upload mode
    (re-keying `importEdits`/`touchedAssetClassRows`).
13. Switching `dataType` from `'positions'` (with `entryMode: 'manual'`) to
    `'transactions'` resets `entryMode` to `'upload'`; switching back to
    `'positions'` shows the toggle defaulted to "Upload CSV file".
14. `handleCloseDialog` resets `entryMode` to `'upload'`.
15. Closed-state button text/aria-label read "Import"; dialog title reads
    "Import". All prior tests referencing "Import CSV"/"Import from CSV"
    updated and passing.
16. Transactions import flow fully unregressed: no toggle rendered, file
    required, existing test suite (tests 1-30 minus text renames) passes
    unmodified in behavior.

## Acceptance Criteria

- [ ] `entryMode: 'upload' | 'manual'` state added, defaults `'upload'`,
      reset on dialog close and on switching `dataType` away from
      `'positions'`.
- [ ] Step 1 shows an "Upload CSV file" / "Enter manually" seg-control only
      when `dataType === 'positions'`; toggle never appears for
      transactions.
- [ ] Manual mode hides the CSV dropzone entirely (not just visually).
- [ ] `isStep1Complete()` drops the file requirement in manual mode; account
      resolution alone gates Continue.
- [ ] Continuing in manual mode seeds exactly 10 blank rows into `csvRows`,
      `csvHeaders` stays `[]`, and no saved-mapping prefill runs.
- [ ] Step 2 in manual mode renders no per-field column-mapping `<select>`;
      asset-class free-text header input still works identically to upload
      mode.
- [ ] Cell edits in manual mode are driven entirely by `importEdits`
      (empty `fieldMap`/`applyFieldMap` produces blank starting values,
      confirmed no crash with empty `csvHeaders`).
- [ ] `UPSERT_CSV_MAPPING` is never dispatched for manual-entry imports.
- [ ] Import button's `disabled` expression bypasses `isReviewValid` in
      manual mode without weakening per-row validation
      (`validatePreviewRow`/`hasImportErrors` still fully enforced).
- [ ] Import stays disabled while all 10 manual rows are blank (0-row
      imports disallowed); enabled once at least one row is valid and
      non-blank.
- [ ] Closed-state button and dialog title read "Import" (not "Import
      CSV"/"Import from CSV"); `aria-label="Import"`.
- [ ] All existing tests pass (fixed where broken by the label rename);
      new tests cover toggle visibility, manual Continue gating, 10-row
      seed, no-mapping-select rendering, import dispatch shape (including
      absent `UPSERT_CSV_MAPPING`), reset behavior, and the all-blank-rows
      edge case.
- [ ] `npm run test`, `npm run build`, `npm run lint` all green.
- [ ] `src/components/import/product-behavior.md` and
      `src/components/import/design.md` created (module previously had
      neither), covering manual entry, and reviewed full-file for
      consistency/staleness per CLAUDE.md's reference-docs rule.
- [ ] Commit made only after tests pass and docs are current.
