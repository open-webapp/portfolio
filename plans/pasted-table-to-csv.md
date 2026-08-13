# Pasted table → CSV (`tableToCsv`)

## Overview

Two clipboard pastes in, one CSV out. Headers paste sets column names AND
column count N. Values paste supplies rows. No user-entered column count
anymore.

Public API, single entry, helpers private:

```
tableToCsv(headersClipboard, valuesClipboard)
  arg shape:    { html?: string, text?: string }
  return shape: { headers: string[], rows: Record<string,string>[],
                  csv: string,
                  issues: Array<{rowIndex:number, got:number, expected:number}> }
```

Return is structural superset of `ParsedCsv` (`src/lib/csv.ts:3`). Pin that
with an exported conditional-type assertion so `tsc -b` breaks if it drifts.

TWO hand-maintained copies (user chose this, no build step):
- `src/lib/pastedTable.ts` — typed ES module, `import type { ParsedCsv } from './csv'`.
- `pastedTable.js` — repo root, classic script, sets `window.PastedTable = { tableToCsv }`.
  Must run from `file://` by double-click. No `type="module"`, no dev server.
  NOTE: root `.js` is outside `tsconfig.app.json` `include: ["src"]`, so tsc
  ignores it. Good.

Drift guard: ONE vitest suite, ONE shared case table, run against BOTH copies.
`.ts` imported directly. `.js` read off disk with `readFileSync` and executed
via `new Function(src)()` inside the jsdom global, then grabbed off
`globalThis.window.PastedTable`. Drift = red test.

Both copies need DOM (`DOMParser`). Browser has it. vitest env is already
jsdom (`vitest.config.ts`). Fine. Library is NOT node-safe; that's accepted.

Files in play:
- `src/lib/pastedTable.ts` — NEW.
- `pastedTable.js` — NEW, repo root.
- `src/lib/pastedTable.test.ts` — NEW, colocated per repo convention.
- `test1.html` — REWORKED (dev harness).
- `design.md` §Directory structure, §Design patterns — update.
- `schema-spec.md` — add `TableToCsvResult` shape.
- `product-behavior.md` — NO update. `test1.html` is a dev harness, not
  shipped UI; that doc covers user-visible app behavior only. Judgment call,
  stated so nobody re-litigates it mid-implementation.

OUT OF SCOPE, do not touch: `src/components/import/ImportDialog.tsx`,
`src/lib/csv.ts`, `src/lib/importPreview.ts`, any app wiring, `index.html`,
`test.html`.

### Resolved algorithm (implement exactly this, do not improvise)

**Branch pick, per paste, independently**: use `html` when it is present AND
`/<table/i` matches. Else use `text`. Else that paste is empty.

**normalizeCell(s)**: replace ` ` → space, collapse `/\s+/g` → single
space, `.trim()`. Applied to EVERY cell, both branches, both pastes.

**No cell EVER contains a newline.** Before reading `textContent` on an HTML
cell, replace `<br>` and block-element boundaries with a SPACE — plain
`textContent` renders `<br>` as nothing, so `Line one<br>Line two` would
otherwise jam into `Line oneLine two`. Implement by cloning the cell and
swapping `br` nodes for `' '` text nodes (or `innerHTML.replace(/<br\s*\/?>/gi, ' ')`
on a detached copy) before `textContent`. The `\s+` collapse then handles
literal newlines and indentation from pretty-printed source markup.
Consequence: the RFC 4180 "quote embedded CR/LF" clause is UNREACHABLE by
design. Keep it in the serializer as a cheap defensive guard, do not remove it,
but do not build multi-line-cell behavior on top of it.

**Headers parse** — flatten, ignore row/line boundaries:
- HTML: `doc.querySelectorAll('th, td')` document order → `textContent` →
  normalize.
- Text: `split(/[\t\r\n]/)` → normalize.
- DROP blank cells (headers paste only).
- Uniquify, in order:
  - still-blank (defensive) → `column_${i+1}` by 1-based position.
  - already-seen name → append `_2`, then `_3`, … Keep bumping the suffix
    until the candidate is unused (handles the `["a","a_2","a"]` collision).
- `N = headers.length`.
- If `N === 0`: return `{ headers: [], rows: [], csv: '', issues: [] }`. No throw.

**Values parse, HTML branch** — fixed grid, span expansion:
- Iterate `table.querySelectorAll('tr')`, row index r.
- Sparse `grid[r][c]`. For each cell find lowest free `c` in row r.
- `cs = colspan||1`, `rs = rowspan||1`, clamp to >=1 (and sane cap, e.g. 1000,
  so a hostile `colspan="99999"` can't hang the tab).
- `grid[r][c] = text`.
- colspan spill (same row): `grid[r][c+1..c+cs-1] = ''`  ← EMPTY, text once.
- rowspan carry (rows below): `grid[r+1..r+rs-1][c] = text` ← CARRIED DOWN,
  not blank. Their colspan companions in those rows are `''`.
- Holes → `''`.

**Values parse, TEXT branch** — per-LINE dispatch:
- `split(/\r\n|\r|\n/)`.
- Blank/whitespace-only line → skip.
- Line CONTAINS a tab → it is a row. `line.split('\t')` then normalize each.
  PRESERVE empty cells (no filter — this is what stops column shift).
- Line with NO tab → push normalized text onto a flat buffer.
- Ordering rule: before emitting a tab-row, FLUSH the buffer (chunk N-at-a-
  time) so document order is preserved. Flush again at end of input.
- Runs of spaces are NEVER separators.

**Fit every row to exactly N**: pad with `''` or truncate. Any row that got
padded or truncated appends `{ rowIndex, got, expected: N }`. `rowIndex` is
0-based index into the DATA rows array (header row is not counted, and the
index is the post-fit position).

**rows**: `Record<string,string>`, keyed by `headers[i]`. Safe because headers
are uniquified.

**CSV (RFC 4180)**:
- comma delimiter.
- quote a field ONLY when it contains `,` `"` CR or LF; embedded `"` doubled.
- row terminator `\r\n`; NO trailing newline; NO BOM.
- header row is line 1.

**issues**: REQUIRED, not optional. No `?` on the field. Always emit the array,
`[]` when clean. Callers use `result.issues.length` with no guard and no
optional chaining. Extra required fields keep the type a structural superset of
`ParsedCsv` (which only demands `headers` and `rows`), so Import-overlay
compatibility is unaffected.

## Tasks

Do in order unless a task says otherwise. Each ≤30 min.

### T0. Worktree bookend — create [depends on: nothing]
- `git worktree add ../worktree-pasted-table -b feature/pasted-table-to-csv`
- `cd ../worktree-pasted-table`
- ALL later tasks happen inside this worktree. Record the original repo path
  (`/Users/mdoraiswamy/owa/portfolio`) — needed by the teardown task.
- `npm install` not needed (worktree shares nothing, but `node_modules` is
  absent). If `npx vitest` fails to resolve, run `npm ci` in the worktree
  once, then continue.

### T1. `src/lib/pastedTable.ts` — types + normalize + header parse [depends on: T0]
- Declare exported `PastedClipboard { html?: string; text?: string }` and
  `TableToCsvResult` (exact shape from Overview). Declare
  `CsvIssue { rowIndex: number; got: number; expected: number }`.
- `import type { ParsedCsv } from './csv'` (MUST be `import type` —
  `verbatimModuleSyntax` is on).
- Add the drift pin, exported so `noUnusedLocals` can't flag it:
  `export type PastedTableIsParsedCsv = TableToCsvResult extends ParsedCsv ? true : never`
- Private `normalizeCell`.
- Private `pickBranch(clip)` → `'html' | 'text' | 'none'` using the
  `/<table/i` rule.
- Private `parseHeaders(clip): string[]` — flatten, drop blanks, uniquify.
- Nothing exported publicly yet except types. No `tableToCsv` yet.

### T2. `pastedTable.ts` — values HTML grid expansion [depends on: T1]
- Private `parseHtmlGrid(html): string[][]` implementing the colspan/rowspan
  rules verbatim from the Overview. Clamp spans. Fill holes with `''`.
- Do NOT fit to N here — raw grid only, ragged is fine at this stage.

### T3. `pastedTable.ts` — values text branch + fit-to-N [depends on: T1]
- Private `parseTextRows(text, n): string[][]` — per-line dispatch, tab-row vs
  buffer, flush-before-tab-row ordering, end flush chunked N-at-a-time.
- Private `fitRows(rawRows, n): { rows: string[][], issues: CsvIssue[] }` —
  pad/truncate, record issues.
- Can run in parallel with T2.

### T4. `pastedTable.ts` — CSV serializer + `tableToCsv` assembly [depends on: T2, T3]
- Private `csvField(s)` and `toCsv(headers, rows)` — RFC 4180 exactly, `\r\n`,
  no trailing newline.
- Public `export function tableToCsv(headersClipboard, valuesClipboard): TableToCsvResult`
  — wire headers → N → values branch → fit → row objects → csv → issues.
- Early-return the empty result when `N === 0`.
- Confirm `npx tsc -b` is clean.

### T5. `src/lib/pastedTable.test.ts` — dual-runner harness [depends on: T4]
- Export/define a `CASES` array of
  `{ name, headers: PastedClipboard, values: PastedClipboard, expect: {...} }`.
- Build the two implementations under test:
  - `tsImpl`: `import { tableToCsv } from './pastedTable'`.
  - `jsImpl`: `readFileSync(resolve(__dirname, '../../pastedTable.js'), 'utf8')`
    → `new Function(src)()` → `(globalThis as any).window.PastedTable.tableToCsv`.
- `describe.each([['ts', tsImpl], ['js', jsImpl]])` looping `CASES`.
- Seed with ONE trivial case so the harness itself is provable. The `js` half
  will fail until T8 — that is expected and is the whole point of the guard.
- Also assert `jsImpl` is a function (catches a missing/renamed global).

### T6. Test cases — headers behavior [depends on: T5]
Add to `CASES`:
1. Headers pasted VERTICALLY, one per line (`text: "Sym\nQty\nPrice"`) →
   `['Sym','Qty','Price']`, N=3. Line boundaries ignored.
2. Headers pasted as one tab line → same result.
3. Headers as HTML table spanning multiple `<tr>` → still one flat ordered list.
4. Blank header cell in HTML (`<th></th>` between two real ones) → dropped;
   then a genuinely-blank survivor case → `column_N` by position.
5. Duplicate header names `['Qty','Qty','Qty']` → `['Qty','Qty_2','Qty_3']`.
6. Collision case `['a','a_2','a']` → third must NOT collide (expect `a_3`).
7. `&nbsp;` inside a header cell → normalized to a plain space.
8. Empty headers paste (`{}`, `{text:''}`, `{text:'   \n\t '}`) →
   `{headers:[], rows:[], csv:'', issues:[]}`. No throw.

### T7. Test cases — values, spans, CSV escaping, issues [depends on: T5]
Add to `CASES`:
1. Tab-delimited values with an EMBEDDED EMPTY cell (`"AAPL\t\t10"`, N=3) →
   `['AAPL','','10']`. NO column shift. This is the headline regression case.
2. Values as a flat one-per-line list, 6 items, N=3 → 2 rows chunked.
3. Mixed: some tab lines, some bare lines → document order preserved,
   buffer flushed before each tab row.
4. HTML values with `colspan="2"` → text once + one `''`, no shift.
5. HTML values with `rowspan="3"` → value CARRIED DOWN into the next two rows
   (assert the literal text in all three, not blanks).
6. HTML with colspan AND rowspan interacting on the same grid.
7. Cell containing a comma → quoted in `csv`, raw in `rows`.
8. Cell containing a double quote → doubled inside quotes.
9. `<td>Line one<br>Line two</td>` → `"Line one Line two"`. Assert the SPACE is
   present (guards the `<br>`-jamming bug) and that NO `\n` reaches `csv`.
10. `<td>` with literal newlines/indentation in source markup → collapsed to
   single spaces, trimmed.
11. Row WIDER than N → truncated + one `issues` entry `{got > expected}`.
12. Row NARROWER than N → padded + one `issues` entry `{got < expected}`.
13. Clean input → `issues` is `[]`, never `undefined` (field is required).
14. `&nbsp;` in a value cell → plain space.
15. Empty values paste with non-empty headers → `rows: []`, csv is header row
    only, NO trailing `\r\n`.
16. Exact `csv` string assertion on one full fixture — pins `\r\n`, no trailing
    newline, no BOM, header first.

### T8. `pastedTable.js` — hand-port [depends on: T4, T5]
- Repo root. IIFE, classic script, no `import`/`export`, no `const` in module
  scope leaking. End with `window.PastedTable = { tableToCsv: tableToCsv }`.
- Line-for-line mirror of the `.ts` logic minus type annotations. Do not
  "improve" anything while porting — divergence is the failure mode this
  whole design exists to catch.
- Add a top-of-file comment: MIRROR OF `src/lib/pastedTable.ts`, edit both,
  `src/lib/pastedTable.test.ts` enforces parity.
- Run `npx vitest run src/lib/pastedTable.test.ts` — BOTH `ts` and `js`
  describe blocks must now be green.

### T9. `test1.html` rework [depends on: T8]
- DELETE the `#column-count` input, its `<label>`, `colInput`, and both old
  render functions (`parseTextToTableCustom`, `parseHtmlToTable`).
- TWO contenteditable zones: `#headers-zone`, `#values-zone`, each labelled
  ("Paste headers here" / "Paste values here"). Reuse existing `#paste-zone`
  CSS, retarget to a shared class.
- `<script src="pastedTable.js"></script>` — classic, relative, NO
  `type="module"` (module scripts are blocked over `file://` by CORS).
- Hold both pastes in module-scope vars `headersClip` / `valuesClip`. Paste
  handler: `preventDefault()`, read `text/html` + `text/plain`, store into the
  right var, clear that zone's `innerHTML` back to its placeholder, then call
  a single `render()`.
- `render()` calls `window.PastedTable.tableToCsv(headersClip, valuesClip)`
  and outputs BOTH:
  - a rendered `<table>` preview (`<th>` from `headers`, `<td>` from `rows`),
  - a readonly `<textarea id="csv-out">` holding `result.csv`.
- Re-parse/re-render on EITHER zone's paste (both pastes always fed in).
- Show `issues.length` as a small warning line when non-empty.
- "Copy CSV" button: try `navigator.clipboard.writeText`, FALL BACK to
  `textarea.select()` + `document.execCommand('copy')`. `file://` is not a
  secure context, so `navigator.clipboard` is usually undefined there — the
  fallback is load-bearing, not optional.

### T10. Manual `file://` verification [depends on: T9]
- Open `test1.html` by double-click (NOT through a dev server). Confirm:
  no console errors, `window.PastedTable` defined, paste into each zone
  updates both outputs, Copy CSV puts the right text on the clipboard.
- Spot-check with a real spreadsheet copy (Excel/Sheets/brokerage page) —
  those emit `text/html` with `<table>` plus a `text/plain` tab fallback,
  which exercises the branch pick for real.

### T11. Reference docs [depends on: T10]
- `design.md` §Directory structure: add `lib/pastedTable.ts` (one-line
  purpose) to the `src/lib/` block; add root-level entries for
  `pastedTable.js` (hand-mirrored classic-script copy) and `test1.html`
  (dev harness, `file://`-runnable).
- `design.md` §Design patterns: add a **Hand-mirrored dual artifact** bullet —
  `.ts` module + root `.js` global copy, no build step, parity enforced by a
  shared vitest case table; edit both or the suite fails.
- `schema-spec.md`: add a `TableToCsvResult` section (near `SavedCsvMapping` /
  the import-validation block) — field table for `headers`, `rows`, `csv`,
  `issues` (required, `[]` when clean), plus the note that it is a structural
  superset of `ParsedCsv`.
- `product-behavior.md`: NO change. Record why in the commit message: dev
  harness, not shipped UI.
- Full-file re-read of `design.md` and `schema-spec.md` after editing, per
  CLAUDE.md's post-major-change rule. Fix any staleness found.

### T12. Full verification + commit [depends on: T11]
- `npm run test` — fully green, including both halves of the dual-runner.
- `npm run build` (`tsc -b` + vite) — clean. Confirm root `pastedTable.js` is
  neither typechecked nor bundled (tsconfig `include: ["src"]`, vite entry is
  `index.html`).
- `npm run lint`.
- Commit only after all three pass AND docs are updated (CLAUDE.md rule).

### T13. Worktree bookend — teardown [depends on: T12]
- `cd /Users/mdoraiswamy/owa/portfolio`
- `git worktree remove ../worktree-pasted-table`
- Confirm `git worktree list` shows only the main worktree.

## Test Cases

Master list. Every one lives in the SHARED `CASES` table and therefore runs
TWICE — once against `src/lib/pastedTable.ts`, once against `pastedTable.js`.

1. Tab-delimited values with an embedded EMPTY cell → no column shift.
2. Values pasted as a flat one-per-line list → chunked N-at-a-time.
3. Mixed tab-lines and bare-lines → order preserved, buffer flushed in place.
4. HTML values with `colspan` → text once, remaining slots `''`.
5. HTML values with `rowspan` → text CARRIED DOWN into subsequent rows.
6. colspan + rowspan interacting.
7. Headers pasted VERTICALLY, one per line → flattened, N derived.
8. Headers pasted as HTML spanning multiple `<tr>` → still flat.
9. Blank header cell → dropped, or `column_N` when it survives.
10. Duplicate header names → `_2`, `_3` suffixes.
11. Header suffix collision (`a`, `a_2`, `a`) → no duplicate key.
12. Cell containing a comma → quoted in `csv`.
13. Cell containing a double quote → doubled inside quotes.
14. `<br>` inside a cell → replaced by a SPACE, words never jam together.
14b. Literal newlines/indentation inside an HTML cell → collapsed to a space.
     NO `\n` ever reaches `csv` or `rows`.
15. Row WIDER than N → truncated, `issues` entry with `got > expected`.
16. Row NARROWER than N → padded, `issues` entry with `got < expected`.
17. Clean input → `issues` is `[]`, never `undefined`.
18. `&nbsp;` (U+00A0) in header and in value → plain space.
19. Empty paste / whitespace-only paste, both args → empty result, no throw.
20. Headers present, values empty → csv is header row only, no trailing CRLF.
21. Exact full-`csv`-string assertion → pins `\r\n`, no trailing newline, no BOM.
22. `html` present but WITHOUT `<table>` → text branch used instead.
23. `html` present WITH `<table>` and `text` also present → html wins.
24. Parity meta-test: `window.PastedTable.tableToCsv` exists and is callable
    after loading the root `.js` into jsdom.

## Acceptance Criteria

- [ ] `tableToCsv(headersClipboard, valuesClipboard)` is the ONLY public export
      besides types. All helpers private.
- [ ] Return shape matches spec exactly and is a structural superset of
      `ParsedCsv`; the exported conditional-type pin fails `tsc -b` on drift.
- [ ] Column count N comes from `headers.length`. No column-count input exists
      anywhere in `test1.html`.
- [ ] Branch pick is per-paste: html-with-`<table>` wins, else text.
- [ ] Headers flatten across row/line boundaries, drop blanks, uniquify to
      `column_N` / `_2` / `_3` with no collisions.
- [ ] `colspan` yields text-once-plus-empties; `rowspan` CARRIES the text down.
- [ ] Text values: tab lines `split('\t')` preserving empties; no-tab lines
      buffered and chunked N-at-a-time; space runs are never separators.
- [ ] Every row is exactly N wide; every pad/truncate appends an `issues` entry
      with correct `rowIndex`, `got`, `expected`. `issues` is a REQUIRED field
      (no `?`), `[]` when clean.
- [ ] CSV is RFC 4180: minimal quoting, doubled quotes, `\r\n`, no trailing
      newline, no BOM, header first.
- [ ] Cell text is `textContent`, trimmed, `&nbsp;`→space, whitespace collapsed,
      `<br>`→space (never jammed). NO cell in `rows` or `csv` contains `\n`.
- [ ] `src/lib/pastedTable.ts` and root `pastedTable.js` both exist; `.js` sets
      a `window` global and contains no ESM syntax.
- [ ] ONE shared case table runs against BOTH artifacts; deliberately breaking
      one copy makes the suite red (verify this by hand once).
- [ ] `test1.html` has two paste zones, loads `pastedTable.js` via classic
      `<script src>`, renders a `<table>` preview AND a readonly CSV textarea,
      has a working Copy CSV button, and re-renders when EITHER zone is pasted
      into — all working by double-clicking the file off the filesystem.
- [ ] `npm run test`, `npm run build`, `npm run lint` all green.
- [ ] `design.md` (§Directory structure, §Design patterns) and `schema-spec.md`
      updated and full-file reviewed. `product-behavior.md` intentionally
      unchanged.
- [ ] `ImportDialog.tsx`, `csv.ts`, and all app wiring untouched — verify with
      `git diff --name-only` before committing.
- [ ] Worktree created in T0 and removed in T13; `git worktree list` clean.
