# Budget Page v2 (rebuild)

Supersedes `plans/budget-page-v1.md`. v1 predates the custom-categories
decision and, per the shipped `src/components/BudgetPage.tsx` this plan
reads on `main` today, placed all math inline in the component (`toMonthly`/
`toYearly`/`toPeriod`, filter/sort, category-breakdown %) instead of in
`computations.ts`/`selectors.ts` per CLAUDE.md's file-purpose conventions,
and used ad-hoc inline-styled markup instead of the app's `.card.blueprint
.elev-sm`/`.seg`/`.seg-opt`/`.field`/`.input`/`.tag-*`/`.btn.btn-primary`
vocabulary. v1 remains as a historical artifact, not deleted.
The actual-spend/category-derivation/income-mutual-exclusivity parts of this plan are further superseded by `plans/budget-page-v2-actual-spend.md`.

Caveman plan. Small tasks, one thing each, with deps and tests. Follows the
shape of `plans/register-page.md` and `plans/multi-portfolio-support.md`
(Facts checked / Decisions locked / Tasks w/ deps+tests+acceptance / Test
strategy / Risks / Open questions). No `plans/_template.md` exists in this
repo (checked).

Source spec: `design/budget-v1/project/Budget.dc.html` (a `{{ }}`-templated
Claude Design mock, NOT real code — behavior/layout reference only). Its
`toMonthly`/`toYearly`/`toPeriod`, `DEFAULT_CATEGORIES`, and category
breakdown/% math are the formula spec this plan replicates in real
TS/React. Its seed data (`incomeMonthly: 4500`, sample expense rows) and its
lack of a delete-category affordance are explicitly NOT ported (custom
categories are new scope beyond the mock, decided by the user).

## Facts checked before writing this plan (re-verified against current `main`, not v1's stale snapshot)

- **The shipped Budget code this plan removes** (commit `5e83333`, merged
  via `189d068`, currently on `main`):
  - `src/components/BudgetPage.tsx` (full file, 419 lines) — local
    `useState` for `period`/`filterCategory`/`sortBy`/form fields/`editingId`
    (matches decision to keep this ephemeral, kept in rebuild), inline math
    for `toMonthly`/`toYearly`/`toPeriod`/`visibleExpenses`/
    `categoryBreakdown` (NOT kept — moves to `computations.ts`/
    `selectors.ts` in rebuild), hardcoded local `CATEGORIES` array (11 names,
    matches `DEFAULT_CATEGORIES` below), all-inline-style markup (no `.seg`/
    `.seg-opt`, no `.card.blueprint.elev-sm`, `className="input"` used but
    not `.field`, `.tag` used without a variant class for category chips,
    custom hex-colored buttons instead of `.btn.btn-primary`).
  - `src/lib/types.ts` lines 90-96: `Expense { id, name, category, amount,
    frequency: 'monthly'|'yearly' }`.
  - `src/lib/state.ts`: `AppState.budgetIncomeMonthly: number` (line 31),
    `budgetIncomeYearly: number` (line 32), `budgetExpenses: Expense[]`
    (line 33); `view` union includes `'budget'` (line 36 — **stays**, other
    views still use it); `initialState()` defaults at lines 78-80 (`0, 0,
    []`); `replaceImportedState()` lines 537-539 (3 budget fields copied from
    imported `data`); helpers at lines 553-580: `setBudgetIncomeMonthly`
    (clamps to `Math.max(0, amount)`), `setBudgetIncomeYearly` (same clamp),
    `addBudgetExpense(state, expense: Omit<Expense,'id'>)` (generates
    `id = uid('expense')` internally — the precedent this plan's
    `addBudgetCategory`/new `addBudgetExpense` mirrors), `updateBudgetExpense`,
    `removeBudgetExpense`.
  - `src/lib/reducer.ts`: `AppAction` union lines 41-45 (`SET_BUDGET_INCOME_MONTHLY`,
    `SET_BUDGET_INCOME_YEARLY`, `ADD_BUDGET_EXPENSE`, `UPDATE_BUDGET_EXPENSE`,
    `REMOVE_BUDGET_EXPENSE`), switch cases lines 167-181 (comment `// Budget
    page`).
  - `src/lib/persist.ts` lines 104-106 (`coalesceWithDefaults` budget field
    defaulting) and line 118 (`view` whitelist includes `'budget'`).
  - `src/lib/importExport.ts` lines 33-35 (`ExportableState` budget fields),
    60-62 (`buildExportableState`), 184-186 (`decryptImportEnvelope` defaults).
  - `src/components/Nav.tsx` line 28: `{ value: 'budget', label: 'Budget' }`
    as the FIRST entry in `mainNavTabs` (order: Budget, Positions, Register,
    Quotes) — rebuild keeps this exact position.
  - `src/App.tsx` line 10 (`import { BudgetPage }`), lines 724-727 (`state.view
    === 'budget'` branch — **note**: unlike the `'accounts'`/`'register'`/
    `'quotes'` branches, this one does NOT wrap `<BudgetPage>` in the shared
    `<div style={{ padding: '0 var(--space-4) var(--space-6) var(--space-4)'
    }}>` wrapper the other views use; `BudgetPage.tsx` bakes its own
    `padding: var(--space-6)` + `maxWidth: 1200px` wrapper instead. Rebuild
    task T12 restores the shared wrapper convention for consistency with
    every other view, dropping `BudgetPage`'s own outer padding/maxWidth div.
  - Budget-related `it(...)` blocks inside `src/lib/state.test.ts`,
    `src/lib/reducer.test.ts`, `src/lib/persist.test.ts`,
    `src/lib/importExport.test.ts` (24 combined `grep` hits for
    `budget|Budget` across these 4 files — exact blocks to be located and
    removed in T1, not enumerated line-by-line here since grep hit counts
    include both code and describe-block text).
  - **No `src/components/BudgetPage.test.tsx` exists** — the shipped v1
    component has ZERO test coverage today (confirmed: `find
    src/components -iname "*.test.tsx"` lists 11 component test files, none
    for Budget). This is a real gap the rebuild fixes (T9-T11 each add
    tests).
- **`BalanceEntry`'s actual current shape** (for helper-precedent purposes
  only, not touched by this plan): `{ id, accountId, date, balance,
  activities: { type: ActivityType, amount: number, note: string }[] }`
  (`src/lib/types.ts` lines 82-88) — NOT the flat `activityType`/
  `activityAmount`/`note` shape `plans/register-page.md` originally
  described; it was refactored to a multi-activity array since. Irrelevant
  to Budget's data shape, noted only because `addBalanceEntries`/
  `deleteBalanceEntry`/`updateBalanceEntry` (`src/lib/state.ts` lines
  450-485) remain the closest sibling precedent for this plan's new
  `addBudgetCategory`/`deleteBudgetCategory` helper doc-comment/shape style.
- **`window.prompt` is used NOWHERE in this app** (`grep -rin
  "window.prompt" src/` → zero hits, confirmed fresh for this plan). Only
  `window.confirm` is an established pattern (`RegisterPage.tsx` line 72:
  `window.confirm('Delete this balance entry? This cannot be undone.')`;
  `ClosedPositionsTable.tsx` lines 19-21 and 34-36; `PortfolioPicker.tsx`
  line 89: `` window.confirm(`Delete portfolio "${portfolio.name}"? This
  cannot be undone.`) ``). **Flagged deviation, not silently treated as
  matching convention**: T11's "+ Add category…" `window.prompt` is
  implemented per the user's explicit decision (Step 2 point 5 of the task
  brief), not because it mirrors an existing pattern — it does not. If a
  reviewer later objects, the alternative (an inline text `.input` + a
  confirm button, matching this app's actual form-input conventions) is the
  fallback, but this plan implements `window.prompt` as instructed.
- **`grep -rin "watchlist" src/` → zero hits**, confirmed still true (repo
  invariant, unrelated to Budget, not to be broken by this plan).
- **Reference docs location — correction to the task brief's assumption**:
  the brief says "`src/product-behavior.md` and `src/design.md` ... verify
  actual paths ... currently have NO Budget section." Verified: those two
  files DO exist at `src/design.md`/`src/product-behavior.md` (10.2K/8.7K)
  but are **narrower, later-added docs scoped specifically to the
  multi-portfolio routing layer** (`## Portfolio Routing Layer`, `##
  Multi-Portfolio`, `### Navigation model`, `### Portfolio Picker` — headings
  confirmed via `grep -n "^## "`). The actual **general, whole-app-scoped**
  reference docs — the ones CLAUDE.md's "module root" Reference Docs rules
  apply to for a page-level feature like Budget — are at the repo root:
  `design.md` (47.4K, `## Directory structure`, `## State management`, `##
  Component tree`, `## Data flow`, `## Key Invariants`, `## Design
  patterns`), `product-behavior.md` (41.6K, per-page sections `## Nav`, `##
  Accounts page`, `## Register`, `## Settings page`, etc.), `schema-spec.md`
  (18.0K, `## BalanceEntry`, `## Action Types`, `## AppState UI/filter
  fields`, etc.). **Grepped all three for `Budget`/`budget` — zero
  substantive hits** (one incidental `mutualFundSync.ts ... callBudget`
  match, unrelated). So: the shipped v1 Budget feature was never
  documented in ANY reference doc — this is a pre-existing doc-staleness
  gap `budget-page-v1.md` intended to fix (its task T12 targeted the
  correct root-level files) but the docs show no evidence it landed. **This
  plan's reference-docs task (T14) targets the root-level `design.md`/
  `product-behavior.md`/`schema-spec.md` — NOT `src/design.md`/
  `src/product-behavior.md`, which stay untouched (out of scope, routing-only).**
- `src/lib/computations.ts` (116 lines): exports `GAIN_COLOR = '#1fa971'`,
  `LOSS_COLOR = '#e2574c'`, `glColor(gl)`, `fmtUSD(n)`, `fmtPct(n)`,
  `fmtPortfolioPercent(value, total)`, `computePosition(p)`,
  `allocationByAssetClass(...)`, `getAllExistingAssetClasses(...)`. No
  `toMonthly`/`toYearly`/`toPeriod` exist yet — new in this plan.
- `src/lib/selectors.ts` (490 lines) / `selectors.test.ts` (1534 lines):
  existing selector signatures take `state: AppState` and return UI-shaped
  data (e.g. `categoryCards(state): Array<{...}>`,
  `registerCategoryCards(state): Array<{...}>`). New `visibleExpenses`/
  `categoryBreakdown` selectors take raw arrays (`expenses`,
  `filterCategory`, `sortBy`, `period`) per the task brief's explicit
  signature — a deliberate exception to the "takes AppState" norm, matching
  how `allocationBars(positions, ...)` (line 71) and `acctAssetClassOptions
  (positions)` (line 354) also take raw collections, not full state, when
  the computation has no need for other state slices.
- `src/components/RegisterPage.tsx` line 393-399: exact `.seg`/`.seg-opt`
  markup — `<div className="seg">` wrapping
  `<label className="seg-opt" onClick={...}><input type="radio" checked={...}
  readOnly/><span>...</span></label>`. `src/components/Settings.tsx` lines
  146-175 use the identical pattern for its tab-seg. Both are the mirror
  target for Budget's Monthly/Yearly period toggle (replacing the shipped
  version's two raw `<button>`s with inline hex-color backgrounds).
- `src/components/ClosedPositionsTable.tsx` lines 18-24: delete-confirm
  precedent — `window.confirm('Delete this ... ? This permanently discards
  ...')` then dispatch only if confirmed; icon-button style via `lucide-react`
  `Trash`/`RotateCcw` icons, not text buttons — RegisterPage.tsx's
  text-button Edit/Done/Delete style (line ~173-176 pattern, text buttons
  colored via `var(--color-accent)`/red) is the closer mirror for Budget's
  row actions since the shipped version already used text buttons.
- `.tag-neutral` (`background: var(--color-neutral-100); color:
  var(--color-neutral-700)`) and `.tag-outline` (`border: 1px solid
  #f3c6bf; background: #fdeeec; color: #c8493c` — actually a red/warning
  variant, not neutral) both exist in `src/styles/styles.css` lines 132-136,
  alongside `.tag`/`.tag-accent`/`.tag-accent-2`. **Correction to the task
  brief's assumption**: `.tag-outline` is a warning/red-tinted variant, not
  a neutral outline — `.tag-neutral` is the correct choice for category
  pills (a neutral gray badge), not `.tag-outline`. T10/T11 use `.tag-neutral`.
- `.field` class exists and is used (`AccountsPage.tsx` line 232,
  `PortfolioPicker.tsx` lines 416/476/532/547) as a wrapping div around
  label+input pairs; `.input` is the input/select element class itself
  (used throughout `RegisterPage.tsx`/`Settings.tsx`/shipped
  `BudgetPage.tsx`). Both already exist and are used correctly by the
  shipped version for inputs — the rebuild's main styling fix is `.seg`/
  `.seg-opt` for the period toggle, `.card.blueprint.elev-sm` for panels
  (shipped version uses bare `.card`, missing `blueprint elev-sm`), and
  `.btn.btn-primary` for the Add button (shipped version hardcodes
  `background: 'var(--color-accent)'` inline instead).
- `src/lib/drive.ts`: **zero references** to `budget`/`balanceEntries`
  (`grep -n "budget\|balanceEntries" src/lib/drive.ts` → no hits). Confirmed
  fresh — `drive.ts` operates generically on whole `AppState`/
  `EncryptedEnvelope` blobs via `persist.ts`'s `coalesceWithDefaults`. No
  `drive.ts` code change needed for this plan; noted as a verification-only
  line in T7.
- `src/lib/seed.ts` line 5: `export function uid(prefix: string): string`
  — the id-generation helper `addBudgetExpense`/new `addBudgetCategory`
  (if categories need stable ids — they don't, see decisions) use.
  Categories are plain `string[]`, no id needed.
- No `plans/_template.md` exists (checked, confirmed same as v1/register-page/
  multi-portfolio).

## Decisions locked (do not re-litigate — task brief is authoritative, this section just restates for task-writing clarity)

1. **Full rebuild**: T1 removes ALL shipped Budget code (component, state
   fields/helpers, reducer cases, type, persist defaults, importExport
   wiring, Nav entry, App.tsx branch, and the 24-hit scattering of
   budget-related test blocks across `state.test.ts`/`reducer.test.ts`/
   `persist.test.ts`/`importExport.test.ts`) as its own commit, verified
   green (`npm run test`) before any rebuild work starts.
2. **No seed data**: fresh `AppState` starts `budgetIncomeMonthly: 0,
   budgetIncomeYearly: 0, budgetExpenses: []` — do not port the mock's
   `incomeMonthly: 4500` or its 6 sample expense rows.
3. **Styling**: `.card.blueprint.elev-sm` for panels, `.table` for the
   expense table, `.seg`/`.seg-opt` for the Monthly/Yearly toggle (mirror
   `RegisterPage.tsx` line 393-399 / `Settings.tsx` line 146-175 exactly),
   `.field`/`.input` for form fields, `.tag-neutral` for category pills
   (NOT `.tag-outline` — that's a red/warning variant, see Facts), `.btn
   .btn-primary` for the Add button, row actions (Edit/Done/Delete) styled
   as text buttons matching the shipped version's/`RegisterPage.tsx`'s
   existing text-button convention (accent-colored Edit/Done, red Delete).
4. **Logic placement**: `computations.ts` gets `toMonthly`/`toYearly`/
   `toPeriod` (pure math, joins `fmtUSD`/`glColor`/etc as general
   formatting+math utilities). `selectors.ts` gets `visibleExpenses
   (expenses, filterCategory, sortBy, period)` and `categoryBreakdown
   (expenses, period)` (raw-array-in-raw-array-out, per the existing
   `allocationBars`/`acctAssetClassOptions` precedent for selectors that
   don't need full `AppState`). `state.ts` gets AppState fields + pure
   helpers only (`setBudgetIncomeMonthly`, `setBudgetIncomeYearly`,
   `addBudgetExpense`, `updateBudgetExpense`, `deleteBudgetExpense`,
   `addBudgetCategory`, `deleteBudgetCategory`). `reducer.ts` gets one
   switch case per action, delegating only.
5. **Custom categories** (new scope beyond the mock): `AppState.
   budgetCategories: string[]`, initialized to `DEFAULT_CATEGORIES`
   (below). Expense-form category `<select>` gets an inline "+ Add
   category…" option; selecting it calls `window.prompt(...)` (flagged
   deviation, see Facts) for a name, and on a non-empty trimmed result not
   already present (case-sensitive exact match is fine — no case-folding
   requirement was specified), dispatches `ADD_BUDGET_CATEGORY`.
   - Delete affordance on category pills/breakdown rows: if zero
     `budgetExpenses` reference the category, delete immediately (dispatch
     `DELETE_BUDGET_CATEGORY`, no confirm). If any expenses reference it,
     `window.confirm('Delete category "X"? N expense(s) will be moved to
     "Other".')`-style prompt (established `window.confirm` pattern, exact
     wording decided in T11) — on confirm, `deleteBudgetCategory` reassigns
     those expenses' `category` to `'Other'` AND removes the name from
     `budgetCategories` in one state update (single helper call, not two
     dispatches, to keep it atomic).
   - `"Other"` can never be deleted — no delete affordance rendered for it
     (component-level check: `category !== 'Other'` gates the delete
     button/icon).
6. **Delete-expense confirmation**: `window.confirm('Delete this expense?
   This cannot be undone.')` — exact wording style match to
   `RegisterPage.tsx` line 72's `'Delete this balance entry? This cannot be
   undone.'`.
7. **Per-portfolio scoping**: automatic — `budgetIncomeMonthly`/
   `budgetIncomeYearly`/`budgetExpenses`/`budgetCategories` are plain
   `AppState` fields, already correctly isolated per portfolio by the
   existing per-portfolio IndexedDB mechanism (`src/lib/persist.ts`'s
   `setActivePortfolioDb`/`dbHandles` map, per `src/design.md`'s Portfolio
   Routing Layer section). No task needed beyond normal `AppState` field
   addition (T3).
8. **Drive sync / export-import / persist defaults**: `drive.ts` needs NO
   code change (verified, Facts). `persist.ts`'s `coalesceWithDefaults()`
   needs explicit `loaded.X ?? defaults.X` lines for all 4 fields (T7).
   `importExport.ts`'s `ExportableState`/`buildExportableState()`/
   `decryptImportEnvelope()` need explicit wiring for all 4 fields,
   including the NEW `budgetCategories` (T8) — v1 never had
   `budgetCategories` to wire, this is genuinely new plumbing, not a
   restore.
9. **Nav**: re-add `{ value: 'budget', label: 'Budget' }` as the FIRST
   `mainNavTabs` entry (T12), matching the shipped version's exact position
   (Budget, Positions, Register, Quotes). `AppState.view` union re-widens
   to include `'budget'` (T3). `App.tsx` re-adds the `state.view ===
   'budget'` branch (T12), this time wrapped in the SAME shared `<div
   style={{ padding: '0 var(--space-4) var(--space-6) var(--space-4)' }}>`
   wrapper every other view branch uses (fixing the shipped version's
   inconsistency noted in Facts) — `BudgetPage.tsx` itself drops its own
   outer `padding`/`maxWidth` div and relies on the shared wrapper instead.
10. **Reference docs**: root-level `design.md`, `product-behavior.md`,
    `schema-spec.md` (NOT `src/design.md`/`src/product-behavior.md` — see
    Facts correction) get new/updated Budget sections (T14), full-file
    review after (CLAUDE.md's major-change rule — new type, new AppState
    fields, new component, new custom-categories concept all qualify).

## `DEFAULT_CATEGORIES` (exact list, from the mock, unchanged)

```ts
export const DEFAULT_CATEGORIES = [
  'Housing', 'Utilities', 'Groceries', 'Transportation', 'Insurance',
  'Subscriptions', 'Health', 'Entertainment', 'Debt/Loans', 'Savings', 'Other',
] as const
```

## Action-type / naming choices made now (not left ambiguous)

- Reducer actions (rebuild set — note names diverge slightly from v1's
  shipped names, e.g. `DELETE_BUDGET_EXPENSE` not v1's `REMOVE_BUDGET_EXPENSE`,
  to match the task brief's Step 2 point 4 helper names exactly):
  `SET_BUDGET_INCOME_MONTHLY { amount }`, `SET_BUDGET_INCOME_YEARLY {
  amount }`, `ADD_BUDGET_EXPENSE { expense: Omit<Expense,'id'> }`,
  `UPDATE_BUDGET_EXPENSE { id, patch: Partial<Omit<Expense,'id'>> }`,
  `DELETE_BUDGET_EXPENSE { id }`, `ADD_BUDGET_CATEGORY { name: string }`,
  `DELETE_BUDGET_CATEGORY { name: string }`.
- `state.ts` helpers: `setBudgetIncomeMonthly(state, amount: number)`,
  `setBudgetIncomeYearly(state, amount: number)`, `addBudgetExpense(state,
  expense: Omit<Expense,'id'>)` (generates `id = uid('expense')`
  internally, matches v1's precedent), `updateBudgetExpense(state, id,
  patch: Partial<Omit<Expense,'id'>>)`, `deleteBudgetExpense(state, id)`,
  `addBudgetCategory(state, name: string)` (no-ops if `name` trimmed is
  empty or already present in `budgetCategories`), `deleteBudgetCategory
  (state, name: string)` (no-op if `name === 'Other'`; reassigns matching
  `budgetExpenses[].category` to `'Other'` AND filters `name` out of
  `budgetCategories` in the same returned object).
- `computations.ts` exports: `toMonthly(amount: number, freq: 'monthly' |
  'yearly'): number`, `toYearly(amount: number, freq): number`,
  `toPeriod(amount: number, freq, period: 'monthly' | 'yearly'): number`.
- `selectors.ts` exports: `visibleExpenses(expenses: Expense[],
  filterCategory: string, sortBy: 'category' | 'name' | 'amount', period:
  'monthly' | 'yearly'): Expense[]`, `categoryBreakdown(expenses:
  Expense[], period): Array<{ name: string; amount: number; pct: number }>`.
- Component: `src/components/BudgetPage.tsx`, props `{ state: AppState,
  dispatch: (action: any) => void }` (exact `RegisterPageProps` shape,
  matches shipped v1).

## Tasks

### T0 — Create git worktree
Deps: none.
```
git worktree add ../worktree-budget-page-v2 -b budget-page/v2
cd ../worktree-budget-page-v2
npm install
```
Acceptance: `npm run test` passes on the fresh worktree before any edits
(baseline green — confirms `main`'s current state, including the shipped
v1 Budget code, is itself green).

---

### T1 — Remove existing Budget code entirely (own commit)
Deps: T0.
Delete/edit in the worktree:
- Delete `src/components/BudgetPage.tsx` entirely.
- `src/lib/types.ts`: remove the `Expense` interface (lines 90-96).
- `src/lib/state.ts`: remove `budgetIncomeMonthly`/`budgetIncomeYearly`/
  `budgetExpenses` from `AppState` (lines 31-33), from `initialState()`
  (lines 78-80), from `replaceImportedState()` (lines 537-539), and delete
  the 5 helper functions (`setBudgetIncomeMonthly`, `setBudgetIncomeYearly`,
  `addBudgetExpense`, `updateBudgetExpense`, `removeBudgetExpense`, lines
  553-580ish). Narrow the `view` union back to `'settings' | 'accounts' |
  'quotes' | 'register'` (temporarily — T3 re-widens it to include
  `'budget'` once the rebuild's fields land; this task's job is pure
  removal, matching what a `git revert` of the Budget feature would look
  like). Remove the now-unused `Expense` type import (line 14).
- `src/lib/reducer.ts`: remove the 5 `AppAction` union members (lines
  41-45) and the 5 switch cases + `// Budget page` comment (lines 167-181).
- `src/lib/persist.ts`: remove the 3 `coalesceWithDefaults` default lines
  (104-106) and the `|| loaded.view === 'budget'` whitelist clause (line
  118), restoring the comment to not mention `budget`.
- `src/lib/importExport.ts`: remove the 3 `ExportableState` fields (33-35),
  3 `buildExportableState` lines (60-62), 3 `decryptImportEnvelope` default
  lines (184-186).
- `src/components/Nav.tsx`: remove the `{ value: 'budget', label: 'Budget'
  }` entry (line 28).
- `src/App.tsx`: remove the `import { BudgetPage }` (line 10) and the
  `state.view === 'budget' ? (...) : ` branch (lines 724-727).
- Remove every budget-related `it(...)`/`describe(...)` block from
  `src/lib/state.test.ts`, `src/lib/reducer.test.ts`, `src/lib/persist.test.ts`,
  `src/lib/importExport.test.ts` (search each file for `budget`/`Budget`,
  remove the matching test blocks and any now-orphaned fixture fields, e.g.
  `populatedState()` fixtures in `importExport.test.ts` that set
  `budgetIncomeMonthly`/etc, and `Object.keys(result).sort()` exhaustive
  key-list assertions that list the 3 budget keys).
Test case: `npm run test` — every remaining test passes, ZERO test
references `budget`/`Budget` anywhere (`grep -rin "budget" src/` after this
task should return nothing at all, including comments — confirm with a
grep before committing).
Acceptance: `npm run build` (tsc -b + vite build) succeeds, `npm run test`
green, `grep -rin "budget" src/` returns zero hits. Commit this task alone:
```
git add -A
git commit -m "Remove Budget page for rebuild (see plans/budget-page-v2.md)"
```

---

### T2 — types.ts: re-add Expense type
Deps: T1.
Edit `src/lib/types.ts`: re-add, in the same spot as before (near
`BalanceEntry`):
```ts
export interface Expense {
  id: string
  name: string
  category: string
  amount: number
  frequency: 'monthly' | 'yearly'
}
```
No colocated test (matches repo convention — `types.ts` has no
`types.test.ts`).
Acceptance: `tsc -b` still passes (additive-only type, nothing references
it yet).

---

### T3 — state.ts: AppState fields + budgetCategories + helpers
Deps: T2.
Edit `src/lib/state.ts`:
- Re-add `Expense` to the type-only import block.
- `AppState`: re-add `budgetIncomeMonthly: number`, `budgetIncomeYearly:
  number`, `budgetExpenses: Expense[]`, and NEW `budgetCategories:
  string[]`. Widen `view` back to `'settings' | 'accounts' | 'quotes' |
  'register' | 'budget'`.
- `initialState()`: `budgetIncomeMonthly: 0, budgetIncomeYearly: 0,
  budgetExpenses: [], budgetCategories: [...DEFAULT_CATEGORIES]` (import
  `DEFAULT_CATEGORIES` from `./computations` once T5 creates it — if T3 is
  implemented before T5 in strict order, this is a forward reference that
  only type/runtime-resolves once T5 lands; acceptable within one
  implementation session same as v1's `replaceImportedState`/
  `ExportableState` cross-task note, just don't run `vitest` on T3 alone
  until T5 also exists, or inline the literal array in T3 and switch to the
  import in T5 — implementer's call, either satisfies acceptance).
- `replaceImportedState()`: add `budgetIncomeMonthly: data.budgetIncomeMonthly,
  budgetIncomeYearly: data.budgetIncomeYearly, budgetExpenses:
  data.budgetExpenses, budgetCategories: data.budgetCategories,` (4 fields
  now, not 3 — `budgetCategories` is new).
- `setView()`: widen the `view` param type to match.
- New helpers, appended near the end of the file:
  ```ts
  /** Set the monthly income amount on the Budget page. Clamped to >= 0. */
  export function setBudgetIncomeMonthly(state: AppState, amount: number): AppState {
    return { ...state, budgetIncomeMonthly: Math.max(0, amount) }
  }

  /** Set the yearly income amount on the Budget page. Clamped to >= 0. */
  export function setBudgetIncomeYearly(state: AppState, amount: number): AppState {
    return { ...state, budgetIncomeYearly: Math.max(0, amount) }
  }

  /** Add a new expense to the Budget page's expense list. Generates its id. */
  export function addBudgetExpense(state: AppState, expense: Omit<Expense, 'id'>): AppState {
    return { ...state, budgetExpenses: [...state.budgetExpenses, { ...expense, id: uid('expense') }] }
  }

  /** Patch an existing budget expense by ID. No-op if the ID isn't found. */
  export function updateBudgetExpense(state: AppState, id: string, patch: Partial<Omit<Expense, 'id'>>): AppState {
    return {
      ...state,
      budgetExpenses: state.budgetExpenses.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }
  }

  /** Delete a budget expense by ID. No-op if the ID isn't found. */
  export function deleteBudgetExpense(state: AppState, id: string): AppState {
    return { ...state, budgetExpenses: state.budgetExpenses.filter((e) => e.id !== id) }
  }

  /** Add a custom budget category. No-op if the trimmed name is empty or already present. */
  export function addBudgetCategory(state: AppState, name: string): AppState {
    const trimmed = name.trim()
    if (!trimmed || state.budgetCategories.includes(trimmed)) return state
    return { ...state, budgetCategories: [...state.budgetCategories, trimmed] }
  }

  /**
   * Delete a budget category. No-op for "Other" (never deletable). Any
   * budget expenses referencing the deleted category are reassigned to
   * "Other" in the same update.
   */
  export function deleteBudgetCategory(state: AppState, name: string): AppState {
    if (name === 'Other') return state
    return {
      ...state,
      budgetCategories: state.budgetCategories.filter((c) => c !== name),
      budgetExpenses: state.budgetExpenses.map((e) => (e.category === name ? { ...e, category: 'Other' } : e)),
    }
  }
  ```

Test cases (add to `src/lib/state.test.ts`):
- `setBudgetIncomeMonthly`/`setBudgetIncomeYearly`: sets value, clamps
  negative input to 0, doesn't touch other fields.
- `addBudgetExpense`: appends with a generated id, preserves existing
  entries.
- `updateBudgetExpense`: patches matching id; no-op when id not found.
- `deleteBudgetExpense`: removes matching id; no-op when id not found.
- `addBudgetCategory`: appends a new trimmed name; no-op for empty/
  whitespace-only name; no-op for a name already present (exact match).
- `deleteBudgetCategory`: removes the name from `budgetCategories` AND
  reassigns matching expenses' `category` to `'Other'` in one call;
  no-op (both fields unchanged) when called with `'Other'`; no-op when
  name not found in `budgetCategories` but still reassigns any expenses
  that happen to reference it (edge case — decide: this plan's helper
  reassigns unconditionally whenever `name !== 'Other'`, regardless of
  whether `name` is currently in `budgetCategories`, since the two arrays
  could theoretically drift; test this exact behavior, don't special-case
  it away).
- `initialState()`: `budgetIncomeMonthly === 0`, `budgetIncomeYearly ===
  0`, `budgetExpenses` is `[]`, `budgetCategories` deep-equals the 11
  `DEFAULT_CATEGORIES` in order.
- `replaceImportedState`: given an `ExportableState`-shaped fixture with
  non-empty budget fields including `budgetCategories`, result's 4 budget
  fields match the fixture's.
Acceptance: `npx vitest run src/lib/state.test.ts` green (may need T5's
`DEFAULT_CATEGORIES` export to exist first for `initialState()`'s test —
sequence T3 after T5 if implementing strictly in order, or stub the
literal array and swap the import in during T5, implementer's call).

---

### T4 — reducer.ts: wire new actions
Deps: T3.
Edit `src/lib/reducer.ts`:
- Add to `AppAction` union:
  ```ts
  | { type: 'SET_BUDGET_INCOME_MONTHLY'; amount: number }
  | { type: 'SET_BUDGET_INCOME_YEARLY'; amount: number }
  | { type: 'ADD_BUDGET_EXPENSE'; expense: Omit<Expense, 'id'> }
  | { type: 'UPDATE_BUDGET_EXPENSE'; id: string; patch: Partial<Omit<Expense, 'id'>> }
  | { type: 'DELETE_BUDGET_EXPENSE'; id: string }
  | { type: 'ADD_BUDGET_CATEGORY'; name: string }
  | { type: 'DELETE_BUDGET_CATEGORY'; name: string }
  ```
  (extend the existing type-only import on line 5 to include `Expense`
  alongside `BalanceEntry`.)
- Add switch cases:
  ```ts
  case 'SET_BUDGET_INCOME_MONTHLY':
    return StateActions.setBudgetIncomeMonthly(state, action.amount)
  case 'SET_BUDGET_INCOME_YEARLY':
    return StateActions.setBudgetIncomeYearly(state, action.amount)
  case 'ADD_BUDGET_EXPENSE':
    return StateActions.addBudgetExpense(state, action.expense)
  case 'UPDATE_BUDGET_EXPENSE':
    return StateActions.updateBudgetExpense(state, action.id, action.patch)
  case 'DELETE_BUDGET_EXPENSE':
    return StateActions.deleteBudgetExpense(state, action.id)
  case 'ADD_BUDGET_CATEGORY':
    return StateActions.addBudgetCategory(state, action.name)
  case 'DELETE_BUDGET_CATEGORY':
    return StateActions.deleteBudgetCategory(state, action.name)
  ```

Test cases (add to `src/lib/reducer.test.ts`):
- Each of the 7 new action types dispatched through `appReducer` produces
  the same result as calling the `state.ts` helper directly.
Acceptance: `npx vitest run src/lib/reducer.test.ts` green.

---

### T5 — computations.ts: toMonthly/toYearly/toPeriod + DEFAULT_CATEGORIES
Deps: T2.
Edit `src/lib/computations.ts`: add, near the other exported consts/pure
functions (alongside `GAIN_COLOR`/`fmtUSD`):
```ts
import type { Expense } from './types'  // add to existing type imports if not present

export const DEFAULT_CATEGORIES = [
  'Housing', 'Utilities', 'Groceries', 'Transportation', 'Insurance',
  'Subscriptions', 'Health', 'Entertainment', 'Debt/Loans', 'Savings', 'Other',
] as const

export function toMonthly(amount: number, freq: Expense['frequency']): number {
  return freq === 'yearly' ? amount / 12 : amount
}

export function toYearly(amount: number, freq: Expense['frequency']): number {
  return freq === 'yearly' ? amount : amount * 12
}

export function toPeriod(amount: number, freq: Expense['frequency'], period: 'monthly' | 'yearly'): number {
  return period === 'monthly' ? toMonthly(amount, freq) : toYearly(amount, freq)
}
```
Note: placing `DEFAULT_CATEGORIES` in `computations.ts` (not a new
`budget.ts` file) is a deliberate choice for this plan — v1 considered a
separate `budget.ts` module (mirroring `register.ts`'s precedent) but this
plan keeps Budget's pure math in the existing `computations.ts` per the
task brief's explicit Step 2 point 4 instruction ("computations.ts: pure
math"). If `computations.ts` becomes unwieldy as a result, splitting is a
future call, not this plan's.

Test cases (`src/lib/computations.test.ts`):
- `toMonthly`: monthly amount unchanged; yearly amount / 12.
- `toYearly`: yearly amount unchanged; monthly amount * 12.
- `toPeriod`: monthly period picks `toMonthly`, yearly period picks
  `toYearly` (4 cases: both freq values × both periods).
- `DEFAULT_CATEGORIES`: has exactly 11 entries, in the documented order,
  ends with `'Other'`.
Acceptance: `npx vitest run src/lib/computations.test.ts` green.

---

### T6 — selectors.ts: visibleExpenses + categoryBreakdown
Deps: T2 (needs `Expense` type), T5 (needs `toPeriod`).
Edit `src/lib/selectors.ts`: add
```ts
import { toPeriod } from './computations'  // extend existing import
import type { Expense } from './types'     // extend existing import

export function visibleExpenses(
  expenses: Expense[],
  filterCategory: string,
  sortBy: 'category' | 'name' | 'amount',
  period: 'monthly' | 'yearly'
): Expense[] {
  const visible = filterCategory === '__all' ? expenses : expenses.filter((e) => e.category === filterCategory)
  return [...visible].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name)
    if (sortBy === 'amount') return toPeriod(b.amount, b.frequency, period) - toPeriod(a.amount, a.frequency, period)
    return a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
  })
}

export function categoryBreakdown(
  expenses: Expense[],
  period: 'monthly' | 'yearly'
): Array<{ name: string; amount: number; pct: number }> {
  const byCategory: Record<string, number> = {}
  expenses.forEach((e) => {
    byCategory[e.category] = (byCategory[e.category] ?? 0) + toPeriod(e.amount, e.frequency, period)
  })
  const maxCat = Math.max(1, ...Object.values(byCategory))
  return Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([name, amount]) => ({ name, amount, pct: (amount / maxCat) * 100 }))
}
```
Note: returns raw numbers, not `fmtUSD`-formatted strings — formatting
happens in `BudgetPage.tsx`, matching the existing `allocationBars`/
`categoryCards` split (selectors return data, components format).

Test cases (append to `src/lib/selectors.test.ts`):
- `visibleExpenses`: `'__all'` returns everything; specific category
  filters; `sortBy: 'name'` alpha order; `sortBy: 'amount'` descending by
  `toPeriod` value (mix monthly/yearly to verify period conversion happens
  before comparison); `sortBy: 'category'` groups by category then name;
  empty input → `[]`; input array not mutated.
- `categoryBreakdown`: empty → `[]`; single category → one entry, `pct:
  100`; multiple categories sorted desc by amount; `pct` relative to the
  MAX category (construct 3 categories where sum-based pct would differ
  from max-based pct, assert the max-based value); mixed monthly/yearly
  expenses converted via `toPeriod` before summing.
Acceptance: `npx vitest run src/lib/selectors.test.ts` green.

---

### T7 — persist.ts: coalesceWithDefaults + view whitelist
Deps: T3.
Edit `src/lib/persist.ts` `coalesceWithDefaults()`:
- Add: `budgetIncomeMonthly: loaded.budgetIncomeMonthly ??
  defaults.budgetIncomeMonthly, budgetIncomeYearly:
  loaded.budgetIncomeYearly ?? defaults.budgetIncomeYearly, budgetExpenses:
  loaded.budgetExpenses ?? defaults.budgetExpenses, budgetCategories:
  loaded.budgetCategories ?? defaults.budgetCategories,` (4 fields now).
- `view` whitelist: add `|| loaded.view === 'budget'` back, update the
  adjacent comment to mention `budget`.
- Verification-only line (no code change expected, per Facts): confirm
  `grep -n "budget" src/lib/drive.ts` still returns nothing after this
  task — `drive.ts` stays untouched.

Test cases (extend `src/lib/persist.test.ts`):
- Extend the "backfills missing ... with defaults from an empty blob" test
  to also assert `loaded?.budgetIncomeMonthly === 0`,
  `loaded?.budgetIncomeYearly === 0`, `loaded?.budgetExpenses` deep-equals
  `[]`, `loaded?.budgetCategories` deep-equals the 11 `DEFAULT_CATEGORIES`.
- New case: `preserves view: "budget"` — `putRaw({ view: 'budget' })` →
  `loaded?.view === 'budget'`.
- Extend the full-round-trip `loadPersistedApp`/`savePersistedApp` test
  (whichever exists with a populated state) to include all 4 budget fields
  and assert they survive the encrypt/decrypt round trip unchanged.
- Regression: a stored blob predating `budgetCategories` (has
  `budgetIncomeMonthly`/`budgetExpenses` but no `budgetCategories` key) →
  `coalesceWithDefaults` backfills `budgetCategories` to the 11 defaults
  (simulates a hypothetical earlier version of this same rebuild that
  hadn't added categories yet — defensive test, not a real prior release,
  but the mechanism must work).
Acceptance: `npx vitest run src/lib/persist.test.ts` green.

---

### T8 — importExport.ts: ExportableState + build + decrypt defaults
Deps: T3.
Edit `src/lib/importExport.ts`:
- `ExportableState`: add `budgetIncomeMonthly: number`,
  `budgetIncomeYearly: number`, `budgetExpenses: Expense[]`,
  `budgetCategories: string[]` (4 fields — `budgetCategories` is new,
  extend the `Expense` type import).
- `buildExportableState()`: add all 4 fields, mirroring where
  `balanceEntries: state.balanceEntries,` sits.
- `decryptImportEnvelope()`'s coalesce return: add `budgetIncomeMonthly:
  decrypted.budgetIncomeMonthly ?? 0, budgetIncomeYearly:
  decrypted.budgetIncomeYearly ?? 0, budgetExpenses:
  decrypted.budgetExpenses ?? [], budgetCategories:
  decrypted.budgetCategories ?? [...DEFAULT_CATEGORIES],` (import
  `DEFAULT_CATEGORIES` from `./computations`) — so a backup predating
  categories imports with the 11 defaults, not an empty category list.

Test cases (extend `src/lib/importExport.test.ts`):
- `populatedState()` fixture: add `budgetIncomeMonthly: 4500,
  budgetIncomeYearly: 0, budgetExpenses: [{ id: 'exp1', name: 'Rent',
  category: 'Housing', amount: 1800, frequency: 'monthly' }],
  budgetCategories: [...DEFAULT_CATEGORIES, 'Custom Cat']` (include one
  custom category to prove round-trip preserves non-default entries).
- `buildExportableState` describe block: assert `result.budgetIncomeMonthly
  === 4500`, `result.budgetExpenses === state.budgetExpenses` (reference
  equality), `result.budgetCategories === state.budgetCategories`; add the
  4 new keys to the exhaustive `Object.keys(result).sort()` list.
- `decryptImportEnvelope`: round-trip test with all 4 budget fields
  populated (including a custom category) preserves them exactly;
  decrypting an envelope missing all 4 fields (simulate an old backup via
  a `Partial<ExportableState>` cast without them) → `budgetIncomeMonthly:
  0, budgetIncomeYearly: 0, budgetExpenses: [], budgetCategories:` the 11
  `DEFAULT_CATEGORIES` (NOT `[]` — this is the one field whose empty-backup
  default isn't an empty array, call this out explicitly in the test name).
Acceptance: `npx vitest run src/lib/importExport.test.ts` green.

---

### T9 — BudgetPage.tsx: period toggle, income editor, summary cards
Deps: T3, T5, T6.
Create `src/components/BudgetPage.tsx`. Props: `{ state: AppState,
dispatch: (action: any) => void }`. Local `useState` (ephemeral UI only,
matches `QuotesPage.tsx`'s `search` / `RegisterPage.tsx`'s dialog-open
precedent, NOT `AppState`):
```ts
const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly')
```
(`filterCategory`/`sortBy`/form fields/`editingId` land in T10/T11 — this
task's slice only needs `period`.)
Build using existing class vocabulary only:
- Header row: "Budget" title + Monthly/Yearly toggle using the EXACT
  `.seg`/`.seg-opt` markup from `RegisterPage.tsx` line 393-399 (`<div
  className="seg">` wrapping `<label className="seg-opt" onClick={() =>
  setPeriod(...)}> <input type="radio" name="budgetPeriod" checked={period
  === ...} readOnly/><span>Monthly</span></label>`), NOT the shipped v1's
  raw hex-colored `<button>`s.
- Summary row: 3 `.card.blueprint.elev-sm` cards — Income / Expenses / Net,
  using `toPeriod`-based totals: `totalIncome = period === 'monthly' ?
  state.budgetIncomeMonthly + state.budgetIncomeYearly / 12 :
  state.budgetIncomeMonthly * 12 + state.budgetIncomeYearly` (inline in the
  component — this specific income-blend formula isn't one of T5's
  exported functions since it operates on two income numbers, not an
  `Expense`; keep it as a 2-line inline calc in the component, don't
  over-abstract into `computations.ts` for a formula used exactly once).
  `totalExpense = state.budgetExpenses.reduce((sum, e) => sum +
  toPeriod(e.amount, e.frequency, period), 0)`. Net card color:
  `net >= 0 ? GAIN_COLOR : LOSS_COLOR` from `computations.ts`; text
  `(net >= 0 ? '' : '-') + fmtUSD(Math.abs(net))`.
- Income editor card (`.card.blueprint.elev-sm`, `.field`/`.input`): two
  number inputs (Monthly income / Yearly income), `onChange` dispatches
  `SET_BUDGET_INCOME_MONTHLY`/`SET_BUDGET_INCOME_YEARLY` with
  `parseFloat(e.target.value) || 0`.

Test cases (`src/components/BudgetPage.test.tsx` — new file, check
`RegisterPage.test.tsx`'s imports first to confirm exact RTL setup this
repo uses before writing):
- Renders 3 summary cards with correct values for a fixture state (some
  income, some expenses) at the default `monthly` period.
- Toggling to Yearly (click the `.seg-opt` label) recomputes all 3 summary
  values per the yearly formulas.
- Period toggle renders as `.seg`/`.seg-opt` radio markup (assert the
  `input[type=radio]` elements exist with correct `checked` state), NOT
  plain buttons — regression guard against reverting to v1's shipped
  styling.
- Net card color: green (`GAIN_COLOR`) when net ≥ 0, red (`LOSS_COLOR`)
  when net < 0.
- Income inputs: changing Monthly/Yearly income dispatches the correct
  action with a parsed number; non-numeric input dispatches `0`.
Acceptance: `npx vitest run src/components/BudgetPage.test.tsx` green for
this task's slice (table/form/category tests land in T10/T11).

---

### T10 — BudgetPage.tsx: add-expense form + expense table (filter/sort/inline-edit/delete)
Deps: T9, T6.
Extend `BudgetPage.tsx`, adding local `useState`:
```ts
const [filterCategory, setFilterCategory] = useState('__all')
const [sortBy, setSortBy] = useState<'category' | 'name' | 'amount'>('category')
const [formName, setFormName] = useState('')
const [formCategory, setFormCategory] = useState(state.budgetCategories[0])
const [formAmount, setFormAmount] = useState('')
const [formFrequency, setFormFrequency] = useState<'monthly' | 'yearly'>('monthly')
const [editingId, setEditingId] = useState<string | null>(null)
```
- Add-expense form card (`.card.blueprint.elev-sm`, `.field`/`.input`,
  `.btn.btn-primary` for Add — NOT the shipped version's hardcoded
  `background: 'var(--color-accent)'` inline button): Name text input,
  Category `<select>` sourced from `state.budgetCategories` (NOT the
  removed local `CATEGORIES` const — this task does NOT yet add the "+ Add
  category…" option, that's T11's job, but the `<select>` already reads
  from `state.budgetCategories` so T11 only needs to append one more
  `<option>`), Amount number input, Frequency `<select>`, Add button.
  Validation: `formName.trim()` non-empty AND `parseFloat(formAmount) > 0`
  (guard: `!amount || amount <= 0` rejects `NaN`/0/negative), else no-op;
  on success dispatch `ADD_BUDGET_EXPENSE` with `{ name: formName.trim(),
  category: formCategory, amount: parseFloat(formAmount), frequency:
  formFrequency }` (no `id` — the `state.ts` helper generates it), then
  clear `formName`/`formAmount` only (matches mock's exact clear-on-success
  behavior, `formCategory`/`formFrequency` persist).
- Filter/sort controls: category `<select>` (`__all` + `state.budgetCategories`)
  bound to `filterCategory`; sort `<select>` (`category`/`name`/`amount`,
  amount option labeled `Amount (${periodLabel})`) bound to `sortBy`.
- Expense `.table`: rows from `visibleExpenses(state.budgetExpenses,
  filterCategory, sortBy, period)` (imported from `./lib/selectors`).
  Columns: Name, Category (`.tag-neutral` chip when not editing), Frequency,
  `{periodLabel} amount` (right-aligned, `fmtUSD(toPeriod(...))`), actions.
  Per-row when `editingId === row.id`: inline `<input>`/`<select>` for
  name/category/frequency/amount, `onChange` dispatches `UPDATE_BUDGET_EXPENSE`
  immediately per field change (matches mock's per-`onchange` wiring), plus
  a "Done" button (`onClick={() => setEditingId(null)}`); otherwise plain
  text + "Edit" (`onClick={() => setEditingId(row.id)}`) and "Delete"
  (`onClick={() => { if (window.confirm('Delete this expense? This cannot
  be undone.')) dispatch({ type: 'DELETE_BUDGET_EXPENSE', id: row.id }) }}`)
  text buttons, matching `RegisterPage.tsx`'s Edit/Done/Delete text-button
  styling (accent color for Edit/Done, red for Delete).
- Empty state: "No expenses to show." when the FILTERED `visibleExpenses`
  result is empty.

Test cases (append to `BudgetPage.test.tsx`):
- Add-expense form: empty name → no dispatch; zero/negative/NaN amount →
  no dispatch; valid input → dispatches `ADD_BUDGET_EXPENSE` with
  correctly-typed fields (trimmed name, parsed float amount, no `id` key)
  and clears name/amount after.
- Category `<select>` in the add form is populated from
  `state.budgetCategories`, not a hardcoded list (fixture state with a
  custom category proves this).
- Filtering by category shows only matching rows.
- Sorting by name/amount/category produces expected row order.
- Clicking Edit shows editable inputs; changing a field dispatches
  `UPDATE_BUDGET_EXPENSE` with the correct patch; Done exits edit mode.
- Delete: `window.confirm` mocked `false` → no dispatch; mocked `true` →
  dispatches `DELETE_BUDGET_EXPENSE` with the row's id.
- Empty `budgetExpenses` → "No expenses to show." renders.
- Non-empty `budgetExpenses` but a filter matching nothing → "No expenses
  to show." renders (table-scoped empty state, independent of whether any
  expenses exist globally).
Acceptance: `npx vitest run src/components/BudgetPage.test.tsx` green for
this task's slice (category management + breakdown tests land in T11).

---

### T11 — BudgetPage.tsx: category management + breakdown panel
Deps: T10, T6.
Extend `BudgetPage.tsx`:
- Add-expense form's Category `<select>` (from T10) gets one more
  `<option value="__add_new">+ Add category…</option>` appended after
  `state.budgetCategories`' own options. `onChange` handler: if the
  selected value is `'__add_new'`, call `window.prompt('New category
  name:')` (flagged deviation — see Facts, no existing `window.prompt`
  usage elsewhere in this app; implemented per explicit user decision, not
  because it mirrors an established pattern); if the result is non-null
  and its trimmed value is non-empty, dispatch `{ type:
  'ADD_BUDGET_CATEGORY', name: result.trim() }` and set `formCategory` to
  the trimmed name (so the new category is immediately selected); if the
  user cancels the prompt (`result === null`) or enters only whitespace,
  revert the `<select>`'s value to whatever `formCategory` was before
  (don't leave it stuck on `'__add_new'`).
- Category pills/breakdown rows (in the category-breakdown panel, built
  this task) each get a delete affordance (small "×" or text "Remove"
  button, text-button style matching Edit/Delete elsewhere) EXCEPT the
  `'Other'` row (component-level `category !== 'Other'` check hides/
  disables it — no delete affordance rendered for Other at all, not just
  disabled). Click handler:
  ```ts
  const handleDeleteCategory = (name: string) => {
    const count = state.budgetExpenses.filter((e) => e.category === name).length
    if (count > 0) {
      const confirmed = window.confirm(
        `Delete category "${name}"? ${count} expense(s) will be moved to "Other".`
      )
      if (!confirmed) return
    }
    dispatch({ type: 'DELETE_BUDGET_CATEGORY', name })
  }
  ```
  (Zero-expense case: no `window.confirm` at all, deletes immediately —
  matches decision #5's "delete immediately, no confirmation" for the
  unused-category path.)
- Category breakdown card (`.card.blueprint.elev-sm`): rows from
  `categoryBreakdown(state.budgetExpenses, period)` (imported from
  `./lib/selectors` — ALWAYS computed from the full `state.budgetExpenses`,
  never `filterCategory`-scoped, matching the mock's separation of
  concerns), each row: name + `fmtUSD(amount)` + a bar (`width:
  ${pct}%` div over a track div, no chart library) + the delete
  affordance (except Other). Empty state "Add expenses to see the
  breakdown." when `categoryBreakdown(...)` is empty.

Test cases (append to `BudgetPage.test.tsx`):
- "+ Add category…" option: selecting it prompts via `window.prompt`
  (mocked); entering a name dispatches `ADD_BUDGET_CATEGORY` with the
  trimmed name and the form's category selection updates to the new name;
  canceling the prompt (mock returns `null`) does not dispatch and the
  `<select>` doesn't stay stuck on the placeholder value; entering
  whitespace-only does not dispatch.
- Category breakdown panel is UNAFFECTED by the expense-table's
  `filterCategory` (construct a fixture where filtering would change the
  breakdown if wrongly wired to `filterCategory`, assert it doesn't —
  regression guard).
- Category breakdown bar widths relative to the MAX category, not the
  total (3-category fixture, assert exact percent values).
- Deleting a category with 0 referencing expenses: no `window.confirm`
  call, dispatches `DELETE_BUDGET_CATEGORY` immediately.
- Deleting a category with N referencing expenses: `window.confirm` mocked
  `false` → no dispatch; mocked `true` → dispatches `DELETE_BUDGET_CATEGORY`;
  after the dispatch (simulate via the reducer/full state update in the
  test, not just the raw action), those N expenses' `category` becomes
  `'Other'`.
- `'Other'` category row: no delete affordance rendered/present in the DOM
  at all (query for it and assert absence, not just "disabled").
- Empty `budgetExpenses` → "Add expenses to see the breakdown." renders.
Acceptance: `npx vitest run src/components/BudgetPage.test.tsx` fully green
(all cases from T9+T10+T11).

---

### T12 — Nav.tsx + App.tsx wiring
Deps: T11.
- `src/components/Nav.tsx`: re-add `{ value: 'budget', label: 'Budget' }`
  as the FIRST entry in `mainNavTabs` (order: Budget, Positions, Register,
  Quotes — matches the shipped version's position).
- `src/App.tsx`: re-add `import { BudgetPage } from './components/BudgetPage'`
  and a `state.view === 'budget'` branch in the view ternary, this time
  wrapped in the SAME shared `<div style={{ padding: '0 var(--space-4)
  var(--space-6) var(--space-4)' }}>` wrapper every other view branch uses
  (fixing the shipped version's inconsistency — see Facts). Confirm
  `BudgetPage.tsx` itself does NOT also apply its own outer
  `padding`/`maxWidth` (T9 should not have added one, given this task's
  correction — if T9 did add an outer wrapper div for convenience, remove
  it here so there's exactly one padding layer, matching every other page).

Test cases (extend `src/components/Nav.test.tsx`):
- Renders 4 pills labeled Budget/Positions/Register/Quotes, in that order.
- Clicking "Budget" dispatches `{ type: 'SET_VIEW', view: 'budget' }`.
- Active-pill styling applies correctly when `state.view === 'budget'`.
- Existing pill tests still pass unmodified (regression — order shift).
Test case (App-level): check whether an existing `App.test.tsx` routing
test asserts on `state.view === 'register'`/`'quotes'` branches (grep
first); if such a pattern exists, add a parallel "renders BudgetPage when
view is budget" case with the correct padding wrapper; if no such
per-view routing coverage exists at the App level, skip — covered by
`BudgetPage.test.tsx` + `Nav.test.tsx` + manual smoke.
Acceptance: `npx vitest run src/components/Nav.test.tsx` green; `npm run
build` succeeds (first end-to-end type-check of the full wiring).

---

### T13 — Full test suite + typecheck + lint pass
Deps: T1-T12.
Run `npm run test`, `npm run build`, `npm run lint`. Fix any fallout
(import cycles, unused vars, stray `any`, etc).
Acceptance: all three commands exit 0.

---

### T14 — Reference docs: root-level design.md / product-behavior.md / schema-spec.md
Deps: T13 (docs describe final code shape).
**Targets the ROOT-level files** (`/design.md`, `/product-behavior.md`,
`/schema-spec.md`) — NOT `src/design.md`/`src/product-behavior.md`, which
are multi-portfolio-routing-only docs out of scope for this plan (see
Facts correction). Re-read each of the 3 root files in FULL first
(CLAUDE.md's full-file-review rule — new page, new domain type, new
`AppState` fields, new custom-categories concept, new component all
qualify as a major change):
- `design.md`: `## Directory structure` (add `BudgetPage.tsx`), `##
  State management` (add `budgetIncomeMonthly`/`budgetIncomeYearly`/
  `budgetExpenses`/`budgetCategories` to the `AppState` field list, note
  the widened `view` union), `## Component tree` (add `BudgetPage` under
  the view switch, alongside `AccountsPage`/`RegisterPage`/`QuotesPage`/
  `SettingsPage`), `## Data flow` (Budget's flow: local UI state (period/
  filter/sort/form) + `AppState` (income/expenses/categories) →
  `computations.ts`'s `toMonthly`/`toYearly`/`toPeriod` and
  `selectors.ts`'s `visibleExpenses`/`categoryBreakdown` re-derive on every
  render; category add/delete mutate `AppState.budgetCategories` directly,
  with delete cascading a reassign-to-Other on `budgetExpenses`).
- `product-behavior.md`: new `## Budget` section (place near `##
  Register`, matching existing page-section ordering) — period toggle
  semantics, income editor, add-expense validation rule, expense table
  filter/sort/inline-edit/delete-confirm semantics, custom-category
  add flow (the `window.prompt` mechanism, flagged as this app's only use
  of `window.prompt`), category delete semantics (immediate when unused,
  confirm+reassign-to-Other when used, `Other` undeletable), category
  breakdown semantics (unfiltered, max-relative bar width), empty states.
  Also update `## Nav` section for the 4th tab if that section enumerates
  tabs by name/count.
- `schema-spec.md`: new `## Expense` section (field reference, mirroring
  `## BalanceEntry`'s format), note in `## AppState UI/filter fields` that
  Budget's `period`/`filterCategory`/`sortBy`/form state is intentionally
  component-local (NOT part of `AppState`), note in `## Action Types` for
  the 7 new actions, note `budgetCategories: string[]` as a new persisted
  domain field (not UI-only) with its default-value special case (backfills
  to `DEFAULT_CATEGORIES`, not `[]`, on a legacy/missing blob — per T7/T8).
Full-file review: after edits, re-read each of the 3 files in full again —
check no stale cross-references (e.g. old "N nav tabs"/"N views" language
needs updating), no duplication with the `## Register`/other page
sections, still terse/token-optimized, no narrative drift.
Acceptance: all 3 files updated, headings/style consistent with the rest
of each file, zero contradictions between sections.

---

### T15 — Gate check (tests green AND docs current, before commit)
Deps: T13, T14.
Re-run `npm run test` one final time after T14's doc edits (doc-only edits
shouldn't break tests, but this is the explicit CLAUDE.md gate: "don't
commit partial or doc-stale work" — verify both conditions hold
simultaneously right before committing, not just at T13's earlier
checkpoint). Confirm via a final read-through that `design.md`/
`product-behavior.md`/`schema-spec.md` mention Budget consistently (no
section says something a different section contradicts).
Acceptance: `npm run test` exits 0; all 3 root reference docs contain a
Budget-related section; no contradictions found.

---

### T16 — Commit
Deps: T15.
```
git add -A
git commit -m "Rebuild Budget page with custom categories (see plans/budget-page-v2.md)

..."
```
Acceptance: commit created, `git status` clean.

---

### T17 — Merge to main + teardown worktree
Deps: T16.
```
cd /home/mohan/owa/portfolio
git log --oneline main..budget-page/v2   # confirm what's landing (should be T1's removal commit + T16's rebuild commit)
git checkout main
git merge --no-ff budget-page/v2
```
(Fast-forward instead of `--no-ff` if history is linear — check the log
first.) Do NOT push (CLAUDE.md rule).
```
git worktree remove ../worktree-budget-page-v2
```
Acceptance: `main` contains both the removal commit and the rebuild
commit; `npm run test` still green on `main` post-merge; `git worktree
list` no longer shows `worktree-budget-page-v2`.

## Test strategy

- Every new/changed `src/lib/*.ts` module gets or extends its colocated
  `*.test.ts` (`types.ts` has none by convention; `state`, `reducer`,
  `computations`, `selectors`, `persist`, `importExport`) — pure-function
  unit tests, no DOM, except `persist.test.ts`'s existing `fake-indexeddb`
  usage.
- `Nav.test.tsx` and the NEW `BudgetPage.test.tsx` are component/behavior
  tests (React Testing Library, matching this repo's existing convention —
  verify exact utilities via `RegisterPage.test.tsx`'s imports before
  writing `BudgetPage.test.tsx`, since none existed for Budget before this
  plan).
- No test touches `AccountsPage`/`QuotesPage`/`SettingsPage`/`RegisterPage`/
  `RegisterBalanceDialog`/`ClosedPositionsTable`/`PortfolioPicker` — unrelated
  to this feature.
- `drive.ts`/`drive.test.ts` are NOT touched (generic over `AppState`, no
  per-field logic, verified in Facts).
- `npm run test` green, `npm run build` (typecheck) passing, `npm run
  lint` clean — all required before T16's commit (T15's explicit gate).

## Risks / open items for implementer to watch

- **T3's `initialState()` forward-reference to `DEFAULT_CATEGORIES`**:
  `state.ts` imports `DEFAULT_CATEGORIES` from `computations.ts` (T5). If
  implementing strictly in numeric task order, T3 lands before T5 exists —
  either inline the literal array temporarily in T3 and switch to the
  import once T5 lands, or reorder to do T5 before T3 in your own
  implementation session (the plan lists them in dependency-safe order:
  T3 depends on T2 only for the type; nothing stops doing T5 before T3 in
  practice — this note just flags it so `vitest` isn't run on T3 in
  isolation before T5 exists).
- **`window.prompt` in jsdom/vitest**: `window.prompt` needs to be mocked
  in tests (`vi.spyOn(window, 'prompt').mockReturnValue(...)`), same
  pattern as `window.confirm` mocking already used in
  `ClosedPositionsTable.test.tsx`/`RegisterPage.test.tsx` — confirm the
  exact mocking convention from an existing `window.confirm` test before
  writing T11's `window.prompt` tests, don't invent a different pattern.
- **Category breakdown "unfiltered" requirement**: easy to accidentally
  wire the breakdown panel to `filterCategory`-scoped data since it sits
  near the filtered table — T11 explicitly calls out the regression test
  for this (mirrors the mock's own separation: `categoryBreakdown` is
  computed from the full `state.budgetExpenses`, never the filtered
  `visibleExpenses` result).
- **`deleteBudgetCategory`'s expense-reassignment is unconditional**: the
  helper (T3) reassigns any `budgetExpenses` referencing the deleted name
  to `'Other'` regardless of whether that name is still in
  `budgetCategories` — this is intentional (defensive against the two
  arrays drifting) but worth a deliberate test rather than an assumption.
- **Amount validation edge case** (T10, unchanged from the mock/v1): the
  guard `!amount || amount <= 0` rejects `NaN` (falsy), `0`, and negative
  numbers — this correctly requires amount `> 0`; don't "fix" it to
  `Number.isNaN(amount) || amount <= 0` and treat that as a behavior
  change (they're equivalent for this guard, either phrasing is fine).

## Open questions surfaced while planning (flagging, not blocking — reasonable defaults chosen above)

- Whether category-name matching for "already present" (`addBudgetCategory`)
  should be case-insensitive (like `portfolioRegistry.ts`'s
  `nameKey(name) = name.trim().toLowerCase()` precedent for portfolio
  names) or exact-match (chosen here, simpler, matches the mock's flat
  string-array model with no uniqueness normalization elsewhere in the
  app for categories). Exact-match is what's implemented in T3; revisit if
  the user wants case-insensitive dedup.
- Exact wording of the category-delete confirm dialog — T11 proposes
  `Delete category "X"? N expense(s) will be moved to "Other".`, matching
  this app's existing "action described, then consequence" `window.confirm`
  phrasing style (`RegisterPage.tsx`/`ClosedPositionsTable.tsx`/
  `PortfolioPicker.tsx` all follow "Delete this X? consequence." — T11's
  wording is a reasonable extension, not verified against a literal
  existing precedent since no prior confirm mentions a reassignment
  consequence).
- Whether the category breakdown panel sits beside the expense table
  (2-column, per the mock and per v1's shipped layout) or below it
  (1-column) — left to implementer's layout judgment in T11, either
  satisfies acceptance; the app's existing pages don't enforce one
  2-column convention.
