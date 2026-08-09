# Settings: fix button styling + add tabs

Goal: fix ugly unstyled Drive Sync buttons, split Settings page into 2 tabs (General / Import Sessions), flip Accounts-before-Drive order in General tab. Pure layout/styling, no new state fields, no behavior change to actions.

Files touched:
- `src/components/Settings.tsx`
- `src/components/Settings.test.tsx`
- `product-behavior.md`
- `design.md`

No template file found in `plans/` (`_template.md` doesn't exist) — used structure of other plan files in `plans/`.

## Facts confirmed by reading code first

- `src/styles/styles.css` lines 139-161 has `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-secondary` classes. Don't touch this file.
- `src/components/Nav.tsx` lines 59-79 is the `.seg`/`.seg-opt` tab pattern to copy: `<div className="seg">` wrapping `<label className="seg-opt" onClick={...}><input type="radio" checked={...} readOnly /><span>{label}</span></label>`.
- `src/App.tsx` lines ~295-299: Settings view is `view === 'settings' ? (...) : (<SettingsPage .../>)` — a ternary, ELSE branch unmounts `SettingsPage` fully when nav'ing back to dashboard (not `display:none`). Confirmed: local `useState` tab will reset to default on every re-open. Assumption holds.
- `src/components/Settings.test.tsx` already exists, has full coverage of Drive/Accounts/Import Sessions behavior via mocked `../lib/drive`. New tests for tabs/classes go in same file, same mocking pattern (`vi.mock('../lib/drive', ...)`).
- Current section order in file: Drive Sync (line 96-118), Import Sessions (120-187), Accounts (189-216). Need: Accounts first, then Drive Sync, both in Tab 1; Import Sessions alone in Tab 2.

## Tasks

### 1. Button class fix (~10 min)
In `src/components/Settings.tsx`:
- `Connect Drive` button (disconnected state) → add `className="btn btn-primary"`.
- `Sync Now` button (connected state) → add `className="btn btn-primary"`.
- `Restore from Drive` button → add `className="btn btn-secondary"`.
- `Disconnect` button → add `className="btn btn-secondary"`.
Do not touch the ✕ delete-icon buttons (different pattern, out of scope).
No dependency on other tasks — do this first, standalone.

### 2. Add tab state + `.seg` tab bar (~20 min)
Depends on: task 1 done (same file, avoid merge overhead — do sequentially, not parallel).
- Add `const [activeTab, setActiveTab] = useState<'general' | 'importSessions'>('general')` inside `SettingsPage`.
- Add a `.seg` tab bar above the sections, copying Nav.tsx pattern exactly:
  - Tab 1 label "General", value `'general'`.
  - Tab 2 label "Import Sessions", value `'importSessions'`.
  - `onClick` calls `setActiveTab(value)`; `<input type="radio" name="settings-tab" checked={activeTab === value} readOnly />`.

### 3. Restructure section order + conditional render by tab (~20 min)
Depends on: task 2.
- Wrap Accounts section + Drive Sync section (in that order — Accounts FIRST) in `{activeTab === 'general' && <>...</>}`.
- Wrap Import Sessions section in `{activeTab === 'importSessions' && <>...</>}`.
- Physically move the Accounts JSX block above the Drive Sync JSX block in source order (not just conditionally — actual DOM order must be Accounts then Drive Sync).
- No prop/dispatch/content changes to any section's internals.

### 4. Update `src/components/Settings.test.tsx` (~25 min)
Depends on: tasks 1-3 done (need final DOM shape to write accurate assertions).
Existing tests currently pass because General tab is default and shows Accounts + Drive Sync; but Import Sessions tests will break since Import Sessions section now lives behind Tab 2 — those tests need to click the "Import Sessions" tab first.

Concrete changes:
- Add `fireEvent.click(screen.getByRole('radio', { name: 'Import Sessions' }))` (or click the `seg-opt` label if radio isn't directly targetable by role/name — check actual DOM, may need `screen.getByText('Import Sessions').closest('label')` or similar) before assertions in the existing `describe('Import Sessions section', ...)` block's tests, since that content is now gated behind the second tab.
- New test: "renders General tab by default" — on mount, Accounts heading and Google Drive Sync heading are present, Import Sessions heading/table is not.
- New test: "clicking Import Sessions tab shows import sessions table and hides Accounts/Drive sections" — click tab, assert Import Sessions heading present, Accounts heading and Google Drive Sync heading absent.
- New test: "clicking back to General tab restores Accounts/Drive sections" — click Import Sessions, then click General, assert Accounts + Drive Sync headings back, Import Sessions heading gone.
- New test: "Accounts section renders before Drive Sync section in DOM order" — render default (General tab), use `screen.getByRole('heading', { name: 'Accounts' })` and `screen.getByRole('heading', { name: 'Google Drive Sync' })`, assert Accounts heading's `compareDocumentPosition` precedes Drive Sync heading (`Node.DOCUMENT_POSITION_FOLLOWING` bit set on Drive Sync relative to Accounts), or simpler: query all headings in doc order and assert index of "Accounts" < index of "Google Drive Sync".
- New test (disconnected state): Connect Drive button has `className` containing `btn btn-primary`.
- New test (connected state): Sync Now button has `btn btn-primary`; Restore from Drive and Disconnect buttons each have `btn btn-secondary`.
- Check: existing tests reference `screen.getByRole('heading', { name: 'Accounts' })` etc. without needing a tab click already (since Accounts is in default tab) — those stay as-is, verify they still pass.

### 5. Update `product-behavior.md` (~15 min)
Depends on: tasks 1-4 (implementation settled, in case anything shifted).
Section "## Settings page" (around line 78-88):
- Describe two-tab structure via `.seg` tabs: "General" (default) and "Import Sessions".
- State General tab contains Accounts section first, then Drive backup section second (order flip from current doc, which lists Drive backup first).
- State Import Sessions tab contains the Import Sessions table, unchanged behavior.
- Note tab state is ephemeral, local to `SettingsPage`, resets to General on every visit (component fully unmounts/remounts via `App.tsx`'s view ternary).
- Mention Drive Sync buttons now use `.btn.btn-primary` (single primary action: Connect Drive / Sync Now) and `.btn.btn-secondary` (Restore from Drive, Disconnect) — no longer unstyled.

### 6. Update `design.md` (~15 min)
Depends on: task 5 (keep docs consistent).
- Line ~41: `Settings.tsx  # 3 sections: Drive backup / Import Sessions / Accounts` comment — update to reflect 2 tabs (General: Accounts + Drive backup / Import Sessions) and new order.
- Line ~112: `SettingsPage (state, dispatch) — 3 sections: Drive backup / Import Sessions / Accounts` — update similarly, mention `.seg` tab structure and local `activeTab` state.
- Check for any other "3 sections" or Settings-structure references (grep `Settings` in design.md) and update all.

### 7. Full-file review (~10 min)
Depends on: tasks 5, 6 done.
- Re-read `product-behavior.md` in full. Check no stale mentions of "three sections" or old order remain anywhere (grep case-insensitive "Drive backup", "Import Sessions", "Accounts" near Settings section).
- Re-read `design.md` in full. Same staleness check, plus verify component tree section and any Settings-adjacent prose is internally consistent with the new tab structure.
- Fix anything stale found.

### 8. Run tests, then commit (~10 min)
Depends on: all above tasks done.
- `npm run test` — all pass, including new/updated Settings.test.tsx tests.
- `npm run build` (typecheck) — passes.
- Only if tests pass AND docs updated: commit with message describing bug fix (button styling) + feature (tabs), per CLAUDE.md commit rule (never commit partial/doc-stale work).

## Test cases (explicit list for task 4)

1. Default tab on mount is General: Accounts + Google Drive Sync headings present; Import Sessions heading absent.
2. Click "Import Sessions" tab → Import Sessions table/heading shown; Accounts + Google Drive Sync headings hidden.
3. Click "Import Sessions" then click "General" → Accounts + Google Drive Sync restored; Import Sessions hidden again.
4. DOM order in General tab: Accounts heading appears before Google Drive Sync heading.
5. Disconnected state: `Connect Drive` button has class `btn btn-primary`.
6. Connected state: `Sync Now` has `btn btn-primary`; `Restore from Drive` has `btn btn-secondary`; `Disconnect` has `btn btn-secondary`.
7. Existing Import Sessions describe-block tests updated to click Import Sessions tab first before querying table/rows/delete buttons.
8. Existing Accounts describe-block tests still pass unmodified (Accounts is in default/General tab, no tab click needed).

## Acceptance criteria

- [ ] Drive Sync buttons render with app's styled `.btn.btn-primary`/`.btn.btn-secondary` look (no more browser-default chrome); one primary button per connection state.
- [ ] `.seg`/`.seg-opt` tab bar present in Settings page with "General" (default) and "Import Sessions" tabs, matching Nav.tsx markup pattern.
- [ ] General tab shows Accounts section then Google Drive Sync section (Accounts first, in that DOM order).
- [ ] Import Sessions tab shows only the Import Sessions table, content/behavior unchanged.
- [ ] Tab state is local `useState` in `SettingsPage`, not in `AppState`/reducer; resets to General every time Settings page is opened.
- [ ] `product-behavior.md` "Settings page" section updated: two-tab structure, tab labels, section-to-tab mapping, Accounts-before-Drive order, button classes.
- [ ] `design.md` updated: Settings.tsx directory comment + component-tree line + any other stale "3 sections" references.
- [ ] Full-file review of both docs done post-change; no stale/contradictory content remains.
- [ ] `npm run test` passes fully (including new/updated Settings.test.tsx cases).
- [ ] `npm run build` (typecheck) passes.
- [ ] Commit created only after tests pass and docs are updated (per CLAUDE.md), not before.
