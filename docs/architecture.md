# Architecture

groko keeps a **domain graph** in the browser and treats Terraform as **edge adapters** (import in, ZIP/HCL out). UI spine: **Environment → Resources → Export**.

## Domain vs edge

```
┌─────────────────────────────────────────────────────────┐
│  Domain                                                 │
│  Environment, ResourceInstance, ResourceScope,          │
│  Existing|Create, starters, hubOwnerEnvironmentId,      │
│  exportConfig (domain→folder overrides only)            │
│  src/lib/schema · src/lib/store                         │
└──────────────────────────┬──────────────────────────────┘
                           │
         ┌─────────────────┴─────────────────┐
         ▼                                   ▼
┌─────────────────────┐           ┌─────────────────────┐
│  Import adapter     │           │  Export adapter     │
│  HCL/ZIP → domain   │           │  domain → HCL/ZIP   │
│  src/lib/import     │           │  src/lib/generate   │
└─────────────────────┘           └─────────────────────┘
```

**Invariants of the split**

- Domain types carry **no Terraform concepts** as primary state. No raw HCL stored on `ResourceInstance`.
- UI speaks catalogue labels; `azurerm_*` is an implementation key / muted secondary text.
- Graph (List|Graph) reuses Environment ref deps (`deps.ts` / `graph-layout.ts`) and the same `ResourceForm` — no second detail schema.
- Docker Compose / Dockerfile run the **web app**; they are not catalogue resource types.

## Core domain shapes

| Type | Role |
|------|------|
| `Environment` | Tier id + displayName + knobs (tfvars drivers) |
| `ResourceInstance` | id, type, tfName, `useExisting`, values / existingValues, `scope`, optional `hubOwnerEnvironmentId` |
| `ResourceScope` | `{ kind: "shared" }` or `{ kind: "environment", environmentId }` |
| `ProjectState` | config + environments + activeEnvironmentId + resources + selection + `exportConfig` |
| `ResourceTypeDef` | Catalogue entry: fields, outputs, Prefer Existing |

Refs between resources are `{ resourceId, attr }` values — resolved at emit time.

## exportConfig

One exporter object on project state (included in undo snapshots):

```ts
interface ExportConfig {
  /** missing → MODULE_DEFS default; string → modules/<id>/; null → orphan */
  moduleByResourceId: Record<string, string | null>;
}
```

- Defaults: `MODULE_DEFS` / `moduleIdForType` in `generate/modules.ts`.
- Map mode writes **domain→folder** overrides only — not free-form HCL paths.
- Review chips (Adds / Updates / Existing / Orphans) and the live folder tree both resolve through `resolveExportMap`.
- **Download ZIP is blocked while orphans remain** until the user confirms **Leave unmapped…**.

Emit layout (edge): root `config.tf` / `main.tf` / `variables.tf` / `outputs.tf`, `environments/*.{tfvars,hcl}`, `modules/<id>/`.

## Invariants (Develops #19)

Regression suite: `npm run test:invariants` (also first in `npm test`). Named locks:

### 1. Shared vs env-scoped (`shared-vs-env-scoped`)

- Shared resources are visible in every Environment; env-scoped only in their Environment.
- Env-scoped **may** reference Shared; Shared **must not** reference env-scoped (cross-env leak).
- Reference pickers filter with the same rules (and exclude self).

### 2. Cross-env refs rejected (`cross-env-ref`)

- `canReference` is false across different env scopes.
- Pickers omit cross-env candidates.
- Graph omits or marks those edges invalid (`valid: false`) — not drawn as healthy deps.

### 3. Orphan blocks ZIP (`orphan-blocks-zip`)

- Resources with `moduleByResourceId[id] === null` (or unresolved orphan) appear in Review / Map.
- `canDownloadWithMap` is false until orphans are assigned **or** the user explicitly confirms Leave unmapped.
- Never a silent drop from the ZIP.

### 4. Prod Replace confirm required (`prod-replace-confirm`)

- When the active Environment is Prod, destructive starter apply and Import Replace|Merge cannot be silently skipped — including empty-canvas starter apply.
- See also Prod friction (#16) below; invariants assert the gate helpers stay honest.

### 5. Export folder-map golden (`export-folder-map-golden`)

- Stable ZIP file keys and critical HCL markers for a fixed Environment graph fixture.
- Guards module wiring / map resolution regressions without snapshotting the entire UI.

## Hub DNS ownership (Develops #20)

Shared hub Private DNS + VNet link:

- Owner Environment stamped at **create** (`hubOwnerEnvironmentId`).
- **Prefer Existing never transfers** ownership; reuse keeps the original owner.
- UI: **Shared hub DNS · owned by {Environment}** / **VNet link · Shared hub · owned by {Environment}**.
- Explicit **Change owner…** confirm to reassign; Esc cancels.
- Linked / “used by N Environments” derived from scopes + refs; optional callout when active tier reuses a hub it does not own.
- Locked by `scripts/test-hub-dns-ownership.ts` (also wired via empty-resources npm script path and full `npm test`).

## Prod friction (Develops #16)

Extra confirm when active Environment is Production (`id === "prod"`, displayName Prod/Production, or knobs tag `Environment=prod|production`):

| Action | Behaviour |
|--------|-----------|
| Starter apply | Always Prod dialog — even on empty canvas |
| Import Replace / Merge | Second confirm after choosing Replace or Merge |
| Dev / Staging | Unchanged (empty starter applies immediately; non-empty gets normal Replace|Merge) |

Copy: title *This Environment is Production*; primary **Replace on Prod** (danger); Esc cancels; Tier badge shown. Helpers in `store/prod-friction.ts`; UI `ProdFrictionDialog`. Separate from Export orphan gate.

## Undo model

History (~40 snapshots) covers resources, selection, environments/scopes, and **exportConfig**. Value typing debounced (~300ms). Starter apply, import merge/replace, use-existing toggles, and folder-map edits all push history.

## Known edge limits

- One shared module tree; per-env differences via tfvars knobs, not duplicated env module trees.
- Import expands uploaded local modules and imports one review template for `for_each`. A bounded adapter-only resolver uses the selected root profile, module arguments/defaults, and locals for static comparisons, booleans, conditionals, scalar `coalesce`, and templates. It never executes HCL or uses `eval`.
- Resource, data, and local-module counts support only resolved 0/1. Zero removes the block; one retains transient counted-instance identity so only `[0]` can bind. Unknown or larger counts are skipped explicitly. Root isolation, module aliases, Existing/Create, scope validation, and ownership remain domain boundaries; parser metadata never enters `ResourceInstance`.
- Module-output interpolation resolves only known scalar values, with cycle guards and scoped references. Remote, missing, or dynamic module sources, unsupported providers/types, general functions, and dynamic blocks remain unsupported. Partial mapping exposes unresolved fields and constructs; unresolved explicit fields do not inherit catalogue defaults. Client configuration lookups and unsupported Azure AzAPI operations have separate diagnostic labels. Import is not a complete Terraform evaluator or round-trip guarantee.
- PE catalogue: ACR / Key Vault / SQL only; Container App is single-container.

## Related

- [User guide](user-guide.md) — behaviour walk
- [Developer guide](developer.md) — add a catalogue type
- [UX](ux.md) — language and never-show rules
