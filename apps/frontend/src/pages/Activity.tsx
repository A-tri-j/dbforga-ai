import { useEffect, useState } from "react";
import { getAudit, type AuditItem } from "../lib/api";
import { parseServerDate } from "../lib/format";

const PAGE = 50;

const LABELS: Record<string, string> = {
  "login.ok": "Signed in", "login.failed": "Failed sign-in attempt", "account.register": "Account created",
  "connection.create": "Connection added", "connection.update": "Connection edited", "connection.delete": "Connection deleted",
  "ai_key.save": "AI key saved", "ai_key.remove": "AI key removed",
  "import.run": "File import run", "pdf_import.run": "PDF import run", "index.create": "Index created",
  "data.export": "Data exported", "history.clear": "History cleared",
  "query.write": "Write statement run", "query.destructive": "Destructive statement run",
  "policy.blocked": "Blocked by security settings", "security.update": "Security settings changed",
  "security.denied": "Security change refused",
};
const RISKY = new Set(["login.failed", "query.destructive", "policy.blocked", "security.denied", "data.export", "history.clear"]);

const FILTERS: [string, string][] = [
  ["all", "All"], ["risky", "Needs attention"], ["login", "Sign-ins"], ["connection", "Connections"],
  ["query", "Queries"], ["security", "Security"],
];

export default function Activity() {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  const load = async (offset: number) => {
    try {
      const r = await getAudit(offset, PAGE);
      setItems((prev) => (offset ? [...prev, ...r] : r));
      setMore(r.length === PAGE);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the activity log");
    } finally { setLoading(false); }
  };
  useEffect(() => { load(0); }, []);

  const shown = items.filter((i) =>
    filter === "all" ? true : filter === "risky" ? RISKY.has(i.event) : i.event.startsWith(`${filter}.`) || (filter === "security" && i.event.startsWith("policy.")),
  );

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Activity</h1>
        <p className="text-sm text-slate-400">Important actions on your account. It records the type of action and the connection, never your SQL text or data. The last 1000 events are kept.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)} className={`rounded-md px-3 py-1.5 text-sm ${filter === id ? "bg-cyan-500/10 text-cyan-300" : "text-slate-400 hover:bg-slate-800/60"}`}>{label}</button>
        ))}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-slate-400">Loading...</p>}
      {!loading && shown.length === 0 && <p className="text-sm text-slate-400">Nothing here yet.</p>}
      <ul className="space-y-1.5">
        {shown.map((i) => (
          <li key={i.id} className={`flex flex-wrap items-center gap-x-4 gap-y-0.5 rounded-lg border px-3 py-2 text-sm ${RISKY.has(i.event) ? "border-amber-500/40 bg-amber-500/5" : "border-slate-800 bg-surface"}`}>
            <span className={`font-medium ${RISKY.has(i.event) ? "text-amber-300" : ""}`}>{LABELS[i.event] ?? i.event}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-slate-400">{i.detail}</span>
            {i.ip && <span className="text-xs text-slate-500">{i.ip}</span>}
            <span className="text-xs text-slate-500">{parseServerDate(i.created_at).toLocaleString()}</span>
          </li>
        ))}
      </ul>
      {more && <button onClick={() => load(items.length)} className="rounded-md border border-slate-600 px-3 py-2 text-sm">Load more</button>}
    </div>
  );
}
