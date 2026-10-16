import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  analyzeQuery, cancelQuery, createIndex, getSchemas, listConnections,
  type AnalyzeResult, type Connection, type IndexRec, type PlanNode,
} from "../lib/api";

const field = "rounded-md border border-slate-700 bg-surface px-2 py-1.5 text-sm";
const num = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? "n/a" : n.toFixed(d));

function PlanTree({ node, depth, flagged }: { node: PlanNode; depth: number; flagged: Set<number> }) {
  return (
    <div style={{ marginLeft: depth ? 16 : 0 }} className="border-l border-slate-800 pl-3">
      <div className={`my-1 rounded-md border px-3 py-2 text-xs ${node.is_full_scan ? "border-amber-500/40 bg-amber-500/5" : "border-slate-800 bg-surface"}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="font-semibold text-slate-100">{node.node_type ?? "Node"}</span>
          {node.relation && <span className="text-cyan-300">{node.relation}</span>}
          {node.index_name && <span className="text-emerald-300">index {node.index_name}</span>}
          {flagged.has(node.id) && <span className="text-amber-300">⚠ see findings</span>}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 text-slate-400">
          <span>cost {num(node.cost_total, 0)}</span>
          <span>est. rows {node.plan_rows ?? "n/a"}</span>
          {node.actual_rows !== null && <span>actual rows {node.actual_rows}{node.loops && node.loops > 1 ? ` × ${node.loops} loops` : ""}</span>}
          {node.actual_time_ms !== null && <span>time {num(node.actual_time_ms, 2)} ms</span>}
          {node.rows_removed !== null && <span>filtered out {node.rows_removed}</span>}
        </div>
        {node.filter && <div className="mt-1 truncate font-mono text-slate-500" title={node.filter}>filter: {node.filter}</div>}
        {node.condition && <div className="truncate font-mono text-slate-500" title={node.condition}>cond: {node.condition}</div>}
      </div>
      {node.children.map((c) => <PlanTree key={c.id} node={c} depth={depth + 1} flagged={flagged} />)}
    </div>
  );
}

export default function Performance() {
  const location = useLocation();
  const incoming = location.state as { sql?: string; connectionId?: number | null } | null;

  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState<number | null>(null);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [schema, setSchema] = useState("");
  const [sql, setSql] = useState(incoming?.sql ?? "");
  const [execute, setExecute] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const queryIdRef = useRef("");

  useEffect(() => {
    listConnections()
      .then((c) => {
        setConnections(c);
        const wanted = c.find((x) => x.id === incoming?.connectionId);
        if (c.length) setConnectionId(wanted ? wanted.id : c[0].id);
      })
      .catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const run = async () => {
    if (connectionId === null || !schema || !sql.trim()) return;
    setRunning(true); setError(""); setNotice(""); setResult(null);
    const id = crypto.randomUUID();
    queryIdRef.current = id;
    try {
      setResult(await analyzeQuery(connectionId, { sql, schema_name: schema, query_id: id, execute }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally { setRunning(false); }
  };

  const cancel = () => {
    if (connectionId !== null) cancelQuery(connectionId, queryIdRef.current).catch(() => undefined);
  };

  const onCreateIndex = async (rec: IndexRec) => {
    if (connectionId === null) return;
    const ok = window.confirm(
      `Create this index?\n\n${rec.sql}\n\nThis changes your database and can block writes on large tables.`,
    );
    if (!ok) return;
    setError(""); setNotice("");
    try {
      const r = await createIndex(connectionId, { schema_name: rec.schema_name, table: rec.table, columns: rec.columns, confirm: true });
      setNotice(`Created index ${r.index_name}. Run the analysis again to compare the plans.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Index creation failed");
    }
  };

  const flagged = new Set((result?.findings ?? []).filter((f) => f.severity === "warning" && f.node_id !== null).map((f) => f.node_id as number));
  const s = result?.summary;

  if (connections.length === 0 && !error) {
    return <p className="text-sm text-slate-400">No saved connections. <Link to="/databases" className="text-cyan-300 underline">Create one in Databases</Link> first.</p>;
  }

  return (
    <div className="max-w-5xl space-y-4">
      <h1 className="text-2xl font-semibold">Performance Analyzer</h1>
      <div className="flex flex-wrap items-center gap-3">
        <select value={connectionId ?? ""} onChange={(e) => setConnectionId(Number(e.target.value))} className={field}>
          {connections.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.engine})</option>)}
        </select>
        <select value={schema} onChange={(e) => setSchema(e.target.value)} className={field}>
          {schemas.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </div>

      <textarea rows={6} value={sql} onChange={(e) => setSql(e.target.value)} placeholder="Paste one SELECT, INSERT, UPDATE or DELETE statement..."
        className="w-full rounded-md border border-slate-700 bg-transparent px-3 py-2 font-mono text-sm" />

      <label className="flex items-start gap-2 text-sm text-slate-300">
        <input type="checkbox" className="mt-1" checked={execute} onChange={(e) => setExecute(e.target.checked)} />
        <span>
          Measure actual execution (EXPLAIN ANALYZE). This <b>runs</b> the query once, SELECT only, in a read-only transaction with a 30s limit.
          {" "}Off by default: the plan below is then the database's estimate and nothing is executed.
        </span>
      </label>

      <div className="flex gap-2">
        {running ? (
          <button onClick={cancel} className="rounded-md bg-red-500 px-4 py-2 text-sm font-medium text-[#ffffff]">Cancel</button>
        ) : (
          <button onClick={run} disabled={!sql.trim() || !schema} className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-40">Analyze</button>
        )}
      </div>

      {running && <p className="text-sm text-slate-400">Analyzing...</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-emerald-400">{notice}</p>}
      {result && result.status !== "ok" && <p className="text-sm text-red-400">{result.message}</p>}

      {result?.status === "ok" && s && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <div className={`rounded-xl border p-3 ${s.health === "ok" ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
              <div className="text-xs uppercase text-slate-400">Health</div>
              <div className={`text-lg font-semibold ${s.health === "ok" ? "text-emerald-400" : "text-amber-300"}`}>{s.health === "ok" ? "No warnings" : "Needs attention"}</div>
            </div>
            {[
              ["Estimated cost", num(s.total_cost, 0)],
              ["Full scans", String(s.full_scans ?? 0)],
              ["Index scans", String(s.index_scans ?? 0)],
              [result.analyzed ? "Execution time" : "Execution time", result.analyzed && s.execution_ms != null ? `${num(s.execution_ms, 2)} ms` : "not measured"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-slate-800 bg-surface p-3">
                <div className="text-xs uppercase text-slate-400">{label}</div>
                <div className="text-lg font-semibold">{value}</div>
              </div>
            ))}
          </div>

          {result.findings.length > 0 && (
            <section>
              <h2 className="mb-2 text-lg font-medium">Findings</h2>
              <ul className="space-y-2">
                {result.findings.map((f, i) => (
                  <li key={i} className={`rounded-lg border p-3 text-sm ${f.severity === "warning" ? "border-amber-500/40 bg-amber-500/5" : "border-slate-800 bg-surface"}`}>
                    <div className={f.severity === "warning" ? "font-medium text-amber-300" : "font-medium text-slate-200"}>{f.severity === "warning" ? "⚠ " : "ℹ "}{f.title}</div>
                    <p className="mt-0.5 text-xs text-slate-400">{f.detail}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {result.recommendations.length > 0 && (
            <section>
              <h2 className="mb-2 text-lg font-medium">Index suggestions</h2>
              <ul className="space-y-2">
                {result.recommendations.map((r, i) => (
                  <li key={i} className="rounded-lg border border-slate-800 bg-surface p-3 text-sm">
                    <p>{r.reason}</p>
                    <pre className="mt-2 overflow-auto rounded bg-slate-900 p-2 font-mono text-xs">{r.sql}</pre>
                    <p className="mt-2 text-xs text-amber-300/80">{r.caveat}</p>
                    <button onClick={() => onCreateIndex(r)} className="mt-2 rounded-md border border-cyan-500/50 px-3 py-1.5 text-xs text-cyan-300">Create index (asks to confirm)</button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {result.findings.length === 0 && <p className="text-sm text-emerald-400">No problems detected in this plan.</p>}

          <section>
            <h2 className="mb-2 text-lg font-medium">Query plan</h2>
            {result.raw_text ? (
              <pre className="overflow-auto rounded-md bg-slate-900 p-3 font-mono text-xs">{result.raw_text}</pre>
            ) : (
              result.plan.map((n) => <PlanTree key={n.id} node={n} depth={0} flagged={flagged} />)
            )}
          </section>
        </div>
      )}
    </div>
  );
}
