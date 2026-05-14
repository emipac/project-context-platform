import { useEffect, useMemo, useState } from "react";
import {
  compareCells,
  formatCell,
  formatHeaderLabel,
  isLongCell,
  nextSort,
  renderCell
} from "../formatters.js";

export function Table({ rows }: { rows: unknown[] }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);

  const normalizedRows = useMemo(() => rows.map((row) => row as Record<string, unknown>), [rows]);
  const keys = useMemo(() => Array.from(new Set(normalizedRows.flatMap((row) => Object.keys(row)))).slice(0, 8), [normalizedRows]);
  const filteredRows = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const visibleRows = term
      ? normalizedRows.filter((row) => keys.some((key) => formatCell(row[key]).toLowerCase().includes(term)))
      : normalizedRows;
    if (!sort) return visibleRows;
    return [...visibleRows].sort((left, right) => compareCells(left[sort.key], right[sort.key], sort.direction));
  }, [filter, keys, normalizedRows, sort]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const firstRow = filteredRows.length ? (currentPage - 1) * pageSize + 1 : 0;
  const lastRow = Math.min(currentPage * pageSize, filteredRows.length);

  useEffect(() => {
    setPage(1);
  }, [filter, pageSize, rows]);

  if (!rows.length) return <p className="empty">No rows</p>;
  return (
    <div className="data-grid">
      <div className="table-toolbar">
        <label>
          Filter
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Type to filter rows" />
        </label>
        <label>
          Rows
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      </div>

      {filteredRows.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {keys.map((key) => (
                  <th key={key}>
                    <button type="button" onClick={() => setSort(nextSort(sort, key))}>
                      {formatHeaderLabel(key)}
                      <span>{sort?.key === key ? (sort.direction === "asc" ? " up" : " down") : ""}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row, index) => (
                <tr key={`${currentPage}-${index}`}>
                  {keys.map((key) => <td className={isLongCell(key, row[key]) ? "long-cell" : ""} key={key}>{renderCell(row[key])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">No matching rows</p>
      )}

      <div className="pagination">
        <span>{firstRow}-{lastRow} of {filteredRows.length}</span>
        <div>
          <button type="button" disabled={currentPage === 1} onClick={() => setPage(1)}>First</button>
          <button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
          <span>Page {currentPage} of {totalPages}</span>
          <button type="button" disabled={currentPage === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</button>
          <button type="button" disabled={currentPage === totalPages} onClick={() => setPage(totalPages)}>Last</button>
        </div>
      </div>
    </div>
  );
}
