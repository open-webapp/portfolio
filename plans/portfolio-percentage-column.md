# Portfolio Percentage Column

Caveman plan. Add "% of Portfolio" column to dashboard positions table and PositionGroupOverlay. Small tasks, each one thing. Read top to bottom before starting task 1.

## Facts checked before writing this plan

- `filteredPortfolioTotal(state)` selector doesn't exist yet — will be new
- `fmtPct()` already exists in `computations.ts` (line ~90) and formats as signed (e.g. `"+1.20%"`); we'll create `fmtPortfolioPercent()` for unsigned one-decimal format
- `PositionsTable` receives `state` and calls `visiblePositions(state)` (~40); filtering logic is centralized there
- `visiblePositions()` already composes `getAccountsForCategory()` + `retirementFilter` (~100-110 in selectors.ts)
- `PositionGroupOverlay` receives `group` (aggregate key + underlying positions array), `accounts`, `dispatch`, `onClose` (~50 in PositionGroupOverlay.tsx)
- Table columns currently (left-to-right): Symbol, Asset Class, Shares, Cost Basis, Current Price, Amount Invested, Market Value, G/L, G/L %, Row-count badge
- Overlay columns currently: Account, Symbol, Name, Shares, Avg Cost, Current Price, Taxes, Override, Delete

## Design decisions locked in

- **Denominator**: sum of market values for positions matching both `category` filter (from Nav) AND `retirementFilter` (from header pills). If total ≤ 0, show "—".
- **Table display**: aggregate group's summed market value / filtered total
- **Overlay display**: each individual position's market value / filtered total
- **Formatting**: one decimal place, unsigned (no `+` prefix), always shown
- **Column placement**: new "% of Portfolio" column after Market Value in table; after Current Price in overlay
- **Column header**: "% of Portfolio"

## Tasks

### Task 1: Create `filteredPortfolioTotal()` selector
**Deps**: none

In `src/lib/selectors.ts`:
- Add new function `filteredPortfolioTotal(state: AppState): number`
- Reuse existing `getAccountsForCategory()` call to get accounts in current category
- Filter positions by `category` AND `retirementFilter` (copy the composition from `visiblePositions()`)
- Sum `computePosition(p, state).marketValue` across all filtered positions
- Return the sum (can be zero, negative, or positive)

**Test in task 5**

---

### Task 2: Add `fmtPortfolioPercent()` formatter
**Deps**: task 1 (just for reference)

In `src/lib/computations.ts`:
- Add `fmtPortfolioPercent(value: number, total: number): string`
- If `total <= 0`, return `"—"`
- If `total > 0`, return `((value / total) * 100).toFixed(1) + "%"`
- Example outputs: `"12.3%"`, `"0.5%"`, `"0.0%"`, `"-5.2%"`, `"—"`

Update `src/lib/computations.test.ts` with cases: positive, zero, negative numerator, zero/negative total.

---

### Task 3: Add "% of Portfolio" column to PositionsTable
**Deps**: task 1, task 2

In `src/components/PositionsTable.tsx`:
- Call `filteredPortfolioTotal(state)` once at the top (right after `visiblePositions()` call, ~line 40)
- Add new `<th>` header "% of Portfolio" after the "Market Value" column header
- In each aggregate group row, insert new `<td>` with `fmtPortfolioPercent(group.marketValue, total)` after the Market Value cell
  - `group.marketValue` is already computed by the grouping logic (sum of underlying positions' market values)
- No sorting needed for this column (keep display-only like Market Value, G/L, G/L %)

**Test**: Task 5

---

### Task 4: Add "% of Portfolio" column to PositionGroupOverlay
**Deps**: task 1, task 2

In `src/components/PositionGroupOverlay.tsx`:
- Accept `state: AppState` as a new prop (passed from `PositionsTable` where overlay is opened)
- Call `filteredPortfolioTotal(state)` once at the top of the component
- Add new `<th>` header "% of Portfolio" after the "Current Price" column header
- In each underlying position row, insert new `<td>` with `fmtPortfolioPercent(p.marketValue || 0, total)` after the Current Price cell
  - Use `computePosition(p, state).marketValue` to get the individual position's market value

**Test**: Task 5

---

### Task 5: Write and run tests
**Deps**: task 1, task 2, task 3, task 4

Create/update test cases:

**`src/lib/computations.test.ts`**:
- `fmtPortfolioPercent()` with positive, zero, negative values
- Zero/negative total cases

**`src/lib/selectors.test.ts`**:
- `filteredPortfolioTotal(state)` with category filter (All / Taxable / Non-Taxable)
- `filteredPortfolioTotal(state)` with retirement filter (All / Retirement / Non-Retirement)
- Combined category + retirement filter
- Zero total edge case
- Negative position market value (sum should include the negative)

**`src/components/PositionsTable.test.tsx`**:
- New "% of Portfolio" column renders with correct values
- Different category/retirement filter combinations produce different percentages
- Row percentages sum to approximately 100% (or near it, allowing for rounding)

**`src/components/PositionGroupOverlay.test.tsx`**:
- Each underlying position shows its individual percentage
- Overlay percentages match selector-computed percentages
- Negative position value shows negative percentage

Run: `npm run test` — all tests must pass

---

### Task 6: Update reference docs
**Deps**: task 3, task 4

**`product-behavior.md`** (Positions table section, ~lines 40-48):
- Add new column to the list: "% of Portfolio" (unsigned, one decimal, shows percentage of filtered portfolio total)
- Clarify in the section intro: "% of Portfolio reflects positions matching both the current category filter and retirement filter"
- Update the row-count description to note the badge is still the last column

**`design.md`** (Selectors section, ~lines 154-162):
- Add `filteredPortfolioTotal(state)` to the list
- One-liner: "Computes sum of market values for positions matching both category and retirement filters; denominator for the portfolio % display."

---

### Task 7: Commit
**Deps**: task 5, task 6

```bash
npm run test  # verify all tests pass
npm run lint  # verify oxlint passes
git add -A
git commit -m "feat: Add '% of Portfolio' column to positions table and overlay"
```

Commit message should reference both the table and overlay, note the filtering behavior.

---

## Test cases (final checklist)

- [ ] `filteredPortfolioTotal()` respects category filter
- [ ] `filteredPortfolioTotal()` respects retirement filter
- [ ] Combined filter: category + retirement together
- [ ] `fmtPortfolioPercent(12.345, 100)` → `"12.3%"`
- [ ] `fmtPortfolioPercent(-5, 100)` → `"-5.0%"`
- [ ] `fmtPortfolioPercent(0.5, 100)` → `"0.5%"`
- [ ] `fmtPortfolioPercent(50, 0)` → `"—"`
- [ ] `fmtPortfolioPercent(50, -10)` → `"—"`
- [ ] PositionsTable column renders and aligns after Market Value
- [ ] PositionGroupOverlay column renders and aligns after Current Price
- [ ] Toggle category filter → percentages recalculate
- [ ] Toggle retirement filter → percentages recalculate
- [ ] Row percentages in table sum to ~100% for sanity check

---

## Acceptance criteria

- ✓ New "% of Portfolio" column appears in PositionsTable after Market Value
- ✓ New "% of Portfolio" column appears in PositionGroupOverlay after Current Price
- ✓ All percentages respect both category and retirement filters
- ✓ Formatting: one decimal, unsigned, "—" when total ≤ 0
- ✓ All tests pass (`npm run test`)
- ✓ Linter passes (`npm run lint`)
- ✓ Reference docs updated (`product-behavior.md` + `design.md`)
- ✓ Changes committed with clear message
