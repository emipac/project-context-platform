import { Table } from "./Table.js";

export function Panel({ title, rows }: { title: string; rows: unknown[] }) {
  return (
    <>
      <div className="panel-title">
        <h2>{title}</h2>
        <span>{rows.length} rows</span>
      </div>
      <Table rows={rows} />
    </>
  );
}
