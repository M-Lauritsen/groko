---
description: Add a new Azure catalogue resource type end-to-end (domain → UI → emit).
agent: groko-orchestrator
---
Add a catalogue resource to groko end-to-end:

1. **Domain** (`groko-domain`): `ResourceTypeDef` in `src/lib/schema/resources.ts` — human label, category, fields, outputs, Existing keys, default scope, Prefer Existing if hub-like. No TF-shaped domain state.
2. **UI** (`groko-ui`): ensure Catalogue / ResourceForm / ReferencePicker work via existing FieldDef rendering; domain labels only.
3. **Export** (`groko-export`): emit path in `generate/` (module grouping / HCL args via `hclKey`); import map if supported — otherwise explicit “Couldn’t map”.
4. Tests: catalogue presence, ref eligibility, generate golden markers as appropriate.
5. Out of scope unless asked: new main tabs, Compose-as-catalogue, inventing unverified azurerm schemas.
6. Finish with `groko-reviewer` checklist.
