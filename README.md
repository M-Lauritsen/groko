# Azure TF Builder

Clickable Next.js app that generates **Azure (azurerm) Terraform** project templates with a modular layout, managed-identity ACR pull, and VNet-integrated Container Apps.

No auth. Generation is entirely client-side.

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
npm run build
npm test
```


## Import existing Terraform

Upload one or more `.tf` / `.tfvars` files, or a `.zip` of a Terraform root, via **Setup → Import existing Terraform** or the header **Upload Terraform** control.

- Client-side only (JSZip for archives). Shows a summary of supported vs skipped types before merge/replace.
- Maps `resource "azurerm_…"` and `data "azurerm_…"` blocks that exist in `RESOURCE_CATALOGUE`.
- Data sources become **Use existing** with identifying values filled when possible.
- Simple interpolations like `azurerm_resource_group.main.name` / `.id` become reference pickers when the target was imported.
- Skips/warns: modules (optional `modules/*/main.tf` extract only), `for_each`/`count`, unknown providers, unsupported types, locals-heavy expressions, unmapped arguments.

Not a perfect round-trip — nested blocks and complex HCL are best-effort.

## How export works

1. **Setup** — name, region, prefix, tags; starters include **ACR + Container Apps** (VNet + MI + AcrPull + Key Vault sample secret + HTTP scale).
2. **Environments** — first-class `dev` / `staging` / `prod` (add more as needed) with knobs (naming suffix, tags, ACR SKU, CA cpu/memory/replicas, ingress). Not a string flag on resources.
3. **Resources** — each instance is **Shared** or **scoped to one environment**. Reference pickers only allow shared + same-env targets (no cross-env leakage). Catalogue has no `.tf` file tree in primary nav.
4. **ACR auth** — per app: **Managed identity (recommended)** or Admin credentials (lab fallback).
5. **Container App extras** — list editors for env vars and app secrets (plain → sensitive var, or Key Vault ref + optional Secrets User role); optional HTTP scale rule (`concurrent_requests`).
6. **Export** — modular ZIP driven by Environment objects:

```
config.tf                 # versions + provider + partial backend "azurerm" {}
main.tf                   # module wiring
variables.tf              # includes acr_sku, ca_cpu/memory/replicas, ingress
outputs.tf
environments/
  dev.tfvars / staging.tfvars / prod.tfvars   # meaningfully different sizing
  backend.dev.hcl / backend.staging.hcl / backend.prod.hcl
modules/
  resource_group/ networking/ identity/ container_registry/ container_apps/ …
README.md
```

### Init + plan (remote state)

```bash
# Partial backend in config.tf — pass env-specific details at init:
terraform init -backend-config=environments/backend.dev.hcl

terraform plan  -var-file=environments/dev.tfvars
terraform apply -var-file=environments/dev.tfvars
```

Switch env:

```bash
terraform init -reconfigure -backend-config=environments/backend.prod.hcl
terraform plan -var-file=environments/prod.tfvars
```

Edit `environments/backend.*.hcl` (`storage_account_name`, etc.) and fill `CHANGE_ME_*` secrets in tfvars.

### Env differences (examples)

| Knob | dev | staging | prod |
|------|-----|---------|------|
| `acr_sku` | Basic | Standard | Premium |
| `ca_cpu` / memory | 0.25 / 0.5Gi | 0.5 / 1Gi | 1.0 / 2Gi |
| replicas | 0–2 | 1–5 | 2–10 |
| `ca_ingress_external` | true | true | false |
| `naming_prefix` | `*-dev` | `*-stg` | `*-prd` |

## Undo & safer starters

- **Undo / Redo** — header and resource-list controls, plus `Cmd/Ctrl+Z` and `Shift+Cmd/Ctrl+Z` (or `Ctrl+Y`). History keeps ~40 snapshots of resources + selection + **environments/scopes**; value typing is debounced (~300ms) so undo is not character-by-character. Snapshots cover add/remove, value edits, use-existing toggles, import merge/replace, starter apply, and environment knob edits.
- **Starter apply** — empty canvas applies immediately. If resources already exist, a confirm offers **Replace all**, **Merge with starter**, or **Cancel** (no silent wipe).

## Architecture

```
src/lib/schema/     # ResourceTypeDef catalogue + starters
src/lib/generate/   # HCL emitters, module grouping, ZIP
src/lib/import/     # Client-side HCL parse → ResourceInstance[]
src/lib/store/      # React project state + undo history + starter apply
src/components/     # Setup / catalogue / forms / export
scripts/test-generate.ts
```

## Catalogue highlights

Containers + Identity: `azurerm_container_registry`, `azurerm_user_assigned_identity`, `azurerm_role_assignment` (AcrPull / Key Vault Secrets User), `azurerm_log_analytics_workspace`, `azurerm_container_app_environment` (optional `infrastructure_subnet_id` + workload profile), `azurerm_container_app` (MI or admin registry auth, **env vars**, **app secrets** with plain or Key Vault refs, **HTTP scale rule**). Subnets support `Microsoft.App/environments` delegation.

## Known gaps

- Export still emits one shared module tree (env differences are via tfvars knobs, not duplicated env-scoped HCL modules).
- Azure only.
- NSG rules are SSH/HTTP/HTTPS toggles.
- Key Vault RBAC beyond tenant/RBAC flag is minimal.
- No Function App resource yet.
- Container App is single-container (no sidecars/Dapr).
- Container App secrets from Key Vault use `vault_uri + secrets/<name>` (versionless); create the KV secret out-of-band or add an `azurerm_key_vault_secret` resource yourself.
- ACR private endpoint / private DNS not modeled (CAE VNet integration is).
- System-assigned identity + AcrPull role assignment is not auto-wired (user-assigned path is).
- Module boundaries are fixed groupings.
- Terraform import is best-effort (not full HCL2); modules/for_each/complex expressions are skipped.
