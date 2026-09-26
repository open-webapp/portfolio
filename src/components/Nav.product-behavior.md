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

- The top bar always shows the active portfolio's name as plain, non-interactive text (left-aligned, `.nav-brand`); it has no Sync or portfolio-switch *controls*.
- The shell supplies its period control for Budget only. For every other view, only the portfolio name renders.
- A long portfolio name always renders in full on one line — it never wraps or truncates. The Budget period tabs stay centered on the full top-bar width regardless of the name's length; if the name is long enough, it visually overlaps the tabs rather than pushing them off-center.
