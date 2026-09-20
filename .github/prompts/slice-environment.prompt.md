---
description: Plan and implement a thin Environment-spine feature slice for groko.
agent: groko-orchestrator
---
Slice a groko feature along **Environment → Resources → Export**.

1. Restate the outcome in domain language (no TF jargon).
2. Thin slice + DoD + out of scope.
3. Route: Domain (types/invariants) → UI (spine surfaces) → Export (only if adapters touch) → Reviewer.
4. List real paths under `src/lib/schema|store`, `src/components/…`, `scripts/test-*.ts`.
5. Call out Prod friction, Shared vs env, Existing|Create, hub DNS, and orphan ZIP gates if relevant.
6. Do not invent azurerm_* dumps; do not put HCL in domain types.
