# User guide

Walk: **open app → Project setup → Resources → Export**. Domain language throughout — you work with Environments and resources, not `.tf` trees.

## Open the app

```bash
docker compose up --build
# or: npm install && npm run dev
```

Open [http://localhost:3000](http://localhost:3000). No login.

Main steps in the header: **1. Environment → 2. Resources → 3. Export**. Environment opens on **Project setup** so the project name, region, naming prefix, tags, starter, and active Tier are established before resources are configured. The active **Tier** badge (Dev / Staging / Prod) stays visible after Environment.

The header also includes a **Resource guide** with searchable descriptions, usage guidance, security considerations, recommendations, module grouping, and build-stage context. It is a utility surface, not a fourth main step.

Use the **Project** menu to save a named browser draft or download a portable `.groko.json` project file. Open drafts and imported project files restore the editable domain model and start a fresh undo history. Project files are separate from **Download ZIP**, which generates infrastructure output for deployment.

---

## 1. Environment

Project setup is the first Environment surface. Set up the project and active tier before you add resources; the overview and environment management views remain available as secondary views.

### Project + tier

- Name, region, naming prefix, and tags.
- Required control: **Dev | Staging | Prod**. Switching tier filters what you see on Resources and stamps new hub DNS ownership.
- Env knobs (ACR SKU, Container App CPU/memory/replicas, ingress, naming suffix) differ meaningfully per tier — they drive `environments/*.tfvars` on export.

### Starters

Apply a starter to seed the graph (Blank, Web App + SQL, Storage + Function App, VNet + VM, ACR + Container Apps, Private ACR / Key Vault / SQL, …).

- **Empty canvas + non-Prod** — applies immediately.
- **Resources already present** — confirm **Replace all**, **Merge with starter**, or **Cancel** (Esc cancels; no silent wipe).
- **Prod** — always hits **Prod friction** (_This Environment is Production_), even on an empty canvas. Primary **Replace on Prod** (danger); Esc cancels.

### Import existing

**Import existing** lives on Environment (header **Upload Terraform** is the same edge action — not a fourth main tab).

1. **Upload** — one or more `.tf` / `.tfvars`, or a `.zip` of a Terraform root (client-side; JSZip for archives).
2. **Select profile**, when multiple root `.tfvars` files are present. Only the selected root profile supplies values; child-module `.tfvars` files are not profiles or module inputs.
3. **Review mapping** — domain table with type, name, **Existing | Create**, and **Shared vs env**. Choose **Edit** on a row to correct required fields, lookup values, references, and compatible selections. Field errors and **Continue** update as you edit. Collapsed **Couldn't map** lists skipped types with plain-language reasons.
4. **Confirm** — **Replace all** / **Merge into current** / **Cancel**. On **Prod**, Replace/Merge open Prod friction before commit.

Rules of thumb: data sources → **Existing**; resources → **Create**. Env-ish names/tags suggest env scope (toggle before apply). Profile selection resolves inputs; it does not override scope inference or make cross-environment references valid.

The editor uses only selected import-draft resources as reference targets, never the current project's resources. If mapping dropped a reference for scope safety, correct scope first, then explicitly choose a Shared or same-environment target. No scope is automatically promoted. Incompatible target/option pairs block **Continue** until corrected.

**Done** or **Esc** closes the editor and returns focus to its **Edit** button. Edits remain in the draft, including when deselecting and reselecting a resource. Existing lookup values and Create fields are kept separately. **Cancel** discards the entire draft; a new upload/profile starts fresh. Nothing changes in the project or its undo history until Replace/Merge is confirmed. On small screens, import is available under **Environment → Project setup → Upload Terraform**.

Uploaded local modules expand. Resource, data, and local-module `count` expressions that resolve to **0** emit nothing; **1** imports one instance. An indexed reference `[0]` binds only to that active counted instance. Unknown counts, counts above one, and invalid counts remain explicit skips. `for_each` still imports one module template for review, not every instance.

Static variable/local aliases, comparisons, boolean operators, parentheses, conditional expressions, and scalar `coalesce` are supported. `coalesce` requires known scalar arguments of one non-null type and selects the first non-null, non-empty value. Module outputs can supply references or interpolate known scalar values, such as a Resource Group name with a `-managed` suffix. Unknown values never select a branch or fall back to catalogue defaults for an explicitly supplied unresolved field.

Remote, missing, or dynamic module sources, unsupported providers, and unsupported catalogue types remain skipped. Client configuration is reported as a configuration lookup, not a deployable resource; Azure AzAPI is reported as an unsupported provider. General function evaluation (including `cidrsubnet`), dynamic blocks, and other complex expressions remain unsupported and appear in partial-mapping details. Review unresolved security, networking, identity, and retention settings before using an export. Missing required values block ordinary rows; `for_each` templates retain their explicit complete-after-import workflow. Import is best-effort, not a fully round-trippable Terraform evaluator.

---

## 2. Resources

Building blocks for the active Environment: **Shared** resources plus the current tier.

### List | Graph

Toggle **List | Graph** on Resources (not a fourth main tab). Both share the same selection and open the same **ResourceForm** in the side panel.

- **List** — catalogue + rows for Shared + active Environment.
- **Graph** — dependency nodes/edges from the Environment ref graph; cross-env-blocked refs are not drawn as valid edges. Header **+ Add** opens a catalogue drawer (stay on Graph — no flip to List).

### Empty states

When nothing is visible for Shared + active tier:

| View  | Heading                                 | Primary                                           | Secondary                         |
| ----- | --------------------------------------- | ------------------------------------------------- | --------------------------------- |
| List  | _No resources in this Environment yet._ | **Add from catalogue** (focuses catalogue search) | **Import existing** → Environment |
| Graph | _Nothing to show for this tier._        | **Add from catalogue** (opens drawer)             | **Import existing** → Environment |

Tier badge remains visible.

### Add, Existing | Create, Shared vs env

- Catalogue rows show **human labels** (Resource Group, Private DNS Zone, …). Always-visible **+** to add.
- Each instance is **Shared** (visible in every tier) or **scoped to one Environment**.
- Forms open with **Existing | Create**. Private DNS Zone defaults to **Existing** (shared hub DNS).
- Reference pickers only allow **shared + same-env** targets. Cross-env refs are rejected.
- Container Apps: Managed identity (recommended) or admin ACR auth; env vars / app secrets / optional HTTP scale rule.
- Function App + Application Insights are first-class cards (optional Insights reference on the Function App — not a settings dump).

### Shared hub DNS (“owned by”)

When a Private DNS zone is **Shared + Use existing** (hub):

- Badge: **Shared hub DNS · owned by {Environment}**
- VNet links: **VNet link · Shared hub · owned by {Environment}**

Owner is the Environment that created the hub link (stamped at create). **Prefer Existing never transfers ownership.** Read-only owner chip; secondary **Change owner…** confirms _Move hub ownership to {Environment}? Other Environments keep using this zone._ (Esc cancels). Optional Environments-panel callout when the active tier reuses a hub it does not own.

### Undo

Header / list **Undo / Redo**, plus `Cmd/Ctrl+Z` and `Shift+Cmd/Ctrl+Z` (or `Ctrl+Y`). History covers resources, selection, environments/scopes, and export folder-map overrides (~40 snapshots; value typing debounced).

---

## 3. Export

HCL appears only here (and on Import). Default tab is domain **Review**, not a code dump.

### Review changes

Chips + short lists from the Environment graph + export map:

- **Adds** — Create (`useExisting` false)
- **Updates** — folder-map overrides
- **Existing** — lookups (`useExisting` true)
- **Orphans** — resources with no module folder

Optional module-folder destination counts. **Download ZIP** is primary only when the orphan gate is clear.

### Folder structure / Map mode

**Folder structure** shows the live ZIP tree (`config.tf`, `modules/…`, env tfvars) derived from the graph + one `exportConfig` object. Click a path → which **resources** land there (domain info; no raw HCL).

**Map mode** — assign resources or domain groups to module folders before download. Defaults follow fixed module groupings; overrides are domain→folder only. Orphans listed clearly.

### Leave unmapped + Download ZIP

While orphans remain, Download stays secondary. To proceed without assigning them you must use **Leave unmapped…** and explicitly confirm — **never a silent drop** from the ZIP.

ZIP shape (edge output):

```
config.tf                 # versions + provider + partial backend "azurerm" {}
main.tf                   # module wiring
variables.tf
outputs.tf
environments/
  dev.tfvars / staging.tfvars / prod.tfvars
  backend.dev.hcl / backend.staging.hcl / backend.prod.hcl
modules/
  resource_group/ networking/ private_networking/ identity/ …
README.md
```

After download, init with env-specific backend config, e.g.:

```bash
terraform init -backend-config=environments/backend.dev.hcl
terraform plan  -var-file=environments/dev.tfvars
```

Edit `environments/backend.*.hcl` and fill `CHANGE_ME_*` secrets in tfvars before apply.

### Prod friction vs Export

Prod confirms for starter/import Replace|Merge stay on **Environment**. Export Review / orphan gate are separate — both must be respected.

---

## Catalogue highlights (what you can model)

| Area               | Examples                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Networking         | VNet, Subnet (App Environments delegation), NSG, Public IP, NIC                                                       |
| Private networking | Private Endpoint (ACR / Key Vault / SQL), Private DNS Zone, VNet link                                                 |
| Containers         | ACR, User-assigned identity, AcrPull / KV Secrets User roles, Log Analytics, Container App Environment, Container App |
| Apps               | Service Plan, Linux Web App, Linux Function App, Application Insights                                                 |
| Data / security    | Storage Account, Key Vault, SQL Server + Database                                                                     |
| Compute            | Linux VM                                                                                                              |

Private DNS + VNet link typically **Shared**; PE can be shared or env-scoped. Function App starter wires Insights on **dev** by default.

## Next

- Tone and “never show” rules → [UX language](ux.md)
- Invariants and adapters → [Architecture](architecture.md)
- Tests and adding types → [Developer guide](developer.md)
