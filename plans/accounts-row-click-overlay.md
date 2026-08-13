# Accounts Row-Click Overlay

## Overview / Goal

Add row-click behavior to the Accounts page (`src/components/AccountsPage.tsx`): clicking an account row opens an editable overlay listing every position held in that account (mirrors the Dashboard's `PositionGroupOverlay`). Requires generalizing `PositionGroupOverlay` so it can be driven either by a symbol-shaped `AggregateRow` (dashboard, existing) or by a flat `Position[]` + title (accounts view, new), without changing dashboard behavior.

## Resolved Requirements

- Clicking an account row (not the `<tfoot>` Subtotal row) in `AccountsPage.tsx` opens an overlay of that account's positions.
- Overlay is fully editable: inline Symbol/Name/Shares/AvgCost/Price edit, Account reassignment dropdown, `AssetClassOverrideSelect`, delete-to-closed via `CLOSE_POSITION`.
- Position list = `state.positions.filter(p => p.accountId === account.id)`, including any `symbol.toLowerCase() === 'cash'` positions (cash is not excluded).
- "% of Portfolio" column stays whole-portfolio-relative (`filteredPortfolioTotal(state)`), not account-scoped — same as dashboard overlay.
- Account column/dropdown stays in this overlay. Reassigning a position's account will drop it from the currently-open list on next render — same accepted side effect as symbol-edit already has in the dashboard overlay. No special-case handling.
- No closed-positions section/toggle in the new overlay.
- `PositionGroupOverlay` is generalized (not duplicated) to accept `positions: Position[]`, `title: string`, and an optional `sortPositions` comparator, replacing the single `group: AggregateRow` prop. Both call sites (`PositionsTable.tsx`, `AccountsPage.tsx`) updated.
- Title formats:
  - Dashboard (unchanged): `` `{symbol} — {displayName} — {effectiveAssetClass}` ``
  - Accounts view (new): `` `{institution} — {accountName} ({accountNumber})` ``, omitting the institution segment and its leading `" — "` separator when institution is empty.
- Default sort:
  - Dashboard: by account institution asc, then account name asc (fallback accountNumber) — unchanged.
  - Accounts view: by symbol ascending (single account already, so no institution/name grouping needed).
- `dispatch` is threaded into `AccountsPage` (new prop), wired from `App.tsx`.
- `accountsSections()` in `src/lib/selectors.ts` gains `accountId` on each row so the click handler knows which account was clicked.
- Row click affordance: `cursor: pointer` on account body rows only, not the `<tfoot>` Subtotal row.

## Out of Scope

- No closed-positions section/toggle in the new overlay.
- No changes to account CRUD (still import-flow only, per existing `product-behavior.md`).
- No change to dashboard `PositionGroupOverlay` visual behavior — only its prop contract, kept behavior-identical (regression tests required).

## Architecture / Design Decisions

### 1. `PositionGroupOverlay` prop redesign

Current (`src/components/PositionGroupOverlay.tsx` line 277-284):

```ts
export interface PositionGroupOverlayProps {
  group: AggregateRow
  accounts: Account[]
  dispatch: (action: any) => void
  onClose: () => void
  existingAssetClasses: string[]
  state: AppState
}
```

New:

```ts
export interface PositionGroupOverlayProps {
  positions: Position[]
  title: string
  accounts: Account[]
  dispatch: (action: any) => void
  onClose: () => void
  existingAssetClasses: string[]
  state: AppState
  sortPositions?: (a: Position, b: Position, accounts: Account[]) => number
}
```

- `group.positions` → `positions` (direct prop, no more indirection through `AggregateRow`).
- `group.symbol}/{group.displayName}/{group.effectiveAssetClass}` title line (current line 379) → render `{title}` directly. Title string is now fully computed by the caller.
- Internal `sortedPositions` `useMemo` (current lines 311-324, the institution/name comparator) becomes the **default** comparator, used when `sortPositions` is not passed. `PositionsTable.tsx`'s call site does not need to pass `sortPositions` at all (keeps default) — only `AccountsPage.tsx` passes a symbol-ascending comparator.
- `AggregateRow` interface stays in `PositionsTable.tsx` unchanged (still used internally there to build/sort the dashboard's aggregate rows and to compute `selectedGroup`) — only the overlay's prop no longer takes the whole row, just `selectedGroup.positions` and a title string built at the call site.
- Confirmed via `grep -rn "AggregateRow\|PositionGroupOverlay" src` that the only two non-test call sites are `PositionsTable.tsx` and (after this feature) `AccountsPage.tsx`; `PositionGroupOverlay.test.tsx` is the only test file referencing `AggregateRow`/`group` and must be updated in place, not left broken.

### 2. Title construction — empty-institution edge case

`accountsSections()` already builds `accountName: `${account.name} (${account.accountNumber})`` per row (`src/lib/selectors.ts` ~line 291) and separately `institution: account.institution || ''` (~line 289). `AccountsPage.tsx` currently renders `institution` in its own table cell — it never concatenates institution with anything, so there's no existing "omit separator" logic to copy; this is new. Rule, applied identically in both `accountsSections()` row shape (for click handler use) and the title builder:

```ts
const title = row.institution
  ? `${row.institution} — ${row.accountName}`
  : row.accountName
```

`accountName` already contains the trailing `"(accountNumber)"`, so no separate accountNumber interpolation is needed at the title call site — reuse the existing row field.

### 3. `accountsSections()` row shape change

Add `accountId: string` to each row object (`src/lib/selectors.ts`, `accountsSections()` return type ~line 260-269 and row-building block ~line 279-297). Purely additive — no existing consumer reads a fixed row shape exclusively by destructuring (AccountsPage maps `.map((r, idx) => ...)` and reads named fields), so this is non-breaking.

### 4. `AccountsPage` overlay wiring

Mirror `PositionsTable.tsx`'s `selectedGroupKey` pattern (`useState<string | null>`, line 120), but keyed on `accountId` since rows already carry a stable id:

- `const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)`
- Row `onClick={() => setSelectedAccountId(r.accountId)}`, `style={{ cursor: 'pointer' }}` on `<tr>` in `<tbody>` only — NOT on the `<tfoot>` Subtotal `<tr>`.
- When `selectedAccountId` is set, compute `positions = state.positions.filter(p => p.accountId === selectedAccountId)`, look up the `Account` for the title, render `<PositionGroupOverlay positions={...} title={...} accounts={state.accounts} dispatch={dispatch} onClose={() => setSelectedAccountId(null)} existingAssetClasses={assetClassOptions(state)} state={state} sortPositions={(a, b) => a.symbol.localeCompare(b.symbol)} />`.
- If the selected account no longer exists (e.g. deleted mid-session) or has zero positions, render nothing extra beyond an empty table body — no special error UI, matching the "no special-case handling" instruction for the reassignment side effect.

## Test Strategy

Run `npm run test` for the full suite; use `npx vitest run <file>` for the specific files touched during development. Before the final commit, `npm run build` (tsc -b + vite build) and `npm run lint` (oxlint) must also pass — matches CLAUDE.md's commit gate.

## Risks

- **Prop-shape change blast radius**: `PositionGroupOverlay`'s `group` prop is removed. Confirmed via `grep -rn "AggregateRow\|PositionGroupOverlay" src` that only `PositionsTable.tsx` (impl) and `PositionGroupOverlay.test.tsx` (tests) reference it today — re-run this grep after implementation to make sure no new stray usage was missed.
- **Empty-institution title edge case**: `Account.institution` is a required non-optional `string` in `types.ts` but can be `''` at runtime (accounts imported without an institution value). Must verify visually/by test that the title renders `"{accountName}"` with no leading `" — "` artifact.
- **Sort stability for accounts-view list**: symbol-ascending sort on positions within one account — verify `localeCompare` behaves sanely for symbols that are pure-numeric-looking (rare) and for the literal string `'cash'` (should sort alphabetically like any other symbol, no special-casing per requirement #3).
- **`product-behavior.md` staleness already present**: the existing "Positions table" section documents a "Taxes" column in the overlay's 9-column table that does not exist in current code (`PositionGroupOverlay.tsx` renders "% of Portfolio", not "Taxes" — confirmed by reading the component). This plan's doc-update task should fix this pre-existing drift while touching this doc, since CLAUDE.md requires the whole affected doc to be internally consistent after a major change, not just the new section.
- **Reassignment side effect UX**: reassigning a position's account from inside this new overlay silently removes it from the list (per requirement #5, accepted as-is) — flag this explicitly in `product-behavior.md` so it isn't mistaken for a bug later.

## Tasks

### T0 — Create isolated worktree
Make a new git worktree so this feature doesn't touch the main checkout while in progress.
- Run: `git branch -a` (already checked: existing branches use `feature/...`, `<topic>-vN`, or bare `<topic>` naming; no strict single convention, so use a plain descriptive name) then:
  `git worktree add ../worktree-accounts-row-overlay -b accounts-row-overlay/add-position-overlay`
- All subsequent tasks (T1–T13) operate inside `/Users/mdoraiswamy/owa/worktree-accounts-row-overlay`, not the main checkout.
- Acceptance: `git worktree list` shows the new worktree; `cd` into it and `git status` shows a clean tree on the new branch.

### T1 — Add `accountId` to `accountsSections()` rows
File: `src/lib/selectors.ts` (~line 260-297).
- Add `accountId: string` to the row TypeScript return-type object (~line 269) and set it from `account.id` in the row-building `.map()` (~line 291, alongside `institution`/`accountName`).
- Test: in `src/lib/selectors.test.ts`, add a case asserting every row returned by `accountsSections(state)` for a state with 1+ accounts has `row.accountId === account.id` for the matching account. Edge case: empty-category section still returns `rows: []` (no crash, existing behavior unchanged).
- Acceptance: `npx vitest run src/lib/selectors.test.ts` passes, including the new case.

### T2 — Generalize `PositionGroupOverlay` props (positions + title + sortPositions)
File: `src/components/PositionGroupOverlay.tsx`.
Depends on: T1 (not code-dependent, but keep sequential for review clarity).
- Change `PositionGroupOverlayProps` (line 277-284): remove `group: AggregateRow`, add `positions: Position[]`, `title: string`, optional `sortPositions?: (a: Position, b: Position, accounts: Account[]) => number`.
- Remove the `import type { AggregateRow } from './PositionsTable'` import (line 4) — no longer used.
- Update the `sortedPositions` `useMemo` (lines 311-324): source list is `positions` (prop) instead of `group.positions`; if `sortPositions` prop is provided use it, else fall back to the existing institution/name comparator as the default.
- Update the dialog title render (line 378-380): render `{title}` instead of `{group.symbol} — {group.displayName} — {group.effectiveAssetClass}`.
- Everywhere else `group.positions` was referenced, use `positions` directly.
- Test: this task alone will break `PositionGroupOverlay.test.tsx` compilation — do NOT fix tests yet, that's T3. Just get the component compiling correctly; verify with `npx tsc --noEmit -p .` that only `PositionGroupOverlay.test.tsx` and `PositionsTable.tsx` show new errors (expected, fixed in T3/T4).
- Acceptance: component file has no `group`/`AggregateRow` references left; `git grep -n "group\." src/components/PositionGroupOverlay.tsx` returns nothing.

### T3 — Update `PositionGroupOverlay.test.tsx` for new prop shape (regression coverage)
File: `src/components/PositionGroupOverlay.test.tsx`.
Depends on: T2.
- Replace every `<PositionGroupOverlay group={group} .../>` call with `positions={...}` + `title={...}` (drop the `createTestGroup` helper's role as the `group` prop; either delete `createTestGroup` or repurpose it as a plain `positions` array builder plus a hand-built title string matching `` `${symbol} — ${displayName} — ${effectiveAssetClass}` ``).
- Remove the `import type { AggregateRow } from './PositionsTable'` import — no longer used.
- Add ONE new regression test: build a title exactly as the dashboard would (`` `AAPL — Apple Inc — Equity` ``), pass it plus a `positions` array with 2 positions in different accounts (institution A, institution B), assert default sort (no `sortPositions` passed) still orders them institution-ascending — i.e. the existing dashboard sort behavior survives the prop change unchanged.
- Add ONE new test for the accounts-view shape: pass a `title` like `"Fidelity — Brokerage (1234)"` and a `sortPositions` comparator sorting by symbol ascending; assert the dialog renders that title verbatim and rows appear symbol-sorted.
- Edge case test: pass `title = "Brokerage (1234)"` (no institution) — no dangling `" — "` should appear in the rendered dialog title text (use `screen.getByText` exact match, not substring, to catch stray whitespace/separator).
- Acceptance: `npx vitest run src/components/PositionGroupOverlay.test.tsx` — all existing 39 tests plus 3 new ones pass.

### T4 — Update `PositionsTable.tsx` call site
File: `src/components/PositionsTable.tsx`.
Depends on: T2.
- At the `<PositionGroupOverlay .../>` render (lines 308-317), replace `group={selectedGroup}` with `positions={selectedGroup.positions}` and `title={`${selectedGroup.symbol} — ${selectedGroup.displayName} — ${selectedGroup.effectiveAssetClass}`}`.
- Do not pass `sortPositions` — dashboard keeps the overlay's default (institution/name) sort.
- `AggregateRow` interface itself (lines 29-43) is untouched — still used for `buildAggregateRows`/sorting the table rows.
- Test: no new test file needed here directly (covered by T3's dashboard-shape regression case plus existing `PositionsTable.test.tsx` if present — check for it; if it exists and asserts overlay open/close behavior, re-run it).
- Acceptance: `npx tsc --noEmit -p .` shows zero errors in `PositionsTable.tsx`; `npx vitest run src/components/PositionsTable.test.tsx` (if the file exists) passes; manually confirm dashboard row-click still opens overlay with correct title by reading the rendered output in the T3 regression test.

### T5 — Add `dispatch` prop to `AccountsPage`
File: `src/components/AccountsPage.tsx`.
Depends on: T1 (needs `accountId` on rows to be meaningful, though the prop itself is independent).
- Add `dispatch: (action: any) => void` to `AccountsPageProps` (line 5-7).
- Update the function signature (line 14): `export function AccountsPage({ state, dispatch }: AccountsPageProps)`.
- No behavior change yet — this task only threads the prop through; overlay wiring happens in T7.
- Test: none yet (covered by T8's AccountsPage.test.tsx additions once click behavior exists) — but do add a trivial smoke check if `AccountsPage.test.tsx` currently renders `<AccountsPage state={state} />` without `dispatch` — update those existing render calls to pass a `vi.fn()` dispatch so the file still compiles/passes after T5's prop becomes required.
- Acceptance: `npx tsc --noEmit -p .` shows no new errors from `AccountsPage.tsx`'s own signature (call sites still broken until T6 — expected, fixed next).

### T6 — Update `App.tsx` call site
File: `src/App.tsx` (~line 313-315, `<AccountsPage state={state} />`).
Depends on: T5.
- Change to `<AccountsPage state={state} dispatch={dispatch} />`.
- Test: existing `App.test.tsx` Accounts-view test (if present) should still pass unchanged — re-run full `App.test.tsx` suite.
- Acceptance: `npx vitest run src/App.test.tsx` passes; `npx tsc --noEmit -p .` shows zero errors anywhere in the `App.tsx`/`AccountsPage.tsx` pair.

### T7 — Wire click handler + overlay render in `AccountsPage`
File: `src/components/AccountsPage.tsx`.
Depends on: T3 (overlay's new prop contract), T5/T6 (dispatch threaded in).
- Import `PositionGroupOverlay` from `./PositionGroupOverlay`, `assetClassOptions` and `filteredPortfolioTotal` are not needed directly here (overlay computes `filteredPortfolioTotal` internally via its `state` prop) — only need `assetClassOptions(state)` for `existingAssetClasses`.
- Add `const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)` (needs `useState` import from `react`).
- On each account body row `<tr key={idx}>` (line 55), add `onClick={() => setSelectedAccountId(r.accountId)}` and `style={{ cursor: 'pointer' }}`. Do NOT add this to the `<tfoot>` `<tr>` (line 65) — leave that row's styling untouched (requirement #9).
- After the `sections.map(...)` block (after line 109, still inside the component's returned JSX, as a sibling — overlay is global to the page, not per-section), add:
  ```tsx
  {selectedAccountId && (() => {
    const account = state.accounts.find(a => a.id === selectedAccountId)
    if (!account) return null
    const positions = state.positions.filter(p => p.accountId === selectedAccountId)
    const accountLabel = `${account.name} (${account.accountNumber})`
    const title = account.institution ? `${account.institution} — ${accountLabel}` : accountLabel
    return (
      <PositionGroupOverlay
        positions={positions}
        title={title}
        accounts={state.accounts}
        dispatch={dispatch}
        onClose={() => setSelectedAccountId(null)}
        existingAssetClasses={assetClassOptions(state)}
        state={state}
        sortPositions={(a, b) => a.symbol.localeCompare(b.symbol)}
      />
    )
  })()}
  ```
- Test: covered by T8.
- Acceptance: manual render check — clicking a row with 2+ positions (including a `cash` symbol position) opens a dialog listing all of them, symbol-sorted; clicking Subtotal row does nothing (no `onClick` there); Escape/backdrop-click closes it (inherited from `PositionGroupOverlay`'s own Escape listener).

### T8 — `AccountsPage.test.tsx`: row-click and Subtotal-no-op tests
File: `src/components/AccountsPage.test.tsx`.
Depends on: T7.
- Add test: render `AccountsPage` with a state containing 1 account and 2 positions (one regular symbol, one `symbol: 'cash'`) in that account; `fireEvent.click` the account row; assert the overlay dialog appears (`screen.getByText` on the expected title string) and both positions' symbols are visible in the dialog.
- Add test: assert the title omits the institution segment when `account.institution === ''` — build a second account with empty institution, click its row, assert rendered title text has no leading `" — "` (e.g. `screen.getByText('Brokerage Account 1 (1000)')` exact match, no dash prefix).
- Add test: `fireEvent.click` on the `<tfoot>` Subtotal row; assert no dialog opens (`screen.queryByRole('dialog')` or equivalent absence check — check what selector `PositionGroupOverlay`'s existing tests use for "dialog is present/absent" and reuse it).
- Edge case: click a row for an account with zero positions (all closed / brand-new account) — overlay should open with an empty table body, no crash.
- Acceptance: `npx vitest run src/components/AccountsPage.test.tsx` passes, including all new cases.

### T9 — `selectors.test.ts` review pass
File: `src/lib/selectors.test.ts`.
Depends on: T1 (test likely already added there in T1 — this task is a final check, not new work).
- Re-read the full diff to `accountsSections()` tests added in T1; confirm coverage includes: a section with multiple accounts (each row has correct distinct `accountId`), and confirm no other existing test in the file asserts a fixed/closed row shape that the new field would break (e.g. deep-equality snapshot against an object literal missing `accountId`).
- If any existing test does a strict object-equality check on a full row (not field-by-field), update it to include `accountId` in the expected object.
- Acceptance: `npx vitest run src/lib/selectors.test.ts` passes with zero regressions in previously-passing cases.

### T10 — Full test suite + build + lint gate
Depends on: T1-T9.
- Run `npm run test` (full vitest run) — all files must pass, not just the touched ones (this catches any missed call site or stale snapshot).
- Run `npm run build` (tsc -b + vite build) — must complete with zero type errors.
- Run `npm run lint` (oxlint) — must complete with zero errors on touched files.
- If anything fails, fix and re-run before proceeding — do not proceed to docs/commit with a red gate.
- Acceptance: all three commands exit 0.

### T11 — Update `product-behavior.md`
File: `/Users/mdoraiswamy/owa/portfolio/product-behavior.md`.
Depends on: T10 (docs describe final, working behavior only).
- In the "Accounts page" section (~line 55-64), add a paragraph describing: row click (excluding Subtotal row) opens the same-shaped overlay as the Positions table's row-click overlay; positions listed = all positions for that account including cash; title format `` `{institution} — {name} ({accountNumber})` `` with institution/separator omitted when institution is empty; sort = symbol ascending; % of Portfolio stays whole-portfolio scoped; reassigning a position's account from this overlay removes it from the currently-open list on next render (same side effect already documented for the dashboard overlay).
- While in this section, fix the pre-existing "Positions table" section's stale reference to a "Taxes" column (~line 42) — the current overlay has no Taxes column; it has "% of Portfolio" instead. Update the 9-column list and the "Editable cells" paragraph to match actual code (remove Taxes-specific commit/revert rules that no longer apply, e.g. "except empty Taxes saves as 0" — verify against current `PositionGroupOverlay.tsx` before editing, since this is a correction to existing prose, not new content).
- Full-file re-read after edits per CLAUDE.md's "Full-file review after major changes" rule — confirm no other section references the now-removed `group` prop or Taxes column, and that prose stays terse/token-optimized (no narrative drift).
- Acceptance: file is internally consistent; every claim about `PositionGroupOverlay` behavior matches the code in `src/components/PositionGroupOverlay.tsx` and `src/components/AccountsPage.tsx` after this feature.

### T12 — Update `design.md`
File: `/Users/mdoraiswamy/owa/portfolio/design.md`.
Depends on: T10.
- Update the `PositionGroupOverlay` prop signature note (~line 113, currently `PositionGroupOverlay (group, accounts, dispatch, onClose)`) to `PositionGroupOverlay (positions, title, accounts, dispatch, onClose, existingAssetClasses, state, sortPositions?)`, and adjust the description sentence to reflect that the caller now supplies the position list and title directly rather than an aggregated `group`.
- Update the "Props convention" line (~line 121) — currently lists `AccountsPage (state)`; change to `AccountsPage (state, dispatch)`, and update the `PositionGroupOverlay (group, accounts, dispatch, onClose)` mention there too if it's restated in that line.
- Add a one-line mention in the component tree (~line 41, `AccountsPage.tsx` comment or nearby) noting it now also opens `PositionGroupOverlay` on row click, so the reader doesn't have to infer this from `PositionsTable.tsx` alone.
- Full-file re-read after edits — same consistency check as T11.
- Acceptance: `design.md` accurately reflects the new prop contract; no lingering reference to `group: AggregateRow` as the overlay's prop.

### T13 — Commit
Depends on: T10 (tests/build/lint green), T11, T12 (docs updated) — per CLAUDE.md, commit only after both are true.
- Stage the changed files explicitly (not `-A`): `src/lib/selectors.ts`, `src/lib/selectors.test.ts`, `src/components/PositionGroupOverlay.tsx`, `src/components/PositionGroupOverlay.test.tsx`, `src/components/PositionsTable.tsx`, `src/components/AccountsPage.tsx`, `src/components/AccountsPage.test.tsx`, `src/App.tsx`, `product-behavior.md`, `design.md`.
- Commit message describing the feature (row-click overlay on Accounts page, `PositionGroupOverlay` generalized to `positions`/`title`/`sortPositions`).
- Acceptance: `git log -1 --stat` shows exactly the intended files; `git status` is clean.

### T14 — Teardown worktree (final task)
Depends on: T13 (commit landed).
- Switch back to the main worktree (`/Users/mdoraiswamy/owa/portfolio`).
- Merge or leave the branch for PR per user's normal workflow (not automated here — this plan doesn't specify merge-to-main, only that the branch/commit exists and is inspectable).
- Remove the feature worktree: `git worktree remove ../worktree-accounts-row-overlay`.
- Acceptance: `git worktree list` no longer shows `worktree-accounts-row-overlay`; branch `accounts-row-overlay/add-position-overlay` still exists with the commit from T13.

## Acceptance Criteria

- Clicking any account body row in the Accounts page (not the Subtotal row) opens `PositionGroupOverlay` listing exactly that account's positions (including any `cash`-symbol position), sorted by symbol ascending.
- Overlay title reads `"{institution} — {name} ({accountNumber})"`, or `"{name} ({accountNumber})"` with no stray separator when institution is empty.
- Overlay supports the same inline edits (Symbol, Name, Shares, AvgCost, Price, Account reassignment, AssetClassOverrideSelect, delete-to-closed via `CLOSE_POSITION`) as the dashboard overlay, unchanged.
- "% of Portfolio" in this overlay is computed against the whole portfolio (`filteredPortfolioTotal(state)`), not the single account.
- Dashboard's existing row-click overlay behavior (title, sort, editing, delete) is unchanged — proven by regression tests in `PositionGroupOverlay.test.tsx`.
- `accountsSections()` rows expose `accountId`.
- `npm run test`, `npm run build`, `npm run lint` all pass.
- `product-behavior.md` and `design.md` accurately describe the new behavior and the corrected `PositionGroupOverlay` prop contract; no stale "Taxes column" reference remains.
- Work was done in and committed from `../worktree-accounts-row-overlay`, then the worktree was removed.
