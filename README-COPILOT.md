# Groko Copilot pack

GitHub Copilot customization for **groko** — **already in this repo** (not an external install kit).

## Start here

1. Open the repo in VS Code / Copilot Chat.
2. Select **`groko-orchestrator`** (Groko Orchestrator).
3. Describe work in domain language, or run a slash prompt (`/slice-environment`, `/add-catalogue-resource`, `/review-export`).

Specialists: `groko-domain`, `groko-ui`, `groko-export`, `groko-infra`, `groko-reviewer`. The Orchestrator classifies and hands off; it does not implement.

## What’s in-repo

- `.github/copilot-instructions.md` — always-on rules  
- `.github/agents/` — custom agents + handoffs  
- `.github/instructions/` — path `applyTo` rules  
- `.github/prompts/` — slash prompts  
- `AGENTS.md` — project guidance (Next.js block may sit above groko content)

## Rules of the road

Domain-first: **Environment → Resources → Review/Export**. HCL is edge-only. Compose runs the web app — it is not an Azure catalogue type. Full contributor guide: [docs/developer.md](docs/developer.md#copilot--agents). UX voice: [docs/ux.md](docs/ux.md#how-agents-should-talk).
