# Backend HTTP Contract v1

The TypeScript platform talks to LightRAG and Graphiti through HTTP only. Python
services own vendor packages, graph database drivers, indexing stores, and LLM or
embedding configuration.

All calls include `x-project-id` and a matching `project_id` field in JSON bodies.
All outward errors should use:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Safe human summary.",
  "details": {},
  "project_id": "demo",
  "retryable": false
}
```

## LightRAG

Base URL: `LIGHTRAG_BASE_URL`, default `http://127.0.0.1:9621`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Dependency health check |
| `POST` | `/v1/ingest` | Ingest workspace-relative paths |
| `POST` | `/v1/search` | Search canonical chunks |
| `POST` | `/v1/spec-context` | Retrieve spec context |
| `POST` | `/v1/related-code` | Retrieve code/test chunks |
| `POST` | `/v1/requirement-sources` | Retrieve chunks by requirement ID |
| `POST` | `/v1/document` | Retrieve full chunk content by chunk ID or source path |
| `DELETE` | `/v1/projects/{project_id}` | Remove sidecar-stored chunks file for the project (`deleted`: whether a file was removed) |

`/v1/ingest` accepts workspace-relative `paths` and may include `documents`
with `{ "path": string, "content": string, "stable_ids": string[], "heading"?: string }`
so contract-mode sidecars can index actual file content even when they cannot
read the host workspace directly.

Search and document responses return `{ "chunks": CanonicalDocumentChunk[] }`.
`/v1/ingest` responses return `{ "indexed": number, "warnings": string[] }`.

## Graphiti

Base URL: `GRAPHITI_BASE_URL`, default `http://127.0.0.1:8091`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Dependency health check |
| `POST` | `/v1/memory/decisions` | Persist decision memory |
| `POST` | `/v1/memory/reviews` | Persist review finding memory |
| `POST` | `/v1/memory/requirement-changes` | Persist requirement change memory |
| `POST` | `/v1/memory/implementation-summaries` | Persist implementation summary memory |
| `POST` | `/v1/approvals` | Persist human approval memory |
| `POST` | `/v1/facts/current` | Retrieve current facts |
| `POST` | `/v1/history` | Retrieve temporal history |
| `DELETE` | `/v1/projects/{project_id}` | Remove project memory JSON (`deleted_events`) and, when `GRAPHITI_ENABLE_CORE=true`, purge Neo4j nodes keyed by workspace isolation fields (`deleted_graph`) |

The Graphiti service must keep namespace isolation by treating `project_id` as the
Graphiti namespace key. Neo4j/FalkorDB credentials and any Cypher/driver logic
stay inside the Python service.

`DELETE /v1/projects/{project_id}` follows the same `x-project-id` rules as other routes (when supplied, it must equal `{project_id}`).

## Local Adapter Fallback

`PCP_ADAPTER_MODE=local` bypasses the Python services and uses the existing
TypeScript local adapters:

- `LocalLightRagAdapter`: indexes workspace files into SQLite-backed chunks and
  performs simple term matching.
- `LocalGraphitiAdapter`: writes temporal memory to a local JSON file.

This mode is for development and tests only. It does not provide real LightRAG or
Graphiti semantics.
