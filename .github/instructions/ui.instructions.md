---
applyTo: "src/components/**/*.{ts,tsx},src/app/**/*.{ts,tsx}"
---
# Groko UI

- Spine: **Environment → Resources → Export**. Graph is **List | Graph** on Resources — not a fourth main tab.
- Domain language in primary copy; `azurerm_*` / HCL only as muted secondary (if at all).
- Catalogue & empty states: **Add from catalogue** primary; **Import existing** secondary (Environment).
- Reference pickers: shared + same-env only; honour Tier badge and Prod dialogs (Esc cancels).
- Export chrome defaults to Review changes (domain summary), not Live HCL.
- Match existing `Field` / `SegmentedControl` / form patterns; `"use client"` at leaves as neighbouring files do.
- Prefer keyboard-accessible controls; preserve undo shortcuts in header/list.
