# Import CSV: Asset Class becomes free-text entry (not CSV-column mapping)

## Overview

Right now, Step 2 (Review) of the CSV import dialog maps Asset Class like every
other field: pick a CSV column via a header `<select>`. User wants that gone
for positions imports. Instead: one text `<input>` in the Asset Class header.
Typing in it broadcasts the value to every row's `assetClass`, EXCEPT rows the
user already hand-edited in their own row cell (sticky per-row override).
Transactions import untouched (no assetClass field there).

Files in play:
- `src/components/import/ImportDialog.tsx` — dialog component, Step 2 table.
- `src/lib/importPreview.ts` — `isReviewValid` (currently requires assetClass
  in fieldMap for positions), `validatePreviewRow` (unaffected, reads
  `values.assetClass` regardless of source).
- `src/components/import/ImportDialog.test.tsx` — has tests wired to the old
  dropdown-mapping behavior for assetClass; some will break, need new ones.
- `design.md` / `product-behavior.md` (repo root) — reference docs, describe
  current Step 2 mapping table behavior. Both exist, both need updates (see
  Task 6).

Do NOT touch `src/components/AssetClassOverrideSelect.tsx` — unrelated,
separate post-import override dropdown, out of scope, already confirmed.

**Design decision on wiring the Import-button-disabled check**: `isReviewValid`
loses `assetClass` from `alwaysRequired` (it's no longer part of fieldMap at
all). Do NOT try to shoehorn the header text value into `isReviewValid`'s
existing `(dataType, fieldMap)` signature via a hacky fake fieldMap entry.
Instead: keep `isReviewValid` fieldMap-only (still governs symbol/shares/
avgCost-or-purchaseAmount/price-or-marketValue), and add a SEPARATE check in
the component's `disabled` expression: for positions, also require
`assetClassHeaderValue.trim() !== ''`. This keeps `importPreview.ts` a pure
fieldMap-shape validator and keeps the new UI-only state (header text) out of
the lib layer. Simpler than extending function signatures / touching every
`isReviewValid` call site.

## Tasks

Do in order. Each ≤30 min.

### 1. `importPreview.ts`: drop assetClass from `alwaysRequired` [depends on: nothing]
- In `isReviewValid`, `alwaysRequired` array: change
  `['symbol', 'assetClass', 'shares']` → `['symbol', 'shares']`.
- Leave `validatePreviewRow`'s "Missing asset class" check as-is — still reads
  `values.assetClass`, works no matter where that value came from (broadcast
  or fieldMap, though fieldMap path is going away for this field).
- No signature change to `isReviewValid`. Don't touch its params.

### 2. `ImportDialog.tsx`: add header text + touched-rows state [depends on: nothing, can run parallel with 1]
- Add two new `useState`s near the other Step 2 state (~line 88-91):
  - `assetClassHeaderValue: string` (default `''`)
  - `touchedAssetClassRows: Set<number>` (default `new Set()`) — tracks row
    indices whose assetClass cell was individually edited by the user.
- Add both to `handleCloseDialog`'s reset block (~line 97-119): reset
  `assetClassHeaderValue` to `''`, `touchedAssetClassRows` to `new Set()`.
  Match the existing reset style (plain `setX(initialValue)` calls, no
  helper function).

### 3. `ImportDialog.tsx`: header text input + broadcast handler [depends on: 2]
- Write a new handler, e.g. `handleAssetClassHeaderChange(value: string)`:
  - `setAssetClassHeaderValue(value)`
  - For every row index in `previewRows` NOT in `touchedAssetClassRows`, set
    `importEdits[idx].assetClass = value`. Do this as one
    `setImportEdits(prev => {...})` functional update building a new object,
    same pattern as `handleFieldMapChange`/existing edit handlers — don't
    mutate `prev` in place.
  - Rows in `touchedAssetClassRows` are skipped entirely (their existing
    `importEdits[idx].assetClass` stays whatever the user set).
- In the JSX (~line 738-755), for `field === 'assetClass'` AND
  `dataType === 'positions'`: render a plain text `<input>` (same `className`,
  same `style` as the existing mapping `<select>` for visual consistency)
  bound to `assetClassHeaderValue`, `onChange` calls the new handler. Do NOT
  render the mapping `<select>` for this field in that case — branch the JSX
  (`field === 'assetClass' && dataType === 'positions' ? <input .../> : <select ...>`).
  Also skip the `FIELD_HINTS[field]` block for assetClass (no hint currently
  exists for it anyway — check `FIELD_HINTS` has no `assetClass` key, confirmed,
  so no-op, but keep the conditional structurally sound).
- Leave `mappedColumnFor('assetClass')` unused for this column — no more
  fieldMap entry for assetClass will ever exist since nothing writes it there
  now (make sure `handleFieldMapChange` is never called for this field —
  it can't be, since select is gone).

### 4. `ImportDialog.tsx`: mark rows touched on per-row edit + wire disabled check [depends on: 3]
- In the existing per-row `<input onChange>` (~line 832-850, the `field`-keyed
  cell), when `field === 'assetClass'`: also call
  `setTouchedAssetClassRows(prev => new Set(prev).add(rowIdx))` in addition to
  the existing `setImportEdits` call. Only mark touched for the assetClass
  field's own cell — other fields' per-row edits don't touch this set.
- Update the Import button's `disabled` expression (~line 876-880): add
  `|| (dataType === 'positions' && !assetClassHeaderValue.trim())` to the
  existing `!importDone &&` branch. Keep `isReviewValid(dataType, fieldMap)`
  call as-is (now without assetClass in its required list per Task 1).

### 5. Tests: fix broken + add new coverage [depends on: 1, 3, 4]
- Run `npx vitest run src/components/import/ImportDialog.test.tsx` first to
  see what breaks (`mapPositions()` helper calls
  `mapField('Asset Class', 'Asset Class')` which uses `selectForField` —
  will fail to find a `<select>` in the Asset Class `<th>` once it's an
  `<input>`).
- Fix `mapPositions()` helper (~line 77-83 in test file): replace the
  `mapField('Asset Class', 'Asset Class')` line with something like
  `fireEvent.change(assetClassHeaderInput(), { target: { value: 'Equity' } })`
  — add a small `assetClassHeaderInput()` helper (find the Asset Class `<th>`,
  return its `<input>`, mirroring `selectForField`'s th-lookup logic but
  grabbing `input` not `select`).
- Any other places in the test file calling
  `mapField('Asset Class', ...)`/`selectForField('Asset Class')` directly
  (grep confirmed only inside `mapPositions()` — verify no other call sites
  before assuming that's the only fix needed).
- Existing tests asserting `mappedRows` include `assetClass: 'Equity'`
  (lines ~368, ~432-433, ~465) should keep passing once `mapPositions()` is
  fixed to set the header value to `'Equity'` — no change needed to those
  assertions themselves.
- Add new tests (colocate near the other Step 2 review tests):
  - Header text input broadcasts to all rows' assetClass on every keystroke.
  - A row individually edited in its own Asset Class cell becomes "sticky":
    a subsequent header change does NOT overwrite that row's assetClass, but
    DOES still update the other (untouched) rows.
  - Import button stays disabled when header assetClass value is empty, even
    if all other fields are validly mapped (positions only).
  - Import button is NOT gated on assetClass being in fieldMap anymore —
    confirm `isReviewValid` isn't checking it (can be covered indirectly via
    the dialog test above, or a direct unit test in a new/existing
    `importPreview.test.ts` if one exists — check first).
  - Dialog close/reopen (or `handleCloseDialog`) resets header text and
    touched-rows tracking — reopening shows empty header input and no sticky
    rows carried over.
  - Transactions import: confirm nothing regressed (no assetClass column at
    all in that flow — existing `mapTransactions()`/transaction tests should
    be untouched, just rerun them).
- Check `src/lib/importPreview.test.ts` if it exists — grep for `assetClass`
  and `alwaysRequired`/`isReviewValid` coverage; update/add a test there for
  Task 1's change (isReviewValid no longer requires assetClass in fieldMap).

### 6. Reference docs [depends on: 1-5 done, code stable]
- `design.md` line ~121 (Review step description) and line ~73 in
  `product-behavior.md` (mapping table description) both currently say
  "each `<th>` holds a mapping `<select>`" — this is now false for the
  Asset Class column on positions imports specifically. Update both to note
  the exception: Asset Class (positions only) is a free-text input that
  broadcasts to all untouched rows' assetClass on change, with sticky
  per-row overrides once a row's own cell is edited.
- `product-behavior.md` line ~76 (Import button disabled logic) — update to
  reflect the added `assetClassHeaderValue` empty-check for positions.
- Full read-through of both files after edits (per CLAUDE.md rule: full-file
  review after major changes) — check no other section references the old
  assetClass-is-mapped-like-other-fields behavior and went stale.

### 7. Full test run + commit [depends on: 6]
- `npm run test` — must be fully green.
- `npm run build` (typecheck) — must pass, no `tsc` errors from new state/
  handlers.
- Commit only after both pass and docs are updated (CLAUDE.md rule — no
  partial/doc-stale commits).

## Test Cases

1. Positions import, Step 2: Asset Class header renders a text `<input>`,
   not a `<select>`. No CSV-column options shown for it.
2. Typing "Equity" in the header input sets `assetClass` = "Equity" for every
   row's `importEdits`.
3. Typing again (e.g. "ETF") overwrites all untouched rows to "ETF".
4. User edits row 2's own Asset Class cell to "Crypto" directly → row 2 is
   now touched/sticky.
5. User then changes the header input to "Bond" → row 2 stays "Crypto", all
   other rows become "Bond".
6. Deleting a row (existing `handleDeleteRow`, re-keys `importEdits` by index)
   — touched-rows tracking must re-key consistently too, or at minimum not
   silently misattribute stickiness to the wrong row after a delete shifts
   indices. (Decide during Task 4/5: `touchedAssetClassRows` needs the same
   re-key treatment as `importEdits` in `handleDeleteRow`, since indices
   shift down after a delete — add this if missing.)
7. Import button disabled when header assetClass value is empty, even with
   symbol/shares/cost/price all validly mapped.
8. Import button enabled once header assetClass value is non-empty and all
   other `isReviewValid` conditions + zero row errors are met.
9. `isReviewValid('positions', fieldMap)` returns true even when fieldMap has
   no assetClass entry at all, as long as symbol/shares/avgCost-or-
   purchaseAmount/price-or-marketValue are present.
10. `validatePreviewRow` still flags "Missing asset class" per-row when a
    row's effective `assetClass` (broadcast or sticky-edited) is blank —
    e.g. header never typed into, all rows show the error.
11. Closing and reopening the dialog resets header text to `''` and clears
    touched-rows tracking (verify via `handleCloseDialog`).
12. Transactions import: no Asset Class column exists at all; unaffected,
    existing transaction tests still pass unmodified in behavior (only
    incidental fixture/helper changes, if any).
13. Final imported `mappedRows` payload contains the correct per-row
    `assetClass` (broadcast value or sticky per-row override) — this is
    really tests 2-5 verified end-to-end through the actual `IMPORT_POSITIONS`
    dispatch call, not just `importEdits` state.

## Acceptance Criteria

- [ ] Asset Class header cell (positions import only) is a text `<input>`,
      no `<select>`, no CSV-column mapping for this field.
- [ ] Typing in the header input broadcasts live (every keystroke) to all
      rows' `assetClass` in `importEdits`, except sticky/touched rows.
- [ ] Editing a row's own Asset Class cell marks that row sticky — future
      header edits skip it. Other per-row fields don't affect stickiness.
- [ ] `handleDeleteRow` correctly re-keys `touchedAssetClassRows` alongside
      `importEdits` so stickiness stays attached to the right row after a
      delete.
- [ ] `isReviewValid` no longer requires `assetClass` in `fieldMap` for
      positions.
- [ ] Import button disabled while the header assetClass text is empty
      (positions only); transactions import behavior unchanged.
- [ ] `handleCloseDialog` resets header text + touched-rows state.
- [ ] All existing tests pass (fixed where broken by the dropdown removal);
      new tests cover broadcast, sticky-row, disabled-state, and reset
      behavior.
- [ ] `npm run test` and `npm run build` both green.
- [ ] `design.md` and `product-behavior.md` updated to describe the new
      Asset Class text-entry behavior and reviewed full-file for staleness.
- [ ] Commit made only after tests pass and docs are current.
