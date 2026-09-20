# Developer guide

How to run, test, and extend groko without spelunking the whole tree. Product language stays domain-first ([UX](ux.md)); HCL stays in edge adapters ([Architecture](architecture.md)).

## Stack

| Layer | Tech |
|-------|------|
| App | Next.js 16 (App Router), React 19, TypeScript, Tailwind 4 |
| Runtime | Client-side generation — no auth |
| ZIP / archives | JSZip, file-saver |
| Container | Multi-stage `Dockerfile` (`output: "standalone"`), `docker-compose.yml` (app only) |

Package name in `package.json` may still read `azure-tf-builder`; product name in docs/agents is **groko**.

## Layout

```
src/lib/schema/     # ResourceTypeDef catalogue, Environment helpers, types, starters
src/lib/store/      # ProjectContext, undo history, Prod friction, hub DNS ownership, empty copy
src/lib/generate/   # HCL emitters, MODULE_DEFS, export map, ZIP, deps, graph layout
src/lib/import/     # Parse HCL → ResourceInstance[] (adapter)
src/components/     # project/ (Environment) | resources/ | export/ | ui/ | history/
src/app/            # Next.js shell
scripts/test-*.ts   # invariants + generate / map / history / graph / prod / empty / hub DNS
Dockerfile, docker-compose.yml, .dockerignore
```

## Scripts

```bash
npm install
npm run dev          # http://localhost:3000
npm run build && npm run start
npm test             # full suite (see below)
npm run lint

docker compose up --build   # production image on :3000
```

### Tests (`npm test`)

Runs, in order:

| Script | Locks |
|--------|--------|
| `test-invariants.ts` | Shared vs env, cross-env refs, orphan ZIP gate, Prod confirm, export folder-map golden |
| `test-export-map.ts` | `exportConfig` / orphans / folder tree |
| `test-generate.ts` | HCL / module emit markers |
| `test-graph-layout.ts` | Graph nodes/edges vs visibility |
| `test-history.ts` | Undo snapshots (incl. exportConfig) |
| `test-prod-friction.ts` | Prod starter/import gating |
| `test-empty-resources.ts` | Empty-state copy / CTAs |
| `test-hub-dns-ownership.ts` | Hub owner stamp / Prefer Existing / reassign |

Targeted: `npm run test:invariants`, `test:generate`, `test:export-map`, `test:history`, `test:graph`, `test:prod-friction`, `test:empty-resources`.

## How to add a catalogue type

End-to-end checklist so a contributor can add a type **without reading the whole source**. Follow domain → UI → emit; finish with tests.

### 1. Domain (`src/lib/schema/`)

1. Add a `ResourceTypeDef` in `resources.ts`:
   - `type` — azurerm type id (edge key only)
   - `label`, `category`, `description`, `icon` — **human** label for catalogue/forms
   - `fields` — `FieldDef`s (`string` | `number` | `boolean` | `select` | `tags` | `list` | `reference` | `sensitive` | …)
   - `outputs` — attributes others can reference (`id`, `name`, `connection_string`, …)
   - `defaultName`, optional `dataSourceType`, optional `preferUseExisting` (hub-like DNS)
   - Mark `existingKey` on fields collected when Existing; use `hclKey` only when the HCL argument name differs
2. Default **scope**: add the type to `ENV_SCOPED_DEFAULT_TYPES` in `environments.ts` if new instances should be env-scoped; otherwise Shared is fine.
3. Optional **starter** in `starters.ts` (wire refs with `{ resourceId, attr }`, stamp hub owner via normal create path).
4. **Do not** put Terraform concepts on domain types — no raw HCL strings on `ResourceInstance`.

### 2. UI (usually automatic)

Catalogue, ResourceForm, and ReferencePicker render from `FieldDef`. Check:

- Label reads well in catalogue search / Graph drawer.
- Existing | Create and Shared vs env behave; Prefer Existing if set.
- Reference pickers list only eligible Shared + same-env targets.
- No new main tab; no Compose-as-catalogue entry.

### 3. Export / import adapters (`src/lib/generate/`, `src/lib/import/`)

1. Map the type into a module folder via `MODULE_DEFS` / `moduleIdForType` in `modules.ts` (or accept `modules/other` until you add a folder).
2. Ensure emit path in `hcl.ts` (and any type-specific extras) covers required arguments and Existing → data source shape.
3. Import: extend `mapToProject` if the type should round-trip; otherwise it stays in **Couldn't map** with a clear reason — that is OK.
4. Folder-map overrides remain domain→folder in `exportConfig.moduleByResourceId` only.

### 4. Tests

- Catalogue presence / defaults as needed in generate or invariants fixtures.
- Ref eligibility if the type participates in Shared↔env rules.
- Generate golden markers for critical HCL when emit is non-trivial.
- If you touch Prod, orphans, hub DNS, or empty states — extend the matching `scripts/test-*.ts`.

### 5. Out of scope unless asked

- New spine tabs, Compose-as-infra catalogue types, inventing unverified azurerm schemas, storing HCL on instances.

### Smoke after your change

```bash
npm test
npm run dev   # keyboard: Environment → add type → Existing|Create → Export Review → ZIP
```

## Copilot / agents

The Copilot pack **already lives in this repo**. You do not copy it from elsewhere. Start here: [README-COPILOT.md](../README-COPILOT.md) → open **`groko-orchestrator`** in Copilot Chat.

### Layout

| Path | Role |
|------|------|
| `.github/copilot-instructions.md` | Always-on repo rules (domain-first, HCL edge-only) |
| `.github/agents/groko-*.agent.md` | Custom agents with handoffs |
| `.github/instructions/*.instructions.md` | Path-scoped rules (`applyTo`) |
| `.github/prompts/*.prompt.md` | Slash prompts in VS Code |
| `AGENTS.md` | Cross-agent project guidance (keeps Next.js block if present) |

### Agents (who does what)

| Agent | Owns | Never |
|-------|------|--------|
| **`groko-orchestrator`** | Classify ask → hand off one specialist | Implement product code |
| **`groko-domain`** | Schema, store, Environment graph, refs, Existing\|Create, Shared vs env, PE/DNS ownership, invariants | Raw HCL in domain types |
| **`groko-ui`** | Environment → Resources (List\|Graph) → Export UI, a11y, domain labels | Fourth main tab / `.tf` browser |
| **`groko-export`** | Import/export adapters, Review changes, folder map, orphans, ZIP gates | Primary HCL narrative / silent orphan drops |
| **`groko-infra`** | Dockerfile + Compose to **run the web app** | Azure catalogue / TF modules |
| **`groko-reviewer`** | Read-only PR review vs spine + invariants | Shipping fixes |

Handoffs use `send: false` — you approve the brief before the specialist runs.

### Path instructions (`applyTo`)

| File | Applies when you work in |
|------|--------------------------|
| `domain.instructions.md` | `src/lib/schema/**`, `src/lib/store/**`, invariant/Prod/hub/history scripts |
| `ui.instructions.md` | `src/components/**`, `src/app/**` |
| `export-adapters.instructions.md` | `src/lib/generate/**`, `src/lib/import/**`, `src/components/export/**`, generate/export/graph scripts |

### Slash prompts

| Prompt | Use for |
|--------|---------|
| `/slice-environment` | Thin feature along Environment → Resources → Export (routes via Orchestrator) |
| `/add-catalogue-resource` | End-to-end new catalogue type (domain → UI → emit) |
| `/review-export` | Export-edge audit (Review, folder map, orphans, ZIP gates) |

### Non‑negotiables for agents

Same as product rules — see [UX](ux.md) and [Architecture](architecture.md):

1. Speak **Environment / Resources / Refs / Review / Export** — not “edit the `.tf`”.
2. HCL stays at the **edge** (import/export adapters). Never store raw HCL on instances.
3. Prefer Existing **does not** transfer hub DNS ownership; reassign is explicit.
4. Prod confirms (#16), orphan ZIP gate (#13/#22), five #19 invariants — do not regress.
5. Compose = how you **run groko**, not a catalogue resource.

### Quick start for contributors

1. Open Copilot Chat → select **Groko Orchestrator**.
2. Describe the ask in domain language (or use a slash prompt).
3. Accept the handoff to the specialist; keep changes thin and tested (`npm test`).

## Related

- [User guide](user-guide.md) — product walk
- [Architecture](architecture.md) — invariants #19 / hub #20 / Prod #16
