# Project Context Platform

Local-first project memory, documentation retrieval, and MCP tooling for
AI-assisted software teams.

Project Context Platform indexes your project docs and source files, extracts
stable IDs, stores searchable context, records durable memory events, and exposes
that context through a REST API, MCP server, CLI, and small web UI.

It is designed for teams that want coding agents to work from canonical project
context instead of guessing from whatever files happen to be open.

Use AGENTS.md content in other projects to have a proper agentic workflow.

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
  ID registry entries, memory, approvals, settings, tool-call logs, and the SPDD trace registry tab.
- Catalogs SPDD artifacts under `spdd/prompt`, `spdd/analysis`, `spdd/plan`, and `spdd/review`
  into **project SQLite metadata** independently of LightRAG indexing: paths such as `spdd/prompt/**`
  may remain listed under `indexing.ignore` for retrieval while still being scanned for trace metadata,
  stable-ID headings, and content hashes (full bodies stay out of trace APIs).

## Architecture

```text
packages/core        Domain types, config, ingestion, retrieval, memory services
packages/infra       SQLite stores, JSONL logs, HTTP/local adapters
packages/api         Fastify REST API
packages/mcp-server  MCP stdio server for agent tools
packages/cli         Project registration, ingestion, validation CLI
packages/web         React/Vite operator UI
services/lightrag    Python HTTP sidecar for document retrieval / LightRAG core
services/graphiti    Python HTTP sidecar for memory / Graphiti core
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
- Optional: `OPENAI_API_KEY` for LLM-backed sidecar behavior when
  `LIGHTRAG_BACKEND=core` or `GRAPHITI_BACKEND=core` is enabled.

## Quick Start

Install dependencies:

```bash
npm install
cp .env.example .env
```

Start the sidecars and Neo4j:

```bash
docker compose up -d --build neo4j lightrag graphiti
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

The default `.env.example` starts the sidecars in `contract` mode. Contract mode
is deterministic and cheap: LightRAG uses local JSON chunk search, and Graphiti
uses local JSON memory events. To use real LLM-backed LightRAG and Graphiti,
set `LIGHTRAG_BACKEND=core`, `GRAPHITI_BACKEND=core`, and `OPENAI_API_KEY`, then
rebuild the sidecars and re-ingest projects.

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

Refresh the **SPDD trace** artifact catalog (metadata SQLite scan under `spdd/**`; independent of LightRAG ingest):

```bash
npm run cli -- spdd-trace sync --project-id pcp
```

List recorded trace rows or capture a run (examples):

```bash
npm run cli -- spdd-trace list --project-id pcp --limit 50
npm run cli -- spdd-trace record --project-id pcp --artifact-path spdd/prompt/example.md --summary "Implemented trace hooks"
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

SPDD trace registry (metadata-backed catalog under `spdd/**`; not LightRAG indexing):

- `sync_spdd_artifacts`
- `record_spdd_run`
- `list_spdd_trace`
- `lookup_spdd_trace`

Broad search tools return compact previews. Use `get_document` or
`get_spec_context` when an agent needs full content.

## Configuration

Copy `.env.example` to `.env` and adjust as needed.

Important platform defaults:

```env
PCP_HOST=127.0.0.1
PCP_PORT=4318
PCP_PROJECT_CATALOG_PATH=project-catalog.json
PCP_ADAPTER_MODE=http
ALLOW_REMOTE_BIND=false
```

Sidecar connection defaults:

```env
LIGHTRAG_BASE_URL=http://127.0.0.1:9621
LIGHTRAG_TIMEOUT_MS=60000
LIGHTRAG_BACKEND=contract
GRAPHITI_BASE_URL=http://127.0.0.1:8091
GRAPHITI_TIMEOUT_MS=60000
GRAPHITI_BACKEND=contract
```

Core sidecar provider defaults:

```env
OPENAI_API_KEY=
LIGHTRAG_LLM_PROVIDER=openai
LIGHTRAG_LLM_MODEL=gpt-4o-mini
LIGHTRAG_EMBEDDING_MODEL=text-embedding-3-small
LIGHTRAG_EMBEDDING_DIM=1536
LIGHTRAG_QUERY_MODE=hybrid
LIGHTRAG_MAX_ASYNC=4
LIGHTRAG_MAX_PARALLEL_INSERT=2
LIGHTRAG_TOP_K=40
LIGHTRAG_CHUNK_TOP_K=16
LIGHTRAG_MAX_TOTAL_TOKENS=20000
GRAPHITI_LLM_PROVIDER=openai
GRAPHITI_LLM_MODEL=gpt-4o-mini
GRAPHITI_SMALL_LLM_MODEL=gpt-4o-mini
GRAPHITI_EMBEDDING_MODEL=text-embedding-3-small
GRAPHITI_CONCURRENCY_LIMIT=2
NEO4J_URI=bolt://127.0.0.1:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=project-context
```

`contract` mode is the default local mode. It preserves the lightweight JSON
sidecar behavior used for smoke tests and offline development. Core mode is
explicitly selected with `LIGHTRAG_BACKEND=core` or `GRAPHITI_BACKEND=core`;
an OpenAI key by itself does not change runtime behavior.

When changing sidecar backend mode, provider settings, or model settings, rebuild
and restart the sidecars:

```bash
docker compose up -d --build lightrag graphiti
```

Restart the API after changing `LIGHTRAG_TIMEOUT_MS`, `GRAPHITI_TIMEOUT_MS`, or
sidecar base URLs.

LightRAG core ingest reconciliation removes stale documents inside `/v1/ingest`:
full reindexes compare manifest paths against the scanned path list and delete
removed sources from LightRAG before inserting replacements; changed/document jobs only reconcile paths included in the payload (matching hashes skip duplicate inserts).
Whole-project teardown stays on `DELETE /v1/projects/{project_id}` and API deletion flows, not inside ingestion alone.

Tune retrieval concurrency and query breadth using `LIGHTRAG_MAX_ASYNC`,
`LIGHTRAG_MAX_PARALLEL_INSERT`, `LIGHTRAG_TOP_K`, `LIGHTRAG_CHUNK_TOP_K`, and
`LIGHTRAG_MAX_TOTAL_TOKENS`. Values clamp to safe ranges and surface through the LightRAG `/health` payload (`tuning`, `query_mode`, embedding metadata) without running embedding or LLM calls during health checks.

Changing embedding models or dimensions still requires rebuilding indexes (typically deleting Docker volumes or re-running confirmed ingestion).

### Core Mode Smoke Test

With both sidecars in core mode:

```env
LIGHTRAG_BACKEND=core
GRAPHITI_BACKEND=core
OPENAI_API_KEY=...
```

Re-ingest a project so LightRAG builds its real index:

```bash
npm run cli -- ingest --project-id pcp --confirmed
```

Search through the API:

```bash
curl -s http://127.0.0.1:4318/api/projects/pcp/search \
  -H 'content-type: application/json' \
  -d '{"query":"How does the platform isolate project memory and retrieval?", "limit":5}'
```

Write and read Graphiti memory:

```bash
curl -s http://127.0.0.1:4318/api/projects/pcp/memory/decisions \
  -H 'content-type: application/json' \
  -d '{"id":"DEC-PCP-001","topic":"core sidecars","fact":"LightRAG and Graphiti core modes are enabled through explicit backend flags.","source":"manual smoke test"}'

curl -s 'http://127.0.0.1:4318/api/projects/pcp/memory/facts?topic=core%20sidecars'
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
sidecars support both deterministic contract mode and explicit core mode.
LightRAG core indexes project content with configured LLM/embedding providers.
Graphiti core writes project memory as graph episodes scoped by `project_id`.
The TypeScript platform remains vendor-neutral and talks to both sidecars only
through the documented HTTP adapters.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
