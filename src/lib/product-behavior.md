# product-behavior.md

User-visible behavior, edge cases, keyboard interactions, URL state.

## Positions

### Closed Positions — Undo

Click Undo on a closed position to restore it instantly, using the exact snapshot (shares, avgCost, price, assetClass, lastImportedAt) captured at close time — no dialog, no manual field entry.

- No open position with the same symbol in the account: silent restore, no confirmation.
- Open position with same symbol and identical shares/avgCost/assetClass: `window.confirm` asks to overwrite. Yes → restored position replaces the existing one, closed entry removed. No → cancels entirely; closed position stays closed, nothing changes.
- Open position with same symbol but different shares/avgCost/assetClass: silent restore as a second, separate lot — duplicate symbol rows coexist, no confirmation shown.
- Restored position always gets a new internal id (not user-visible).
