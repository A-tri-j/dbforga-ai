import { useMemo } from "react";
import {
  flexRender, getCoreRowModel, getPaginationRowModel, useReactTable, type ColumnDef,
} from "@tanstack/react-table";

export default function ResultGrid({ columns, rows }: { columns: string[]; rows: unknown[][] }) {
  const defs = useMemo<ColumnDef<unknown[]>[]>(
    () =>
      columns.map((name, i) => ({
        id: String(i), // index id: duplicate column names are allowed in SQL
        header: name,
        accessorFn: (r) => r[i],
        cell: (c) => {
          const v = c.getValue();
          return v === null ? <span className="italic text-slate-500">NULL</span> : String(v);
        },
      })),
    [columns],
  );

  const table = useReactTable({
    data: rows,
    columns: defs,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize: 50 } },
  });

  const { pageIndex, pageSize } = table.getState().pagination;

  return (
    <div className="text-sm">
      <div className="max-h-96 overflow-auto rounded-md border border-slate-800">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-slate-900 text-left text-slate-300">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} className="whitespace-nowrap border-b border-slate-800 p-2 font-medium">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-800/60 hover:bg-slate-800/30">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="max-w-xs truncate whitespace-nowrap p-2">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex items-center gap-3 text-slate-400">
        <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} className="rounded border border-slate-700 px-2 py-1 disabled:opacity-40">Prev</button>
        <span>Page {pageIndex + 1} of {Math.max(table.getPageCount(), 1)}</span>
        <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} className="rounded border border-slate-700 px-2 py-1 disabled:opacity-40">Next</button>
        <select
          value={pageSize}
          onChange={(e) => table.setPageSize(Number(e.target.value))}
          className="rounded border border-slate-700 bg-surface px-2 py-1"
        >
          {[25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
        </select>
      </div>
    </div>
  );
}
