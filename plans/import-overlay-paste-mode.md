# Plan: Import overlay Copy-Paste entry mode

Goal: add a 3rd entry mode ("Copy-Paste") to `ImportDialog.tsx` Step 1, positions-only, wired to `src/lib/pastedTable.ts`'s `tableToCsv()`. No changes to Step 2 logic itself.

Caveman rules: short tasks, explicit deps, test each task, docs mandatory, worktree in/out.

## Key facts found during discovery (do not re-derive, just use)

- `entryMode` state today: `useState<'upload' | 'manual'>('upload')` at `src/components/import/ImportDialog.tsx:66`. Must become `'upload' | 'paste' | 'manual'`.
- `csvHeaders`/`csvRows` state: lines 79-80. Upload path fills them via `parseCsvFile` in `handleFileSelect` (lines 183-229).
- `fileError` state (line 78) + its JSX slot: lines 894-904, styled `color:#8a3c2e; font-size:12px; margin-top:6px`. Reuse this exact style for the paste-issues warning (new sibling state, not reusing `fileError` itself — see T1).
- `isStep1Complete()` (lines 254-259): `fileSelected = entryMode === 'manual' || (file !== null && csvRows.length > 0)`. Must add a paste branch.
- `handleContinue()` (lines 261-287): `if (entryMode === 'manual') { seed 10 blank rows } else { prefill fieldMap from saved csvMappings, filtered to csvHeaders }`. **No generic "auto-map by column name" function exists anywhere in `src/` (confirmed via grep — no `autoMap` hits).** The only "auto field-mapping" behavior in this codebase is the saved-mapping prefill in the `else` branch, which is keyed purely on `csvHeaders` / `state.csvMappings`. Paste mode gets this for free as long as it falls into the `else` branch (i.e. NOT lumped in with `entryMode === 'manual'`). Requirement 6 is satisfied by T6 alone — no new mapping logic needed.
- Entry-mode seg control JSX: lines 816-844, gated on `dataType === 'positions'`, currently `gridTemplateColumns: 'repeat(2, 1fr)'` with 2 `seg-opt` radios (`upload`, `manual`).
- Data-type radio for Transactions (line 797-800) already forces `setEntryMode('upload')` on selection — must also clear paste state (T3).
- `pastedTable.ts` single export `tableToCsv(headersClipboard: PastedClipboard, valuesClipboard: PastedClipboard): TableToCsvResult` where `TableToCsvResult = { headers: string[]; rows: Record<string,string>[]; csv: string; issues: CsvIssue[] }`, `PastedClipboard = { html?: string; text?: string }`, `CsvIssue = { rowIndex: number; got: number; expected: number }`. `TableToCsvResult` is a compile-pinned structural superset of `ParsedCsv` — trust it.
- `design/v10/project/Portfolio Dashboard.dc.html` reference (read-only, not shipped code):
  - Lines 524-546: paste-zone markup (Headers zone + Values zone, dashed box, prompts, `onPaste` handlers, click-to-focus).
  - Lines 1443-1447: `entryModeOptions` — only the **Copy-Paste** option's `onClick` clears paste+derived state in the design source; our resolved requirement 4 says ALL THREE options reset paste state on switch — follow the resolved requirement, not the design source literally.
  - Lines 1477-1478: dynamic prompt text pattern (`"{n} columns pasted — click to replace"` / `"{n} rows pasted — click to replace"`), fallback `"Click here and press Ctrl+V / ⌘V"`.
  - Lines 1032-1112: `extractPasteText`/`loadImportPaste`/`rebuildPastedImport` — UX behavior reference ONLY (preventDefault, read html+text, recompute on any zone update). Do NOT port `parseCSVText`/`autoMapFields` — replaced by `tableToCsv`.
- Reference docs are at repo root: `/Users/mdoraiswamy/owa/portfolio/product-behavior.md` (CSV import section: lines 67-90) and `/Users/mdoraiswamy/owa/portfolio/design.md` (directory structure line 33 already says pastedTable.ts is "not wired into the app" — must fix; Data flow CSV import section: lines 125-135).
- `src/components/import/ImportDialog.test.tsx` patterns: `openDialog()`, `getFileInput()`, `mockCsv()` (mocks `parseCsvFile`), `continueEnabled()`, `clickContinue()`, `selectForField()`, `advanceToStep2()` etc. No existing clipboard-paste simulation helper — must add one (T8).
- `src/lib/pastedTable.test.ts` exports `CASES` (array of `{ name, headers: PastedClipboard, values: PastedClipboard, expect }`) — reuse a couple of these as realistic fixtures in T8 instead of inventing new ones (e.g. the "trivial tab-separated headers + single data row" case and the "flat one-per-line values with a consistent trailing extra cell" issues case).

## Decisions made while planning (not re-litigate, just implement)

- New component-local state (not `AppState`): `pasteHeaderClipboard: PastedClipboard` (default `{}`), `pasteValuesClipboard: PastedClipboard` (default `{}`), `pasteIssues: CsvIssue[]` (default `[]`).
- Paste-zone prompt counts use `tableToCsv()`'s own result (`result.headers.length` for the Headers zone, `result.rows.length` for the Values zone) — computed directly in each paste handler via closure over the other zone's current state, not via `useEffect`/`useMemo`. This keeps recompute synchronous and matches requirement 3 exactly ("recomputes `tableToCsv(headersClipboard, valuesClipboard)` using whatever's currently in both zones").
- Switching entry mode (any of the 3 radios) always resets: `pasteHeaderClipboard({})`, `pasteValuesClipboard({})`, `pasteIssues([])`, `csvHeaders([])`, `csvRows([])`. Implemented via one `resetPasteState()` helper called from all 3 radio `onChange`s and from the Transactions data-type radio's existing `setEntryMode('upload')` call. This does not affect existing upload/manual tests (they don't exercise `csvHeaders` across a mode switch).
- `isStep1Complete()`'s `fileSelected` becomes a 3-way branch: `upload` → `file !== null && csvRows.length > 0` (unchanged); `manual` → `true` (unchanged); `paste` → `csvHeaders.length > 0 && csvRows.length > 0`.
- Paste-issues warning renders in the same visual slot/style as `fileError` (`color:#8a3c2e; font-size:12px; margin-top:6px`), text: `` `${issues.length} row(s) had an unexpected number of columns and were adjusted` ``, only when `pasteIssues.length > 0`. Non-blocking — does not affect gating.

## Tasks

### T0 — create worktree (no deps, do first)
Run:
```
git worktree add ../worktree-import-paste-mode -b feature/import-paste-mode
cd ../worktree-import-paste-mode
```
All later tasks run inside this worktree (precedent: `../worktree-pasted-table` already exists in this repo for the sibling feature).
Acceptance: `git worktree list` shows the new worktree; `git status` inside it shows branch `feature/import-paste-mode`.

### T1 (dep: T0) — type + state plumbing
File: `src/components/import/ImportDialog.tsx`
- Import `tableToCsv`, and types `PastedClipboard`, `CsvIssue` from `../../lib/pastedTable`.
- Change `entryMode` state type to `'upload' | 'paste' | 'manual'`.
- Add state: `pasteHeaderClipboard` (`PastedClipboard`, default `{}`), `pasteValuesClipboard` (`PastedClipboard`, default `{}`), `pasteIssues` (`CsvIssue[]`, default `[]`).
- Add resets for these 3 new state vars inside `handleCloseDialog` (alongside the existing `setEntryMode('upload')` etc., lines 94-120).
Tests: none yet (no behavior change observable). Just confirm `npx tsc -b` compiles.
Acceptance: `npx tsc -b` passes with no errors; existing `ImportDialog.test.tsx` suite still green (`npx vitest run src/components/import/ImportDialog.test.tsx`).

### T2 (dep: T1) — paste handlers + reset helper
File: `src/components/import/ImportDialog.tsx`
- Add `resetPasteState()` (a `useCallback`): sets `pasteHeaderClipboard({})`, `pasteValuesClipboard({})`, `pasteIssues([])`, `csvHeaders([])`, `csvRows([])`.
- Add `handlePasteHeaders(e: React.ClipboardEvent<HTMLDivElement>)`: `e.preventDefault()`; build `{ html: e.clipboardData.getData('text/html'), text: e.clipboardData.getData('text/plain') }`; `setPasteHeaderClipboard(clip)`; compute `const result = tableToCsv(clip, pasteValuesClipboard)`; `setCsvHeaders(result.headers)`; `setCsvRows(result.rows)`; `setPasteIssues(result.issues)`.
- Add `handlePasteValues(e: React.ClipboardEvent<HTMLDivElement>)`: symmetric — new clip goes in as `valuesClipboard` arg, `pasteHeaderClipboard` (current state) as `headersClipboard` arg.
Tests (add now, run in T8 once JSX exists — write handler logic so it's directly testable via JSX in T4): none yet, JSX not wired.
Acceptance: `npx tsc -b` passes. Handlers not yet called from JSX (dead code at this point) — fine, next task wires them.

### T3 (dep: T2) — 3-way entry-mode seg control
File: `src/components/import/ImportDialog.tsx` (lines ~816-844)
- Change grid to `repeat(3, 1fr)`.
- Add 3rd `seg-opt` radio: `checked={entryMode === 'paste'}`, label `Copy-Paste`, `onChange={() => { resetPasteState(); setEntryMode('paste') }}`.
- Update the existing `upload` and `manual` radios' `onChange` to also call `resetPasteState()` before `setEntryMode(...)`.
- Update the Transactions data-type radio (line ~797-800) to also call `resetPasteState()` (it already calls `setEntryMode('upload')`).
Tests to add in `ImportDialog.test.tsx`:
  - Happy path: open dialog, positions selected → 3 radios render (`Upload CSV file`, `Copy-Paste`, `Enter manually`).
  - Edge: switching Transactions → Positions still resets to `upload` mode checked (extend existing test 33's assertions, don't need a new test if reused).
  - Edge: click `Copy-Paste` after having uploaded a file in upload mode → `csvHeaders`/`csvRows` cleared (verify indirectly: Continue becomes disabled).
Acceptance: 3 radios visible for positions only (still absent for transactions, per existing test 31); clicking each radio doesn't throw; `npx vitest run src/components/import/ImportDialog.test.tsx` green.

### T4 (dep: T3) — paste-zone JSX
File: `src/components/import/ImportDialog.tsx`
- Add `{entryMode === 'paste' && (...)}` block (sibling to the existing `{entryMode === 'upload' && (...)}` CSV dropzone block, before/after it — mirror design lines 524-546 structure):
  - "Headers" `field` label + a `div` (paste zone): `tabIndex={0}`, `onPaste={handlePasteHeaders}`, `onClick={(e) => e.currentTarget.focus()}`, dashed border style matching design (`border: 2px dashed var(--color-divider)`, `borderRadius: 4px`, `background: var(--color-surface)`, centered text, `padding: var(--space-4)`, `minHeight: 90px`).
    - Prompt line: `csvHeaders.length > 0 ? `${csvHeaders.length} columns pasted — click to replace` : 'Click here and press Ctrl+V / ⌘V'`.
    - Sub-line (muted, 11px): `Paste the single row of column names`.
  - "Values" `field` label + a second paste zone (`onPaste={handlePasteValues}`, `minHeight: 140px`, same styling pattern).
    - Prompt line: `csvRows.length > 0 ? `${csvRows.length} rows pasted — click to replace` : 'Click here and press Ctrl+V / ⌘V'`.
    - Sub-line (muted, 11px): `Paste the data rows (no header row)`.
    - Below it: `{pasteIssues.length > 0 && <div style={{ color: '#8a3c2e', fontSize: '12px', marginTop: '6px' }}>{pasteIssues.length} row(s) had an unexpected number of columns and were adjusted</div>}`.
- Make sure the "Manual entry hint" block's condition (`entryMode === 'manual'`) is unaffected (already conditional, no change needed).
Tests to add in `ImportDialog.test.tsx` (uses a helper to fire a paste event, see T8 for the exact `fireEvent`/`clipboardData` shim):
  - Happy path: select Copy-Paste, paste `{text: 'a\tb'}` into Headers zone → prompt reads "2 columns pasted — click to replace".
  - Happy path: paste `{text: '1\t2'}` into Values zone after headers pasted → prompt reads "1 rows pasted — click to replace".
  - Edge: paste into Values zone BEFORE Headers zone populated (headers `{}` ⇒ `tableToCsv` short-circuits to `{headers: [], rows: [], issues: []}` per `pastedTable.ts` `n === 0` branch) → both csvHeaders/csvRows stay empty, no crash.
  - Error/edge: paste a values fixture with a ragged row width (reuse `CASES` "buffered bare lines flush..." or "wider than header count" case from `pastedTable.test.ts`) → issues warning text renders with correct count.
Acceptance: both zones render only when `entryMode === 'paste'`; prompts update after simulated paste events; issues warning shows/hides correctly; `npx vitest run` green.

### T5 (dep: T4) — Continue gating for paste mode
File: `src/components/import/ImportDialog.tsx` (`isStep1Complete`, lines 254-259)
- Change `fileSelected` to:
```ts
const fileSelected =
  entryMode === 'manual' ||
  (entryMode === 'upload' && file !== null && csvRows.length > 0) ||
  (entryMode === 'paste' && csvHeaders.length > 0 && csvRows.length > 0)
```
Tests to add:
  - Happy path: paste mode, account selected, paste valid headers + valid rows → Continue enabled.
  - Edge: account selected, only headers pasted (no values) → Continue stays disabled.
  - Edge: account selected, only values pasted (no headers) → Continue stays disabled (and per `tableToCsv`'s `n===0` short-circuit, csvRows also stays empty even though something was pasted into Values).
  - Error: switch away from paste back to upload after a successful paste → Continue disabled again until a file is picked (proves `resetPasteState()` ran).
Acceptance: all 4 cases pass; existing upload/manual gating tests (3, 4, 32) still pass unchanged.

### T6 (dep: T5) — confirm auto-map / handleContinue branch grouping
File: `src/components/import/ImportDialog.tsx` (`handleContinue`, lines 261-287)
- Verify (and adjust if needed) that the `if (entryMode === 'manual') { ... } else { ... }` branching still routes `paste` mode into the `else` branch (saved-mapping prefill against `csvHeaders`). No new logic — just confirm the boolean check is `entryMode === 'manual'` (not, say, `entryMode !== 'upload'`) so paste mode is NOT accidentally treated like manual mode.
Tests to add:
  - Happy path: paste mode, existing account with a saved `csvMappings` entry whose columns match the pasted headers → Step 2 selects pre-fill correctly (mirror existing test 27's pattern, but reach Step 2 via paste instead of `mockCsv`+upload).
  - Edge: paste mode, existing account, saved mapping has a column NOT present in pasted headers → that field stays unmapped, others prefill (mirror test 28's pattern).
Acceptance: both new tests pass without touching `handleContinue`'s prefill logic itself (confirms requirement 6 — reuse, no new logic).

### T7 (dep: T6) — Step 2 parity check
File: `src/components/import/ImportDialog.tsx` (read-only verification), `src/components/import/ImportDialog.test.tsx` (new test)
- No prod code change expected. Add one test that goes paste → Step 2 → maps all required fields → clicks Import → asserts `IMPORT_POSITIONS` dispatch payload matches shape of the existing upload-path test (test 12/13), proving Step 2 needs zero changes for paste mode.
Tests to add:
  - Happy path: full paste → map → import → verify `dispatch` called with `IMPORT_POSITIONS` and correct `mappedRows`.
Acceptance: test passes with zero Step 2 code changes (if it fails, that's a signal Step 2 has an undiscovered `entryMode === 'upload'`-only assumption — fix minimally, staying inside T7 scope).

### T8 (dep: T7) — full paste-mode test suite pass
File: `src/components/import/ImportDialog.test.tsx`
- Add a clipboard-paste test helper, e.g.:
```ts
function pasteInto(zoneLabel: string, clip: { html?: string; text?: string }) {
  const label = screen.getByText(zoneLabel) // "Headers" or "Values" field label
  const zone = label.parentElement!.querySelector('div[tabindex]') as HTMLElement
  fireEvent.paste(zone, {
    clipboardData: { getData: (type: string) => (type === 'text/html' ? clip.html ?? '' : clip.text ?? '') },
  })
}
```
  (Adjust selector to match whatever DOM shape T4 actually produced — the zone `div` needs a stable way to target it, e.g. add a `data-testid="paste-headers-zone"` / `data-testid="paste-values-zone"` in T4 if the label-based lookup proves fragile.)
- Consolidate/organize the tests added piecemeal in T3-T7 into one coherent block after the existing 38 tests (`39.`, `40.`, ... numbering), covering per requirement 10:
  1. Switching to paste mode renders both zones, no CSV dropzone, no manual hint.
  2. Pasting into Headers zone alone (using `CASES[0]` fixture `{ text: 'a\tb' }`) updates prompt + `csvHeaders`.
  3. Pasting into Values zone alone after Headers populated (using `CASES[0].values`) updates prompt + `csvRows`.
  4. Continue gating: disabled with nothing pasted, disabled with only one zone pasted, enabled once both zones populated.
  5. Issues warning: pasting a ragged-width values fixture (reuse the `pastedTable.test.ts` CASES "wider than header count" or "buffered bare lines" case) renders the warning text with the right count; Continue is still enabled (non-blocking).
  6. Step 2 parity: paste → Step 2 → map → Import dispatches identically to the upload path (from T7).
Acceptance: `npm run test` (full suite) green.

### T9 (dep: T8) — full verification gate
Run in worktree root:
```
npm run test
npm run lint
npm run build
```
Fix any failures (type errors, lint violations, broken unrelated tests) before proceeding. Do not skip any of the three.
Acceptance: all three commands exit 0.

### T10 (dep: T9) — update product-behavior.md
File: `/Users/mdoraiswamy/owa/portfolio/product-behavior.md` (in the worktree copy), section "## CSV import (Positions / Transactions)" (currently lines 67-90).
- In the Step 1 bullet list (currently line 78: "Positions-only entry mode... `Upload CSV file` (default) / `Enter manually`."), change to list 3 options: `Upload CSV file` (default) / `Copy-Paste` / `Enter manually`.
- Add a new bullet describing the Copy-Paste zones: two dashed zones (Headers, Values), prompts (`Click here and press Ctrl+V / ⌘V` → `{n} columns/rows pasted — click to replace`), backed by `tableToCsv()` from `pastedTable.ts`, feeding the same `csvHeaders`/`csvRows` as upload mode. Note the non-blocking issues warning (`{n} row(s) had an unexpected number of columns and were adjusted`) shown under the Values zone when `tableToCsv()` reports issues.
- Update the Continue-gating bullet (line 80) to mention the 3-way gating (upload: file+rows; manual: none; paste: both zones populated).
- Update the "switching entry mode resets state" note if one exists, or add one: switching among the 3 entry-mode options clears paste clipboard state and derived headers/rows.
Acceptance: full-file re-read of `product-behavior.md`'s CSV import section — no stale references to only 2 entry modes anywhere in the doc, terse/token-optimized style preserved, consistent with T1-T8's actual implementation.

### T11 (dep: T9) — update design.md
File: `/Users/mdoraiswamy/owa/portfolio/design.md` (in the worktree copy).
- Directory structure section (line 33): remove "standalone... not wired into the app" — replace with something like: `pastedTable.ts  # tableToCsv(headersClipboard, valuesClipboard): clipboard-paste → CSV/rows/headers parser, used by ImportDialog's Copy-Paste entry mode`.
- Component tree / `ImportDialog.tsx` line (line 48 comment): keep as-is or note 3 entry modes if space allows (optional, low priority — don't over-elaborate here, the Data flow section is the right place for detail).
- Data flow "CSV import" section (lines 125-135, step 1 bullet currently: "...entry mode for positions (`upload`/`manual`, default `upload`)..."): change to `upload`/`paste`/`manual`, default `upload`. Add one sentence describing paste mode: two paste zones feed `tableToCsv()` (`pastedTable.ts`) → same `csvHeaders`/`csvRows` state as upload, same downstream Step 2 mapping/prefill/commit logic (no Step 2 changes).
- Mention new component-local state fields (`pasteHeaderClipboard`, `pasteValuesClipboard`, `pasteIssues`) briefly in the same paragraph, consistent with how other component-local state (e.g. `assetClassHeaderValue`) is described elsewhere in this doc.
Acceptance: full-file re-read of `design.md` — no contradiction between the directory-structure comment for `pastedTable.ts` and the Data flow section; terse style preserved; no stale "not wired into the app" text remains anywhere in the file (`grep -n "not wired" design.md` returns nothing).

### T12 (dep: T10, T11) — re-verify after doc edits
Run:
```
npm run test
```
(docs don't affect runtime behavior, but this is the CLAUDE.md-mandated final check before commit — confirms nothing regressed and docs are in their final state alongside passing tests.)
Acceptance: exits 0.

### T13 (dep: T12) — commit
In the worktree:
```
git add src/components/import/ImportDialog.tsx src/components/import/ImportDialog.test.tsx product-behavior.md design.md
git commit -m "Add Copy-Paste entry mode to positions import, wired to pastedTable.tableToCsv"
```
Acceptance: `git log -1` shows the new commit on `feature/import-paste-mode`; `git status` clean.

### T14 (dep: T13) — teardown worktree
```
cd /Users/mdoraiswamy/owa/portfolio
git worktree remove ../worktree-import-paste-mode
```
(If the user wants the branch merged/PR'd, that's a separate follow-up not in this plan's scope — this plan only covers building + committing the feature branch.)
Acceptance: `git worktree list` no longer shows `../worktree-import-paste-mode`; branch `feature/import-paste-mode` still exists (only the worktree directory is removed, not the branch).

## Overall acceptance criteria (plan "done")

1. `ImportDialog.tsx` Step 1 (positions only) shows 3 entry-mode radios: Upload CSV file / Copy-Paste / Enter manually.
2. Copy-Paste mode renders 2 dashed paste zones (Headers, Values) with dynamic prompts per spec.
3. Pasting into either zone calls `tableToCsv()` from `src/lib/pastedTable.ts` with the latest state of both zones and updates `csvHeaders`/`csvRows`.
4. Switching entry mode clears prior paste state (both zones + derived headers/rows).
5. Continue is disabled in paste mode until both zones have produced ≥1 header and ≥1 row.
6. A non-blocking issues warning renders when `tableToCsv()` reports issues; does not block Continue/Step 2.
7. Step 2 (mapping/review/commit) works identically regardless of entry mode — zero Step 2 code changes required (or only the minimal fix surfaced by T7, if any).
8. `product-behavior.md` and `design.md` are updated and internally consistent (T10, T11 acceptance criteria).
9. `npm run test`, `npm run lint`, `npm run build` all pass.
10. Change is committed on `feature/import-paste-mode`; worktree torn down.

## Test strategy

- All new coverage lives in `src/components/import/ImportDialog.test.tsx`, following existing patterns (`fireEvent`, `render`, `screen`, `waitFor`) — no new test framework/tooling.
- Reuse `src/lib/pastedTable.test.ts`'s `CASES` fixtures directly (import them or copy the specific fixture literals) for realistic paste payloads instead of inventing synthetic ones — keeps paste-parsing behavior consistent with what's already pinned in `pastedTable.test.ts`.
- Simulate `ClipboardEvent` via `fireEvent.paste(zone, { clipboardData: { getData } })` (jsdom's `ClipboardEvent`/`DataTransfer` support is limited, so a plain object with a `getData` method is the pragmatic shim — matches the pattern `ImportDialog.test.tsx` already uses for `dataTransfer.files` in `handleFileDrop`).
- Do NOT re-test `tableToCsv()`'s parsing edge cases here — those are already covered exhaustively in `pastedTable.test.ts`. `ImportDialog.test.tsx`'s new tests only verify wiring: paste in → state updates → UI reflects it → gating/warning render correctly → Step 2 unaffected.

## Risks

- **jsdom clipboard event shimming**: `ClipboardEvent`/`DataTransfer` are only partially implemented in jsdom. If `fireEvent.paste` with a plain `clipboardData` object doesn't trigger the React `onPaste` handler cleanly, may need `fireEvent(zone, new Event('paste', ...))` with `Object.defineProperty(event, 'clipboardData', ...)` instead — small risk of extra fiddling in T8, budget it there.
- **Zone DOM targeting for tests**: the design's paste zones are unlabeled `div`s with `tabIndex`. If `screen.getByText(zoneLabel)`-based traversal in T8's `pasteInto()` helper is fragile, add `data-testid` attributes to the zones in T4 — flagged in T8 as a fallback, not a blocker.
- **Continue-gating interaction with `resetPasteState()` clearing `csvHeaders`/`csvRows` on every mode switch**: must double check this doesn't regress the manual-mode Step 2 "seed 10 blank rows" flow (which doesn't depend on `csvHeaders`/`csvRows` pre-Continue) — low risk, but T5's edge-case tests specifically probe this.
- **Prompt-count semantics diverge slightly from the design prototype**: design's own `pasteHeaderPrompt`/`pasteValuesPrompt` count raw pasted lines/columns before `tableToCsv`-equivalent processing; this plan uses `tableToCsv()`'s post-parse `headers.length`/`rows.length` instead (decided above, since the design's own parsing logic is explicitly out of scope per the feature brief). This is a deliberate, documented deviation — not a bug — but worth a second look if the user expects pixel-exact prompt-count behavior from `design/v10`.

## Out of scope

- Transactions import — untouched, still upload-only.
- Step 2 mapping/review/commit logic itself — no changes (only verified/reused).
- Watchlist/Alerts — out of scope per project conventions (unrelated to this feature).
- `design/v10/project/Portfolio Dashboard.dc.html` — reference-only asset, never modified.
- `pastedTable.js` / `test1.html` (root-level dev harness for the standalone library, per `design.md`'s directory listing) — unrelated to `ImportDialog.tsx` wiring, not touched.
