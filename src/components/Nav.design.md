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
  positionsTab?: PositionsTab
  positionsTabOptions?: ReturnType<typeof positionsTabs>
  onPositionsTabChange?: (tab: PositionsTab) => void
}
```

## Rail

- Fixed left `nav[aria-label="Main navigation"]`: main-item stack, flexible spacer, optional Sync, Settings, then Switch portfolio last.
- Main items: Budget (dashboard grid icon), Positions (vertical bars), Register (document).
- Main controls are icon-only `button.rail-item` elements with accessible label and tooltip title.
- Active item: `state.view === item.value`; adds `.active` and `aria-pressed`.
- Switch portfolio is an icon-only `button.rail-item.rail-exit` with an exit door+arrow glyph on a warm amber fill (`#f59e0b`, hover `#d97706`); it calls `onSwitchPortfolio`.
- Sync renders when `connected || syncing`, calls `handleSync`, and precedes Settings. While syncing, it is disabled, labeled/titled `Syncing`, and its icon has `.syncing`; otherwise its label/title is `Sync now`.
- Settings uses the gear SVG and calls `onOpenSettings`; it is second-to-last, outside the main-item stack, and has no active state.
- At `max-width: 480px`, the rail becomes a fixed 64px bottom row. DOM order remains main items, Sync when rendered, Settings, Switch portfolio last; main items distribute horizontally and controls are 40px square.

## Top Bar

- `header.top-bar` always renders as an inline one-column grid, overriding its flex class.
- `.nav-brand`, the optional Budget period wrapper, and the optional Positions `positionsTab` control share `gridColumn: 1; gridRow: 1`; each optional control spans the full cell.
- `.nav-brand` is left-anchored and non-wrapping, always rendering its full natural-width name.
- The Positions control is a `.seg` radio group using `positionsTabOptions` (`{key: PositionsTab, label: string}[]`): Taxable, Non-Taxable, Tax-Deferred, alphabetically sorted account-backed custom categories, then Quotes. Default options are `positionsTabs(initialState())` (base categories + Quotes); `App.tsx` supplies live options. Custom keys are `tag:${string}`.
- Normal grid flow preserves row height. A long name overlaps the centered control rather than moving or shrinking it.
