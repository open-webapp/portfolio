# Portfolio Dashboard v2 Alignment

## Overview

Align app with `design/v2/project/Portfolio Dashboard.dc.html` (diffed against `design/v1/...`). Three buckets of work:

1. Pure label renames on Positions table, Transactions table, Summary Cards. No field/schema/computation changes.
2. Replace the whole CSV import UX: one "Import CSV" button (was two per-tab buttons) opening one 4-step dialog (Setup → Map columns → Preview → Confirm). Step 1 picks a destination account (existing or new) upfront — this **replaces** the current per-row account-number-column + multi-account-resolution flow entirely. Mapping profiles are kept but restructured into Step 2, gain a "constant value" mapping option. Step 3 becomes an inline-editable, per-cell-validated table. Step 4 is a review + commit + done screen.
3. Closed Positions gets a delete button (with a confirm step we add on top of v2, since v2 has no confirm and deleting destroys realized-G/L history).

## RISK — reverses recent commits

Decision (confirmed with user, not up for re-litigation): `AccountResolvePrompt.tsx` and `ManualAccountNumberPrompt.tsx`, plus `MappingProfile.accountNumberColumn` and the account-number-column-driven row-grouping logic in `App.tsx`'s `pendingImport` effect, are **deleted** by this plan. This directly reverses the intent of commits `ac82c03` ("Fix: Import now requires account number column to be mapped"), `1e9d412` ("Implement account resolution prompt and Drive sync UI" — the account-resolution-prompt part of it), and the revert-of-a-revert dance in `17e4bdf`/`f2e4152`. Whoever picks this plan up later should know that's intentional, not an oversight — v2's model is "pick one destination account before the file is even parsed," so there is nothing left to resolve per-row.

## Judgment calls made while writing this plan (flagged, not yet confirmed by user)

1. **Dropping `pendingImport`/`accountPromptQueue` from `AppState` entirely**, not just simplifying them. Since Step 1 resolves the destination account synchronously before parsing/preview, there's no async multi-account resolution left to track — the dialog can dispatch `ADD_ACCOUNT` (for a new account) then `IMPORT_POSITIONS`/`IMPORT_TRANSACTIONS` directly on Confirm, no `useEffect` in `App.tsx` needed. This is a bigger architectural simplification than the interview strictly asked for ("removing the account-number-column-driven grouping logic") — flagging in case the intent was to keep the `pendingImport` field for some other future use.
2. **New `ADD_ACCOUNT_AND_IMPORT` vs. two dispatches**: plan uses two separate dispatches (`ADD_ACCOUNT` then `IMPORT_POSITIONS`/`IMPORT_TRANSACTIONS`) back to back in the dialog's confirm handler rather than a single combined action, since `reducer.ts` already has `ADD_ACCOUNT` and doing two synchronous dispatches in one click handler is safe with `useReducer` (each call sees the prior state). Called out in case a single atomic action is preferred.
3. **`constants` shape on `MappingProfile`**: proposing `constants?: Record<string, string>` (key = our internal field name, e.g. `assetClass`, value = the constant string applied to every row) — parallel to `fieldMap` but keyed by target field instead of CSV header, since a constant has no CSV column to key off of.
4. **Retirement toggle placement**: v2's new-account grid is 3 columns (name / number / category). Adding a 4th "Retirement" toggle makes 4 fields — plan renders it as a `seg` Yes/No toggle in a 4th grid column on wide screens (wraps on narrow), consistent with existing `.seg`/`.seg-opt` vocabulary rather than a checkbox, to match CLAUDE.md's styling rule.

## Tasks

### Phase A — label renames (independent, no dependencies, ~10 min each)

- [ ] **A1. Rename Positions table column labels** (`src/components/PositionsTable.tsx`): `columns` array — `'Security'` → `'Symbol'`, `'Avg Cost'` → `'Cost Basis'`, `'Price'` → `'Current Price'` (`'Asset Class'` unchanged, already correct). Also rename the standalone `<th>Cost Basis</th>` (currently right after the sortable headers, ~line 202) → `<th>Amount Invested</th>`. Do not touch `keyof Position` sort keys (`avgCost`, `price`, `symbol` stay as-is — this is display text only).
- [ ] **A2. Rename Transactions table column labels** (`src/components/TransactionsTable.tsx`): `<th>Price</th>` → `<th>Cost Basis</th>`, `<th>Amount</th>` → `<th>Amount Invested</th>` (~lines 159-160).
- [ ] **A3. Rename Summary Card label** (`src/lib/selectors.ts`, `summaryCards()`, ~line 207): `label: 'Cost Basis'` → `label: 'Amount Invested'`. Check `src/lib/selectors.test.ts` for any assertion on the literal string `'Cost Basis'` for this card and update it.
- [ ] **A4. Update `product-behavior.md`** — Positions table section ("Columns: Security..." line) and Transactions table section ("Columns: Date, Symbol, Type... Price, Amount...") and Summary cards section (#4 "Cost Basis") to use the new labels. This is a doc-only edit, do together with A1-A3 since they're the same rename.

### Phase B — schema changes for the new import model (blocks Phase C)

- [ ] **B1. `src/lib/types.ts`**: On `MappingProfile`, remove `accountNumberColumn?: string`, add `constants?: Record<string, string>` (key = internal field name, value = constant string for every row). Depends on: none.
- [ ] **B2. `src/lib/mappingProfiles.ts`**: Update `createProfile`/`updateProfile` signatures — drop `accountNumberColumn` param, add `constants?: Record<string, string>` param, threaded through same as `fieldMap`. Update `applyMapping(row, profile)` — drop the "preserve raw account-number column" block; after renaming CSV headers, merge in `profile.constants` (constant fields win only when not already produced by `fieldMap` — actually constants apply to *every* row identically regardless of CSV content, so just `Object.assign(mapped, profile.constants)` after the rename loop). `validateProfile` unchanged in structure (still checks required fields are mapped) but "mapped" must now mean "present in `fieldMap` values OR in `constants` keys" — update the `mappedFields` set construction: `new Set([...Object.values(profile.fieldMap), ...Object.keys(profile.constants || {})])`. Depends on: B1.
- [ ] **B3. `src/lib/mappingProfiles.test.ts`**: Update/add tests — remove any `accountNumberColumn` cases, add: `applyMapping` applies a constant to every row; `validateProfile` treats a constant-mapped required field as satisfied (e.g. positions profile with `assetClass` only in `constants`, not `fieldMap`, is valid). Depends on: B2.
- [ ] **B4. `src/lib/accounts.ts`**: Delete `resolveAccountNumber` (no longer meaningful — no per-row account column). Keep `findOrCreateAccountPrompt`/`finalizeNewAccount` only if still referenced after Phase C (see C7 — likely both get inlined/removed too; confirm during C7 and delete here if genuinely dead). Depends on: B1 (types change first so this compiles clean), sequenced with C7.
- [ ] **B5. `src/lib/accounts.test.ts`**: Remove `resolveAccountNumber` test cases. Depends on: B4.

### Phase C — the new unified `ImportDialog` (the big one)

- [ ] **C1. Delete-and-recreate plan for `src/components/import/`**: read current `ImportPositionsDialog.tsx` and `ImportTransactionsDialog.tsx` in full (both already exist, ~350 lines each, near-identical) to lift any logic worth keeping (file parsing via `parseCsvFile`, profile CRUD dispatches). No code changes in this task — just confirms what step-machine code is reusable vs. thrown away for the new 4-step design. Depends on: none.
- [ ] **C2. New `src/components/import/ImportDialog.tsx` — Step 1 (Setup)**: Single component, no `kind` prop needed anymore (kind is chosen *inside* the dialog now, per v2's `dataTypeOptions` seg control) — replaces the two separate `kind`-parameterized dialogs. Local state: `step: 1|2|3|4`, `dataType: 'positions'|'transactions'`, `accountMode: 'existing'|'new'`, `accountId` (existing) or `{name, number, category, retirement}` (new — retirement per judgment-call #4), `file`, `fileError`. Renders: data-type `seg`, destination-account `seg` (existing/new), existing-account `<select>` sourced from `state.accounts`, new-account fields (name/number/category/retirement) when `accountMode === 'new'`, file drop-zone (`onDrop`/`onChange` → `parseCsvFile`). "Continue" disabled until: data type chosen, account resolved (existing selected OR new-account name+number filled), file parsed with ≥1 row. Depends on: B1, B2, C1.
- [ ] **C3. Step 2 (Map columns)**: Above the mapping grid, a "Use saved profile" `<select>` (options = `listProfilesForKind(state.mappingProfiles, dataType)` + "Create new"). Selecting a profile pre-fills `fieldMap`/`constants` state from it; the grid always renders from local `fieldMap`/`constants` state (not the profile directly), so hand-editing after picking a profile "detaches" naturally — no extra detach flag needed, just don't write back to the profile object until "Save as profile" is clicked. Grid: one row per `POSITIONS_REQUIRED_FIELDS`/`POSITIONS_OPTIONAL_FIELDS` (or transactions equivalents), each a `<select>` of CSV headers plus a synthetic `"Enter a value…"` option; choosing it reveals a text input bound to `constants[field]`. "Save as profile" button opens a small inline name input, calls `createProfile`/`updateProfile` + dispatches `ADD_MAPPING_PROFILE`/`UPDATE_MAPPING_PROFILE`. Depends on: C2.
- [ ] **C4. Step 3 (Preview & validate)**: Build `previewRows` = `csvRows.map(row => applyMapping(row, {fieldMap, constants}))` (or equivalent inline, doesn't require a full saved `MappingProfile` object — a lightweight `{fieldMap, constants}` shape works since `applyMapping` only reads those two fields). Render an editable `<table>`: one `<input>` per mapped field per row, edits held in local `importEdits: Record<string, Record<string,string>>` (rowIdx → field → value) overlaying the mapped value. Per-cell validation: reuse `POSITIONS_REQUIRED_FIELDS`/`TRANSACTIONS_REQUIRED_FIELDS` + the existing avgCost/purchaseAmount and price/marketValue alternative-pair logic (a row is valid if it has a non-empty required field OR, for the alternative pairs, at least one of the pair) — write a small local `validatePreviewRow(dataType, values)` helper (co-locate in `ImportDialog.tsx` or a new `src/lib/importPreview.ts` if it grows past ~40 lines, in which case add `importPreview.test.ts` per CLAUDE.md's one-test-per-lib-module rule). "Continue"/"Review Import" disabled while any row has an error. Depends on: C3.
- [ ] **C5. Step 4 (Confirm)**: Review card — data type label, destination label (existing account name or new-account name being created), valid row count. Primary button "Import" — on click: (a) if `accountMode === 'new'`, dispatch `ADD_ACCOUNT` with a freshly-`uid('acc')`-generated `Account` (name/number/category/retirement from Step 1 state, `createdAt: new Date().toISOString()`) and capture its `id`; (b) build final mapped rows from Step 3's edited preview state (excluding rows still marked invalid, though "Import" is disabled until zero are invalid so this is a no-op filter in practice); (c) dispatch `IMPORT_POSITIONS`/`IMPORT_TRANSACTIONS` with that `accountId` and the rows. After dispatch, flip local `importDone = true` and show the completion state ("Import complete" + row-count summary) instead of unmounting immediately, so the user sees confirmation before closing. Depends on: C2 (account fields), C4 (validated rows), B2.
- [ ] **C6. "Import CSV" button + dialog wiring in `src/App.tsx`**: Replace the two per-tab `<ImportPositionsDialog>`/`<ImportTransactionsDialog>` renders with one `<ImportDialog state={state} dispatch={dispatch} />` rendered once, outside the tab-conditional block (visible regardless of `state.tab`, mirroring v2's tabs-row placement — button lives next to the Positions/Transactions tab `seg`, not per-tab). Dialog manages its own open/closed local state (no `state.importOpen` needed in `AppState` — keep it component-local like the old dialogs did with their step state). Depends on: C5.
- [ ] **C7. Remove the old `pendingImport`/`accountPromptQueue` plumbing**: Delete the `pendingImport`-processing `useEffect` in `App.tsx` (lines ~81-164) and the `needsManualAccountNumber`/`pendingProfile` derived vars and `<ManualAccountNumberPrompt>`/`<AccountResolvePrompt>` renders. Remove `pendingImport`/`accountPromptQueue` from `AppState` (`src/lib/state.ts`) along with `setPendingImport`/`setAccountPromptQueue` helpers, and the `SET_PENDING_IMPORT`/`CLEAR_IMPORT_DIALOG`/`SET_ACCOUNT_PROMPT_QUEUE` cases from `reducer.ts` (per judgment call #1). Keep `IMPORT_POSITIONS`/`IMPORT_TRANSACTIONS` cases (still used by the new dialog) and `FINALIZE_NEW_ACCOUNT`/`ADD_ACCOUNT` (decide here whether `finalizeNewAccount`/`FINALIZE_NEW_ACCOUNT` is now dead code since C5 uses plain `ADD_ACCOUNT` — if nothing else calls `FINALIZE_NEW_ACCOUNT`, delete it and `accounts.ts`'s `finalizeNewAccount`/`findOrCreateAccountPrompt` too, resolving B4's "confirm during C7" note). Depends on: C6.
- [ ] **C8. Delete dead files**: `src/components/import/ImportPositionsDialog.tsx`, `ImportTransactionsDialog.tsx`, `AccountResolvePrompt.tsx`, `ManualAccountNumberPrompt.tsx`, and any of their test files (check for `AccountResolvePrompt.test.tsx`/`ManualAccountNumberPrompt.test.tsx`/`ImportPositionsDialog.test.tsx`/`ImportTransactionsDialog.test.tsx` — none seen in current `git status` listing but re-check at execution time). Update `src/components/import/index.ts` to export only `ImportDialog`/`ImportDialogProps` and `MappingProfileEditor`/`MappingProfileEditorProps` (drop the four deleted exports). Depends on: C7.
- [ ] **C9. `MappingProfileEditor.tsx` — decide fate**: v2's Step 2 mapping grid (C3) subsumes what `MappingProfileEditor.tsx` currently does (a standalone "map CSV columns to fields" form used by the old dialogs' profile-editor step). Two options: (a) delete `MappingProfileEditor.tsx` and fold its logic directly into `ImportDialog.tsx`'s Step 2, since it's no longer a separately-invoked step in the new 4-step flow; (b) keep it as an internal sub-component `ImportDialog` renders for the grid, updated to drop `accountNumberColumn` and add the constant-value option. Recommend (b) — smaller diff, keeps the component test (`MappingProfileEditor.test.tsx`) largely intact — but update its props (drop `accountNumberColumn` handling, add `constants`/`onConstantsChange`) and its "Save Profile" button behavior (now optional "Save as profile" rather than a required step-gate). Depends on: C3.
- [ ] **C10. Update `MappingProfileEditor.test.tsx`**: Remove any `accountNumberColumn` assertions (grep confirms none currently reference it by name in this file — verify), add cases for the constant-value option per Test Cases below. Depends on: C9.
- [ ] **C11. New `src/components/import/ImportDialog.test.tsx`**: Full coverage per Test Cases below. This replaces the coverage that would otherwise have lived in per-dialog test files (none exist yet in this repo, so this is net-new, not a migration). Depends on: C6, C7, C8, C9.

### Phase D — Closed Positions delete button

- [ ] **D1. `src/lib/state.ts`**: Add `deleteClosedPosition(state: AppState, id: string): AppState` — `{ ...state, closedPositions: state.closedPositions.filter(cp => cp.id !== id) }`, following the existing helper pattern (see `deleteAccount`). Depends on: none.
- [ ] **D2. `src/lib/reducer.ts`**: Add `case 'DELETE_CLOSED_POSITION': return StateActions.deleteClosedPosition(state, action.id)`. Depends on: D1.
- [ ] **D3. `src/components/ClosedPositionsTable.tsx`**: Add a 4th `<th>` (empty label, `width: 40px`, per v2) and a trash-icon `<button>` per row (reuse `lucide-react`'s trash icon, consistent with existing icon usage elsewhere in the app — check what icon lib other buttons use first). On click: `window.confirm('Delete this closed position? This permanently discards its realized G/L history.')` → if confirmed, `dispatch({ type: 'DELETE_CLOSED_POSITION', id: cp.id })`. This confirm step is a deliberate deviation from v2 (which deletes with no confirmation) per the interview decision — data safety for a permanent, unrecoverable action. `ClosedPositionsTableProps` already takes `dispatch`, just wasn't using it — start using it. Depends on: D2.
- [ ] **D4. `src/components/ClosedPositionsTable.test.tsx`** (new file — none exists today): delete button calls `window.confirm` (mock it), dispatches `DELETE_CLOSED_POSITION` with the right `id` only when confirm returns true, does not dispatch when confirm returns false. Depends on: D3.

### Phase E — reference docs (do last, after Phases A-D land, per CLAUDE.md's "auto-update after every change" + "full-file review after major changes")

- [ ] **E1. `design.md`**: Directory structure — `import/` listing: `ImportPositionsDialog.tsx`/`ImportTransactionsDialog.tsx`/`AccountResolvePrompt.tsx`/`ManualAccountNumberPrompt.tsx` → `ImportDialog.tsx`. Component tree — collapse the two per-tab import dialog entries into one `ImportDialog (state, dispatch)` rendered once above the tab content; remove `AccountResolvePrompt`/`ManualAccountNumberPrompt` from the tree entirely. Data flow — rewrite the "CSV import" and "Import processing" subsections to describe the new synchronous 4-step flow (no `pendingImport` effect, no account-prompt queue). State management — remove `pendingImport`/`accountPromptQueue` from the `AppState` interface description and from the action-types list (`SET_PENDING_IMPORT`, `CLEAR_IMPORT_DIALOG`, `SET_ACCOUNT_PROMPT_QUEUE`, possibly `FINALIZE_NEW_ACCOUNT` per C7's outcome); add `DELETE_CLOSED_POSITION`. "Known gaps" section — remove the now-stale "No account-resolution UI" bullet (it's resolved, differently than originally planned). Depends on: all of Phase A-D.
- [ ] **E2. `product-behavior.md`**: Rewrite "CSV import (Positions / Transactions)" section entirely to describe the 4-step `ImportDialog` (Setup/Map/Preview/Confirm), the destination-account model, constant-value mapping, and inline-editable preview with per-cell errors. Remove the "ManualAccountNumberPrompt"/"AccountResolvePrompt" mentions from the Layout section. Update Positions table section to mention the delete button + confirm-before-delete behavior on Closed Positions. Apply the label renames from Phase A here too if not already done in A4. Depends on: all of Phase A-D.
- [ ] **E3. `schema-spec.md`**: `MappingProfile` table — remove `accountNumberColumn?`, add `constants?: Record<string, string>` row. `AppState UI/filter fields` section — remove `pendingImport`/`accountPromptQueue` from the field list. Depends on: B1, all of Phase A-D.
- [ ] **E4. Full-file re-read of `design.md`, `product-behavior.md`, `schema-spec.md`** per CLAUDE.md's "full-file review after major changes" rule — confirm no section still references `ImportPositionsDialog`, `ImportTransactionsDialog`, `AccountResolvePrompt`, `ManualAccountNumberPrompt`, `accountNumberColumn`, `pendingImport`, or `accountPromptQueue`, and that the three docs agree with each other (e.g. `schema-spec.md`'s `MappingProfile` fields match what `design.md`'s data-flow section says the dialog reads/writes). Fix any drift found. Depends on: E1, E2, E3.

### Phase F — verification & commit

- [ ] **F1. `grep -rn "accountNumberColumn\|AccountResolvePrompt\|ManualAccountNumberPrompt\|pendingImport\|accountPromptQueue" src/`** — must return nothing (except possibly this plan file itself, which isn't in `src/`). Depends on: C8, D-phase, E-phase.
- [ ] **F2. `grep -ri watchlist src/`** — must return nothing (unaffected by this plan, re-verify per CLAUDE.md out-of-scope rule). Depends on: none, run alongside F1.
- [ ] **F3. `npm run test`** — all green, including new `ImportDialog.test.tsx`, `ClosedPositionsTable.test.tsx`, updated `mappingProfiles.test.ts`/`accounts.test.ts`/`MappingProfileEditor.test.tsx`/`selectors.test.ts`. Depends on: all prior phases.
- [ ] **F4. `npm run lint` and `npm run build`** — must pass with no type errors (the `MappingProfile`/`AppState` shape changes touch several files; `tsc -b` will catch any missed call site). Depends on: F3.
- [ ] **F5. Commit** — only after F1-F4 all pass and Phase E docs are updated (CLAUDE.md: never commit partial or doc-stale work). Depends on: F1, F2, F3, F4, E4.

## Test cases

**`mappingProfiles.test.ts`**
- `applyMapping` renames CSV headers to internal fields per `fieldMap` (existing coverage, keep).
- `applyMapping` applies `profile.constants['assetClass'] = 'Equity'` to every returned row regardless of CSV content.
- `applyMapping` with both a `fieldMap` entry and a `constants` entry for different fields — both apply independently.
- `validateProfile` (positions): required field satisfied via `constants` alone (no `fieldMap` entry) passes validation.
- `validateProfile` (positions): avgCost/purchaseAmount alternative-pair logic still works when one side is a constant.
- No remaining test exercises `accountNumberColumn` (removed).

**`accounts.test.ts`**
- `resolveAccountNumber` tests removed.
- `finalizeNewAccount`/`findOrCreateAccountPrompt` tests removed if C7 determines those functions are deleted (else left as-is).

**`ImportDialog.test.tsx`** (new)
- Closed state: renders a single "Import CSV" button (not "Import Positions"/"Import Transactions"), visible on both Positions and Transactions tabs.
- Step 1: choosing "Transactions" data type + "New account" mode reveals name/number/category/retirement fields; "Continue" stays disabled until name+number are non-empty and a file is loaded.
- Step 1: choosing "Existing account" mode shows a `<select>` populated from `state.accounts`; "Continue" enabled once one is selected and a file is loaded.
- Step 1: dropping/selecting a non-CSV file shows `importFileError` and does not advance.
- Step 2: selecting a saved profile (`kind` matching Step 1's data type) pre-fills the mapping grid; profiles of the other `kind` do not appear in the "use saved profile" list.
- Step 2: choosing "Enter a value…" for a field reveals a text input; typing into it and continuing produces that constant on every Step 3 preview row.
- Step 2: "Save as profile" dispatches `ADD_MAPPING_PROFILE` (new) or `UPDATE_MAPPING_PROFILE` (editing an existing selected profile) with the current `fieldMap`/`constants`.
- Step 3: a row missing a required field (e.g. blank `symbol`) shows an inline error and disables "Review Import"/"Continue"; editing the cell to a valid value clears the error and re-enables it.
- Step 3: positions alternative-pair validation — a row with neither `avgCost` nor `purchaseAmount` mapped/edited errors; mapping either one clears it.
- Step 3: edits made in the preview table are what actually get imported (not the raw un-edited mapped value) — verify via the Step 4 confirm dispatch payload.
- Step 4: review card shows correct data-type label, destination label (existing account name, or the new account's name), and valid-row count.
- Step 4, new-account mode: clicking "Import" dispatches `ADD_ACCOUNT` (with retirement flag from Step 1) then `IMPORT_POSITIONS`/`IMPORT_TRANSACTIONS` with that new account's id.
- Step 4, existing-account mode: clicking "Import" dispatches `IMPORT_POSITIONS`/`IMPORT_TRANSACTIONS` with the selected `accountId` directly, no `ADD_ACCOUNT`.
- Step 4: after "Import" succeeds, dialog shows "Import complete" + a row-count summary instead of closing immediately.
- "Back" from any step returns to the prior step without losing already-entered data (file, mapping, edits).
- "Cancel" from any step closes the dialog and fully resets local state.

**`MappingProfileEditor.test.tsx`**
- Existing "renders optional field dropdowns including `name`" regression test (from `mapping-profile-uniqueness`/prior work) still passes.
- New: a field's dropdown includes an "Enter a value…" option; selecting it reveals a constant-value text input; the component's `onSave`/change handlers surface it distinctly from a `fieldMap` entry (exact prop shape depends on C9's implementation — assert on whatever `constants` prop/callback is chosen).
- No test asserts on `accountNumberColumn` (removed from the component).

**`ClosedPositionsTable.test.tsx`** (new)
- Renders a trash-icon delete button per row.
- Clicking delete calls `window.confirm`; if it returns `true`, dispatches `{ type: 'DELETE_CLOSED_POSITION', id: <that row's id> }`.
- Clicking delete then cancelling the confirm (`window.confirm` returns `false`) dispatches nothing.

**`selectors.test.ts`**
- Summary card at index 3 has `label: 'Amount Invested'` (was `'Cost Basis'`) — update existing assertion if present.

**`state.test.ts`** (if it exists — check; `state.ts` itself has no colocated test file listed in the earlier directory read, verify at execution time and create `state.test.ts` if genuinely absent, since `deleteClosedPosition` needs coverage per CLAUDE.md's one-test-per-lib-module rule)
- `deleteClosedPosition` removes only the matching id, leaves others untouched, no-ops on unknown id.

**`reducer.test.ts`** (same existence check as above)
- `DELETE_CLOSED_POSITION` action calls through to `deleteClosedPosition`.

**Manual/App-level (`App.test.tsx`)**
- "Import CSV" button renders once, not per-tab; visible regardless of `state.tab`.
- No `AccountResolvePrompt`/`ManualAccountNumberPrompt` render paths remain (remove/replace any existing `App.test.tsx` cases that reference them).

## Acceptance criteria

- Positions table shows "Symbol", "Cost Basis" (was Avg Cost), "Current Price" (was Price), "Amount Invested" (was Cost Basis); Transactions table shows "Cost Basis" (was Price), "Amount Invested" (was Amount); Summary Cards show "Amount Invested" (was Cost Basis). Underlying field names/computations in `computations.ts` are untouched — `grep -n "avgCost\|costBasis" src/lib/computations.ts` shows no changes.
- Exactly one "Import CSV" button exists in the app, visible on both Positions and Transactions tabs, opening one `ImportDialog` with 4 steps matching v2's step-indicator UI.
- Step 1 always requires a destination account (existing, via dropdown, or new, via name/number/category/retirement fields) before a file can be mapped — no code path imports into an unresolved/ambiguous account.
- Step 2 supports both CSV-column mapping and constant-value mapping per field, backed by `MappingProfile.constants`; saved profiles still work for CSV-column mappings and now also persist constants.
- Step 3 is an editable table with per-cell validation reusing the existing required-field and avgCost/purchaseAmount + price/marketValue alternative-pair rules; "Continue"/commit is blocked while any row errors.
- Step 4 shows a review (data type, destination, row count), commits via `ADD_ACCOUNT`(if new) + `IMPORT_POSITIONS`/`IMPORT_TRANSACTIONS`, and shows an "Import complete" state after success.
- `AccountResolvePrompt.tsx`, `ManualAccountNumberPrompt.tsx`, `ImportPositionsDialog.tsx`, `ImportTransactionsDialog.tsx` no longer exist; `MappingProfile.accountNumberColumn` no longer exists; `grep -rn "accountNumberColumn\|AccountResolvePrompt\|ManualAccountNumberPrompt" src/` is empty.
- Closed Positions rows each have a working delete button that requires confirmation before dispatching `DELETE_CLOSED_POSITION`.
- `npm run test`, `npm run lint`, `npm run build` all pass.
- `grep -ri watchlist src/` is empty (unaffected).
- `design.md`, `product-behavior.md`, `schema-spec.md` fully describe the post-change state with no stale references to removed components/fields/labels (verified via Phase E4's full re-read).
- Commit created only after all of the above are true (no partial/doc-stale commit, per CLAUDE.md).
