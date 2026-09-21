# Nav Product Behavior

Sibling: `Nav.design.md`.

## Rail

- Budget, Positions, Register, and Quotes select their corresponding app view through `SET_VIEW`.
- The selected view is visually active and exposes `aria-pressed="true"`; other main items expose `false`.
- Each main item and Settings has an accessible label and hover tooltip.
- Settings calls the shell-provided settings handler.
- At viewport widths of 480px or less, navigation remains available as a fixed bottom bar; Ledger mark is hidden.

## Top Bar

- Clicking the portfolio name calls the shell-provided portfolio-switch handler.
- The period control appears only when the shell supplies `periodControl`; the app supplies it for the Budget view only.
- Clicking Sync calls the shell-provided sync handler.
- Sync is disabled when Drive is disconnected or a sync is in progress.
- Sync has accessible label `Sync now` and tooltip `Sync now`.
