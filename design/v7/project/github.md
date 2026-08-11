repo: open-webapp/portfolio
branch: main
path: design/v5/project

## Last sync
date: 2026-08-11T09:43:39Z

### Updated in this project
- Rebuilt "Portfolio Dashboard.dc.html" (Ledger) to match the CURRENT live app in src/ (not the stale design/v5 mock): nav with All/Taxable/Non-Taxable/Tax-Deferred tabs, 6M/1Y/YTD/All range, Settings gear; summary cards + Retirement/Non-Retirement segment cards; allocation-only chart (performance line chart removed upstream); positions grouped by symbol+asset class with % of Portfolio and a click-through account breakdown overlay; transactions with unmatched detection; CSV import dialog.
- Data model rebuilt flat (accounts/positions/closedPositions/transactions/snapshots) to mirror src/lib/state.ts and src/lib/types.ts.
- Built out the Settings view per src/components/Settings.tsx's current (post settings-cleanup-and-positions-count.md) shape: single unconditional page, no tabs, no Accounts section — Google Drive Sync (connect/connected states, sync/restore, backup link, cross-password restore prompt) then Change Encryption Password.

## Screen map
| Screen | Source file |
| --- | --- |
| Portfolio Dashboard.dc.html | design/v5/project/Portfolio Dashboard.dc.html |
| styles.css | design/v5/project/styles.css |
