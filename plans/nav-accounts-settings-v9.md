# Apply v9 Design: Nav + Accounts Page + Settings

Caveman plan. Modeled on `plans/nav-settings-v7.md`'s structure/tone (same repo, prior precedent) — do not copy its content, different task. Requirements below are already locked by the caller (an interview happened upstream) — do not re-derive or re-ask. Small tasks, each one thing, ≤30min. Read top to bottom before starting task 1.

## Scope

**In scope**: `src/components/Nav.tsx`, `src/components/Settings.tsx`, `src/components/AccountsPage.tsx` (new), `src/App.tsx`, `src/lib/state.ts` (`AppState.view` type + `setView()` signature only), `src/lib/selectors.ts` (new `accountsSections`/`computeCashInvestment`/category-label-map exports), `src/components/Nav.test.tsx` (rewrite), `src/components/Settings.test.tsx` (update), `src/components/AccountsPage.test.tsx` (new), `src/lib/selectors.test.ts` (new cases), `src/App.test.tsx` (check/fix), `design.md`, `product-behavior.md`.

**Out of scope**: `src/lib/reducer.ts` (no new action types needed — `SET_VIEW`/`SET_CATEGORY` cases already generic pass-throughs to `state.ts` helpers, confirmed by reading `reducer.ts` lines 46-48 and 77-78), `src/lib/types.ts`, `src/lib/persist.ts`, `src/styles/styles.css` (already byte-identical to `design/v9/project/styles.css`, zero CSS changes, only correct class usage in markup), `OverviewCard.tsx`, `AllocationChart.tsx`, `PositionsTable.tsx`, `ImportDialog.tsx` and account-creation flow (untouched — Accounts page is read-only, account CRUD stays exactly where it is today), any other component/view not named above.

## Facts checked before writing this plan

- No `.claude/nav-accounts-settings-v9/` dir exists; plan correctly placed in `plans/`.
- `design/v9/project/Portfolio Dashboard.dc.html` lines 19-41: nav markup. `mainNavTabs` (2 tabs, Dashboard/Accounts) is a single always-rendered `.seg`, NOT split by `sc-if` like v7's mutually-exclusive category/settings tabs. Sync icon button (`driveReady`-gated) + gear icon both live inside one `<div style="display:flex;align-items:center;margin-left:auto;">` wrapper — identical structural shape to what v7 already produced in current `src/components/Nav.tsx` (confirmed by reading current file), so sync/gear markup itself needs no changes, only the tabs block above it.
- Lines 79-88 (category filter tabs, dashboard view): sits after `</div></div>` closing the Overview card's cluster grid, then `<div style="background: var(--color-divider); margin: var(--space-6) 0"></div>` (divider), then `<div class="seg" style="margin-bottom:var(--space-6);">` with `categoryTabs` (4 items incl. "All"). This entire block is OUTSIDE Nav in the mock — it's inside the dashboard-view content area, between Overview and Allocation cards.
- Lines 205-253: Accounts view. `<sc-if isAccountsView>` wraps `<div style="max-width:1400px;margin:0 auto;"><div style="padding:var(--space-6);">` then `sc-for accountsSections as sec` (3 iterations). Each section: `.card.blueprint.elev-sm` (`marginBottom: var(--space-5)`), 4 corner `<i>`, `.card-title` (`marginBottom: var(--space-4); fontSize:14px`) = `sec.label`. `sc-if sec.hasRows` → `.table` with `<thead>` (Financial Institution left, Account left, Cash right, Investment right, Total right) → `<tbody>` rows (`institution`, `accountName`, `cashStr`, `investmentStr`, `totalStr` bold) → `<tfoot>` subtotal row (`border-top:1px solid var(--color-divider)`, "Subtotal" label `colSpan=2` uppercase/bold/12px, `cashTotalStr`/`investmentTotalStr`/`grandTotalStr` bold, grandTotal colored `var(--color-accent-700)`). `sc-if sec.noRows` → `.text-muted` "No accounts in this category." (`fontSize:12px`). After each card, `sc-if sec.showDivider` → `<div style="height:var(--space-6); border-bottom:1px solid var(--color-divider); margin-bottom:var(--space-5);">` (divider div, not shown after last section).
- Lines 255-362: Settings view. `<sc-if isSettingsView>` wraps `<div style="max-width:1400px;margin:0 auto;"><div style="padding:var(--space-6); max-width:560px;">` then directly (no Nav involvement): `<div class="seg" style="margin-bottom:var(--space-5);">` with `settingsTabs` (Google Drive/Encryption), then `<div class="hr" style="margin-bottom:var(--space-5);"></div>`, then the Drive card (`isDriveSection`) and Encryption card (`isEncryptionSection`) exactly as in v7 (unchanged internals, confirmed by diffing v7/v9 html for this section — no textual differences found in the card bodies themselves). Settings view in v9 has **no** Back-to-Dashboard button/`.hr` at the bottom — file ends right after the Encryption card's closing `sc-if`.
- JS model (same file, lines ~595-1180): `CATEGORY_LABEL = { all: 'All', taxable: 'Taxable', nonTaxable: 'Non-Taxable', taxDeferred: 'Tax-Deferred' }` (line 595). `computeCashInvestment(accountId)` (lines 797-804): sums `shares*price` per position for that account, splitting into `cash`/`investment` buckets via `(p.symbol||'').toLowerCase() === 'cash'`. `accountsSections()` (lines 806-824): `catKeys = Object.keys(CATEGORY_LABEL).filter(k => k !== 'all')` (3 keys, in insertion order taxable/nonTaxable/taxDeferred — matches locked-decision #1's required order), maps each to `{ label, rows, hasRows, noRows, cashTotalStr, investmentTotalStr, grandTotalStr, showDivider: idx < catKeys.length-1 }`; each row is `{ institution, accountName: name + ' (' + accountNumber + ')', cashStr, investmentStr, totalStr }` via `fmtUSD`. `categoryTabs` (dashboard render, lines 1080-1083): `Object.keys(CATEGORY_LABEL).map(...)` — all 4 keys including `all`, unchanged from current app behavior. `mainNavTabs`/`isAccountsView`/`accountsSections` wiring (lines 1151-1174): `isDashboardView/isAccountsView/isSettingsView` are three-way exclusive off `st.view`; `mainNavTabs` is `[{label:'Dashboard',...},{label:'Accounts',...}]`, each `onClick` just sets `view`; `openSettings` sets `{view:'settings', settingsSection:'drive'}` (matches existing `onOpenSettings` behavior in current app — no change needed there); `settingsTabs` unchanged shape from current app.
- Current `src/components/Nav.tsx` (91 lines, read in full): has two mutually-exclusive `.seg` blocks keyed on `state.view === 'dashboard'` (category tabs) / `state.view === 'settings'` (settings tabs), both inline in `Nav`. `NavProps` currently: `state`, `dispatch`, `settingsSection`, `setSettingsSection`, `driveReady`, `syncing`, `handleSync`, `onOpenSettings`. Sync icon block (lines 107-136) and gear (138-161) already match v9's markup shape exactly (wrapped in one `marginLeft:auto` flex div) — confirmed no structural diff between v7/v9 nav's icon-button wrapper.
- Current `src/components/Settings.tsx` (373 lines, read in full): `SettingsPageProps` has `settingsSection` but not `setSettingsSection` (Nav currently owns the tab-seg and calls `setSettingsSection` directly, passed to Nav not Settings). Drive card (lines 172-308) and Encryption card (lines 311-367) already have correct v7-matching blueprint/corner/text-muted styling from prior work — do not re-touch internals. Lines 369-370: `<div className="hr" style={{marginBottom:'var(--space-5)'}} /><button ... onClick={() => dispatch({type:'SET_VIEW', view:'dashboard'})}>Back to Dashboard</button>` — this exact 2-line block must be deleted per locked decision #2.
- Current `src/App.tsx` (342 lines, read in full): owns `settingsSection`/`setSettingsSection` via `useState<'drive'|'encryption'>('drive')` (line 48). Renders `<Nav .../>` once (lines 252-264) passing `settingsSection`/`setSettingsSection` to it, above a `state.view === 'dashboard' ? (...) : (...)` ternary (line 266). Dashboard branch (267-312): `OverviewCard` → `AllocationChart` (wrapped, `marginBottom: var(--space-6)`) → divider (`borderTop`, NOT the `background:var(--color-divider)` block-divider style v9 uses for the category-tabs divider — different divider styling, see task T4 note) → retirement-filter `.seg` + `ImportDialog` row → `PositionsTable`. NO category tabs currently in this branch (they're in Nav today). Settings branch (313-336) passes `settingsSection` (but not `setSettingsSection`) to `SettingsPage`.
- `src/lib/state.ts` (319 lines, read in full): `AppState.view: 'dashboard' | 'settings'` (line 25), `initialState()` sets `view: 'dashboard'` (line 59), `setView(state, view: 'dashboard' | 'settings')` (lines 313-318) is a trivial `{...state, view}` — no validation logic to touch beyond the type signature.
- `src/lib/selectors.ts` (252 lines, read in full): exports `visiblePositions`, `filteredPortfolioTotal`, `visibleTransactions`, `summaryCards`, `segmentSummaryCards`, `allocationBars`; private (unexported) `getAccountsForCategory(state)` at lines 246-251 already does the "filter accounts by `state.category`" logic — reusable as reference pattern but NOT reusable directly for `accountsSections` (that needs to iterate the 3 fixed tax categories, not `state.category`). Imports `fmtUSD`, `fmtPct`, `computePosition`, `allocationByAssetClass` from `./computations`; `sortBy` from `./sort`. `fmtUSD`/`fmtPct` confirmed defined in `src/lib/computations.ts` lines 7/17 — reuse these, don't invent a new formatter.
- `src/lib/types.ts` (83 lines, read in full): `TaxCategory = 'taxable' | 'nonTaxable' | 'taxDeferred'` (line 1, no `'all'` member — matches `CATEGORY_LABEL`'s non-`all` keys exactly). `Account`: `id, accountNumber, name, institution, taxCategory, retirement, createdAt`. `Position`: `id, accountId, symbol, name, assetClass, assetClassManualOverride?, shares, avgCost, price, lastImportedAt` — no separate `marketValue` field; mock's `computeCashInvestment` uses raw `p.shares * p.price`, matching `computations.ts`'s `computePosition().marketValue` for non-manual-override cases (assetClass override doesn't affect market value calc) — confirmed safe to use `computePosition(p).marketValue` OR raw `p.shares*p.price` interchangeably for this purpose; plan uses `p.shares * p.price` to mirror the mock's JS literally and avoid pulling in unrelated `computePosition` cost-basis fields.
- `src/lib/reducer.ts` (confirmed via read): `SET_CATEGORY` → `StateActions.setCategory(state, action.category)`; `SET_VIEW` → `StateActions.setView(state, action.view)`. Both already fully generic — accepting `'accounts'` as a `view` value requires zero reducer.ts changes, only the `state.ts` type widening.
- Baseline: `npm run test` currently 347/347 green (confirmed by caller in task context) — this plan's final state must also be 100% green, no known-failure carve-out (unlike `nav-settings-v7.md`'s T9, which had an accepted 11-failure baseline from unrelated WIP that does not apply here).
- `design.md` "Component tree" section documents `Nav` (line 101) and `SettingsPage` (line 112) with the v7 prop shapes/behavior described above — both descriptions must be rewritten for v9. "Data flow" section (Drive sync paragraph, line 141) references `Nav`'s `settingsSection`/`setSettingsSection` props — must be updated since those move off `Nav`.
- `product-behavior.md`: "Layout" line (line 9) lists `Nav → OverviewCard → AllocationChart → divider → retirement filter row → PositionsTable` — must gain the relocated category-tabs mention and (separately) a pointer to the new Accounts view. "Nav" section (lines 11-19) describes v7's tri-mode tab behavior — must be rewritten for single Dashboard/Accounts mode. "Settings page" section (lines 90-92+) describes tabs "switched via the Nav's settings seg tabs" — must change to "SettingsPage's own tab-seg" and note removal of Back-to-Dashboard button.

## Locked decisions (from caller's interview — implement exactly, do not re-ask)

1. Accounts page is strictly read-only: 3 sections (Taxable/Non-Taxable/Tax-Deferred order), each `.card.blueprint.elev-sm` + 4 corners + `.card-title`, `.table` w/ Financial Institution/Account/Cash/Investment/Total columns + `<tfoot>` subtotal, or `.text-muted` empty message. Divider between sections, not after last. No add/edit/delete. New file `src/components/AccountsPage.tsx`, props `{ state: AppState }` only.
2. Settings "Back to Dashboard" button + its `.hr` + `SET_VIEW` handler: deleted entirely. Nav's Dashboard/Accounts tabs are the only way back.
3. Category filter tabs relocate from `Nav.tsx` into `App.tsx`'s dashboard JSX: after Overview card, after a `background:var(--color-divider)` divider div, before Allocation card, `.seg` with `marginBottom: var(--space-6)`. Same markup/dispatch as today, pure relocation.
4. `Nav.tsx` single-mode: one always-rendered `.seg`, tabs "Dashboard"/"Accounts", active off `state.view === 'dashboard'`/`'accounts'` (neither when `'settings'`), dispatches `SET_VIEW` accordingly. No settings-tabs branch in Nav anymore. `NavProps` loses `settingsSection`/`setSettingsSection`. Sync/gear icons unchanged behavior, re-verify positioning matches v9 (expected identical to v7, confirmed above).
5. Settings tabs move into `SettingsPage`'s own JSX: `.seg` (`marginBottom: var(--space-5)`) + `.hr` (`marginBottom: var(--space-5)`) at top of content div, then existing conditional Drive/Encryption cards unchanged. `settingsSection`/`setSettingsSection` stay `App.tsx`-owned `useState`, both now passed to `SettingsPage` (`setSettingsSection` newly added to `SettingsPageProps`).
6. `AppState.view` widens to `'dashboard' | 'settings' | 'accounts'` in `state.ts`; `setView()` signature updated to match. No persistence-migration concern.
7. New selector `accountsSections(state: AppState)` in `selectors.ts` returning the section list (label, rows, hasRows/noRows, cashTotal/investmentTotal/grandTotal formatted strings, showDivider) + helper `computeCashInvestment(state, accountId)`. Reuse `fmtUSD` from `computations.ts`. Shared category-label map (Taxable/Non-Taxable/Tax-Deferred, no "All") introduced once, reused by both relocated dashboard category-tabs code and `accountsSections` — home it in `selectors.ts` as an exported const, since `types.ts` is out of scope for this plan and `selectors.ts` is where the equivalent `CATEGORY_LABEL` logic (mock) naturally lives (it's UI-derivation, not domain schema).
8. Git worktree: `../worktree-nav-accounts-settings-v9` off branch `nav-accounts-settings-v9/apply-design`, implement there, commit, remove worktree — mirrors T0/T-last of `nav-settings-v7.md`.
9. `npm run test` must be 100% green at the end (no carve-out), plus clean `npm run build` and `npm run lint`.
10. Reference docs mandatory: `design.md` Component tree + Data flow; `product-behavior.md` Nav, Settings page, Layout line, new Accounts page section. Full-file re-read of both after edits per CLAUDE.md's Reference Docs rule (multi-area behavior change).

## Tasks

### T0. Create isolated git worktree (~5 min)
No dependency.
- From `/Users/mdoraiswamy/owa/portfolio`: `git worktree add ../worktree-nav-accounts-settings-v9 -b nav-accounts-settings-v9/apply-design`.
- `cd ../worktree-nav-accounts-settings-v9`. All subsequent implementation tasks (T1-T13) happen here.
- Acceptance: `git status` in the worktree shows a clean tree on the new branch; worktree dir exists as a sibling of `portfolio/`.

### T1. Widen `AppState.view` type in `state.ts` (~10 min)
Depends on: T0.
- Open `src/lib/state.ts`. Change line 25 `view: 'dashboard' | 'settings'` → `view: 'dashboard' | 'settings' | 'accounts'`.
- Change `setView()` (lines 313-318) signature: `view: 'dashboard' | 'settings'` → `view: 'dashboard' | 'settings' | 'accounts'`.
- `initialState()`'s `view: 'dashboard'` (line 59) needs no change (still a valid value of the widened type).
- Acceptance: `grep -n "view:" src/lib/state.ts` shows the widened union in both spots; `npx tsc -b --noEmit` run from repo root does not yet need to pass (other files not updated yet) — just confirm this file alone has no syntax errors via `npx tsc --noEmit src/lib/state.ts` is not meaningful standalone (skip), instead just visually confirm the two edits landed correctly.

### T2. Add category-label map + `accountsSections`/`computeCashInvestment` selectors (~25 min)
Depends on: T1.
- Open `src/lib/selectors.ts`.
- Add an exported const near the top (after imports): `export const CATEGORY_LABEL: Record<TaxCategory, string> = { taxable: 'Taxable', nonTaxable: 'Non-Taxable', taxDeferred: 'Tax-Deferred' }` — import `TaxCategory` from `./types` (add to the existing `import type { Position, Transaction, Account } from './types'` line, or a new import line).
- Add `computeCashInvestment(state: AppState, accountId: string): { cash: number; investment: number }`: filter `state.positions` where `p.accountId === accountId`, for each add `p.shares * p.price` to `cash` if `(p.symbol || '').toLowerCase() === 'cash'` else to `investment`. Mirrors mock lines 797-804 exactly.
- Add `accountsSections(state: AppState): Array<{ label: string; rows: Array<{ institution: string; accountName: string; cashStr: string; investmentStr: string; totalStr: string }>; hasRows: boolean; noRows: boolean; cashTotalStr: string; investmentTotalStr: string; grandTotalStr: string; showDivider: boolean }>`: iterate `(Object.keys(CATEGORY_LABEL) as TaxCategory[])` in declared order (taxable, nonTaxable, taxDeferred — object key order matches insertion order in JS, matching mock behavior), for each build rows from `state.accounts.filter(a => a.taxCategory === catKey)`, per-account call `computeCashInvestment`, accumulate `cashTotal`/`investmentTotal`, row `accountName = a.name + ' (' + a.accountNumber + ')'`, format all money fields with `fmtUSD`. `showDivider: idx < catKeys.length - 1`.
- Acceptance: file compiles (spot-check via reading the diff — full typecheck happens in T9); functions exported; no changes to any existing exported function's signature or behavior (diff should be additive only).

### T3. Write `src/lib/selectors.test.ts` cases for `accountsSections`/`computeCashInvestment` (~25 min)
Depends on: T2.
- Open (or check for existence of) `src/lib/selectors.test.ts` — if it doesn't exist yet, check whether selector tests currently live elsewhere (grep `visiblePositions` / `allocationBars` test coverage across `src/lib/*.test.ts` first) and follow that file's existing conventions/fixture-building pattern for `AppState`/`Account`/`Position`; if `selectors.test.ts` already exists, add a new `describe('accountsSections', ...)` block using its existing fixture helpers.
- Test cases (per caller's required coverage):
  1. Multiple accounts in one category — subtotal math correct (sum of per-account cash+investment).
  2. Zero accounts in a category — that section has `hasRows: false`, `noRows: true`, empty `rows`, zero-formatted totals (`fmtUSD(0)`).
  3. An account with only cash positions (`symbol: 'CASH'` or similar case variant) — `investment` is 0 for that account, `cash` equals sum of its cash-position market values.
  4. An account with only non-cash positions — `cash` is 0, `investment` equals sum.
  5. An account with both cash and non-cash positions — correct split.
  6. Case-insensitivity of the cash symbol check (e.g. `symbol: 'Cash'` or `'cash'` still counted as cash) — mirrors mock's `.toLowerCase() === 'cash'`.
  7. Section ordering is always Taxable, Non-Taxable, Tax-Deferred regardless of account insertion order in `state.accounts`.
  8. `showDivider` is `true` for sections 0 and 1, `false` for section 2 (last).
  9. `accountName` format is `"{name} ({accountNumber})"`.
- Run `npx vitest run src/lib/selectors.test.ts` — all new + existing cases pass.
- Acceptance: file has the 9 cases above (or equivalent consolidated assertions covering the same ground), green.

### T4. Relocate category filter tabs into `App.tsx`'s dashboard JSX (~20 min)
Depends on: T2 (needs `CATEGORY_LABEL` import), T0.
- Open `src/App.tsx`. Import `CATEGORY_LABEL` from `./lib/selectors` (alongside no other new imports needed for this task).
- In the dashboard branch (currently lines ~267-312), after `<OverviewCard state={state} />` and before `<AllocationChart state={state} />`'s wrapping div, insert:
  - A divider: `<div style={{ background: 'var(--color-divider)', margin: 'var(--space-6) 0' }} />` (matches mock's inline `background:var(--color-divider); margin:var(--space-6) 0` — a filled block divider, distinct from the existing `borderTop`-style divider further down; do not touch or reuse that other divider).
  - A `.seg` block with 4 tabs: `{ value: 'all', label: 'All' }` plus `Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))`, `style={{ marginBottom: 'var(--space-6)' }}` on the `.seg` div, each `.seg-opt` with `<input type="radio" name="category" checked={state.category === tab.value} readOnly onClick={...}>` dispatching `{ type: 'SET_CATEGORY', category: tab.value }` — copy the exact JSX shape/pattern from current `Nav.tsx`'s category-tabs block (read it first) before deleting it in T5, so the relocation is byte-faithful.
- Do not touch `OverviewCard`, `AllocationChart`, the retirement-filter+Import row, or `PositionsTable` — everything else in the dashboard branch stays as-is.
- Acceptance: dashboard view visually has category tabs between Overview and Allocation cards (verify via `npm run dev` spot check or trust the JSX diff — automated coverage comes from T10's `App.test.tsx` pass); `state.category` still drives `visiblePositions`/`allocationBars` as before (no selector changes needed here, `getAccountsForCategory` in `selectors.ts` already reads `state.category`).

### T5. Rewrite `Nav.tsx` to single Dashboard/Accounts tab mode (~25 min)
Depends on: T4 (so the category-tabs JSX can be deleted from Nav once confirmed relocated).
- Open `src/components/Nav.tsx`.
- Remove `settingsSection`/`setSettingsSection` from `NavProps` and the function signature/destructuring.
- Remove the `categoryTabs` array, `settingsTabs` array, `handleCategoryChange` callback, and both mutually-exclusive `.seg` blocks (lines ~61-105 in current file).
- Replace with one always-rendered `.seg`: `const mainNavTabs = [{ value: 'dashboard', label: 'Dashboard' }, { value: 'accounts', label: 'Accounts' }]`, mapped to `.seg-opt` labels, `<input type="radio" name="mainView" checked={state.view === tab.value} readOnly>`, `onClick={() => dispatch({ type: 'SET_VIEW', view: tab.value })}`. Neither tab is checked when `state.view === 'settings'` (natural consequence of the equality check, no extra logic needed).
- Sync icon block and gear icon block: leave markup/behavior unchanged (already confirmed identical shape to v9 in Facts Checked) — just ensure they still sit inside the render after the new tabs `.seg`.
- Update the component's doc comment (currently "category tabs (dashboard) / settings tabs (settings)") to describe the new single-mode behavior.
- Acceptance: `Nav.tsx` has exactly one `.seg` block (Dashboard/Accounts), no references to `settingsSection`/`setSettingsSection`/`categoryTabs`/`settingsTabs` remain in the file.

### T6. Move settings tab-seg into `SettingsPage`, delete Back-to-Dashboard (~25 min)
Depends on: T5 (so `Nav` no longer owns `setSettingsSection`, freeing it to be passed to `Settings` instead).
- Open `src/components/Settings.tsx`.
- Add `setSettingsSection: (s: 'drive' | 'encryption') => void` to `SettingsPageProps` and the function's destructured params.
- At the top of the returned JSX (inside the existing outer `<div>`, before the Drive-card conditional block), insert:
  - `<div className="seg" style={{ marginBottom: 'var(--space-5)' }}>` containing two `.seg-opt` labels for `{ value: 'drive', label: 'Google Drive' }` / `{ value: 'encryption', label: 'Encryption' }`, `<input type="radio" name="settingsSection" checked={settingsSection === tab.value} readOnly>`, `onClick={() => setSettingsSection(tab.value)}` — this is the exact block being removed from `Nav.tsx` in T5, moved here with `setSettingsSection` now a direct prop instead of Nav's.
  - `<div className="hr" style={{ marginBottom: 'var(--space-5)' }} />` immediately after the tab-seg.
- Delete the trailing `<div className="hr" style={{marginBottom:'var(--space-5)'}} /><button ... onClick={() => dispatch({type:'SET_VIEW', view:'dashboard'})}>Back to Dashboard</button>` block (current lines 369-370) entirely — no replacement.
- Acceptance: `SettingsPage` renders its own tab-seg + `.hr` at the top; no Back-to-Dashboard button/handler remains anywhere in the file; `grep -n "Back to Dashboard" src/components/Settings.tsx` returns nothing.

### T7. Create `AccountsPage.tsx` (~25 min)
Depends on: T2.
- Create `src/components/AccountsPage.tsx`. Props: `{ state: AppState }` (import `AppState` from `../lib/state`), import `accountsSections` from `../lib/selectors`.
- JSX: `<div style={{ padding: 'var(--space-6)' }}>` wrapping `accountsSections(state).map((sec, i) => (<React.Fragment key={sec.label}>...</React.Fragment>))` — each fragment: `.card.blueprint.elev-sm` (`marginBottom: 'var(--space-5)'`) + 4 corner `<i>` + `.card-title` (`marginBottom:'var(--space-4)', fontSize:'14px'`) = `sec.label`; if `sec.hasRows`, a `.table` with `<thead>` (Financial Institution/Account left-aligned, Cash/Investment/Total right-aligned via `style={{textAlign:'right'}}` on `<th>`) + `<tbody>` mapping `sec.rows` (key by `institution+accountName` or index) to `<tr><td>{r.institution}</td><td>{r.accountName}</td><td style={{textAlign:'right'}}>{r.cashStr}</td><td style={{textAlign:'right'}}>{r.investmentStr}</td><td style={{textAlign:'right',fontWeight:600}}>{r.totalStr}</td></tr>` + `<tfoot><tr style={{borderTop:'1px solid var(--color-divider)'}}><td colSpan={2} style={{fontFamily:'var(--font-heading)',fontWeight:600,fontSize:'12px',textTransform:'uppercase',letterSpacing:'0.06em'}}>Subtotal</td><td style={{textAlign:'right',fontWeight:600}}>{sec.cashTotalStr}</td><td style={{textAlign:'right',fontWeight:600}}>{sec.investmentTotalStr}</td><td style={{textAlign:'right',fontWeight:600,color:'var(--color-accent-700)'}}>{sec.grandTotalStr}</td></tr></tfoot>`; else (`sec.noRows`) a `<div className="text-muted" style={{fontSize:'12px'}}>No accounts in this category.</div>`; if `sec.showDivider`, a divider `<div style={{height:'var(--space-6)', borderBottom:'1px solid var(--color-divider)', marginBottom:'var(--space-5)'}} />` after the card.
- No dispatch prop, no interactive elements beyond the pure display above (locked decision #1: strictly read-only).
- Acceptance: component renders 3 sections in Taxable/Non-Taxable/Tax-Deferred order; each section shows either a table+subtotal or the empty-state message; dividers appear between sections 1-2 and 2-3 but not after section 3.

### T8. Wire `AccountsPage` + updated `Nav`/`SettingsPage` props into `App.tsx` (~20 min)
Depends on: T5, T6, T7.
- Open `src/App.tsx`.
- Import `AccountsPage` from `./components/AccountsPage`.
- Update the `<Nav .../>` call site: remove `settingsSection`/`setSettingsSection` props (Nav no longer accepts them per T5).
- Change the `state.view === 'dashboard' ? (...) : (...)` ternary into a 3-way branch: `state.view === 'dashboard' ? (<dashboard JSX from T4>) : state.view === 'accounts' ? (<AccountsPage state={state} />) : (<div style={{padding:'var(--space-6)'}}><SettingsPage ... /></div>)`.
- Update `<SettingsPage .../>` call site: add `setSettingsSection={setSettingsSection}` prop (state already exists in `App.tsx`, just wasn't passed to `SettingsPage` before — was passed to `Nav` instead).
- `onOpenSettings` handler (currently resets `settingsSection` to `'drive'` and dispatches `SET_VIEW: 'settings'`) needs no change — still correct behavior for entering settings from any view.
- Acceptance: `App.tsx` renders `AccountsPage` when `state.view === 'accounts'`; `SettingsPage` receives `setSettingsSection`; `Nav` no longer receives `settingsSection`/`setSettingsSection`.

### T9. Rewrite `Nav.test.tsx` (~25 min)
Depends on: T5, T8.
- Open `src/components/Nav.test.tsx` (existing file, rewrite the parts that assumed the old mutually-exclusive category/settings tab branches).
- Test cases:
  1. `state.view = 'dashboard'` → "Dashboard" tab is checked, "Accounts" tab is not; only these two tabs render (no category tabs, no settings tabs in Nav anymore).
  2. `state.view = 'accounts'` → "Accounts" tab checked, "Dashboard" not.
  3. `state.view = 'settings'` → neither "Dashboard" nor "Accounts" tab is checked.
  4. Clicking "Dashboard" tab dispatches `{ type: 'SET_VIEW', view: 'dashboard' }`.
  5. Clicking "Accounts" tab dispatches `{ type: 'SET_VIEW', view: 'accounts' }`.
  6. `driveReady = true` → sync icon renders (`title="Sync now"`); `driveReady = false` → it does not.
  7. `driveReady = true, syncing = true` → sync icon `disabled`.
  8. Clicking sync icon calls `handleSync` mock.
  9. Clicking gear icon calls `onOpenSettings` mock.
- Delete any old cases asserting category-tabs-in-Nav or settings-tabs-in-Nav (those behaviors moved to `App.tsx`/`SettingsPage` respectively, covered by T10/T11's test updates instead).
- Run `npx vitest run src/components/Nav.test.tsx` — all pass.
- Acceptance: file green, no leftover assertions referencing `setSettingsSection` prop or category-tab labels inside `Nav`.

### T10. Update `Settings.test.tsx` (~20 min)
Depends on: T6.
- Open `src/components/Settings.test.tsx`.
- Add `setSettingsSection: vi.fn()` to every `render(<SettingsPage .../>)` call's props (new required prop per T6).
- Add test cases: tab-seg renders with "Google Drive"/"Encryption" options; clicking a tab calls `setSettingsSection` with the right value; the `.hr` divider renders immediately after the tab-seg (query by class or structural position if easy, else skip the structural assertion and just confirm presence).
- Remove/replace any existing test asserting the Back-to-Dashboard button exists or dispatches `SET_VIEW: 'dashboard'` (that behavior is deleted per T6) — search for `Back to Dashboard` text queries and delete those specific assertions/tests.
- Run `npx vitest run src/components/Settings.test.tsx` — all pass.
- Acceptance: file green; `grep -n "Back to Dashboard" src/components/Settings.test.tsx` returns nothing; new tab-seg coverage present.

### T11. Write `AccountsPage.test.tsx` (~25 min)
Depends on: T7.
- Create `src/components/AccountsPage.test.tsx`, vitest + jsdom + RTL, mirroring fixture-building conventions from `Nav.test.tsx`/`Settings.test.tsx` (or `App.test.tsx` if it has a more complete `AppState` fixture builder — check first).
- Test cases:
  1. Renders 3 section cards with correct labels in order: Taxable, Non-Taxable, Tax-Deferred.
  2. A category with accounts renders a `.table` with the 5 expected column headers.
  3. A category with accounts renders one `<tr>` per account with correct institution/account-name/cash/investment/total text content.
  4. Subtotal `<tfoot>` row shows correct summed totals.
  5. A category with zero accounts renders "No accounts in this category." instead of a table.
  6. No interactive elements (no buttons/inputs) render anywhere on the page — confirms read-only per locked decision #1 (e.g. `expect(container.querySelectorAll('button, input')).toHaveLength(0)`).
  7. Dividers render between sections 1-2 and 2-3, not after section 3 (query count of the divider style/structure, or trust visual + rows count if a clean query isn't easy — pick whichever is more robust given RTL's query API).
- Run `npx vitest run src/components/AccountsPage.test.tsx` — all pass.
- Acceptance: file exists, all 7 cases (or equivalent) covered, green.

### T12. Check/fix `App.test.tsx` for breakage (~20 min)
Depends on: T8, T9, T10, T11.
- Open `src/App.test.tsx`. Run `npx vitest run src/App.test.tsx` first to see what the T4/T5/T6/T8 changes broke.
- Likely breakage points to check: (a) any test asserting `Nav` receives/uses `settingsSection`/`setSettingsSection` props directly — now irrelevant, Nav doesn't take them; (b) any test asserting category tabs render inside the Nav DOM region — must move assertion to check they render in the dashboard content area instead; (c) any test navigating to `state.view = 'settings'` and asserting a Back-to-Dashboard button — must be removed/updated since that button is gone; (d) add a new minimal case if none exists: navigating to Accounts view (`state.view = 'accounts'`) renders `AccountsPage` content (e.g. one of its section labels).
- Fix minimally — do not add sweeping new coverage beyond what's needed to keep this file accurately describing current behavior (Nav.test.tsx/AccountsPage.test.tsx/Settings.test.tsx already own the detailed new-behavior coverage per T9-T11).
- Run `npx vitest run src/App.test.tsx` — all pass.
- Acceptance: file green; any fix applied is noted for the commit message.

### T13. Run full suite + build + lint, confirm 100% green (~15 min)
Depends on: T3, T9, T10, T11, T12.
- Run `npm run test` (full suite, not scoped). Compare against baseline 347/347 — expect a higher total (new test files) but **zero failures**, anywhere.
- Acceptance: 100% pass, no known-failure carve-out (unlike `nav-settings-v7.md`'s T9). If any failure appears — including in files not touched by this plan — stop and fix before proceeding.
- Run `npm run build` (tsc -b + vite build) — zero errors.
- Run `npm run lint` — zero errors.

### T14. Update reference docs: `design.md` + `product-behavior.md` (~30 min)
Depends on: T13 (docs describe final, tested behavior).
- Open `design.md`. Re-read "Component tree" (~lines 93-115) and "Data flow" (~lines 117-154) in full first.
- "Component tree": rewrite the `Nav` entry (line 101) — drop `settingsSection`/`setSettingsSection` from its prop list, describe the single always-rendered Dashboard/Accounts `.seg` (active state, dispatches `SET_VIEW`), keep sync-icon/gear description (unchanged behavior). Rewrite the `SettingsPage` entry (line 112) — add `setSettingsSection` to its prop list, describe the tab-seg + `.hr` now rendered by `SettingsPage` itself, remove the Back-to-Dashboard-button mention entirely (button deleted). Add a new entry for `AccountsPage` (props `{ state }`, rendered when `state.view === 'accounts'`, read-only 3-section summary table via `accountsSections` selector). Update the "Props convention" paragraph (line 115) to reflect Nav's/SettingsPage's new prop lists and add `AccountsPage: { state }` to the narrower-props list.
- "Data flow": update the Drive-sync paragraph (line 141) — remove the claim that `App.tsx` passes `settingsSection`/`setSettingsSection` to `Nav` (now false); note it passes them to `SettingsPage` instead (alongside the Drive props it already gets).
- Also check "Directory structure" (~line 35) for the stale `Nav.tsx` one-line description ("nav-brand, category seg tabs, SVG gear icon for settings") — update if this plan changes the accuracy of that summary (it does — category tabs move out of Nav); add an `AccountsPage.tsx` line to the directory listing.
- After edits, re-read "Directory structure", "Component tree", and "Data flow" sections once more in full for internal consistency (CLAUDE.md's Reference Docs full-file-review rule — this is a multi-area behavior change).
- Open `product-behavior.md`. Re-read "Layout" (line 9), "Nav" (lines 11-19), "Settings page" (lines 90-92+) in full first.
- "Layout" line: update to mention the relocated category tabs now sit between Overview and Allocation cards (not in Nav), and add a one-line pointer to the new Accounts view (e.g. "Accounts view (via Nav's Accounts tab): read-only per-category account summary, see 'Accounts page' section below").
- "Nav" section: rewrite for single always-visible Dashboard/Accounts tab mode — remove all v7-era language about settings-tabs/category-tabs living in Nav; keep the sync-icon-button and gear-icon bullets (behavior unchanged) but note gear no longer needs Nav to also own `settingsSection` reset logic (still true — `onOpenSettings` in `App.tsx` handles that, just re-verify the bullet's wording doesn't imply Nav owns tab state anymore).
- "Settings page" section: update "switched via the Nav's settings seg tabs" → "switched via SettingsPage's own tab-seg (Google Drive / Encryption) at the top of its content, followed by a `.hr` divider"; remove any remaining mention of a Back-to-Dashboard button — note instead that navigation away from Settings happens only via Nav's Dashboard/Accounts tabs.
- Add a new "## Accounts page" section (placement: after "Positions table"/"Transactions table", before "CSV import" — or wherever reads best given the file's existing section order, check first) describing: read-only, accessed via Nav's Accounts tab; 3 sections (Taxable/Non-Taxable/Tax-Deferred) each showing per-account Financial Institution/Account Name (accountNumber)/Cash/Investment/Total, with a Subtotal row; empty-category message "No accounts in this category."; cash vs. investment split determined by `position.symbol.toLowerCase() === 'cash'`; no account creation/editing here (still lives in the Import dialog's new-account flow).
- Re-read all touched sections once more after edits for consistency with the rest of the file (terse, no narrative drift).
- Acceptance: both docs edited; re-read in full per the rule above; no stale "Nav owns category/settings tabs" language remains anywhere in either file; new Accounts page section present in `product-behavior.md`.

### T15. Commit (~10 min)
Depends on: T13, T14.
- Confirm `npm run test` is 100% green, `npm run build`/`npm run lint` clean, and both reference docs updated — per CLAUDE.md, do not commit unless all true.
- Stage the specific files touched: `src/components/Nav.tsx`, `src/components/Settings.tsx`, `src/components/AccountsPage.tsx`, `src/App.tsx`, `src/lib/state.ts`, `src/lib/selectors.ts`, `src/components/Nav.test.tsx`, `src/components/Settings.test.tsx`, `src/components/AccountsPage.test.tsx`, `src/lib/selectors.test.ts`, `src/App.test.tsx`, `design.md`, `product-behavior.md`. Do not `git add -A` — avoid sweeping in unrelated untracked content (e.g. `design/v8/`, `design/v9/` design bundles themselves are reference-only inputs already present pre-branch, `plans/dashboard-v8-layout.md`, or any other stray WIP).
- Commit message describing "apply v9 nav/accounts/settings design: single Dashboard/Accounts nav tabs, new read-only Accounts page, settings tab-seg + Back-to-Dashboard removal, relocated category filter tabs".
- Do not push unless the user asks.

### T16. Worktree teardown (~5 min)
Depends on: T15.
- `cd /Users/mdoraiswamy/owa/portfolio` (back to main worktree).
- `git worktree remove ../worktree-nav-accounts-settings-v9`.
- Acceptance: `git worktree list` no longer shows the removed worktree; branch `nav-accounts-settings-v9/apply-design` still exists with the commit (worktree removal doesn't delete the branch).

## Test Strategy

- **`selectors.test.ts`** (new/extended, T3): 9 cases for `accountsSections`/`computeCashInvestment` — multi-account subtotal math, empty category, cash-only account, non-cash-only account, mixed account, case-insensitive cash symbol, section ordering, `showDivider` correctness, `accountName` formatting.
- **`Nav.test.tsx`** (rewritten, T9): 9 cases replacing the old mutually-exclusive-branch cases — single-mode Dashboard/Accounts tab active-state per view (including neither-active on settings), click-dispatch behavior for both tabs, sync-icon conditional render/disabled/click, gear click.
- **`Settings.test.tsx`** (updated, T10): existing cases retargeted to accept new `setSettingsSection` prop; new tab-seg render + click-dispatch cases; Back-to-Dashboard assertions removed.
- **`AccountsPage.test.tsx`** (new, T11): 7 cases — section order/labels, table headers, row content, subtotal math, empty-category message, zero-interactivity (read-only enforcement), divider placement.
- **`App.test.tsx`** (checked/fixed, T12): breakage from category-tabs relocation and `view` type widening fixed minimally; new Accounts-view smoke case added if none exists.
- **Full suite** (T13): `npm run test` must be 100% green — no carve-out.
- **Build**: `npm run build` clean.
- **Lint**: `npm run lint` clean.

## Acceptance Criteria

1. `Nav.tsx` renders one always-visible `.seg` with Dashboard/Accounts tabs, active state correct per `state.view` (neither active on settings), dispatches `SET_VIEW`; sync icon (driveReady-gated, syncing-disabled) and gear icon unchanged in behavior.
2. Category filter tabs (All/Taxable/Non-Taxable/Tax-Deferred) render in `App.tsx`'s dashboard body between Overview and Allocation cards, with the block-style divider above them, exactly matching v9's mock positioning; same `SET_CATEGORY` dispatch behavior as before.
3. `AccountsPage.tsx` exists, read-only, renders 3 sections (Taxable/Non-Taxable/Tax-Deferred order) each with a table+subtotal or empty-state message, dividers between sections not after the last, zero interactive elements.
4. `SettingsPage` renders its own Google-Drive/Encryption tab-seg + `.hr` at the top of its content; no Back-to-Dashboard button/handler remains anywhere in the codebase.
5. `AppState.view` is `'dashboard' | 'settings' | 'accounts'`; `setView()` matches; reducer.ts unchanged (already generic).
6. `accountsSections`/`computeCashInvestment` selectors exist in `selectors.ts`, correctly split cash vs. investment per account and subtotal per category, matching the v9 mock's `computeCashInvestment`/`accountsSections` JS logic exactly.
7. `npm run test` is 100% green (no known-failure carve-out); `npm run build` and `npm run lint` clean.
8. `design.md`'s Component tree, Data flow, and Directory structure sections and `product-behavior.md`'s Layout, Nav, Settings page, and new Accounts page sections accurately describe the new behavior; both docs re-read in full post-edit for internal consistency.
9. `git diff --stat` against `main` shows only the files listed in T15's staging list (plus nothing else swept in).

## Risks

- **Divider style confusion**: v9's category-tabs divider (`background:var(--color-divider); margin:var(--space-6) 0`, a filled block) is visually different from the dashboard's existing `borderTop`-style divider further down (between Allocation and the retirement-filter row). Mitigate by copying the exact inline style from the mock (T4) rather than reusing/adapting the existing divider's style.
- **`accountsSections`/`computeCashInvestment` diverging from the mock's cash-detection logic**: the mock uses `(p.symbol || '').toLowerCase() === 'cash'`; the codebase's own `computations.test.ts` fixtures already use `symbol: 'CASH'` as precedent — mitigate by writing T3's case 6 (case-insensitivity) explicitly against both `'CASH'` and `'cash'`/`'Cash'` symbol values to pin exact matching behavior.
- **`view` type widening breaking exhaustiveness elsewhere**: any other file doing an exhaustive switch/ternary on `state.view` besides `Nav.tsx`/`App.tsx`/`Settings.tsx` could silently fall through for `'accounts'`. Mitigate by grepping `state.view` and `AppState['view']` across `src/` during T8 before considering the wiring done (not just the 3 files named in scope).
- **`SettingsPage`'s new `setSettingsSection` prop being forgotten at a test call site**: TypeScript will catch missing required props at `npm run build` time (T13), but individual `vitest run` calls in earlier tasks might not surface it until then if a test file has type-looseness (e.g. `as any` casts) — mitigate by running `npx tsc -b --noEmit` (or trusting T13's full build) rather than assuming per-file vitest runs alone prove type-correctness.
- **Reference doc drift between `design.md` and `product-behavior.md`** on where `settingsSection` state now flows (to `SettingsPage`, not `Nav`) — mitigate via T14's explicit full-file re-read step after edits, checking both docs agree.
