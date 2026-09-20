# Groko Copilot pack

GitHub Copilot customization for **groko** (Azure Environment builder) — not Michael’s generic stack pack.

## Install (copy into groko)

From this pack root, merge into the **groko repo root** (`M-Lauritsen/groko`):

```bash
# from groko repo root
cp /path/to/groko-copilot-pack/AGENTS.md ./AGENTS.md
# Keep Next.js auto-block if present: merge carefully — this AGENTS.md is groko domain overview.
# Prefer: append a "## Groko domain agents" section if the Next.js agent-rules block must stay.

mkdir -p .github/agents .github/instructions .github/prompts
cp /path/to/groko-copilot-pack/.github/copilot-instructions.md .github/
cp /path/to/groko-copilot-pack/.github/agents/*.agent.md .github/agents/
cp /path/to/groko-copilot-pack/.github/instructions/*.instructions.md .github/instructions/
cp /path/to/groko-copilot-pack/.github/prompts/*.prompt.md .github/prompts/
```

Or rsync the `.github/` tree and place `AGENTS.md` / `README-COPILOT.md` at root.

**Suggested merge note for `AGENTS.md`:** groko’s current root `AGENTS.md` is the Next.js auto-generated agent-rules stub. Replace with this pack’s `AGENTS.md`, or keep the Next.js `BEGIN:nextjs-agent-rules` block at the top and append the groko domain content below it.

## Which agent first

Always open **`groko-orchestrator`** first. It classifies the ask and hands off (`send: false`) to domain / ui / export / infra / reviewer. Specialists implement; the orchestrator never does.

## applyTo globs (matched to inspected tree)

Inspected from `/workspace/groko` (and twin `/workspace/azure-tf-builder`):

| Instructions file | applyTo |
|-------------------|---------|
| `domain.instructions.md` | `src/lib/schema/**`, `src/lib/store/**`, `scripts/test-{invariants,prod-friction,empty-resources,hub-dns-ownership,history}.ts` |
| `ui.instructions.md` | `src/components/**/*.{ts,tsx}`, `src/app/**/*.{ts,tsx}` |
| `export-adapters.instructions.md` | `src/lib/generate/**`, `src/lib/import/**`, `src/components/export/**`, `scripts/test-{generate,export-map,graph-layout}.ts` |

Infra guidance lives on **`groko-infra`** (Dockerfile / Compose) — no separate instructions file required; Docker paths are repo-root `Dockerfile`, `docker-compose.yml`, `.dockerignore`.

## Assumptions

- Package name in `package.json` may still read `azure-tf-builder`; product name in agents/docs is **groko**.
- If a clone lacks `src/`, defaults above still apply (`src/**`, `scripts/**`, root Docker files).
- Compose runs the Next.js UI only — never treat it as an Azure catalogue type.

## Prompts (slash)

- `/slice-environment` — thin Environment-spine feature slice
- `/review-export` — Review changes / folder map / ZIP gate check
- `/add-catalogue-resource` — add a catalogue resource type end-to-end (domain → UI → emit)

## VS Code

Custom agents: `.github/agents/*.agent.md`  
Repo instructions: `.github/copilot-instructions.md` + `.github/instructions/*.instructions.md`  
Prompts: `.github/prompts/*.prompt.md`
