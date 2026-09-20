# Azure TF Builder

Clickable Next.js app that generates **Azure (azurerm) Terraform** project templates with a modular layout, managed-identity ACR pull, and VNet-integrated Container Apps.

No auth. Generation is entirely client-side.

## Quick start

### Local (npm)

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
npm run build
npm test
```

### Docker Compose

Run the web UI in a container (production image). Requires Docker with Compose v2.

```bash
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000).

```bash
docker compose down
```

| | |
|---|---|
| Port | **3000** |
| URL | http://localhost:3000 |
| Start | `docker compose up --build` |
| Stop | `docker compose down` |

`npm run build` / `npm run start` still work on the host without Docker.


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
2. **Resources** — each instance is **Shared** or **scoped to one environment**. Toggle **List | Graph** (not a fourth main tab): Graph reuses the Environment ref graph (`deps.ts`) for nodes/edges, omits cross-env-blocked edges, and shares `selectedResourceId` with List so the same **ResourceForm** opens in the side panel. Empty List/Graph views use headed domain copy with primary **Add from catalogue** and secondary **Import existing** (Environment). On **Graph**, an always-visible **+ Add** control opens a catalogue drawer (stay on Graph — no List flip); after add the new node is selected and ResourceForm shows. Forms open with **Existing | Create** (Private DNS defaults Existing). Reference pickers only allow shared + same-env targets. Catalogue shows human labels (no raw `azurerm_*` on primary rows).
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

### Review changes (Export default)

Default Export tab (ahead of Live HCL). Domain summary only — **no HCL dump**.

- Chips + short lists from the Environment graph + export map: **Adds** (Create / `useExisting` false), **Updates** (folder-map overrides), **Existing** lookups (`useExisting` true), **Orphans** / leave-unmapped.
- Optional **module folder destination** counts (which domain folders receive how many resources).
- **Download ZIP** is primary only when the orphan gate is clear. While orphans remain, Download stays secondary and **Leave unmapped…** requires explicit confirm (same gate as Map mode — never a silent drop).
- Prod friction for starter/import Replace|Merge stays on Environment (Develops #16) — separate from this review.

### Folder-structure map (Export only)

Lives on **Export** — not Resources, not a `.tf` tree in primary nav.

- **Folder structure** panel shows the live ZIP tree (`config.tf`, `modules/…`, env tfvars) derived from the Environment graph + one `exportConfig` object.
- Click a folder/file → see which **resources** land there (short domain info; no raw HCL).
- Optional **Map mode**: assign resources or domain groups to module folders before download. Defaults reuse `MODULE_DEFS` / `generateProject` grouping; overrides are **domain→folder** only (stored in `exportConfig.moduleByResourceId`, included in undo snapshots).
- **Orphans** (resources with no folder) are listed clearly. **Download ZIP is blocked while orphans remain** (Review + Map). To proceed without them you must use **Leave unmapped…** and explicitly confirm — never a silent drop from the ZIP.
- Live HCL / Files preview and Download ZIP both honour the map. HCL stays edge-only (Review never shows HCL).

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

- **Undo / Redo** — header and resource-list controls, plus `Cmd/Ctrl+Z` and `Shift+Cmd/Ctrl+Z` (or `Ctrl+Y`). History keeps ~40 snapshots of resources + selection + **environments/scopes** + **exportConfig** (folder map overrides); value typing is debounced (~300ms) so undo is not character-by-character. Snapshots cover add/remove, value edits, use-existing toggles, import merge/replace, starter apply, and environment knob edits.
- **Starter apply** — empty canvas applies immediately (non-Prod). If resources already exist, a confirm offers **Replace all**, **Merge with starter**, or **Cancel** (no silent wipe).
- **Prod friction** (Develops #1) — when the active **Environment** is Prod (`id === "prod"`, displayName Prod/Production, or knobs tag `Environment=prod|production`), destructive apply needs an extra confirm: starter apply (even on an empty canvas), and Import **Replace all** / **Merge**. Dialog title *This Environment is Production*; primary **Replace on Prod** (danger); Esc cancels; Tier badge shown. Dev/Staging unchanged.
- **Domain invariants** (`npm run test:invariants`, also in `npm test`) — regression locks for: shared vs env-scoped visibility/`canReference`; cross-env refs rejected (pickers + graph `valid:false`); orphan ZIP download blocked until Leave unmapped confirm; Prod starter/import Replace|Merge cannot be silently skipped; export folder-map golden (stable file keys + critical HCL markers).
- **Shared-hub DNS ownership** (Develops #2) — when a Private DNS zone is **Shared + Use existing** (hub), list/form/graph show **Shared hub DNS · owned by {Environment}**; VNet links show **VNet link · Shared hub · owned by {Environment}**. Owner is the Environment that created the hub link (stamped at create; Prefer Existing never transfers). Read-only owner chip; secondary **Change owner…** confirms *Move hub ownership to {Environment}? Other Environments keep using this zone.* (Esc cancels). Linked Environments / “used by N Environments” derived from scopes + refs. Optional Environments-panel callout when the active tier reuses a hub it does not own. No new catalogue types; Prefer Use existing stays default.
- **Stronger empty states** (Develops #3) — when List/Graph have no visible resources (Shared + active Environment), a headed empty state explains next steps in domain language (no `.tf` / Terraform jargon). Primary CTA **Add from catalogue** (List focuses the catalogue search; Graph opens the catalogue drawer). Secondary link **Import existing** returns to the Environment step. Tier badge stays visible. No new catalogue types.

## Architecture

```
src/lib/schema/     # ResourceTypeDef catalogue + starters
src/lib/generate/   # HCL emitters, module grouping, export folder map, review summary, ZIP
src/lib/import/     # Client-side HCL parse → ResourceInstance[]
src/lib/store/      # React project state + undo history + starter apply
src/components/     # Environment / catalogue / forms / dependency graph / export (Review + map)
scripts/test-invariants.ts · test-generate.ts · test-export-map.ts · test-history.ts · test-graph-layout.ts · test-prod-friction.ts · test-empty-resources.ts · test-hub-dns-ownership.ts
```

## Catalogue highlights

Private networking (first-class catalogue resources, not raw HCL):

- `azurerm_private_endpoint` — one PE type for ACR (`registry`), Key Vault (`vault`), or SQL (`sqlServer`); emits `private_service_connection` + optional `private_dns_zone_group` (azurerm ~> 4.x; no separate A record).
- `azurerm_private_dns_zone` — defaults to **Use existing** (shared hub DNS); create is secondary. Zones: `privatelink.azurecr.io`, `privatelink.vaultcore.azure.net`, `privatelink.database.windows.net`.
- `azurerm_private_dns_zone_virtual_network_link` — typically **Shared**; list/graph badge shows `VNet link · Shared hub · owned by {Environment}` (owner stamped at create; Prefer Existing does not move it).

Scope: DNS zone + VNet link default **shared**; PE can be shared or env-scoped. Reference pickers still block cross-env refs.



Containers + Identity: `azurerm_container_registry`, `azurerm_user_assigned_identity`, `azurerm_role_assignment` (AcrPull / Key Vault Secrets User), `azurerm_log_analytics_workspace`, `azurerm_container_app_environment` (optional `infrastructure_subnet_id` + workload profile), `azurerm_container_app` (MI or admin registry auth, **env vars**, **app secrets** with plain or Key Vault refs, **HTTP scale rule**). Subnets support `Microsoft.App/environments` delegation.

## Private endpoints (ACR / Key Vault / SQL)

Same domain shape for all three — first-class catalogue resources (forms, refs, scopes — not per-type HCL blobs):

| Resource | Typical scope | Notes |
|----------|---------------|-------|
| `azurerm_private_dns_zone` | Shared | Defaults to **Use existing** (hub DNS). Badge: **Shared hub DNS · owned by {Environment}**. Zones: `privatelink.azurecr.io` (ACR), `privatelink.vaultcore.azure.net` (KV), `privatelink.database.windows.net` (SQL). |
| `azurerm_private_dns_zone_virtual_network_link` | Shared | Badge shows **VNet link · Shared hub · owned by {Environment}**. Explicit **Change owner…** to reassign. |
| `azurerm_private_endpoint` | Shared or env | Subresource `registry` / `vault` / `sqlServer`; target ref ACR \| KV \| SQL; `private_dns_zone_group` on the PE (azurerm ~> 4.x). |

| Target | Public access knob | Starter |
|--------|--------------------|---------|
| ACR (Premium) | `public_network_access_enabled` on registry | **Private ACR** (+ MI/AcrPull) |
| Key Vault | `public_network_access_enabled` on vault | **Private Key Vault** |
| SQL Server | `public_network_access_enabled` on server | **Private SQL** |

Export PE + DNS + VNet link → `modules/private_networking/`; KV → `modules/security/`; SQL → `modules/database/`; ACR → `modules/container_registry/`.


## Function App + Application Insights

First-class catalogue resources (forms, refs, scopes — not raw HCL):

| Resource | Typical scope | Notes |
|----------|---------------|-------|
| `azurerm_service_plan` | Shared or env | Already catalogued; use **Y1** for Consumption |
| `azurerm_linux_function_app` | Env (e.g. dev) | Plan + storage + runtime; optional **Application Insights** reference (same spine as other refs); app settings as key=value; optional identity (advanced) |
| `azurerm_application_insights` | Env (e.g. dev) | Own catalogue card — name, RG, location, application_type, optional LAW `workspace_id` (reuse when present). Existing|Create on this card. |
| `azurerm_storage_account` | Shared | Backend storage; emit uses `name` + `primary_access_key` |
| `azurerm_log_analytics_workspace` | Shared | Already catalogued; optional link from App Insights for workspace-based mode |

UX stays short: pick plan, storage, runtime, and optionally wire Function App → App Insights via the reference picker — not every Functions / insights_* setting. When linked, emit uses azurerm 4.x `application_insights_connection_string` + `application_insights_key` from the Insights outputs.

Starter **Storage + Function App** scaffolds shared RG/storage + Y1 plan + Linux Function App (Node 20) + Application Insights scoped to **dev** (Function wired to Insights). Export goes to `modules/app_service/` (with storage cross-module inputs).



## UX / a11y click-test path (PR)

Keyboard-only smoke path after `npm run dev`:

1. **Environment** — Tab to **Dev | Staging | Prod**; change tier with arrows; confirm **Tier:** badge updates. Fill project name; Tab to a starter; Enter. If resources already exist, confirm dialog traps focus; **Esc** cancels. Switch to **Prod**, apply a starter → Prod friction dialog (*This Environment is Production*, Tier badge, **Replace on Prod** / **Merge with starter** / **Cancel**); Esc cancels; no silent apply on empty Prod either.
2. **Import existing** (still on Environment) — Tab to **Upload Terraform**; choose `.tf` / zip. Review table shows domain labels (not raw HCL). Arrow/Tab to toggle **Existing | Create** and scope Shared/env. Continue → **Replace all** / **Merge into current** / **Cancel** (Esc back). On **Prod**, Replace/Merge opens the Prod friction step before commit. Lands on **Resources** with an imported instance selected.
3. **Continue to resources** — Header shows **Tier:** badge. Catalogue search has a visible **Search resources** label; rows show human labels + always-visible **+** (no hover-only add).
4. **List | Graph** — Tab to the Resources view toggle. With an empty canvas, List shows heading *No resources in this Environment yet.* with primary **Add from catalogue** (focuses catalogue search) and secondary **Import existing** (Environment step); Graph shows *Nothing to show for this tier.* with the same primary (opens catalogue drawer) and Import link. Tier badge remains visible. With resources: nodes/rows are shared + active-env (Existing/Create + Shared vs env styling). Arrow/Tab to a node; **Enter** selects — the same **ResourceForm** opens in the side panel. On Graph, header **+ Add** also opens the catalogue drawer (Esc closes). Add a type — stay on Graph; selection syncs. Switch back to **List**; selection stays. Cross-env-blocked refs are not drawn as valid edges. Undo still works.
5. Add **Application Insights** (own card beside Function Apps) → **Existing | Create**; optionally link LAW. Add **Linux Function App** → optional **Application Insights** reference picker (not a settings dump). Add **Private DNS Zone** → defaults **Existing**.
6. Toggle Existing/Create; fill an existing id/name field — hints use plain language (no `data.azurerm_…`).
7. **Export** — Tier badge still visible; default tab is **Review changes** (chips: adds / updates / Existing / orphans — no HCL). Confirm orphan list blocks **Download ZIP** (primary only when gate clear) until assigned or you confirm **Leave unmapped…**. Open **Folder structure**; toggle **Map mode**; reassign a resource or domain group. Open Live HCL / Files; Download ZIP. HCL remains edge-only (Export/Import). Prod starter/import Replace still hits Prod friction on Environment first.

Acceptance: keyboard can complete Environment → import review/confirm → Resources → List|Graph selection sync → Graph **+ Add** catalogue drawer (stay on Graph) → add resource → toggle existing/create → export; on Prod, starter/import Replace|Merge require Prod friction (Esc cancels); Import / Graph are not a fourth main tab; no new catalogue types; Graph reuses ResourceForm (no second detail schema).

## Known gaps

- Export still emits one shared module tree (env differences are via tfvars knobs, not duplicated env-scoped HCL modules).
- Azure only.
- NSG rules are SSH/HTTP/HTTPS toggles.
- Key Vault RBAC beyond tenant/RBAC flag is minimal.
- Container App is single-container (no sidecars/Dapr).
- Container App secrets from Key Vault use `vault_uri + secrets/<name>` (versionless); create the KV secret out-of-band or add an `azurerm_key_vault_secret` resource yourself.
- Private Endpoint covers ACR / Key Vault / SQL only (`registry` / `vault` / `sqlServer`); other PE targets not catalogued yet.
- System-assigned identity + AcrPull role assignment is not auto-wired (user-assigned path is).
- Module folder defaults are fixed groupings; Map mode can override domain→folder before download.
- Terraform import is best-effort (not full HCL2); modules/for_each/complex expressions are skipped.
