# Accounts: add "Institution" attribute

## Overview

`Account` currently has no institution field (Fidelity, Schwab, Vanguard,
etc.). Add `institution: string` to the `Account` type, always present
(empty string means "unfilled"). Existing/migrated accounts may sit at
`institution: ''` indefinitely and get fixed up later in Settings; brand-new
accounts created via the CSV-import dialog's inline "new account" form must
have it set before Import is enabled. One new shared combobox component
(seeded list ∪ institutions already in use across accounts, plus free-type
"Add \"X\"") is reused identically by both the Settings Accounts table and the
import dialog's new-account form.

## Files in play

- `src/lib/types.ts` — add `institution: string` to `Account`, positioned
  after `name` and before `taxCategory`.
- `src/lib/persist.ts` — `loadPersistedApp`'s migration mapping needs to
  default `institution: ''` per-account for accounts loaded from an
  old-shaped blob that predates this field.
- `src/lib/state.ts` / `src/lib/reducer.ts` — **no changes**. `updateAccount`
  (patches `Partial<Account>`) and `addAccount` (takes a full `Account`)
  already flow any new field through generically.
- `src/components/InstitutionSelect.tsx` — **new** shared component:
  `{ value: string, accounts: Account[], onChange: (value: string) => void }`.
  Computes options = seeded list ∪ non-empty `institution` values already
  present in `accounts` (deduped), supports typing a new value with an
  "Add \"X\"" affordance.
- `src/components/Settings.tsx` — `AccountRow`: new "Institution" column
  between Name and Tax Category, using `InstitutionSelect`; wires to
  `UPDATE_ACCOUNT` with `patch: { institution }`, same shape as the existing
  `handleTaxCategoryChange`.
- `src/components/import/ImportDialog.tsx` — `NewAccountFields` gets
  `institution: string` (default `''`); new-account form renders
  `InstitutionSelect`; `isStep1Complete()`'s new-account branch also requires
  `newAccountFields.institution.trim() !== ''`; the constructed `newAccount`
  object (~line 320-326) includes `institution: newAccountFields.institution`;
  `handleCloseDialog`'s reset block resets it to `''`.
- `schema-spec.md` — `## Account` table gets an `institution` row.
- `product-behavior.md` — Settings page Accounts row description, and the
  Step 1 new-account form description in the import section.
- `design.md` — add `InstitutionSelect.tsx` to the component list/tree (only
  doc that needs a structural addition, since this is a genuinely new file).
- `src/lib/persist.test.ts` — **not touched by this plan**. This file already
  uses an `Account` literal shape (`{ id, number, name, institution,
  accountType, isRetirement }`) that does not match the real `Account`
  interface in `types.ts` at all (wrong field names, extra/missing fields,
  and it already invents an `institution` field today even though none
  exists in the type). Confirmed why this doesn't break anything: `*.test.ts`
  files are excluded from `tsconfig.app.json`'s `include`/build project
  (`"exclude": ["src/**/*.test.ts", "src/**/*.test.tsx"]`), and vitest itself
  (esbuild transpile, no `vite-plugin-checker`) never type-checks test files
  either — so the mismatched literals never get structurally validated
  against `AppState`/`Account` at all, `npx tsc -b` and `npm run test` both
  pass today regardless. Leave this file alone; it's unrelated pre-existing
  drift, not evidence of prior support for this feature. (Re-verify this
  still holds if `tsconfig.app.json`'s excludes or the vitest config change
  before this plan lands.)
- No "Instituion" typo currently exists anywhere in `src/`, `schema-spec.md`,
  `product-behavior.md`, or `design.md` (grepped, case-insensitive) — there is
  nothing literal to rename. Just make sure every new label/copy this plan
  adds spells it "Institution."

## Design decisions

**Plain required string, not an enum.** `institution` is `string`, not a
union type — the seeded list is UI-only (a starting menu), not a schema
constraint. Any string is a valid institution once a user has typed it for
one account.

**No new persisted state.** Do not add an `AppState` field, action type, or
reducer case to track "known institutions." The set of selectable values is
computed on the fly as seeded-list ∪ `{a.institution for a in accounts where
a.institution !== ''}`, deduplicated, wherever `InstitutionSelect` renders.
Once a user types a new institution for one account, it becomes available to
other accounts purely because it's now present in `state.accounts` — no
separate storage, no migration beyond the plain field default below.

**Migration is a default, not a backfill.** `persist.ts` follows its existing
pattern (missing collections/fields default, never throw). An old-shaped
persisted account object without an `institution` key loads as
`institution: ''`. Nothing walks existing accounts to force a value in; the
requirement is enforced only at the point of creating a *new* account via the
import dialog (see below), never retroactively.

**Settings-page cell is always-visible, not click-to-reveal.**
`AssetClassOverrideSelect.tsx` is a useful reference for the "seeded options +
free-type a new value" interaction (search/filter, detect "is this new?"),
but its visual pattern — hidden behind a "Set" button until clicked — is
explicitly NOT what Institution should do. Institution's combobox must be
always visible in the row, like the existing `taxCategory` `<select>` cell,
so it reads and behaves the same way as the other always-on account fields.
When `institution === ''` it shows a plain placeholder ("— Select —") with no
red/warning styling — Settings never blocks or nags about an unfilled
institution on existing accounts.

**Required only at account-creation time.** The only enforcement point is
`ImportDialog.tsx`'s inline new-account form: `isStep1Complete()` (or
whatever downstream disabled-check consumes it — confirm current call site,
it's the Step 1 "Continue" gate, not the Step 2 "Import" button) must treat
an empty institution the same way it already treats empty name/number for the
`accountMode === 'new'` branch. Existing accounts sitting at `''` never get
retroactively gated anywhere in the app.

**One shared component, not two copies.** Build `InstitutionSelect.tsx` once
and use it identically from both `Settings.tsx` and `ImportDialog.tsx`, so
the seeded-list-∪-in-use-values computation and the "Add \"X\"" typeahead
logic live in exactly one place. Don't inline a second combobox in
`ImportDialog.tsx`.

**Out of scope, do not add:** institution filtering/grouping on
Positions/Transactions tables or in `selectors.ts`; any change to
`AssetClassOverrideSelect.tsx`; any new reducer action type or `AppState`
field.

## Tasks

### 1. `types.ts`: add `institution` field [depends on: nothing]
- In `Account` (lines 6-13), insert `institution: string` between `name` and
  `taxCategory`.
- No other type in `types.ts` changes.

### 2. `persist.ts`: migrate missing `institution` on load [depends on: 1]
- In `loadPersistedApp`'s `migrated.accounts` assignment (currently
  `loaded.accounts ?? defaults.accounts`), map over `loaded.accounts` (when
  present) to fill `institution: a.institution ?? ''` per account, so an
  old-shaped blob without the key doesn't just pass through `undefined`.
  Keep the existing `?? defaults.accounts` fallback for a wholly-missing
  `accounts` array.
- Don't touch `savePersistedApp` — it writes whatever `AppState` shape it's
  given; no special-casing needed there.

### 3. `InstitutionSelect.tsx`: new shared component [depends on: 1]
- New file `src/components/InstitutionSelect.tsx`.
- Props: `{ value: string, accounts: Account[], onChange: (value: string) => void }`.
- Seeded list constant: `['Fidelity', 'Charles Schwab', 'Vanguard', 'E*TRADE',
  'Robinhood', 'Merrill Lynch', 'Chase', 'Bank of America', 'Wells Fargo',
  'Other']`.
- Computed options = seeded list ∪ `accounts.map(a => a.institution).filter(Boolean)`,
  deduplicated, sorted in a stable, sensible order (e.g. seeded list first in
  seeded order, then any in-use-but-not-seeded values appended, alphabetized).
- Always-visible input: reuse the interaction shape from
  `AssetClassOverrideSelect.tsx` for filtering/typing behavior (read that
  file for the pattern) but render it as an always-on inline control (not
  behind a reveal button) using existing `.input`/`.field` class vocabulary
  per `CLAUDE.md`'s styling rule — no new CSS.
- When the typed value doesn't match any existing option (case-insensitive
  compare), show an "Add \"{typed value}\"" affordance; selecting/confirming
  it calls `onChange(typedValue)` same as picking an existing option.
- Empty `value` renders a placeholder state ("— Select —"), no error styling.
- Every selection/confirmation calls `onChange(value)` — the component holds
  no state of its own about "known institutions"; it's a pure derived-options
  control over the `accounts` prop passed in.

### 4. `Settings.tsx`: Institution column in Accounts table [depends on: 3]
- In `AccountRow` (~line 277 onward), add an "Institution" `<td>` between the
  Name cell and the Tax Category `<select>` cell.
- Render `<InstitutionSelect value={account.institution} accounts={accounts}
  onChange={...} />` (pass the full accounts list already available in
  `Settings.tsx`'s parent scope — confirm exact prop name/plumbing into
  `AccountRow`, it may need a new prop since `AccountRow` currently likely
  only receives the single `account`).
- `onChange` handler mirrors `handleTaxCategoryChange`: dispatch
  `{ type: 'UPDATE_ACCOUNT', accountId: account.id, patch: { institution: value } }`.
- Add the "Institution" `<th>` to the table header row, in position between
  Name and Tax Category.

### 5. `ImportDialog.tsx`: institution on new-account form [depends on: 3]
- Add `institution: string` to `NewAccountFields` (~line 21-25), default
  `''` in both the initial `useState` (~line 76) and `handleCloseDialog`'s
  reset block (~line 107-111).
- In the new-account form JSX (~line 610-680), add
  `<InstitutionSelect value={newAccountFields.institution} accounts={state.accounts}
  onChange={(v) => setNewAccountFields({ ...newAccountFields, institution: v })} />`
  alongside the existing name/number/category/retirement fields (adjust the
  grid layout as needed — current grid is `2fr 1fr 1fr` for name/number/
  category with retirement checkbox below; fit institution in sensibly, e.g.
  widen the grid to 4 columns or add a second row).
- Update `isStep1Complete()`'s `accountResolved` expression (~line 200-204):
  for `accountMode === 'new'`, also require
  `newAccountFields.institution.trim() !== ''`.
- In the `newAccount` construction (~line 320-326), add
  `institution: newAccountFields.institution`.

### 6. Reference docs [depends on: 1-5]
- `schema-spec.md`: add `institution` row to the `## Account` table
  (`string`, note: "User-selected via seeded list or free-typed; empty
  string means unfilled; required only for accounts created via the import
  dialog's new-account form").
- `product-behavior.md`: update the Settings page Accounts row description
  (currently lists account number/name/tax category/retirement/delete) to
  include the Institution combobox and its placement; update the Step 1
  new-account form description (currently name/number/category/retirement)
  to include institution and note it's required for the Continue gate.
- `design.md`: add `InstitutionSelect.tsx` to the `components/` listing in
  the directory-structure/component-tree section, with a one-line prop
  summary matching the `AssetClassOverrideSelect` entry's style.
- Full read-through of all three docs after edits (CLAUDE.md's
  full-file-review rule) — check no other section still describes the old
  Account field list or old new-account-form field list.

### 7. Tests [depends on: 1-6]
- `src/lib/types.ts`: no dedicated test file conventionally exists for pure
  type declarations — skip unless a `types.test.ts` already exists (check
  first); if so, extend any Account round-trip fixture there.
- `persist.ts` migration test (in `persist.test.ts` — note this file is
  already broadly stale per the Files-in-play note above; add a *new*,
  correctly-typed test rather than trying to fix the existing ones): persist
  a raw object shaped like a pre-institution `Account` (no `institution` key)
  directly into the fake IndexedDB store, call `loadPersistedApp()`, assert
  it resolves without throwing and the loaded account has `institution: ''`.
- `Settings.test.tsx`: test that the Institution combobox renders per row,
  selecting a seeded option dispatches `UPDATE_ACCOUNT` with
  `patch: { institution: value }`, and typing+confirming a new value works
  and dispatches the typed value.
- `ImportDialog.test.tsx`:
  - New-account form renders the Institution combobox.
  - Continue (Step 1) stays disabled when institution is unset even with
    name+number filled, for `accountMode === 'new'`.
  - Continue enables once institution is set alongside name+number.
  - The account object passed to `ADD_ACCOUNT` includes the selected
    `institution` value.
  - `handleCloseDialog` reset clears institution back to `''` (reopen dialog
    shows placeholder state again).
- Run `npm run test` (must be fully green) and `npm run build` (typecheck +
  build, must pass) before considering this task done.

## Acceptance Criteria

- [ ] `Account` has `institution: string`, always present, positioned after
      `name` before `taxCategory` in `types.ts`.
- [ ] `persist.ts` defaults missing `institution` to `''` on load; a test
      proves an old-shaped blob loads without throwing.
- [ ] `state.ts`/`reducer.ts` unchanged — `updateAccount`/`addAccount`
      already handle the new field generically.
- [ ] New shared `InstitutionSelect.tsx`: seeded list ∪ in-use values,
      free-type "Add \"X\"" affordance, always-visible (no click-to-reveal),
      no red/warning styling on empty.
- [ ] Settings Accounts table has an Institution column between Name and Tax
      Category, using `InstitutionSelect`, dispatching `UPDATE_ACCOUNT`.
- [ ] Import dialog's new-account form includes `InstitutionSelect`; Step 1
      Continue is disabled for new accounts until institution is set;
      created account object includes the chosen institution; dialog reset
      clears it.
- [ ] No new `AppState` field, action type, reducer case, or IndexedDB schema
      version bump.
- [ ] `AssetClassOverrideSelect.tsx` untouched.
- [ ] Positions/Transactions tables and `selectors.ts` untouched — no
      institution filtering/grouping added.
- [ ] `schema-spec.md`, `product-behavior.md`, `design.md` updated and
      reviewed full-file for staleness.
- [ ] `npm run test` and `npm run build` both green.
- [ ] Commit made only after tests pass and docs are current.
