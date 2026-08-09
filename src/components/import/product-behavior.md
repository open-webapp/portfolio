See also: `design.md`.

# Import Dialog Product Behavior

## Entry Point
- Closed state renders one trigger button: text `Import`, `aria-label="Import"`.
- Trigger opens a 2-step modal (`Setup` -> `Review`).

## Step 1: Setup
- **Data type**: segmented radios
  - `Transactions`
  - `Positions / Holdings`
- **Destination account**: segmented radios
  - `Existing account`: requires selecting an account from `state.accounts`.
  - `New account`: requires `name` + `number`; optional category + retirement flag.
- **Positions-only entry mode**:
  - `Upload CSV file` (default)
  - `Enter manually`
  - Hidden when data type is `Transactions`.
- **CSV field**:
  - Rendered only in upload mode.
  - Supports click-to-browse and drag/drop.
  - Rejects non-`.csv`; rejects empty parsed rows; shows file errors.
- **Continue enablement**:
  - Always requires account resolution (`existing` selected or `new` name+number).
  - Upload mode additionally requires parsed file with at least 1 row.
  - Manual mode does not require a file.

## Step 2: Review
- Header summary shows destination account label + tax category.
- Review table fields come from required + optional fields for selected data type.
- Per-row delete button removes row and re-keys row-indexed edit state.
- Cell editing writes to local row edits; edits are what import uses.

## Step 2 Header Inputs
- **Positions `Asset Class` column**: free-text header input always shown; broadcasts to non-touched rows.
- **Upload mode**: non-asset columns render mapping `<select>` (`Not mapped` + CSV headers).
- **Manual mode (positions)**: non-asset columns render no mapping `<select>`.

## Validation + Import Button
- Row validation is per-row via `validatePreviewRow` on mapped row + edits.
- `Import` disabled when any of the following is true:
  - upload mode and `isReviewValid(kind, fieldMap)` fails,
  - any row has validation errors (manual positions rows with only `assetClass` are ignored as blank-equivalent),
  - no preview rows exist,
  - positions mode and asset-class header is blank,
  - manual mode and all rows are blank/invalid (no valid non-blank rows).

## Import Action Behavior
- Import builds `finalRows` from valid, non-blank edited rows only.
- New-account mode dispatches `ADD_ACCOUNT` before import action.
- Positions dispatch: `IMPORT_POSITIONS` with `importDate` + `importSessionId` + `fileName`.
- Transactions dispatch: `IMPORT_TRANSACTIONS` with `importSessionId` + `fileName`.
- Mapping persistence (`UPSERT_CSV_MAPPING`) runs only for upload mode.

## Completion + Navigation
- Success state shows `Import complete`, imported row count, and `Done` button.
- `Back` returns to Step 1 preserving in-progress state.
- `Close` resets all local dialog state to defaults:
  - step/data type/account mode/account fields,
  - entry mode (`upload`), file/csv data,
  - mapping/edits,
  - asset-class header + touched row tracking,
  - completion counters.

