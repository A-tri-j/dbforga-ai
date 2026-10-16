import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  clearHistory, deleteHistoryItem, deleteSavedQuery, listHistory, listSavedQueries,
  type HistoryItem, type SavedQuery,
} from "../lib/api";

const PAGE = 50;

// SQLite returns timestamps without a timezone suffix; treat those as UTC.
const fmt = (iso: string) =>
  new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`).toLocaleString();

const statusColor: Record<string, string> = {
  ok: "text-emerald-400", error: "text-red-400", timeout: "text-red-400", cancelled: "text-amber-300",
};

function HistoryTab() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      listHistory(q, 0)
        .then((r) => {
          if (cancelled) return;
          setItems(r);
          setHasMore(r.length === PAGE);
          setError("");
        })
        .catch((e: Error) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setLoading(false));
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  const loadMore = async () => {
    try {
      const r = await listHistory(q, items.length);
      setItems((prev) => [...prev, ...r]);
      setHasMore(r.length === PAGE);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load more");
    }
  };

  const remove = async (id: number) => {
    try {
      await deleteHistoryItem(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const clearAll = async () => {
    if (!window.confirm("Delete all query history?")) return;
    try {
      await clearHistory();
      setItems([]);
      setHasMore(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to clear history");
    }
  };

  return (
    <div>
      <div className="flex gap-2">
        <input
          value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SQL text..."
          className="flex-1 rounded-md border border-slate-700 bg-transparent px-3 py-2 text-sm"
        />
        <button onClick={clearAll} className="rounded-md border border-red-500/50 px-3 py-2 text-sm text-red-400">
          Clear all
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {loading && <p className="mt-4 text-sm text-slate-400">Loading...</p>}
      {!loading && items.length === 0 && (
        <p className="mt-4 text-sm text-slate-400">
          {q ? "No queries match your search." : "No history yet. Run a query in the SQL Editor."}
        </p>
      )}
      <ul className="mt-4 space-y-2">
        {items.map((i) => (
          <li key={i.id} className="rounded-lg border border-slate-800 bg-surface p-3">
            <div className="flex flex-wrap items-center gap-x-3 text-xs text-slate-400">
              <span className="font-medium text-slate-200">{i.statement_type}</span>
              <span className={statusColor[i.status] ?? ""}>{i.status}</span>
              <span>{i.connection_name}{i.connection_id === null && " (deleted)"}</span>
              <span>{i.duration_ms} ms</span>
              {i.status === "ok" && i.row_count > 0 && <span>{i.row_count} rows</span>}
              <span className="ml-auto">{fmt(i.created_at)}</span>
            </div>
            <pre className="mt-2 line-clamp-3 whitespace-pre-wrap font-mono text-xs text-slate-300">{i.sql}</pre>
            <div className="mt-2 flex gap-3 text-xs">
              <button
                onClick={() => navigate("/sql", { state: { sql: i.sql, connectionId: i.connection_id } })}
                className="text-cyan-300 hover:text-cyan-200"
              >
                Open in editor
              </button>
              <button onClick={() => remove(i.id)} className="text-red-400 hover:text-red-300">Delete</button>
            </div>
          </li>
        ))}
      </ul>
      {hasMore && (
        <button onClick={loadMore} className="mt-4 rounded-md border border-slate-600 px-3 py-2 text-sm">Load more</button>
      )}
    </div>
  );
}

function SavedTab() {
  const navigate = useNavigate();
  const [items, setItems] = useState<SavedQuery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    listSavedQueries()
      .then(setItems)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const remove = async (id: number) => {
    if (!window.confirm("Delete this saved query?")) return;
    try {
      await deleteSavedQuery(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  return (
    <div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-slate-400">Loading...</p>}
      {!loading && items.length === 0 && (
        <p className="text-sm text-slate-400">No saved queries. Use "Save" in the SQL Editor.</p>
      )}
      <ul className="space-y-2">
        {items.map((i) => (
          <li key={i.id} className="rounded-lg border border-slate-800 bg-surface p-3">
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span className="text-sm font-medium text-slate-200">{i.name}</span>
              <span className="ml-auto">{fmt(i.created_at)}</span>
            </div>
            <pre className="mt-2 line-clamp-3 whitespace-pre-wrap font-mono text-xs text-slate-300">{i.sql}</pre>
            <div className="mt-2 flex gap-3 text-xs">
              <button
                onClick={() => navigate("/sql", { state: { sql: i.sql, connectionId: i.connection_id } })}
                className="text-cyan-300 hover:text-cyan-200"
              >
                Open in editor
              </button>
              <button onClick={() => remove(i.id)} className="text-red-400 hover:text-red-300">Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function QueryHistoryPage() {
  const [tab, setTab] = useState<"history" | "saved">("history");
  const tabClass = (t: string) =>
    `rounded-md px-3 py-1.5 text-sm ${tab === t ? "bg-cyan-500/10 text-cyan-300" : "text-slate-400 hover:bg-slate-800/60"}`;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">History</h1>
      <div className="mt-3 flex gap-2">
        <button onClick={() => setTab("history")} className={tabClass("history")}>Query history</button>
        <button onClick={() => setTab("saved")} className={tabClass("saved")}>Saved queries</button>
      </div>
      <div className="mt-4">{tab === "history" ? <HistoryTab /> : <SavedTab />}</div>
    </div>
  );
}
