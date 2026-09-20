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

Upload one or more `.tf` / `.tfvars` files, or a `.zip` of a Terraform root, via **Environment → Import existing** or the header **Upload Terraform** control (Environment-step edge action — not a fourth main tab).

Wizard: **Upload → Review mapping → Confirm Replace / Merge / Cancel** (same safety pattern as starters).

- Review table is **domain language** only: type label (Resource Group, VNet, …), name, **Existing | Create**, **Shared vs env**. Terraform type ids are muted secondary text — no raw HCL in the primary step.
- Edit scope/tier and Existing|Create on the draft graph before commit; skipped/unmapped types stay out of the graph until you add them from the catalogue.
- Collapsed **Couldn't map** list with counts and plain-language reasons (optional detail disclosure for warnings).
- Client-side only (JSZip for archives). Adapter maps HCL → domain `ResourceInstance`s; apply commits domain state only (no raw HCL stored on instances).
- Data sources → **Existing**; resources → **Create**. Env-ish names/tags → suggested env scope (toggle before apply).
- Skips: modules, `for_each`/`count`, unknown providers, unsupported catalogue types, complex expressions.

Not a perfect round-trip — nested blocks and complex HCL are best-effort.

## How export works

1. **Environment** — project name/region/prefix/tags + starters, plus required **Dev | Staging | Prod** active-tier control and env knobs. Setup is folded into this step. Tier badge stays visible in header / Resources / Export after you leave this step.
2. **Resources** — each instance is **Shared** or **scoped to one environment**. Forms open with **Existing | Create** (Private DNS defaults Existing). Reference pickers only allow shared + same-env targets. Catalogue shows human labels (no raw `azurerm_*` on primary rows).
3. **ACR auth** — per app: **Managed identity (recommended)** or Admin credentials (lab fallback).
4. **Container App extras** — list editors for env vars and app secrets (plain → sensitive var, or Key Vault ref + optional Secrets User role); optional HTTP scale rule (`concurrent_requests`).
5. **Export** — modular ZIP driven by Environment objects (HCL only here / Import):

```
config.tf                 # versions + provider + partial backend "azurerm" {}
main.tf                   # module wiring
variables.tf              # includes acr_sku, ca_cpu/memory/replicas, ingress
outputs.tf
environments/
  dev.tfvars / staging.tfvars / prod.tfvars   # meaningfully different sizing
  backend.dev.hcl / backend.staging.hcl / backend.prod.hcl
modules/
  resource_group/ networking/ private_networking/ identity/ container_registry/ container_apps/ …
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
src/components/     # Environment / catalogue / forms / export
scripts/test-generate.ts
```

## Catalogue highlights

Private networking (first-class catalogue resources, not raw HCL):

- `azurerm_private_endpoint` — ACR `registry` subresource; emits `private_service_connection` + optional `private_dns_zone_group` (azurerm ~> 4.x pattern; no separate A record).
- `azurerm_private_dns_zone` — defaults to **Use existing** (shared hub DNS); create is secondary.
- `azurerm_private_dns_zone_virtual_network_link` — typically **Shared**; list badge shows `VNet link · Shared hub` (or the owning environment).

Scope: DNS zone + VNet link default **shared**; PE can be shared or env-scoped. Reference pickers still block cross-env refs.



Containers + Identity: `azurerm_container_registry`, `azurerm_user_assigned_identity`, `azurerm_role_assignment` (AcrPull / Key Vault Secrets User), `azurerm_log_analytics_workspace`, `azurerm_container_app_environment` (optional `infrastructure_subnet_id` + workload profile), `azurerm_container_app` (MI or admin registry auth, **env vars**, **app secrets** with plain or Key Vault refs, **HTTP scale rule**). Subnets support `Microsoft.App/environments` delegation.

## Private ACR

First-class catalogue resources (forms, refs, scopes — not raw HCL blobs):

| Resource | Typical scope | Notes |
|----------|---------------|-------|
| `azurerm_private_dns_zone` | Shared | Defaults to **Use existing** (hub DNS). Zone name `privatelink.azurecr.io`. |
| `azurerm_private_dns_zone_virtual_network_link` | Shared | Badge shows **VNet link · Shared hub** (or owning env). |
| `azurerm_private_endpoint` | Shared or env | ACR `registry` subresource; `private_dns_zone_group` on the PE (azurerm ~> 4.x). |

Starter **Private ACR** scaffolds VNet + PE subnet + Premium ACR (`public_network_access_enabled = false`) + PE + hub DNS (use existing) + VNet link + MI/AcrPull. Export goes to `modules/private_networking/`.


## Function App

First-class catalogue resource (forms, refs, scopes — not raw HCL):

| Resource | Typical scope | Notes |
|----------|---------------|-------|
| `azurerm_service_plan` | Shared or env | Already catalogued; use **Y1** for Consumption |
| `azurerm_linux_function_app` | Env (e.g. dev) | Plan + storage + runtime stack/version; app settings as key=value; optional identity (advanced) |
| `azurerm_storage_account` | Shared | Backend storage; emit uses `name` + `primary_access_key` |

UX stays short: pick plan, storage, runtime — not every Functions setting. Starter **Storage + Function App** scaffolds shared RG/storage + Y1 plan + Linux Function App (Node 20) scoped to **dev**. Export goes to `modules/app_service/` (with storage cross-module inputs).



## UX / a11y click-test path (PR)

Keyboard-only smoke path after `npm run dev`:

1. **Environment** — Tab to **Dev | Staging | Prod**; change tier with arrows; confirm **Tier:** badge updates. Fill project name; Tab to a starter; Enter. If resources already exist, confirm dialog traps focus; **Esc** cancels.
2. **Import existing** (still on Environment) — Tab to **Upload Terraform**; choose `.tf` / zip. Review table shows domain labels (not raw HCL). Arrow/Tab to toggle **Existing | Create** and scope Shared/env. Continue → **Replace all** / **Merge into current** / **Cancel** (Esc back). Lands on **Resources** with an imported instance selected.
3. **Continue to resources** — Header shows **Tier:** badge. Catalogue search has a visible **Search resources** label; rows show human labels + always-visible **+** (no hover-only add).
4. Add **Linux Function App** (short card) → form opens with **Existing | Create** at top; toggle both modes. Add **Private DNS Zone** → defaults **Existing**.
5. Toggle Existing/Create; fill an existing id/name field — hints use plain language (no `data.azurerm_…`).
6. **Export** — Tier badge still visible; open Live HCL / Files; Download ZIP. HCL remains edge-only (Export/Import).

Acceptance: keyboard can complete Environment → import review/confirm → Resources → add resource → toggle existing/create → export; Import is not a fourth main tab; no new catalogue types.

## Known gaps

- Export still emits one shared module tree (env differences are via tfvars knobs, not duplicated env-scoped HCL modules).
- Azure only.
- NSG rules are SSH/HTTP/HTTPS toggles.
- Key Vault RBAC beyond tenant/RBAC flag is minimal.
- Container App is single-container (no sidecars/Dapr).
- Container App secrets from Key Vault use `vault_uri + secrets/<name>` (versionless); create the KV secret out-of-band or add an `azurerm_key_vault_secret` resource yourself.
- Private Endpoint is ACR-focused (`registry` subresource); other PE targets not catalogued yet.
- System-assigned identity + AcrPull role assignment is not auto-wired (user-assigned path is).
- Module boundaries are fixed groupings.
- Terraform import is best-effort (not full HCL2); modules/for_each/complex expressions are skipped.
