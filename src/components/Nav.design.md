# Nav Design

Sibling: `Nav.product-behavior.md`.

## API

```ts
RailNavProps = {
  state: AppState
  dispatch: (action: any) => void
  onOpenSettings: () => void
}

TopBarProps = {
  connected: boolean
  syncing: boolean
  handleSync: () => void
  onSwitchPortfolio: () => void
  portfolioName: string
  periodControl?: ReactNode
}
```

## Rail

- Fixed left `nav[aria-label="Main navigation"]` with Ledger `L` mark, item stack, flexible spacer, and Settings control.
- Main items: Budget (dashboard grid icon), Positions (vertical bars), Register (document), Quotes (trend line).
- Main controls are icon-only `button.rail-item` elements with accessible label and tooltip title.
- Active item: `state.view === item.value`; adds `.active` and `aria-pressed`.
- Settings uses the gear SVG and calls `onOpenSettings`; it is outside the main item stack and has no active state.
- At `max-width: 480px`: rail becomes a fixed 64px bottom row; mark and spacer are hidden; main items distribute horizontally; controls shrink to 40px square.

## Top Bar

- `header.top-bar` contains portfolio switch, optional period-control slot, and sync control.
- Portfolio switch: `button.top-bar-portfolio`; renders `portfolioName`.
- Period slot renders `periodControl` directly when supplied.
- Sync: icon-only `button.top-bar-sync` with circular-arrow SVG.
