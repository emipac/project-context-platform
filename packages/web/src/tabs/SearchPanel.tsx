import { useState } from "react";
import type { FormEvent } from "react";
import { Table } from "../components/Table.js";
import {
  buildSearchRequestBody,
  DEFAULT_SEARCH_FILTERS,
  SEARCH_CHUNK_KINDS,
  SEARCH_DOCUMENT_TYPES,
  type SearchFilters,
  type SearchRequestBody
} from "../search-request.js";

function toggleValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function SearchPanel({
  onSearch,
  rows,
  loading
}: {
  onSearch: (body: SearchRequestBody) => Promise<void>;
  rows: unknown[];
  loading: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_SEARCH_FILTERS);
  const [showAdvanced, setShowAdvanced] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!query.trim() || loading) return;
    await onSearch(buildSearchRequestBody(query, filters));
  }

  return (
    <>
      <div className="panel-title">
        <div>
          <h2>Search</h2>
          <p className="section-help">
            Query indexed documentation and source chunks through the same core retrieval service as MCP{" "}
            <code>search_docs</code>. Scope filters map to the REST search budget fields.
          </p>
        </div>
      </div>

      <form className="search-panel" onSubmit={(event) => void handleSubmit(event)}>
        <div className="search-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search canonical context"
            aria-label="Search query"
            disabled={loading}
          />
          <button type="submit" className="btn btn-primary btn-search" disabled={loading || !query.trim()}>
            {loading ? "Searching…" : "Search"}
          </button>
        </div>

        <div className="search-filters-grid">
          <label>
            <span>Result limit</span>
            <select
              value={String(filters.limit)}
              onChange={(event) => setFilters((current) => ({ ...current, limit: Number(event.target.value) }))}
              disabled={loading}
            >
              {[5, 10, 12, 20, 50].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Query mode</span>
            <select
              value={filters.queryMode}
              onChange={(event) =>
                setFilters((current) => ({ ...current, queryMode: event.target.value as SearchFilters["queryMode"] }))
              }
              disabled={loading}
            >
              <option value="">Default (sidecar)</option>
              <option value="naive">Naive / manifest keyword</option>
              <option value="local">Local</option>
              <option value="hybrid">Hybrid</option>
              <option value="mix">Mix</option>
              <option value="global">Global</option>
            </select>
            <small>Core LightRAG engine only for non-naive modes.</small>
          </label>

          <label className="search-prefixes">
            <span>Source path prefixes</span>
            <input
              value={filters.sourcePathPrefixes}
              onChange={(event) => setFilters((current) => ({ ...current, sourcePathPrefixes: event.target.value }))}
              placeholder="packages/core/src/, docs/"
              disabled={loading}
            />
            <small>Comma- or newline-separated workspace-relative prefixes.</small>
          </label>
        </div>

        <fieldset className="search-checkbox-group" disabled={loading}>
          <legend>Document types</legend>
          <div className="search-checkbox-row">
            {SEARCH_DOCUMENT_TYPES.map((docType) => (
              <label key={docType} className="search-checkbox">
                <input
                  type="checkbox"
                  checked={filters.documentTypes.includes(docType)}
                  onChange={() => setFilters((current) => ({ ...current, documentTypes: toggleValue(current.documentTypes, docType) }))}
                />
                {docType}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="search-checkbox-group" disabled={loading}>
          <legend>Chunk kinds</legend>
          <div className="search-checkbox-row">
            {SEARCH_CHUNK_KINDS.map((chunkKind) => (
              <label key={chunkKind} className="search-checkbox">
                <input
                  type="checkbox"
                  checked={filters.chunkKinds.includes(chunkKind)}
                  onChange={() => setFilters((current) => ({ ...current, chunkKinds: toggleValue(current.chunkKinds, chunkKind) }))}
                />
                {chunkKind}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="search-advanced-toggle">
          <label className="stale-toggle">
            <input type="checkbox" checked={showAdvanced} onChange={(event) => setShowAdvanced(event.target.checked)} />
            Advanced LightRAG budgets
          </label>
        </div>

        {showAdvanced ? (
          <div className="search-filters-grid search-advanced-grid">
            <label>
              <span>Top K</span>
              <input
                type="number"
                min={1}
                value={filters.topK}
                onChange={(event) => setFilters((current) => ({ ...current, topK: event.target.value }))}
                placeholder="Optional"
                disabled={loading}
              />
            </label>
            <label>
              <span>Chunk top K</span>
              <input
                type="number"
                min={1}
                value={filters.chunkTopK}
                onChange={(event) => setFilters((current) => ({ ...current, chunkTopK: event.target.value }))}
                placeholder="Optional"
                disabled={loading}
              />
            </label>
            <label>
              <span>Max total tokens</span>
              <input
                type="number"
                min={1000}
                value={filters.maxTotalTokens}
                onChange={(event) => setFilters((current) => ({ ...current, maxTotalTokens: event.target.value }))}
                placeholder="Optional"
                disabled={loading}
              />
            </label>
            <label>
              <span>Timeout (ms)</span>
              <input
                type="number"
                min={1}
                value={filters.timeoutMs}
                onChange={(event) => setFilters((current) => ({ ...current, timeoutMs: event.target.value }))}
                placeholder="Optional"
                disabled={loading}
              />
            </label>
            <label>
              <span>Retries</span>
              <input
                type="number"
                min={0}
                value={filters.retries}
                onChange={(event) => setFilters((current) => ({ ...current, retries: event.target.value }))}
                placeholder="Optional"
                disabled={loading}
              />
            </label>
          </div>
        ) : null}

        {loading ? <div className="banner search-loading">Searching indexed context…</div> : null}
      </form>

      <Table
        rows={rows}
        preferredKeys={["source_path", "chunk_kind", "heading", "stable_ids", "document_type", "status", "content"]}
        maxColumns={7}
      />
    </>
  );
}
