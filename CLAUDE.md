# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Ground Rules

- Plans go in `plans/*.md`, not `.claude/<feature>/`.
- *ALWAYS* update relevant docs when changes are made — independent of whether the user explicitly requests it.
- When something is NOT working as expected, *MUST* add a test to reveal the bug and then fix and re-test.
- Do *NOT* create any document unless asked — **except** module reference docs (see [Reference Docs](reference-docs) below).
- After implementing a change, commit it — but only once all tests pass (`npm run test`) and all relevant reference docs are updated. If either isn't true, fix/update first; don't commit partial or doc-stale work.

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

**Persistence**: IndexedDB via `src/lib/persist.ts` (`loadPersistedApp`/`savePersistedApp`), one versioned blob (`portfolio_app_state_v1`) for the whole `AppState`. Migration-tolerant: missing collections must default to `[]`, never throw. `App.tsx` hydrates on mount and debounce-saves (500ms) on every state change, with a flush on `pagehide`/`visibilitychange→hidden`/unmount so a refresh within the debounce window doesn't lose the newest state. `savePersistedApp` rethrows open/write failures (no silent success).

**Sync**: `src/lib/drive.ts` wraps `@open-webapp/drive-sync`. The `drive` singleton's `folderPath: ['OpenWebApp', 'Portfolio']` is load-bearing and silent-failure-prone — a wrong value doesn't error, it just creates a fresh empty Drive folder and makes existing backups appear to vanish (see the comment in that file and `drive.test.ts`, which pins the array exactly). Backup format is a JSON dump of the whole `AppState`, not CSV. `App.tsx` calls `drive.activate()` once the password gate is passed (`sessionKey !== null`), disposed on unmount/re-lock — this attaches the library's `visibilitychange`/`pageshow` listeners that silently warm up the cached Drive token in the background before it goes stale. Without it, `ensureFreshConnection()` in `drive.ts` only ever finds an expired token and falls back to the fully interactive `connectDrive()`, popping the Google auth window on every settings-open/sync instead of reusing the stored one (see `App.test.tsx`'s "Drive-sync activation" test). Gated on `sessionKey` rather than raw mount: Drive has no role before local unlock, and registering these listeners pre-unlock let a stale cached token trigger a silent reauth attempt (surfacing a Google auth prompt) every time the tab regained focus while the password screen was still showing.

**Domain model** (`src/lib/types.ts`): `Account`, `Position`, `ClosedPosition`, `Transaction`, `PortfolioSnapshot`, `MappingProfile`. Key invariants:
- `PortfolioSnapshot` natural key is `(accountId, date)` — re-importing an account's positions on the same calendar day *replaces* that day's snapshot rather than adding a duplicate point.
- Re-importing Positions for an account *replaces* that account's `Position[]`; symbols that disappear become `ClosedPosition`s. `realizedGL` is computed from matching Sell `Transaction`s when they exist; otherwise it's `null` with `realizedGLBasis: 'unknown'` — never approximate/fabricate a realized G/L number.
- `Transaction` dedup on import is by natural key `date|symbol|type|shares|price`, scoped per-account (not global).
- Computed position fields (`marketValue`, `costBasis`, `gl`, `glPct`) are derived in `src/lib/computations.ts`, never stored on the `Position` itself.

**CSV import pipeline**: `src/lib/csv.ts` (Papa.parse → headers + raw rows) → `src/lib/mappingProfiles.ts` (user-defined, reusable CSV-header → field mappings, scoped by `kind: 'positions' | 'transactions'`, validated against `POSITIONS_REQUIRED_FIELDS`/`TRANSACTIONS_REQUIRED_FIELDS`) → `src/lib/accounts.ts` (resolves/creates the `Account` for each row, prompting on first-seen account numbers) → `src/lib/positionsImport.ts` / `src/lib/transactionsImport.ts` (apply the replace/dedup rules above). UI for this lives under `src/components/import/`.

**Selectors** (`src/lib/selectors.ts`): all filtering/search/sort/aggregation for the UI is derived here from `AppState` (e.g. `visiblePositions`, `visibleTransactions`, `totalValueSeries`, `summaryCards`, `allocationBars`, `performanceLinePoints`) — components should read through selectors rather than re-deriving from raw collections.

**Styling**: `src/styles/styles.css` is a verbatim port of the design bundle's CSS (see below), kept byte-identical to it aside from two interpolated `--space-5`/`--space-7` tokens the design bundle's own markup depends on but its stylesheet omits — don't hand-edit design tokens inline in components. Components consume the existing class vocabulary (`.card.blueprint.elev-sm`, `.tag`/`.tag-accent`/`.tag-outline`, `.seg`/`.seg-opt`, `.table`, `.nav`, `.field`/`.input`, `.dialog-backdrop`/`.dialog`) rather than inline styles or new CSS. The `.blueprint` corner-bracket marks (`<i class="corner tl/tr/bl/br">`, four per element) are retired as of the v11 theme — CSS hides them (`.corner { display: none }`) and components no longer render them; `.blueprint` is now a hook class with no corner visual.

**Design/spec reference**: `portfolio-dashboard-design/project/Portfolio Dashboard.dc.html` is the pixel-reference HTML/CSS/JS prototype this app is built from (see `portfolio-dashboard-design/README.md`). Reimplement its math/markup shape in React — do not literally reuse its mock `ACCOUNTS` data, synthetic `buildTransactions`, or the Watchlist/Alerts feature (explicitly out of scope; grep for `watchlist` case-insensitive in `src/` should always return nothing).

**Tests**: vitest + jsdom, one `*.test.ts` colocated per `src/lib/*.ts` module. `drive.test.ts` and `persist.test.ts` use `fake-indexeddb`/mocked Drive calls — inspect `@open-webapp/drive-sync`'s actual types before changing its usage, don't guess method names.

For the full original task breakdown and data-model rationale, see `plans/portfolio-dashboard-v1.md`.

### Reference Docs

Maintains agent-optimized reference docs in the module root — canonical source of truth for current behavior and design.

**Files (in `{name}`):**

| File | Required | Purpose |
|------|----------|---------|
| `product-behavior.md` | Always | User-visible behavior, edge cases, keyboard interactions, URL state |
| `design.md` | Always | Directory structure, API contract, component tree, state management, data model, data flows, design patterns |
| `schema-spec.md` | When module has a data schema | Data schema format — field reference, examples, validation rules |

**Rules:**

- **Current state only.** Describe module *as it exists right now*. No history, rationale, or planned features.
- **Token-optimized.** Terse, dense, structured for agent parsing. Bullet lists, tables, compact type definitions. No narrative prose.
- **Auto-update after every change.** When modifying any module, update affected section(s) of its reference docs — regardless of whether the user asks. Do not wait for instruction.
- **Full-file review after major changes.** After MAJOR changes (new features, refactors, schema/API/behavior shifts — not trivial typo/wording fixes), re-read each affected reference doc in full. Verify: no inconsistencies across sections, no stale or contradicted content, accurate to current code, still token-optimized (terse, no redundancy, no drift into narrative). Fix any issues before considering the task done.
- **Auto-create on-demand.** When working on a module that lacks these files, create them. Ask the user for clarifications as needed.
- **No inline maintenance rules.** Files contain pure content. Maintenance rules live here in AGENTS.md only.
- **Minimal cross-references.** One-line pointer to sibling docs at top of each file. No inline section-to-section references.
- **Supersede plans.** If `plans/{module}-*.md` files exist, reference docs are canonical. Plans remain historical artifacts.
