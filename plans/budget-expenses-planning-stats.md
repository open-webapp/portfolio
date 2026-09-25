# Expenses tab: shared year selector, 3-year table, planning stats (drop Category Breakdown)

Goal: Expenses tab loses Category Breakdown card. Gains top-bar year `<select>` (shared `selectedScope` with Spend, budgeted years only, no All). Expenses table shows exactly 3 year columns (selected-1, selected, selected+1). 4 read-only planning stat cards above table (Planned spend, Planned savings rate, Monthly vs yearly, Plan changes), all derived by pure selectors.

Branch: `budget-expenses-planning-stats`. Worktree: `../worktree-budget-expenses-planning-stats`.

No `plans/_template.md` in repo — structure mirrors `plans/budget-move-expense-summary-cards-to-spend.md`.

## Current state (facts gathered)

Line numbers = snapshot at plan time. Re-grep before each edit.

- `src/App.tsx`
  - `PeriodSegControl` ~55-95: `.budget-year` div renders `<select className="input" aria-label="Select year">` only when `period === 'spend'`; options `All` (`__spend_all_years__`) + `availableYears`.
  - `selectedScope` state ~162-163 (init newest transaction year else `SPEND_ALL_YEARS`); hydration reset effect ~839-844.
  - `handleScopeChange` ~846-851: `setSelectedScope`, dispatch `ENSURE_BUDGET_YEAR_SNAPSHOT` when concrete year lacks `budgetExpenseAmountsByYear[scope]`.
  - `PeriodSegControl` props at ~957-959: `availableYears={spendBudgetYears(state.budgetTransactions)}`. `BudgetPage` gets `selectedScope`, `setSelectedScope` ~986.
- `src/components/BudgetPage.tsx`
  - Doc comment ~153-162 mentions Category Breakdown own year selector.
  - `availableYears = spendBudgetYears(...)` ~217. Reset-to-All effect ~239-243: runs for EVERY period (not gated) → would clobber Expenses-only years. Must gate to `period === 'spend'`.
  - Expenses branch ~692-693: `<BudgetExpensesTab state dispatch categories categoryDispatch />` — no scope prop today.
  - Spend `summary-cards` grid ~695+ with `.card.card-compact.blueprint.elev-sm` cards; bar markup pattern ~709 (Spend vs budget) and ~774 (`-bar` testids). Savings rate card ~728-764 (value colored `GAIN_COLOR`/`LOSS_COLOR`, pencil Edit income — NOT copied).
- `src/components/BudgetExpensesTab.tsx` (774 lines)
  - Imports ~8: `categoryBreakdown, availableBudgetYears, expenseTableYears, visibleExpenses`.
  - Doc comment ~78-86. `breakdownYear` state ~90-92. `expandedCategoryId` state ~110.
  - `breakdownTransactions`/`breakdown` ~138-144. `years = expenseTableYears(...)` ~145.
  - Category Breakdown card JSX ~211-~335 (testid `category-breakdown`, `Select breakdown year` select ~228-233, drilldown chevrons).
  - Expenses card ~331+; year header `years.map` ~382, amount cells `years.map` ~461. Amount edit → `SET_EXPENSE_AMOUNT`/`CLEAR_EXPENSE_AMOUNT` via `amount:${year}` field.
  - Download CSV uses `buildExpenseCsv` (`src/lib/expenseExport.ts`) → `expenseTableYears` (union years). SETTLED: export keeps every year; `expenseTableYears` stays for `expenseExport.ts`.
- `src/lib/selectors.ts`
  - `incomeCategoryIdSet` ~617, `budgetedIncomeForYear` ~644 (annualized via `toPeriod`).
  - `availableBudgetYears` ~782 (still used by `BudgetAnalytics.tsx:134` — keep).
  - `SPEND_ALL_YEARS` ~789, `spendBudgetYears` ~812.
  - `expenseTableYears` ~1125 — callers: `BudgetExpensesTab.tsx` (to drop) + `expenseExport.ts` (keep). So selector stays.
  - `categoryBreakdown` ~1144-1233 — only caller `BudgetExpensesTab.tsx`. Delete.
- `src/lib/computations.ts`: `toMonthly` ~53, `toYearly` ~57, `toPeriod` ~61.
- Tests
  - `src/lib/selectors.test.ts`: `describe('categoryBreakdown')` ~45-137 (delete), `describe('expenseTableYears')` ~139 (keep). Import line 2 includes `categoryBreakdown`.
  - `src/components/BudgetExpensesTab.test.tsx`: `renderTab` harness ~27-40 (no scope prop); `categoryRow` helper ~208 on `category-breakdown`; drilldown tests near there; ~307 "renders Category Breakdown above the Expenses table".
  - `src/components/BudgetPage.test.tsx`: local `BudgetPage` host ~20-48 renders `Select year` only for spend; ~244 asserts `summary-cards` absent on Expenses (→ new stats grid MUST use a different testid); ~251-255 "does not render the App-owned year scope selector".
  - `src/App.test.tsx` ~385-391: asserts `Select year` hidden on Expenses → flip.
- Root docs: `product-behavior.md` `## Budget` intro ~111-113, `### Expenses tab` ~115-126, `### Spend tab` ~137 (mentions Expenses Category Breakdown year), `### Year-scoped expense amounts` ~177-179. `design.md` `## Budget` ~11-29 (`categoryBreakdown()` bullet ~19, retained-card bullet ~29). `schema-spec.md` `## Budget storage` ~133 (breakdownYear + union-of-years), `## Category` excludeFromSpend row ~172, AppState UI fields ~348.
- Stray colocated docs `src/components/BudgetExpensesTab.design.md` (62 lines: API, Category Breakdown & Expenses Table, Expense CSV Download, Import Dialog, Import Flow, Identity And Scope, Category Drilldown) / `.product-behavior.md` (57 lines: Category Breakdown & Expenses Table, Expense CSV Download, Paste Import, Category Target, Duplicates And Mutation, Dialog Lifecycle, Category Drilldown). IN SCOPE: fold into root docs + `git rm` (T11a).

## Scope

In:
- Delete Category Breakdown card, drilldown, `breakdownYear`, `expandedCategoryId`, breakdown year select, `categoryBreakdown()` + its tests + UI tests.
- Top-bar year select also on Expenses (same markup/location/aria-label), options = budgeted years desc, no All, via `handleScopeChange`.
- Reconcile effect: Expenses + (`All` or non-budgeted scope) → current calendar year. Spend reset-to-All gated to Spend.
- Expenses table: fixed 3 columns selected-1..selected+1.
- New pure selectors + 4 stat cards (read-only, no dispatch).
- Docs: 3 root docs; fold `src/components/BudgetExpensesTab.design.md` + `.product-behavior.md` into root docs and `git rm` both.

Out: Spend tab cards/behavior (besides gating existing effect), Analytics, CSV export columns (settled: keep all years), import-expenses dialog `importYear`, other colocated docs (`BudgetPage.*`, `Nav.*`, `Settings.*`, `PortfolioPicker.*`, `BudgetAccountsTab.*` — follow-up only), copy-forward action, clickable cards, new CSS, `spendCardTotals` fix (see Deferred).

## Definitions (used by selectors)

- `Y` = selected year (string). `P` = `String(Number(Y) - 1)`.
- Income defs = defs whose `categoryId ∈ incomeCategoryIdSet(categories)`. Spend defs = all other defs. `excludeFromSpend` categories STILL counted (planned figures never affected).
- Annualized amount of def d in year y = `toYearly(amountsByYear[y]?.[d.id] ?? 0, d.frequency)`.
- "Has amount" in y = `amountsByYear[y]?.[d.id] !== undefined`.
- Planned spend(y) = Σ annualized over spend defs. Planned income(y) = `budgetedIncomeForYear(defs, amountsByYear, categories, y)`.

## Task graph

```
T0 -> T1 -> T2 -> T3 ─┐
T0 -> T4 ─────────────┤
T0 -> T5 -> T6 ───────┼-> T7 -> T8 -> T9 -> T10 -> T11a -> T11 -> T12
```
T1-T3 selectors (selectors.ts only, sequential — same file). T4 deletes breakdown (BudgetExpensesTab + selectors — run after T3 if single agent to avoid selectors.ts conflicts). T5/T6 App/BudgetPage wiring. T7+ BudgetExpensesTab UI (serial, same file).

---

### T1 — selectors: budgeted year list + table column years
Files: `src/lib/selectors.ts`, `src/lib/selectors.test.ts`.
- Write failing tests first, then add:
  - `expenseBudgetYears(amountsByYear: Record<string, Record<string, number>>, now: Date): string[]` — `Object.keys(amountsByYear)` ∪ `String(now.getFullYear())`, dedup, sort DESC (numeric-string compare).
  - `expenseTableColumnYears(selectedYear: string): [string, string, string]` — `[Y-1, Y, Y+1]` ascending strings.
- Tests:
  - happy: keys `{2024,2025}`, now 2026 → `['2026','2025','2024']`.
  - edge: `{}` → `[current]`; key == current year → no dup; future key `2028` included, sorted first.
  - `expenseTableColumnYears('2026')` → `['2025','2026','2027']`; `'2000'` → `['1999','2000','2001']`.
- Acceptance: `npx vitest run src/lib/selectors.test.ts` green; both exported.

### T2 — selectors: planned spend (A/C) + planned savings rate (B)
Deps: T1. Files: same.
- `plannedSpendSummary(definitions, amountsByYear, categories, year): { annual: number; monthly: number; prior: { annual: number; delta: number; pct: number | null } | null }`
  - `annual` = Planned spend(Y); `monthly` = annual/12.
  - `prior` = null when no spend def has amount in P (per Definitions "has amount"). Else `delta = annual - priorAnnual`, `pct = priorAnnual === 0 ? null : delta/priorAnnual*100`.
- `plannedSavingsRate(definitions, amountsByYear, categories, year): { income: number; spend: number; rate: number | null }` — `rate = income > 0 ? (income - spend)/income*100 : null`.
- Tests (failing first):
  - A: monthly 100 + yearly 1200 → annual 2400, monthly 200. Income def excluded from annual.
  - A: excludeFromSpend category def STILL counted.
  - C: prior 2000 / current 2400 → delta 400, pct 20. No prior-year amounts → `prior === null`. Prior with only income amounts → `prior === null`. Prior spend explicitly 0 → pct null, delta = annual.
  - B: income 10000 yearly, spend 2400 → rate 76. Income monthly 1000 → annualized 12000. No Income category / income 0 → rate null. Spend > income → negative rate.
- Acceptance: tests green; no dispatch/mutation; uses `toYearly`/`budgetedIncomeForYear`.

### T3 — selectors: frequency split (F) + plan changes (D/G)
Deps: T2. Files: same.
- `plannedFrequencySplit(definitions, amountsByYear, categories, year): { monthlyTotal: number; yearlyTotal: number; setAsidePerMonth: number }` — spend defs only; `monthlyTotal` = Σ raw amounts of `frequency==='monthly'` defs (per-month figure); `yearlyTotal` = Σ raw amounts of `frequency==='yearly'` defs; `setAsidePerMonth = yearlyTotal/12`.
- `planChanges(definitions, amountsByYear, categories, year): { increases: PlanChangeRow[]; decreases: PlanChangeRow[]; notCarriedOver: { count: number; names: string[] } }`, `PlanChangeRow = { expenseId; name; prior: number; current: number; delta: number; tag: 'new' | 'dropped' | null }`.
  - Per spend def: prior/current annualized (missing = 0); `delta = current - prior`; skip delta 0.
  - `increases` = delta>0 sorted delta desc, top 3; `tag 'new'` when prior===0.
  - `decreases` = delta<0 sorted delta asc (largest drop first), top 3; `tag 'dropped'` when current===0.
  - `notCarriedOver` = spend defs with amount in P and NO amount in Y (has-amount rule, not value); names sorted by name asc.
  - Tie-break: equal delta → name asc (deterministic tests).
- Tests (failing first):
  - F: mix monthly/yearly; income defs ignored; empty year → all 0.
  - D: 5 increases → only top 3, correct order; new line (P missing, Y 50) tagged `new`; dropped (P 100, Y missing) tagged `dropped` and delta −1200 if monthly; unchanged omitted; monthly vs yearly deltas annualized.
  - G: def in P but not Y → counted + named; Y amount set to 0 explicitly → NOT counted (has amount); none → count 0, names [].
  - Income defs never appear in D/G.
- Acceptance: tests green.

### T4 — remove Category Breakdown + `categoryBreakdown()`
Deps: T3 (same file `selectors.ts`; serial avoids conflicts).
- `src/components/BudgetExpensesTab.tsx`: delete Category Breakdown card JSX (testid `category-breakdown`), `breakdownYear`, `expandedCategoryId`, `breakdownTransactions`, `breakdown`, now-unused imports (`categoryBreakdown`, `availableBudgetYears`; also any chevron/drill-only helpers left unused — lint will flag). Update doc comment ~78-86.
- `src/lib/selectors.ts`: delete `categoryBreakdown` + its doc comment + any helper/type used only by it (grep after delete).
- `src/lib/selectors.test.ts`: delete `describe('categoryBreakdown')` + import.
- `src/components/BudgetExpensesTab.test.tsx`: delete drilldown tests + `categoryRow` helper; rewrite ~307 test → regression guard: `queryByTestId('category-breakdown')` null, `queryByText('Category Breakdown')` null, `queryByLabelText('Select breakdown year')` null.
- `src/components/BudgetPage.tsx` doc comment ~155: drop Category Breakdown mention.
- Tests: guard test fails before delete (write first), passes after. `grep -rn "categoryBreakdown\|breakdownYear\|category-breakdown" src --include='*.ts' --include='*.tsx'` → empty.
- Acceptance: vitest for both files green; `npm run lint` no unused-var errors.

### T5 — top-bar year select on Expenses (App.tsx)
Deps: T1.
- `src/App.tsx` `PeriodSegControl`: add prop `expenseYears: string[]`. Render select when `period === 'spend' || period === 'expenses'` — same `<select className="input" aria-label="Select year">` in `.budget-year`.
  - Spend: unchanged (All + `availableYears`).
  - Expenses: no All option; options `expenseYears`; `value={selectedScope === SPEND_ALL_YEARS ? '' : selectedScope}` (transient only — T6 reconcile fixes); onChange → `onScopeChange(event.target.value)`.
- Pass `expenseYears={expenseBudgetYears(state.budgetExpenseAmountsByYear, new Date())}`.
- Selecting still via `handleScopeChange` → `ENSURE_BUDGET_YEAR_SNAPSHOT` when missing snapshot (current year w/o snapshot case).
- `src/App.test.tsx` ~385-391: flip Expenses assertion → select present, no `__spend_all_years__` option, options = budgeted years desc. Analytics still absent. Add: select on Expenses a year → switch to Spend → same shared scope (if that year has transactions) — shared state proof.
- Tests: happy — Expenses shows select; edge — no amounts at all → single option current year; Analytics none.
- Acceptance: `npx vitest run src/App.test.tsx` green.

### T6 — shared-scope reconcile (BudgetPage.tsx)
Deps: T5.
- `src/components/BudgetPage.tsx`:
  - Gate existing reset-to-All effect (~239) with `period === 'spend'` (add `period` to deps). Without gate it ping-pongs with Expenses reconcile.
  - New prop `onScopeChange: (scope: SpendScope) => void` on `BudgetPageProps`; `src/App.tsx` passes `handleScopeChange` (~986 spread).
  - New effect: `if (period === 'expenses') { const years = expenseBudgetYears(state.budgetExpenseAmountsByYear, new Date()); if (selectedScope === SPEND_ALL_YEARS || !years.includes(selectedScope)) onScopeChange(String(new Date().getFullYear())) }` — real state change routed through `handleScopeChange`, so `ENSURE_BUDGET_YEAR_SNAPSHOT` dispatches when current year has no snapshot.
  - Pass `selectedYear={selectedScope === SPEND_ALL_YEARS ? currentYear : selectedScope}` to `<BudgetExpensesTab>` (guards the one render before effect lands).
- `src/components/BudgetPage.test.tsx`:
  - Update local host ~20-48: render select for expenses too (mirror App: budgeted years, no All), pass its `onScopeChange` (already mirrors `handleScopeChange`) as the new prop, so host matches production. Direct `BudgetPageUnderTest` renders (e.g. ~251) add `onScopeChange={vi.fn()}`.
  - Tests (failing first): (a) Spend at All → switch to Expenses → scope = current year; (b) scope `2019` (no amounts, has tx) → Expenses → current year; (c) Expenses on budgeted-only year `2027` (amounts, no tx) → stays 2027 (proves Spend reset gated); (d) then switch to Spend → resets to All (existing behavior); (e) clearing last amount of selected non-current year on Expenses → reconcile jumps to current year; (f) reconcile snapshot: amounts only in 2024 (no current-year key), scope All, switch to Expenses → dispatched actions include `ENSURE_BUDGET_YEAR_SNAPSHOT { year: <current> }` and scope = current year; (g) current year already has snapshot → reconcile dispatches NO `ENSURE_BUDGET_YEAR_SNAPSHOT`.
  - Keep ~251 "does not render App-owned year scope selector" (BudgetPageUnderTest still has no select) — just verify still true.
- Acceptance: BudgetPage.test green; no render loop (test (c) would hang/flip otherwise).

### T7 — Expenses table 3 fixed year columns
Deps: T4, T6.
- `src/components/BudgetExpensesTab.tsx`: add prop `selectedYear: string` to `BudgetExpensesTabProps`; replace `years = expenseTableYears(...)` with `expenseTableColumnYears(selectedYear)`. Drop `expenseTableYears` import (CSV export keeps its own call inside `expenseExport.ts`). Header/cell `years.map` unchanged; missing → `—` already.
- `BudgetExpensesTab.test.tsx` `renderTab`: add `selectedYear` param (default current year) — update all call sites.
- Tests (failing first):
  - selected 2026 → header year cells exactly `2025, 2026, 2027` in order, even with amounts in 2020/2030 (not shown).
  - No data anywhere → 3 columns, all cells `—`.
  - Click 2027 cell, type 50, Enter → action `SET_EXPENSE_AMOUNT {year:'2027'}`; `getState().budgetExpenseAmountsByYear['2027']` set; `expenseBudgetYears(getState().budgetExpenseAmountsByYear, now)` includes `2027`.
  - Clear-to-blank still `CLEAR_EXPENSE_AMOUNT` for that column year.
  - CSV download test (existing) unchanged → still union years (regression guard).
- Acceptance: tab tests green.

### T8 — stat cards 1-2 (Planned spend, Planned savings rate)
Deps: T2, T7.
- `BudgetExpensesTab.tsx`: above Expenses card add grid `<div data-testid="plan-stats-cards" style={{ display:'grid', gap:'var(--space-3)', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', marginBottom:'var(--space-4)' }}>` — copy exact grid style from BudgetPage `summary-cards` (~695); testid DIFFERENT from `summary-cards` (BudgetPage.test ~244 asserts `summary-cards` absent on Expenses).
- Card 1 `.card.card-compact.blueprint.elev-sm` `data-testid="plan-stat-spend"`: title "Planned spend"; `fmtUSD(annual)` /yr; `fmtUSD(monthly)` /mo; YoY line `+$X (+Y%) vs {P}` colored (increase = `LOSS_COLOR` red, decrease = `GAIN_COLOR` green); `prior===null` → `—` + "No prior-year plan"; pct null → show $ only.
- Card 2 `data-testid="plan-stat-savings"`: title "Planned savings rate"; `rate.toFixed(1)%` colored GAIN/LOSS by sign; 6px bar reused from Spend vs budget card (BudgetPage ~709, approved) `data-testid="plan-stat-savings-bar"` width clamp(rate,0,100)%; `rate===null` → `—` + "No income planned", no bar. No pencil.
- Tests (failing first): values for fixture; no prior → "No prior-year plan"; no income → "No income planned"; bar width style; no `button` inside cards; changing `selectedYear` prop re-derives.
- Acceptance: tab tests green; no dispatch from cards (actions array unchanged after render); card values come only from T2 selectors (own `toYearly` conversion) — no dependency on `spendCardTotals`/`projectedSpendForScope`.

### T9 — stat cards 3-4 (Monthly vs yearly, Plan changes)
Deps: T3, T8.
- Card 3 `data-testid="plan-stat-frequency"`: "Monthly vs yearly"; rows Monthly lines `fmtUSD(monthlyTotal)`/mo, Yearly lines `fmtUSD(yearlyTotal)`/yr, Set aside `fmtUSD(setAsidePerMonth)`/mo.
- Card 4 `data-testid="plan-stat-changes"`: "Plan changes vs {P}"; Increases list (≤3, `data-testid="plan-change-increase"` per row: name, `+fmtUSD(delta)` in `LOSS_COLOR` red, `.tag` "new" when tag new); Decreases list (≤3, `plan-change-decrease`, delta in `GAIN_COLOR` green, `.tag` "dropped"); G line `data-testid="plan-stat-not-carried"`: `N lines not carried over: a, b` else "All lines carried over". Empty increases+decreases → "No changes".
- Use existing `.tag`/`.tag-outline` classes only; no new CSS.
- Tests (failing first): 4 cards in `plan-stats-cards`; F numbers; top-3 cap; `new`/`dropped` tags; G text both branches; income def never listed; excludeFromSpend def listed.
- Acceptance: tab tests green; `plan-stats-cards .card` length 4; increase rows red / decrease rows green (assert style color); no `spendCardTotals` dependency.

### T10 — full gate
Deps: T9.
- `npm run test`, `npm run build`, `npm run lint`.
- `grep -rni watchlist src` → empty (standing rule).
- Test: all green. Edge — failure: fix in owning task file, rerun.
- Acceptance: 3 commands exit 0.

### T11a — fold colocated BudgetExpensesTab docs into root docs, `git rm` them
Deps: T10. Runs right before T11 (same doc sections; do together if single agent).
- Read `src/components/BudgetExpensesTab.design.md` + `src/components/BudgetExpensesTab.product-behavior.md` in full.
- Merge still-true content, rewritten to POST-change state, no duplication with what root already says:
  - design → `design.md` `## Budget` (API/props incl. new `selectedYear`, Expense CSV Download (`buildExpenseCsv` → `expenseTableYears`, all years), Import Dialog/Import Flow, Identity And Scope). Check `## Budget Expense CSV Export` (~31) first — merge into it, not duplicate.
  - behavior → `product-behavior.md` `### Expenses tab` (CSV download, Paste Import, Category Target, Duplicates And Mutation, Dialog Lifecycle).
  - DROP: Category Breakdown & Category Drilldown sections, `breakdownYear` lines (feature removed).
- `git rm src/components/BudgetExpensesTab.design.md src/components/BudgetExpensesTab.product-behavior.md`.
- Grep `src/` + root docs for refs to those paths (`grep -rn "BudgetExpensesTab\.\(design\|product-behavior\)" --include='*.md' --include='*.ts*' . | grep -v '^./plans'`) → fix/none.
- Do NOT touch `BudgetPage.*`, `Nav.*`, `Settings.*`, `PortfolioPicker.*`, `BudgetAccountsTab.*` colocated docs (follow-up).
- Test: `ls src/components/BudgetExpensesTab.*.md` → no match; each merged fact grep-findable in root doc; no section repeated.
- Acceptance: both files gone; root docs hold their valid content, terse, current state only.

### T11 — doc updates (root only)
Deps: T11a.
- `product-behavior.md`:
  - `## Budget` intro ~113: Expenses shares top-bar year select with Spend (budgeted years only, no All, reconciles to current year); remove "independent Category Breakdown year selector".
  - `### Expenses tab`: rewrite — elements = planning stat cards (4, describe A/B/C/D/F/G + empty states) then Expenses table; table = 3 columns Y-1/Y/Y+1; entering Y+1 creates that year → selectable. Delete Category Breakdown + drilldown bullets.
  - `### Spend tab` ~137: drop Category Breakdown reference; note shared `selectedScope` + reset-to-All only on Spend.
  - `### Year-scoped expense amounts`: replace Category Breakdown / multi-year table sentences; Expenses select goes through `ENSURE_BUDGET_YEAR_SNAPSHOT` same as Spend.
- `design.md` `## Budget`: remove `categoryBreakdown()` bullet (~19) + ~29 retained-card bullet; add Expenses scope bullet (PeriodSegControl `expenseYears`, BudgetPage reconcile effects, `selectedYear` prop) + new selector signatures (`expenseBudgetYears`, `expenseTableColumnYears`, `plannedSpendSummary`, `plannedSavingsRate`, `plannedFrequencySplit`, `planChanges`); note `expenseTableYears` now CSV-export only.
- `schema-spec.md`: `## Budget storage` ~133 bullet (drop `breakdownYear` / union-of-years; Expenses uses shared `selectedScope`, budgeted years, 3-col window); `## Category` `excludeFromSpend` row ~172: drop "Category Breakdown panel" clause; AppState UI fields ~348 check for scope/Expenses wording.
- Test: each edited section re-read matches code. Acceptance: no Category Breakdown mention left in root docs.

### T12 — grep sweep + full-file review
Deps: T11.
- `ls src/components/BudgetExpensesTab.*.md` MUST return nothing (colocated docs removed in T11a).
- **Mandatory grep sweep** of ALL 3 root docs (`design.md product-behavior.md schema-spec.md`) for: `categoryBreakdown`, `breakdownYear`, `Category Breakdown`, `category-breakdown`, `Select breakdown year`, `drillLines`, `unlinkedActual`, `expandedCategoryId`, `drilldown`, `expenseTableYears`, `union-of-years`, `availableBudgetYears`, `selectedScope`, `SPEND_ALL_YEARS`, `summary-cards`, `plan-stats-cards`, `Select year`, `BudgetExpensesTab.design.md`, `BudgetExpensesTab.product-behavior.md`, `onScopeChange`. Each hit must be accurate post-change; fix + re-sweep. Do not skip `schema-spec.md`.
- Full-file review (major change): re-read `product-behavior.md`, `design.md`, `schema-spec.md` Budget-related sections in full; fix inconsistencies/narrative drift.
- Re-run `npm run test` + `npm run build` if docs pass touched anything else.

## Test Strategy

- `selectors.test.ts`: pure unit tests for 6 new selectors (T1-T3), delete `categoryBreakdown` tests (T4); keep `expenseTableYears` tests (CSV export still uses).
- `BudgetExpensesTab.test.tsx`: breakdown-removal guard, 3-column window, Y+1 create, 4 stat cards + empty states, no-dispatch check.
- `BudgetPage.test.tsx`: reconcile via `onScopeChange` (dispatches `ENSURE_BUDGET_YEAR_SNAPSHOT` only when current-year snapshot missing), gated reset, shared scope across tabs, no render loop.
- `App.test.tsx`: select visible on Expenses w/o All, hidden on Analytics.
- Every behavior change: failing test first, then code (CLAUDE.md rule). Browser check optional supplement only.
- Gate: `npm run test`, `npm run build`, `npm run lint`.

## Risks

- **Effect ping-pong**: ungated Spend reset-to-All + Expenses reconcile → infinite flip. T6 gates Spend effect by period; test (c) guards.
- **Shared scope surprise**: Expenses picks budgeted-only year (e.g. 2027, no tx) → switch to Spend → reset to All. Accepted per requirement 3 (Spend keeps existing effect).
- **Clearing last amount in selected year** removes the year key (`clearExpenseAmount` never-empty rule) → year leaves budgeted list → reconcile jumps to current year mid-edit. Documented + tested (T6 e). Current year always stays listed.
- **Y+1 column snapshot**: editing Y+1 writes only that one pair (no eager clone) — Y+1 becomes a sparse year; later selecting it won't clone (snapshot exists). Matches existing per-cell semantics; call out in docs.
- **Spend vs Expenses numbers differ** until `spendCardTotals` fix lands (see Deferred) — expected; new cards annualize on their own.
- **Doc merge drift** (T11a): colocated docs may hold stale facts; verify each against code before moving, don't copy blindly.
- **Testid collision**: stats grid must not reuse `summary-cards` (BudgetPage.test ~244).
- **Line drift**: re-grep before edits.

## Done Means

- No Category Breakdown anywhere in `src/` (code/tests) or root docs; `categoryBreakdown` deleted.
- Expenses tab shows top-bar `Select year` (budgeted years desc, no All), shared with Spend; reconciles to current year when needed.
- Expenses table: exactly 3 year columns Y-1/Y/Y+1; Y+1 entry creates year.
- 4 read-only stat cards (`plan-stats-cards`) above table, from pure selectors, income/excludeFromSpend rules as defined.
- `src/components/BudgetExpensesTab.design.md`/`.product-behavior.md` folded into root docs and removed (`ls` empty).
- Root docs updated; grep sweep clean; test/build/lint green; committed.

## Deferred / follow-ups (out of scope)

- `spendCardTotals` (`src/lib/selectors.ts` ~1079) sums raw per-frequency amounts without `toPeriod`/`toYearly` → wrong budgeted spend for monthly lines; also flows into `projectedSpendForScope`. Separate fix plan.
- Dead `'amount'` sort branch in `visibleExpenses` (`src/lib/selectors.ts` ~503) — remove in follow-up.
- Other colocated docs (`src/components/BudgetPage.*`, `Nav.*`, `Settings.*`, `PortfolioPicker.*`, `BudgetAccountsTab.*` `.md`) → fold into root docs in follow-up.

## Open Questions

- None remaining.
