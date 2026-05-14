import type { FormEvent } from "react";
import { Table } from "../components/Table.js";

export function SearchPanel({
  query,
  setQuery,
  onSearch,
  rows
}: {
  query: string;
  setQuery: (value: string) => void;
  onSearch: (event: FormEvent) => void;
  rows: unknown[];
}) {
  return (
    <>
      <div className="panel-title">
        <h2>Search</h2>
      </div>
      <form className="search" onSubmit={onSearch}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search canonical context" />
        <button type="submit">Search</button>
      </form>
      <Table rows={rows} />
    </>
  );
}
