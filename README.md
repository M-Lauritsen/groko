# groko

**groko** builds **Azure Environments** in the browser and emits **azurerm Terraform** as a ZIP at the edge. No auth. Generation and import are entirely client-side.

Domain spine (always):

**Environment → Resources → Export**

You model Shared and env-scoped resources (Existing | Create), review what will land in the ZIP, then download. HCL lives only on Import/Export adapters — not in the primary UI.

## Documentation

| Doc | Audience |
|-----|----------|
| [User guide](docs/user-guide.md) | Walk Environment → Resources → Export (Import, Review, ZIP) |
| [UX language](docs/ux.md) | Domain labels, empty states, a11y, what we never show |
| [Developer guide](docs/developer.md) | Stack, tests, how to add a catalogue type |
| [Architecture](docs/architecture.md) | Domain vs edge, `exportConfig`, invariants |

README is the front door; deep detail lives in `docs/`.

## Quick start

### Docker Compose (recommended)

Requires Docker with Compose v2. One service only — the web UI (not an Azure catalogue type).

```bash
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000). Stop with `docker compose down`.

| | |
|---|---|
| Port | **3000** |
| URL | http://localhost:3000 |
| Start | `docker compose up --build` |
| Stop | `docker compose down` |

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

`npm run build` / `npm run start` also work on the host without Docker.

## What you do in the app

1. **Environment** — project name / region / prefix / tags, **Dev | Staging | Prod** tier, starters, and **Import existing** (Upload Terraform). Tier badge stays visible after you leave this step.
2. **Resources** — catalogue of Azure building blocks. Toggle **List | Graph** (not a fourth main tab). Each instance is **Shared** or scoped to one Environment; forms open with **Existing | Create**.
3. **Export** — default **Review changes** (domain summary), optional folder map, then **Download ZIP**. Live HCL is secondary.

Newcomer path: Compose up → set Environment → add or import resources → Review → ZIP. Contributor path: see [how to add a catalogue type](docs/developer.md#how-to-add-a-catalogue-type).

## Copilot / agents (in-repo)

The Copilot pack ships **in this repo** under `.github/` (agents, instructions, prompts) plus root `AGENTS.md` / `README-COPILOT.md`.

**Start with the Orchestrator** (`groko-orchestrator`). It classifies and hands off; specialists implement. Do not treat Compose as a catalogue resource, and do not invent raw `azurerm_*` dumps in UI copy.

## Known gaps (short)

- One shared module tree; env differences are tfvars knobs, not duplicated env HCL modules.
- Azure only; PE covers ACR / Key Vault / SQL; import is best-effort (modules / `for_each` / complex HCL skipped).
- See [architecture](docs/architecture.md) for invariants and edge boundaries.
