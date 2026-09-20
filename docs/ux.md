# UX language

Domain-first copy for groko. Speak **Environments** and **resources**; Terraform is an edge concern.

## Domain vocabulary

| Say | Avoid in primary UI |
|-----|---------------------|
| Environment, tier (Dev / Staging / Prod) | “workspace”, raw backend HCL as the story |
| Resource, catalogue, Shared vs env-scoped | “module instance” as the user’s object |
| Existing \| Create | `data.` / `resource` as the primary label |
| Review changes, folder map, Download ZIP | Leading with a `.tf` file tree |
| Shared hub DNS · owned by {Environment} | Implying Prefer Existing moves ownership |
| Add from catalogue / Import existing | “Paste HCL” as the empty-state CTA |

Catalogue and forms use **human labels** (Resource Group, Private DNS Zone, Linux Function App). Terraform type ids (`azurerm_*`) may appear as muted secondary text — never as the primary row title.

## Spine

**Environment → Resources → Export**

- **Graph** is **List | Graph** on Resources — **not** a fourth main tab.
- **Import existing** lives on **Environment** (Upload Terraform is the same edge action).
- Export default is **Review changes**; Live HCL / Files are secondary.

## Existing | Create

- First-class domain state on every instance (`useExisting`).
- Private DNS Zone **Prefer Existing** (shared hub) is the default — create is secondary.
- Existing fields collect identifying values in plain language (name / id hints) — **not** `data.azurerm_…` prose.

## Shared vs Environment

- **Shared** — visible in every tier; may not reference env-scoped targets (would leak across envs).
- **Env-scoped** — visible only in that Environment; may reference Shared + same-env.
- List, Graph, and reference pickers all honour the same rules. Cross-env edges are invalid / omitted.

## Prefer Existing ≠ ownership transfer

Hub DNS / VNet link **owner** is stamped when the hub link is created. Toggling Prefer Existing or reusing a zone **does not** move ownership. Reassign only via explicit **Change owner…** confirm.

## Empty states

Headed domain copy; no `.tf` / Terraform jargon.

- List: *No resources in this Environment yet.* → primary **Add from catalogue**, secondary **Import existing**.
- Graph: *Nothing to show for this tier.* → same CTAs (primary opens catalogue drawer).
- If resources exist but none for Shared + active tier, explain that other Environments hold them and suggest switching tier.

## Accessibility

- Keyboard can complete Environment → Import review/confirm → Resources → List|Graph selection sync → Graph **+ Add** → Existing|Create → Export Review → Download (or Leave unmapped confirm).
- **Esc** cancels confirms (starter, import, Prod friction, Change owner, Leave unmapped, catalogue drawer).
- Focus trap on destructive dialogs; Prod dialog shows Tier badge and title *This Environment is Production*.
- Catalogue search has a visible **Search resources** label; add controls are always visible (no hover-only **+**).
- Tier badge remains visible on Resources and Export.

## What we never show (primary surfaces)

- Raw **HCL** dumps as the default Export narrative (Review is first).
- Primary navigation as a **`.tf` tree** (folder map is Export-only, domain paths).
- Raw **`azurerm_*`** as primary catalogue / review labels.
- Storing raw HCL on domain resource instances.
- Silent destructive apply on Prod, or silent orphan drops from the ZIP.

## How agents should talk

<!-- Agentsy: fill “How agents should talk” — voice, labels, and Copilot copy rules. Keep domain-first; never invent azurerm_* dumps in UI-facing copy. -->

Stub for Agentsy: agents should mirror this document’s vocabulary (Environment, Shared, Existing|Create, Review, Leave unmapped) and route product asks through the Orchestrator. Full Copilot chapter lives in the developer guide stub.
