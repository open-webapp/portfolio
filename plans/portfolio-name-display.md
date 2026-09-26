# Show Portfolio Name on PasswordGate + TopBar

Caveman plan. No `plans/_template.md` exists in this repo (checked) — this plan follows the structure of `plans/nav-settings-v7.md` instead. Requirements below are already locked by the caller (a resolved user interview happened upstream) — do not re-derive or re-ask. Small tasks, each one thing, <=30min. Read top to bottom before starting task 1.

## Scope

**In scope**: `src/components/PasswordGate.tsx`, `src/components/PasswordGate.test.tsx`, `src/components/Nav.tsx`, `src/components/Nav.test.tsx`, `src/App.tsx` (wiring only — pass new props at the two existing call sites), root docs `product-behavior.md`, `design.md` (new-feature sections + fixing pre-existing stale passages in the same sections), colocated `src/components/Nav.product-behavior.md` and `src/components/Nav.design.md` (updated in place, not created new).

**Out of scope**: `src/components/PortfolioPicker.tsx`, `ManageCategoriesPage` (route `'categories'`) — no portfolio-name display added there, per explicit user scope decision. `schema-spec.md` — no schema field changes, but still must be grepped in the mandatory sweep (T9) to confirm nothing stale. No new colocated doc files (e.g. no `PasswordGate.product-behavior.md`). `src/styles/styles.css` — must NOT be hand-edited; `.nav-brand` already exists unused, reuse as-is.

## Facts checked before writing this plan

- `src/components/PasswordGate.tsx` (lines 6-10, 17-23, 113-269): `PasswordGateProps` = `{ shape, onUnlock, onBackToPicker }`. `PasswordGate` dispatches to `EnterPasswordScreen` (shape `'encrypted'`) or `SetPasswordScreen` (shape `'absent'`), neither takes `portfolioName` today. `GateShell` (lines 25-111) takes `title`/`subtitle` as plain strings and renders `<h1>{title}</h1>` (line 63). Current titles: `"Set Encryption Password"` (line 150) and `"Encryption Password"` (line 235). Subtitles (lines 151, 236) stay unchanged.
- `src/App.tsx` line ~927: `<PasswordGate shape={gateShape} onUnlock={...} onBackToPicker={handleBackToPicker} />`, inside a branch where `activePortfolio` (non-null `Portfolio`, has `.name`) is already in scope (confirmed: `activePortfolio` is declared as `useState<Portfolio | null>` at line 166 and this whole render branch is gated after it resolves).
- `src/App.tsx` line ~964: `<TopBar periodControl={...} />`, inside the block gated on `activePortfolio && sessionKey !== null && isHydrated` all truthy (confirmed same surrounding structure as the `PasswordGate` call, just further down after the gate is passed).
- `src/components/Nav.tsx`: `TopBarProps` (line 24-26) = `{ periodControl?: ReactNode }`. `TopBar` (lines 97-103) renders `<header className="top-bar">{periodControl}</header>` — nothing else. `Nav()` (line 106-121, the legacy combined-shell wrapper) calls `<TopBar />` with no args at line 118 — this becomes a type error once `portfolioName` is required, must be fixed too (not mentioned explicitly in the brief but required for `tsc -b` to pass — grep confirms `Nav()` is the only other `TopBar` call site besides `App.tsx` and the test file).
- `src/styles/styles.css`: `.nav-brand` exists, unused today: `font-family: var(--font-heading); font-weight: 700; font-size: 18px; margin-right: auto;` — no cursor/color/hover. `.top-bar-portfolio` also exists, unused, has `cursor: pointer` + hover color — explicitly NOT to be reused (wrong semantics for static text, confirmed with user). Neither needs editing; component code just references `.nav-brand`.
- `src/components/PasswordGate.test.tsx`: `renderPasswordGate` helper (lines 29-37) defaults `{ shape: 'absent', onUnlock, onBackToPicker }`, no `portfolioName`. Line 133: `expect(screen.getByRole('heading', { name: 'Encryption Password' })).toBeTruthy()` — the only heading-text assertion in the file (grepped, no other literal title-text assertions elsewhere in this file).
- `src/components/Nav.test.tsx`: `makeTopBarProps` (lines 27-31) returns `{ ...overrides }`, no defaults. `describe('TopBar', ...)` (lines 118-135) has two tests: line 119 asserts period control renders and `queryByRole('button', {name: /portfolio|sync/i})` is null (still valid unmodified since new element is a `<span>`, but props need `portfolioName` added since it's about to become required); line 127 asserts `topBar?.childElementCount).toBe(0)` when no `periodControl` given — this WILL break once portfolio name always renders as a child, must be rewritten.
- Root doc staleness confirmed by direct read:
  - `product-behavior.md` line 15: claims `RailNav` "contains a Ledger `L` mark" — actual `RailNav` code (`Nav.tsx` lines 46-95) renders no mark/logo at all, just tab buttons + spacer + sync + settings + switch-portfolio.
  - `product-behavior.md` line 25: claims `TopBar` "contains an accent-colored portfolio-switch button ... and a right-aligned accent Sync Now icon button" — actually Sync and Switch-portfolio buttons both live in `RailNav` (`Nav.tsx` lines 70-92), not `TopBar`. Current `TopBar` renders only `periodControl`.
  - `product-behavior.md` line 255: claims rail order is "Switch portfolio, Budget, Positions, Register, then ... Sync above Settings" — actual code order (`Nav.tsx` lines 46-93) is main tabs (Budget/Positions/Register) -> spacer -> Sync (conditional) -> Settings -> Switch-portfolio LAST. This matches colocated `Nav.product-behavior.md`'s own text ("Switch portfolio is the last rail control, directly below Settings").
  - `design.md` lines 57-59: same three claims (Ledger mark in RailNav; portfolio-switch + Sync button in TopBar) — same staleness, same fix.
  - Colocated `src/components/Nav.product-behavior.md` and `Nav.design.md` are already accurate on rail order/contents (correctly say switch-portfolio is last, no mention of a mark) but their "Top Bar" sections (`Nav.product-behavior.md` lines 15-17; `Nav.design.md` lines 15-18, API block lines 6-18) describe today's blank/period-only `TopBar` and need the new portfolio-name behavior added.

## Design decisions already locked (implement as-is)

1. Both `PasswordGate` screens get title `"Password to access {name} Portfolio"` verbatim, `{name}` = new required prop `portfolioName: string`, threaded `PasswordGateProps` -> both screen components -> `GateShell`'s `title`. Subtitles unchanged.
2. `TopBarProps` gains a required `portfolioName: string`. `TopBar` renders `<span className="nav-brand">{portfolioName}</span>` as the first child inside `<header className="top-bar">`, before `periodControl`. `periodControl` keeps rendering Budget-only (unchanged conditional in `App.tsx`); portfolio name renders on every view (Budget/Positions/Register/Settings) since it's unconditional inside `TopBar`.
3. No CSS edits. Reuse `.nav-brand` exactly as it exists; do not touch `.top-bar-portfolio`.
4. `PortfolioPicker` and `ManageCategoriesPage` get no portfolio-name display — out of scope, don't touch those files.
5. Root docs (`product-behavior.md`, `design.md`) get both: (a) the new portfolio-name-in-title / portfolio-name-in-TopBar behavior documented, and (b) the three pre-existing stale passages (Ledger mark; Sync/Switch-portfolio wrongly placed in TopBar; wrong rail order) corrected to match actual code, since it's the same sections being touched and CLAUDE.md mandates current-state accuracy.
6. Colocated `Nav.product-behavior.md` / `Nav.design.md` are updated in place (not replaced, not deleted) to describe the new TopBar portfolio-name behavior, keeping them internally consistent with the root docs. This is deliberate maintenance of pre-existing files per explicit user instruction, not new colocated-doc creation — CLAUDE.md's root-only policy governs *new* docs going forward, not editing files that already exist and already describe this exact component (see Open Questions).

## Tasks

### T0. Create isolated git worktree (~5 min)
No dependency.
- From `/home/user/portfolio`: `git worktree add ../worktree-portfolio-name-display -b portfolio-name-display/add-name`.
- `cd ../worktree-portfolio-name-display`. All subsequent implementation tasks (T1-T9) happen here.
- Acceptance: `git status` in the worktree shows a clean tree on the new branch; worktree dir exists as a sibling of `portfolio/`.

### T1. Add `portfolioName` to `PasswordGate` and change both titles (~20 min)
Depends on: T0.
- In `src/components/PasswordGate.tsx`:
  - Add `portfolioName: string` to `PasswordGateProps` (line ~6-10).
  - Pass `portfolioName` from `PasswordGate` into both `EnterPasswordScreen` and `SetPasswordScreen` (lines 18-22).
  - Add `portfolioName: string` to each screen's inline props type (lines ~113-119, ~197-203).
  - Change `SetPasswordScreen`'s `GateShell` call: `title="Set Encryption Password"` -> `` title={`Password to access ${portfolioName} Portfolio`} `` (line ~150). Subtitle (line 151) unchanged.
  - Change `EnterPasswordScreen`'s `GateShell` call: `title="Encryption Password"` -> same template (line ~235). Subtitle (line 236) unchanged.
- Test cases (added in T2, verified here manually via `npx vitest run src/components/PasswordGate.test.tsx` — expect failures until T2 lands):
  - Set-password screen with `portfolioName="Test Portfolio"` renders heading `"Password to access Test Portfolio Portfolio"`.
  - Enter-password screen with same prop renders the identical heading text.
- Acceptance: `tsc -b` shows a type error at `App.tsx`'s `PasswordGate` call site only (expected until T3), no error inside `PasswordGate.tsx` itself; both `GateShell` calls interpolate the prop correctly (spot check by temporarily rendering, or just visually confirm the template string).

### T2. Update `PasswordGate.test.tsx` for the new title + required prop (~15 min)
Depends on: T1.
- In `src/components/PasswordGate.test.tsx`:
  - Add `portfolioName: 'Test Portfolio'` to `renderPasswordGate`'s `defaults` object (line ~30-35).
  - Line ~133: change `screen.getByRole('heading', { name: 'Encryption Password' })` to `screen.getByRole('heading', { name: 'Password to access Test Portfolio Portfolio' })`.
  - Scan the rest of the file for any other literal-title assertions tied to old text (none found in the current read, but re-grep `Encryption Password` and `Set Encryption Password` in this file before finishing this task to be sure).
  - Add one new test in `describe('shape: absent — set-password screen', ...)`: renders with `portfolioName: 'Acme'` override and asserts heading `"Password to access Acme Portfolio"` — covers interpolation on the set-password screen specifically (existing line-133 assertion only covers the encrypted/enter screen).
- Test cases:
  - Enter-password screen (existing test, updated): heading reads `"Password to access Test Portfolio Portfolio"`.
  - Set-password screen (new test): heading reads `"Password to access Acme Portfolio"` when `portfolioName="Acme"` is passed.
- Acceptance: `npx vitest run src/components/PasswordGate.test.tsx` passes, all tests green, no leftover reference to `"Encryption Password"` or `"Set Encryption Password"` as an expected value anywhere in the file (grep confirms zero matches).

### T3. Wire `portfolioName` into `App.tsx`'s `PasswordGate` call (~10 min)
Depends on: T1.
- In `src/App.tsx` around line 927, add `portfolioName={activePortfolio.name}` to the `<PasswordGate ... />` call. `activePortfolio` is non-null in this branch (already true per the surrounding gate logic — confirmed in Facts Checked above), so no `?.`/fallback needed; if TypeScript still complains because of a wider possibly-null narrowing gap, use `activePortfolio!.name` only as a last resort and note why in a comment, but expect the existing narrowing to already cover it.
- Test cases: none new (no App-level test targets this exact branch by name in current suite, per grep of `App.test.tsx` for `PasswordGate` — confirm this during the task; if a matching test exists, verify it still passes with the new prop and does not need updating since it wasn't asserting title text).
- Acceptance: `tsc -b` no longer errors on this call site. `npx vitest run src/App.test.tsx` (or full suite) still green.

### T4. Add `portfolioName` to `TopBarProps`, render `.nav-brand` span, fix `Nav()` legacy wrapper (~20 min)
Depends on: T0 (independent of T1-T3, can run in parallel conceptually but same worktree so sequence after T0).
- In `src/components/Nav.tsx`:
  - Add `portfolioName: string` to `TopBarProps` (line ~24-26).
  - Change `TopBar` (lines 97-103) to:
    ```tsx
    export function TopBar({ periodControl, portfolioName }: TopBarProps) {
      return (
        <header className="top-bar">
          <span className="nav-brand">{portfolioName}</span>
          {periodControl}
        </header>
      )
    }
    ```
  - Fix the legacy `Nav()` wrapper (line 118): its `<TopBar />` call has no props today and will now fail to typecheck (`portfolioName` required). `Nav()` has no portfolio name in its own prop list (`NavProps`, lines 4-12) — add `portfolioName: string` to `NavProps` too and thread it: `<TopBar portfolioName={props.portfolioName} />`. Grep repo-wide for callers of `Nav(` (the combined wrapper, not `RailNav`/`TopBar` individually) before editing to confirm nothing else breaks — if no live caller exists outside tests, this is purely a compile-fix, not a behavior change.
- Test cases (added in T5, verified here via `npx vitest run src/components/Nav.test.tsx` — expect the two `TopBar` tests to need updates, done in T5):
  - `TopBar` with `portfolioName="Acme"` and no `periodControl` renders `<span class="nav-brand">Acme</span>` as the only child.
  - `TopBar` with both props renders the span before the period control node, in that DOM order.
  - The rendered span is not a `button`/`a`/clickable role (no `onClick`, no `role="button"`).
- Acceptance: `tsc -b` clean for `Nav.tsx` itself and its internal `Nav()` call site.

### T5. Update `Nav.test.tsx` for `TopBar`'s new required prop and behavior (~20 min)
Depends on: T4.
- In `src/components/Nav.test.tsx`:
  - Add `portfolioName: 'Test Portfolio'` as a default in `makeTopBarProps` (lines 27-31).
  - Test `'contains the supplied period control and no portfolio or Sync controls'` (line 119): keep the existing button-role assertion (still passes, it's a `<span>` not a button) but rename the description to reflect that a portfolio *name* now renders, just no portfolio *control* — e.g. `'contains the supplied period control and the portfolio name, but no portfolio or Sync buttons'`. Add an assertion that `topBar?.textContent` includes `'Test Portfolio'`.
  - Test `'renders a blank top bar without a period control'` (line 127): rename to `'renders the portfolio name with an empty period-control slot when none is supplied'`. Replace `expect(topBar?.childElementCount).toBe(0)` with an assertion that exactly one child exists (the `.nav-brand` span) and its text is `'Test Portfolio'`, e.g.:
    ```tsx
    expect(topBar?.childElementCount).toBe(1)
    expect(topBar?.querySelector('.nav-brand')?.textContent).toBe('Test Portfolio')
    ```
  - Add a new test asserting the `.nav-brand` span has no `role="button"`, no `href`, and no click handler side effect (e.g. `fireEvent.click` on it does not throw and calls nothing — or simply assert `tagName === 'SPAN'` and it has no `onclick` attribute) to lock in "not interactive."
- Test cases: covered by the three bullets above (rename + content assertion; rename + child-count/content assertion; new non-interactive assertion).
- Acceptance: `npx vitest run src/components/Nav.test.tsx` passes, all tests green.

### T6. Wire `portfolioName` into `App.tsx`'s `TopBar` call (~10 min)
Depends on: T4.
- In `src/App.tsx` around line 964, add `portfolioName={activePortfolio.name}` to the `<TopBar ... />` call, inside the block already gated on `activePortfolio && sessionKey !== null && isHydrated` (confirmed truthy in this branch — see Facts Checked).
- Test cases: none new required, but if `App.test.tsx` has any test asserting `.top-bar` contents (grep for `top-bar` / `TopBar` in `App.test.tsx` before finishing), verify it still passes and update if it makes stale assumptions about `TopBar`'s children.
- Acceptance: `tsc -b` clean for this call site. Portfolio name visibly present in the DOM for Budget/Positions/Register/Settings views (spot-checked via existing or new App-level test, or manually reasoned from the gating condition — full verification happens in T9's full-suite run).

### T7. Fix root docs: new portfolio-name behavior + pre-existing staleness (~25 min)
Depends on: T1-T6 (doc must describe final code, do after implementation lands).
- In `product-behavior.md`:
  - Line ~15: remove "It contains a Ledger `L` mark, three main icon buttons..." -> rewrite to describe `RailNav` as containing three main icon buttons (no mark), a flexible spacer, optional Sync, then Settings — match actual code order.
  - Line ~25: remove the claim that `TopBar` contains "an accent-colored portfolio-switch button" and "a right-aligned accent Sync Now icon button" (those live in `RailNav`, not `TopBar`). Rewrite to state `TopBar` shows the active portfolio's name (plain, non-interactive, left-aligned via `.nav-brand`) on every view, plus the Budget-only period control. Note that Sync and Switch-portfolio buttons are `RailNav` controls, described in the Rail section instead.
  - Line ~255: fix rail order text to "main tabs (Budget, Positions, Register), then a spacer, then (when connected/syncing) Sync, then Settings, then Switch portfolio last" — matching actual `RailNav` code and the colocated doc.
- In `design.md`:
  - Line ~58: remove "Ledger mark;" from the `RailNav` bullet.
  - Line ~59: rewrite the `TopBar` bullet to drop the portfolio-switch-button and Sync-button claims; state it renders the portfolio name (`.nav-brand` span, always) plus the optional Budget period control.
  - Line ~13: no change needed (already accurately describes only the period control, not portfolio name) — but add a short clause noting `TopBar` also always renders the active portfolio's name via `portfolioName` prop.
- Add a short "Password gate" mention if `product-behavior.md` has a section for it (grep for "Encryption Password" / "PasswordGate" first) — update any title-text references there too, matching T2's grep sweep target list.
- Test cases: N/A (docs), but this task's own acceptance doubles as its check.
- Acceptance: grep `product-behavior.md` and `design.md` for `Ledger \`L\` mark`, `Ledger mark`, `portfolio-switch button`, `Sync Now icon button` (in the TopBar context) and `Switch portfolio, Budget, Positions, Register` (old rail-order phrasing) — zero matches remain. Grep both files for `Encryption Password` / `Set Encryption Password` as literal expected UI text — zero matches remain (or updated to new title text). New portfolio-name-in-TopBar and portfolio-name-in-title behavior is described in both files.

### T8. Update colocated `Nav.product-behavior.md` and `Nav.design.md` in place (~15 min)
Depends on: T4-T5 (describes final `Nav.tsx` behavior).
- In `src/components/Nav.product-behavior.md`, "Top Bar" section (lines ~15-17): replace "The top bar has no portfolio or Sync controls." framing with something like: "The top bar always shows the active portfolio's name as plain, non-interactive text (left-aligned, `.nav-brand`), and has no Sync or portfolio-switch *controls*. The shell supplies its period control for Budget only; for every other view, only the portfolio name renders."
- In `src/components/Nav.design.md`:
  - API block (lines ~6-18): update `TopBarProps` to `{ periodControl?: ReactNode; portfolioName: string }`.
  - "Top Bar" section (lines ~15-18): replace "a period-control-only strip" description with: renders `<span className="nav-brand">{portfolioName}</span>` first, then `periodControl` when supplied; portfolio name is unconditional, `periodControl` remains optional/Budget-only per the caller.
- Test cases: N/A (docs).
- Acceptance: both colocated docs read consistently with the root docs updated in T7 (no contradictions on where Sync/Switch-portfolio live, no contradiction on rail order or TopBar contents); grep both files for the string `"no portfolio"` to confirm the outdated blanket claim doesn't survive unqualified.

### T9. Full verification sweep: tests, build, lint, mandatory grep, commit (~25 min)
Depends on: T1-T8.
- Run `npm run test` (full vitest suite) — fix any fallout beyond what T2/T5 already covered.
- Run `npm run build` (tsc -b + vite build) — fix any type errors.
- Run `npm run lint` (oxlint) — fix any lint issues introduced.
- Mandatory CLAUDE.md grep sweep: grep **all three** root docs (`product-behavior.md`, `design.md`, `schema-spec.md`) for every identifier touched by this diff:
  - `"Encryption Password"`, `"Set Encryption Password"` (old titles)
  - `"Ledger `L` mark"`, `"Ledger mark"` (removed claim)
  - `"portfolio-switch button"` (removed TopBar claim)
  - `"Sync Now icon button"` / similar TopBar-Sync claim (removed)
  - old rail-order phrasing `"Switch portfolio, Budget, Positions, Register"`
  - Confirm `schema-spec.md` has zero matches for any of the above (expected, since this feature touches no schema — but the sweep is mandatory, not optional, per CLAUDE.md).
  - Confirm new identifiers (`portfolioName`, `nav-brand` in TopBar context, `Password to access`) appear in the docs that should mention them (`product-behavior.md`, `design.md`, colocated `Nav.*.md`).
- Only once all of the above are green/clean: `git add` the changed files (`src/components/PasswordGate.tsx`, `src/components/PasswordGate.test.tsx`, `src/components/Nav.tsx`, `src/components/Nav.test.tsx`, `src/App.tsx`, `product-behavior.md`, `design.md`, `src/components/Nav.product-behavior.md`, `src/components/Nav.design.md`) and commit with a message describing the change, ending with the attribution lines from the system reminder:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JV6Zn1dPdQmbgKrhhMw1Wt
  ```
- Acceptance: `npm run test`, `npm run build`, `npm run lint` all exit 0. Grep sweep above shows zero stale matches and confirms new-identifier coverage. Commit created on the `portfolio-name-display/add-name` branch in the worktree.

### T10. Merge to main and tear down worktree (~10 min)
Depends on: T9.
- From the worktree: confirm the commit from T9 exists (`git log -1`).
- Switch back to `/home/user/portfolio` (the main worktree).
- `git merge portfolio-name-display/add-name` (merge the committed branch into local `main`) — do NOT push to any remote.
- Remove the worktree: `git worktree remove ../worktree-portfolio-name-display`.
- Delete the now-merged branch if the repo's convention is to clean up branches after merge (check recent merge commits for precedent; if unclear, leave the branch and note it in the final report rather than guessing).
- Acceptance: `git log` on `main` in `/home/user/portfolio` shows the merged commit; `git worktree list` no longer shows the removed worktree; nothing was pushed to any remote.

## Test strategy summary

- Unit/component tests: `PasswordGate.test.tsx` (both screens' new title text, interpolation with different `portfolioName` values), `Nav.test.tsx` (`TopBar` renders `.nav-brand` with portfolio name on every call regardless of `periodControl`; span is non-interactive; DOM order is name-then-period-control).
- Integration: full `npm run test` run in T9 catches any `App.test.tsx` fallout from the two new required props.
- Static: `npm run build` (tsc -b) catches any missed call site (e.g. the legacy `Nav()` wrapper's internal `<TopBar />` call, fixed in T4).
- Docs: grep sweep in T9 is the enforcement mechanism for CLAUDE.md's mandatory pre-commit doc check.

## Risks

- Missing a second `TopBar` or `PasswordGate` call site (mitigated by explicit grep-before-edit step in T4 and T3/T6's acceptance criteria).
- `activePortfolio` narrowing in `App.tsx` might not be as clean as assumed if the two call sites' surrounding conditionals differ subtly — flagged in T3/T6 as "verify, fall back to `!` only if truly needed."
- Colocated docs vs. root docs drifting out of sync again in the future — out of scope to solve structurally here (that's CLAUDE.md's policy question), just keep both consistent for this change per explicit user instruction.

## Open questions

- CLAUDE.md's "Reference Docs" section states colocated per-component docs (e.g. `Nav.product-behavior.md`, `Nav.design.md`) are not the sanctioned location "going forward" — but these files already exist in the repo, already describe this exact component, and the user explicitly asked that they be updated in place (T8) rather than left to go stale/self-contradictory. This plan treats that as intentional maintenance of pre-existing files, not new colocated-doc creation, and it should not be flagged as a policy violation by a future reviewer of this change. No action needed unless the user wants these colocated docs migrated into the root docs and deleted — that would be a separate, larger cleanup not requested here.
- T10's branch-deletion step is a judgment call (no explicit repo convention found) — flagged in the task itself rather than guessed silently.
