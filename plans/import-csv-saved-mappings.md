# Import CSV: Remember last mapping per account+kind

## Overview

CSV import Step 2 makes user re-map columns every time, even for an account
they already imported before with the same CSV export shape. Fix: remember
the last-used `fieldMap` per `(accountId, kind)`. Next time user picks that
same existing account + data type, prefill the mapping — but only for CSV
headers that actually exist in the newly-picked file. Save happens only on
successful import commit, not live on every dropdown change.

New collection `csvMappings: SavedCsvMapping[]` in `AppState`. One entry per
`accountId + kind`, upsert semantics (no "named profiles", just "last mapping
used"). Cascade-delete on account delete, like other collections already do.

**Order vs `plans/import-csv-asset-class-text-entry.md`**: that plan removes
`assetClass` from the fieldMap system for positions (dropdown -> free-text
broadcast input, stored in `importEdits`/UI state, never in `fieldMap`). This
plan's `fieldMap` shape is just "whatever's currently in `fieldMap` state at
import time" — it doesn't hardcode a field list. So:
- If asset-class plan lands FIRST: `fieldMap` naturally never contains
  `assetClass` again. This plan just works.
- If THIS plan lands FIRST: saved mappings may contain `assetClass ->
  someHeader` entries from imports done before the other plan lands. Once the
  other plan lands, those stale `assetClass` keys in old saved mappings are
  harmless — Step 2 no longer reads `fieldMap.assetClass` for positions (the
  UI switched to the text input), so the leftover key just sits unused in
  the saved `Record<string,string>`. No migration needed either direction.
- Net: order does NOT matter functionally. Recommend doing asset-class plan
  first anyway just to keep saved-mapping shapes clean going forward, but not
  a hard blocker. Note this in code review if both land close together.

Files in play:
- `src/lib/state.ts` — `AppState` interface, `initialState()`, `deleteAccount`.
- `src/lib/reducer.ts` — add one dispatch case.
- `src/lib/persist.ts` — add `csvMappings` to save/load with `[]` default.
- `src/components/import/ImportDialog.tsx` — prefill on Step 2 entry, save on
  `handleImport` commit.
- `src/lib/state.test.ts`, `src/lib/persist.test.ts`,
  `src/components/import/ImportDialog.test.tsx` — new/updated tests.
- `design.md`, `product-behavior.md`, `schema-spec.md` (repo root reference
  docs — no per-module docs exist under `src/lib/` or
  `src/components/import/`, these three root files are canonical).

## Data shape

```ts
export interface SavedCsvMapping {
  id: string              // uid('mapping')
  accountId: string
  kind: 'positions' | 'transactions'
  fieldMap: Record<string, string>  // csvColumn -> targetField, same shape as ImportDialog's fieldMap state
  updatedAt: string       // ISO
}
```

Lookup key is `(accountId, kind)` — at most one entry per pair, enforced by
upsert logic (not a DB unique constraint, just "find and replace or push").

## Tasks

Do in order. Each ≤30 min.

### 1. `types.ts`: add `SavedCsvMapping` type [depends on: nothing]
- Add the interface above to `src/lib/types.ts`, near `ImportSession`.
- Add `mapping` to the `uid()` prefix list if that list is documented
  anywhere (check `src/lib/seed.ts` — likely just a free-form prefix string,
  no registry to update, confirm before assuming a change is needed).

### 2. `state.ts`: add collection + `upsertCsvMapping` + cascade delete [depends on: 1]
- Add `csvMappings: SavedCsvMapping[]` to `AppState` interface (near
  `importSessions`).
- Add `csvMappings: []` to `initialState()`.
- New helper:
  ```ts
  export function upsertCsvMapping(
    state: AppState,
    accountId: string,
    kind: 'positions' | 'transactions',
    fieldMap: Record<string, string>
  ): AppState {
    const existing = state.csvMappings.find(
      (m) => m.accountId === accountId && m.kind === kind
    )
    const entry: SavedCsvMapping = {
      id: existing?.id ?? uid('mapping'),
      accountId,
      kind,
      fieldMap,
      updatedAt: new Date().toISOString(),
    }
    return {
      ...state,
      csvMappings: existing
        ? state.csvMappings.map((m) => (m === existing ? entry : m))
        : [...state.csvMappings, entry],
    }
  }
  ```
  Check `uid` import path (`./seed`, same as used elsewhere in state.ts —
  grep first, state.ts may not currently import `uid`, add import if needed).
- In `deleteAccount`, add: `csvMappings: state.csvMappings.filter((m) => m.accountId !== accountId)`
  — straight filter, no partial-match case like `importSessions` (a saved
  mapping belongs to exactly one account, not a list of accountIds).

### 3. `reducer.ts`: add dispatch case [depends on: 2]
- Add `case 'UPSERT_CSV_MAPPING': return upsertCsvMapping(state, action.accountId, action.kind, action.fieldMap)`
  matching existing case style (grep an existing single-purpose case like
  `ADD_IMPORT_SESSION` for the exact pattern/import list to follow).

### 4. `persist.ts`: add to save/load [depends on: 2]
- Add `csvMappings: loaded.csvMappings ?? defaults.csvMappings` to the load
  path, matching the `snapshots`/`importSessions` line pattern (~line 59-60).
- Confirm save path serializes the whole `AppState` blob generically (check
  — if it's a spread/JSON.stringify of the full state object, no explicit
  per-field save code needed, `csvMappings` rides along automatically; only
  the load/migration path needs the `?? []` default). Verify by reading the
  save function before assuming.

### 5. `ImportDialog.tsx`: prefill fieldMap on Step 2 entry [depends on: 3]
- In `handleContinue` (~line 204-207, where `setStep(2)` is called): after
  headers are known and before/as step flips to 2, if
  `accountMode === 'existing'` and `selectedAccountId` is set, look up
  `state.csvMappings.find(m => m.accountId === selectedAccountId && m.kind === dataType)`.
  If found, build the prefill fieldMap by filtering its `fieldMap` entries to
  only those whose CSV-column key is present in the just-parsed `csvHeaders`
  array (`Object.fromEntries(Object.entries(saved.fieldMap).filter(([csvCol]) => csvHeaders.includes(csvCol)))`).
  Call `setFieldMap(prefill)` (empty object `{}` if no saved mapping or
  nothing survives the filter — same as today's default).
- Do NOT prefill when `accountMode === 'new'` (no account id yet to look up
  against — new accounts never have prior saved mappings).
- Verify `csvHeaders` state is already populated by the time `handleContinue`
  runs (check `handleFileSelect` sets it during Step 1 — confirmed by earlier
  read of file, ~line 140s). If `handleContinue` runs before headers land
  (async parse), move the prefill logic into a `useEffect` keyed on
  `[step, csvHeaders]` instead — pick whichever the actual data flow
  supports, don't guess; read the surrounding code for the real order first.

### 6. `ImportDialog.tsx`: save mapping on successful import [depends on: 3]
- In `handleImport` (~line 243-308), after the existing
  `dispatch({ type: 'IMPORT_POSITIONS'/'IMPORT_TRANSACTIONS', ... })` call
  (import committed), add:
  ```ts
  dispatch({ type: 'UPSERT_CSV_MAPPING', accountId, kind: dataType, fieldMap })
  ```
  Use the same `accountId` local var already resolved earlier in the function
  (handles both existing-account and newly-created-account cases — the new
  account's id is already assigned to `accountId` by the time this runs, per
  the existing code at ~line 257-270).
- Do NOT save if `finalRows.length === 0` (nothing actually imported) — check
  existing code for how it currently guards/doesn't guard this; if there's no
  existing zero-row guard for the import dispatch itself, match that (i.e. if
  import always dispatches regardless of row count today, save the mapping
  the same way, don't add asymmetric special-casing not asked for). Confirm
  by reading current `handleImport` in full before deciding.
- Add `state.csvMappings` and `dispatch` (already in deps) to the `useCallback`
  deps array only if actually referenced — `dispatch` is already there;
  reading `fieldMap`/`dataType`/`accountId`-equivalents are already deps too
  since they're used above. Just confirm the new dispatch call doesn't need
  a new dep.

### 7. `state.test.ts`: cascade-delete test [depends on: 2]
- In the `deleteAccount` describe block (~line 386-518), add a test matching
  the existing style: create state with two accounts, a `csvMappings` entry
  for each (`acc1`+`positions`, `acc2`+`positions`), call
  `deleteAccount(state, 'acc1')`, assert `updated.csvMappings` has length 1
  and its `accountId` is `'acc2'`.
- Also add a direct `upsertCsvMapping` describe block (separate from
  `deleteAccount`):
  - No existing entry for accountId+kind -> pushes new entry, `id` generated,
    `updatedAt` set.
  - Existing entry for same accountId+kind -> replaced in place (same `id`
    preserved... decide: does re-upsert keep the old `id` or generate new?
    Plan says keep old `id` per the pseudocode above — assert that).
  - Different `kind` for same `accountId` -> two separate entries coexist
    (e.g. `acc1`+`positions` and `acc1`+`transactions` both present after
    two upserts).

### 8. `persist.test.ts`: migration default [depends on: 4]
- Add/extend a migration test (near existing ones at lines ~175/189/238):
  loading a blob with no `csvMappings` key defaults to `[]`, doesn't throw.
  Match the existing pattern used for other collections' migration tests.

### 9. `ImportDialog.test.tsx`: mapping persistence tests [depends on: 5, 6]
- **New-account-save**: import via `accountMode: 'new'`, complete Step 2,
  click Import. Assert a `UPSERT_CSV_MAPPING` (or equivalent state change,
  depending on how the test harness observes dispatch — check whether this
  test file dispatches into a real reducer+state or mocks `dispatch`; match
  existing test infra) recorded against the newly-created account's id, not
  `''`/undefined.
- **Existing-account prefill**: seed `state.csvMappings` with a saved mapping
  for an existing account+kind whose CSV-column keys match a subset of a new
  file's headers. Pick that account in Step 1, upload a file, advance to
  Step 2. Assert the mapping `<select>`s are pre-selected per the saved
  mapping.
- **Header-mismatch partial-apply**: same as above, but saved mapping
  contains a csvColumn key that does NOT appear in the new file's headers
  (e.g. saved mapping was built from a CSV with a column the user renamed).
  Assert that field's `<select>` stays unmapped (`— Not mapped —`) while
  other, still-present-header mappings still prefill correctly.
  Also assert other, still-present-header mappings still prefill correctly.
- **Upsert-on-reimport**: complete an import for an account+kind with mapping
  A, close dialog, reopen, do a second import for the same account+kind with
  a different mapping B (different CSV headers/selections). Assert
  `state.csvMappings` still has exactly one entry for that accountId+kind,
  now reflecting mapping B (not two entries, not stuck on A).
- **New-account mode never reads saved mappings**: seed a saved mapping under
  some accountId, then run the new-account import flow — even if by
  coincidence timing/id collision were possible (it isn't, new ids are
  fresh), assert Step 2 opens with an empty `fieldMap` for `accountMode: 'new'`
  (no prefill logic ran).
- Check existing test file's helper functions (`selectForField`, whatever
  builds `state`) before writing — reuse rather than duplicate.

### 10. Reference docs [depends on: 1-9 stable]
- `design.md`:
  - Line ~66 area (`AppState` field list): add `csvMappings: SavedCsvMapping[]`.
  - Line ~84 (`state.ts` helper list): add `upsertCsvMapping`.
  - Line ~121 (Step 2 description): note prefill behavior — "on entering Step
    2 with an existing account, `fieldMap` is pre-populated from any saved
    `csvMappings` entry for that `accountId`+`kind`, filtered to headers
    present in the current file."
  - Line ~144 (Account cascade delete bullet): add `SavedCsvMapping`s to the
    cascade-deleted list.
- `product-behavior.md`:
  - Near line ~73-76 (mapping table / Import button behavior): note that
    picking a previously-used existing account prefills the mapping
    dropdowns from the last successful import for that account+kind, and
    that a successful import updates that saved mapping (upsert, not
    append).
- `schema-spec.md`:
  - Add a `## SavedCsvMapping` section matching the style of the existing
    `## ImportSession` section (field table: `id`, `accountId`, `kind`,
    `fieldMap`, `updatedAt`).
  - Add `mapping` to the `uid()` prefix list at line ~5 if Task 1 added a new
    prefix.
  - Near line ~148-149 (reducer action list): add
    `UPSERT_CSV_MAPPING: Upsert a SavedCsvMapping for (accountId, kind)`.
  - Full read-through of all three files after edits per CLAUDE.md's
    "full-file review after major changes" rule — check nothing else
    references the old no-persistence behavior and went stale.

### 11. Full test run + commit [depends on: 10]
- `npm run test` must pass, all of it, not just new tests.
- `npm run build` (typecheck) should also pass — new interface/state fields
  touch several files.
- Commit only after tests green and all three reference docs updated, per
  CLAUDE.md's commit-gating rule. One commit, not one per task, unless user
  says otherwise.

## Test Cases

1. `upsertCsvMapping`: no existing entry -> new entry pushed, `id`/`updatedAt` set.
2. `upsertCsvMapping`: existing entry for same accountId+kind -> replaced,
   same `id` retained, `fieldMap`/`updatedAt` updated.
3. `upsertCsvMapping`: same accountId, different kind -> two coexisting entries.
4. `deleteAccount`: cascades to remove all `csvMappings` entries for that accountId,
   leaves other accounts' entries untouched.
5. `persist.ts` load: blob missing `csvMappings` key defaults to `[]`, no throw.
6. ImportDialog: existing-account + matching saved mapping -> Step 2 fieldMap
   prefilled correctly per saved csvColumn->field pairs.
7. ImportDialog: saved mapping has a csvColumn not present in new file's
   headers -> that pair dropped, field left unmapped, other pairs still apply.
8. ImportDialog: new-account mode -> no prefill attempted regardless of any
   existing saved mappings.
9. ImportDialog: successful import (existing account) -> `csvMappings` upserted
   with the accountId used and the fieldMap as it stood at commit time.
10. ImportDialog: successful import (new account) -> `csvMappings` upserted
    against the newly-created account's id (not blank/undefined).
11. ImportDialog: two successful imports for same account+kind with different
    mappings -> only one `csvMappings` entry survives, reflecting the latest.
12. Full `npm run test` and `npm run build` pass after all changes.

## Acceptance Criteria

- [ ] `SavedCsvMapping` type defined in `types.ts`.
- [ ] `AppState.csvMappings: SavedCsvMapping[]`, defaults to `[]` in
      `initialState()` and in `persist.ts` load-path migration.
- [ ] `upsertCsvMapping` helper in `state.ts`, `UPSERT_CSV_MAPPING` case in
      `reducer.ts`.
- [ ] `deleteAccount` cascades to `csvMappings`.
- [ ] ImportDialog Step 2 prefills `fieldMap` from the saved mapping for
      existing-account + matching kind, filtered to headers present in the
      current CSV file; no prefill for new-account mode.
- [ ] ImportDialog saves (upserts) the mapping only on successful import
      commit, keyed by the actual destination accountId (existing or
      newly-created).
- [ ] All test cases above pass; `npm run test` and `npm run build` green.
- [ ] `design.md`, `product-behavior.md`, `schema-spec.md` updated and
      internally consistent (full read-through done).
- [ ] Change committed only after tests pass and docs updated.
