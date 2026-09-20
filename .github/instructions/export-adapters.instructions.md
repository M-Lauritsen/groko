---
applyTo: "src/lib/generate/**/*.{ts,tsx},src/lib/import/**/*.{ts,tsx},src/components/export/**/*.{ts,tsx},scripts/test-generate.ts,scripts/test-export-map.ts,scripts/test-graph-layout.ts"
---
# Groko export / import adapters

- HCL is **edge-only**. Do not store raw HCL on `ResourceInstance`; apply commits domain state.
- Review changes: Adds / Updates / Existing / Orphans — **no HCL dump** as the default Export narrative.
- Folder map: domain→folder via `exportConfig`; orphans block ZIP until **Leave unmapped…** confirm.
- Import wizard: Upload → Review mapping → Replace | Merge | Cancel; data sources → Existing; resources → Create.
- Graph edges from `deps.ts`; invalid/cross-env edges must not become selectable refs.
- When changing emission, keep export-map file keys stable and extend `scripts/test-generate.ts` / `test-export-map.ts`.
- Never invent provider schemas; skip unmappable HCL with clear “Couldn’t map” reasons.
