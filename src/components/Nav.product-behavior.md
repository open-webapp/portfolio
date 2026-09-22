# Nav Product Behavior

Sibling: `Nav.design.md`.

## Rail

- Budget, Positions, Register, and Quotes select their corresponding app view through `SET_VIEW`.
- The selected view is visually active and exposes `aria-pressed="true"`; other main items expose `false`.
- Switch portfolio is the last rail control, directly below Settings, shown as an exit door+arrow glyph on a warm amber fill. It has the accessible label and tooltip `Switch portfolio` and returns to the portfolio picker.
- Each main item and Settings has an accessible label and hover tooltip.
- Settings calls the shell-provided settings handler.
- Sync appears above Settings on desktop only while Drive is connected or an existing sync is in flight. It is `Sync now` when available; while in flight it remains visible even if connection state becomes false, spins, is disabled, and is labeled/titled `Syncing`.
- At viewport widths of 480px or less, navigation remains available as a fixed bottom bar in this order: main views, Sync when shown, Settings, Switch portfolio last.

## Top Bar

- The top bar has no portfolio or Sync controls.
- The shell supplies its period control for Budget only. For every other view, the retained top-bar strip is intentionally blank.
