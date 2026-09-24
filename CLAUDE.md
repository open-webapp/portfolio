# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Ground Rules

- Plans go in `plans/*.md`, not `.claude/<feature>/`.
- When implementing a new feature and a UI/interaction decision arises (e.g. how to manage a list of items, a filter control, a dialog pattern), first check whether an existing part of the app already solves the same shape of problem and mirror that pattern. Only interrupt to ask the user when there's a genuine conflict or no existing pattern fits — don't ask by default.
- Before designing any inline-edit UI, check `product-behavior.md`'s "Editable cells" section and its reference implementation for the standing convention — don't model it on a visually-similar but semantically different component just because it's nearby.
- *ALWAYS* update relevant docs when changes are made — independent of whether the user explicitly requests it.
- When something is NOT working as expected, *MUST* add a test to reveal the bug and then fix and re-test.
- Do *NOT* create any document unless asked — **except** module reference docs (see [Reference Docs](reference-docs) below).
- After implementing a change, commit it — but only once all tests pass (`npm run test`) and all relevant reference docs are updated, verified by the mandatory grep sweep in [Reference Docs](#reference-docs) (not by judgment about which doc "should" need it). If either isn't true, fix/update first; don't commit partial or doc-stale work.
- Always commit the change once those gates pass — no need to wait for the user to ask. If the work was done in a git worktree, merge the committed changes back to `main` after committing, then tear the worktree down.
- NEVER push changes to a remote. Committing and merging to local `main` is the end of the line; leave pushing to the user.

## Commands

- `npm run dev` — start Vite dev server
- `npm run build` — typecheck (`tsc -b`) then production build (`vite build`)
- `npm run lint` — oxlint
- `npm run test` — run all tests once (vitest run)
- `npx vitest run src/lib/computations.test.ts` — run a single test file
- `npx vitest` — watch mode
- `./start.sh` — kills anything on :5173, clean-rebuilds, then starts the dev server (used for full from-scratch runs)

## Architecture

Local-first, single-user React 19 + TypeScript + Vite portfolio tracker ("Ledger"). No live price feed — all data comes from user-imported CSVs (Positions, Transactions).

**State**: single `useReducer` in `App.tsx`, no Redux/other state libs.
- `src/lib/state.ts` — `AppState` interface (all data collections + UI filter state) and pure action-helper functions (`addAccount`, `setCategory`, `toggleSort`, etc.)
- `src/lib/reducer.ts` — thin `appReducer(state, action)` dispatch table that just calls the `state.ts` helpers
- New features that mutate state: add a helper in `state.ts`, then a case in `reducer.ts` — don't put logic directly in the reducer or in components.

**Persistence**: `src/lib/persist.ts` opens a single IndexedDB directly (`indexedDB.open('portfolio_app_state_v1', 1)`) — no project registry, no per-project db naming. App state (accounts, positions, transactions) lives in that one db. `App.tsx` hydrates on mount and debounce-saves (500ms) on every state change, with a flush on `pagehide`/`visibilitychange→hidden`/unmount.

**Sync**: `src/lib/drive.ts` hand-rolls Drive backup/restore/conflict handling directly against `@open-webapp/drive-sync` — wraps app state in an `EncryptedEnvelope`, uploaded to Drive as `portfolio-state.json`; decryption, comparison, and conflict resolution (remote-wins semantics for encrypted state) are app-supplied. Sync is manual-only (Sync button), no auto-sync. `@open-webapp/drive-connect` supplies just the connection/auth widget and the `useDriveConnection` hook (status is hook-only — `DriveAuthHandle` exposes only `{connect, disconnect, ensureFresh, activate}`); `getConnectionSnapshot()` in `src/lib/drive.ts` reads the current `Connection` snapshot.

**Domain model** (`src/lib/types.ts`): `Account`, `Position`, `ClosedPosition`, `Transaction`, `PortfolioSnapshot`, `MappingProfile`. Key invariants:
- `PortfolioSnapshot` natural key is `(accountId, date)` — re-importing an account's positions on the same calendar day *replaces* that day's snapshot rather than adding a duplicate point.
- Re-importing Positions for an account *replaces* that account's `Position[]`; symbols that disappear become `ClosedPosition`s. `realizedGL` is computed from matching Sell `Transaction`s when they exist; otherwise it's `null` with `realizedGLBasis: 'unknown'` — never approximate/fabricate a realized G/L number.
- `Transaction` dedup on import is by natural key `date|symbol|type|shares|price`, scoped per-account (not global).
- Computed position fields (`marketValue`, `costBasis`, `gl`, `glPct`) are derived in `src/lib/computations.ts`, never stored on the `Position` itself.

**CSV import pipeline**: `src/lib/csv.ts` (Papa.parse → headers + raw rows) → `src/lib/mappingProfiles.ts` (user-defined, reusable CSV-header → field mappings, scoped by `kind: 'positions' | 'transactions'`, validated against `POSITIONS_REQUIRED_FIELDS`/`TRANSACTIONS_REQUIRED_FIELDS`) → `src/lib/accounts.ts` (resolves/creates the `Account` for each row, prompting on first-seen account numbers) → `src/lib/positionsImport.ts` / `src/lib/transactionsImport.ts` (apply the replace/dedup rules above). UI for this lives under `src/components/import/`.

**Selectors** (`src/lib/selectors.ts`): all filtering/search/sort/aggregation for the UI is derived here from `AppState` (e.g. `visiblePositions`, `visibleTransactions`, `totalValueSeries`, `summaryCards`, `allocationBars`, `performanceLinePoints`) — components should read through selectors rather than re-deriving from raw collections.

**Styling**: `src/styles/styles.css` is a verbatim port of the design bundle's CSS (see below), kept byte-identical to it aside from two interpolated `--space-5`/`--space-7` tokens the design bundle's own markup depends on but its stylesheet omits — don't hand-edit design tokens inline in components. Components consume the existing class vocabulary (`.card.blueprint.elev-sm`, `.tag`/`.tag-accent`/`.tag-outline`, `.seg`/`.seg-opt`, `.table`, `.nav`, `.field`/`.input`, `.dialog-backdrop`/`.dialog`) rather than inline styles or new CSS. The `.blueprint` corner-bracket marks (`<i class="corner tl/tr/bl/br">`, four per element) are retired as of the v11 theme — CSS hides them (`.corner { display: none }`) and components no longer render them; `.blueprint` is now a hook class with no corner visual.

**Design/spec reference**: `portfolio-dashboard-design/project/Portfolio Dashboard.dc.html` is the pixel-reference HTML/CSS/JS prototype this app is built from (see `portfolio-dashboard-design/README.md`). Reimplement its math/markup shape in React — do not literally reuse its mock `ACCOUNTS` data, synthetic `buildTransactions`, or the Watchlist/Alerts feature (explicitly out of scope; grep for `watchlist` case-insensitive in `src/` should always return nothing).

**Tests**: vitest + jsdom, one `*.test.ts` colocated per `src/lib/*.ts` module. `drive.test.ts` covers the conflict-reconcile helpers, the `driveAuth.ensureFresh` gate before sync operations, the T13 real-`createDriveAuth` auth-popup-race test, and `getConnectionSnapshot()`.

For the full original task breakdown and data-model rationale, see `plans/portfolio-dashboard-v1.md`.

### Reference Docs

Maintains agent-optimized reference docs **at the repo root only** — `design.md`, `product-behavior.md`, `schema-spec.md` live in `/home/mohan/owa/portfolio/`, never colocated in `src/`, `src/lib/`, `src/components/`, or any other subdirectory. This is the repo's established convention and overrides any generic "module root" framing below — "module root" means the repo root, not each module's own directory. When a module changes, find and update the relevant *section* of the existing root doc; never create a new doc file next to the code you're editing.

**Files (in repo root):**

| File | Required | Purpose |
|------|----------|---------|
| `product-behavior.md` | Always | User-visible behavior, edge cases, keyboard interactions, URL state |
| `design.md` | Always | Directory structure, API contract, component tree, state management, data model, data flows, design patterns |
| `schema-spec.md` | When module has a data schema | Data schema format — field reference, examples, validation rules |

**Rules:**

- **Current state only.** Describe module *as it exists right now*. No history, rationale, or planned features.
- **Token-optimized.** Terse, dense, structured for agent parsing. Bullet lists, tables, compact type definitions. No narrative prose.
- **Auto-update after every change.** When modifying any module, update affected section(s) of its reference docs — regardless of whether the user asks. Do not wait for instruction.
- **Mandatory pre-commit grep sweep — do not rely on judgment about which doc "should" be affected.** Before every commit that renames, removes, or adds a field/type/action/prop/component/route, grep **all three** root docs (`design.md`, `product-behavior.md`, `schema-spec.md`) for every old identifier touched by the diff — not just the docs a plan or task list assumed were relevant. A doc being scoped to "data schema" or "user-visible behavior" does not exempt it: if a removed field's name appears anywhere in that file (e.g. an `AppState` field listed in `schema-spec.md`'s UI-state section, not just its CSV/domain schema section), it's stale and must be fixed. This sweep is a blocking step of "commit only once docs are updated" (see Ground Rules) — a plan or implementation task that says "no schema-spec.md change needed" must still be verified by this grep, not assumed.
- **Full-file review after major changes.** After MAJOR changes (new features, refactors, schema/API/behavior shifts — not trivial typo/wording fixes), re-read each affected reference doc in full. Verify: no inconsistencies across sections, no stale or contradicted content, accurate to current code, still token-optimized (terse, no redundancy, no drift into narrative). Fix any issues before considering the task done.
- **Auto-create on-demand.** When working on a module that lacks these files, create them. Ask the user for clarifications as needed.
- **No inline maintenance rules.** Files contain pure content. Maintenance rules live here in AGENTS.md only.
- **Minimal cross-references.** One-line pointer to sibling docs at top of each file. No inline section-to-section references.
- **Supersede plans.** If `plans/{module}-*.md` files exist, reference docs are canonical. Plans remain historical artifacts.
