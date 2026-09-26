# Nav Design

Sibling: `Nav.product-behavior.md`.

## API

```ts
RailNavProps = {
  state: AppState
  dispatch: (action: any) => void
  connected: boolean
  syncing: boolean
  handleSync: () => void
  onOpenSettings: () => void
  onSwitchPortfolio: () => void
}

TopBarProps = {
  periodControl?: ReactNode
  portfolioName: string
}
```

## Rail

- Fixed left `nav[aria-label="Main navigation"]`: main-item stack, flexible spacer, optional Sync, Settings, then Switch portfolio last.
- Main items: Budget (dashboard grid icon), Positions (vertical bars), Register (document), Quotes (trend line).
- Main controls are icon-only `button.rail-item` elements with accessible label and tooltip title.
- Active item: `state.view === item.value`; adds `.active` and `aria-pressed`.
- Switch portfolio is an icon-only `button.rail-item.rail-exit` with an exit door+arrow glyph on a warm amber fill (`#f59e0b`, hover `#d97706`); it calls `onSwitchPortfolio`.
- Sync renders when `connected || syncing`, calls `handleSync`, and precedes Settings. While syncing, it is disabled, labeled/titled `Syncing`, and its icon has `.syncing`; otherwise its label/title is `Sync now`.
- Settings uses the gear SVG and calls `onOpenSettings`; it is second-to-last, outside the main-item stack, and has no active state.
- At `max-width: 480px`, the rail becomes a fixed 64px bottom row. DOM order remains main items, Sync when rendered, Settings, Switch portfolio last; main items distribute horizontally and controls are 40px square.

## Top Bar

- `header.top-bar` always renders.
- `header.top-bar` is `display: grid; grid-template-columns: 1fr` (inline style, overriding the `.top-bar` class's flex display). `.nav-brand` and a `periodControl` wrapper (`<div style={{ width: '100%' }}>`, only rendered when `periodControl` is supplied) are both placed at `gridColumn: 1; gridRow: 1`, so they occupy the same full-width cell rather than sitting side by side.
- `.nav-brand` also gets `justifySelf: 'start'` (left-anchored within the cell) and `whiteSpace: 'nowrap'` — it always renders the full, untruncated name on one line at its natural width, unaffected by `periodControl`.
- The `periodControl` wrapper spans the entire cell (`width: 100%`), so `periodControl`'s own internal centering (e.g. `.budget-controls`' `1fr auto 1fr` grid) always centers on the *full* top-bar width, never shifted by the name's width. Both items being normal in-flow grid items (not `position: absolute`) means the row's height is still set correctly even when `periodControl` is absent (non-Budget views).
- If the name is long enough to visually reach the tabs, it overlaps/steps over them rather than the tabs shrinking or shifting right — accepted tradeoff, since name and tab centering are otherwise fully independent.
