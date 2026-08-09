# Import Dialog Step 1: Two-Column Layout (Account | Data Source)

Layout-only change to Step 1 ("Setup") of `ImportDialog.tsx`. Right now Step 1
is one `max-width: 720px` column stacking: data-type seg → account-mode seg →
account select/new-account form → positions upload/manual seg → dropzone.
We split it into two side-by-side columns — LEFT = account stuff, RIGHT = data
stuff — with a hairline divider between them. Zero behavior change: same
state, same validation, same dispatches, same Step 2. Caveman-simple: no new
libraries, no new CSS classes, inline styles only (styles.css stays
byte-identical per CLAUDE.md).

No `plans/_template.md` exists in the repo (checked, not found) — this plan
follows the structure/tone of the most similar recent plans instead
(`plans/import-manual-entry.md`, `plans/import-dialog-width.md`): short
overview, locked decisions, ordered tasks with deps, acceptance criteria.

## Decisions locked

1. **Scope**: Step 1 JSX/layout only. Step 2 ("Review") untouched — same
   table, same width, same step-indicator/header/footer. Transactions stays
   CSV-only (no manual-entry path added). All state/handlers
   (`isStep1Complete`, `handleContinue`, `ADD_ACCOUNT` on commit,
   `UPSERT_CSV_MAPPING`, etc.) untouched — this is a pure JSX-relocation +
   wrapper-div change.
2. **Two columns**:
   - LEFT: "Destination account" seg (existing/new) + existing-account
     `<select>` OR new-account form (name, number, InstitutionSelect,
     category select, retirement checkbox) — currently
     `ImportDialog.tsx:571-705`.
   - RIGHT: "What are you importing?" seg (currently `:544-569`) + (positions
     only) upload/manual seg (currently `:707-731`) + CSV dropzone (currently
     `:733-783`).
   - Both columns visible/interactive simultaneously always — no gating one
     column on the other's state (matches current behavior).
3. **Sizing**: CSS grid, columns sized to content (`grid-template-columns:
   auto auto`, NOT `1fr 1fr`). Remove the current `maxWidth: '720px'` wrapper
   on step-1 content.
4. **Dialog width**: unchanged mechanism — dialog already has
   `width: 'min(96vw, 1400px)'`, `maxWidth: '96vw'` at the outer `.dialog`
   div (`ImportDialog.tsx:482-483`). Do not introduce a second/different cap
   for Step 1; the two-column content just needs to fit inside the existing
   dialog sizing. No new max-width value invented.
5. **Responsive stack**: CSS-only reflow when combined column width would
   exceed the dialog's available width — implement via `flexWrap: 'wrap'` on
   a flex container (simplest, no media query needed, matches existing
   pattern already used elsewhere in this file for the step-indicator row
   `:527` and the file-selected summary `:833-841`) rather than CSS grid +
   `@media` (grid doesn't reflow on flex-wrap options without a manual
   `@container`/media query, and CLAUDE.md forbids new rules in styles.css,
   and this file has no `<style>` block precedent — flex-wrap keeps
   everything inline-style and is proven-fluid). Columns keep their own
   natural (`auto`/content-based, i.e. no `flex: 1` stretch) width so each
   wraps to full-width when stacked.
6. **Vertical alignment**: `alignItems: 'flex-start'` on the flex container —
   no height-matching, shorter column ends higher.
7. **Divider**: a plain `<div>` with `borderLeft: '1px solid
   var(--color-divider)'` between the two column `<div>`s, with side padding
   (e.g. `padding: '0 var(--space-5)'` wrapping the border div, or margin on
   the border div itself) so there's visible gap on both sides — same
   `--color-divider` token already used for the dropzone's dashed border
   (`:741`) and `.dialog`/`.card` blueprint borders in styles.css. This
   divider must itself disappear/not render awkwardly when columns stack —
   simplest correct behavior: leave the divider `<div>` in the DOM (a
   1px-wide flex item), it just becomes a thin horizontal-adjacent sliver
   when wrapped; acceptable since CLAUDE.md requires CSS-only reflow with no
   new breakpoint math, and a stray 1px vertical hairline between two
   full-width stacked blocks is visually harmless. (Flagged as a judgment
   call below — alternative is to hide the divider via a wrapping media
   query, rejected because it needs a new styles.css rule.)
8. **No styles.css edits.** All new layout styles are inline `style={{...}}`
   on plain wrapper `<div>`s, following the file's existing convention
   (`style={{maxWidth:'720px'}}`, inline grids for the seg controls and
   new-account form).

## What we do NOT change

- Any state variable, handler, dispatch, or validation function.
- Step 2 (Review) markup, width, or logic.
- `src/styles/styles.css` (must stay byte-identical).
- Transactions flow (still no manual-entry toggle).
- Dialog outer sizing (`width`/`maxWidth`/`maxHeight` on `.dialog.blueprint`).

## Source-of-truth references

- Step 1 content wrapper: `ImportDialog.tsx:543` (`<div style={{ maxWidth:
  '720px' }}>` through closing `</div>` at `:790`).
- Data-type seg (→ RIGHT column): `:544-569`.
- Destination-account seg + existing-account select + new-account form
  (→ LEFT column): `:571-705`.
- Positions upload/manual seg (→ RIGHT column, after data-type seg):
  `:707-731`.
- CSV dropzone (→ RIGHT column, after upload/manual seg): `:733-783`.
- Continue button / `.dialog-actions` (→ stays below both columns, full
  width, unchanged): `:785-789`.
- Dialog outer sizing: `:482-483` (`width: 'min(96vw, 1400px)'`,
  `maxWidth: '96vw'`).
- `--color-divider` usage precedent: dropzone border `:741`; also defined/
  used throughout `src/styles/styles.css` (`.dialog`/`.card` blueprint
  borders, `.seg`/`.seg-opt` borders, ~lines 192-284).
- Docs to update after implementation: `product-behavior.md:58-81` ("## CSV
  import (Positions / Transactions)" section, specifically the "Step 1 —
  Setup" bullet at line 64 which currently says content is "constrained to
  `max-width: 720px`"), `design.md:123-127` ("## Data flow" → "**CSV
  import**" subsection, step 1 description). Note: this repo keeps
  `product-behavior.md`/`design.md` at repo root, not under
  `src/components/import/` — confirmed by `find`, no per-module docs exist
  for this component; update the root files.

## Tasks

Work top to bottom. Each ≤30 min. Do not skip the divider/stack task even
though it looks cosmetic — it's an explicit resolved requirement (#6 in the
brief).

### Task 1: Restructure Step 1 JSX into two flex columns [depends on: nothing]

**File**: `src/components/import/ImportDialog.tsx`

1. Replace the outer step-1 wrapper `<div style={{ maxWidth: '720px' }}>`
   (`:543`) with a flex row container:
   ```tsx
   <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-5)' }}>
   ```
2. Wrap the destination-account block (current `:571-705`: the "Destination
   account" seg field + existing-account select + new-account form) in a new
   LEFT column `<div>`:
   ```tsx
   <div style={{ display: 'flex', flexDirection: 'column' }}>
     {/* destination-account seg + existing/new account block, moved as-is */}
   </div>
   ```
3. Insert the divider between the two columns:
   ```tsx
   <div style={{ alignSelf: 'stretch', borderLeft: '1px solid var(--color-divider)' }} />
   ```
   (`alignSelf: 'stretch'` makes the divider span the taller column's height
   without forcing the *columns* to match height — this only affects the
   divider element itself, not requirement #6's "no height stretching" on
   the columns.)
4. Wrap the data-type seg (`:544-569`) + positions upload/manual seg
   (`:707-731`) + CSV dropzone (`:733-783`) together, in that order, in a new
   RIGHT column `<div>`:
   ```tsx
   <div style={{ display: 'flex', flexDirection: 'column' }}>
     {/* data-type seg, then upload/manual seg (positions only), then dropzone, moved as-is */}
   </div>
   ```
5. Close the flex row container after the RIGHT column. The `.dialog-actions`
   Continue button block (`:785-789`) stays a sibling AFTER the flex row
   (full width, unchanged) — do not put it inside either column.
6. Do not change any `className`, handler, or state reference inside the
   moved blocks — literally cut/paste the JSX between the new wrapper divs.
7. Leave each individual field's existing inline styles (e.g.
   `marginBottom: 'var(--space-4)'` on each `.field`) as-is; do not add
   `width: '100%'` or `flex: 1` to the seg controls — content-sizing is the
   point (requirement #3).

**Acceptance**:
- Step 1 renders two side-by-side `<div>`s + a divider `<div>` between them,
  wrapped in a `flexWrap: 'wrap'` row.
- LEFT column contains exactly: destination-account seg, then
  existing-account select OR new-account form (conditionally, as before).
- RIGHT column contains exactly: data-type seg, then (positions only)
  upload/manual seg, then (upload mode only) dropzone — same conditionals as
  before, just relocated.
- No `maxWidth: '720px'` remains anywhere in the file.
- `src/styles/styles.css` untouched.
- `npm run build` typechecks clean (no JSX structural errors).

### Task 2: Manual visual/behavioral smoke check [depends on: 1]

**Changes**: none — verification only, catches anything Task 1's cut/paste
missed before touching tests.

1. `npm run dev` (or reuse existing dev server), open Import dialog.
2. Toggle every Step 1 combination and confirm nothing regressed:
   - Positions + existing account + upload mode: dropzone visible in RIGHT
     column, account select visible in LEFT column, both usable
     simultaneously.
   - Positions + new account: new-account form (4-col grid + checkbox)
     renders fully in LEFT column, un-clipped.
   - Positions + manual mode: upload/manual seg + no dropzone in RIGHT
     column.
   - Transactions: no upload/manual seg shown (still gated), dropzone shown
     directly under data-type seg.
3. Confirm the vertical divider renders between columns at normal (wide)
   viewport width, with visible gap on both sides.
4. Narrow the browser/devtools viewport until columns can't fit side by side
   — confirm they stack vertically (flex-wrap kicks in) and remain fully
   usable (no clipped inputs, Continue button still reachable and correctly
   enabled/disabled).
5. Confirm Continue still enables/disables per existing rules (blank vs
   filled account fields, file selected vs not) — this task is checking for
   accidental logic breakage from the JSX move, not testing new logic.

**Acceptance**: all sub-checks above pass with no visual clipping, no
console errors, Continue gating unchanged.

### Task 3: Update `ImportDialog.test.tsx` for new structure [depends on: 1]

**File**: `src/components/import/ImportDialog.test.tsx`

The existing tests use `getByRole`/`getByText` queries that don't depend on
DOM tree shape (no `.closest()`, no sibling-order assertions, no snapshot
tests) — spot check confirmed no existing assertion should break purely from
wrapping the same elements in new parent `<div>`s. Still:

1. Run `npm run test` after Task 1 first, before writing any new test, to
   confirm this assumption — if any existing assertion breaks (e.g. an
   `expect(x).toBeTruthy()` on ordering, or a query scoped via
   `.closest('div')` walking a specific number of ancestors), fix that
   assertion to match the new structure (should be rare/none expected, but
   verify, don't assume).
2. Add a new small test (or extend `describe('Step 1')`-style block if one
   exists — check existing file's `describe` grouping first) asserting the
   two-column structure exists in a way that's meaningfully testable in
   jsdom without depending on computed CSS layout (jsdom doesn't compute
   flex layout, so don't assert on bounding boxes/positions):
   - Open dialog, assert both "Destination account" and "What are you
     importing?" labels are present simultaneously (already implicitly true,
     but pin it as an explicit "both columns visible together" test per
     requirement #3).
   - Assert the divider element is present, e.g. by giving it a stable
     `data-testid="import-step1-divider"` (only test hook added — do not add
     test-ids to any other moved element, keep the diff minimal) and
     querying `screen.getByTestId('import-step1-divider')`.
   - Do NOT attempt to assert grid/flex column widths, `flexWrap` behavior,
     or responsive stacking in jsdom — that's not meaningfully testable
     without a real layout engine; rely on Task 2's manual check for that.

**Acceptance**:
- `npm run test` passes, zero regressions in `ImportDialog.test.tsx` or any
  other suite.
- New test(s) assert: both columns' key controls render together, divider
  element present.

### Task 4: Update reference docs [depends on: 1, 2, 3]

**Files**: `product-behavior.md`, `design.md` (repo root)

Per CLAUDE.md's reference-docs rule ("Auto-update after every change" —
mandatory, not conditional on user request):

1. `product-behavior.md:64` — replace "**Step 1 — Setup** (content
   constrained to `max-width: 720px` so inputs don't stretch across the full
   dialog):" and the bullet list under it (`:65-71`) to describe the new
   two-column layout: LEFT column = destination-account controls, RIGHT
   column = data-type + entry-mode + file controls, divider between them,
   columns size to content, stack on narrow viewports. Keep all the existing
   sub-bullet behavioral detail (seg options, select option format,
   new-account grid fields, Continue-enable conditions) — only the
   layout/structure framing sentence changes, not the behavior bullets
   themselves (none of that changed).
2. `design.md:123-127` — update step 1's one-line description ("**Setup**
   (`step === 1`): pick data type ..., destination account ..., and entry
   mode...") to note the two-column arrangement (account column vs data
   column) if useful for a component-tree/layout reader; keep it terse, this
   is a design/architecture doc not a pixel spec — one clause addition is
   enough, don't turn it into a layout essay.
3. Full-file review per CLAUDE.md: after editing, re-read the "## CSV
   import" section of `product-behavior.md` in full (not just the edited
   bullet) and the "**CSV import**" paragraph of `design.md` in full, to
   confirm no stale cross-references (e.g. nothing else in either doc
   references "720px" or a single-column framing) and both stay terse/
   consistent with the rest of the doc's style.

**Acceptance**:
- No remaining reference to `max-width: 720px` or single-column framing in
  either doc.
- Both docs still terse/token-optimized (no narrative bloat added).
- Behavioral bullets (validation rules, seg options, Continue-enable logic)
  unchanged in content — only structural/layout framing updated.

### Task 5: Final verification + commit [depends on: 1, 2, 3, 4]

1. `npm run build` — typecheck + production build clean.
2. `npm run test` — full suite passes.
3. `npm run lint` — clean (oxlint).
4. Confirm `git diff --stat` shows only `ImportDialog.tsx`,
   `ImportDialog.test.tsx`, `product-behavior.md`, `design.md` changed —
   `src/styles/styles.css` NOT in the diff.
5. Commit, per CLAUDE.md: only after all tests pass and docs are updated
   (this task's own gate — don't commit from Task 1/2/3 individually).

**Acceptance**: all four commands above pass; diff scope matches exactly the
4 files listed; single commit created per CLAUDE.md's "commit only once all
tests pass and docs updated" rule.

## Acceptance Criteria (tied to the 9 resolved requirements)

- [ ] 1. Zero functional/behavioral changes: all handlers, state, dispatches
      identical; Transactions still has no manual-entry path.
- [ ] 2. LEFT column = destination-account controls moved as-is; RIGHT
      column = data-type seg + entry-mode seg (positions only) + dropzone
      moved as-is; no new widgets added.
- [ ] 3. Both columns visible/interactive simultaneously, no cross-column
      gating.
- [ ] 4. Columns are content-sized (no forced `1fr 1fr` / equal split); old
      `maxWidth: '720px'` single-column constraint removed.
- [ ] 5. Dialog width still governed by the existing `min(96vw, 1400px)` /
      `maxWidth: 96vw` rule on `.dialog.blueprint` — no new/different cap
      introduced for Step 1.
- [ ] 6. Narrow viewport: columns reflow to stacked (single-column) via
      CSS-only `flexWrap`, no new fixed-pixel breakpoint.
- [ ] 7. Columns top-aligned (`alignItems: 'flex-start'`), no height
      matching — shorter column ends higher.
- [ ] 8. Hairline vertical divider between columns using
      `var(--color-divider)`, with padding/gap on both sides, implemented
      inline (not in styles.css).
- [ ] 9. Step 2 (Review) completely unchanged — same table, same width
      behavior, same step indicator/header/footer.
- [ ] `npm run build`, `npm run test`, `npm run lint` all pass.
- [ ] `product-behavior.md` and `design.md` updated to reflect two-column
      layout; no stale "720px"/single-column references remain.
- [ ] `src/styles/styles.css` byte-identical (no edits).

## Open questions / judgment calls made while planning

- **Divider behavior when stacked**: brief says "no new fixed pixel
  breakpoint invented; keep it CSS-only" but doesn't say what the divider
  should visually do when columns stack. Chose: leave it in the flex flow as
  a thin item (harmless 1px sliver) rather than hiding it via a new
  styles.css media query, since the latter would violate the
  no-styles.css-edits constraint. Flagged in Task 1 step 3 / Decision #7 —
  revisit if the user wants the divider to vanish on stack instead.
- **No `plans/_template.md` exists in the repo** (confirmed via `find`).
  This plan's structure/section-naming mirrors the two most recent,
  most-similar existing plans (`import-manual-entry.md`,
  `import-dialog-width.md`) instead. If a template shows up later, no
  content change needed, just reformatting.
- **Reference docs location**: CLAUDE.md's AGENTS.md-style rule says module
  docs live "in the module root" (i.e. `src/components/import/`), but this
  repo's actual `product-behavior.md`/`design.md` live at repo root and
  already cover ImportDialog there (confirmed no per-module docs exist for
  `src/components/import/`). Followed existing repo convention (root-level
  docs) rather than the abstract rule, since the concrete precedent is
  unambiguous.
