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
- Renders `<span className="nav-brand">{portfolioName}</span>` first (unconditional), then `periodControl` when supplied; `periodControl` remains optional and is Budget-only per the caller.
- `.nav-brand` carries inline `style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}` so a long name truncates with an ellipsis instead of wrapping onto a second line when it competes for space with a centered `periodControl` (e.g. the Budget period `.seg` tabs, which render at `width: 100%` via `.budget-controls`).
