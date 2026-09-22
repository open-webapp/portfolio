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
}
```

## Rail

- Fixed left `nav[aria-label="Main navigation"]`: Switch portfolio control first, main-item stack, flexible spacer, optional Sync, then Settings.
- Main items: Budget (dashboard grid icon), Positions (vertical bars), Register (document), Quotes (trend line).
- Main controls are icon-only `button.rail-item` elements with accessible label and tooltip title.
- Active item: `state.view === item.value`; adds `.active` and `aria-pressed`.
- Switch portfolio is an icon-only `button.accent-square.rail-item` with an exit door+arrow glyph; it calls `onSwitchPortfolio`.
- Sync renders when `connected || syncing`, calls `handleSync`, and precedes Settings. While syncing, it is disabled, labeled/titled `Syncing`, and its icon has `.syncing`; otherwise its label/title is `Sync now`.
- Settings uses the gear SVG and calls `onOpenSettings`; it is last, outside the main-item stack, and has no active state.
- At `max-width: 480px`, the rail becomes a fixed 64px bottom row. DOM order remains Switch portfolio, main items, Sync when rendered, Settings; main items distribute horizontally and controls are 40px square.

## Top Bar

- `header.top-bar` is a period-control-only strip and always renders.
- It renders `periodControl` directly when supplied; otherwise it is intentionally blank.
