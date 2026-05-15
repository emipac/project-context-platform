import type { ReactNode } from "react";
import { Table } from "./Table.js";

export function Panel({ title, rows, headerExtra }: { title: string; rows: unknown[]; headerExtra?: ReactNode }) {
  return (
    <>
      <div className="panel-title">
        <h2>{title}</h2>
        <span>{rows.length} rows</span>
        {headerExtra ?? null}
      </div>
      <Table rows={rows} />
    </>
  );
}
