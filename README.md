# Project Context Platform

Local-first project memory, documentation retrieval, and MCP tooling for
AI-assisted software teams.

Project Context Platform indexes your project docs and source files, extracts
stable IDs, stores searchable context, records durable memory events, and exposes
that context through a REST API, MCP server, CLI, and small web UI.

It is designed for teams that want coding agents to work from canonical project
context instead of guessing from whatever files happen to be open.

## What It Does

- Registers one or more local projects.
- Keeps each project's generated state in that project's own `.project-context/`
  directory.
- Indexes documentation and source files into searchable chunks.
- Extracts stable IDs such as `REQ-AUTH-001`, `ADR-PROF-0003`, and
  `TASK-HIRING-001`.
- Supports legacy ADR aliases such as `ADR 0003`.
- Provides MCP tools for Cursor and other agent clients.
- Records memory events for decisions, requirement changes, implementation
  summaries, reviews, and approvals.
- Provides a web UI for browsing projects, ingestion jobs, indexed documents,
  ID registry entries, memory, approvals, settings, and tool-call logs.

## Architecture

```text
packages/core        Domain types, config, ingestion, retrieval, memory services
packages/infra       SQLite stores, JSONL logs, HTTP/local adapters
packages/api         Fastify REST API
packages/mcp-server  MCP stdio server for agent tools
packages/cli         Project registration, ingestion, validation CLI
packages/web         React/Vite operator UI
services/lightrag    Python HTTP sidecar for document retrieval
services/graphiti    Python HTTP sidecar for memory/Graphiti contract
docs                 Handover, contracts, and documentation guidelines
```

Default runtime flow:

```text
CLI / REST API / MCP / Web UI
  -> core services
  -> infra adapters
  -> LightRAG sidecar at http://127.0.0.1:9621
  -> Graphiti sidecar at http://127.0.0.1:8091
```

## Requirements

- Node.js 22.5+ with npm. Node.js 24+ is recommended because the project uses
  Node's experimental `node:sqlite` API.
- Docker and Docker Compose.
- Optional: `OPENAI_API_KEY` for LLM-backed sidecar behavior.

## Quick Start

Install dependencies:

```bash
npm install
cp .env.example .env
```

Start the sidecars:

```bash
docker compose up -d neo4j lightrag graphiti
docker compose ps
```

Start the API:

```bash
npm run api:dev
```

Start the web UI in another terminal:

```bash
npm run --workspace @pcp/web dev
```

Open:

```text
http://127.0.0.1:5173
```

Health check:

```bash
curl http://127.0.0.1:4318/health
```

## npm Package

This repository is prepared to publish as a single npm package:

```text
@emipac/project-context-platform
```

The package exposes three executables:

```bash
project-context       # CLI
project-context-mcp   # MCP stdio server
project-context-api   # REST API server
```

Use without installing:

```bash
npx @emipac/project-context-platform projects list
```

Or install globally:

```bash
npm install -g @emipac/project-context-platform
```

Then run:

```bash
project-context projects list
project-context-mcp
project-context-api
```

The package includes compiled runtime entrypoints, docs, sidecar source,
`.env.example`, and `docker-compose.yml`. It intentionally does not include
generated local state, `spdd/`, or `requirements/`.

Maintainer release instructions live in [docs/releasing.md](docs/releasing.md).

## Register and Ingest a Project

Register the current repository:

```bash
npm run cli -- projects add --root "$PWD" --project-id pcp
```

Run full ingestion:

```bash
npm run cli -- ingest --project-id pcp --confirmed
```

Validate stable IDs:

```bash
npm run cli -- validate-ids --project-id pcp
```

List projects:

```bash
npm run cli -- projects list
```

Remove a registered workspace from the catalog/registry and purge platform-managed indexes (requires `--confirmed`). Source repository files outside `.project-context/` are not deleted:

```bash
npm run cli -- projects delete --project-id pcp --confirmed
```

To also remove generated artifacts such as `metadata.sqlite`, `config.yml`, and tool-call logs under `.project-context/` for that repository root:

```bash
npm run cli -- projects delete --project-id pcp --confirmed --delete-project-context-dir
```

## Add External Projects

You can manage external repositories while keeping each one isolated:

```bash
npm run cli -- projects add \
  --root "/absolute/path/to/other-project" \
  --project-id other-project

npm run cli -- ingest --project-id other-project --confirmed
```

The platform catalog is stored at:

```text
project-catalog.json
```

Each registered project owns:

```text
<project>/.project-context/config.yml
<project>/.project-context/global-registry.json
<project>/.project-context/metadata.sqlite
<project>/.project-context/tool-calls.jsonl
```

`project-catalog.json` and `.project-context/` are generated local state and are
ignored by git.

For reusable commands inside an external project during local development, add
scripts that call this platform repo with
`npm --prefix /absolute/path/to/project-context-platform`.
See the full handover guide for a copy-paste template.

## Cursor / MCP Setup

Example Cursor MCP configuration for a cloned local checkout:

```json
{
  "mcpServers": {
    "project-context-platform": {
      "command": "npm",
      "args": [
        "run",
        "mcp:dev",
        "--prefix",
        "/absolute/path/to/project-context-platform"
      ],
      "env": {
        "PCP_ADAPTER_MODE": "http",
        "PCP_PROJECT_CATALOG_PATH": "/absolute/path/to/project-context-platform/project-catalog.json",
        "LIGHTRAG_BASE_URL": "http://127.0.0.1:9621",
        "GRAPHITI_BASE_URL": "http://127.0.0.1:8091"
      }
    }
  }
}
```

Example Cursor MCP configuration using the published npm package:

```json
{
  "mcpServers": {
    "project-context-platform": {
      "command": "npx",
      "args": [
        "-y",
        "@emipac/project-context-platform",
        "project-context-mcp"
      ],
      "env": {
        "PCP_ADAPTER_MODE": "http",
        "PCP_PROJECT_CATALOG_PATH": "/absolute/path/to/project-catalog.json",
        "LIGHTRAG_BASE_URL": "http://127.0.0.1:9621",
        "GRAPHITI_BASE_URL": "http://127.0.0.1:8091"
      }
    }
  }
}
```

After changing MCP configuration or environment variables, restart the MCP server
from Cursor's MCP settings.

Useful MCP tools include:

- `search_docs`
- `get_document`
- `get_spec_context`
- `get_related_code`
- `get_requirement_sources`
- `get_documentation_guidelines`
- `remember_decision`
- `remember_requirement_change`
- `remember_implementation_summary`
- `remember_review`
- `ingest_changed_files`
- `validate_ids`

Broad search tools return compact previews. Use `get_document` or
`get_spec_context` when an agent needs full content.

## Configuration

Copy `.env.example` to `.env` and adjust as needed.

Important defaults:

```env
PCP_HOST=127.0.0.1
PCP_PORT=4318
PCP_PROJECT_CATALOG_PATH=project-catalog.json
PCP_ADAPTER_MODE=http
LIGHTRAG_BASE_URL=http://127.0.0.1:9621
GRAPHITI_BASE_URL=http://127.0.0.1:8091
GRAPHITI_ENABLE_CORE=false
OPENAI_API_KEY=
```

Project-level indexing is configured in:

```text
<project>/.project-context/config.yml
```

Example for legacy ADR support:

```yaml
ids:
  project_domain: PROF
  legacy_patterns:
    adr_headings: true
    adr_filenames: true
    use_cases: false
    plan_items: false
```

With this config, `# ADR 0003: Hybrid Search Architecture` can be resolved as
`ADR-PROF-0003` while keeping `ADR 0003` as an alias.

## Local Adapter Mode

Use local mode when Docker, Neo4j, or LLM credentials are unavailable:

```bash
PCP_ADAPTER_MODE=local npm run api:dev
```

Local mode uses simple SQLite-backed retrieval and JSON memory storage. It is
useful for development and tests, but it is not equivalent to real LightRAG or
Graphiti behavior.

## Documentation

- [Developer handover guide](docs/system-handover.md)
- [Backend HTTP contract](docs/contracts/backend-http-v1.md)
- [Project documentation guidelines](docs/project-documentation-guidelines.md)

The handover guide includes setup details, hardcoded default locations, storage
paths, REST routes, MCP tools, troubleshooting, and operational notes.

## Development

Typecheck:

```bash
npm run typecheck
```

Run tests:

```bash
npm test
```

Build:

```bash
npm run build
```

Useful Docker checks:

```bash
docker compose config
docker compose ps
```

## Security and Local State

Do not commit secrets or generated project context.

Ignored by default:

- `.env`
- `.env.*`
- `.project-context/`
- `project-catalog.json`
- `node_modules/`
- build output

The API binds to `127.0.0.1` by default. Remote binding requires explicit opt-in
with `ALLOW_REMOTE_BIND=true`; add authentication before exposing it outside a
trusted local environment.

## Project Status

This is an early-stage MVP. The TypeScript control plane, REST API, MCP server,
CLI, local adapters, sidecar HTTP contracts, and UI are in place. The Python
sidecars currently provide contract-compatible local behavior and are structured
so real LightRAG/Graphiti integrations can evolve behind stable TypeScript
adapters.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
