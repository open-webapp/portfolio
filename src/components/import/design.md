See also: `product-behavior.md`.

# Import Module Design

## Scope
- Directory: `src/components/import/`
- Components:
  - `ImportDialog.tsx` (single stateful component)
  - `index.ts` export surface
  - `ImportDialog.test.tsx` behavior tests

## Public API
- `ImportDialog(props: ImportDialogProps)`
  - `state: AppState`
  - `dispatch(action)`
  - `onClose()`

## Local State
- Dialog state:
  - `isOpen: boolean`
  - `step: 1 | 2`
- Step 1:
  - `dataType: 'positions' | 'transactions'`
  - `entryMode: 'upload' | 'manual'` (positions flow only; reset on close and when switching to transactions)
  - `accountMode: 'existing' | 'new'`
  - `selectedAccountId: string`
  - `newAccountFields: { name, number, category, retirement }`
  - `file`, `fileName`, `fileError`
  - `csvHeaders: string[]`
  - `csvRows: Record<string,string>[]`
- Step 2:
  - `fieldMap: Record<csvColumn, targetField>`
  - `importEdits: Record<rowIndex, Record<field, value>>`
  - `assetClassHeaderValue: string`
  - `touchedAssetClassRows: Set<number>`
  - `importDone: boolean`
  - `importedRowCount: number`

## Step Flow
- Step 1 completion gate:
  - account resolved AND
  - (`entryMode === 'manual'` OR parsed CSV selected with rows).
- Continue behavior:
  - Manual mode: seeds `csvRows` with 10 blank row objects, skips mapping prefill.
  - Upload mode: preserves current behavior; can prefill `fieldMap` from saved mapping for existing account, filtered by current CSV headers.

## Data Flow
- Upload path:
  - `parseCsvFile(file)` -> `{ headers, rows }` -> `csvHeaders`, `csvRows`.
- Manual path:
  - no file parse -> `csvHeaders = []` -> `csvRows = Array.from({ length: 10 }, () => ({}))`.
- Review path:
  - `previewRows = csvRows.map(applyFieldMap(row, fieldMap))`
  - `editedRow = { ...previewRow, ...importEdits[idx] }`
  - `validatePreviewRow(dataType, editedRow)` for row validity/error states
  - `isBlankRow(editedRow)` to filter import payload and manual all-blank disable rule.
- Dispatch path:
  - optional `ADD_ACCOUNT`
  - `IMPORT_POSITIONS` or `IMPORT_TRANSACTIONS`
  - `UPSERT_CSV_MAPPING` only in upload mode.

## Rendering Rules
- Setup step:
  - positions-only segmented entry-mode control.
  - CSV dropzone/input/error block rendered only in upload mode.
- Review table headers:
  - positions `assetClass` always renders free-text input.
  - manual positions mode renders no mapping selects for non-asset fields.
  - upload mode renders mapping selects using `csvHeaders`.

## External Dependencies
- `src/lib/csv.ts`: `parseCsvFile`
- `src/lib/importPreview.ts`:
  - `applyFieldMap`
  - `validatePreviewRow`
  - `isReviewValid`
  - `isBlankRow`
- `src/lib/seed.ts`: `uid`
- `lucide-react`: `Trash` icon

## Invariants
- Manual mode never requires file selection.
- Transactions mode never renders entry-mode toggle and always behaves as upload flow.
- `isReviewValid` remains field-map-shape validation; manual mode bypasses it in import-button disabling.
- Manual positions rows containing only `assetClass` are treated as blank-equivalent for error gating.
- Import payload includes only valid, non-blank rows.

