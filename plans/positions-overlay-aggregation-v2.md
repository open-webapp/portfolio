# Positions overlay aggregation: v2 refinement (columns, sort, grouping key)

Goal: refine the positions overlay UI and aggregation logic built in v1 (`positions-aggregate-by-symbol.md`). Remove 4 derived display columns (Amount Invested, Market Value, G/L, G/L%), rename Cost Basis header → Avg Cost, add new editable Name column, upgrade AccountDropdown to two-line format with tax/retirement labels, simplify grouping key from 4-field to 2-field (symbol+effectiveAssetClass only, collapsing tax/retirement boundaries), and update row sort to institution→name order. Reference docs updated for new column layout, account display, grouping key, and sort behavior.

No `plans/_template.md` exists — structure follows `plans/positions-aggregate-by-symbol.md` (v1, prerequisite).

**Prerequisites**: v1 aggregation feature already implemented and tested. This plan assumes `PositionGroupOverlay`, `buildAggregateRows`, `AggregateRow` type all exist and are working per v1 spec.

**Files touched**:
- `src/components/PositionGroupOverlay.tsx` (computed columns removed, Name column added, AccountDropdown two-line format, sort order updated)
- `src/components/PositionsTable.tsx` (buildGroupKey simplified from 4-field to 2-field)
- `src/components/PositionGroupOverlay.test.tsx` (assertions for new column count/names, account display format, new Name column, sort by institution+name)
- `src/components/PositionsTable.test.tsx` (grouping tests updated: expect merge on tax/retirement diff, sort tests)
- `product-behavior.md` (Positions table section rewritten for v2)
- `design.md` (verify buildGroupKey reference, no other changes expected)

Explicitly out of scope: `ClosedPositionsTable`, `TransactionsTable`, the rest of the app.

## Facts confirmed by reading code first (v1 context)

- `AggregateRow` type from v1 has `{ key, symbol, displayName, effectiveAssetClass, shares, costBasis, marketValue, price, avgCost, gl, glPct, accountCount, positions }` — v2 keeps this shape, only the key/aggregation logic changes.
- Current overlay columns (v1): Account (AccountDropdown, single-line), Symbol (text), Shares (EditableCell), Avg Cost (EditableCell), Current Price (EditableCell), Taxes (EditableCell), Amount Invested (derived, read-only), Market Value (derived, read-only), G/L (derived, read-only), G/L% (derived, read-only), Override (AssetClassOverrideSelect).
- v2 removes: Amount Invested, Market Value, G/L, G/L% (4 columns).
- v2 adds: Name (new, editable, EditableTextCell, after Symbol).
- v2 final column order: Account, Symbol, Name, Shares, Avg Cost, Current Price, Taxes, Override (8 columns, was 11).
- `EditableTextCell` pattern exists (used for Symbol in overlay) — reuse for new Name column (empty input reverts silently, no null commit, matches Symbol behavior).
- AccountDropdown currently single-line: `<span>{account.name} • #{account.accountNumber}</span>` or similar — v2 becomes two-line with institution/taxCategory/retirement labels.
- Current overlay sort: positions sorted by `account.name ascending, fallback accountNumber` — v2 becomes `account.institution ascending, then account.name ascending, fallback accountNumber`.
- v1 buildGroupKey: `` `${symbol}|${effectiveAssetClass}|${account.taxCategory}|${account.retirement}` `` — v2 simplifies to `` `${symbol}|${effectiveAssetClass}` `` (drop tax/retirement fields). This causes positions with different tax/retirement to merge in the main table (but visiblePositions filtering still applies pre-grouping, so filter UI behavior unchanged).

## Tasks

### T0. Create git worktree for isolated work (~5 min)
No dependency — prerequisite for safe parallel work.
- Run `git worktree add ../worktree-overlay-v2 -b feature/overlay-aggregation-v2` from the main repo root.
- `cd ../worktree-overlay-v2` to switch into the worktree.
- All subsequent tasks execute in this worktree; at the end (T_final), switch back and remove it.

### T1. Simplify buildGroupKey in `PositionsTable.tsx` (~10 min)
Depends on: T0.
- Locate `buildGroupKey(position, account)` helper (v1 file).
- Change from `` `${symbol}|${effectiveAssetClass}|${taxCategory}|${retirement}` `` to `` `${symbol}|${effectiveAssetClass}` ``.
- Update JSDoc to state: "Groups positions by symbol and effective asset class only; positions with different tax categories or retirement status now merge."
- No code calls `buildGroupKey` directly except `buildAggregateRows` — key generation is a side effect of grouping in that function, so verify no other sites depend on the old 4-field structure.

### T2. Update AccountDropdown component to two-line format (~20 min)
Depends on: T0 (can start in parallel with T1, no conflict).
- Locate `AccountDropdown` component in `PositionGroupOverlay.tsx`.
- Current single-line markup: replace with a two-line plain-text format, e.g.:
  ```
  <div style={{display: 'flex', flexDirection: 'column', gap: '2px'}}>
    <div>{account.institution} — {account.name}</div>
    <div style={{fontSize: '0.875em', color: 'var(--text-muted)'}}>
      {taxCategoryLabel} • {retirementLabel}
    </div>
  </div>
  ```
  where `taxCategoryLabel` maps `account.taxCategory` ('taxable' → "Taxable", 'nonTaxable' → "Non-Taxable", 'taxDeferred' → "Tax-Deferred") and `retirementLabel` maps `account.retirement` (true → "Retirement", false → "Non-Retirement").
- Apply this format to BOTH: the closed dropdown button display (when no dropdown is open) AND every `<li>`/option inside the open dropdown list.
- Drop `accountNumber` display entirely from both locations.
- Test manually: click overlay table's Account cell, verify dropdown opens with two-line format, close and re-check button display.

### T3. Remove 4 derived columns from overlay table header and body (~15 min)
Depends on: T0.
- Locate overlay table `<thead>` row in `PositionGroupOverlay.tsx`.
- Delete `<th>` entries for: "Amount Invested", "Market Value", "G/L", "G/L%".
- Locate corresponding `<tbody>` rows mapping `group.positions.map(p => ...)`.
- Delete cells rendering `fmtUSD(computed.costBasis)` (Amount Invested), `fmtUSD(computed.marketValue)`, `fmtUSD(computed.gl)` + color, `fmtPct(computed.glPct)` + color.
- Verify: overlay table should now have exactly 11 column `<th>` entries (Account, Symbol, Shares, Avg Cost, Current Price, Taxes, Override — but Name not yet added, so 7 so far; then Name adds 1 more for 8 total after T4).
- Acceptance: no Amount Invested / Market Value / G/L / G/L% columns visible in overlay.

### T4. Rename "Cost Basis" header → "Avg Cost" and update related text (~10 min)
Depends on: T0 (can start in parallel with T3).
- Locate overlay table `<th>` with text "Cost Basis".
- Change header text to "Avg Cost".
- No other code changes needed (EditableCell binding to `position.avgCost` already exists from v1, no rename required in that logic).
- Acceptance: header reads "Avg Cost", EditableCell still edits `avgCost` field correctly.

### T5. Add new Name column after Symbol, using EditableTextCell (~20 min)
Depends on: T4 (need header order finalized first).
- Locate overlay table Symbol column (it's already editable via EditableTextCell from v1 on `group.displayName`? Or is it read-only? **Verify: Symbol is likely read-only currently; check test**).
- After the Symbol column `<th>`, insert a new `<th>Name</th>` (just text, no sort icon).
- In the table body, after the Symbol cell, add a new column:
  ```jsx
  <EditableTextCell
    value={position.name ?? ''}
    onChange={(newName) => {
      if (newName.trim()) {
        dispatch({
          type: 'UPDATE_POSITION',
          payload: { id: position.id, updates: { name: newName.trim() } }
        });
      }
      // Empty input reverts silently (no null commit)
    }}
  />
  ```
- Acceptance: overlay shows 8 columns in final order (Account, Symbol, Name, Shares, Avg Cost, Current Price, Taxes, Override); Name column is editable; empty input doesn't commit.

### T6. Update overlay sortedPositions comparator from name to institution+name (~15 min)
Depends on: T0 (can start in parallel with T1-T5).
- Locate the sorting logic inside `PositionGroupOverlay.tsx` (likely a `useMemo` or inline sort of `group.positions`).
- Current sort: `(a, b) => (a.name.trim() || a.accountNumber).localeCompare(b.name.trim() || b.accountNumber)` (or similar, v1 default).
- Change to: sort by `account.institution ascending, then account.name ascending, fallback accountNumber`:
  ```js
  const sortedPositions = useMemo(() => {
    const accountMap = new Map(accounts.map(a => [a.id, a]));
    return [...group.positions].sort((a, b) => {
      const accA = accountMap.get(a.accountId);
      const accB = accountMap.get(b.accountId);
      if (!accA || !accB) return 0;
      const instComp = (accA.institution || '').localeCompare(accB.institution || '');
      if (instComp !== 0) return instComp;
      const nameComp = (accA.name.trim() || accA.accountNumber).localeCompare(
        accB.name.trim() || accB.accountNumber
      );
      return nameComp;
    });
  }, [group.positions, accounts]);
  ```
- Acceptance: overlay rows now sorted by institution first, then name, stable across re-renders.

### T7. Update `PositionGroupOverlay.test.tsx` for v2 columns/format/sort (~30 min)
Depends on: T1–T6 complete.
- **Column count/names**: assert overlay table has exactly 8 `<th>` elements; assert headers read Account, Symbol, Name, Shares, "Avg Cost", Current Price, Taxes, Override (in that order).
- **Account display**: add test asserting two-line format. Mock an account with `institution: 'Fidelity'`, `name: 'Brokerage'`, `taxCategory: 'taxable'`, `retirement: false`. Render overlay, assert Account cell displays:
  - Line 1: "Fidelity — Brokerage"
  - Line 2 (muted): "Taxable • Non-Retirement"
- Test all three tax categories and both retirement states (e.g., "Non-Taxable • Retirement", "Tax-Deferred • Non-Retirement", etc.).
- **Name column**: add test for EditableTextCell in Name column — render overlay with a position that has `name: 'Tech Holdings'`, assert cell displays the name; type new value, press Enter, assert dispatch called with `UPDATE_POSITION` and name field updated; leave field empty and blur, assert dispatch NOT called (silent revert).
- **Sort order**: add test with 3 positions spanning 2 accounts (e.g., Fidelity Brokerage, then Charles Schwab Taxable, then Fidelity Taxable — all different institutions or an order that would fail if sorting pre-institution). Assert overlay rows appear in institution→name order (Fidelity accounts first, Charles Schwab after, within institution sorted by name).
- **Regression**: assert "Cost Basis" header no longer exists; assert Amount Invested / Market Value / G/L / G/L% columns absent (no cells rendering those values).

### T8. Update `PositionsTable.test.tsx` for v2 grouping key (~20 min)
Depends on: T1 complete (grouping key change finalized).
- Locate tests asserting that positions with different `taxCategory` or `retirement` status create separate rows.
- Update those tests: now positions with the same `symbol + effectiveAssetClass` but differing `taxCategory`/`retirement` should **merge into a single row** (not be separate rows as before).
- Add explicit test case: fixture with 2 positions, same symbol, same asset class, but one `taxCategory: 'taxable'` and another `taxCategory: 'nonTaxable'` — assert only 1 aggregate row in the main table (key is just `symbol|effectiveAssetClass`, tax category ignored).
- Add another case: same symbol/assetClass, one `retirement: true` and another `retirement: false` — assert 1 row (retirement ignored in key).
- Verify: main table's `buildAggregateRows` logic and `buildGroupKey` call produce the expected fewer groups now.
- Acceptance: tests pass, reflecting the v2 grouping key semantics.

### T9. Update `product-behavior.md` Positions table section (~15 min)
Depends on: T3–T6 complete (final UI shape known).
- Locate "## Positions table" section in `product-behavior.md`.
- Replace/update these bullets:
  - **Grouping key**: now `` symbol + effectiveAssetClass `` only; tax category and retirement status no longer part of the key (positions with same symbol+assetClass across different tax/retirement statuses merge).
  - **Overlay columns**: update from 11 to 8 columns: Account (two-line format, institution—name / taxCategory•retirement), Symbol, Name (new, editable), Shares, Avg Cost (renamed from Cost Basis), Current Price, Taxes, Override (assetClassOverrideSelect). Remove old bullets for Amount Invested / Market Value / G/L / G/L%.
  - **Account display**: clarify two-line format (institution—name on line 1, taxCategory•retirement labels on line 2, muted style).
  - **Overlay sort**: rows within the overlay sorted by account.institution ascending, then account.name ascending, fallback account.accountNumber.
  - **Name column**: new column after Symbol, editable via EditableTextCell, empty input reverts silently (no null commit).
- Acceptance: doc section reads accurately for v2; no stale v1 terminology remains.

### T10. Check `design.md` for stale references (~10 min)
Depends on: T1–T6 complete (code changes finalized).
- Search `design.md` for mentions of buildGroupKey, overlay columns, AccountDropdown format, or aggregation key structure.
- If any reference still describes the old 4-field key or the old column layout, update to reflect v2.
- If no stale references found, doc is already consistent (design.md may not mention these implementation details in detail).
- Acceptance: no references to old grouping key or old overlay column layout remain.

### T11. Run full test suite, lint, build (~15 min)
Depends on: T7, T8 (tests finalized).
- `npm run test` — all tests pass, including updated `PositionGroupOverlay.test.tsx` and `PositionsTable.test.tsx`.
- `npm run lint` — no errors.
- `npm run build` — typecheck clean, vite build succeeds.
- Acceptance: test suite all green, no lint/typecheck errors.

### T12. Commit changes (~10 min)
Depends on: T11 (tests/lint/build all pass).
- Stage all modified files: `PositionGroupOverlay.tsx`, `PositionsTable.tsx`, test files, `product-behavior.md`, `design.md` (if changed).
- Commit with message: `"refactor: Simplify positions overlay aggregation key and UI (v2)"`
  - Summarize in body: grouping key simplified from 4-field (symbol+assetClass+taxCategory+retirement) to 2-field (symbol+assetClass); overlay columns reduced from 11 to 8 (remove Amount Invested/Market Value/G/L/G/L%, add Name); AccountDropdown now displays two-line format (institution—name / taxCategory•retirement); overlay sort updated to institution+name order.
- Acceptance: commit created, no staged changes remain.

### T_final. Clean up worktree (~5 min)
Depends on: T12 (commit done).
- Switch back to original directory: `cd ..`.
- Remove worktree: `git worktree remove ../worktree-overlay-v2`.
- Acceptance: worktree removed cleanly, main repo working tree unaffected.

## Test cases (explicit list)

1. Overlay table renders exactly 8 columns in order: Account, Symbol, Name, Shares, "Avg Cost", Current Price, Taxes, Override.
2. AccountDropdown displays two-line format (institution—name / taxCategory•retirement labels) in both closed button state and open dropdown list.
3. Account display labels correct for all 6 combinations: taxable/nonTaxable/taxDeferred × retirement/nonRetirement.
4. Name column is editable via EditableTextCell; empty input reverts silently; non-empty input commits via UPDATE_POSITION.
5. Overlay rows sorted by account.institution ascending, then account.name ascending (fallback accountNumber); test with multi-institution fixture.
6. Amount Invested / Market Value / G/L / G/L% columns not rendered (regression check).
7. Main table: positions with same symbol+effectiveAssetClass but different taxCategory merge into 1 row (not 2).
8. Main table: positions with same symbol+effectiveAssetClass but different retirement status merge into 1 row (not 2).
9. buildGroupKey returns only `symbol|effectiveAssetClass` (no tax/retirement fields in key).

## Acceptance criteria

- [ ] buildGroupKey simplified to `symbol|effectiveAssetClass` (2 fields); JSDoc updated.
- [ ] AccountDropdown displays two-line format (institution—name / taxCategory•retirement labels) in closed and open states; no accountNumber shown.
- [ ] Overlay table has exactly 8 columns: Account, Symbol, Name, Shares, "Avg Cost", Current Price, Taxes, Override.
- [ ] "Cost Basis" header renamed to "Avg Cost"; EditableCell binding unchanged.
- [ ] Name column editable via EditableTextCell; empty input reverts silently; non-empty commits via UPDATE_POSITION.
- [ ] Amount Invested / Market Value / G/L / G/L% columns completely removed from overlay.
- [ ] Overlay rows sorted by account.institution ascending, then account.name ascending, fallback accountNumber.
- [ ] PositionGroupOverlay.test.tsx updated: column count/names, account display format (all 6 taxCategory/retirement combos), Name column behavior, sort order, regression checks.
- [ ] PositionsTable.test.tsx updated: positions with different taxCategory now merge (was separate); positions with different retirement now merge (was separate).
- [ ] product-behavior.md Positions table section updated: grouping key (2-field), overlay columns (8, with Name), account format (two-line), sort order, Name column behavior.
- [ ] design.md checked for stale references; any old grouping-key or column-layout mentions updated.
- [ ] `npm run test` passes fully.
- [ ] `npm run lint` passes.
- [ ] `npm run build` passes (typecheck clean).
- [ ] Commit created with changes to `.tsx` files, test files, and both reference docs.
- [ ] Worktree cleaned up.
