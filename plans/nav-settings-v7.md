# Apply v7 Design to Nav + Settings

Caveman plan. No `plans/_template.md` exists in this repo (checked) — this plan follows the structure of `plans/performance-chart-to-card-rows.md` instead. Requirements below are already locked by the caller (an interview happened upstream) — do not re-derive or re-ask. Small tasks, each one thing, ≤30min. Read top to bottom before starting task 1.

## Scope

**In scope**: `src/components/Nav.tsx`, `src/components/Settings.tsx`, `src/App.tsx` (minimal wiring only — lift Drive state, render `Nav` unconditionally, pass new props, remove old inline Back-to-Dashboard button, add `settingsSection` useState), `src/components/Nav.test.tsx` (new), `src/components/Settings.test.tsx` (update existing), `design.md`, `product-behavior.md`.

**Out of scope**: `src/lib/state.ts`, `src/lib/reducer.ts`, `src/lib/selectors.ts`, `src/lib/persist.ts`, `src/components/AllocationChart.tsx` — these have unrelated uncommitted WIP (broken date-range-select removal) with 11 pre-existing failing tests (`selectors.test.ts`, `ImportDialog.test.tsx`). Do not touch these files, do not fix those failures. `src/styles/styles.css` — already byte-identical to `design/v7/project/styles.css`, no CSS changes needed, only correct class usage in markup. Any other component/view not named above.

## Facts checked before writing this plan

- No `.claude/nav-settings-v7/` dir exists; plan correctly placed in `plans/`.
- `design/v7/project/Portfolio Dashboard.dc.html` lines 19-53 = nav markup (category `.seg` / settings `.seg` mutually exclusive via `sc-if isDashboardView`/`sc-if isSettingsView`, sync-icon button gated on `driveReady`, gear icon last, wrapped in a `margin-left:auto` flex div alongside the sync button).
- Same file lines 210-310 = settings view markup: Drive Sync card (`isDriveSection`) and Encryption card (`isEncryptionSection`) are mutually exclusive via `sc-if`, each `<div class="card blueprint elev-sm">` + 4 `<i class="corner tl/tr/bl/br">` + `<div class="card-title">`. "Google Account" label uses `.text-muted` + inline `font-size:11px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase`. Buttons: Connect / Sync Now / Restore-with-this-password / Change Password all `btn btn-primary blueprint` + 4 corner `<i>`. Restore-from-Drive / Cancel / Back-to-Dashboard stay plain `btn btn-secondary`. A `.hr` divider sits directly above the Back-to-Dashboard button, both inside the settings content div (not in Nav).
- `styles.css` line 128: `.text-muted { color: color-mix(in srgb, var(--color-text) 55%, transparent); }` — does NOT include the size/weight/letter-spacing/uppercase; those must stay as inline style overrides on top of the `text-muted` class, matching the v7 html's inline style attribute exactly.
- `styles.css` line ~211: `.card-title` exists (`font-family: var(--font-heading); font-weight: var(--font-heading-weight); font-size: 17px; line-height: 1.2;`). Confirmed usable as-is.
- Current `src/components/Nav.tsx` (91 lines): category tabs via `.seg`/`.seg-opt`, gear button with `marginLeft: 'auto'`, no date-range select (already removed by unrelated WIP — leave alone). No settings-tab branch, no sync button.
- Current `src/components/Settings.tsx` (401 lines): both cards (`Google Drive Sync`, `Change Encryption Password`) always render stacked in a plain `<div>` wrapper. Headers are `<h2>`, "Google Account" label is `<h3>` with inline styles (no `text-muted` class). Buttons are plain `btn btn-primary`/`btn btn-secondary`, no `blueprint`/corner marks. All Drive state (`syncing`, `driveReady`, `driveEmail`, `backupFileId`) and handlers (`handleConnect`, `handleDisconnect`, `handleSync`, mount-time `getDriveAuthStatus`/`getBackupFileId` effect) are local `useState`/`useEffect`. `handleRestore`, `crossPasswordPrompt` flow, and all Change-Password-section state/logic stay local — not part of the lift.
- Current `src/App.tsx`: `Nav` renders only in the `state.view === 'dashboard'` branch (~line 179). Settings branch (~lines 228-257) renders `SettingsPage` then a separately-styled inline "Back to Dashboard" `<button>` (accent-colored, not using `.btn` classes, dispatches `SET_VIEW` to `'dashboard'` directly in `App.tsx`).
- `src/components/Settings.test.tsx` (950 lines) exists. Has a `describe('Tab navigation', ...)` block (~line 558) with one test `'renders General tab by default'` that asserts `Google Drive Sync` heading shows and `Import Sessions` heading does not — `Import Sessions` is not a real section in current code (stale test, likely already passing vacuously since Import Sessions never renders regardless). T7 must check this test still makes sense against the new two-section (`drive`/`encryption`) model and rename/adjust if the "General"/"Import Sessions" language is misleading, without fixing unrelated pre-existing failures elsewhere.
- `src/App.test.tsx` exists, has Drive-related assertions (~lines 183, 200, 214: `screen.getByText('Google Drive Sync')` / `queryByText` on dashboard vs settings view) and a `describe('Drive-sync activation', ...)` block (~line 382-388) asserting `drive.activate()`/dispose on mount/unmount via a mocked `./lib/drive`. Lifting Drive state into `App.tsx` must not break these — `drive.activate()` wiring is unrelated to the lifted `driveReady`/`syncing`/etc. state and must stay as-is.
- `design.md` "Component tree" (~line 96-121) currently documents `Nav` with "category seg tabs + range select + settings gear" (the range select is stale/unrelated WIP drift — leave that phrase alone, out of scope; only add the new settings-tab/sync-icon behavior) and documents `SettingsPage` as "single page, no tabs" (~line 121) — this line must be updated since Settings becomes two mutually-exclusive sections.
- `product-behavior.md` "Nav" section (~line 11-16) and "Settings page" section (~line 100-108) will need surgical updates — read exact current text in T9 before editing, don't dump whole file into this plan.

## Design decisions already locked (implement as-is)

1. `state.ts`/`reducer.ts`/`selectors.ts`/`persist.ts`/`AllocationChart.tsx` untouched.
2. Settings-section tab state (`'drive' | 'encryption'`) is a plain `useState` in `App.tsx`, NOT in `AppState`/reducer/persist. Resets to `'drive'` every time settings is opened (i.e. set it to `'drive'` in the `onClick` that dispatches `SET_VIEW: 'settings'`, not just on mount).
3. `Nav` renders on both dashboard and settings views — lift it out of the dashboard-only branch in `App.tsx`. On dashboard it shows category tabs; on settings it shows "Google Drive" / "Encryption" tabs instead (same `.seg`/`.seg-opt` markup), wired to the new settings-section state.
4. Drive state (`driveReady`, `driveEmail`, `backupFileId`, `syncing`) + handlers (`handleConnect`, `handleDisconnect`, `handleSync`) + the mount-time auth-status effect move from `SettingsPage` local state up into `App.tsx`, passed down as props to both `Nav` (needs `driveReady`, `syncing`, `handleSync`, current view, settings-tab state + setter) and `SettingsPage` (needs all of them, as props instead of local state). `handleRestore`, `crossPasswordPrompt` flow, and Change-Password section state/logic stay local to `SettingsPage`.
5. Nav gains a "Sync Now" icon button (refresh SVG, exact path copied from design html line 45) between the tabs and the gear icon, shown only when `driveReady` is true, disabled while `syncing`, calls the lifted `handleSync`. When `driveReady` is false, render nothing in its place (no placeholder needed — gear stays pinned right via the wrapping flex div's `marginLeft: 'auto'`, matching v7's `sc-if driveNotReady` empty-span being purely cosmetic/inert).
6. `SettingsPage` becomes single-section: renders ONLY the Drive card when settings-tab is `'drive'`, ONLY the Encryption card when `'encryption'` (currently both always render stacked).
7. "Back to Dashboard" button moves out of `App.tsx` into the bottom of `SettingsPage`'s own JSX (after a `.hr` divider), styled `btn btn-secondary` (not accent-colored), dispatching `{ type: 'SET_VIEW', view: 'dashboard' }` directly via the `dispatch` prop `SettingsPage` already receives (simplest option — no new `onBack` prop needed).
8. `<h2>` card headers become `<div className="card-title">`.
9. "Google Account" label becomes `className="text-muted"` + the same inline style override App.tsx already uses for its "Portfolio" kicker pattern (font-size 11px, weight 600, letter-spacing 0.06em, uppercase) — verify current App.tsx kicker markup in T2 before copying (context notes it may have shifted after prior edits; re-grep don't assume line numbers).
10. Buttons getting `btn btn-primary blueprint` + 4 corner `<i>`: Connect Google Account, Sync Now (Settings card, not the Nav icon button), Restore-with-this-password, Change Encryption Password. Buttons staying plain `btn btn-secondary`: Restore from Drive, Cancel (cross-password), Back to Dashboard.

## Tasks

### T0. Create isolated git worktree (~5 min)
No dependency.
- From `/Users/mdoraiswamy/owa/portfolio`: `git worktree add ../worktree-nav-settings-v7 -b nav-settings-v7/apply-design`.
- `cd ../worktree-nav-settings-v7`. All subsequent implementation tasks (T1-T10) happen here.
- Acceptance: `git status` in the worktree shows a clean tree on the new branch, worktree dir exists as a sibling of `portfolio/`.

### T1. Extract exact v7 markup/class reference notes (~15 min)
Depends on: T0.
- Open `design/v7/project/Portfolio Dashboard.dc.html` lines 19-53 (nav) and 210-310 (settings) in the worktree copy (same file, unchanged by this branch) and `design/v7/project/styles.css`, specifically the `.nav`, `.nav-brand`, `.seg`/`.seg-opt`, `.card-title` (~line 211), `.text-muted` (~line 128), `.btn`/`.btn-primary`/`.btn-secondary`/`.blueprint`, `.corner`, `.field`/`.input`, `.hr` definitions.
- Copy the exact sync-icon SVG path (html line 45: `<path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M3 22v-6h6"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path>`, viewBox `0 0 24 24`, stroke-width 1.5, width/height 18) and the exact inline style used for "Google Account" label (`font-size:11px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase`) into scratch notes (not committed — just keep in your head/terminal scrollback for T3-T5) so T3-T5 don't fabricate markup.
- Acceptance: you can quote, from memory of what you just read, the sync-icon SVG path data and the exact corner-mark markup (`<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>`) without re-opening the file.

### T2. Lift Drive state from Settings.tsx into App.tsx (~25 min)
Depends on: T1.
- Open `src/App.tsx` and `src/components/Settings.tsx` in the worktree.
- In `App.tsx`: add `useState` for `syncing`, `driveReady`, `driveEmail`, `backupFileId` (same types as current `Settings.tsx` local state: `boolean`, `boolean`, `string | null`, `string | null`). Add a `useEffect` that runs the mount-time `getDriveAuthStatus()`/`getBackupFileId()` check (copy logic verbatim from `Settings.tsx` lines 51-66), importing `getDriveAuthStatus`, `getBackupFileId`, `connectDrive`, `disconnectDrive`, `syncBackup` from `../lib/drive` (adjust relative path — `App.tsx` is one level up from `src/components/`).
- Add `handleConnect`, `handleDisconnect`, `handleSync` as `useCallback`s in `App.tsx`, copied verbatim from `Settings.tsx` lines 68-80 (`handleSync`, needs `state`, `sessionKey`, `sessionSalt` from `App.tsx`'s existing scope) and 129-160 (`handleConnect`, `handleDisconnect`).
- Add `const [settingsSection, setSettingsSection] = useState<'drive' | 'encryption'>('drive')`.
- Do NOT move `handleRestore`, `crossPasswordPrompt` state, or Change-Password state/logic — those stay in `Settings.tsx`.
- Remove the now-duplicated `syncing`/`driveReady`/`driveEmail`/`backupFileId` state, the mount effect, and `handleConnect`/`handleDisconnect`/`handleSync` from `Settings.tsx` — but leave the rest of `Settings.tsx` (handleRestore, crossPasswordPrompt, password-change state) untouched for now; T5 handles the JSX rewrite.
- Update `SettingsPageProps` in `Settings.tsx` to accept `driveReady`, `driveEmail`, `backupFileId`, `syncing`, `handleConnect`, `handleDisconnect`, `handleSync`, `settingsSection` as new props (types matching what `App.tsx` now owns) instead of deriving them locally.
- Note: `Settings.tsx` will not compile cleanly until T5 rewrites its body to read these as props — that's fine, this task is state-plumbing only, T5 finishes the wiring. Don't run the build yet.
- Acceptance: `App.tsx` has all 4 new state vars + 3 new callbacks + `settingsSection` state; `Settings.tsx`'s import list no longer imports `connectDrive`/`disconnectDrive`/`syncBackup`/`getDriveAuthStatus`/`getBackupFileId` (those move to `App.tsx`'s imports) but still imports `restoreBackup`, `DriveDecryptError`, crypto/persist helpers used by the parts that stayed local.

### T3. Rewrite Nav.tsx (~25 min)
Depends on: T2 (needs to know the prop names being passed down).
- Open `src/components/Nav.tsx`.
- Extend `NavProps` to add: `view: AppState['view']` (or just read `state.view`, already available via `state` prop — prefer reading off `state` rather than a redundant prop, since `NavProps` already carries `state: AppState`), `settingsSection: 'drive' | 'encryption'`, `setSettingsSection: (s: 'drive' | 'encryption') => void`, `driveReady: boolean`, `syncing: boolean`, `handleSync: () => void`.
- Replace the single always-rendered `.seg` category-tabs block with two mutually exclusive blocks: `state.view === 'dashboard'` → existing category-tabs `.seg` (unchanged markup/behavior); `state.view === 'settings'` → new settings-tabs `.seg` with two `.seg-opt` entries, `{ value: 'drive', label: 'Google Drive' }` and `{ value: 'encryption', label: 'Encryption' }`, `checked={settingsSection === tab.value}`, `onClick={() => setSettingsSection(tab.value)}` — mirror the exact existing category-tab JSX pattern (radio input + span, `name="settingsSection"` per v7 html).
- Wrap the sync-icon-button + gear-icon-button pair in a `<div style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto' }}>` (move `marginLeft: 'auto'` off the gear button onto this wrapper, matching v7's structure exactly).
- Inside that wrapper, before the gear button, conditionally render the sync icon button when `driveReady` is true: `<button type="button" title="Sync now" onClick={handleSync} disabled={syncing} style={{...same pattern as gear button's transparent/hover style...}}>` containing the SVG from T1 (viewBox `0 0 24 24`, strokeWidth 1.5, width/height 18, the 4-path refresh icon). Reuse the same `onMouseEnter`/`onMouseLeave` hover-color pattern already used on the gear button for consistency (v7 uses `style-hover`, which is a design-tool-only attribute — React needs the existing onMouseEnter/onMouseLeave equivalent already present on the gear button).
- Gear button keeps existing `onClick`/SVG, loses its own `marginLeft: 'auto'` (now on the wrapper).
- Acceptance: with `state.view === 'dashboard'`, category tabs render, settings tabs do not; with `state.view === 'settings'`, settings tabs render (Google Drive / Encryption), category tabs do not; sync icon renders iff `driveReady`; sync icon `disabled` prop reflects `syncing`; gear button unchanged behavior (dispatches `SET_VIEW: 'settings'` — but note T4 will also need it to reset `settingsSection` to `'drive'`, see T4).

### T4. Wire settings-open to reset settingsSection to 'drive' (~10 min)
Depends on: T3.
- Decide where the reset happens (locked decision #2: "resets to drive every time settings is opened"). Simplest: in `App.tsx`, don't pass `dispatch` directly as the gear button's `onClick` — instead pass a small inline handler prop `onOpenSettings` from `App.tsx` to `Nav` that does `setSettingsSection('drive'); dispatch({ type: 'SET_VIEW', view: 'settings' })`. Add `onOpenSettings: () => void` to `NavProps`, gear button's `onClick={onOpenSettings}`.
- Update `App.tsx`'s `<Nav .../>` call site to pass `onOpenSettings={() => { setSettingsSection('drive'); dispatch({ type: 'SET_VIEW', view: 'settings' }) }}`.
- Acceptance: clicking gear from dashboard always lands on the Drive tab of Settings, even if a previous settings visit left `settingsSection` on `'encryption'`.

### T5. Rewrite Settings.tsx markup (~30 min)
Depends on: T2.
- Open `src/components/Settings.tsx`.
- Wrap the Drive card's existing JSX (lines ~221-345 in current file) in `{settingsSection === 'drive' && ( ... )}`; wrap the Encryption card's JSX (lines ~348-398) in `{settingsSection === 'encryption' && ( ... )}`. Read `settingsSection` off props now (per T2).
- Drive card: `<h2>Google Drive Sync</h2>` → `<div className="card-title">Google Drive Sync</div>`. `<h3>` "Google Account" label → `<div className="text-muted" style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '8px' }}>Google Account</div>` (drop the old inline `color: color-mix(...)` override — `.text-muted` class now supplies color).
- Connect button → `<button className="btn btn-primary blueprint" onClick={handleConnect} disabled={syncing}><i className="corner tl"></i><i className="corner tr"></i><i className="corner bl"></i><i className="corner br"></i>{syncing ? 'Connecting...' : 'Connect Google Account'}</button>`.
- Sync Now button → same `blueprint`+corner treatment, keep existing `{syncing ? 'Syncing...' : 'Sync Now'}` label logic.
- Restore from Drive button → stays plain `btn btn-secondary`, no corners (unchanged from today).
- Restore-with-this-password button (cross-password prompt) → add `blueprint` + 4 corner `<i>`, keep existing label logic.
- Cancel button (cross-password prompt) → stays plain `btn btn-secondary` (unchanged).
- Encryption card: `<h2>Change Encryption Password</h2>` → `<div className="card-title">Change Encryption Password</div>`.
- Change Encryption Password button → add `blueprint` + 4 corner `<i>`, keep existing label logic.
- After both conditional card blocks (outside both, still inside the outer wrapping `<div>`), add: `<div className="hr" style={{ marginBottom: 'var(--space-5)' }} />` then `<button type="button" className="btn btn-secondary" onClick={() => dispatch({ type: 'SET_VIEW', view: 'dashboard' })}>Back to Dashboard</button>` (uses `dispatch` prop `SettingsPage` already receives — no new `onBack` prop, per locked decision #7).
- Verify `.hr` class exists in `styles.css` before using it (grep it — if absent, ask; expected present per design.md/v7 parity, don't invent a substitute without checking).
- Acceptance: only one card renders at a time depending on `settingsSection` prop; all specified buttons have `blueprint` class + exactly 4 `<i className="corner ...">` children in the right tl/tr/bl/br order; Back to Dashboard button exists inside `SettingsPage`, not in `App.tsx`; card headers use `.card-title` div, no `<h2>` remains in the Drive/Encryption cards.

### T6. Update App.tsx wiring (~20 min)
Depends on: T2, T3, T4, T5.
- Move `<Nav state={state} dispatch={dispatch} .../>` out of the dashboard-only branch so it renders unconditionally above the `state.view === 'dashboard' ? ... : ...` switch (or at the top of both branches — pick whichever keeps the surrounding `maxWidth: 1400px` wrapper divs correct per current layout; simplest is one `<Nav>` call above a single wrapper div, then the two view branches render only their content below it).
- Pass new Nav props: `settingsSection`, `setSettingsSection`, `driveReady`, `syncing`, `handleSync`, `onOpenSettings` (from T4).
- In the settings branch, pass `driveReady`, `driveEmail`, `backupFileId`, `syncing`, `handleConnect`, `handleDisconnect`, `handleSync`, `settingsSection` to `<SettingsPage>` in addition to existing `state`, `dispatch`, `sessionKey`, `sessionSalt`, `onKeyChange` props.
- Delete the old inline accent-colored "Back to Dashboard" `<button>` from `App.tsx` (now lives in `SettingsPage`, per T5).
- Acceptance: `npm run build` typechecks cleanly (run at end of T8, not here, but re-read the diff now for obvious prop-name typos); no leftover unused imports/state in `App.tsx` (e.g. if `connectDrive`/`disconnectDrive`/`syncBackup`/`getDriveAuthStatus`/`getBackupFileId` imports were only used by the moved code, confirm `App.tsx` now imports them from `../lib/drive` and `Settings.tsx` no longer does, per T2).

### T7. Write Nav.test.tsx (new file) (~25 min)
Depends on: T3, T4.
- Create `src/components/Nav.test.tsx`, vitest + jsdom + React Testing Library, mirroring the render/mock conventions in `src/components/Settings.test.tsx` (mock `dispatch` as `vi.fn()`, build a minimal `AppState` fixture — check `src/lib/state.ts`'s `initialState()` or however other component tests build fixtures, e.g. grep how `App.test.tsx` builds its `AppState` fixtures for the pattern).
- Test cases:
  1. `state.view = 'dashboard'` → category tabs (All/Taxable/Non-Taxable/Tax-Deferred) render; settings tabs (Google Drive/Encryption) do not.
  2. `state.view = 'settings'` → settings tabs render; category tabs do not.
  3. `driveReady = true` → sync icon button renders (query by `title="Sync now"`).
  4. `driveReady = false` → sync icon button does not render.
  5. `driveReady = true, syncing = true` → sync icon button has `disabled` attribute.
  6. Clicking sync icon calls the passed `handleSync` mock.
  7. Clicking gear icon calls the passed `onOpenSettings` mock (check existing gear-click behavior/test pattern first if any existed pre-refactor — there wasn't a `Nav.test.tsx` before, so this is new coverage).
  8. Clicking a settings tab (`Google Drive` / `Encryption`) calls `setSettingsSection` mock with the right value.
- Run `npx vitest run src/components/Nav.test.tsx` — all pass.
- Acceptance: file exists, all 8 cases covered, test run green.

### T8. Update Settings.test.tsx (~25 min)
Depends on: T5.
- Open `src/components/Settings.test.tsx`. First run `npx vitest run src/components/Settings.test.tsx` against the pre-T5 code (or check T5 diff) to see which existing tests reference now-changed markup (`<h2>` role-based queries like `screen.getByRole('heading', { name: 'Google Drive Sync' })` — `.card-title` divs are not `<h2>` elements, so `getByRole('heading', ...)` will break; must switch to `getByText(...)` or add appropriate ARIA role).
- Update every render call in this file to pass the new required props (`driveReady`, `driveEmail`, `backupFileId`, `syncing`, `handleConnect`, `handleDisconnect`, `handleSync`, `settingsSection`) — since `SettingsPage` no longer derives these internally, tests must supply them directly instead of relying on mocked `drive.ts` module calls resolving into local state. Decide per-test whether to keep the `vi.mock('../lib/drive', ...)` pattern (if `handleConnect`/`handleSync`/etc. are now passed in as props by the test itself, the test can pass its own mock functions directly instead of relying on `Settings.tsx` calling the real imported functions) — the tests currently assert `connectDrive`/`syncBackup`/etc. were called with specific args (e.g. "clicking Connect button calls connectDrive and shows alert"); since that logic moved to `App.tsx`, those specific assertions belong in a new/updated `App.test.tsx` test instead (see T8b) — in `Settings.test.tsx`, adjust these tests to assert the passed-in `handleConnect`/`handleSync`/etc. prop mocks were called on click, not that the underlying `drive.ts` functions were called.
- Fix the `describe('Tab navigation', ...)` block (~line 558): rename/rewrite `'renders General tab by default'` to assert `settingsSection='drive'` prop shows the Drive card and hides the Encryption card (`getByText`/`queryByText` on `'Change Encryption Password'` instead of the stale, never-real `'Import Sessions'` heading). Add a companion case for `settingsSection='encryption'` showing only the Encryption card.
- Add a test: Back to Dashboard button renders inside `SettingsPage` and clicking it dispatches `{ type: 'SET_VIEW', view: 'dashboard' }` on the `dispatch` mock.
- Add/update button-class assertions for `blueprint` + corner-mark presence on Connect/Sync Now/Restore-with-this-password/Change Password buttons, and absence of `blueprint` on Restore from Drive/Cancel/Back to Dashboard.
- Do NOT touch `Settings.test.tsx.bak` (stray file, ignore).
- Run `npx vitest run src/components/Settings.test.tsx` — all pass.
- Acceptance: file updated, all tests green, no test still queries removed `<h2>`/`<h3>` markup or asserts Settings.tsx calling `connectDrive`/`syncBackup`/`disconnectDrive`/`getDriveAuthStatus`/`getBackupFileId` directly (those assertions move to App.test.tsx per T8b if warranted).

### T8b. Check whether App.test.tsx needs updates (~15 min)
Depends on: T6.
- Open `src/App.test.tsx`. Check the existing Drive-related assertions (~lines 183, 200, 214 — `getByText('Google Drive Sync')` on dashboard vs settings view) still pass given `Nav` now renders unconditionally and `SettingsPage` gets props instead of deriving state locally — these were checking page content, should be unaffected by the lift itself, but confirm.
- Check the `describe('Drive-sync activation', ...)` block (~line 382-388, `drive.activate()`/dispose on mount/unmount) still passes — this is unrelated to the state-lift (it's about the `drive` singleton's `.activate()` call, not the moved `driveReady`/`handleConnect`/etc. state), should be unaffected, but confirm by running the file.
- If `App.tsx`'s new mount-time Drive-status-check effect (moved from `Settings.tsx` in T2) causes any new unmocked network/Drive calls in tests that previously didn't trigger it on the dashboard view (since `SettingsPage` wasn't mounted there, but now the effect lives in `App.tsx` and runs regardless of view) — check whether existing `vi.mock('./lib/drive', ...)` in `App.test.tsx` (~line 19-20) already stubs `getDriveAuthStatus`/`getBackupFileId` sufficiently, or needs those mock exports added since the effect now always runs (previously it only ran when `SettingsPage` was mounted, i.e. settings view only).
- If any breakage found, fix minimally (add missing mock exports, update assertions) — do not add new test cases beyond what's needed to keep this file green, since Nav.test.tsx/Settings.test.tsx already own the new-behavior coverage.
- Run `npx vitest run src/App.test.tsx` — all pass.
- Acceptance: `App.test.tsx` green, or clearly documented (in commit message / this task's notes) what minimal fix was needed and why.

### T9. Run full test suite + build, confirm no new failures (~15 min)
Depends on: T7, T8, T8b.
- Run `npm run test` (full suite). Compare failures against the known baseline: 11 pre-existing failures in `selectors.test.ts`/`ImportDialog.test.tsx` (unrelated WIP, out of scope, expected to remain failing).
- Acceptance: total failure count is exactly the pre-existing 11 (in the same two files) — zero new failures in `Nav.test.tsx`, `Settings.test.tsx`, `App.test.tsx`, or any other file. If any new failure appears anywhere (including files not touched by this plan), stop and fix before proceeding — a regression outside the named baseline is not acceptable even if it's in an "out of scope" file, since it would mean this plan's changes broke something, not the pre-existing WIP.
- Run `npm run build` (typecheck + vite build) — must succeed with zero errors.
- Run `npm run lint` — must succeed (or produce only pre-existing warnings if lint was already non-clean before this branch; check via `git stash`-free comparison isn't needed — just confirm no lint errors attributable to the new Nav.tsx/Settings.tsx/App.tsx code).

### T10. Update reference docs: design.md + product-behavior.md (~25 min)
Depends on: T9 (docs describe final, tested behavior).
- Open `design.md`, re-read the "Component tree" section (~lines 96-121) and "Data flow" section (~lines 127-165) in full.
- In "Component tree": update the `Nav` line to mention settings-tabs + sync-icon-button behavior (e.g. "nav-brand 'Ledger' + category seg tabs (dashboard view) / settings seg tabs Google Drive|Encryption (settings view) + conditional sync-icon button (driveReady) + settings gear" — leave the stale "range select" phrase alone, that's unrelated WIP drift, not this plan's job to fix). Update the `[view === 'settings']` line: change "single page, no tabs" to describe the new `settingsSection` state and single-section conditional rendering (Drive vs Encryption), and note the Back-to-Dashboard button now lives inside `SettingsPage`.
- In "Data flow" (or wherever Drive sync is documented, search for "Drive sync" heading within this section): update to say Drive connection state (`driveReady`, `driveEmail`, `backupFileId`, `syncing`) and handlers (`handleConnect`, `handleDisconnect`, `handleSync`) now live in `App.tsx` as lifted state/callbacks passed as props to both `Nav` and `SettingsPage`, not local to `SettingsPage`. Keep `handleRestore`/cross-password-prompt/password-change described as `SettingsPage`-local (unchanged).
- After edits, re-read the full "Component tree" + "Data flow" sections once more for internal consistency (per CLAUDE.md Reference Docs rule: full-file review after major changes) — confirm no contradiction between the two sections about where Drive state lives.
- Open `product-behavior.md`, re-read "Nav" (~lines 11-16) and "Settings page" (~lines 100-108) in full.
- In "Nav": add a bullet for the settings-tabs (Google Drive/Encryption, shown only on settings view, resets to Google Drive tab each time settings is opened) and the sync-icon button (shown only when Drive connected, calls the same sync action as the Settings page's Sync Now button).
- In "Settings page": change "Single unconditional page with no tabs" to describe the two mutually-exclusive sections switched via the Nav settings-tabs; note Back to Dashboard button's location/behavior is unchanged in effect (dispatches to dashboard) even though it moved files.
- Re-read both full sections once more after edits for consistency with the rest of the file (terse, no narrative drift, no contradiction with "Layout" section at the top which lists `Nav` first).
- Acceptance: both docs edited, re-read in full per the rule above, no stale "single page, no tabs" or "always both sections render" language remains, no new narrative bloat.

### T11. Commit (~10 min)
Depends on: T9, T10.
- Confirm `npm run test` (scoped per T9's acceptance criteria) and `npm run build` are both clean, and `design.md`/`product-behavior.md` are updated (T10) — per CLAUDE.md, do not commit unless both are true.
- Stage the specific files touched: `src/components/Nav.tsx`, `src/components/Settings.tsx`, `src/App.tsx`, `src/components/Nav.test.tsx`, `src/components/Settings.test.tsx`, `src/App.test.tsx` (if changed), `design.md`, `product-behavior.md`. Do not `git add -A` (avoid sweeping in unrelated pre-existing WIP files like `src/lib/state.ts`/`reducer.ts`/`selectors.ts`/`persist.ts`/`AllocationChart.tsx` or the untracked `csv/`, `market-data/`, `design/v6/`, `design/v7/` dirs, `plans/dashboard-v6-layout.md`, `plans/performance-chart-to-card-rows.md` — those belong to other work).
- Commit with a message describing "apply v7 nav/settings design" and why (matches design bundle for these two views only).
- Do not push unless the user asks.

### T12. Worktree teardown (~5 min)
Depends on: T11.
- `cd /Users/mdoraiswamy/owa/portfolio` (back to main worktree).
- `git worktree remove ../worktree-nav-settings-v7`.
- Acceptance: `git worktree list` no longer shows the removed worktree; the `nav-settings-v7/apply-design` branch still exists with the commit (worktree removal doesn't delete the branch).

## Test Strategy

- **Nav.test.tsx** (new): 8 cases per T7 — view-based tab switching, sync-icon conditional render + disabled state, sync-icon click behavior, gear-icon click behavior, settings-tab click behavior.
- **Settings.test.tsx** (updated): existing ~35 test cases retargeted to new markup (`card-title`/`text-muted`/`blueprint`+corners) and new prop-based Drive state instead of locally-derived; single-section conditional-render cases added; Back-to-Dashboard-in-SettingsPage case added.
- **App.test.tsx**: checked for breakage from the Drive-state lift and the always-mounted mount-time effect; fixed minimally if needed.
- **Full suite**: `npm run test` at the end must show exactly the pre-existing 11 failures (`selectors.test.ts`, `ImportDialog.test.tsx`) and zero new failures anywhere.
- **Build**: `npm run build` (tsc -b + vite build) clean.
- **Lint**: `npm run lint` clean (no new errors attributable to this plan's files).

## Acceptance Criteria

1. `Nav.tsx` renders on both dashboard and settings views; shows category tabs on dashboard, Google Drive/Encryption tabs on settings; shows a sync icon button only when `driveReady`, disabled while `syncing`; gear icon still opens settings (and now resets `settingsSection` to `'drive'` each time).
2. `Settings.tsx` renders exactly one of the two cards at a time based on `settingsSection`; card headers are `.card-title` divs not `<h2>`; "Google Account" label uses `.text-muted` + matching inline overrides; Connect/Sync Now/Restore-with-password/Change Password buttons have `blueprint` + 4 ordered corner `<i>` elements; Restore-from-Drive/Cancel/Back-to-Dashboard stay plain `btn btn-secondary`; Back-to-Dashboard button lives inside `SettingsPage`, after a `.hr` divider, dispatching `SET_VIEW: 'dashboard'`.
3. `App.tsx` renders `Nav` unconditionally (both views), owns lifted Drive state/handlers and `settingsSection` state, passes correct props to both children, no longer has the old inline accent-styled Back-to-Dashboard button.
4. `Nav.test.tsx` exists and is green; `Settings.test.tsx` is green with markup/prop assertions matching the new implementation; `App.test.tsx` is green (unchanged behavior or minimally patched).
5. `npm run test` shows failures ONLY in `selectors.test.ts`/`ImportDialog.test.tsx` (the pre-existing 11, unrelated WIP baseline) — zero new failures anywhere else. This scoping is intentional per the caller's instructions: "all tests pass" for this plan means files touched/created by this plan, with the 11 pre-existing failures as a known, accepted baseline.
6. `npm run build` and `npm run lint` succeed with no new errors.
7. `design.md`'s Component tree + Data flow sections and `product-behavior.md`'s Nav + Settings page sections accurately describe the new behavior, re-read in full post-edit for internal consistency, no stale "no tabs"/"always both render" language remains.
8. No other component/view file was modified (`git diff --stat` against `main` shows only the files listed in Scope, plus the two doc files).

## Risks

- **Breaking existing dashboard Nav behavior when adding the settings-tab branch**: mitigate by keeping the category-tabs JSX byte-for-byte unchanged, only adding a sibling conditional branch and running `Nav.test.tsx` cases 1-2 (T7) to pin both branches independently.
- **App.tsx prop-drilling getting unwieldy**: `Nav` and `SettingsPage` each gain several new props from the lift. Mitigate by keeping prop names identical to the lifted state/handler names (no renaming/aliasing) so the diff is mechanical and easy to review; if it feels excessive, that's an acceptable/expected cost of this locked design decision (#4), not a reason to deviate.
- **Missing an exact class name from styles.css causing visual mismatch**: mitigate by grepping every new class (`card-title`, `text-muted`, `blueprint`, `corner`, `hr`) against `design/v7/project/styles.css` before using it in JSX (T1, and spot-checks in T5) rather than assuming it exists.
- **Settings.test.tsx assertions that currently check `drive.ts` function calls directly**: since Drive handlers move to `App.tsx`, those specific "calls `connectDrive`" style assertions no longer make sense inside `Settings.test.tsx` (which now receives handler props, not raw imports) — risk of either losing that coverage entirely or misplacing it. Mitigate via T8b: confirm whether that behavior-level coverage should live in a new `App.test.tsx` case (calling the real `handleConnect` and checking `connectDrive` was invoked) rather than dropping it silently.
- **Mount-time Drive-status effect now always running (both views) instead of only when Settings was mounted**: could surface previously-dormant unmocked async calls in dashboard-view tests. Mitigate via T8b's explicit check of `App.test.tsx`'s `vi.mock('./lib/drive', ...)` coverage.
- **Settings-tab reset-to-'drive' timing**: if implemented as a `useEffect` keyed on `view` instead of an explicit reset-on-open handler (per T4's chosen approach), risk of a flash of the wrong section on first settings-open before the effect fires. Mitigated by choosing the explicit `onOpenSettings` handler approach (T4) instead of an effect, so the reset happens synchronously with the view-change dispatch.

## Note

Per CLAUDE.md's Reference Docs rules: after T10's edits (a major behavior change — new Nav modes, new Settings section-switching, moved state ownership), re-read `design.md` and `product-behavior.md` in full (not just the touched sections) to check for cross-section staleness or contradiction before considering T10 done. This is already folded into T10 above — don't skip that final full-file pass.
