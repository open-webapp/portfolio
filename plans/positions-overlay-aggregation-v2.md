# Positions overlay columns + aggregation key v2

No `_template.md` file exists in `plans/` (checked, does not exist — same finding as prior plan
`plans/positions-aggregate-by-symbol.md`). Structure follows the convention used by other files in
`plans/` (overview / facts / numbered tasks with deps / test cases / acceptance criteria).

## Goal

Four independent-but-related changes to the Positions overlay + aggregation, all in
`src/components/PositionGroupOverlay.tsx` and `src/components/PositionsTable.tsx`:

1. Overlay table: drop computed columns (Amount Invested, Market Value, G/L, G/L%), rename
   "Cost Basis" header to "Avg Cost", add new editable "Name" column after Symbol.
2. Overlay `AccountDropdown`: two-line plain-text display (`institution — name` / `taxCategory •
   retirement`), drop `accountNumber` entirely.
3. Overlay row sort: institution first, then name (fallback accountNumber), instead of name-only.
4. Aggregation key in `PositionsTable.tsx`'s `buildGroupKey`: drop `taxCategory`/`retirement` from
   the key — new key is `symbol|effectiveAssetClass` only. Positions with the same symbol+asset
   class now merge into one row regardless of account/tax-category/retirement.

Files touched:
- `src/components/PositionGroupOverlay.tsx`
- `src/components/PositionGroupOverlay.test.tsx`
- `src/components/PositionsTable.tsx`
- `src/components/PositionsTable.test.tsx`
- `product-behavior.md`
- `design.md`

Out of scope: `src/lib/computations.ts` (computePosition unchanged, still used elsewhere),
`src/components/AssetClassOverrideSelect.tsx`, `src/components/ClosedPositionsTable.tsx`,
`src/lib/selectors.ts` (`visiblePositions` filtering unaffected — filtering by category/retirement
still happens upstream of grouping), `plans/positions-aggregate-by-symbol.md` and
`plans/positions-overlay-editable-entries.md` (historical, do not edit).

## Facts confirmed by reading code first

- `src/lib/types.ts` line 1: `TaxCategory = 'taxable' | 'nonTaxable' | 'taxDeferred'`.
- `src/lib/types.ts` lines 6-14: `Account = { id, accountNumber, name, institution, taxCategory,
  retirement, createdAt }`. `institution: string`, always present (see
  `plans/accounts-institution-attribute.md`, already merged).
- `src/components/import/ImportDialog.tsx` lines 21-25 already defines:
  ```ts
  const TAX_CATEGORY_LABELS: Record<TaxCategory, string> = {
    taxable: 'Taxable',
    nonTaxable: 'Non-Taxable',
    taxDeferred: 'Tax-Deferred',
  }
  ```
  Not exported. `PositionGroupOverlay.tsx` needs its own local copy (or export+import — plan uses a
  local const to avoid touching `ImportDialog.tsx`, since exporting risks unrelated coupling).
  Values match the spec exactly ("Taxable"/"Non-Taxable"/"Tax-Deferred") — reuse this exact mapping.
- `PositionGroupOverlay.tsx` current structure (all line numbers pre-change, from current file):
  - `EditableCell` (lines 14-96): generic numeric editable cell, `field: 'shares' | 'avgCost' |
    'price' | 'taxes'`. Not touched by this plan.
  - `EditableTextCell` (lines 98-160): hardcodes `patch: { symbol: trimmed }` at line 121. Only
    caller today is the Symbol column (line ~395-399). Needs a `field` prop to support Name too.
  - `AccountDropdown` (lines 162-251): closed-button display at lines 174-176 (`accountDisplay`),
    dropdown list item at lines 241-244 (`account.name` bold + `#accountNumber` muted). Both need
    rewriting.
  - `sortedPositions` comparator (lines 280-288): sorts by `account.name || account.accountNumber`
    only, via `localeCompare`. Needs institution-first tiebreak.
  - Table header row (lines 370-382): 11 `<th>`s — Account, Symbol, Shares, Cost Basis, Current
    Price, Taxes, Amount Invested, Market Value, G/L, G/L%, Override.
  - Table body row (lines 385-442): renders `EditableTextCell` for Symbol (no Name), 4 computed
    `<td>`s at lines 433-438 bound to `p.costBasisStr`/`marketValueStr`/`glStr`/`glPctStr`.
  - `computedPositions` map (lines 291-312) still computes `costBasisStr`/`marketValueStr`/
    `glColor`/`glStr`/`glPctStr` via `computePosition(p)` — these become unused by the JSX after
    column removal; harmless to leave computed (still cheap) but plan removes the now-dead string
    fields to avoid lint/dead-code drift (oxlint doesn't flag unused object props, but keep clean).
- `PositionsTable.tsx` `buildGroupKey` (lines 22-32): takes `(position, accounts)`, looks up
  `account`, branches on `!account` for sentinel key. Only caller is `buildAggregateRows` (line 72:
  `const key = buildGroupKey(p, accounts)`). `accounts` param in `buildAggregateRows` (line 67) is
  **also** used at line 103 for `accountCount` — but that line computes `accountCount` directly
  from `groupPositions.map(p => p.accountId)`, **not** via `accounts` — so `accounts` param in
  `buildAggregateRows` itself is otherwise unused except passing to `buildGroupKey`. Confirmed via
  full read: after `buildGroupKey` drops the `accounts` param, `buildAggregateRows`'s `accounts`
  param becomes fully unused too. Decision: keep `buildAggregateRows(positions, accounts)`
  signature unchanged (it's called from `PositionsTable` render body at line 131 as
  `buildAggregateRows(positions, state.accounts)` — changing its signature ripples further than
  needed and `accounts` is still a meaningful/expected param for an aggregate-rows builder even if
  currently unused internally); only `buildGroupKey`'s signature drops to `(position: Position):
  string`. Call site at line 72 becomes `buildGroupKey(p)`.
- `PositionsTable.test.tsx`: existing tests referencing old grouping behavior needing changes —
  `does not aggregate positions with different tax categories` (line 136), `does not aggregate
  positions with different retirement status` (line 215). Tests that should still pass unchanged:
  `aggregates positions from different accounts with same grouping fields` (line 21), `does not
  aggregate positions with different asset classes` (line 294), `renders single-position group with
  correct account count badge` (line 367), `sorts aggregate rows by market value (post-aggregation)`
  (line 808), `displays correct account count in badge` (line 893).
- `PositionGroupOverlay.test.tsx`: `does not allow editing of computed columns` (line 378) needs
  rewrite to assert absence of the removed columns instead. `accountNumber: '001'`/`'002'` fixtures
  at lines 33, 487 stay in `createTestAccount` calls (accountNumber remains a valid `Account` field,
  just no longer displayed in this component) — only assertions on rendered dropdown text change.
- `product-behavior.md` "## Positions table" section, current lines 40-49 (verified via Read):
  line 42 names the old 4-part group key; line 47 is the long overlay-behavior bullet naming
  Amount Invested/Market Value/G/L/G/L%/Override columns, `${name} • #{accountNumber}`-style
  dropdown (implied by "Account (dropdown button listing all accounts...)"), "sorted by account
  name ascending, fallback account number", and the `symbol + effectiveAssetClass + taxCategory +
  retirement` group-key side-effect sentence.
- `design.md` line 115: `PositionsTable` bullet names old 4-part key in prose. Line 117:
  `PositionGroupOverlay` bullet lists old editable-cells prose including Account dropdown format,
  Computed columns sentence, and `buildGroupKey()` result phrase. Line 157 (Data flow /
  Selectors section): also names `symbol+effectiveAssetClass+taxCategory+retirement` — a third spot,
  found via grep, not mentioned in the task brief's line-117-only assumption. Must fix all three
  (115, 117, 157), plus re-grep after edits to confirm no stragglers.

## Tasks

### T0. Create isolated worktree (no deps)
- Run: `git worktree add ../worktree-positions-overlay-aggregation-v2 -b positions-overlay-aggregation-v2/implement`
- `cd` into `/Users/mdoraiswamy/owa/portfolio/../worktree-positions-overlay-aggregation-v2`
  (i.e. `../worktree-positions-overlay-aggregation-v2` relative to repo root).
- All subsequent tasks operate inside that worktree, not the original checkout.
- Acceptance: `git worktree list` shows the new worktree; `git status` inside it is clean on new
  branch `positions-overlay-aggregation-v2/implement`.

### T1. Confirm TaxCategory/TAX_CATEGORY_LABELS values (deps: T0)
- Grep `TaxCategory` and `TAX_CATEGORY_LABELS` in `src/lib/types.ts` and
  `src/components/import/ImportDialog.tsx` inside the worktree (already confirmed above, re-verify
  post-worktree-creation to catch any drift).
- Confirm: `TaxCategory = 'taxable' | 'nonTaxable' | 'taxDeferred'`; labels "Taxable"/
  "Non-Taxable"/"Tax-Deferred". Not exported from `ImportDialog.tsx`.
- Decision (final, no further check needed): define a local
  `const TAX_CATEGORY_LABELS: Record<TaxCategory, string> = { taxable: 'Taxable', nonTaxable:
  'Non-Taxable', taxDeferred: 'Tax-Deferred' }` at the top of `PositionGroupOverlay.tsx`.
- Acceptance: no code changed this task, just confirmation notes (fold into T6 directly, this task
  can be merged into T6's start — kept separate here only to make the dependency explicit).

### T2. Update `buildGroupKey` + JSDoc in `PositionsTable.tsx` (deps: T0)
File: `/Users/mdoraiswamy/owa/portfolio/src/components/PositionsTable.tsx` (inside worktree).
- Change `buildGroupKey(position: Position, accounts: Account[]): string` (lines 22-32) to
  `buildGroupKey(position: Position): string`.
- New body:
  ```ts
  function buildGroupKey(position: Position): string {
    const effectiveAssetClass = position.assetClassManualOverride || position.assetClass
    return `${position.symbol}|${effectiveAssetClass}`
  }
  ```
- Remove the `account`/`!account` sentinel branch entirely — no longer needed, key never
  references `accountId`/`taxCategory`/`retirement`.
- Update JSDoc comment above (lines 16-21) to:
  ```ts
  /**
   * Build a grouping key from a position.
   * Key format: `${symbol}|${effectiveAssetClass}`
   */
  ```
- Update call site in `buildAggregateRows` (line 72): `const key = buildGroupKey(p, accounts)` →
  `const key = buildGroupKey(p)`.
- Leave `buildAggregateRows(positions: Position[], accounts: Account[])` signature unchanged (see
  Facts section rationale — `accounts` param stays even though now internally unused inside
  `buildGroupKey`'s call; it's still passed through from the render body and is a reasonable public
  shape for the function). Do NOT remove `accounts` from `buildAggregateRows`'s signature — that
  would ripple into the call site at line 131 for no benefit and risks breaking the exported
  `AggregateRow`-building contract other code might rely on.
- Acceptance: `grep -n "taxCategory\|retirement" src/components/PositionsTable.tsx` — no matches
  inside `buildGroupKey` (matches elsewhere in the file, if any unrelated, are fine — there should
  be none currently since this file never referenced retirement/taxCategory outside the key). File
  still compiles in isolation (verified fully at T11).

### T3. Update `PositionsTable.test.tsx` grouping tests (deps: T2)
File: `/Users/mdoraiswamy/owa/portfolio/src/components/PositionsTable.test.tsx`.
- Test `does not aggregate positions with different tax categories` (line 136): rename to
  `aggregates positions with different tax categories` (or similar) — change assertion from
  "2 separate rows" to "1 merged row" with summed shares/costBasis/marketValue across both
  positions (same math pattern as the `aggregates positions from different accounts` test at line
  21 — reuse that test's assertion style). Two positions, same symbol+effectiveAssetClass, accounts
  differing only in `taxCategory` → exactly 1 `<tr>` with combined values.
- Test `does not aggregate positions with different retirement status` (line 215): same rename +
  rewrite — two positions same symbol+effectiveAssetClass, accounts differing only in `retirement`
  → 1 merged row, not 2.
- Test `does not aggregate positions with different asset classes` (line 294): re-read, leave
  assertions unchanged (asset class still part of the key) — just re-run to confirm no incidental
  breakage from fixture reuse.
- Test `aggregates positions from different accounts with same grouping fields` (line 21): re-read
  comment/fixture — should still pass as-is since same symbol+assetClass+taxCategory+retirement
  already merged before; update the inline comment only if it references the old 4-part key
  explicitly (check `grep -n "taxCategory\|retirement" ` around line 21-60 for stale wording).
- Tests at line 367 (`renders single-position group with correct account count badge`), line 808
  (`sorts aggregate rows by market value`), line 893 (`displays correct account count in badge`):
  re-read each — confirm fixtures don't rely on tax-category/retirement to keep positions in
  *separate* groups (if any fixture assumed 2 rows because of differing taxCategory/retirement
  incidentally, it now silently merges and the test would give a wrong count without erroring on
  its own — must eyeball each). Fix any fixture that accidentally relied on the old key granularity
  to stay a 2-group scenario when it needs to remain 2 groups; if such a case exists, differentiate
  those fixtures by symbol or effectiveAssetClass instead so intent is preserved.
- New test cases:
  1. Two positions, same symbol + effectiveAssetClass, different `taxCategory` → 1 row, summed
     shares/costBasis/marketValue.
  2. Two positions, same symbol + effectiveAssetClass, different `retirement` → 1 row, summed
     values.
  3. (Edge, add if not already covered) Two positions, same symbol + effectiveAssetClass, but
     *different accounts entirely* (different `accountId`, different `taxCategory` AND
     `retirement` simultaneously) → still 1 row, `accountCount` badge = 2.
- Acceptance: `npx vitest run src/components/PositionsTable.test.tsx` — all tests pass (verify at
  T11 with full suite too, but run this file locally first to catch fallout early).

### T4. Remove computed columns + rename header in `PositionGroupOverlay.tsx` (deps: T0)
File: `/Users/mdoraiswamy/owa/portfolio/src/components/PositionGroupOverlay.tsx`.
- Header row (lines ~370-382): remove `<th>` for Amount Invested, Market Value, G/L, G/L%. Rename
  "Cost Basis" `<th>` text to "Avg Cost" (binding to `field="avgCost"` in the `<td>` below is
  unchanged — header text only).
- Body row (lines ~385-442): remove the 4 corresponding `<td>`s (`p.costBasisStr`,
  `p.marketValueStr`+G/L color/style, `p.glStr`, `p.glPctStr`).
- In `computedPositions` map (lines 291-312): remove now-dead `glColor`, `glStr`, `glPctStr`,
  `costBasisStr`, `marketValueStr` fields from the returned object (keep `sharesStr`, `avgCostStr`,
  `priceStr`, `taxesStr` — still used; keep `computePosition(p)` call itself since `avgCostStr`
  etc. still derive from it, and `p.avgCost`/`p.price`/`p.shares`/`p.taxes` raw fields are still
  needed for the editable cells).
- Column order after this task (Name not added yet — that's T5): Account, Symbol, Shares, Avg
  Cost, Current Price, Taxes, Override.
- Acceptance: rendering the overlay with a 1-position group shows exactly 7 `<th>` elements (until
  T5 adds Name, making it 8); no "Amount Invested"/"Market Value"/"G/L"/"G/L %" text anywhere in
  the overlay DOM.

### T5. Add editable "Name" column (deps: T4)
File: `/Users/mdoraiswamy/owa/portfolio/src/components/PositionGroupOverlay.tsx`.
- `EditableTextCell` (lines 98-160) currently hardcodes `patch: { symbol: trimmed }` (line 121).
  Add a `field: 'symbol' | 'name'` prop (default not needed — always pass explicitly at both call
  sites for clarity). Change commit logic:
  ```ts
  dispatch({
    type: 'UPDATE_POSITION',
    positionId,
    patch: { [field]: trimmed },
  })
  ```
  Same empty/whitespace-revert rule for both fields (no dispatch if `trimmed === ''`).
- Existing Symbol `<td>` call site (line ~395-399): add `field="symbol"`.
- New Name `<td>`, inserted immediately after Symbol `<td>` in the row:
  ```tsx
  <td style={{ textAlign: 'left' }}>
    <EditableTextCell
      value={p.name ?? ''}
      positionId={p.id}
      field="name"
      dispatch={dispatch}
    />
  </td>
  ```
  `position.name` is `string | null` (per `src/lib/types.ts`) — `p.name ?? ''` handles null display.
- New Name `<th>` header, inserted after Symbol `<th>`: `<th style={{ textAlign: 'left' }}>Name</th>`.
- Column order now: Account, Symbol, Name, Shares, Avg Cost, Current Price, Taxes, Override (8
  columns total, matches spec).
- Test cases (write in T8, listed here for the code-writer's awareness):
  - Name column renders `position.name` value when non-null.
  - Name column renders empty string when `position.name` is `null`.
  - Click Name cell → input appears with current value (or empty for null).
  - Type new name, press Enter → dispatches `UPDATE_POSITION` with `patch: { name: trimmed }`.
  - Type whitespace-only, press Enter → no dispatch, reverts to display mode showing prior value.
  - Blur (not Enter) also commits, same as Symbol's existing behavior.
- Acceptance: overlay table has 8 `<th>`s in exact order Account/Symbol/Name/Shares/Avg
  Cost/Current Price/Taxes/Override; editing Name dispatches correct patch shape; editing Symbol
  still dispatches `patch: { symbol }` (regression check — Symbol's `field` prop wiring didn't
  break its own behavior).

### T6. Rewrite `AccountDropdown` two-line display (deps: T5, T1)
File: `/Users/mdoraiswamy/owa/portfolio/src/components/PositionGroupOverlay.tsx`.
- Add local const (near top of file, after imports):
  ```ts
  const TAX_CATEGORY_LABELS: Record<TaxCategory, string> = {
    taxable: 'Taxable',
    nonTaxable: 'Non-Taxable',
    taxDeferred: 'Tax-Deferred',
  }
  ```
  Import `TaxCategory` type from `../lib/types` alongside existing `Account, Position` import.
- Add a small local helper (used by both closed-button and dropdown-list render spots, avoids
  duplicating the two-line logic):
  ```ts
  function accountLines(account: Account): { line1: string; line2: string } {
    return {
      line1: `${account.institution} — ${account.name}`,
      line2: `${TAX_CATEGORY_LABELS[account.taxCategory]} • ${account.retirement ? 'Retirement' : 'Non-Retirement'}`,
    }
  }
  ```
- Closed-button display (lines 174-176): replace `accountDisplay` string construction. Since the
  button previously rendered a single string, now render two lines inside the button:
  ```tsx
  {currentAccount ? (
    <>
      <div>{accountLines(currentAccount).line1}</div>
      <div style={{ fontSize: '0.85em', opacity: 0.7 }}>{accountLines(currentAccount).line2}</div>
    </>
  ) : (
    'Unknown Account'
  )}
  ```
  (Replaces the single `{accountDisplay}` expression at line 203; remove the now-unused
  `accountDisplay` const at lines 174-176.)
- Dropdown list item (lines 241-244): replace
  ```tsx
  <div style={{ fontWeight: '500' }}>{account.name}</div>
  {account.accountNumber && (
    <div style={{ fontSize: '0.85em', opacity: 0.7 }}>#{account.accountNumber}</div>
  )}
  ```
  with
  ```tsx
  <div style={{ fontWeight: '500' }}>{accountLines(account).line1}</div>
  <div style={{ fontSize: '0.85em', opacity: 0.7 }}>{accountLines(account).line2}</div>
  ```
  (Line2 always renders now — no conditional — since `taxCategory`/`retirement` are always present
  on `Account`, unlike the old optional-`accountNumber` check.)
- `accountNumber` must not appear anywhere in `AccountDropdown` after this change — grep the
  function body to confirm zero remaining references.
- Acceptance: closed button shows two `<div>`s (`institution — name`, `taxCategory • retirement`);
  each open dropdown item shows the same two-line format; no `#accountNumber` text rendered
  anywhere in this component.

### T7. Update `sortedPositions` comparator (deps: T0, can run parallel with T4-T6 but same file — sequence after T6 to avoid merge conflicts within the same task)
File: `/Users/mdoraiswamy/owa/portfolio/src/components/PositionGroupOverlay.tsx`.
- Current (lines 280-288):
  ```ts
  const sortedPositions = [...group.positions].sort((a, b) => {
    const accountA = accounts.find((ac) => ac.id === a.accountId)
    const accountB = accounts.find((ac) => ac.id === b.accountId)
    const nameA = accountA?.name?.trim() || accountA?.accountNumber || ''
    const nameB = accountB?.name?.trim() || accountB?.accountNumber || ''
    return nameA.localeCompare(nameB)
  })
  ```
- New:
  ```ts
  const sortedPositions = [...group.positions].sort((a, b) => {
    const accountA = accounts.find((ac) => ac.id === a.accountId)
    const accountB = accounts.find((ac) => ac.id === b.accountId)

    const institutionA = accountA?.institution ?? ''
    const institutionB = accountB?.institution ?? ''
    const institutionCmp = institutionA.localeCompare(institutionB)
    if (institutionCmp !== 0) return institutionCmp

    const nameA = accountA?.name?.trim() || accountA?.accountNumber || ''
    const nameB = accountB?.name?.trim() || accountB?.accountNumber || ''
    return nameA.localeCompare(nameB)
  })
  ```
- Update the comment above (line 279, `// Sort positions by account name ascending (fallback to
  accountNumber)`) to `// Sort positions by account institution ascending, then account name
  ascending (fallback to accountNumber)`.
- Acceptance: 3 positions across accounts with institutions "Fidelity"/"Schwab"/"Fidelity" and
  names "Zeta"/"Alpha"/"Alpha" sort as: Fidelity/Alpha, Fidelity/Zeta, Schwab/Alpha (institution
  wins over name).

### T8. Update `PositionGroupOverlay.test.tsx` (deps: T4, T5, T6, T7)
File: `/Users/mdoraiswamy/owa/portfolio/src/components/PositionGroupOverlay.test.tsx`.
- Test `does not allow editing of computed columns` (line 378): rewrite. New assertions: query for
  "Amount Invested"/"Market Value"/"G/L"/"G/L %" header text → not present (`queryByText` returns
  null). Remove any assertion logic that clicked those cells (they no longer exist).
- Any test asserting header text "Cost Basis" → update to "Avg Cost".
- Account-dropdown tests (~line 483, ~509, and any others matching `${name} • #${accountNumber}`
  or similar old-format strings): rewrite to assert `${institution} — ${name}` and
  `${TAX_CATEGORY_LABELS[taxCategory]} • ${retirement ? 'Retirement' : 'Non-Retirement'}` are
  rendered (both in the closed button and, after opening the dropdown, in each list item); assert
  `#${accountNumber}` text is NOT present anywhere in the dropdown DOM.
- Test `opens overlay with correct underlying positions sorted by account name` (~line 436, uses
  `createTestAccount` fixtures at lines 487ish): add/adjust fixtures so 2+ accounts have differing
  `institution` values, confirm sort order is institution-then-name (e.g. institution "Zeta Bank"
  name "Apple Account" should sort AFTER institution "Alpha Bank" name "Zebra Account" — proves
  institution wins over name).
- New tests (Name column, from T5's list): add all 6 cases listed in T5.
- Acceptance: `npx vitest run src/components/PositionGroupOverlay.test.tsx` — all pass.

### T9. Update `product-behavior.md` "## Positions table" (deps: T2-T8 code settled)
File: `/Users/mdoraiswamy/owa/portfolio/product-behavior.md`, section starting at current line 40.
- Line 42 ("Rows are aggregate groups... symbol + effective asset class + tax category + retirement
  status..."): change to "symbol + effective asset class" only. Drop "+ tax category + retirement
  status" phrase.
- Line 47 (long overlay bullet): rewrite fully:
  - Column list: Account, Symbol, Name, Shares, Avg Cost, Current Price, Taxes, Override (remove
    Amount Invested, Market Value, G/L, G/L%).
  - Account dropdown description: two-line format — `institution — name` (line 1) /
    `taxCategoryLabel • retirementLabel` (line 2), no accountNumber displayed.
  - Add Name to the editable-cells list: `<input type="text">`, click-to-edit, same
    empty/whitespace-reverts-silently rule as Symbol, binds to `patch: { name }`.
  - Sort description: change "sorted by account name ascending, fallback account number" to
    "sorted by institution ascending, then account name ascending, fallback account number".
  - "Side effect" sentence: change "editing Symbol or Account changes a position's aggregate group
    key (`symbol` + `effectiveAssetClass` + `taxCategory` + `retirement`)" to "(`symbol` +
    `effectiveAssetClass`)" — editing Account no longer changes the group key at all now (since key
    doesn't reference account fields) — only editing Symbol (or the override asset class) still
    changes group membership. Update this sentence carefully: **editing Account no longer causes
    the position to leave the overlay's group** — remove Account from the side-effect trigger list,
    keep only Symbol (and asset-class override, if that's mentioned elsewhere in the file).
  - "Computed columns" sentence: remove entirely (no more computed columns in the overlay).
- Re-read lines 44-46 (filters/columns/sorting for the *main* aggregate table, not the overlay) —
  confirm no wording implies tax-category/retirement still distinguish rows; the account-count
  badge sentence ("count of distinct accounts in the group") stays accurate as-is since groups can
  now span more accounts — no change needed there, just re-read to confirm.
- Acceptance: section reads consistently; no reference to Amount Invested/Market Value/G/L/G/L% or
  `#accountNumber` or the old 4-part key remains in this section.

### T10. Update `design.md` stale references (deps: T2-T8 code settled)
File: `/Users/mdoraiswamy/owa/portfolio/design.md`.
- Line 115 (`PositionsTable` bullet): change "symbol+effectiveAssetClass+taxCategory+retirement" →
  "symbol+effectiveAssetClass".
- Line 117 (`PositionGroupOverlay` bullet): rewrite to match new column list, new Account-dropdown
  two-line format, new Name-column editable cell, new sort order (institution then name), and drop
  the "Computed columns... remain read-only text" sentence (no computed columns left). Update
  `buildGroupKey()` result phrase: "Editing Symbol or Account changes position's `buildGroupKey()`
  result" → "Editing Symbol changes position's `buildGroupKey()` result" (Account no longer part of
  the key).
- Line 157 (Data flow / Selectors section): change
  "symbol+effectiveAssetClass+taxCategory+retirement" → "symbol+effectiveAssetClass" here too (this
  is the third stale spot found by grep, not just line 117 — confirm this edit lands).
- Run `grep -n "buildGroupKey\|taxCategory\|institution\|Amount Invested\|Market Value" design.md`
  after edits — inspect every remaining hit, confirm each is either unrelated (e.g. institution
  field docs elsewhere in the Account section, out of scope) or correctly updated. No hit should
  reference the old 4-part key or the removed overlay columns in the `PositionGroupOverlay`
  context.
- Acceptance: `grep -c "taxCategory + retirement\|taxCategory+retirement"` in design.md returns 0.

### T11. Full-file review of both docs (deps: T9, T10)
- Re-read `product-behavior.md` "## Positions table" section and `design.md`'s `PositionsTable`/
  `PositionGroupOverlay` bullets + Data-flow section in full (not just the diffed lines).
- Confirm: no contradictions between the two files, no stale prose left, terse/token-optimized
  style preserved (bullet lists, no narrative creep), both describe current-state only (no "used to
  be" phrasing).
- Fix anything found.
- Acceptance: manual pass, no automated check — sign off by re-reading full sections once more
  after any fix.

### T12. Run tests + build + lint, fix fallout (deps: T3, T8, T11)
- `npm run test` (inside worktree) — all tests pass, including updated
  `PositionsTable.test.tsx`/`PositionGroupOverlay.test.tsx`.
- `npm run build` — `tsc -b` typecheck + `vite build`, must pass clean (confirms `buildGroupKey`
  signature change and `EditableTextCell` `field` prop typing are sound).
- `npm run lint` — oxlint passes.
- `grep -ri watchlist src/` — still returns nothing (regression check per CLAUDE.md/design.md,
  unrelated to this feature but must not regress).
- If any failure: fix, re-run, do not proceed to T13 until clean.
- Acceptance: all three commands exit 0; watchlist grep empty.

### T13. Commit (deps: T12)
- Stage exactly the touched files: `src/components/PositionGroupOverlay.tsx`,
  `src/components/PositionGroupOverlay.test.tsx`, `src/components/PositionsTable.tsx`,
  `src/components/PositionsTable.test.tsx`, `product-behavior.md`, `design.md`.
- Commit message describes: overlay column changes (drop computed columns, add Name, rename Avg
  Cost), two-line account dropdown display, institution-then-name sort, and the aggregation key
  simplification to symbol+effectiveAssetClass.
- Do NOT push.
- Acceptance: `git log -1` shows the new commit on branch
  `positions-overlay-aggregation-v2/implement`; `git status` clean.

### T14. Worktree teardown (deps: T13)
- `cd` back to `/Users/mdoraiswamy/owa/portfolio` (original directory).
- `git worktree remove ../worktree-positions-overlay-aggregation-v2`.
- Acceptance: `git worktree list` no longer shows the removed worktree; branch
  `positions-overlay-aggregation-v2/implement` still exists (worktree removal doesn't delete the
  branch) with the commit from T13, viewable via `git log positions-overlay-aggregation-v2/implement -1`.

## Test strategy

- Unit/component tests only (`vitest` + `@testing-library/react`), no e2e — consistent with rest of
  repo.
- `PositionsTable.test.tsx`: covers `buildGroupKey`/`buildAggregateRows` behavior indirectly through
  rendered `<tr>` counts and summed values (no direct unit test of `buildGroupKey` in isolation —
  it's not exported; follow existing pattern in this file which only tests through the component).
- `PositionGroupOverlay.test.tsx`: covers Name column edit lifecycle, AccountDropdown two-line
  format (closed + open states), sort order, and absence of removed columns.
- All new/changed tests must include both happy path and at least one edge case (empty/whitespace
  input, null `name`, tie-breaking sort) per CLAUDE.md's "when something is NOT working as expected,
  add a test to reveal the bug" spirit — proactively here since this is new intended behavior, not a
  bug fix, but same rigor applies.
- Full suite (`npm run test`) run at T12 as final gate before commit.

## Risks

- **Merge-conflict risk within `PositionGroupOverlay.tsx`**: T4, T5, T6, T7 all edit the same file
  sequentially. Plan sequences them with explicit deps (T5 depends on T4, T6 depends on T5+T1, T7
  depends on T6) specifically to avoid parallel edits colliding. Do not parallelize T4-T7 despite
  no *logical* dependency between some of them (e.g., T7's sort comparator is logically independent
  of T4/T5/T6) — same-file edits must be sequential here.
- **`accountCount` badge semantics shift**: after T2, groups can span more accounts (e.g. same
  symbol across taxable and tax-deferred accounts now merges) — `accountCount` badge will show
  higher numbers for previously-separate groups. This is intentional per spec but is a visible
  behavior change beyond just "fewer rows" — worth confirming in T12's manual test pass that badge
  values look sane, not just that tests pass (tests are the authority, but a sanity skim helps
  catch a fixture that accidentally always uses `accountId` as a proxy for grouping expectations).
- **Existing fixtures using accountNumber but not institution**: some `createTestAccount` fixtures
  across both test files may not currently set `institution` — check each `createTestAccount` (or
  equivalent factory) default; if `institution` isn't defaulted to a non-empty string, the new
  `AccountDropdown` display would render `" — Name"` (leading em-dash, empty institution) which is
  syntactically fine but visually odd — not a test failure, just note it. If any assertion does
  exact-string-match against `line1`, ensure fixture `institution` values are set explicitly in
  those specific tests (T6/T8 responsibility).
- **`EditableTextCell` prop change is a breaking signature change** for the one existing call site
  (Symbol) — must update that call site in the same task (T5) to avoid a broken intermediate state;
  don't split T5's `EditableTextCell` prop change from its Symbol-call-site update across tasks.

## In scope / out of scope

**In scope:**
- `PositionGroupOverlay.tsx`: column removal/addition/rename, AccountDropdown two-line format, sort
  comparator.
- `PositionsTable.tsx`: `buildGroupKey` formula + JSDoc.
- Both files' test suites.
- `product-behavior.md` "## Positions table" section.
- `design.md`: `PositionsTable`/`PositionGroupOverlay` component-tree bullets + Data-flow section
  key-formula references.

**Out of scope:**
- `src/lib/computations.ts` (`computePosition` itself, still used by `PositionsTable.tsx`'s own
  aggregate-row math — untouched).
- `AssetClassOverrideSelect.tsx`, `ClosedPositionsTable.tsx`, `TransactionsTable.tsx`.
- `src/lib/selectors.ts` `visiblePositions` — category/retirement filtering upstream of grouping is
  unaffected, only grouping/merging downstream changes.
- `plans/positions-aggregate-by-symbol.md`, `plans/positions-overlay-editable-entries.md` —
  historical, superseded, do not edit (reference docs are canonical per CLAUDE.md).
- `schema-spec.md` (no data-schema/persistence-format change — `Position.name` and `Account` fields
  are unchanged types, only UI/grouping logic changes).
- Any Drive-sync / persistence changes — `AppState` shape untouched.

## Acceptance criteria (rollup)

- [ ] Overlay table columns, in order: Account, Symbol, Name, Shares, Avg Cost, Current Price,
      Taxes, Override. No Amount Invested/Market Value/G/L/G/L% columns.
- [ ] "Avg Cost" header text, still bound to editable `avgCost` field.
- [ ] Name column: click-to-edit text input, commits `patch: { name: trimmed }` on Enter/blur,
      empty/whitespace reverts silently, displays `''` when `position.name` is `null`.
- [ ] `AccountDropdown` closed button and each open dropdown item show two lines:
      `${institution} — ${name}` and `${taxCategoryLabel} • ${retirementLabel}`; no `accountNumber`
      rendered anywhere in this component.
- [ ] Overlay row sort: institution ascending, then name ascending (fallback accountNumber) within
      same institution.
- [ ] `buildGroupKey` in `PositionsTable.tsx`: `` `${symbol}|${effectiveAssetClass}` `` only, no
      `accounts` param, no sentinel branch.
- [ ] `PositionsTable.test.tsx` and `PositionGroupOverlay.test.tsx` updated/added per T3/T8, all
      passing.
- [ ] `product-behavior.md` "## Positions table" and `design.md` (3 spots: lines ~115, ~117, ~157)
      updated, full-file-reviewed, no stale references.
- [ ] `npm run test`, `npm run build`, `npm run lint` all pass.
- [ ] `grep -ri watchlist src/` returns nothing.
- [ ] Commit created only after tests pass and docs updated (T13), inside worktree branch
      `positions-overlay-aggregation-v2/implement`.
- [ ] Worktree cleaned up (T14), branch preserved.
