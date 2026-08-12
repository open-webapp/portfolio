# design.md

Directory structure, API contract, component tree, state management, data model, data flows, design patterns.

## Component Tree

- `ClosedPositionsTable.tsx` — table with symbol, closed date, realized G/L, delete + undo buttons

## Data Flows

### Undo Closed Position

ClosedPosition → ImportDialog Step 2 (pre-filled row) → IMPORT_POSITIONS + DELETE_CLOSED_POSITION dispatch
