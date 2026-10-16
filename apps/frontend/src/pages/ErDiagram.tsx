import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ErFlow from "../components/ErFlow";
import {
  createSnapshot, deleteSnapshot, getGraph, getSchemas, listConnections, listSnapshots,
  type Connection, type Graph, type Snapshot,
} from "../lib/api";

export default function ErDiagram() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState<number | null>(null);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [schema, setSchema] = useState("");
  const [graph, setGraph] = useState<Graph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [label, setLabel] = useState("");
  const [notice, setNotice] = useState("");

  const loadSnapshots = () => listSnapshots().then(setSnapshots).catch((e: Error) => setError(e.message));

  useEffect(() => {
    listConnections()
      .then((c) => { setConnections(c); if (c.length) setConnectionId(c[0].id); })
      .catch((e: Error) => setError(e.message));
    loadSnapshots();
  }, []);

  useEffect(() => {
    setGraph(null); setSchemas([]); setSchema("");
    if (connectionId === null) return;
    let cancelled = false;
    getSchemas(connectionId)
      .then((s) => { if (!cancelled) { setSchemas(s); setSchema(s.includes("public") ? "public" : s[0] ?? ""); } })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [connectionId]);

  useEffect(() => {
    if (connectionId === null || !schema) return;
    let cancelled = false;
    setLoading(true); setError(""); setGraph(null);
    getGraph(connectionId, schema)
      .then((g) => !cancelled && setGraph(g))
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [connectionId, schema]);

  const inferred = graph?.relationships.filter((r) => r.kind === "inferred") ?? [];

  const onSnapshot = async () => {
    if (connectionId === null || !schema) return;
    setNotice(""); setError("");
    try {
      await createSnapshot(connectionId, schema, label);
      setLabel(""); setNotice("Snapshot saved.");
      await loadSnapshots();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save snapshot");
    }
  };

  const onDeleteSnapshot = async (id: number) => {
    if (!window.confirm("Delete this snapshot?")) return;
    try { await deleteSnapshot(id); await loadSnapshots(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to delete snapshot"); }
  };

  if (connections.length === 0 && !error) {
    return (
      <p className="text-sm text-slate-400">
        No saved connections. <Link to="/databases" className="text-cyan-300 underline">Create one in Databases</Link> first.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">ER Diagram</h1>
        <select value={connectionId ?? ""} onChange={(e) => setConnectionId(Number(e.target.value))}
          className="rounded-md border border-slate-700 bg-surface px-2 py-1.5 text-sm">
          {connections.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.engine})</option>)}
        </select>
        <select value={schema} onChange={(e) => setSchema(e.target.value)}
          className="rounded-md border border-slate-700 bg-surface px-2 py-1.5 text-sm">
          {schemas.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="ml-auto flex gap-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder="Snapshot label (optional)"
            className="w-56 rounded-md border border-slate-700 bg-transparent px-2 py-1.5 text-sm" />
          <button onClick={onSnapshot} disabled={!graph} className="rounded-md border border-slate-600 px-3 py-1.5 text-sm disabled:opacity-40">
            Save snapshot
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-emerald-400">{notice}</p>}
      {loading && <p className="text-sm text-slate-400">Reading schema...</p>}
      {graph && graph.tables.length === 0 && <p className="text-sm text-slate-400">This schema has no tables.</p>}
      {graph?.truncated && (
        <p className="text-sm text-amber-300">Only the first 200 tables are shown. Relationships to other tables are missing.</p>
      )}
      {graph && graph.omitted_cross_schema_fks > 0 && (
        <p className="text-sm text-amber-300">{graph.omitted_cross_schema_fks} foreign key(s) point to other schemas and are not drawn.</p>
      )}

      {graph && graph.tables.length > 0 && <ErFlow graph={graph} height="68vh" filename={`er-${schema}.png`} />}

      {graph && (
        <p className="text-xs text-slate-400">
          <span className="text-cyan-300">Solid cyan</span> = real foreign key constraint.{" "}
          <span className="text-amber-300">Dashed amber</span> = inferred from column names only, not a database constraint.
        </p>
      )}
      {inferred.length > 0 && (
        <ul className="space-y-1 text-xs text-slate-400">
          {inferred.map((r) => <li key={r.id}>{r.source_table}.{r.source_columns[0]} → {r.target_table}: {r.reason}</li>)}
        </ul>
      )}

      <div className="pt-4">
        <h2 className="text-lg font-medium">Snapshots</h2>
        {snapshots.length === 0 && <p className="mt-1 text-sm text-slate-400">No snapshots yet.</p>}
        <ul className="mt-2 space-y-1">
          {snapshots.map((s) => (
            <li key={s.id} className="flex items-center justify-between rounded border border-slate-800 bg-surface px-3 py-2 text-sm">
              <span>{s.label} <span className="text-xs text-slate-500">· {s.connection_name}{s.connection_id === null && " (deleted)"} · {s.engine} · {s.table_count} tables</span></span>
              <button onClick={() => onDeleteSnapshot(s.id)} className="text-xs text-red-400 hover:text-red-300">Delete</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
