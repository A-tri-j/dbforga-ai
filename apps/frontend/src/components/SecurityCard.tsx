import { useEffect, useState } from "react";
import { getSecurity, saveSecurity, type SecuritySettings } from "../lib/api";

const input = "w-28 rounded-md border border-slate-700 bg-transparent px-2 py-1.5 text-sm";

export default function SecurityCard() {
  const [saved, setSaved] = useState<SecuritySettings | null>(null);
  const [s, setS] = useState<SecuritySettings | null>(null);
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSecurity()
      .then((v) => { setSaved(v); setS(v); })
      .catch((e: Error) => setMsg({ ok: false, text: e.message }));
  }, []);

  if (!s || !saved) return <p className="text-sm text-slate-400">{msg ? msg.text : "Loading..."}</p>;

  const relaxes =
    (saved.force_read_only && !s.force_read_only) ||
    (saved.block_destructive && !s.block_destructive) ||
    s.query_timeout_seconds > saved.query_timeout_seconds ||
    s.max_rows > saved.max_rows;
  const changed = JSON.stringify(s) !== JSON.stringify(saved);

  const patch = (p: Partial<SecuritySettings>) => { setS({ ...s, ...p }); setMsg(null); };

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await saveSecurity({ ...s, password: password || null });
      setSaved(r); setS(r); setPassword("");
      setMsg({ ok: true, text: "Security settings saved. They apply to every device you sign in on." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not save" });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 rounded-xl border border-slate-800 bg-surface p-4">
      <p className="text-sm text-slate-400">The server enforces these. Even if someone uses your session in another tool, they cannot go around them.</p>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={s.force_read_only} onChange={(e) => patch({ force_read_only: e.target.checked })} />
        <span><b>Lock this account to read-only.</b> No write statements, imports or index creation, whatever the Read-only switch in the editor says.</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={s.block_destructive} onChange={(e) => patch({ block_destructive: e.target.checked })} />
        <span><b>Block destructive statements.</b> DROP, TRUNCATE, ALTER, UPDATE and DELETE (and MongoDB update, delete and drop) are refused.</span>
      </label>

      <div className="flex flex-wrap gap-6 text-sm">
        <label className="flex items-center gap-2">Query time limit
          <input type="number" min={5} max={120} className={input} value={s.query_timeout_seconds} onChange={(e) => patch({ query_timeout_seconds: Number(e.target.value) })} /> s
        </label>
        <label className="flex items-center gap-2">Max rows per result
          <input type="number" min={100} max={10000} step={100} className={input} value={s.max_rows} onChange={(e) => patch({ max_rows: Number(e.target.value) })} />
        </label>
      </div>

      {relaxes && (
        <div className="space-y-1">
          <input type="password" autoComplete="current-password" placeholder="Current password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-64 rounded-md border border-amber-500/50 bg-transparent px-3 py-2 text-sm" />
          <p className="text-xs text-amber-300">Relaxing a protection needs your password.</p>
        </div>
      )}

      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</p>}
      <button onClick={save} disabled={busy || !changed || (relaxes && !password)} className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-40">
        {busy ? "Saving..." : "Save security settings"}
      </button>
    </div>
  );
}
