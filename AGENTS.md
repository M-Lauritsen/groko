<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Groko agents

Product: **groko** — clickable Next.js app that builds **Azure Environments** and emits azurerm Terraform ZIPs at the edge.

## Stack overview
- **Runtime:** Next.js 16 App Router, React 19, TypeScript, Tailwind 4 — client-side generation (no auth).
- **Domain:** `src/lib/schema/` (catalogue, Environment helpers, types), `src/lib/store/` (project state, undo, Prod friction, hub DNS ownership).
- **Edge adapters:** `src/lib/generate/` (HCL, modules, export map, ZIP, deps/graph), `src/lib/import/` (parse → domain).
- **UI:** `src/components/project/` (Environment), `resources/` (List|Graph, catalogue, forms), `export/` (Review, folder map), `ui/`.
- **App shell:** `src/app/`, `src/components/AppShell.tsx`.
- **Run the app:** `docker compose up --build` or `npm run dev` — Compose is **app runtime only**.
- **Tests:** `npm test` → `scripts/test-*.ts` (invariants, export-map, generate, history, graph, prod-friction, empty-resources, hub-dns-ownership).

## Locked domain rules
1. Domain types have **no Terraform concepts** — HCL only in generate/import adapters.
2. UI spine is **Environment → Resources → Export**; Graph lives under Resources.
3. Resources are **Shared** or **env-scoped**; refs only to shared + same-env targets.
4. **Existing | Create** is domain state; Prefer Existing does not move hub DNS ownership.
5. Export default is **Review changes** (domain summary); ZIP gated on orphans.
6. Prod friction for destructive starter/import applies.

## Which agent to pick
Start with **`groko-orchestrator`**. It routes; it never implements.

| Agent | Owns |
|-------|------|
| `groko-orchestrator` | Classify & hand off |
| `groko-domain` | Schema, store, invariants, PE/DNS, scopes |
| `groko-ui` | React Environment / Resources / Graph / Export chrome |
| `groko-export` | Import/export adapters, Review, folder map, ZIP gates |
| `groko-infra` | Dockerfile / Compose for running groko |
| `groko-reviewer` | PR review vs domain rules (read-only) |

## Path map (real repo)
```
src/lib/schema/     # ResourceTypeDef, Environment, starters
src/lib/store/      # ProjectContext, history, prod-friction, hub-dns-ownership
src/lib/generate/   # hcl, modules, export-map, zip, deps, graph-layout
src/lib/import/     # parse, mapToProject, orphans
src/components/     # project | resources | export | ui | history
Dockerfile, docker-compose.yml, .dockerignore
scripts/test-*.ts
```

