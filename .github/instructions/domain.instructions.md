---
applyTo: "src/lib/schema/**/*.{ts,tsx},src/lib/store/**/*.{ts,tsx},scripts/test-invariants.ts,scripts/test-prod-friction.ts,scripts/test-hub-dns-ownership.ts,scripts/test-empty-resources.ts,scripts/test-history.ts"
---
# Groko domain

- Domain-first: `Environment`, `ResourceInstance`, `ResourceScope`, refs — **no Terraform concepts in domain types**.
- Shared vs env-scoped visibility; `canReference` = shared + same-env only.
- Existing | Create via `useExisting` / `existingValues`; Prefer Existing must not transfer `hubOwnerEnvironmentId`.
- Prod friction for starter/import Replace|Merge when active Environment is Prod.
- Undo snapshots include resources, environments/scopes, selection, `exportConfig`.
- Catalogue: human `label` + deliberate `ResourceTypeDef`; never invent azurerm_* dumps.
- Extend matching `scripts/test-*.ts` when changing invariants.
