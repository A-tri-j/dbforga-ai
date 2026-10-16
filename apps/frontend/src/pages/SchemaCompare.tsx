import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  compareSchemas, getSchemas, listConnections, listSnapshots,
  type CompareResult, type Connection, type SchemaRef, type Snapshot,
} from "../lib/api";

type Side = { type: "live" | "snapshot"; connectionId: number | null; schema: string; snapshotId: number | null };
const emptySide: Side = { type: "live", connectionId: null, schema: "", snapshotId: null };

const toRef = (s: Side): SchemaRef =>
  s.type === "live"
    ? { type: "live", connection_id: s.connectionId, schema_name: s.schema }
    : { type: "snapshot", snapshot_id: s.snapshotId };
const ready = (s: Side) => (s.type === "live" ? s.connectionId !== null && !!s.schema : s.snapshotId !== null);

const sel = "rounded-md border border-slate-700 bg-surface px-2 py-1.5 text-sm";

function SideSelector({ title, side, onChange, connections, snapshots }: {
  title: string; side: Side; onChange: (s: Side) => void; connections: Connection[]; snapshots: Snapshot[];
}) {
  const [schemas, setSchemas] = useState<string[]>([]);

  useEffect(() => {
    if (side.type !== "live" || side.connectionId === null) { setSchemas([]); return; }
    let cancelled = false;
    getSchemas(side.connectionId)
      .then((s) => {
        if (cancelled) return;
        setSchemas(s);
        if (!s.includes(side.schema)) onChange({ ...side, schema: s.includes("public") ? "public" : s[0] ?? "" });
      })
      .catch(() => !cancelled && setSchemas([]));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side.type, side.connectionId]);

  return (
    <div className="space-y-2 rounded-lg border border-slate-800 bg-surface p-3">
      <div className="text-sm font-medium">{title}</div>
      <select value={side.type} onChange={(e) => onChange({ ...side, type: e.target.value as Side["type"] })} className={`${sel} w-full`}>
        <option value="live">Live database</option>
        <option value="snapshot">Saved snapshot</option>
      </select>
      {side.type === "live" ? (
        <div className="flex gap-2">
          <select value={side.connectionId ?? ""} onChange={(e) => onChange({ ...side, connectionId: e.target.value ? Number(e.target.value) : null, schema: "" })} className={`${sel} flex-1`}>
            <option value="">Connection...</option>
            {connections.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.engine})</option>)}
          </select>
          <select value={side.schema} onChange={(e) => onChange({ ...side, schema: e.target.value })} className={`${sel} flex-1`}>
            {schemas.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      ) : (
        <select value={side.snapshotId ?? ""} onChange={(e) => onChange({ ...side, snapshotId: e.target.value ? Number(e.target.value) : null })} className={`${sel} w-full`}>
          <option value="">Snapshot...</option>
          {snapshots.map((s) => <option key={s.id} value={s.id}>{s.label} ({s.engine})</option>)}
        </select>
      )}
    </div>
  );
}

export default function SchemaCompare() {
  const navigate = useNavigate();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [base, setBase] = useState<Side>(emptySide);
  const [desired, setDesired] = useState<Side>(emptySide);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    listConnections().then(setConnections).catch((e: Error) => setError(e.message));
    listSnapshots().then(setSnapshots).catch((e: Error) => setError(e.message));
  }, []);

  const onCompare = async () => {
    setBusy(true); setError(""); setResult(null); setNotice("");
    try { setResult(await compareSchemas(toRef(base), toRef(desired))); }
    catch (e) { setError(e instanceof Error ? e.message : "Comparison failed"); }
    finally { setBusy(false); }
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setNotice("Copied."); }
    catch { setNotice("Copy failed. Select the text and copy manually."); }
  };

  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold">Schema Compare</h1>
      <p className="text-sm text-slate-400">
        The migration preview turns <b>Base</b> into <b>Desired</b>. Both sides must use the same database engine. Nothing is executed.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <SideSelector title="Base (current)" side={base} onChange={setBase} connections={connections} snapshots={snapshots} />
        <SideSelector title="Desired (target state)" side={desired} onChange={setDesired} connections={connections} snapshots={snapshots} />
      </div>
      <button onClick={onCompare} disabled={busy || !ready(base) || !ready(desired)}
        className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-40">
        {busy ? "Comparing..." : "Compare"}
      </button>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-emerald-400">{notice}</p>}

      {result && (
        <div className="space-y-4 text-sm">
          <p className="text-slate-400">{result.base_label} → {result.desired_label} ({result.engine})</p>
          {result.identical && <p className="text-emerald-400">The schemas are identical (tables, columns, foreign keys, indexes).</p>}

          {result.tables_added.length > 0 && <p><span className="text-emerald-400">Tables to add:</span> {result.tables_added.join(", ")}</p>}
          {result.tables_removed.length > 0 && <p><span className="text-red-400">Tables to remove:</span> {result.tables_removed.join(", ")}</p>}

          {result.tables_changed.map((t) => (
            <div key={t.table} className="rounded-lg border border-slate-800 bg-surface p-3">
              <div className="font-medium text-cyan-200">{t.table}</div>
              <ul className="mt-1 space-y-0.5 text-xs text-slate-300">
                {t.columns_added.map((c) => <li key={`a${c.name}`} className="text-emerald-400">+ column {c.name} {c.type}</li>)}
                {t.columns_removed.map((c) => <li key={`r${c.name}`} className="text-red-400">- column {c.name}</li>)}
                {t.columns_changed.map((c) => <li key={`c${c.name}`} className="text-amber-300">~ column {c.name}: {c.changes.join("; ")}</li>)}
                {t.fks_added.map((f, i) => <li key={`fa${i}`} className="text-emerald-400">+ foreign key ({f.columns.join(", ")}) → {f.ref_table}</li>)}
                {t.fks_removed.map((f, i) => <li key={`fr${i}`} className="text-red-400">- foreign key ({f.columns.join(", ")}) → {f.ref_table}</li>)}
                {t.indexes_added.map((x, i) => <li key={`ia${i}`} className="text-emerald-400">+ index {x.name} ({x.columns.join(", ")})</li>)}
                {t.indexes_removed.map((x, i) => <li key={`ir${i}`} className="text-red-400">- index {x.name} ({x.columns.join(", ")})</li>)}
                {t.primary_key_changed && <li className="text-amber-300">~ primary key: ({t.primary_key_changed.from.join(", ")}) → ({t.primary_key_changed.to.join(", ")})</li>}
              </ul>
            </div>
          ))}

          {result.warnings.length > 0 && (
            <ul className="space-y-1 text-xs text-amber-300">{result.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}</ul>
          )}

          {result.statements.length > 0 && (
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-medium">Migration preview</h2>
                <span className="text-xs text-slate-500">Preview only, never executed automatically</span>
                <button onClick={() => copy(result.statements.map((s) => s.sql).join("\n\n"))} className="ml-auto rounded border border-slate-600 px-2 py-1 text-xs">Copy all</button>
              </div>
              <ul className="mt-2 space-y-2">
                {result.statements.map((s, i) => (
                  <li key={i} className="rounded-lg border border-slate-800 bg-surface p-3">
                    {s.destructive && <span className="mb-1 inline-block rounded bg-red-500/20 px-1.5 py-0.5 text-xs text-red-300">destructive</span>}
                    <pre className="whitespace-pre-wrap font-mono text-xs text-slate-200">{s.sql}</pre>
                    <div className="mt-2 flex gap-3 text-xs">
                      <button onClick={() => copy(s.sql)} className="text-cyan-300">Copy</button>
                      <button onClick={() => navigate("/sql", { state: { sql: s.sql, connectionId: base.type === "live" ? base.connectionId : null } })} className="text-cyan-300">Open in editor</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
