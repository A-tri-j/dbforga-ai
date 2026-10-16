import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  deleteImport, executeImport, getImportProfile, getSchemas, getTableDetail, getTables,
  listConnections, uploadImport,
  type Connection, type ImportProfile, type ImportReport,
} from "../lib/api";

const TYPES = ["integer", "bigint", "float", "boolean", "date", "timestamp", "varchar", "text"];
const field = "rounded-md border border-slate-700 bg-surface px-2 py-1.5 text-sm";

type ColState = {
  index: number; include: boolean; target: string; type: string;
  nullable: boolean; pk: boolean; original: string;
};

const initCols = (p: ImportProfile): ColState[] =>
  p.columns.map((c) => ({
    index: c.index, include: true, target: c.name, type: c.inferred_type,
    nullable: c.name !== p.suggested_primary_key, pk: c.name === p.suggested_primary_key,
    original: c.original_name,
  }));

export default function ImportData({ onImported, initialConnectionId }: {
  onImported?: (i: { connectionId: number; schema: string; table: string }) => void;
  initialConnectionId?: number | null;
} = {}) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState<number | null>(null);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [schema, setSchema] = useState("");
  const [profile, setProfile] = useState<ImportProfile | null>(null);
  const [cols, setCols] = useState<ColState[]>([]);
  const [mode, setMode] = useState<"create" | "append">("create");
  const [tableName, setTableName] = useState("");
  const [existingTables, setExistingTables] = useState<string[]>([]);
  const [existingCols, setExistingCols] = useState<string[]>([]);
  const [onError, setOnError] = useState<"abort" | "skip">("abort");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);

  useEffect(() => {
    listConnections()
      .then((c) => {
        setConnections(c);
        if (c.length) setConnectionId(c.find((x) => x.id === initialConnectionId)?.id ?? c[0].id);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    setSchemas([]); setSchema("");
    if (connectionId === null) return;
    let cancelled = false;
    getSchemas(connectionId)
      .then((s) => { if (!cancelled) { setSchemas(s); setSchema(s.includes("public") ? "public" : s[0] ?? ""); } })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [connectionId]);

  useEffect(() => {
    setExistingTables([]);
    if (mode !== "append" || connectionId === null || !schema) return;
    let cancelled = false;
    getTables(connectionId, schema)
      .then((t) => !cancelled && setExistingTables(t))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [mode, connectionId, schema]);

  useEffect(() => {
    setExistingCols([]);
    if (mode !== "append" || connectionId === null || !schema || !existingTables.includes(tableName)) return;
    let cancelled = false;
    getTableDetail(connectionId, schema, tableName)
      .then((d) => {
        if (cancelled) return;
        const names = d.columns.map((c) => c.name);
        setExistingCols(names);
        setCols((prev) => prev.map((c) => {
          const match = names.find((n) => n.toLowerCase() === c.target.toLowerCase() || n.toLowerCase() === c.original.toLowerCase());
          return { ...c, target: match ?? "", include: match !== undefined };
        }));
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [mode, connectionId, schema, tableName, existingTables]);

  const loadProfile = async (id: string, sheet?: string) => {
    const p = await getImportProfile(id, sheet);
    setProfile(p); setCols(initCols(p)); setTableName(p.suggested_table_name);
    setReport(null); setConfirm(false);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setError(""); setReport(null); setProfile(null);
    try {
      const up = await uploadImport(file);
      await loadProfile(up.import_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally { setBusy(false); }
  };

  const onSheet = async (sheet: string) => {
    if (!profile) return;
    setBusy(true); setError("");
    try { await loadProfile(profile.import_id, sheet); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to read sheet"); }
    finally { setBusy(false); }
  };

  const update = (index: number, patch: Partial<ColState>) =>
    setCols((prev) => prev.map((c) => (c.index === index ? { ...c, ...patch } : c)));

  const included = cols.filter((c) => c.include && c.target);

  const onRun = async () => {
    if (!profile || connectionId === null) return;
    setBusy(true); setError(""); setReport(null);
    try {
      const r = await executeImport(profile.import_id, {
        connection_id: connectionId, schema_name: schema, table_name: tableName, mode,
        sheet: profile.sheet, on_error: onError, confirm,
        columns: included.map((c) => ({
          source_index: c.index, target: c.target, type: c.type,
          nullable: c.nullable, primary_key: mode === "create" && c.pk,
        })),
      });
      setReport(r);
      if (r.status === "ok") onImported?.({ connectionId, schema, table: tableName });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally { setBusy(false); }
  };

  const onDiscard = async () => {
    if (profile) await deleteImport(profile.import_id).catch(() => undefined);
    setProfile(null); setReport(null); setCols([]); setConfirm(false);
  };

  if (connections.length === 0 && !error) {
    return (
      <p className="text-sm text-slate-400">
        No saved connections. <Link to="/databases" className="text-cyan-300 underline">Create one in Databases</Link> first.
      </p>
    );
  }

  const canRun = !busy && confirm && included.length > 0 && !!tableName && !!schema && connectionId !== null;

  return (
    <div className="max-w-5xl space-y-5">
      <h1 className="text-2xl font-semibold">Import data</h1>

      <div className="flex items-center gap-3">
        <input type="file" accept=".csv,.tsv,.txt,.xlsx" disabled={busy}
          onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }}
          className="text-sm text-slate-300" />
        <span className="text-xs text-slate-500">CSV, TSV or XLSX · max 20 MB · max 100,000 rows</span>
      </div>
      {busy && <p className="text-sm text-slate-400">Working...</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {profile && (
        <>
          <section className="space-y-2">
            <h2 className="text-lg font-medium">1. Profile: {profile.filename}</h2>
            <p className="text-sm text-slate-400">
              {profile.row_count} rows · {profile.columns.length} columns · {profile.duplicate_row_count} exact duplicate row(s)
              {profile.encoding && ` · encoding ${profile.encoding}`}
              {profile.delimiter && ` · delimiter ${JSON.stringify(profile.delimiter)}`}
            </p>
            {profile.sheets.length > 1 && (
              <label className="text-sm text-slate-300">Sheet{" "}
                <select value={profile.sheet ?? ""} onChange={(e) => onSheet(e.target.value)} className={field}>
                  {profile.sheets.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            )}
            <p className="text-sm text-slate-400">
              Key candidates (unique, no empty values): {profile.key_candidates.length ? profile.key_candidates.join(", ") : "none"}
              {" "}· Single-column keys only. Ambiguous dates and values with leading zeros are kept as text.
            </p>
            <div className="max-h-72 overflow-auto rounded-md border border-slate-800">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-900 text-left text-slate-300">
                  <tr><th className="p-2">Column</th><th className="p-2">Inferred</th><th className="p-2">Empty</th><th className="p-2">Distinct</th><th className="p-2">Samples</th></tr>
                </thead>
                <tbody>
                  {profile.columns.map((c) => (
                    <tr key={c.index} className="border-t border-slate-800/60">
                      <td className="p-2">{c.original_name}{c.original_name !== c.name && <span className="text-slate-500"> → {c.name}</span>}{c.is_key_candidate && <span className="ml-1 text-amber-300">key?</span>}</td>
                      <td className="p-2 text-cyan-300">{c.inferred_type}</td>
                      <td className="p-2">{c.null_count}</td>
                      <td className="p-2">{c.distinct_count}</td>
                      <td className="max-w-xs truncate p-2 text-slate-400">{c.samples.join(" | ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className="text-xs text-slate-400">
              <summary className="cursor-pointer">Preview first rows</summary>
              <div className="mt-2 max-h-60 overflow-auto rounded-md border border-slate-800">
                <table className="w-full">
                  <thead className="sticky top-0 bg-slate-900 text-left">
                    <tr>{profile.preview_columns.map((c, i) => <th key={i} className="whitespace-nowrap p-2">{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {profile.preview_rows.map((r, i) => (
                      <tr key={i} className="border-t border-slate-800/60">
                        {r.map((v, j) => <td key={j} className="max-w-xs truncate whitespace-nowrap p-2">{v}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium">2. Target and column mapping</h2>
            <div className="flex flex-wrap items-center gap-3">
              <select value={connectionId ?? ""} onChange={(e) => setConnectionId(Number(e.target.value))} className={field}>
                {connections.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.engine})</option>)}
              </select>
              <select value={schema} onChange={(e) => setSchema(e.target.value)} className={field}>
                {schemas.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={mode} onChange={(e) => { setMode(e.target.value as "create" | "append"); setTableName(e.target.value === "create" ? profile.suggested_table_name : ""); setCols(initCols(profile)); }} className={field}>
                <option value="create">Create new table</option>
                <option value="append">Append to existing table</option>
              </select>
              {mode === "create" ? (
                <input value={tableName} onChange={(e) => setTableName(e.target.value)} placeholder="Table name" className={field} />
              ) : (
                <select value={tableName} onChange={(e) => setTableName(e.target.value)} className={field}>
                  <option value="">Choose table...</option>
                  {existingTables.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              )}
            </div>

            <div className="max-h-96 overflow-auto rounded-md border border-slate-800">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-900 text-left text-slate-300">
                  <tr>
                    <th className="p-2">Use</th><th className="p-2">Source</th><th className="p-2">Target column</th>
                    {mode === "create" && <><th className="p-2">Type</th><th className="p-2">Nullable</th><th className="p-2">PK</th></>}
                  </tr>
                </thead>
                <tbody>
                  {cols.map((c) => (
                    <tr key={c.index} className="border-t border-slate-800/60">
                      <td className="p-2"><input type="checkbox" checked={c.include} onChange={(e) => update(c.index, { include: e.target.checked })} /></td>
                      <td className="p-2">{c.original}</td>
                      <td className="p-2">
                        {mode === "create" ? (
                          <input value={c.target} onChange={(e) => update(c.index, { target: e.target.value })} className={`${field} w-48`} />
                        ) : (
                          <select value={c.target} onChange={(e) => update(c.index, { target: e.target.value, include: e.target.value !== "" })} className={`${field} w-48`}>
                            <option value="">(skip)</option>
                            {existingCols.map((n) => <option key={n} value={n}>{n}</option>)}
                          </select>
                        )}
                      </td>
                      {mode === "create" && (
                        <>
                          <td className="p-2">
                            <select value={c.type} onChange={(e) => update(c.index, { type: e.target.value })} className={field}>
                              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </td>
                          <td className="p-2"><input type="checkbox" checked={c.nullable && !c.pk} disabled={c.pk} onChange={(e) => update(c.index, { nullable: e.target.checked })} /></td>
                          <td className="p-2"><input type="checkbox" checked={c.pk} onChange={(e) => update(c.index, { pk: e.target.checked })} /></td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500">
              {mode === "create"
                ? "Proposed schema only: review types, NOT NULL and the primary key. An integer key is created as a plain INTEGER, not auto-increment. varchar columns are VARCHAR(255)."
                : "Values are validated against the existing column types."}
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium">3. Import</h2>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              If rows are invalid:
              <select value={onError} onChange={(e) => setOnError(e.target.value as "abort" | "skip")} className={field}>
                <option value="abort">Import nothing</option>
                <option value="skip">Skip invalid rows, import the rest</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
              I confirm this writes {profile.row_count} row(s) into {schema ? `${schema}.` : ""}{tableName || "…"} ({mode === "create" ? "new table" : "existing table"}).
            </label>
            <div className="flex gap-2">
              <button onClick={onRun} disabled={!canRun} className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-40">
                {busy ? "Importing..." : "Run import"}
              </button>
              <button onClick={onDiscard} className="rounded-md border border-slate-600 px-4 py-2 text-sm">Discard upload</button>
            </div>
          </section>

          {report && (
            <section className="space-y-2 rounded-lg border border-slate-800 bg-surface p-4 text-sm">
              <p className={report.status === "ok" ? "text-emerald-400" : "text-red-400"}>{report.message}</p>
              <p className="text-slate-400">
                Read {report.rows_read} · valid {report.rows_valid} · invalid {report.rows_invalid} · inserted {report.rows_inserted}
                {report.db_rows_after !== null && ` · table rows ${report.db_rows_before} → ${report.db_rows_after} (verified in the database)`}
              </p>
              {report.errors.length > 0 && (
                <div className="max-h-72 overflow-auto rounded-md border border-slate-800">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-900 text-left text-slate-300">
                      <tr><th className="p-2">File row</th><th className="p-2">Column</th><th className="p-2">Value</th><th className="p-2">Problem</th></tr>
                    </thead>
                    <tbody>
                      {report.errors.map((e, i) => (
                        <tr key={i} className="border-t border-slate-800/60">
                          <td className="p-2">{e.row}</td><td className="p-2">{e.column}</td>
                          <td className="max-w-xs truncate p-2">{e.value}</td><td className="p-2 text-red-300">{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {report.errors_truncated && <p className="text-xs text-amber-300">{report.error_count} problems in total, showing the first {report.errors.length}.</p>}
            </section>
          )}
        </>
      )}
    </div>
  );
}
