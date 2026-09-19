# CategoryMappingTab Product Behavior

Sibling: `CategoryMappingTab.design.md`.

- Rendered only through Budget's local Category Mapping tab.
- Before global categories hydrate, displays `Loading category mappings...`; no mapping controls are shown.
- Supports category rename and exclude-from-spend toggle; displays each category's expense definitions and their mapping substrings.
- Supports adding, editing, and deleting mapping substrings. Delete requires confirmation.
- Downloads `{ categories, categoryMappings }` as unencrypted JSON. Imports merge valid JSON into the global store; malformed input shows an inline error and changes nothing.
- Every mapping mutation and successful import immediately reapplies mappings to budget transactions. No manual reapply control exists.
