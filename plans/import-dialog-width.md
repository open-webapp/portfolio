# Import Dialog: Widen Modal So Step 3 Preview Shows All Columns

Step 3 preview table needs ~950px (positions, 9 fields) / ~750px (transactions, 7 fields) but
modal is capped at 600px → horizontal scroll. Widen modal. Single-line inline-style change.
Plan is caveman-simple: small tasks, explicit deps. Read top to bottom before coding task 1.

## Decisions locked

1. **Single edit, one line**: Change `maxWidth: '600px'` → `maxWidth: 'min(1200px, 95vw)'`
   at `src/components/import/ImportDialog.tsx:457`. Do NOT touch anything else.
2. **Inline style only**: `src/styles/styles.css` must stay byte-identical to design bundle.
   No CSS file edits, no new classes.
3. **All 4 steps share modal container** → one edit widens every step. Step 2 mapping grid
   and Step 3 preview already have `overflow: 'auto'` wrappers (ImportDialog.tsx:830, 1177);
   scroll disappears once modal is wide enough.
4. **Settings page profile editor** (uses `.dialog`, 440px) is out of scope. Don't touch.
5. **No test change**: no test asserts modal width. Do not add one.

## Overview

**What we change**:
- One inline style on the modal container div: `maxWidth: '600px'` → `maxWidth: 'min(1200px, 95vw)'`.

**What we do NOT change**:
- `src/styles/styles.css` (must remain byte-identical).
- Any other component, lib, selector, or test.
- Settings page profile editor dialog width.
- The `overflow: 'auto'` wrappers (already correct).

**Source-of-truth references**:
- Modal container + style: `src/components/import/ImportDialog.tsx:446-463` (style line 457).
- Step 3 preview table: `src/components/import/ImportDialog.tsx:1190-1215`
  (Row col `width: '50px'` line 1196, field cols `minWidth: '100px'` line 1208).
- Overflow wrappers: `src/components/import/ImportDialog.tsx:830` (step 2), `:1177` (step 3).

## Tasks

### Task 1: Widen modal container

**File**: `src/components/import/ImportDialog.tsx`

**Changes**:
1. Line 457: `maxWidth: '600px',` → `maxWidth: 'min(1200px, 95vw)',`.
2. No other edits. Don't touch maxHeight, padding, or anything else.

**Acceptance**:
- Modal cap is `min(1200px, 95vw)`.
- `src/styles/styles.css` unchanged (byte-identical).
- No other files changed.

### Task 2: Verify — build + test + manual QA

**Changes**: none (verification only).

**Steps**:
1. `npm run build` — typecheck + production build pass.
2. `npm run test` — all tests pass, no regressions.
3. Manual (dev server, optional):
   - Open Import CSV, load a positions CSV with all 9 fields mapped.
   - Step 3 preview at ≥1200px viewport: all columns visible, no horizontal scroll.
   - Step 1, 2, 4 render fine at the wider width.
   - Narrow a browser to <1200px: modal shrinks to 95vw, preview scrolls horizontally (acceptable).
   - Confirm Settings page profile editor dialog unchanged at 440px.

**Acceptance**:
- `npm run build` passes.
- `npm run test` passes.
- Manual QA confirms no horizontal scroll in Step 3 positions preview at ≥1200px viewport.

## Acceptance Criteria (all must hold)

- [ ] Single-line change: `maxWidth: 'min(1200px, 95vw)'` at ImportDialog.tsx:457.
- [ ] `src/styles/styles.css` byte-identical to design bundle (no edits).
- [ ] Settings profile editor (.dialog, 440px) untouched.
- [ ] `npm run build` passes.
- [ ] `npm run test` passes.
- [ ] Step 3 positions preview (9 fields, ~950px) fully visible at ≥1200px viewport.

## Notes

- Reference docs (product-behavior.md, design.md): no update needed. Change is a
  trivial visual width tweak, no behavior/schema/API shift. Skip doc edits.
- Commit after Task 2 verification passes, per CLAUDE.md ground rules.
