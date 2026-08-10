# Import Dialog Step 1: v5 Redesign (Account Dropdown + Save, Institution Inline-Add, Retirement Select, Two-Column Grid)

Replace Step 1 ("Setup") of the CSV Import dialog to match
`design/v5/project/Portfolio Dashboard.dc.html` (markup ~lines 139-247, render
logic ~lines 1068-1226) pixel/text-exact, except the deviations locked below.
Step 2 ("Review") does NOT change — zero edits to that block. Nothing else in
the app changes.

No `plans/_template.md` exists in this repo (checked). This plan follows
`plans/import-dialog-two-column-layout.md` and `plans/import-step2-profile-flow.md`'s
structure: short overview, locked decisions, small (≤30min) ordered tasks with
deps, acceptance criteria per task.

## Decisions locked (from requirements interview — do not re-litigate)

1. **Account select replaces existing/new radio toggle.** One `<select>`
   "Account" listing every `state.accounts` entry + trailing sentinel option
   `__new__` labeled `"+ Add new account…"`. Selecting anything (existing id
   or `__new__`) always renders the same editable fields below (Institution,
   Account name, Account number, Category, Retirement) — pre-filled from that
   account's current stored values, or blanked/defaulted
   (`category: 'taxable'`, `retirement: 'nonRetirement'`, `institution: ''`)
   for `__new__`. Mirrors design's `onImportAccountKeyChange`
   (`Portfolio Dashboard.dc.html:1141-1149`).
   - Option label format (design line 1074, NOT today's app's longer format):
     `name + (accountNumber ? " • #" + accountNumber : "") + (institution ? " — " + institution : "")`.
2. **New "Save" feature.** When an existing account is selected (not
   `__new__`), show a "Save" button bottom-left of `.dialog-actions`
   (`margin-right: auto`, `.btn.btn-secondary.blueprint` + 4 corner marks).
   Disabled unless any editable field (institution / name / number / category
   / retirement) differs from the selected account's current stored values —
   port the exact diff formula at
   `Portfolio Dashboard.dc.html:1153-1159`. Click dispatches `UPDATE_ACCOUNT`
   with a patch of ONLY the changed fields. Label toggles "Save" → "Saved"
   after a successful save; resets back to "Save" when the user edits any
   field again OR changes the account-select value (see Task 4 for exact
   reset wiring). This action is fully independent of Continue/Import — no
   step change, no import-state mutation.
3. **Institution field becomes a plain `<select>` + inline-add**, replacing
   `InstitutionSelect` (typeahead) IN THIS DIALOG ONLY. Grep confirmed
   `InstitutionSelect` is also used by `src/components/Settings.tsx` — it is
   NOT deleted, just no longer imported/rendered by `ImportDialog.tsx`.
   - Normal state: `<select>` of options + trailing sentinel
     `"+ Add new institution…"` (`value="__add_new__"`).
   - Choosing the sentinel swaps the `<select>` for a text `<input>` +
     "Add"/"Cancel" `.btn.btn-primary.blueprint`/`.btn.btn-secondary.blueprint`
     buttons (4 corner marks each) — port
     `Portfolio Dashboard.dc.html:154-172`. Add disabled until the trimmed
     input is non-empty. Confirming appends the trimmed name to persisted
     `customInstitutions` (if not already present) and selects it, closing
     the inline-add UI. Cancel reverts to the `<select>` with no state change.
   - Seed list (overrides design's own 13-item list — resolved requirement):
     exactly `['Fidelity', 'Charles Schwab', 'Vanguard']`.
   - Options = seed list ∪ persisted `customInstitutions` ∪ institutions
     already in use by any `state.accounts` entry, deduped, seed-list-first
     then the rest alphabetized (same ordering convention
     `InstitutionSelect.tsx:36-38` already uses).
   - Custom institutions PERSIST across sessions (deviation from the design
     mock, which is session-only in in-memory `st.customInstitutions` with no
     save): add `customInstitutions: string[]` to `AppState`
     (`src/lib/state.ts`), default `[]`, migration-tolerant load in
     `src/lib/persist.ts`'s `coalesceWithDefaults`, a reducer case
     `ADD_CUSTOM_INSTITUTION` + `addCustomInstitution` helper in `state.ts`.
     Persists automatically via `App.tsx`'s existing debounce-save (no new
     wiring needed there).
4. **Entry mode (Upload CSV / Enter manually) — KEEP CURRENT BEHAVIOR.** Only
   rendered when `dataType === 'positions'`. Transactions stays forced to CSV
   upload. Do NOT match the design's unconditional rendering — explicitly
   vetoed.
5. **Data type toggle (Transactions / Positions) order unchanged** — already
   matches design (Transactions first). Carry the two `seg-opt` radios over
   as-is into the new right column.
6. **Retirement field becomes a `<select>`** (`Retirement` / `Non-Retirement`,
   `Portfolio Dashboard.dc.html:193-199`) replacing the current checkbox.
   Local form state stores `'retirement' | 'nonRetirement'`; convert to/from
   `Account.retirement: boolean` only at the account-create/update boundary
   (`retirement === 'retirement'` ↔ `retirement ? 'retirement' : 'nonRetirement'`).
7. **Layout: two-column CSS grid**, `grid-template-columns: 1fr 1fr`,
   `gap: var(--space-6)`, matching design lines 141-246 exactly:
   - LEFT column: Account select → Institution field → a `1fr 1fr` sub-grid
     row (Account name, Account number) → a `1fr 1fr` sub-grid row (Category,
     Retirement).
   - RIGHT column: "What are you importing?" seg → "How will you add the
     data?" seg (positions-only per #4) → CSV dropzone (or manual-entry hint
     text, positions-manual mode only).
   - REMOVE the current vertical divider `<div data-testid="import-step1-divider">`
     entirely — not present in the design markup.
8. **Blueprint/corner-mark button consistency.** The Continue button
   currently lacks the `blueprint` class and 4 corner `<i>` marks that every
   other dialog button in this app has (Back, Done, Import, etc.) — add them.
   Apply the same treatment (`.btn.blueprint` + 4 `<i class="corner ...">`)
   to the new Save button and the new institution Add/Cancel buttons, so
   every button rendered by Step 1 after this change is visually consistent
   with the rest of the app. (No button is renamed by this plan — labels stay
   "Continue" / "Save" / "Saved" / "Add" / "Cancel" exactly as specified in
   decisions #1-#3 above; this task only affects class names and corner
   markup, not text.)
9. **CSV dropzone matches design exactly.** Label is just the filename or
   "No file selected" + "Drag and drop, or click to browse" hint. DROP the
   current extra `Selected: **filename** (N rows)` line — not in design
   markup.
10. **Continue validity — port design's `step1Valid` formula**
    (`Portfolio Dashboard.dc.html:1106-1107`):
    ```
    (isManualEntry || headers.length > 0) &&
      (isExistingAccountSelected ? !!accountKey : (name.trim() && number.trim()))
    ```
    Note this drops today's app's extra requirement that new-account mode's
    `institution` be non-empty — the design formula does not check
    institution for Continue-gating (only Save-gating cares about diffs).
    Institution keeps its own default (`''` for `__new__`) but does not block
    Continue.
11. **Everything else stays exactly as-is**: Step 2 (Review) entirely,
    dialog open/close button, dialog width/backdrop/corner marks, step
    indicator pills, close-✕ button, `handleImport`/`ADD_ACCOUNT`/
    `IMPORT_POSITIONS`/`IMPORT_TRANSACTIONS`/`UPSERT_CSV_MAPPING` dispatch
    logic (adapted only to read from the new state shape — no behavior
    change), CSV parsing, `isReviewValid`, row validation, manual-entry row
    seeding.
12. **Rename the closed-state trigger button.** The button rendered when the
    dialog is closed (`ImportDialog.tsx`'s early-return branch,
    `!isOpen`) currently reads "Import" next to the up-arrow icon. Change its
    visible text to "Accounts & Import". Pure copy change — same icon, same
    classes/corner marks, same `onClick={handleOpenDialog}`, no behavior
    change. Nothing else is renamed: the dialog's own title stays "Import",
    the "Import" primary-action button in Step 2 stays "Import", step labels
    stay "Setup"/"Review".

## What we do NOT change

- Step 2 (Review) JSX, state, or handlers — byte-identical.
- `src/styles/styles.css` (stays byte-identical per CLAUDE.md).
- `src/components/InstitutionSelect.tsx` and its use in `Settings.tsx`.
- `src/lib/mappingProfiles.ts`, `src/lib/positionsImport.ts`,
  `src/lib/transactionsImport.ts`, `src/lib/importPreview.ts`.
- Dialog outer chrome (backdrop, `.dialog.blueprint` sizing, header, step
  indicator, corner marks on the dialog itself).

## Source-of-truth references

- Current Step 1: `src/components/import/ImportDialog.tsx:74-90` (state),
  `:202-242` (`isStep1Complete`, `handleContinue`), `:542-802` (JSX).
- Design markup: `design/v5/project/Portfolio Dashboard.dc.html:139-247`.
- Design render logic: `Portfolio Dashboard.dc.html:1049-1227`
  (`renderImportVals`) — esp. `onImportAccountKeyChange` (1141-1149),
  `showSaveAccount`/`saveAccountLabel`/`saveAccountDisabled` (1150-1159),
  institution inline-add (1168-1187), `step1Valid` (1106-1107).
- `src/lib/state.ts`: `AppState` interface (13-22), `initialState()` (47-72),
  `updateAccount` (77-88, already exists, reusable as-is for Save).
- `src/lib/reducer.ts`: `UPDATE_ACCOUNT` case (24-25, already exists).
- `src/lib/persist.ts`: `coalesceWithDefaults` (39-70) — migration-tolerant
  field list to extend.
- `src/lib/types.ts`: `Account` (5-13), `TaxCategory` (1).
- `src/components/InstitutionSelect.tsx`: seed list + ordering convention
  (`SEEDED_INSTITUTIONS` 9-20, dedup/sort 36-38) — used only as a reference
  pattern, not imported.
- Other `InstitutionSelect` callers (confirmed via grep):
  `src/components/Settings.tsx`, `src/components/import/ImportDialog.test.tsx`
  (test-only) — leave both untouched except the test file gets rewritten for
  Step 1 anyway.
- Docs to update: `product-behavior.md:58-81` ("CSV import" section, Step 1
  bullets), `design.md:89` (helper-fn list — add `addCustomInstitution`),
  `design.md:113-129` (component/data-flow description of Step 1),
  `schema-spec.md:165` ("AppState UI/filter fields" section — add
  `customInstitutions`, noting it's persisted user data, not a UI filter, so
  place it under whichever section schema-spec.md's author intends for
  small persisted lists — inspect the file's actual section headers before
  editing, don't assume).

## Tasks

### Task 0: Create git worktree for isolated work [depends on: nothing]

**Files**: none — repo/worktree setup only.

1. From the main working copy: `git worktree add ../worktree-import-dialog-v5-step1 -b import-dialog-v5-step1/setup-redesign`
2. `cd ../worktree-import-dialog-v5-step1` and do all of Tasks 1-10 there.

**Acceptance**: `git worktree list` shows the new worktree; `git status` in it
is clean and on the new branch.

---

### Task 1: Add `customInstitutions` to `AppState` [depends on: Task 0]

**Files**: `src/lib/state.ts`, `src/lib/reducer.ts`, `src/lib/persist.ts`

1. `state.ts`: add `customInstitutions: string[]` to the `AppState` interface
   (near `csvMappings`, since it's persisted data, not a UI filter). Default
   `[]` in `initialState()`.
2. `state.ts`: add helper
   ```ts
   export function addCustomInstitution(state: AppState, name: string): AppState {
     const trimmed = name.trim()
     if (!trimmed || state.customInstitutions.includes(trimmed)) return state
     return { ...state, customInstitutions: [...state.customInstitutions, trimmed] }
   }
   ```
   (Dedup guard here too, belt-and-suspenders with the dialog's own check.)
3. `reducer.ts`: add case
   ```ts
   case 'ADD_CUSTOM_INSTITUTION':
     return StateActions.addCustomInstitution(state, action.name)
   ```
4. `persist.ts`: in `coalesceWithDefaults`, add
   `customInstitutions: loaded.customInstitutions ?? defaults.customInstitutions,`
   next to `csvMappings`.

**Test cases** (new `describe` block or additions to existing files):
- `src/lib/state.test.ts` (or wherever `addAccount`-style helpers are
  tested): `addCustomInstitution` appends a trimmed name; no-op on duplicate
  (case-sensitive exact match, matching design's `includes` check); no-op on
  blank/whitespace-only input.
- `src/lib/persist.test.ts`: round-trip a state with `customInstitutions`
  through save/load; loading a blob missing the key defaults to `[]`
  (migration tolerance).
- `src/lib/reducer.test.ts` (if it exists — check) or inline: dispatching
  `ADD_CUSTOM_INSTITUTION` updates state as expected.

**Acceptance**: `npm run test` green for these three files; `tsc -b` has no
new errors from the interface change (check other `AppState` literal
constructions, e.g. test fixtures/mock states, for missing-field TS errors —
grep `initialState()`-shaped object literals in tests first).

---

### Task 2: Grep-confirm `InstitutionSelect` blast radius (already done in planning, re-verify at implementation time) [depends on: Task 0]

**Files**: none changed — verification only.

1. Run `grep -rn "InstitutionSelect" src` — confirm the only non-test
   consumers are `ImportDialog.tsx` (being changed) and `Settings.tsx`
   (must NOT be touched).
2. Confirm `InstitutionSelect.tsx` itself is not deleted — it stays as a
   live component for `Settings.tsx`.

**Acceptance**: grep output matches the above; no plan changes needed if so.
If a third consumer turns up, stop and re-scope before Task 5.

---

### Task 3: Redesign Step 1 local state shape [depends on: Task 1]

**File**: `src/components/import/ImportDialog.tsx`

Replace:
```ts
const [accountMode, setAccountMode] = useState<'existing' | 'new'>('existing')
const [selectedAccountId, setSelectedAccountId] = useState<string>('')
const [newAccountFields, setNewAccountFields] = useState<NewAccountFields>({...})
```
with:
```ts
const [importAccountKey, setImportAccountKey] = useState<string>('') // '' | account.id | '__new__'
const [formInstitution, setFormInstitution] = useState<string>('')
const [formName, setFormName] = useState<string>('')
const [formNumber, setFormNumber] = useState<string>('')
const [formCategory, setFormCategory] = useState<TaxCategory>('taxable')
const [formRetirement, setFormRetirement] = useState<'retirement' | 'nonRetirement'>('nonRetirement')
const [isAddingInstitution, setIsAddingInstitution] = useState(false)
const [newInstitutionName, setNewInstitutionName] = useState('')
const [importSaved, setImportSaved] = useState(false)
```
(Field names illustrative — implementer may rename, but keep the
`formX` grouping distinct from `import*` step-2 state so it's obvious at a
glance which step a variable belongs to.)

Delete the `NewAccountFields` interface (no longer used) and its import of
`InstitutionSelect`.

Add an `onImportAccountKeyChange(key: string)` handler mirroring design
1141-1149:
```ts
const handleAccountKeyChange = useCallback((key: string) => {
  setImportAccountKey(key)
  setImportSaved(false)
  if (key === '__new__') {
    setFormInstitution('')
    setFormName('')
    setFormNumber('')
    setFormCategory('taxable')
    setFormRetirement('nonRetirement')
  } else {
    const a = state.accounts.find((acc) => acc.id === key)
    if (!a) return
    setFormInstitution(a.institution || '')
    setFormName(a.name)
    setFormNumber(a.accountNumber || '')
    setFormCategory(a.taxCategory)
    setFormRetirement(a.retirement ? 'retirement' : 'nonRetirement')
  }
}, [state.accounts])
```

Update `handleCloseDialog` to reset all the new state variables (mirror what
it currently resets for the old ones) instead of the deleted ones.

**Test cases** (rewritten in Task 8, listed here for traceability):
- Selecting an existing account in the dropdown pre-fills all 5 form fields
  from that account's current stored values.
- Selecting `__new__` blanks name/number/institution and resets
  category/retirement to defaults.
- Switching accounts resets `importSaved` back to false (label reverts to
  "Save" — verified fully once Task 4 exists, but the state reset itself is
  testable here).

**Acceptance**: file still compiles with old JSX temporarily referencing
now-removed variables — this task is state-only, so expect the JSX (still
referencing `accountMode`/`selectedAccountId`/`newAccountFields`) to fail
`tsc` until Task 6 rewrites it. That's fine — do Tasks 3-6 as one edit pass
if the implementer prefers atomic compilable commits; otherwise land Task 3
and Task 6 together as a single commit. Do not commit code that fails
`tsc -b` (CLAUDE.md gate on commit).

---

### Task 4: Save button — diff logic + `UPDATE_ACCOUNT` dispatch [depends on: Task 3]

**File**: `src/components/import/ImportDialog.tsx`

1. Compute (inline in render, not memoized — matches the file's existing
   style of recomputing derived values per render):
   ```ts
   const selectedAccount = importAccountKey !== '__new__'
     ? state.accounts.find((a) => a.id === importAccountKey)
     : undefined
   const isExistingAccountSelected = importAccountKey !== '' && importAccountKey !== '__new__'
   const saveDisabled =
     !isExistingAccountSelected || !selectedAccount || (
       formInstitution === (selectedAccount.institution || '') &&
       formName.trim() === selectedAccount.name &&
       formNumber.trim() === (selectedAccount.accountNumber || '') &&
       formCategory === selectedAccount.taxCategory &&
       formRetirement === (selectedAccount.retirement ? 'retirement' : 'nonRetirement')
     )
   ```
   (Ports design 1153-1159; `.trim()` on name/number since the design's own
   account name/number fields aren't pre-trimmed elsewhere in this codebase's
   pattern — match `newAccountFields.name.trim()` precedent from the current
   `isStep1Complete`.)
2. Handler:
   ```ts
   const handleSaveAccountChanges = useCallback(() => {
     if (!selectedAccount) return
     const patch: Partial<Account> = {}
     if (formInstitution !== (selectedAccount.institution || '')) patch.institution = formInstitution
     if (formName.trim() !== selectedAccount.name) patch.name = formName.trim()
     if (formNumber.trim() !== (selectedAccount.accountNumber || '')) patch.accountNumber = formNumber.trim()
     if (formCategory !== selectedAccount.taxCategory) patch.taxCategory = formCategory
     const retirementBool = formRetirement === 'retirement'
     if (retirementBool !== selectedAccount.retirement) patch.retirement = retirementBool
     if (Object.keys(patch).length === 0) return
     dispatch({ type: 'UPDATE_ACCOUNT', accountId: selectedAccount.id, patch })
     setImportSaved(true)
   }, [selectedAccount, formInstitution, formName, formNumber, formCategory, formRetirement, dispatch])
   ```
3. **"Saved" reset point (resolved)**: reset `importSaved` to `false` in
   every `formX` setter's onChange handler (institution select/add, name,
   number, category, retirement) AND in `handleAccountKeyChange` (already
   covered in Task 3). Simplest correct implementation: wrap each field's
   `onChange` to also call `setImportSaved(false)` before/after setting the
   field — or centralize via one `updateFormField` helper that both sets the
   field and clears `importSaved`. Prefer the centralized helper to avoid
   repeating `setImportSaved(false)` five times.
4. Render the button in `.dialog-actions` for Step 1, conditionally
   (`isExistingAccountSelected`), styled `margin-right: auto`, positioned
   BEFORE the Continue button in DOM order (so Continue stays right-aligned
   per existing flex layout — verify `.dialog-actions` CSS is `display:flex`
   in `styles.css` before assuming `margin-right: auto` pushes correctly;
   if `.dialog-actions` is not flex, this won't visually left-align — check
   and flag if so, do not silently change `.dialog-actions` CSS since
   `styles.css` must stay byte-identical).

**Test cases**:
- Save button absent when `importAccountKey === '__new__'` or `''`.
- Save button present + disabled when an existing account is selected and no
  field has been edited.
- Editing any one of the 5 fields enables Save.
- Reverting the edit back to the original value re-disables Save (exact
  equality, not just "touched").
- Clicking Save dispatches `UPDATE_ACCOUNT` with `accountId` = selected
  account's id and a patch containing ONLY the changed field(s).
- Clicking Save flips the label to "Saved"; editing any field afterward (or
  switching the account dropdown) flips it back to "Save".
- Save does not change `step`, does not touch any import/CSV state.

**Acceptance**: all above pass; `saveDisabled` formula matches design
1153-1159 field-for-field.

---

### Task 5: Institution `<select>` + inline-add [depends on: Task 3]

**File**: `src/components/import/ImportDialog.tsx`

1. Remove `import { InstitutionSelect } from '../InstitutionSelect'`.
2. Compute institution options per render:
   ```ts
   const SEED_INSTITUTIONS = ['Fidelity', 'Charles Schwab', 'Vanguard']
   const inUseInstitutions = Array.from(
     new Set(state.accounts.map((a) => a.institution || '').filter((i) => i !== ''))
   )
   const seedSet = new Set(SEED_INSTITUTIONS)
   const extraInstitutions = Array.from(new Set([...state.customInstitutions, ...inUseInstitutions]))
     .filter((i) => !seedSet.has(i))
     .sort()
   const institutionOptions = [...SEED_INSTITUTIONS, ...extraInstitutions]
   ```
   (Module-level `const SEED_INSTITUTIONS` is fine too — hoist out of the
   component if preferred, no dependency on props/state.)
3. Render:
   ```tsx
   {isAddingInstitution ? (
     <div style={{ display: 'flex', gap: '6px' }}>
       <input
         className="input"
         placeholder="e.g. Ally Invest"
         value={newInstitutionName}
         onChange={(e) => setNewInstitutionName(e.target.value)}
       />
       <button
         type="button"
         className="btn btn-primary blueprint"
         disabled={!newInstitutionName.trim()}
         onClick={() => {
           const name = newInstitutionName.trim()
           if (!name) return
           if (!state.customInstitutions.includes(name)) {
             dispatch({ type: 'ADD_CUSTOM_INSTITUTION', name })
           }
           setFormInstitution(name)
           setImportSaved(false)
           setIsAddingInstitution(false)
           setNewInstitutionName('')
         }}
       >
         <i className="corner tl"></i><i className="corner tr"></i>
         <i className="corner bl"></i><i className="corner br"></i>
         Add
       </button>
       <button
         type="button"
         className="btn btn-secondary blueprint"
         onClick={() => { setIsAddingInstitution(false); setNewInstitutionName('') }}
       >
         <i className="corner tl"></i><i className="corner tr"></i>
         <i className="corner bl"></i><i className="corner br"></i>
         Cancel
       </button>
     </div>
   ) : (
     <select
       className="input"
       value={formInstitution}
       onChange={(e) => {
         if (e.target.value === '__add_new__') {
           setIsAddingInstitution(true)
           setNewInstitutionName('')
           return
         }
         setFormInstitution(e.target.value)
         setImportSaved(false)
       }}
     >
       {/* if formInstitution isn't in institutionOptions (e.g. blank for __new__), still needs a matching option or the select silently falls back — add a blank leading option when formInstitution === '' */}
       {formInstitution === '' && <option value="">-- Select --</option>}
       {institutionOptions.map((i) => <option key={i} value={i}>{i}</option>)}
       <option value="__add_new__">+ Add new institution…</option>
     </select>
   )}
   ```
   Note the blank-leading-option addition is NOT in the design markup (design
   always has a real institution pre-selected via `DEFAULT_INSTITUTIONS[0]`
   default) — needed here because this app's `__new__` default is `''`, not
   a real institution name (matches this app's existing new-account-defaults
   convention, e.g. `newAccountFields.institution: ''` today). Flag this as a
   deliberate, small, justified deviation from the design's exact select
   population, not an oversight.

**Test cases**:
- Institution select lists exactly seed (3) + accounts-in-use + persisted
  customInstitutions, deduped, seed order preserved, rest alphabetized.
- Choosing `__add_new__` swaps to the input+Add+Cancel UI.
- Add disabled until non-empty trimmed input; confirming dispatches
  `ADD_CUSTOM_INSTITUTION`, selects the new name, reverts to `<select>`.
- Adding a name that already exists in `customInstitutions` does NOT
  re-dispatch (no duplicate action) but still selects it.
- Cancel reverts to `<select>` with `formInstitution` unchanged from before
  the inline-add was opened.
- `persist.test.ts`: a custom institution added via this flow round-trips
  through save/load (covered by Task 1's persistence test, cross-referenced
  here for the full flow).

**Acceptance**: all above pass.

---

### Task 6: Retirement `<select>`, layout grid rewrite, dropzone text, Continue button corners [depends on: Task 3, Task 4, Task 5]

**File**: `src/components/import/ImportDialog.tsx`

This is the JSX restructure task — do it once Tasks 3-5's supporting state/
handlers exist, since the JSX wires directly into them.

1. Replace the retirement checkbox with:
   ```tsx
   <div className="field">
     <label>Retirement</label>
     <select
       className="input"
       value={formRetirement}
       onChange={(e) => { setFormRetirement(e.target.value as 'retirement' | 'nonRetirement'); setImportSaved(false) }}
     >
       <option value="retirement">Retirement</option>
       <option value="nonRetirement">Non-Retirement</option>
     </select>
   </div>
   ```
2. Rewrite the Step 1 wrapper from the current flex-row + divider structure
   to:
   ```tsx
   <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-6)', alignItems: 'start' }}>
     <div>
       {/* Account select */}
       <div className="field">
         <label>Account</label>
         <select className="input" value={importAccountKey} onChange={(e) => handleAccountKeyChange(e.target.value)}>
           <option value="">-- Select an account --</option>
           {state.accounts.map((a) => (
             <option key={a.id} value={a.id}>
               {a.name}{a.accountNumber ? ` • #${a.accountNumber}` : ''}{a.institution ? ` — ${a.institution}` : ''}
             </option>
           ))}
           <option value="__new__">+ Add new account…</option>
         </select>
       </div>
       {/* Institution field (Task 5's block) */}
       <div className="field">
         <label>Institution</label>
         {/* ... */}
       </div>
       <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
         <div className="field"><label>Account name</label><input className="input" value={formName} onChange={...} placeholder="e.g. Fidelity Rollover IRA" /></div>
         <div className="field"><label>Account number</label><input className="input" value={formNumber} onChange={...} placeholder="e.g. 8842-1190" /></div>
       </div>
       <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
         <div className="field"><label>Category</label><select ...>{/* Taxable/Non-Taxable/Tax-Deferred */}</select></div>
         <div className="field">{/* Retirement select from step 1 above */}</div>
       </div>
     </div>
     <div>
       {/* data-type seg (unchanged radios) */}
       {/* positions-only entry-mode seg (unchanged, gated) */}
       {/* CSV dropzone (upload mode) OR manual-entry hint text (manual mode) */}
     </div>
   </div>
   ```
   No divider `<div>` anywhere. Remove `data-testid="import-step1-divider"`
   entirely (grep the test file for this testid — Task 8 must also remove
   any test asserting its presence).
3. Add the manual-entry hint text (currently absent from the app — design
   line 242-244): when `dataType === 'positions' && entryMode === 'manual'`,
   render `<div className="text-muted" style={{ fontSize: '12px' }}>You'll enter each row's data directly on the next screen.</div>`
   in place of the dropzone. (Check current behavior first — grep for
   whether this hint already exists somewhere in the current Step 1 JSX
   before adding a duplicate; the read of the file during planning did not
   show one, so this is additive.)
4. Dropzone: delete the
   `{file && (<div>Selected: <strong>{file.name}</strong> ({csvRows.length} rows)</div>)}`
   block. Label stays `{file ? file.name : 'No file selected'}`.
5. Continue button: add `blueprint` class + 4 corner `<i>` marks:
   ```tsx
   <button className="btn btn-primary blueprint" onClick={handleContinue} disabled={!isStep1Complete()}>
     <i className="corner tl"></i><i className="corner tr"></i>
     <i className="corner bl"></i><i className="corner br"></i>
     Continue
   </button>
   ```
6. Update `isStep1Complete`/`step1Valid` per decision #10 (Task 7 covers the
   validity-formula port specifically, but wire the JSX's `disabled` prop to
   whatever that task produces — sequence Task 6 and Task 7 together if
   easier, they touch adjacent code).

**Test cases** (see Task 8 for the full rewrite list — spot checks here):
- Step 1 renders a single CSS grid with exactly two direct children
  (left/right column divs) — no divider element, no `data-testid="import-step1-divider"` anywhere in the DOM.
- Manual-entry hint text renders only for positions+manual; absent otherwise.
- Dropzone shows no "Selected: ... rows" line after a file is picked.
- Continue button has class `btn btn-primary blueprint` and 4 `.corner` `<i>` children.

**Acceptance**: `npm run build` (tsc) passes; visual smoke check in
`npm run dev` shows two even columns matching the design screenshot/markup
proportions (manual check, not automated).

---

### Task 7: Port `step1Valid` and adapt `handleContinue`/`handleImport` to the new state shape [depends on: Task 3]

**File**: `src/components/import/ImportDialog.tsx`

1. Replace `isStep1Complete()` body with the ported formula (decision #10):
   ```ts
   const isStep1Complete = (): boolean => {
     const isExisting = importAccountKey !== '' && importAccountKey !== '__new__'
     const accountResolved = isExisting ? true : (formName.trim() !== '' && formNumber.trim() !== '')
     const fileSelected = entryMode === 'manual' || (file !== null && csvRows.length > 0)
     return accountResolved && fileSelected
   }
   ```
   Note: `isExisting` here is `!!importAccountKey && importAccountKey !== '__new__'` —
   matches design's `!!st.importAccountKey` where `''` is falsy, so an
   unselected account (`importAccountKey === ''`) correctly fails
   `accountResolved` via the `false` branch's name/number check (both blank)
   — verify this edge case explicitly in a test (empty selection state must
   NOT be treated as new-account-valid just because name/number are also
   blank... actually with `importAccountKey === ''`, `isExisting` is false,
   so it falls to the new-account branch, which requires name+number
   non-empty — correctly still disables Continue since nothing was typed).
2. Update `handleContinue`'s saved-mapping-prefill branch: replace
   `accountMode === 'existing' && selectedAccountId` with
   `importAccountKey !== '' && importAccountKey !== '__new__'` and
   `selectedAccountId` → `importAccountKey`.
3. Update `handleImport`: replace `accountMode === 'new'` with
   `importAccountKey === '__new__'`, and `newAccountFields.{name,number,institution,category,retirement}`
   with `formName.trim()`, `formNumber.trim()`, `formInstitution`,
   `formCategory`, `formRetirement === 'retirement'`. Replace
   `selectedAccountId` (existing-mode accountId source) with
   `importAccountKey`.
4. Update `destinationAccount`/`accountLabel`/`categoryLabel` derivations
   (currently keyed off `accountMode`/`selectedAccountId`/`newAccountFields`)
   to the new state — used only in Step 2's "Importing into X · Y" line,
   which must render IDENTICAL output to today given equivalent inputs (Step
   2 itself is unchanged, only its inputs' variable names shift).

**Test cases**:
- All existing Step-2-dependent tests (destination label, ADD_ACCOUNT
  dispatch with correct patch shape including boolean `retirement`, existing-
  account dispatch with no ADD_ACCOUNT, saved-mapping prefill) must still
  pass unchanged in their assertions — only the Step-1 setup portion of each
  test's arrange phase changes (select from dropdown instead of radio + text
  fields).
- New: Continue disabled when `importAccountKey === ''` even if, by
  coincidence, `formName`/`formNumber` are non-empty (stale from a prior
  `__new__` selection not yet cleared) — regression guard for the edge case
  noted in step 1 above.
- New: Continue validity does NOT require `formInstitution` to be non-empty
  in `__new__` mode (decision #10's explicit drop of the old institution
  requirement) — add a test selecting `__new__`, filling only name+number,
  leaving institution blank, and asserting Continue is enabled once a file is
  also loaded.

**Acceptance**: full existing Step 2 test suite passes with only Step-1
arrange-phase edits; the two new tests pass.

---

### Task 8: Rewrite `ImportDialog.test.tsx` Step 1 tests; verify Step 2 tests untouched [depends on: Tasks 3-7]

**File**: `src/components/import/ImportDialog.test.tsx`

1. Inventory every test that currently interacts with Step 1 via the old
   radio-toggle + `InstitutionSelect` UI (grep for `accountMode`,
   `Destination account`, `New account`, `Existing account`,
   `Retirement Account`, `import-step1-divider`, and any
   `InstitutionSelect`-shaped interaction like typing into the institution
   text input). Based on the earlier read of this file, tests 3, 4, 5, 6, 7,
   14, 14b, 15, 17, 18, 26-30, 31-37 all touch Step 1 setup to reach Step 2 —
   audit each at implementation time; most only need their Step-1 "arrange"
   block updated (select account from dropdown vs. click radio + fill
   fields), with Step 2 assertions unchanged.
2. Rewrite each Step-1 arrange block to:
   - Select an account via `selectOptions(getByLabelText('Account') or the select, accountId)` instead of clicking "Existing account" radio + a second select.
   - For new-account flows: `selectOptions(..., '__new__')`, then fill
     `Account name`/`Account number` inputs, pick Category/Retirement
     `<select>`s (Retirement is now a select, not a checkbox — update
     `fireEvent.click(checkbox)` calls to `selectOptions`).
   - Institution: either leave blank (Continue doesn't require it now) or
     `selectOptions` a seed value directly (no more free-type).
3. Remove/replace any assertion on `data-testid="import-step1-divider"`.
4. Remove the "Selected: filename (N rows)" text assertion if any test
   checks it (grep `Selected:` in the test file).
5. Add new tests per the "Test cases" lists in Tasks 1, 4, 5, 6, 7 above
   (consolidate — don't duplicate across files, write each once here except
   Task 1's which live in `state.test.ts`/`persist.test.ts`).
6. Verify Step 2 tests (mapping grid, row edits, delete, import dispatch,
   completion state, back-preserves-state) pass with NO changes beyond their
   Step-1 arrange blocks — if any Step-2 assertion itself needs to change,
   stop and flag it (that would mean Step 2 was accidentally touched,
   violating decision #11).

**Acceptance**: `npm run test` fully green; test count roughly stable (some
net-new for Save/institution-add/account-dropdown, some removed for deleted
old-UI paths); no test references `InstitutionSelect`'s old typeahead
behavior in `ImportDialog.test.tsx` context (Settings.tsx's own tests, if
any, are untouched — separate file).

---

### Task 9: Rename closed-state trigger button to "Accounts & Import" [depends on: Task 0]

**File**: `src/components/import/ImportDialog.tsx`

1. In the `!isOpen` early-return branch (renders the button that opens the
   dialog), change the visible text node from `Import` to `Accounts & Import`.
   Leave the icon, `className="btn btn-secondary blueprint"`, corner marks,
   and `onClick={handleOpenDialog}` untouched.
2. Do NOT rename anything else: dialog title ("Import"), Step 2's primary
   button ("Import"/"Done"), step-indicator labels ("Setup"/"Review") all
   stay exactly as they are.

**Test cases**:
- `ImportDialog.test.tsx`: update the existing "renders Import button"/
  `getByText('Import')`-style query (grep the test file for the literal
  string `'Import'` used to find the closed-state trigger — likely an
  `aria-label="Import"` or button text query) to `'Accounts & Import'`. Any
  test that opens the dialog via `getByRole('button', { name: /import/i })`
  should still match (regex is case-insensitive substring-safe), but a test
  asserting an exact `'Import'` name will need updating to
  `'Accounts & Import'`. Verify the dialog's own title and Step 2's primary
  button text queries are unaffected (they still say "Import").

**Acceptance**: `npm run test` green; visual smoke check in `npm run dev`
shows the dashboard button reading "Accounts & Import".

---

### Task 10: Reference docs + full checks + commit [depends on: Task 8, Task 9]

**Files**: `product-behavior.md`, `design.md`, `schema-spec.md` (only if it
needs the `customInstitutions` field documented — inspect its actual section
structure first, don't force a fit).

1. Re-read `product-behavior.md`'s "CSV import (Positions / Transactions)"
   section (lines 58-81) in full. Rewrite the Step 1 bullets (currently lines
   64-70) to describe: account `<select>` + `__new__` sentinel with pre-fill/
   blank-on-select behavior, the Save button (label/diff/dispatch), the
   institution `<select>` + inline-add flow (with the persisted-seed-list
   detail: `['Fidelity', 'Charles Schwab', 'Vanguard']` + custom + in-use),
   the retirement `<select>`, the two-column grid layout (no more
   `max-width: 720px` constraint), the manual-entry hint text, and the
   updated Continue-validity formula (no institution requirement for
   `__new__`). Keep Step 2's existing bullets word-for-word untouched. Also
   grep `product-behavior.md` for any reference to the closed-state trigger
   button's old "Import" label and update it to "Accounts & Import"
   (Task 9) — do not touch references to the dialog's own title or Step 2's
   "Import" button, both of which keep that name.
2. Re-read `design.md`'s component tree (line ~113) and "CSV import" data-
   flow section (lines 129-133) in full; update the Step 1 (`step === 1`)
   description to match the new state/handlers; add `addCustomInstitution`
   to the helper-fn list (line 89) and mention the reducer's
   `ADD_CUSTOM_INSTITUTION` case (near line 90's reducer description) and the
   `customInstitutions: string[]` field in the `AppState interface` section
   (~line 60). Do not touch anything about Step 2.
3. Check `schema-spec.md` around line 165 ("AppState UI/filter fields")
   — read that section's actual scope before deciding where
   `customInstitutions` belongs (it's persisted user data resembling
   `csvMappings`/`accounts`, not a transient UI filter like `posSearch`) —
   place it in whichever existing section schema-spec.md uses for small
   persisted-but-not-domain-model lists, or add a one-line entry to the
   nearest fitting section. If `schema-spec.md` has no natural section for
   this (verify first), a minimal one-line addition next to `csvMappings`'s
   documentation is acceptable — do not invent a new heading structure.
4. After all three doc files are updated, do a full-file re-read of each
   changed section (not just the diff) per CLAUDE.md's "full-file review
   after major changes" rule — check for staleness, contradictions, or
   leftover references to the old radio-toggle/checkbox/typeahead UI
   anywhere else in these three files (grep `Destination account`,
   `Retirement Account`, `InstitutionSelect` across all three docs as a
   final sweep).
5. Run `npm run test` — must be fully green.
6. Run `npm run build` (`tsc -b` + `vite build`) — no new errors.
7. Run `npm run lint`.
8. Only after 5-7 all pass AND docs are updated (CLAUDE.md's commit gate):
   commit. Suggested message follows this repo's history style (imperative,
   one-line summary + short body), e.g.:
   ```
   Redesign Step 1 of the import dialog to match design/v5

   Account dropdown with inline pre-fill + Save, institution select with
   persisted custom-add, retirement select, two-column grid layout. Step 2
   unchanged.
   ```

**Acceptance**: `npm run test`, `npm run build`, `npm run lint` all pass;
`product-behavior.md`, `design.md` internally consistent and accurate to the
new code; `schema-spec.md` either updated with a one-line addition or
confirmed (in the commit message body or a code comment during
implementation, not a new doc) that no update was structurally sensible —
implementer's call, but must be a deliberate decision, not an oversight.

---

### Task 11: Tear down the worktree [depends on: Task 10]

**Files**: none — repo/worktree cleanup only.

1. From inside `../worktree-import-dialog-v5-step1`, confirm the commit from
   Task 10 landed (`git log -1`) and the working tree is clean (`git status`).
2. `cd` back to the original/main working copy
   (`/Users/mdoraiswamy/owa/portfolio`).
3. `git worktree remove ../worktree-import-dialog-v5-step1`.
4. Merge/push the `import-dialog-v5-step1/setup-redesign` branch per however
   this repo normally lands branches (not specified by this plan — ask before
   force-pushing or deleting the branch itself; worktree removal does not
   delete the branch).

**Acceptance**: `git worktree list` no longer shows the removed worktree; the
branch still exists until explicitly merged/deleted by the user's normal
review flow.
