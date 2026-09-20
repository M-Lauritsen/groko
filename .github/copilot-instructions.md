# Groko Copilot instructions

Groko (Azure Environment builder) emits Terraform at the edge. Agents work in **domain language**, never Terraform-first.

## Domain-first
- Core model: **Environment → Resources → Refs** (`Environment`, `ResourceInstance`, `ResourceScope`, refs).
- HCL import/export is an **adapter at the edge**. No TF concepts in domain types (`src/lib/schema/types.ts`).
- Speak catalogue labels (Resource Group, VNet, …). Never invent or dump raw `azurerm_*` in UI copy or primary review surfaces.
- Shared vs environment scope, Existing vs Create, env knobs, PE/DNS ownership, and Prod friction are first-class domain rules — honour them.

## UI spine
- Main steps: **Environment → Resources → Export**. Graph is **List | Graph** on Resources (not a fourth tab).
- Export edge: Review changes, folder map, orphan gate, ZIP. HCL preview is secondary, never the default narrative.

## Runtime vs catalogue
- **Docker Compose / Dockerfile** = how you **run the groko web app**. Not an Azure catalogue resource type.
- Do not add Compose-as-infra catalogue entries or treat containers as Terraform modules inside the domain.

## Safety & quality
- Prod Environment: starter apply and Import Replace/Merge need explicit Prod confirms — never silent.
- Orphan resources block Download ZIP until **Leave unmapped…** is confirmed.
- Prefer Existing never transfers hub DNS ownership; reassign is explicit.
- Match neighbouring files; keep changes thin; extend `scripts/test-*.ts` for invariants you touch.
- Never invent azurerm_* dumps, fake provider schemas, or store raw HCL on `ResourceInstance`.
