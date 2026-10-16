import { useEffect, useState } from "react";
import { getSchemas, getTableDetail, getTables, type TableDetail } from "../lib/api";

export default function Explorer({ connectionId }: { connectionId: number }) {
  const [schemas, setSchemas] = useState<string[]>([]);
  const [tables, setTables] = useState<Record<string, string[]>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<TableDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const openSchema = async (schema: string) => {
    setOpen(schema);
    if (tables[schema]) return;
    try {
      const list = await getTables(connectionId, schema);
      setTables((t) => ({ ...t, [schema]: list }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tables");
    }
  };

  const openTable = async (schema: string, table: string) => {
    setError("");
    try {
      setDetail(await getTableDetail(connectionId, schema, table));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load table");
    }
  };

  useEffect(() => {
    let cancelled = false;
    setSchemas([]); setTables({}); setOpen(null); setDetail(null); setError(""); setLoading(true);
    getSchemas(connectionId)
      .then((s) => {
        if (cancelled) return;
        setSchemas(s);
        if (s.length === 1) openSchema(s[0]);
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  return (
    <div className="flex gap-4">
      <div className="w-60 shrink-0 rounded-lg border border-slate-800 bg-surface p-3 text-sm">
        {loading && <p className="text-slate-400">Loading schemas...</p>}
        {!loading && schemas.length === 0 && !error && <p className="text-slate-400">No schemas found.</p>}
        {schemas.map((s) => (
          <div key={s}>
            <button onClick={() => openSchema(s)} className="w-full py-1 text-left text-cyan-300">
              {open === s ? "▾" : "▸"} {s}
            </button>
            {open === s && (
              <ul className="ml-4">
                {tables[s] === undefined && <li className="text-slate-500">Loading...</li>}
                {tables[s]?.length === 0 && <li className="text-slate-500">No tables</li>}
                {tables[s]?.map((t) => (
                  <li key={t}>
                    <button
                      onClick={() => openTable(s, t)}
                      className={`w-full py-0.5 text-left hover:text-white ${
                        detail?.table === t && detail.schema === s ? "text-white" : "text-slate-400"
                      }`}
                    >
                      {t}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <div className="min-w-0 flex-1">
        {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
        {!detail && !error && <p className="text-sm text-slate-400">Select a table to see its structure.</p>}
        {detail && (
          <div className="space-y-4 text-sm">
            <h3 className="text-lg font-medium">{detail.schema}.{detail.table}</h3>
            <table className="w-full border border-slate-800">
              <thead className="bg-slate-900 text-left text-slate-400">
                <tr><th className="p-2">Column</th><th className="p-2">Type</th><th className="p-2">Null</th><th className="p-2">Default</th><th className="p-2">Key</th></tr>
              </thead>
              <tbody>
                {detail.columns.map((c) => (
                  <tr key={c.name} className="border-t border-slate-800">
                    <td className="p-2">{c.name}</td>
                    <td className="p-2 text-slate-400">{c.type}</td>
                    <td className="p-2">{c.nullable ? "YES" : "NO"}</td>
                    <td className="p-2 text-slate-400">{c.default ?? "-"}</td>
                    <td className="p-2 text-amber-300">{c.primary_key ? "PK" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div>
              <h4 className="mb-1 text-slate-400">Foreign keys</h4>
              {detail.foreign_keys.length === 0 && <p className="text-slate-500">None</p>}
              {detail.foreign_keys.map((fk, i) => (
                <p key={i}>
                  ({fk.columns.join(", ")}) → {fk.ref_schema}.{fk.ref_table}({fk.ref_columns.join(", ")})
                </p>
              ))}
            </div>
            <div>
              <h4 className="mb-1 text-slate-400">Indexes</h4>
              {detail.indexes.length === 0 && <p className="text-slate-500">None</p>}
              {detail.indexes.map((ix, i) => (
                <p key={i}>{ix.name} ({ix.columns.join(", ")}){ix.unique ? " · unique" : ""}</p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
