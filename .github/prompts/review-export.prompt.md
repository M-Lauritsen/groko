---
description: Review Export edge behavior — Review changes, folder map, orphans, ZIP gates.
agent: groko-export
---
Audit or implement Export-edge behavior for the current ask:

1. Confirm Review changes is domain-only (Adds/Updates/Existing/Orphans) — no HCL as default.
2. Folder map uses `exportConfig` domain→folder; overrides undo-safe.
3. ZIP download blocked while orphans remain; Leave unmapped requires explicit confirm.
4. Import path (if touched): mapping table in domain language; Replace|Merge|Cancel; Prod friction on Environment.
5. Extend `scripts/test-export-map.ts` / `test-generate.ts` / invariants as needed.
6. Hand UI chrome to groko-ui; domain gaps to groko-domain.
