# CSV Import: Optional Name Field and Taxes Support

Support optional `Position.name` and `ClosedPosition.name` (fall back to symbol when null).
Add new optional `taxes` field (number | null) to both `Position` and `Transaction`
imported from CSV only. Both name and taxes are non-computed, never required on import.
Update validation to allow profiles with name/taxes unmapped.

This plan is written caveman-simple on purpose: small tasks, explicit deps,
concrete types. Read it top to bottom before coding task 1.

## Decisions locked

1. **Position.name optionality**: `name: string | null`. Default to `null` on import if unmapped.
   UI falls back to `symbol` in display (tables, charts) when name is null.

2. **Taxes field**: New `taxes: number | null` on both Position and Transaction.
   Imported from CSV only, never computed. Defaults to `null` if unmapped.

3. **Validation changes**: Remove `name` from POSITIONS_REQUIRED_FIELDS.
   Add `taxes` as optional field option for both positions and transactions.
   Validation passes even if name/taxes unmapped.

4. **ClosedPosition.name**: Also optional (`string | null`), preserving closed position's
   name from the original Position, or `null` if original had `null`.

5. **Import precedence**: If both direct and fallback columns present for name/taxes,
   prefer direct value (same pattern as avgCost/purchaseAmount).

6. **PortfolioSnapshot**: No change. Value calculation unchanged (shares × price),
   name/taxes not included in snapshot math.

## Overview

**What we're adding**:
- `Position.name` → `string | null` (optional on import).
- `ClosedPosition.name` → `string | null` (preserves from old Position).
- New optional `taxes` field (number | null) on both Position and Transaction.
- Validation allows profiles without name and taxes mapped.
- Import: name/taxes default to `null` if CSV column not mapped.
- UI fallback: display symbol when position name is null.
- Tests: verify null handling in import, validation, and display logic.

**What we are NOT changing**:
- Account, PortfolioSnapshot, MappingProfile interfaces (not affected).
- Computation logic (marketValue/costBasis/gl/glPct never include taxes; computed on-the-fly).
- Existing profiles loaded from IndexedDB (name/taxes fields gracefully default to `null`).
- Transaction dedup logic (date|symbol|type|shares|price key unchanged).
- Closed-position realized G/L calculation.

**Source-of-truth references**:
- Domain model: `src/lib/types.ts` (Position, Transaction, ClosedPosition).
- Import validation: `src/lib/mappingProfiles.ts` (validateProfile).
- Import pipeline: `src/lib/positionsImport.ts`, `src/lib/transactionsImport.ts`.
- UI display: `src/components/PositionsTable.tsx`, `src/components/ClosedPositionsTable.tsx`,
  `src/components/TransactionsTable.tsx` (name/taxes fallback logic).
- Tests: `src/lib/positionsImport.test.ts`, `src/lib/transactionsImport.test.ts`,
  `src/lib/mappingProfiles.test.ts`.

## Architecture

```
portfolio/
  src/
    lib/
      types.ts                      # Position, Transaction, ClosedPosition: make name optional,
                                     # add taxes: number | null
      mappingProfiles.ts             # Update validateProfile() to allow name/taxes unmapped
      positionsImport.ts             # Handle null name, parse taxes from CSV
      transactionsImport.ts          # Handle null taxes from CSV
      positionsImport.test.ts        # Add tests for optional name and taxes
      transactionsImport.test.ts     # Add tests for optional taxes
      mappingProfiles.test.ts        # Test validation with name/taxes optional
    components/
      PositionsTable.tsx            # Display symbol when name is null
      ClosedPositionsTable.tsx       # Display symbol when name is null
      TransactionsTable.tsx          # Display taxes column (if mapped); handle null
```

## Tasks

### Task 1: Update types.ts — make name optional, add taxes field

**File**: `src/lib/types.ts`

**Changes**:

1. Update `Position` interface:
   ```ts
   export interface Position {
     id: string
     accountId: string
     symbol: string
     name: string | null          // Changed from: string
     assetClass: string
     assetClassManualOverride?: string
     shares: number
     avgCost: number
     price: number
     taxes: number | null          // NEW
     lastImportedAt: string
   }
   ```

2. Update `ClosedPosition` interface:
   ```ts
   export interface ClosedPosition {
     id: string
     accountId: string
     symbol: string
     name: string | null            // Changed from: string
     closedDate: string
     assetClass: string
     realizedGL: number | null
     realizedGLBasis: 'transactions' | 'unknown'
   }
   ```

3. Update `Transaction` interface:
   ```ts
   export interface Transaction {
     id: string
     accountId: string
     date: string
     symbol: string
     type: string
     shares: number
     price: number
     amount: number
     taxes: number | null           // NEW
     importedAt: string
   }
   ```

4. Update `POSITIONS_REQUIRED_FIELDS`:
   ```ts
   export const POSITIONS_REQUIRED_FIELDS = [
     'symbol',
     // 'name',                       // REMOVED (now optional)
     'assetClass',
     'shares',
     'avgCost',
     'purchaseAmount',
     'price',
     'marketValue',
   ] as const
   ```

**Acceptance**:
- Position.name is optional (string | null).
- ClosedPosition.name is optional (string | null).
- Transaction has new taxes field (number | null).
- Position has new taxes field (number | null).
- POSITIONS_REQUIRED_FIELDS does not include 'name'.
- Types compile without errors.

---

### Task 2: Update validateProfile() — allow name/taxes unmapped

**File**: `src/lib/mappingProfiles.ts`

**Changes**:

1. Update `validateProfile()` for positions kind:
   - Remove `name` from always-required fields check.
   - Keep `symbol`, `assetClass`, `shares` as required.
   - Keep avgCost/purchaseAmount and price/marketValue alternative logic unchanged.
   - Do NOT enforce that `taxes` is mapped (optional).
   - Allowed but not required: `name`, `taxes`.

2. Update `validateProfile()` for transactions kind:
   - Keep `date`, `symbol`, `type`, `shares`, `price`, `amount` as required.
   - Do NOT enforce that `taxes` is mapped (optional).

3. Pseudo-logic:
   ```
   FOR positions profiles:
     - Always require: symbol, assetClass, shares
     - Allow (but don't require): name, taxes
     - Check avgCost/purchaseAmount alternative logic (unchanged)
     - Check price/marketValue alternative logic (unchanged)

   FOR transactions profiles:
     - Always require: date, symbol, type, shares, price, amount
     - Allow (but don't require): taxes
   ```

**Acceptance**:
- `validateProfile()` passes for a positions profile with no name mapping.
- `validateProfile()` passes for profiles with no taxes mapping.
- Existing validation for required alternatives (avgCost/price) unchanged.
- No false errors for optional fields.

---

### Task 3: Update positionsImport.ts — handle null name and taxes

**File**: `src/lib/positionsImport.ts`

**Changes**:

In the position-creation loop (lines 30–67), update the Position creation:

```ts
return {
  id: uid('pos'),
  accountId,
  symbol: newSymbol,
  name: row.name ?? null,           // CHANGED: fallback to null if unmapped
  assetClass: row.assetClass,
  assetClassManualOverride: oldPosition?.assetClassManualOverride,
  shares,
  avgCost,
  price,
  taxes: row.taxes ? parseFloat(row.taxes) : null,  // NEW
  lastImportedAt: importDate,
}
```

And when creating ClosedPosition (line 100–109), preserve name as-is:

```ts
return {
  id: uid('closed'),
  accountId,
  symbol,
  name: oldPosition.name,            // Preserve (could be null)
  closedDate: importDate,
  assetClass: oldPosition.assetClass,
  realizedGL,
  realizedGLBasis,
}
```

**Acceptance**:
- Position created with `name: null` if CSV column unmapped.
- Position created with `taxes: null` if CSV column unmapped.
- Position created with parsed number for taxes if CSV column mapped.
- ClosedPosition inherits name from original Position (null or string).
- No errors on import when name/taxes unmapped.

---

### Task 4: Update transactionsImport.ts — handle null taxes

**File**: `src/lib/transactionsImport.ts`

**Changes**:

In the transaction-creation logic (wherever new Transaction objects are created),
add taxes field:

```ts
return {
  id: uid('txn'),
  accountId,
  date: row.date,
  symbol: row.symbol,
  type: row.type,
  shares,
  price,
  amount,
  taxes: row.taxes ? parseFloat(row.taxes) : null,  // NEW
  importedAt: importDate,
}
```

**Note**: If transactionsImport.ts already performs dedup or other transformations,
ensure taxes field is preserved through the pipeline (not dropped or overwritten).

**Acceptance**:
- Transaction created with `taxes: null` if CSV column unmapped.
- Transaction created with parsed number for taxes if CSV column mapped.
- No errors on import when taxes unmapped.
- Dedup logic unchanged (natural key is date|symbol|type|shares|price, not including taxes).

---

### Task 5: Update UI — fallback to symbol when name is null

**File**: `src/components/PositionsTable.tsx`

**Changes**:

Wherever position.name is displayed, replace with:

```ts
const displayName = position.name ?? position.symbol
```

Or create a helper:

```ts
function getDisplayName(position: Position | ClosedPosition): string {
  return position.name ?? position.symbol
}
```

Then use `getDisplayName(position)` throughout the component.

**Search for**: All uses of `position.name` (not including type definitions).
Replace with fallback logic.

**Acceptance**:
- Positions with null name display their symbol in the table.
- No broken links or rendering errors.
- Column header remains "Name".

---

### Task 6: Update UI — fallback to symbol when name is null (ClosedPositionsTable)

**File**: `src/components/ClosedPositionsTable.tsx`

**Changes**:

Apply same fallback logic as Task 5:

```ts
const displayName = closedPosition.name ?? closedPosition.symbol
```

**Acceptance**:
- Closed positions with null name display their symbol in the table.
- No broken links or rendering errors.

---

### Task 7: Add taxes display in TransactionsTable

**File**: `src/components/TransactionsTable.tsx`

**Changes**:

Display taxes column in the transactions table. Handle null gracefully (display "—" or empty).

**Acceptance**:
- Taxes column displays in TransactionsTable.
- Null values shown as "—" or blank.
- No broken rendering.

---

### Task 8: Add tests for optional name and taxes

**File**: `src/lib/positionsImport.test.ts`

**Add test cases**:

1. **Test 1**: Import position with no name column mapped.
   - Input: row without name (undefined).
   - Expected: Position.name = null.

2. **Test 2**: Import position with taxes column mapped.
   - Input: row with taxes="50.25".
   - Expected: Position.taxes = 50.25.

3. **Test 3**: Import position with no taxes column mapped.
   - Input: row without taxes (undefined).
   - Expected: Position.taxes = null.

4. **Test 4**: ClosedPosition inherits null name.
   - Input: old Position with name=null closes.
   - Expected: ClosedPosition.name = null.

5. **Test 5**: Validation passes without name mapped.
   - Input: profile with no name mapping.
   - Expected: validateProfile() returns { valid: true }.

6. **Test 6**: Validation passes without taxes mapped.
   - Input: profile with no taxes mapping.
   - Expected: validateProfile() returns { valid: true }.

**File**: `src/lib/transactionsImport.test.ts` (if exists)

**Add test case**:

1. **Test 1**: Import transaction with no taxes column mapped.
   - Input: row without taxes (undefined).
   - Expected: Transaction.taxes = null.

2. **Test 2**: Import transaction with taxes column mapped.
   - Input: row with taxes="25.10".
   - Expected: Transaction.taxes = 25.10.

**File**: `src/lib/mappingProfiles.test.ts`

**Add test case**:

1. **Test 1**: validateProfile allows positions profile without name.
   - Input: profile with no name in fieldMap.
   - Expected: { valid: true, errors: [] }.

2. **Test 2**: validateProfile allows transactions profile without taxes.
   - Input: profile with no taxes in fieldMap.
   - Expected: { valid: true, errors: [] }.

**Acceptance**:
- All tests pass.
- No regressions in existing tests.

---

### Task 9: Add taxes to summary selectors and cards

**Files**: `src/lib/selectors.ts`, `src/components/SummaryCards.tsx` (or equivalent)

**Changes**:

1. Add a selector to compute total taxes across all transactions:
   ```ts
   export function totalTaxesPaid(state: AppState): number {
     return state.transactions.reduce((sum, t) => sum + (t.taxes ?? 0), 0)
   }
   ```

2. Add a selector for taxes by account or filtered view (if summary cards show per-account taxes).

3. Create a summary card displaying "Total Taxes Paid" with the computed value.

**Acceptance**:
- Summary cards display total taxes paid.
- Null taxes values treated as 0 in aggregation.
- Charts/visualizations include taxes info where relevant.

---

### Task 10: Review selectors and computations for name nullability

**Files**: `src/lib/selectors.ts`, `src/lib/computations.ts`

**Review only**: Check if any selectors or computations reference Position.name.
Name is display-only and nullability should not affect aggregation logic.
Add comments if name nullability affects any selector logic.

**Acceptance**:
- No breaking changes to selectors.
- No changes to computation math (taxes never included in cost basis/GL/allocation %).
- Selectors gracefully handle null name fields.

---

### Task 11: Manual QA

**Steps**:

1. Create a CSV with columns: Symbol, AssetClass, Shares, AvgCost, Price, Taxes
   (no Name column).
2. Import and create a mapping (no name mapping; map taxes to Taxes column).
3. Observe validation passes (no error for missing name).
4. Verify imported positions have name=null, taxes=parsed value.
5. Verify PositionsTable displays symbol instead of null name.
6. Verify taxes values display (if UI added) or are silently stored.

7. Create a transactions CSV with columns: Date, Symbol, Type, Shares, Price, Amount, Taxes.
8. Import and create a mapping (no taxes mapping).
9. Verify imported transactions have taxes=null.

10. Load an old profile from IndexedDB (pre-refactor).
11. Verify it loads correctly with name/taxes gracefully defaulting to null.

**Acceptance**:
- User can import CSVs without name and taxes columns.
- Null values handled gracefully in display and computation.
- Validation UX clear (no false errors).
- Old data loads without errors.

---

## Resolved Questions

1. ✅ **UI for taxes display**: TransactionsTable will display taxes column.

2. ✅ **Taxes in selectors**: Summary cards and charts will surface taxes info (e.g., "Total Taxes Paid").

3. ✅ **Default for old profiles**: No migration needed. Rely on JS nullish coalescing (undefined → null).

4. ✅ **ClosedPosition display**: Name fallback applies to ClosedPosition (Task 6).
