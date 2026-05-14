# Project Context Platform Handover Guide

This document explains how the Project Context Platform works, how to set it up,
how to run it, where data is stored, and where important defaults live in code.
It is written for developers who need to operate or extend the system without
additional walkthrough.

The short version: this repository is a local control plane for project context.
It indexes project files, extracts stable IDs, stores searchable document chunks,
records project memory events, exposes REST and MCP APIs, and provides a small
operator UI.

## 1. What This System Is

The platform gives AI agents and developers a consistent way to ask:

- What projects are registered?
- Which files and docs have been indexed?
- What requirements, ADRs, decisions, and IDs exist?
- What context should an agent use before implementing or reviewing a feature?
- What changed over time?
- What did previous MCP/tool calls return?

It is intentionally local-first. Each project owns its own `.project-context`
directory, while the platform repository owns the API, CLI, MCP server, UI, and
the central project catalog.

## 2. Main Components

```text
packages/core
  Domain types, config parsing, workspace registration, ingestion orchestration,
  stable ID extraction, retrieval orchestration, memory service, validation.

packages/infra
  SQLite repositories, JSONL tool-call logging, project-aware repository routing,
  HTTP adapters for LightRAG and Graphiti, local fallback adapters.

packages/api
  Fastify REST API used by the UI and by direct HTTP clients.

packages/mcp-server
  MCP stdio server used by Cursor or other MCP clients.

packages/cli
  Developer CLI for registering projects, ingestion, validation, diagnostics.

packages/web
  React/Vite operator UI.

services/lightrag
  Python FastAPI sidecar implementing the LightRAG HTTP contract.

services/graphiti
  Python FastAPI sidecar implementing the Graphiti/memory HTTP contract.

docs/contracts
  TypeScript-to-Python HTTP contract documentation.
```

At runtime:

```text
CLI / REST API / MCP / Web UI
  -> @pcp/core services
  -> @pcp/infra adapters
  -> LightRAG HTTP sidecar at http://127.0.0.1:9621
  -> Graphiti HTTP sidecar at http://127.0.0.1:8091
  -> per-project .project-context state
```

### Runtime Lifecycle

The platform intentionally runs its own PCP-facing LightRAG and Graphiti
sidecars. The LightRAG container is not the official `lightrag-server` Web UI
process, and this setup does not use an external vector database. The LightRAG
sidecar exposes the PCP `/v1/...` HTTP contract and stores core-mode retrieval
state in the `lightrag-data` Docker volume.

Project document indexing flows through LightRAG:

```text
CLI / UI / MCP ingest request
  -> REST API
  -> IngestionService scans configured project files
  -> stable IDs are extracted and written to project metadata
  -> file path, content, heading, and stable IDs are sent to LightRAG
  -> LightRAG chunks documents, calls the embedding model, and performs
     LLM-backed entity/relation extraction
  -> LightRAG stores chunks, embeddings, graph state, caches, and document
     status under /data/projects/<safe-project-id>
  -> PCP keeps manifest metadata so retrieval results can be mapped back to
     project files and stable IDs
```

Project search and context retrieval also flow through LightRAG:

```text
UI / REST / MCP search request
  -> REST API
  -> RetrievalService / ContextComposerService
  -> LightRAG sidecar /v1/search, /v1/spec-context, /v1/related-code, etc.
  -> LightRAG performs graph/vector retrieval from its local persisted state
  -> sidecar returns PCP-style chunks with source paths, content, and stable IDs
```

Memory, decisions, facts, and review history flow through Graphiti instead:

```text
UI / REST / MCP memory request
  -> REST API
  -> TemporalMemoryService
  -> Graphiti sidecar
  -> Graphiti stores memory episodes/facts/decisions
  -> in core mode, Graphiti uses Neo4j plus JSON audit ledgers
```

LightRAG-indexed project documents are not automatically sent to Graphiti.
Graphiti memory is created only through the memory/decision/review APIs. When an
agent asks for implementation context, PCP composes the two sources at the
service layer: LightRAG supplies document and code context, while Graphiti
supplies durable project memory.

## 3. Repository Setup

### Prerequisites

Install:

- Node.js with npm
- Docker and Docker Compose
- Optional: an OpenAI API key for real LLM-backed sidecar behavior

The current TypeScript code uses Node's experimental `node:sqlite` API. If you
see a SQLite experimental warning, that is expected. The MCP script suppresses
Node warnings because MCP clients can be confused by stdout/stderr noise.

### Install Dependencies

From the platform repository root:

```bash
npm install
cp .env.example .env
```

Edit `.env` if needed. The default file is enough for local contract-mode smoke
tests.

Important default `.env` values:

```env
PCP_HOST=127.0.0.1
PCP_PORT=4318
PCP_PROJECT_CATALOG_PATH=project-catalog.json
PCP_REGISTRY_PATH=.project-context/global-registry.json
PCP_METADATA_PATH=.project-context/metadata.sqlite
PCP_TOOL_CALL_LOG_PATH=.project-context/tool-calls.jsonl
PCP_ADAPTER_MODE=http
LIGHTRAG_BASE_URL=http://127.0.0.1:9621
LIGHTRAG_TIMEOUT_MS=60000
LIGHTRAG_BACKEND=contract
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
GRAPHITI_BASE_URL=http://127.0.0.1:8091
GRAPHITI_TIMEOUT_MS=60000
GRAPHITI_BACKEND=contract
GRAPHITI_LLM_PROVIDER=openai
GRAPHITI_LLM_MODEL=gpt-4o-mini
GRAPHITI_SMALL_LLM_MODEL=gpt-4o-mini
GRAPHITI_EMBEDDING_MODEL=text-embedding-3-small
GRAPHITI_CONCURRENCY_LIMIT=2
NEO4J_URI=bolt://127.0.0.1:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=project-context
OPENAI_API_KEY=
ALLOW_REMOTE_BIND=false
```

`LIGHTRAG_BACKEND=contract` and `GRAPHITI_BACKEND=contract` keep sidecars in
lightweight JSON contract mode. Core mode is explicit and uses
`LIGHTRAG_BACKEND=core` or `GRAPHITI_BACKEND=core`; an `OPENAI_API_KEY` alone
does not activate LLM-backed behavior. LightRAG and Graphiti core modes both
have sidecar engine implementations behind the same HTTP contracts.

LightRAG core `/v1/ingest` honors `mode`: full scans reconcile manifest paths against the supplied path list (removals trigger LightRAG deletes plus stale manifest rows), whereas changed/document jobs reconcile only the paths included with payloads (matching SHA-256 content hashes skip redundant inserts). Whole-project cleanup remains `DELETE /v1/projects/{project_id}` via platform deletion flows.
Sidecar `/health` exposes additive retrieval diagnostics (`query_mode`, embedding metadata, and `tuning` budgets from `LIGHTRAG_MAX_ASYNC`, `LIGHTRAG_MAX_PARALLEL_INSERT`, `LIGHTRAG_TOP_K`, `LIGHTRAG_CHUNK_TOP_K`, `LIGHTRAG_MAX_TOTAL_TOKENS`) without issuing LLM or embedding requests.

## 4. Start the System

### Start Python Sidecars and Neo4j

```bash
docker compose up -d --build neo4j lightrag graphiti
docker compose ps
```

Health checks:

```bash
curl http://127.0.0.1:9621/health
curl http://127.0.0.1:8091/health
```

Default service URLs:

| Service | URL |
| --- | --- |
| REST API | `http://127.0.0.1:4318` |
| Web UI | `http://127.0.0.1:5173` |
| LightRAG sidecar | `http://127.0.0.1:9621` |
| Graphiti sidecar | `http://127.0.0.1:8091` |
| Neo4j browser | `http://127.0.0.1:7474` |
| Neo4j Bolt | `bolt://127.0.0.1:7687` |

### Start the REST API

```bash
npm run api:dev
```

Check:

```bash
curl http://127.0.0.1:4318/health
```

Expected healthy response:

```json
{
  "status": "ok",
  "adapter_mode": "http",
  "sqlite": true,
  "lightrag": true,
  "graphiti": true,
  "sidecars": {
    "lightrag": {
      "status": "ok",
      "backend": "contract",
      "core_implemented": false,
      "reachable": true
    },
    "graphiti": {
      "status": "ok",
      "backend": "contract",
      "core_implemented": false,
      "reachable": true
    }
  }
}
```

If a sidecar is down, status becomes `degraded`.
In core mode, each sidecar should report `"backend": "core"` and
`"core_implemented": true`; Graphiti should also report `"graph_ready": true`.

### Start the Web UI

```bash
npm run --workspace @pcp/web dev
```

Open:

```text
http://127.0.0.1:5173
```

The UI talks to the API through the Vite dev-server proxy.

### Start the MCP Server

The MCP server is usually started by Cursor, but it can be run directly:

```bash
npm run mcp:dev
```

MCP uses stdio. Do not add ordinary `console.log` output to the MCP process
unless it is part of the MCP response. Startup diagnostics should go to stderr.

## 5. Register the Platform Repo as a Project

From the platform repository root:

```bash
npm run cli -- projects add --root "$PWD" --project-id pcp
npm run cli -- ingest --project-id pcp --confirmed
npm run cli -- validate-ids --project-id pcp
```

This creates:

```text
.project-context/config.yml
.project-context/global-registry.json
.project-context/metadata.sqlite
.project-context/tool-calls.jsonl
```

The platform repository does not have to be registered before you register
external projects. The platform-level catalog lives at repository root:

```text
project-catalog.json
```

## 6. Register External Projects

Each external project should keep its own `.project-context` directory. The
platform catalog only points to those project-owned files.

### One-Off Registration From the Platform Repo

```bash
npm run cli -- projects add \
  --root "/absolute/path/to/other-project" \
  --project-id other-project

npm run cli -- ingest --project-id other-project --confirmed
```

### Recommended Scripts Inside External Projects

Add scripts like this to the external project's `package.json`:

```json
{
  "scripts": {
    "context:add": "PCP_PROJECT_CATALOG_PATH=\"/Users/username/www/pcms/project-catalog.json\" PCP_REGISTRY_PATH=\"$INIT_CWD/.project-context/global-registry.json\" PCP_METADATA_PATH=\"$INIT_CWD/.project-context/metadata.sqlite\" PCP_TOOL_CALL_LOG_PATH=\"$INIT_CWD/.project-context/tool-calls.jsonl\" npm --prefix /Users/username/www/pcms run cli -- projects add --root \"$INIT_CWD\" --project-id my-project",
    "context:list": "PCP_PROJECT_CATALOG_PATH=\"/Users/username/www/pcms/project-catalog.json\" PCP_REGISTRY_PATH=\"$INIT_CWD/.project-context/global-registry.json\" PCP_METADATA_PATH=\"$INIT_CWD/.project-context/metadata.sqlite\" PCP_TOOL_CALL_LOG_PATH=\"$INIT_CWD/.project-context/tool-calls.jsonl\" npm --prefix /Users/username/www/pcms run cli -- projects list",
    "context:ingest": "PCP_PROJECT_CATALOG_PATH=\"/Users/username/www/pcms/project-catalog.json\" PCP_REGISTRY_PATH=\"$INIT_CWD/.project-context/global-registry.json\" PCP_METADATA_PATH=\"$INIT_CWD/.project-context/metadata.sqlite\" PCP_TOOL_CALL_LOG_PATH=\"$INIT_CWD/.project-context/tool-calls.jsonl\" npm --prefix /Users/username/www/pcms run cli -- ingest --project-id my-project --confirmed",
    "context:ingest:changed": "PCP_PROJECT_CATALOG_PATH=\"/Users/username/www/pcms/project-catalog.json\" PCP_REGISTRY_PATH=\"$INIT_CWD/.project-context/global-registry.json\" PCP_METADATA_PATH=\"$INIT_CWD/.project-context/metadata.sqlite\" PCP_TOOL_CALL_LOG_PATH=\"$INIT_CWD/.project-context/tool-calls.jsonl\" npm --prefix /Users/username/www/pcms run cli -- ingest --project-id my-project --changed",
    "context:ids": "PCP_PROJECT_CATALOG_PATH=\"/Users/username/www/pcms/project-catalog.json\" PCP_REGISTRY_PATH=\"$INIT_CWD/.project-context/global-registry.json\" PCP_METADATA_PATH=\"$INIT_CWD/.project-context/metadata.sqlite\" PCP_TOOL_CALL_LOG_PATH=\"$INIT_CWD/.project-context/tool-calls.jsonl\" npm --prefix /Users/username/www/pcms run cli -- validate-ids --project-id my-project",
    "context:diagnostics": "PCP_PROJECT_CATALOG_PATH=\"/Users/username/www/pcms/project-catalog.json\" PCP_REGISTRY_PATH=\"$INIT_CWD/.project-context/global-registry.json\" PCP_METADATA_PATH=\"$INIT_CWD/.project-context/metadata.sqlite\" PCP_TOOL_CALL_LOG_PATH=\"$INIT_CWD/.project-context/tool-calls.jsonl\" npm --prefix /Users/username/www/pcms run cli -- diagnostics"
  }
}
```

Replace:

- `/Users/username/www/pcms` with the platform repo path
- `my-project` with the external project's stable project ID

Run from the external project:

```bash
npm run context:add
npm run context:ingest
npm run context:list
```

`INIT_CWD` is set by npm to the directory where the command was started. That is
why these scripts create and read state inside the external project, not inside
the platform repository.

## 7. Data and Storage Model

### Platform-Level Catalog

Path:

```text
<platform-repo>/project-catalog.json
```

Override:

```env
PCP_PROJECT_CATALOG_PATH=/absolute/path/to/project-catalog.json
```

Purpose:

- Lists all known projects for API/UI discovery.
- De-dupes by `project_id`.
- Marks entries unavailable if their root path or registry file is missing.
- Does not contain indexed document content.

Code:

- `packages/core/src/config/project-catalog-store.ts`

### Per-Project State

Each project keeps:

```text
<project>/.project-context/config.yml
<project>/.project-context/global-registry.json
<project>/.project-context/metadata.sqlite
<project>/.project-context/tool-calls.jsonl
```

The platform routes project-specific API calls to the selected project's own
metadata and log files. It does not merge all projects into one SQLite file.

### SQLite Metadata

Default per-project path:

```text
<project>/.project-context/metadata.sqlite
```

Tables:

| Table | Stores |
| --- | --- |
| `ingestion_jobs` | Ingestion run history and status |
| `chunks` | Canonical document chunks, source paths, headings, stable IDs, content |
| `id_registry` | Extracted stable IDs and aliases with source locations |

Code:

- `packages/infra/src/sqlite-metadata-repository.ts`
- `packages/infra/src/project-metadata-repository.ts`

### Tool Call Logs

Default per-project path:

```text
<project>/.project-context/tool-calls.jsonl
```

Each MCP, REST, CLI, or web tool call can be summarized here as JSONL. The MCP
wrapper records inputs and result summaries, not full giant payloads.

Code:

- `packages/infra/src/project-tool-call-logger.ts`
- `packages/infra/src/jsonl-tool-call-logger.ts`
- `packages/mcp-server/src/tool-wrapper.ts`

### LightRAG Sidecar Storage

Docker volume:

```text
lightrag-data
```

Inside the sidecar, contract-mode chunks are stored as:

```text
/data/<project-id>-chunks.json
```

In LightRAG core mode, per-project core state is stored under:

```text
/data/projects/<safe-project-id>
```

Code:

- `services/lightrag/app.py`

### Graphiti Sidecar Storage

Docker volume:

```text
graphiti-data
```

Contract-mode memory events are stored as:

```text
/data/<project-id>-events.json
```

Graphiti core mode uses Neo4j graph storage and keeps JSON event files as audit
and migration ledgers.

Neo4j data is stored in:

```text
neo4j-data
```

Code:

- `services/graphiti/app.py`

## 8. Project Configuration

Every registered project gets:

```text
<project>/.project-context/config.yml
```

Generated defaults:

```yaml
indexing:
  include: [docs/**, src/**, tests/**, *.md]
  ignore: [.git/**, node_modules/**, .env, .env.*]
  max_chunks_per_section: 8
  duplicate_id_policy: warn
ids:
  required_prefixes: [REQ, TASK, ADR, DEC, REQCHG, REV, IMPL, AC, NFR, DP]
  project_domain: PROJECT
  legacy_patterns:
    adr_headings: true
    adr_filenames: true
    use_cases: false
    plan_items: false
lightrag:
  index_path: .project-context/lightrag
  timeout_ms: 5000
  base_url: http://127.0.0.1:9621
  health_path: /health
graphiti:
  namespace: project-id
  timeout_ms: 5000
  base_url: http://127.0.0.1:8091
  health_path: /health
memory:
  high_risk_types: [requirement_change, review_finding]
  low_risk_types: [decision, implementation_summary]
api:
  host: 127.0.0.1
  port: 4318
ui:
  enabled: true
```

Config parser and defaults:

- `packages/core/src/config/project-config.ts`
- `packages/core/src/services/project-workspace-service.ts`

The YAML parser is intentionally simple. Keep values simple: scalars, booleans,
numbers, and inline arrays.

## 9. Ingestion Behavior

Full ingestion:

```bash
npm run cli -- ingest --project-id pcp --confirmed
```

Changed ingestion:

```bash
npm run cli -- ingest --project-id pcp --changed
```

Specific document ingestion through MCP:

```text
ingest_document(project_id, path)
```

What ingestion does:

1. Resolves the project from the catalog or registry.
2. Loads the project's `.project-context/config.yml`.
3. Lists files that match `indexing.include` and do not match `indexing.ignore`.
4. Applies hardcoded safety ignores for `.git`, `node_modules`, `.project-context`,
   `dist`, `coverage`, `.vite`, `.env*`, `*.tsbuildinfo`, and `package-lock.json`.
5. Reads file content.
6. Extracts stable IDs and legacy aliases.
7. Writes the ID registry into project SQLite.
8. Sends documents to the LightRAG adapter.
9. Saves an ingestion job record.

Indexable file extensions are currently hardcoded:

```text
.md, .mdx, .ts, .tsx, .js, .jsx, .php, .blade.php, .json, .yml, .yaml,
.html, .css, .xml, .txt, .dbml
```

Code:

- `packages/core/src/services/ingestion-service.ts`

## 10. Stable IDs and Aliases

Canonical stable IDs use this shape:

```text
PREFIX-DOMAIN-NUMBER
```

Examples:

```text
REQ-AUTH-001
TASK-HIRING-001
ADR-PROF-0003
AC-MVP-001
NFR-SEC-001
```

Default recognized prefixes:

```text
REQ, TASK, ADR, DEC, REQCHG, REV, IMPL, AC, NFR, DP
```

Legacy ADR support is enabled by default:

- `# ADR 0003: Hybrid Search Architecture`
- `docs/adr/0003-hybrid-search-architecture.md`

With `ids.project_domain: PROF`, both normalize to:

```text
ADR-PROF-0003
```

Aliases are stored too:

```text
ADR 0003
ADR 3
ADR-0003
0003-hybrid-search-architecture
```

Use-case and plan-item labels are disabled by default because labels like
`UC-3`, `Q6.1`, `P5a`, and `IQ-6` often collide across documents. Enable them
only for projects that intentionally use those labels as stable local references:

```yaml
ids:
  legacy_patterns:
    use_cases: true
    plan_items: true
```

Code:

- `packages/core/src/services/id-registry-service.ts`
- `docs/project-documentation-guidelines.md`

## 11. Memory-First Change History

The platform treats Markdown changelogs as optional human artifacts, not required
state. Normal agent workflows should:

- Update canonical docs when behavior changes.
- Call `remember_implementation_summary` after completed work.
- Call `remember_requirement_change` when requirements change.
- Call `remember_decision` for durable decisions.
- Call `remember_review` for review findings.

Major architecture decisions should still become ADRs. Historical changelogs can
remain indexed for legacy context.

Code:

- `packages/core/src/services/temporal-memory-service.ts`
- `services/graphiti/app.py`
- `docs/project-documentation-guidelines.md`

## 12. REST API Overview

Base URL:

```text
http://127.0.0.1:4318
```

Core routes:

| Route | Purpose |
| --- | --- |
| `GET /health` | API and adapter health |
| `GET /api/projects` | List cataloged projects |
| `POST /api/projects` | Register a project |
| `GET /api/projects/:project_id` | Get one project |
| `PATCH /api/projects/:project_id` | Patch project metadata |
| `DELETE /api/projects/:project_id` | Delete workspace registration after purge (`confirmed` required via JSON body or `?confirmed=true`) |
| `GET /api/projects/:project_id/settings` | Read project config |
| `POST /api/projects/:project_id/ingest` | Full ingestion |
| `POST /api/projects/:project_id/ingest/changed` | Changed-file ingestion |
| `GET /api/projects/:project_id/ingestion/status` | Recent or specific ingestion jobs |
| `GET /api/projects/:project_id/documents` | List/search indexed chunks |
| `POST /api/projects/:project_id/search` | Search docs |
| `GET /api/projects/:project_id/specs/:stable_id` | Exact spec context by stable ID or alias |
| `GET /api/projects/:project_id/ids` | List ID registry |
| `GET /api/projects/:project_id/ids/:stable_id` | Get registry entry by ID or alias |
| `GET /api/projects/:project_id/tool-call-logs` | Read tool call logs |

Memory and context routes:

| Route | Purpose |
| --- | --- |
| `POST /api/projects/:project_id/context/feature` | Compose feature implementation context |
| `POST /api/projects/:project_id/context/review` | Compose review context |
| `POST /api/projects/:project_id/validate` | Validate plan or diff against specs |
| `GET /api/projects/:project_id/memory/facts` | Current memory facts |
| `GET /api/projects/:project_id/memory/history` | Memory history |
| `POST /api/projects/:project_id/memory/decisions` | Write decision |
| `POST /api/projects/:project_id/memory/reviews` | Write review finding |
| `POST /api/projects/:project_id/memory/requirement-changes` | Write requirement change |
| `POST /api/projects/:project_id/memory/implementation-summaries` | Write implementation summary |
| `GET /api/projects/:project_id/approvals` | List approvals |
| `POST /api/projects/:project_id/approvals` | Record approval |

Code:

- `packages/api/src/routes.ts`
- `packages/api/src/server.ts`

## 13. MCP Tools Overview

The MCP server is the main interface for Cursor agents.

Discovery and retrieval:

| Tool | Purpose |
| --- | --- |
| `search_docs` | Search docs, returns previews only |
| `get_document` | Retrieve full chunk content by `chunk_id` or `source_path` |
| `get_spec_context` | Retrieve full context by stable ID, alias, or path |
| `get_related_code` | Search related source/test chunks, returns previews |
| `get_requirement_sources` | Find chunks tied to a requirement, returns previews |
| `get_documentation_guidelines` | Return project documentation and stable-ID guidance |

Memory:

| Tool | Purpose |
| --- | --- |
| `remember_decision` | Store decision |
| `remember_review` | Store review finding |
| `remember_requirement_change` | Store requirement change |
| `remember_approval` | Store approval |
| `remember_implementation_summary` | Store implementation summary |
| `get_current_facts` | Read current memory facts |
| `get_history` | Read memory history |

Workflow:

| Tool | Purpose |
| --- | --- |
| `prepare_feature_context` | Gather implementation context |
| `prepare_review_context` | Gather review context |
| `validate_against_specs` | Validate plan/diff |
| `ingest_changed_files` | Index changed project files |
| `ingest_document` | Index one document |
| `get_ingestion_status` | Read ingestion jobs |
| `validate_ids` | Find duplicate IDs |

Broad search tools intentionally return compact previews:

- `search_docs` default limit: 5
- `search_docs` max limit: 10
- `get_related_code` default limit: 5
- `get_related_code` max limit: 10
- Full content requires `get_document` or `get_spec_context`

Code:

- `packages/mcp-server/src/server.ts`
- `packages/mcp-server/src/register-all-tools.ts`
- `packages/mcp-server/src/preview.ts`

## 14. Cursor MCP Configuration

Example Cursor configuration:

```json
{
  "mcpServers": {
    "project-context-platform": {
      "command": "npm",
      "args": [
        "run",
        "mcp:dev",
        "--prefix",
        "/Users/username/www/pcms"
      ],
      "env": {
        "PCP_ADAPTER_MODE": "http",
        "PCP_PROJECT_CATALOG_PATH": "/Users/username/www/pcms/project-catalog.json",
        "LIGHTRAG_BASE_URL": "http://127.0.0.1:9621",
        "GRAPHITI_BASE_URL": "http://127.0.0.1:8091"
      }
    }
  }
}
```

After changing this configuration, restart the MCP server from Cursor's MCP
settings. Environment variables are read when the MCP process starts.

If Cursor shows empty arrays from retrieval tools, check:

1. The selected `project_id` exists in `project-catalog.json`.
2. The selected project has been ingested.
3. The project's `.project-context/config.yml` includes the desired paths.
4. LightRAG sidecar health is `ok`.
5. The API `/health.sidecars.lightrag.backend` value matches the intended
   runtime mode.
6. The query is not restricted to document types that do not exist.

## 15. UI Notes

Start:

```bash
npm run --workspace @pcp/web dev
```

The UI is an operator view over the REST API. It uses the project dropdown to
select a project, then loads that project's data through project-specific API
routes.

Vite defaults:

- Host: `127.0.0.1`
- Port: `5173`
- API target: `VITE_API_BASE_URL` or `http://127.0.0.1:4318`

Code:

- `packages/web/src`
- `packages/web/vite.config.ts`

## 16. Local Adapter Mode

Set:

```bash
PCP_ADAPTER_MODE=local npm run api:dev
```

Local mode bypasses Docker sidecars:

- `LocalLightRagAdapter` indexes into local SQLite chunks and uses simple term
  matching.
- `LocalGraphitiAdapter` writes memory events to `.project-context/memory.json`.

Use local mode for tests or when Docker/LLM credentials are unavailable. Do not
treat it as equivalent to production LightRAG or Graphiti behavior.

Code:

- `packages/infra/src/local-lightrag-adapter.ts`
- `packages/infra/src/local-graphiti-adapter.ts`
- `packages/infra/src/app-services.ts`

## 17. Environment Variables and Hardcoded Defaults

| Name/default | Purpose | Code location |
| --- | --- | --- |
| `PCP_HOST=127.0.0.1` | API bind host | `packages/api/src/server.ts` |
| `PCP_PORT=4318` | API port | `packages/api/src/server.ts` |
| `ALLOW_REMOTE_BIND=false` | Allows non-local API bind only when `true` | `packages/api/src/server.ts` |
| `PCP_PROJECT_CATALOG_PATH=project-catalog.json` | Platform project catalog | `packages/core/src/config/project-catalog-store.ts` |
| `PCP_REGISTRY_PATH=.project-context/global-registry.json` | Registry for the current process/project | `packages/core/src/config/global-registry-store.ts` |
| `PCP_METADATA_PATH=.project-context/metadata.sqlite` | Fallback SQLite metadata path | `packages/infra/src/sqlite-metadata-repository.ts` |
| `PCP_TOOL_CALL_LOG_PATH=.project-context/tool-calls.jsonl` | Fallback tool-call log path | `packages/infra/src/jsonl-tool-call-logger.ts` |
| `PCP_ADAPTER_MODE=http` | `http` uses sidecars, `local` uses fallback adapters | `packages/infra/src/app-services.ts` |
| `LIGHTRAG_BASE_URL=http://127.0.0.1:9621` | LightRAG adapter URL | `packages/infra/src/http/lightrag-http-adapter.ts` |
| `LIGHTRAG_TIMEOUT_MS=60000` | LightRAG HTTP timeout | `packages/infra/src/http/lightrag-http-adapter.ts` |
| `LIGHTRAG_HEALTH_PATH=/health` | LightRAG health endpoint | `packages/infra/src/http/lightrag-http-adapter.ts` |
| `LIGHTRAG_BACKEND=contract` | LightRAG sidecar mode: `contract` or `core` | `services/lightrag/config.py` |
| `LIGHTRAG_LLM_MODEL=gpt-4o-mini` | LightRAG core LLM model | `services/lightrag/config.py` |
| `LIGHTRAG_EMBEDDING_MODEL=text-embedding-3-small` | LightRAG core embedding model | `services/lightrag/config.py` |
| `LIGHTRAG_EMBEDDING_DIM=1536` | LightRAG core embedding dimension | `services/lightrag/config.py` |
| `LIGHTRAG_QUERY_MODE=hybrid` | LightRAG core query mode | `services/lightrag/config.py` |
| `LIGHTRAG_MAX_ASYNC=4` | LightRAG LLM concurrency ceiling (`llm_model_max_async`) | `services/lightrag/lightrag_engine.py` |
| `LIGHTRAG_MAX_PARALLEL_INSERT=2` | LightRAG parallel document insert ceiling | `services/lightrag/lightrag_engine.py` |
| `LIGHTRAG_TOP_K=40` | LightRAG QueryParam entity/relation retrieval budget | `services/lightrag/lightrag_engine.py` |
| `LIGHTRAG_CHUNK_TOP_K=16` | LightRAG QueryParam chunk retrieval budget | `services/lightrag/lightrag_engine.py` |
| `LIGHTRAG_MAX_TOTAL_TOKENS=20000` | LightRAG QueryParam total context token budget | `services/lightrag/lightrag_engine.py` |
| `GRAPHITI_BASE_URL=http://127.0.0.1:8091` | Graphiti adapter URL | `packages/infra/src/http/graphiti-http-adapter.ts` |
| `GRAPHITI_TIMEOUT_MS=60000` | Graphiti HTTP timeout | `packages/infra/src/http/graphiti-http-adapter.ts` |
| `GRAPHITI_HEALTH_PATH=/health` | Graphiti health endpoint | `packages/infra/src/http/graphiti-http-adapter.ts` |
| `GRAPHITI_BACKEND=contract` | Graphiti sidecar mode: `contract` or `core` | `services/graphiti/config.py` |
| `GRAPHITI_LLM_MODEL=gpt-4o-mini` | Graphiti core main LLM model | `services/graphiti/config.py` |
| `GRAPHITI_SMALL_LLM_MODEL=gpt-4o-mini` | Graphiti core small LLM model | `services/graphiti/config.py` |
| `GRAPHITI_EMBEDDING_MODEL=text-embedding-3-small` | Graphiti core embedding model | `services/graphiti/config.py` |
| `GRAPHITI_CONCURRENCY_LIMIT=2` | Graphiti core provider concurrency limit | `services/graphiti/config.py` |
| `VITE_API_BASE_URL=http://127.0.0.1:4318` | UI dev proxy target | `packages/web/vite.config.ts` |
| `LIGHTRAG_DATA_DIR=/data` | LightRAG sidecar data directory | `services/lightrag/app.py`, `docker-compose.yml` |
| `GRAPHITI_DATA_DIR=/data` | Graphiti sidecar data directory | `services/graphiti/app.py`, `docker-compose.yml` |
| `NEO4J_URI=bolt://neo4j:7687` | Graphiti container Neo4j URL | `docker-compose.yml` |
| `NEO4J_USER=neo4j` | Neo4j user | `docker-compose.yml` |
| `NEO4J_PASSWORD=project-context` | Neo4j password | `docker-compose.yml` |
| `OPENAI_API_KEY=` | Optional LLM provider credential | `.env.example`, `docker-compose.yml` |

Hardcoded network bindings:

| Binding | Location |
| --- | --- |
| LightRAG Docker port `127.0.0.1:9621:9621` | `docker-compose.yml` |
| Graphiti Docker port `127.0.0.1:8091:8091` | `docker-compose.yml` |
| Neo4j browser `127.0.0.1:7474:7474` | `docker-compose.yml` |
| Neo4j Bolt `127.0.0.1:7687:7687` | `docker-compose.yml` |
| Vite host `127.0.0.1`, port `5173` | `packages/web/vite.config.ts`, `packages/web/package.json` |

Hardcoded ingestion rules:

| Rule | Location |
| --- | --- |
| Indexable extensions | `packages/core/src/services/ingestion-service.ts` |
| Always ignored directories/files | `packages/core/src/services/ingestion-service.ts` |
| Stable ID regex and legacy ID regexes | `packages/core/src/services/id-registry-service.ts` |
| MCP preview length and limit clamps | `packages/mcp-server/src/preview.ts` |

## 18. Security and Operations Notes

- The API binds to localhost by default.
- Binding to a remote host requires `ALLOW_REMOTE_BIND=true`.
- If remote binding is enabled, add real authentication before exposing it beyond
  a trusted local network.
- `.env` may contain secrets and should not be committed.
- `.project-context` contains project metadata, tool logs, indexed content, and
  memory events. Treat it as sensitive project data.
- Docker volumes contain indexed chunks and memory event history.
- MCP clients can ask for full document content through targeted tools.

## 19. Development Commands

```bash
npm run typecheck
npm test
npm run build
npm run api:dev
npm run mcp:dev
npm run cli -- projects list
npm run --workspace @pcp/web dev
```

Docker validation:

```bash
docker compose config
docker compose up -d --build neo4j lightrag graphiti
docker compose ps
```

MCP smoke test:

```bash
node --no-warnings --input-type=module -e "import { Client } from '@modelcontextprotocol/sdk/client/index.js'; import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'; const transport = new StdioClientTransport({ command: 'npm', args: ['run','mcp:dev'], cwd: process.cwd(), env: { ...process.env, PCP_ADAPTER_MODE: 'local' }}); const client = new Client({ name: 'smoke', version: '0.0.0' }); await client.connect(transport); const tools = await client.listTools(); console.log(JSON.stringify({ count: tools.tools.length, names: tools.tools.map(t => t.name) }, null, 2)); await client.close();"
```

## 20. Troubleshooting

### API says `EADDRINUSE` on port 4318

Another process is already listening on `127.0.0.1:4318`.

Options:

- Stop the existing process.
- Start the API with another port:

```bash
PCP_PORT=4319 npm run api:dev
```

If the UI is also running, set:

```bash
VITE_API_BASE_URL=http://127.0.0.1:4319 npm run --workspace @pcp/web dev
```

### Cursor MCP server is stuck or shows SQLite warnings

Use `npm run mcp:dev`, not a raw `tsx` command. The script sets:

```bash
NODE_OPTIONS=--no-warnings
```

Restart the MCP server from Cursor settings after changing `.env` or the MCP
configuration.

### MCP search returns empty arrays

Check:

```bash
npm run cli -- projects list
npm run cli -- diagnostics
npm run cli -- ingest --project-id <project-id> --confirmed
```

Also verify the target project's `.project-context/config.yml` includes the
folders you expect to index.

### UI shows only one project

The API reads `project-catalog.json`. Confirm the external project was added
with the same `PCP_PROJECT_CATALOG_PATH` that the API uses.

### Duplicate stable ID warnings

Duplicates mean the same stable ID was found in multiple source locations. That
is useful when docs copied large requirement lists into several files, but it can
make exact lookup noisy. Fix by making canonical docs the source of truth and
using links/references elsewhere.

### Legacy ADRs do not resolve

Set the project domain and reingest:

```yaml
ids:
  project_domain: PROF
  legacy_patterns:
    adr_headings: true
    adr_filenames: true
```

Then:

```bash
npm run context:ingest
```

### Python compile check writes to a blocked cache

On some macOS/sandbox setups, `python3 -m py_compile` tries to write bytecode to
a user cache. Use AST parsing for a no-write syntax check:

```bash
python3 -c "import ast,pathlib; ast.parse(pathlib.Path('services/lightrag/app.py').read_text())"
python3 -c "import ast,pathlib; ast.parse(pathlib.Path('services/graphiti/app.py').read_text())"
```

## 21. Handover Checklist

Before handing the system to another developer:

1. Run `npm install`.
2. Create `.env` from `.env.example`.
3. Start Docker sidecars with `docker compose up -d --build neo4j lightrag graphiti`.
4. Start API with `npm run api:dev`.
5. Start UI with `npm run --workspace @pcp/web dev`.
6. Register at least one project.
7. Run full ingestion for that project.
8. Validate IDs.
9. Add Cursor MCP configuration.
10. Call `get_documentation_guidelines` from the agent before editing docs.
11. Confirm `.project-context` and Docker volumes are treated as sensitive local
    state.

## 22. Source Map for Future Changes

| Need to change | Start here |
| --- | --- |
| Add a new REST endpoint | `packages/api/src/routes.ts` |
| Add a new MCP tool | `packages/mcp-server/src/server.ts`, `packages/mcp-server/src/register-all-tools.ts` |
| Change ingestion file matching | `packages/core/src/services/ingestion-service.ts` |
| Change stable ID rules | `packages/core/src/services/id-registry-service.ts` |
| Change project config defaults | `packages/core/src/config/project-config.ts`, `packages/core/src/services/project-workspace-service.ts` |
| Change project discovery/catalog behavior | `packages/core/src/config/project-catalog-store.ts`, `packages/core/src/services/project-workspace-service.ts` |
| Change per-project SQLite storage | `packages/infra/src/sqlite-metadata-repository.ts`, `packages/infra/src/project-metadata-repository.ts` |
| Change tool-call logging | `packages/infra/src/project-tool-call-logger.ts`, `packages/infra/src/jsonl-tool-call-logger.ts` |
| Change LightRAG HTTP contract | `services/lightrag/app.py`, `packages/infra/src/http/lightrag-http-adapter.ts` |
| Change Graphiti HTTP contract | `services/graphiti/app.py`, `packages/infra/src/http/graphiti-http-adapter.ts` |
| Change UI API target or port | `packages/web/vite.config.ts` |
| Change operator UI screens | `packages/web/src` |
