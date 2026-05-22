import { useEffect, useMemo, useState } from "react";
import {
  compareCells,
  formatCell,
  formatHeaderLabel,
  isLongCell,
  nextSort,
  renderCell
} from "../formatters.js";
import type { TablePaginationConfig } from "../types.js";

export function Table({
  rows,
  preferredKeys = [],
  maxColumns = 8,
  pagination
}: {
  rows: unknown[];
  preferredKeys?: string[];
  maxColumns?: number;
  pagination?: TablePaginationConfig;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);

  const isServer = Boolean(pagination);
  const serverLimit = pagination?.limit ?? 0;
  const serverOffset = pagination?.offset ?? 0;
  const serverTotal = pagination?.total ?? 0;

  const normalizedRows = useMemo(() => rows.map((row) => row as Record<string, unknown>), [rows]);
  const keys = useMemo(() => {
    const allKeys = Array.from(new Set(normalizedRows.flatMap((row) => Object.keys(row))));
    return [...preferredKeys.filter((key) => allKeys.includes(key)), ...allKeys.filter((key) => !preferredKeys.includes(key))].slice(0, maxColumns);
  }, [maxColumns, normalizedRows, preferredKeys]);
  const filteredRows = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const visibleRows = term
      ? normalizedRows.filter((row) => keys.some((key) => formatCell(row[key]).toLowerCase().includes(term)))
      : normalizedRows;
    if (!sort) return visibleRows;
    return [...visibleRows].sort((left, right) => compareCells(left[sort.key], right[sort.key], sort.direction));
  }, [filter, keys, normalizedRows, sort]);

  const totalPagesClient = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPageClient = Math.min(page, totalPagesClient);
  const pageRowsClient = filteredRows.slice((currentPageClient - 1) * pageSize, currentPageClient * pageSize);
  const firstRowClient = filteredRows.length ? (currentPageClient - 1) * pageSize + 1 : 0;
  const lastRowClient = Math.min(currentPageClient * pageSize, filteredRows.length);

  const totalPagesServer = serverTotal > 0 && serverLimit > 0 ? Math.max(1, Math.ceil(serverTotal / serverLimit)) : 1;
  const currentPageServer = serverLimit > 0 ? Math.floor(serverOffset / serverLimit) + 1 : 1;
  const pageRowsServer = filteredRows;
  const firstRowServer = serverTotal === 0 ? 0 : serverOffset + 1;
  const lastRowServer = serverTotal === 0 ? 0 : Math.min(serverOffset + rows.length, serverTotal);

  const totalPages = isServer ? totalPagesServer : totalPagesClient;
  const currentPage = isServer ? currentPageServer : currentPageClient;
  const pageRows = isServer ? pageRowsServer : pageRowsClient;
  const firstRow = isServer ? firstRowServer : firstRowClient;
  const lastRow = isServer ? lastRowServer : lastRowClient;
  const rangeTotal = isServer ? serverTotal : filteredRows.length;

  const maxServerOffset =
    serverTotal > 0 && serverLimit > 0 ? Math.max(0, Math.floor((serverTotal - 1) / serverLimit) * serverLimit) : 0;
  const canServerPrev = serverTotal > 0 && serverOffset > 0;
  const canServerNext = serverTotal > 0 && serverOffset + serverLimit < serverTotal;

  useEffect(() => {
    if (isServer) return;
    setPage(1);
  }, [filter, isServer, pageSize, rows]);

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
          <select
            value={isServer ? serverLimit : pageSize}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (isServer) {
                pagination!.onChange({ limit: value, offset: 0 });
              } else {
                setPageSize(value);
              }
            }}
          >
            {[10, 25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
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
                <tr key={isServer ? `s-${serverOffset}-${index}` : `${currentPageClient}-${index}`}>
                  {keys.map((key) => (
                    <td className={isLongCell(key, row[key]) ? "long-cell" : ""} key={key}>
                      {renderCell(key, row[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">No matching rows</p>
      )}

      <div className="pagination">
        <span>
          {firstRow}-{lastRow} of {rangeTotal}
        </span>
        <div>
          {isServer ? (
            <>
              <button
                type="button"
                disabled={!canServerPrev}
                onClick={() => pagination!.onChange({ limit: serverLimit, offset: 0 })}
              >
                First
              </button>
              <button
                type="button"
                disabled={!canServerPrev}
                onClick={() => pagination!.onChange({ limit: serverLimit, offset: Math.max(0, serverOffset - serverLimit) })}
              >
                Previous
              </button>
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                disabled={!canServerNext}
                onClick={() => pagination!.onChange({ limit: serverLimit, offset: Math.min(maxServerOffset, serverOffset + serverLimit) })}
              >
                Next
              </button>
              <button
                type="button"
                disabled={!canServerNext}
                onClick={() => pagination!.onChange({ limit: serverLimit, offset: maxServerOffset })}
              >
                Last
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={currentPage === 1} onClick={() => setPage(1)}>
                First
              </button>
              <button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                Previous
              </button>
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <button type="button" disabled={currentPage === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>
                Next
              </button>
              <button type="button" disabled={currentPage === totalPages} onClick={() => setPage(totalPages)}>
                Last
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
