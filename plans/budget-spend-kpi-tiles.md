# Budget Spend KPI Tiles

Caveman plan. Replace Spend tab's 5 messy summary cards with exactly 4 compact KPI tiles.
Shape mirrors `plans/budget-page-v2.md` (Facts checked / Decisions locked / Tasks w/ deps+tests+acceptance /
Test strategy / Risks / Open questions). No `plans/_template.md` in repo (checked).

## Facts checked (against `main` = `716270b`)

- `src/components/BudgetPage.tsx`
  - L17 imports `GAIN_COLOR`/`LOSS_COLOR` from `computations.ts`; L27-32 import `spendCardTotals`, `projectedSpendForScope`,
    `savingsRateByYear`, `expenseSummaryForScope`, `overBudgetCategoriesForScope`.
  - L117-150 local icons `FileIcon`/`SearchIcon`/`AlertTriangleIcon`/`ChevronRightIcon` — used ONLY by Expense Summary +
    Action items cards (verify w/ grep before delete).
  - L164 `recordSearch`/`setRecordSearch` local state; L276-293 search matches `formatSpendCategoryLabel(...)` text
    (`"{expense} ({category})"` / `"Uncategorized ({category})"`) → substring match on category name works.
  - L209-232: `totalExpense`/`totalActual` from `spendCardTotals`; `projectedSpend` from `projectedSpendForScope(..., new Date())`;
    `savingsRate` = `null` for All else `savingsRateByYear([year], ...)[0]`; `spendPct`.
  - L656-671 `commitIncome` (income pencil editor) — keep as-is.
  - L674-686 `expenseSummary`, `actionItems`, `percentOf` — remove.
  - L697-826 `summary-cards` grid (inline `style` grid) + 5 cards. Sankey (L828) + Spend records card (L838+) untouched.
  - L897-907 Search input `aria-label="Search records"`, onChange sets `recordSearch` + `setRecPage(0)`.
- `src/lib/selectors.ts`
  - L527 `excludedCategoryIdSet` (excludeFromSpend OR Income categories).
  - L747 `actualByCategory(transactions, definitions, categories)` — negated sums per effective category, excluded skipped.
  - L789 `SPEND_ALL_YEARS`, `SpendScope`; L812 `spendBudgetYears`; L817 `spendTransactionsForScope`.
  - L834 `perCategoryBudgetActual` (private) — budget per category = Σ years `toPeriod(amount, freq, 'yearly')` (ANNUALIZED).
  - L982 `overBudgetCategories` (red-only, sorted by overage desc, `Infinity` pctOver for zero budget).
  - L1006 `overBudgetCategoriesForScope` — pure delegate to `overBudgetCategories`. Only caller: BudgetPage + tests.
  - L1025 `expenseSummaryForScope` — only callers: BudgetPage + tests. Remove.
  - L1064 `spendCardTotals` — `budgetedSpend` sums RAW `amounts[def.id]` (NOT annualized) — inconsistent w/ L834 (see Q1).
  - L1094 `projectedSpendForScope` — null for All; straight-line `actual × periodDays / elapsedDays`; elapsed=0 → 0.
  - L1386 `savingsRateByYear(years, tx, cats, defs)` → `{year, pct, isPositive}[]`; pct 0 when income 0. Also used by
    `BudgetAnalytics.tsx:178` — do NOT change signature.
  - L660 `actualIncomeForYear`, L694 `yearTotalSpend` (excluded-aware).
- `src/lib/types.ts:91` `ExpenseDefinition { id, name, categoryId, frequency: 'monthly'|'yearly' }`;
  `BudgetTransaction.spendExpenseId?` links tx → definition.
- `src/lib/computations.ts:7-8` `GAIN_COLOR = '#1fa971'`, `LOSS_COLOR = '#e2574c'`; L53-63 `toMonthly`/`toYearly`/`toPeriod`.
- `src/styles/styles.css:122-125` `.card`, `.card-compact`. NO gain/loss/warning CSS custom props exist in `:root`
  (only accent/neutral/divider). Existing inline code uses `var(--color-warning, #c2410c)` fallbacks.
- Tests touching removed stuff:
  - `src/lib/selectors.test.ts` L2 import, L247-306 `projectedSpendForScope` block, L368-403 `expenseSummaryForScope` block,
    L405+ `overBudgetCategoriesForScope` block.
  - `src/components/BudgetPage.test.tsx` L7 import; L117 "renders five summary cards…"; L140 projected color test;
    L376 "…without changing all-years cards" (uses `summary-cards` textContent — keep testid); L515/529/545/557
    Expense Summary + Action items tests.
  - `src/components/BudgetExpensesTab.test.tsx` L332-337 negative asserts on `expense-summary-*`/`expense-action-*`.
- Docs: root `product-behavior.md` §"### Spend tab" L128-138; root `design.md` §"## Budget" L11-30 (L21 spendCardTotals,
  L26-29 Expense Summary/Action items + signatures). `schema-spec.md`: no hits for touched selectors today (still sweep).
- Colocated docs exist and are ALREADY stale (say "three summary cards"): `src/components/BudgetPage.design.md:28-29`,
  `src/components/BudgetPage.product-behavior.md:13-14`, plus `BudgetExpensesTab.*.md`, `BudgetAccountsTab.*.md`,
  `Nav.*`, `PortfolioPicker.*`, `Settings.*`. Violate CLAUDE.md root-only rule. NOT fixed here (see Q5).
- Branch state: current checkout `claude/friendly-hamilton-b9utz6` == `main` == `716270b`.

## Decisions locked

- Exactly 4 tiles, in order: **Spend vs budget**, **Projected** (label varies), **Savings rate**, **Over budget**.
- Container keeps `data-testid="summary-cards"`; tiles get `data-testid` `kpi-spend`, `kpi-projected`, `kpi-savings`,
  `kpi-over-budget`; over-budget rows `kpi-over-budget-item` (+ `data-status="over"|"projected"`), overflow line
  `kpi-over-budget-more`; pace marker `kpi-pace-marker`.
- Tile anatomy (every tile): `.kpi-label` → `.kpi-value` (one main number) → optional `.kpi-bar` → `.kpi-context` (one line).
  Over budget tile: list (≤3 rows) sits in the context slot, fixed max height so row height stays uniform. No nested cards.
- Tile class: `card card-compact blueprint elev-sm kpi`. Grid class `.kpi-grid` (4 cols desktop, 2 cols ≤900px,
  1 col ≤520px; `grid-auto-rows: 1fr` → uniform height). No inline `style` in tiles except the bar fill `width` % and
  marker `left` % (dynamic values; unavoidable).
- New CSS tokens (added to `:root` in styles.css, section comment "KPI tiles"): `--color-gain: #1fa971`,
  `--color-loss: #e2574c` (= `GAIN_COLOR`/`LOSS_COLOR`), `--color-warning: #c2410c`. Classes: `.kpi-grid`, `.kpi`,
  `.kpi-label`, `.kpi-value`, `.kpi-context`, `.kpi-bar`, `.kpi-bar-fill`, `.kpi-bar-fill.is-gain`, `.kpi-bar-fill.is-loss`,
  `.kpi-bar-marker`, `.kpi-gain`, `.kpi-loss`, `.kpi-warn`, `.kpi-list`, `.kpi-list-item`, `.kpi-dot.is-over`,
  `.kpi-dot.is-projected`, `.kpi-link` (button reset, looks like text link).
- **Scope kind** helper: `spendScopeKind(scope, asOf): 'all' | 'current' | 'past' | 'future'` — `current` iff
  `scope === String(asOf.getFullYear())`; lexical compare else. `future` renders like `past` (plain compare) — see Q3.
- **Elapsed fraction** (current year only): `elapsedDays = floor((asOfLocalDay − Jan1)/day) + 1` (INCLUSIVE of today,
  so Jan 1 = 1/365, never 0), `fraction = elapsedDays / daysInYear`, clamped to `(0, 1]`. No minimum-days gate.
  Changes existing "zero projection on first day" behavior (test updated in T3).
- **Budget basis**: annualized — `toYearly(amount, def.frequency)` summed over non-excluded definitions, per year in scope
  (matches `perCategoryBudgetActual`, Sankey, over-budget). Applied to `spendCardTotals.budgetedSpend` too (see Q1 —
  behavior change for monthly definitions; flagged).
- **Frequency-aware projection** (current year): per tx in year, non-excluded: if `spendExpenseId` → def with
  `frequency === 'yearly'` → counted at actual; else (monthly-linked or unlinked) → `actual / fraction`.
  `projected = Σ yearlyActual + Σ otherActual / fraction`. Past year → projected = actual. All → null (not used).
- **Pace** (current year): `expectedByToday = Σ monthlyDefBudget × fraction + Σ_yearlyDefs min(yearlyDefActual, yearlyDefBudget)`.
  Rationale: yearly bills are lumpy; paying one within its budget is "on pace". Bar green iff `actual ≤ expectedByToday`,
  red otherwise. Marker at `expectedByToday / budget` (clamped 0-100%). See Q2.
- Past year / All: bar green iff `actual ≤ budget`, no marker.
- Projected tile modes:
  - current: label "Projected year-end", value `fmtUSD(projected)`, context `"{|pct|}% over|under budget"` (`.kpi-loss`
    / `.kpi-gain`); budget 0 → context "No budget set".
  - past: label "Final vs budget", value `fmtUSD(|budget − actual|)`, context `"under budget"` / `"over budget"`
    (colored); exactly equal → "on budget".
  - all: label "Avg yearly spend", value `fmtUSD(totalActual / yearsInScope)`, context
    `"vs {fmtUSD(totalBudget / yearsInScope)} avg yearly budget"`; 0 years → value `$0.00`.
- Savings rate: per-year = unchanged `savingsRateByYear`; All = new `savingsRateForScope` aggregate
  `(Σincome − Σspend)/Σincome × 100` over `spendBudgetYears(tx)`; Σincome ≤ 0 → `null` → "N/A". Pencil + editor
  unchanged, hidden for All. Context line: `"{fmtUSD(income)} income · {fmtUSD(spend)} spent"`.
- Over budget: extend `overBudgetCategoriesForScope` with optional 6th arg `asOfDate?: Date`. Return type widens to
  `Array<{ categoryId; label; overageAmount; pctOver; status: 'over' | 'projected' }>`. `'over'` rows = today's result.
  `'projected'` rows only when `asOfDate` given AND scope is current year AND category not already over: per-category
  frequency-aware projection > category budget; `overageAmount` = projected − budget, `pctOver` likewise (∞ if budget 0).
  Sort: all `'over'` rows first by overage desc, then `'projected'` by projected overage desc (ties → label asc).
  `overBudgetCategories` (non-scoped) untouched.
  - Tile: value = count (red+amber); context lists top 3 rows: dot (red/amber) + category-name button (`.kpi-link`) +
    `+{fmtUSD(overage)} ({pct|∞}%)`; then `"+N more"` if >3. Empty → value `0`, context "All categories on track".
  - Click name → `setRecordSearch(label)` + `setRecPage(0)` (same as typing in Search box), then `scrollIntoView({ block: 'start' })` on the Spend records card (ref; guard for jsdom where it's undefined). Test: click → search value = label, page 1, scrollIntoView called.
- Removed: `expenseSummaryForScope`, `ExpenseSummaryTransaction` type, `percentOf`, 4 dead icons (if grep-confirmed unused),
  all `expense-summary-*` / `expense-action-item(s)` testids + their tests.
- Out of scope: Analytics tab, `BudgetSankey`, Spend records table behavior, Expenses tab, colocated `*.md` doc cleanup.

## Tasks

### T0 — Create git worktree
- Deps: none.
- Do: `cd /home/user/portfolio && git worktree add ../worktree-budget-spend-kpi-tiles -b budget/spend-kpi-tiles main`;
  `cd ../worktree-budget-spend-kpi-tiles && npm install` (or symlink node_modules if install slow); `npm run test` baseline.
- Test: baseline suite green before any change (record count).
- Accept: worktree exists on branch `budget/spend-kpi-tiles`; baseline tests pass; all later tasks run inside it.

### T1 — selectors: scope kind + elapsed fraction helpers
- Deps: T0.
- Files: `src/lib/selectors.ts`, `src/lib/selectors.test.ts`.
- Do: add `spendScopeKind(scope, asOf)` and `yearElapsedFraction(year, asOf): number` (inclusive-day rule above,
  leap-year aware via `Date.UTC`). Export both.
- Tests: All → 'all'; current/past/future; Jan 1 → 1/365; Dec 31 → 1; leap year Dec 31 2024 → 366/366; asOf in other
  year clamps (past year → 1, future year → smallest positive? — only called for current; assert current only).
- Accept: pure, no Date.now usage; tests green.

### T2 — selectors: annualize `spendCardTotals.budgetedSpend`
- Deps: T0. (Blocked on Q1 answer only if user vetoes default.)
- Files: `src/lib/selectors.ts` L1064, `src/lib/selectors.test.ts` L38/202-238, `src/components/BudgetPage.test.tsx` L117.
- Do: budget per def = `toYearly(amounts[def.id] ?? 0, def.frequency)`.
- Tests: monthly def 500 → budgetedSpend 6000; yearly 500 → 500; excluded category still skipped; All sums years.
  Update existing expectations that relied on raw monthly amount.
- Accept: Spend-vs-budget budget == Σ `perCategoryBudgetActual` budgets for same scope (add 1 cross-check test).

### T3 — selectors: frequency-aware projection core + rewrite `projectedSpendForScope`
- Deps: T1, T2.
- Files: `src/lib/selectors.ts`, `src/lib/selectors.test.ts` L247-306.
- Do: private `projectedSpendByCategory(definitions, transactions, categories, year, asOf): Record<catId, { actual; projected }>`
  (rule in Decisions; excluded cats skipped; effective category via `effectiveCategoryId`). `projectedSpendForScope`
  sums it for current year; past year → projected = actual; All → null. Keep return shape
  `{ projectedTotal, budgetTotal, pctOver, isOverBudget }`.
- Tests: yearly-linked $1200 paid Jan + asOf Jul 1 → counted 1200 not ×2; monthly-linked $600 at fraction .5 → 1200;
  unlinked extrapolated; mixed; Jan 1 (fraction 1/365) no div-by-zero; excluded/Income category ignored; past year →
  actual; All → null; budget 0 → pctOver 0, isOverBudget iff projected>0. Replace old "zero on first day" test.
- Accept: old straight-line-only tests rewritten; all green.

### T4 — selectors: `spendPaceForScope`
- Deps: T1, T2.
- Files: `src/lib/selectors.ts`, `src/lib/selectors.test.ts`.
- Do: `spendPaceForScope(definitions, amountsByYear, transactions, categories, scope, asOf): { actual; budget;
  pctOfBudget; expectedByToday: number | null; isOnTrack: boolean }`. `expectedByToday` only for current year (formula in
  Decisions); `isOnTrack` = `actual ≤ (expectedByToday ?? budget)`. Reuse `spendCardTotals` for actual/budget.
- Tests: monthly $100/mo def (budget 1200), fraction .5, actual 500 → expected 600, on track; actual 700 → off track;
  yearly $1000 def paid $1000 in Feb + fraction .2 → expected includes 1000, on track; yearly paid 1100 > budget →
  expected caps at 1000 → off track if nothing else; past year → expected null, compares vs budget; All same;
  budget 0 → pctOfBudget 0, off track iff actual>0.
- Accept: tests green; no UI change yet.

### T5 — selectors: `savingsRateForScope`
- Deps: T0.
- Files: `src/lib/selectors.ts`, `src/lib/selectors.test.ts`.
- Do: `savingsRateForScope(transactions, categories, definitions, scope): { pct; isPositive; income; spend } | null`.
  Year → reuse `actualIncomeForYear`/`yearTotalSpend`; null when income ≤ 0 (component shows N/A). All → sums over
  `spendBudgetYears(transactions)`. Leave `savingsRateByYear` untouched (Analytics uses it).
- Tests: single year equals `savingsRateByYear` pct; All = (Σinc−Σspend)/Σinc across 2 years (NOT avg of per-year pcts —
  assert with years of unequal income); negative rate isPositive false; no income → null; excluded categories ignored.
- Accept: tests green.

### T6 — selectors: extend `overBudgetCategoriesForScope` w/ projected (amber) rows
- Deps: T3.
- Files: `src/lib/selectors.ts` L1006, `src/lib/selectors.test.ts` L405+.
- Do: add optional `asOfDate?: Date`; add `status` field; compute amber per Decisions using `projectedSpendByCategory` +
  per-category annualized budget from `perCategoryBudgetActual`. Update JSDoc.
- Tests: no asOfDate → identical rows to today + `status:'over'`; current-year category under now but projected over →
  amber w/ projected overage; yearly-linked lump within budget → NOT amber; already-over category appears once (red);
  past year / All + asOfDate → no amber; zero-budget + spend → red ∞ (unchanged); sort red-first then amber; excluded
  category never listed.
- Accept: existing callers compile; tests green.

### T7 — remove `expenseSummaryForScope` + dead tests
- Deps: T0.
- Files: `src/lib/selectors.ts` L1015-1061, `src/lib/selectors.test.ts` (import L2 + L368-403),
  `src/components/BudgetPage.test.tsx` (import L7, tests L515-555), `src/components/BudgetExpensesTab.test.tsx` L332-337.
- Do: delete fn + `ExpenseSummaryTransaction` type + tests. In BudgetExpensesTab test, replace negative asserts with
  `queryByTestId('summary-cards')` null (Expenses tab still has no KPI tiles). Leave BudgetPage.tsx usage until T9
  (do T7 + T9 in same working session; tsc will fail between — OK, don't commit mid-way).
- Tests: `grep -rn 'expenseSummaryForScope\|expense-summary\|expense-action' src` → only BudgetPage.tsx (gone after T9).
- Accept: selectors tests green.

### T8 — styles.css: KPI tokens + classes
- Deps: T0.
- Files: `src/styles/styles.css` (tokens in `:root`; classes after `.card-compact` block ~L125).
- Do: add tokens + classes listed in Decisions. `.kpi` min-height fixed (e.g. 148px) + `justify-content: space-between`;
  `.kpi-value` 24px/600 tabular-nums; `.kpi-bar` 6px, `--color-divider` track, radius 3px, `position: relative`;
  `.kpi-bar-marker` 2px wide absolute tick, `--color-text`; `.kpi-list` max 3 rows, `overflow: hidden`; `.kpi-link`
  button reset. Media queries per Decisions. Don't touch other design-bundle rules.
- Tests: none automated (CSS); manual check in T10.
- Accept: no existing rule edited; only additions (diff shows `+` lines only in styles.css).

### T9 — BudgetPage.tsx: render 4 KPI tiles
- Deps: T3, T4, T5, T6, T7, T8.
- Files: `src/components/BudgetPage.tsx`.
- Do:
  - Replace L697-826 grid w/ `<div data-testid="summary-cards" className="kpi-grid">` + 4 tiles per Decisions.
  - Compute once per render: `const asOf = new Date()`; `scopeKind`, `pace = spendPaceForScope(...)`,
    `projected = projectedSpendForScope(...)`, `savings = savingsRateForScope(...)`,
    `overRows = overBudgetCategoriesForScope(..., asOf)`.
  - Projected-tile All mode: years = `spendBudgetYears(spendTransactionsForScope(tx, scope)).length`, avg from `pace`.
  - Past-year mode reads `pace.actual`/`pace.budget`.
  - Over-budget name click: `setRecordSearch(row.label); setRecPage(0)`.
  - Delete `expenseSummary`, `actionItems`, `percentOf`, `spendPct`, old `savingsRate`, now-unused imports, and the 4
    icons if `grep` shows no other use. Colors via classes only (drop `GAIN_COLOR`/`LOSS_COLOR` imports if unused).
  - Keep `rangeLabel` in Spend-vs-budget label: `"Spend vs budget ({rangeLabel})"`.
- Tests (T10 writes them): see T10.
- Accept: `npm run build` (tsc) + `npm run lint` clean; no `style=` inside `.kpi` except bar width/marker left.

### T10 — BudgetPage.test.tsx: KPI tile tests
- Deps: T9.
- Files: `src/components/BudgetPage.test.tsx` (rewrite L117, L140, L557; keep L376 as-is — must still pass).
- Tests (use `vi.useFakeTimers` + `setSystemTime` for current-year cases):
  1. Exactly 4 `.kpi` tiles in `summary-cards`; no `.card .card` nesting; testids present.
  2. Spend tile current year: pace marker rendered; fill has `is-gain` when under pace, `is-loss` when over.
  3. Spend tile past year + All: no `kpi-pace-marker`; gain/loss vs budget.
  4. Projected tile: current → "Projected year-end" + "% under budget"; yearly-linked lump not extrapolated (value check);
     past → "Final vs budget" + "under budget $X"; All → "Avg yearly spend" + avg budget context.
  5. Savings: per-year value + pencil present; All → aggregate value, no `Edit income` button; existing income-edit
     tests (L159, L181) still pass unchanged.
  6. Over budget: red + amber rows w/ `data-status`; >3 → exactly 3 rows + "+N more"; zero budget → "∞%"; empty →
     "All categories on track"; count = red+amber.
  7. Click category name → `Search records` input value === label, records table filtered, page reset.
  8. Excluded category spend changes no tile value (extend/keep L376 test).
- Accept: `npx vitest run src/components/BudgetPage.test.tsx` green.

### T11 — Docs: product-behavior.md + design.md
- Deps: T9.
- Files: root `product-behavior.md` §"### Spend tab" (L128-138), root `design.md` §"## Budget" (L21, L26-29).
- Do:
  - product-behavior: replace 5-card list w/ 4 KPI tiles: labels per scope, pace marker rule, projection rule
    (yearly-linked at actual, others extrapolated, inclusive-day fraction), savings All aggregate + pencil hidden,
    over-budget red/amber, top 3 + "+N more", ∞%, click → Search, empty text, testids, excludeFromSpend rule, annualized
    budget. Remove Expense Summary/Action items text. Fix "Actual spend summary card" reference in Spend records bullet.
  - design: replace Expense Summary/Action items bullet w/ KPI tile bullet + new selector signatures
    (`spendScopeKind`, `yearElapsedFraction`, `spendPaceForScope`, `savingsRateForScope`, `projectedSpendForScope`
    frequency-aware, `overBudgetCategoriesForScope(..., asOfDate?)` w/ `status`); note `spendCardTotals` annualizes;
    note `.kpi-*` classes + `--color-gain/-loss/-warning` tokens.
  - Terse, current-state only.
- Accept: full re-read of both sections — no stale mention of 5 cards / Expense Summary / Action items.

### T12 — Gate: full tests + lint + build + mandatory grep sweep
- Deps: T10, T11.
- Do: `npm run test && npm run lint && npm run build`. Then grep ALL THREE root docs for every touched identifier:
  `grep -n 'expenseSummaryForScope\|ExpenseSummaryTransaction\|expense-summary\|expense-action\|Expense Summary\|Action items\|percentOf\|spendCardTotals\|projectedSpendForScope\|overBudgetCategoriesForScope\|savingsRateByYear\|savingsRateForScope\|spendPaceForScope\|spendScopeKind\|yearElapsedFraction\|summary-cards\|kpi-\|card-compact\|five\|5 cards\|Projected spend' design.md product-behavior.md schema-spec.md`
  — every hit must describe current behavior; fix stale ones. Also `grep -rni watchlist src/` → empty.
  Also `grep -rn 'expenseSummaryForScope\|expense-summary\|expense-action' src` → empty.
- Accept: all green; sweep clean. Any failure → fix, re-run (don't proceed).

### T13 — Commit, merge to main, tear down worktree
- Deps: T12.
- Do (in worktree): `git add -A && git commit` (msg "Replace Spend summary cards with 4 KPI tiles" + attribution
  lines from session). Then `cd /home/user/portfolio && git checkout main && git merge --ff-only budget/spend-kpi-tiles`
  (fallback `--no-ff` if main moved), `git worktree remove ../worktree-budget-spend-kpi-tiles`,
  `git branch -d budget/spend-kpi-tiles`. Re-run `npm run test` on main. NEVER push.
- Accept: `main` has commit; `git worktree list` shows only main checkout; tests green on main.

## Dependency graph

```
T0 ─┬─ T1 ─┬─ T3 ─ T6 ─┐
    ├─ T2 ─┤           │
    │      └─ T4 ──────┤
    ├─ T5 ─────────────┼─ T9 ─┬─ T10 ─┐
    ├─ T7 ─────────────┤      └─ T11 ─┴─ T12 ─ T13
    └─ T8 ─────────────┘
```
Parallel-safe batches: {T1,T2,T5,T7,T8} → {T3,T4} → {T6} → {T9} → {T10,T11} → T12 → T13.
(T3/T4/T6 all edit selectors.ts — serialize edits to that file if run by parallel agents.)

## Test strategy

- Selector math unit-tested in `selectors.test.ts` with explicit `asOf` Dates (never real clock).
- Component tests use fake timers for current-year behavior; assert via testids/classes (`is-gain`/`is-loss`,
  `data-status`), not inline colors.
- Regression: L376 excluded-rows test, income editor tests (L159/L181), Sankey placement test (L52) must pass unmodified.
- Analytics tests untouched (proves `savingsRateByYear` unchanged).

## Risks

- Annualizing `spendCardTotals` (T2) shifts Spend-vs-budget numbers for users with monthly definitions — intentional
  consistency fix, but user-visible. Q1.
- Pace formula for yearly items is a judgment call (Q2); easy to swap inside `spendPaceForScope`.
- `new Date()` in render: tiles for current year change at midnight; acceptable (existing behavior).
- Uniform row height + long category names: `.kpi-list-item` must `text-overflow: ellipsis`, not wrap.
- `recordSearch` substring on category label also matches descriptions/tags containing that word — acceptable (it's the
  same Search box); document it.
- `BudgetExpensesTab.test.tsx` negative asserts lose meaning — replaced in T7.

## Resolved questions (user-confirmed)

1. Budget basis: annualize (`toYearly`) everywhere (T2). Spend-vs-budget numbers change for monthly definitions — accepted.
2. Pace: `expected = monthlyBudget × fraction + min(yearlyActual, yearlyBudget)`.
3. Future-dated scope years render like past years (plain compare, "Final vs budget").
4. Over-budget click: set Search + reset page + scroll Spend records card into view.
5. Colocated `src/components/*.md` docs: out of scope; leave untouched.
6. Savings rate context line `income $X · spent $Y`: keep.
