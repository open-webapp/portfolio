# Settings Design

Sibling: `Settings.product-behavior.md`.

## API

- `SettingsPageProps.settingsSection`: `'backup' | 'encryption' | 'priceSync'`.
- Props cover app state/dispatch, portfolio Drive auth, session key/salt/password callbacks, price-sync triggers/errors, and Drive connection state.
- No `categories`, `categoryMappings`, `categoryDispatch`, or `categoriesHydrated` props.

## Sections

- Backup: Drive widget/folder link and backup download.
- Encryption: password change.
- Quotes API Key: Polygon and Alphavantage controls.
