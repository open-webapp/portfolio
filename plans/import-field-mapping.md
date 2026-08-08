# CSV Import Field Refactoring — Implementation Plan

Support alternative field names for computed values during positions CSV import:
`purchaseAmount` as alt to `avgCost`, `marketValue` as alt to `price`.
User can map either—or both (warns and prefers direct values).
Compute missing direct values from alternatives. Remove "Available CSV Headers"
section from editor UI. Forward-facing change; no migration of existing profiles.

This plan is written caveman-simple on purpose: small tasks, explicit deps,
concrete types. Read it top to bottom before coding task 1.

## Decisions locked

1. **Validation UX**: Warnings are non-blocking. `validateProfile()` returns
   `valid: true` with `warnings` array if both direct+alternative present.
   User can confirm and proceed without fixing.

2. **Error messages**: Verbose and explicit. Examples:
   - "Either 'avgCost' OR 'purchaseAmount' must be mapped (not both missing)"
   - "Both 'avgCost' and 'purchaseAmount' are mapped; will prefer 'avgCost' during import"

3. **Null/NaN handling**: In `positionsImport.ts`, when computing from alternatives,
   explicitly check for `NaN`, `null`, and `undefined` before computing.

4. **Helper constants**: Add `AVGCOST_FIELDS` and `PRICE_FIELDS` to `src/lib/types.ts`
   right after `POSITIONS_REQUIRED_FIELDS`. Use these in validation (Task 2) and
   import computation (Task 3) instead of hardcoding field names.

## Overview

**What we're adding**:
- Two new optional fields in POSITIONS_REQUIRED_FIELDS: `purchaseAmount` and `marketValue`.
- Validation that requires EITHER `avgCost` OR `purchaseAmount` (not neither).
- Validation that requires EITHER `price` OR `marketValue` (not neither).
- Import computation: if `avgCost` missing but `purchaseAmount` present, compute
  `avgCost = purchaseAmount / shares`. Same for `price` and `marketValue`.
- Import preference: if both direct and alternative present, use direct value.
- Validation warning: user can map both (e.g., both `avgCost` and `purchaseAmount`),
  but system warns and proceeds on confirmation.
- UI: remove "Available CSV Headers:" section (lines 104–122 in MappingProfileEditor.tsx)
  — all columns already visible in each field's dropdown.
- No changes to transactions import, closed-position logic, or persisted state
  migration.

**What we are NOT changing**:
- Transactions import logic (`transactionsImport.ts` untouched).
- Closed-position dedup/realized-G/L logic.
- Profile storage format or MappingProfile interface.
- Existing profiles loaded from IndexedDB (no migration needed; new fields
  optional on import).
- Test fixtures or mock data structure.

**Source-of-truth references**:
- Domain model: `src/lib/types.ts` (Account, Position, PortfolioSnapshot).
- Import pipeline: `src/lib/mappingProfiles.ts` (profile CRUD + validation),
  `src/lib/positionsImport.ts` (replace-snapshot logic),
  `src/components/import/MappingProfileEditor.tsx` (UI).
- Computation: `src/lib/computations.ts` (marketValue/costBasis math — no changes needed).
- Tests: `src/lib/positionsImport.ts` + new test cases in `positionsImport.test.ts`.

## Architecture

```
portfolio/
  src/
    lib/
      types.ts                      # Update POSITIONS_REQUIRED_FIELDS to include
                                     # 'purchaseAmount', 'marketValue'
      mappingProfiles.ts             # Update validateProfile() to check that either
                                     # direct or alternative is mapped (not missing both);
                                     # warn if both present
      positionsImport.ts             # Add computation: avgCost from purchaseAmount,
                                     # price from marketValue; prefer direct values
      positionsImport.test.ts        # Add test cases for computed fields
    components/
      import/
        MappingProfileEditor.tsx    # Remove "Available CSV Headers" section (lines 104–122)
```

## Tasks

### Task 1: Update POSITIONS_REQUIRED_FIELDS and add helper constants

**File**: `src/lib/types.ts`

**Changes**:
- Update `POSITIONS_REQUIRED_FIELDS` to include both direct fields and alternatives:
  ```ts
  export const POSITIONS_REQUIRED_FIELDS = [
    'symbol',
    'name',
    'assetClass',
    'shares',
    'avgCost',
    'purchaseAmount',  // NEW: alternative to avgCost
    'price',
    'marketValue',     // NEW: alternative to price
  ] as const
  ```

- Add helper constants right after `POSITIONS_REQUIRED_FIELDS`:
  ```ts
  export const AVGCOST_FIELDS = ['avgCost', 'purchaseAmount'] as const
  export const PRICE_FIELDS = ['price', 'marketValue'] as const
  ```

**Notes**:
- These constants are reused in Task 2 (validation logic) and Task 3 (import computation)
  to avoid hardcoding field names.
- The validation logic will be handled in `mappingProfiles.ts` (Task 2).

**Acceptance**:
- `POSITIONS_REQUIRED_FIELDS` includes both direct and alternative names.
- `AVGCOST_FIELDS` and `PRICE_FIELDS` constants exist and are exported.

---

### Task 2: Update validateProfile() to handle alternatives

**File**: `src/lib/mappingProfiles.ts`

**Changes**:
- Update `ValidationResult` interface to include optional `warnings` array:
  ```ts
  export interface ValidationResult {
    valid: boolean
    errors: string[]
    warnings?: string[]
  }
  ```

- Modify `validateProfile()` to:
  1. Import `AVGCOST_FIELDS`, `PRICE_FIELDS` from `types.ts`.
  2. Check that EITHER `avgCost` OR `purchaseAmount` is mapped (not both missing).
     - Error message: "Either 'avgCost' OR 'purchaseAmount' must be mapped (not both missing)"
  3. Check that EITHER `price` OR `marketValue` is mapped (not both missing).
     - Error message: "Either 'price' OR 'marketValue' must be mapped (not both missing)"
  4. Check that `shares`, `symbol`, `name`, `assetClass` are always mapped.
  5. Check if both avgCost AND purchaseAmount present → add warning (non-blocking).
     - Warning message: "Both 'avgCost' and 'purchaseAmount' are mapped; will prefer 'avgCost' during import"
  6. Check if both price AND marketValue present → add warning (non-blocking).
     - Warning message: "Both 'price' and 'marketValue' are mapped; will prefer 'price' during import"
  7. Return `{ valid: true, warnings: [...] }` if no errors (warnings don't block).

**Pseudo-logic**:
```
mappedFields = set of all target field names in fieldMap
errors = []
warnings = []

FOR positions profiles:
  - Require: symbol, name, assetClass, shares (always)
  - If neither avgCost nor purchaseAmount in mappedFields:
    errors.push("Either 'avgCost' OR 'purchaseAmount' must be mapped (not both missing)")
  - If neither price nor marketValue in mappedFields:
    errors.push("Either 'price' OR 'marketValue' must be mapped (not both missing)")
  - If both avgCost AND purchaseAmount in mappedFields:
    warnings.push("Both 'avgCost' and 'purchaseAmount' are mapped; will prefer 'avgCost' during import")
  - If both price AND marketValue in mappedFields:
    warnings.push("Both 'price' and 'marketValue' are mapped; will prefer 'price' during import")

FOR transactions profiles:
  - No change; keep existing logic (date, symbol, type, shares, price, amount required)
```

**Acceptance**:
- `validateProfile()` returns `ValidationResult` with `errors` and `warnings` arrays.
- Profile passes validation if `errors` is empty (even if warnings exist).
- Warnings shown to user but don't block proceeding.

---

### Task 3: Compute missing fields in positionsImport.ts

**File**: `src/lib/positionsImport.ts`

**Changes**:
- Import `AVGCOST_FIELDS`, `PRICE_FIELDS` from `src/lib/types.ts`.
- In the position-creation loop (lines 30–51), after parsing shares/avgCost/price,
  add computation logic:
  1. If `avgCost` is NaN/null/undefined AND `purchaseAmount` present: compute
     `avgCost = parseFloat(row.purchaseAmount) / shares`.
  2. If `price` is NaN/null/undefined AND `marketValue` present: compute
     `price = parseFloat(row.marketValue) / shares`.
  3. If both direct and alternative present (e.g., both avgCost and purchaseAmount
     in row), prefer direct value (user mapped both; validation already warned).

**Pseudo-logic** (inside newPositions.map):
```
const shares = parseFloat(row.shares)
let avgCost = parseFloat(row.avgCost)
let price = parseFloat(row.price)

// Compute avgCost from purchaseAmount if avgCost is invalid
if ((isNaN(avgCost) || avgCost === null || avgCost === undefined) && row.purchaseAmount) {
  const purchaseAmount = parseFloat(row.purchaseAmount)
  if (!isNaN(purchaseAmount) && purchaseAmount !== null && purchaseAmount !== undefined) {
    avgCost = purchaseAmount / shares
  }
}

// Compute price from marketValue if price is invalid
if ((isNaN(price) || price === null || price === undefined) && row.marketValue) {
  const marketValue = parseFloat(row.marketValue)
  if (!isNaN(marketValue) && marketValue !== null && marketValue !== undefined) {
    price = marketValue / shares
  }
}
```

**Acceptance**:
- Position created with avgCost computed from purchaseAmount if avgCost invalid.
- Position created with price computed from marketValue if price invalid.
- Explicit null/NaN/undefined checks prevent invalid computed values.
- No change to snapshot-value calculation (still `shares * price`).

---

### Task 4: Remove "Available CSV Headers" UI section

**File**: `src/components/import/MappingProfileEditor.tsx`

**Changes**:
- Delete lines 104–122 (the div containing "Available CSV Headers:" section).
- Rationale: all CSV headers are already visible in each required field's dropdown
  (lines 149–153). Duplicating them here adds noise.

**Acceptance**:
- Editor renders without the "Available CSV Headers" section.
- Each field dropdown still shows all CSV headers.

---

### Task 5: Add tests for computed fields

**File**: `src/lib/positionsImport.test.ts` (new or update existing)

**Add test cases**:
1. **Test 1**: Import position with `purchaseAmount` mapped, no `avgCost`.
   - Input: row with purchaseAmount=1000, shares=10 (no avgCost).
   - Expected: Position avgCost = 1000 / 10 = 100.

2. **Test 2**: Import position with `marketValue` mapped, no `price`.
   - Input: row with marketValue=1200, shares=10 (no price).
   - Expected: Position price = 1200 / 10 = 120.

3. **Test 3**: Import position with both `avgCost` and `purchaseAmount` mapped.
   - Input: row with avgCost=100, purchaseAmount=1200 (conflict).
   - Expected: Position avgCost = 100 (prefer direct).

4. **Test 4**: Import position with both `price` and `marketValue` mapped.
   - Input: row with price=120, marketValue=1200 (conflict).
   - Expected: Position price = 120 (prefer direct).

5. **Test 5**: Validation warns if both direct + alternative mapped.
   - Input: profile with both avgCost and purchaseAmount in fieldMap.
   - Expected: validateProfile() returns { valid: true, warnings: [...] }.

6. **Test 6**: Validation errors if both alternatives missing.
   - Input: profile with neither avgCost nor purchaseAmount.
   - Expected: validateProfile() returns { valid: false, errors: [...] }.

**Acceptance**:
- All tests pass.
- No regressions in existing tests.

---

### Task 6: Manual QA

**Steps**:
1. Create a CSV with columns: Symbol, Name, AssetClass, Shares, PurchaseAmount, MarketValue
   (no avgCost or price columns).
2. Import and map PurchaseAmount → purchaseAmount, MarketValue → marketValue,
   other fields to their columns.
3. Observe validation warns about missing avgCost/price but allows proceed
   (or automatically computes).
4. Verify imported positions have correct avgCost and price values.
5. Verify "Available CSV Headers" section is gone from the editor.
6. Import a profile with all fields (symbol, name, assetClass, shares, avgCost,
   price) and verify no warnings.

**Acceptance**:
- User can successfully import CSV with alternative field names.
- Computed values are correct.
- Validation behavior matches spec.
- UI simplification complete.

