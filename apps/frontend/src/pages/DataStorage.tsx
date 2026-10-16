import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { clearHistory, downloadExport, getStorage, type StorageInfo } from "../lib/api";

const LABELS: Record<string, string> = {
  connections: "Saved connections", history: "Query history", saved_queries: "Saved queries",
  snapshots: "Schema snapshots", projects: "Projects", ai_providers: "AI keys (encrypted)", learning_progress: "Learning progress",
};

const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export default function DataStorage() {
  const { user } = useAuth();
  const scriptKey = `dbforge_workbench_script_${user?.id ?? "anon"}`;
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [scriptChars, setScriptChars] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = () => getStorage().then(setInfo).catch((e: Error) => setError(e.message));
  const readScript = () => { try { return localStorage.getItem(scriptKey) ?? ""; } catch { return ""; } };

  useEffect(() => { load(); setScriptChars(readScript().length); }, [scriptKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const wrap = async (fn: () => Promise<void>) => {
    setError(""); setNotice("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); }
  };

  const downloadScript = () => {
    const url = URL.createObjectURL(new Blob([readScript()], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url; a.download = "dbforge-script.txt"; a.click();
    URL.revokeObjectURL(url);
  };

  const clearScript = () => {
    if (!window.confirm("Clear the script in the editor? This cannot be undone.")) return;
    try { localStorage.removeItem(scriptKey); } catch { /* ignore */ }
    setScriptChars(0);
    setNotice("Editor script cleared.");
  };

  const onClearHistory = () => wrap(async () => {
    if (!window.confirm("Delete all query history?")) return;
    await clearHistory();
    await load();
    setNotice("History cleared.");
  });

  const desktop = info?.app_mode === "desktop";

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">My Data</h1>
        <p className="text-sm text-slate-400">What this app stores, and where it is.</p>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-emerald-400">{notice}</p>}

      {info && (
        <>
          <section className="space-y-2 rounded-xl border border-slate-800 bg-surface p-4 text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span><span className="text-slate-400">Mode:</span> {desktop ? "Desktop app (data stays on this computer)" : "Web (data is on the server)"}</span>
              <span><span className="text-slate-400">Storage:</span> {info.storage_kind}</span>
              {info.size_bytes !== null && <span><span className="text-slate-400">Size:</span> {fmtBytes(info.size_bytes)}</span>}
            </div>
            {info.location && <p className="break-all text-xs text-slate-400">File: <code className="text-slate-300">{info.location}</code></p>}
            <p className="text-xs text-slate-400">You stay signed in on this device. You only need to sign in again after {info.session_days} days without opening the app.</p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-medium">Stored in the database</h2>
            <div className="overflow-hidden rounded-xl border border-slate-800">
              <table className="w-full text-sm">
                <tbody>
                  {Object.entries(info.counts).map(([k, v]) => (
                    <tr key={k} className="border-t border-slate-800/70 first:border-t-0">
                      <td className="p-2.5 text-slate-300">{LABELS[k] ?? k}</td>
                      <td className="p-2.5 text-right font-medium">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              History holds the query text only (never results). Passwords and AI keys are stored encrypted, and are never exported.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => wrap(downloadExport)} className="rounded-md bg-cyan-500 px-3 py-1.5 text-sm font-medium text-slate-950">Download my data (JSON)</button>
              <button onClick={onClearHistory} className="rounded-md border border-red-500/50 px-3 py-1.5 text-sm text-red-400">Clear query history</button>
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-medium">Stored on this device</h2>
            <ul className="space-y-1 text-sm text-slate-300">
              <li>Editor script: {scriptChars} characters</li>
              <li>Theme and sign-in token</li>
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={downloadScript} disabled={scriptChars === 0} className="rounded-md border border-slate-600 px-3 py-1.5 text-sm disabled:opacity-40">Download editor script</button>
              <button onClick={clearScript} disabled={scriptChars === 0} className="rounded-md border border-slate-600 px-3 py-1.5 text-sm disabled:opacity-40">Clear editor script</button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
