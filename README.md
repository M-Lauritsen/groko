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

## How export works

1. **Setup** — name, region, prefix, tags; starters include **ACR + Container Apps** (VNet + MI + AcrPull + Key Vault sample secret + HTTP scale).
2. **Resources** — catalogue includes identities, role assignments, ACR, CAE, and multiple container apps.
3. **ACR auth** — per app: **Managed identity (recommended)** or Admin credentials (lab fallback).
4. **Container App extras** — list editors for env vars and app secrets (plain → sensitive var, or Key Vault ref + optional Secrets User role); optional HTTP scale rule (`concurrent_requests`).
5. **Export** — modular ZIP:

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

## Architecture

```
src/lib/schema/     # ResourceTypeDef catalogue + starters
src/lib/generate/   # HCL emitters, module grouping, ZIP
src/lib/store/      # React project state
src/components/     # Setup / catalogue / forms / export
scripts/test-generate.ts
```

## Catalogue highlights

Containers + Identity: `azurerm_container_registry`, `azurerm_user_assigned_identity`, `azurerm_role_assignment` (AcrPull / Key Vault Secrets User), `azurerm_log_analytics_workspace`, `azurerm_container_app_environment` (optional `infrastructure_subnet_id` + workload profile), `azurerm_container_app` (MI or admin registry auth, **env vars**, **app secrets** with plain or Key Vault refs, **HTTP scale rule**). Subnets support `Microsoft.App/environments` delegation.

## Known gaps

- Azure only.
- NSG rules are SSH/HTTP/HTTPS toggles.
- Key Vault RBAC beyond tenant/RBAC flag is minimal.
- No Function App resource yet.
- Container App is single-container (no sidecars/Dapr).
- Container App secrets from Key Vault use `vault_uri + secrets/<name>` (versionless); create the KV secret out-of-band or add an `azurerm_key_vault_secret` resource yourself.
- ACR private endpoint / private DNS not modeled (CAE VNet integration is).
- System-assigned identity + AcrPull role assignment is not auto-wired (user-assigned path is).
- Module boundaries are fixed groupings.
- No undo/history; starter apply replaces the list.
