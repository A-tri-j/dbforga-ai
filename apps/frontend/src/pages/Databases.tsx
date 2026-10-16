import { useEffect, useState, type FormEvent } from "react";
import {
  createConnection, deleteConnection, detectLocal, listConnections, testConnection, testSavedConnection,
  updateConnection, type Connection, type ConnectionInput, type LocalDb,
} from "../lib/api";
import { hintFor, parseConnectionString } from "../lib/connString";
import Explorer from "./Explorer";

type Engine = ConnectionInput["engine"];

const TYPES: { engine: Engine; label: string; sub: string; port: number }[] = [
  { engine: "postgresql", label: "PostgreSQL", sub: "Neon, Supabase, local", port: 5432 },
  { engine: "mysql", label: "MySQL / MariaDB", sub: "local or cloud", port: 3306 },
  { engine: "mongodb", label: "MongoDB", sub: "self hosted", port: 27017 },
  { engine: "mongodb+srv", label: "MongoDB Atlas", sub: "mongodb+srv", port: 27017 },
];
const LABEL: Record<Engine, string> = { postgresql: "PostgreSQL", mysql: "MySQL", mongodb: "MongoDB", "mongodb+srv": "Atlas" };

const PRESETS: { label: string; patch: Partial<ConnectionInput>; hint: string }[] = [
  { label: "This computer", patch: { host: "localhost", ssl: false }, hint: 'A database on this computer. "Detect databases" can find the port for you.' },
  { label: "Neon", patch: { engine: "postgresql", port: 5432, ssl: true }, hint: "Neon: open your project, press Connect, copy the connection string and paste it above." },
  { label: "Supabase", patch: { engine: "postgresql", port: 5432, ssl: true }, hint: "Supabase: Project settings, Database, Connection string. Paste it above." },
  { label: "Atlas", patch: { engine: "mongodb+srv", port: 27017, ssl: true }, hint: "Atlas: Connect, Drivers, copy the string and paste it above. Add your IP address in Network Access." },
];

const empty: ConnectionInput = { name: "", engine: "postgresql", host: "", port: 5432, database: "", username: "", password: "", ssl: false };
const input = "w-full rounded-md border border-slate-700 bg-transparent px-3 py-2 text-sm";

export default function Databases() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ConnectionInput>(empty);
  const [showPw, setShowPw] = useState(false);
  const [paste, setPaste] = useState("");
  const [pasteMsg, setPasteMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [presetHint, setPresetHint] = useState("");
  const [detected, setDetected] = useState<{ available: boolean; found: LocalDb[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [rowTest, setRowTest] = useState<Record<number, { ok: boolean; text: string } | "busy">>({});

  const load = () =>
    listConnections().then(setConnections).catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const patch = (p: Partial<ConnectionInput>) => { setForm((f) => ({ ...f, ...p })); setTestMsg(null); };

  const openNew = () => {
    setEditingId(null); setForm(empty); setShowForm(true); setTestMsg(null); setPasteMsg(null); setPresetHint(""); setError("");
  };
  const openEdit = (c: Connection) => {
    setEditingId(c.id); setForm({ ...c, password: "" }); setShowForm(true); setTestMsg(null); setPasteMsg(null); setPresetHint(""); setError("");
  };
  const closeForm = () => { setShowForm(false); setEditingId(null); setForm(empty); setPaste(""); };

  const applyString = (value: string) => {
    const parsed = parseConnectionString(value);
    if (!parsed) {
      setPasteMsg({ ok: false, text: "That does not look like a connection string (postgresql://, mysql://, mongodb://, mongodb+srv://)." });
      return;
    }
    setForm((f) => ({ ...f, ...parsed, name: f.name || parsed.database || parsed.host }));
    setPaste(""); // the string is not kept after it fills the form
    setPasteMsg({ ok: true, text: "Form filled. Check it, then press Test connection." });
    setTestMsg(null);
  };

  const detect = async () => {
    try { setDetected(await detectLocal()); }
    catch (e) { setError(e instanceof Error ? e.message : "Detection failed"); }
  };

  const failText = (msg: string) => {
    const hint = hintFor(msg);
    return hint ? `${msg} ${hint}` : msg;
  };

  const onTest = async () => {
    setBusy(true); setTestMsg(null);
    try {
      const r = await testConnection(form, editingId ?? undefined);
      setTestMsg({ ok: r.ok, text: r.ok ? `Connected. ${r.server_version ?? ""}` : failText(r.message) });
    } catch (e) {
      setTestMsg({ ok: false, text: e instanceof Error ? e.message : "Test failed" });
    } finally { setBusy(false); }
  };

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    const name = form.name.trim() || `${form.database} @ ${form.host}`;
    try {
      const saved = editingId === null
        ? await createConnection({ ...form, name })
        : await updateConnection(editingId, { ...form, name, password: form.password === "" ? null : form.password });
      closeForm();
      await load();
      setSelected(saved.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      setError(failText(msg));
    } finally { setBusy(false); }
  };

  const onDelete = async (id: number) => {
    if (!window.confirm("Delete this saved connection? Your data in the database is not touched.")) return;
    try {
      await deleteConnection(id);
      if (selected === id) setSelected(null);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to delete"); }
  };

  const onRowTest = async (id: number) => {
    setRowTest((t) => ({ ...t, [id]: "busy" }));
    try {
      const r = await testSavedConnection(id);
      setRowTest((t) => ({ ...t, [id]: { ok: r.ok, text: r.ok ? "Connected" : failText(r.message) } }));
    } catch (e) {
      setRowTest((t) => ({ ...t, [id]: { ok: false, text: e instanceof Error ? e.message : "Test failed" } }));
    }
  };

  const isSql = form.engine === "postgresql" || form.engine === "mysql";
  const srv = form.engine === "mongodb+srv";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Databases</h1>
          <p className="text-sm text-slate-400">Connect PostgreSQL, MySQL or MongoDB. Passwords are stored encrypted and never shown again.</p>
        </div>
        {!showForm && <button onClick={openNew} className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950">New connection</button>}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {showForm && (
        <form onSubmit={onSave} className="space-y-4 rounded-xl border border-slate-800 bg-surface p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">{editingId === null ? "New connection" : "Edit connection"}</h2>
            <button type="button" onClick={closeForm} className="text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {TYPES.map((t) => (
              <button key={t.engine} type="button" onClick={() => patch({ engine: t.engine, port: t.port })}
                className={`rounded-lg border p-3 text-left ${form.engine === t.engine ? "border-cyan-500 bg-cyan-500/10" : "border-slate-700 hover:border-slate-500"}`}>
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-[11px] text-slate-400">{t.sub}</div>
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400">Fastest way: paste a connection string</label>
            <div className="flex gap-2">
              <input value={paste} onChange={(e) => setPaste(e.target.value)} onPaste={(e) => { e.preventDefault(); applyString(e.clipboardData.getData("text")); }}
                placeholder="postgresql://user:password@host:5432/database?sslmode=require" autoComplete="off" className={input} />
              <button type="button" onClick={() => applyString(paste)} disabled={!paste.trim()} className="shrink-0 rounded-md border border-slate-600 px-3 text-sm disabled:opacity-40">Fill form</button>
            </div>
            {pasteMsg && <p className={`text-xs ${pasteMsg.ok ? "text-emerald-400" : "text-red-400"}`}>{pasteMsg.text}</p>}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-slate-500">Quick setup:</span>
              {PRESETS.map((p) => (
                <button key={p.label} type="button" onClick={() => { patch(p.patch); setPresetHint(p.hint); }} className="rounded-full border border-slate-700 px-2.5 py-0.5 text-xs text-slate-300 hover:border-cyan-500/60">{p.label}</button>
              ))}
              <button type="button" onClick={detect} className="rounded-full border border-cyan-500/50 px-2.5 py-0.5 text-xs text-cyan-300">Detect databases on this computer</button>
            </div>
            {presetHint && <p className="text-xs text-slate-400">{presetHint}</p>}
            {detected && !detected.available && <p className="text-xs text-slate-500">Detection works in the desktop app or a local setup, not on a hosted server.</p>}
            {detected?.available && detected.found.length === 0 && <p className="text-xs text-slate-500">No database found on the usual ports (5432, 3306, 27017). Is it running?</p>}
            {detected?.available && detected.found.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {detected.found.map((d) => (
                  <button key={d.port} type="button" onClick={() => patch({ engine: d.engine, host: d.host, port: d.port, ssl: false })}
                    className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">
                    Found {d.label} on port {d.port}. Use it
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <input required placeholder="Connection name" value={form.name} onChange={(e) => patch({ name: e.target.value })} className={`${input} col-span-2 md:col-span-4`} />
            <input required placeholder={srv ? "Cluster host (cluster0.xxxx.mongodb.net)" : "Host"} value={form.host} onChange={(e) => patch({ host: e.target.value })} className={`${input} col-span-2 md:col-span-3`} />
            <input required type="number" min={1} max={65535} value={form.port} disabled={srv} title={srv ? "Not used for Atlas" : "Port"} onChange={(e) => patch({ port: Number(e.target.value) })} className={`${input} disabled:opacity-50`} />
            <input required placeholder="Database" value={form.database} onChange={(e) => patch({ database: e.target.value })} className={`${input} col-span-2`} />
            <input required={isSql} placeholder={isSql ? "Username" : "Username (optional)"} value={form.username} onChange={(e) => patch({ username: e.target.value })} autoComplete="off" className={input} />
            <div className="relative">
              <input type={showPw ? "text" : "password"} placeholder={editingId !== null ? "New password (empty = keep)" : "Password"} value={form.password} onChange={(e) => patch({ password: e.target.value })} autoComplete="new-password" className={`${input} pr-14`} />
              <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute right-2 top-2 text-xs text-slate-400">{showPw ? "Hide" : "Show"}</button>
            </div>
            <label className="col-span-2 flex items-center gap-2 text-sm text-slate-300 md:col-span-4">
              <input type="checkbox" checked={form.ssl || srv} disabled={srv} onChange={(e) => patch({ ssl: e.target.checked })} />
              Use SSL / TLS {srv ? "(always on for Atlas)" : "(needed for Neon, Supabase, Atlas and most cloud databases)"}
            </label>
          </div>

          {testMsg && <p className={`text-sm ${testMsg.ok ? "text-emerald-400" : "text-red-400"}`}>{testMsg.text}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={onTest} disabled={busy} className="rounded-md border border-slate-600 px-4 py-2 text-sm disabled:opacity-50">{busy ? "Working..." : "Test connection"}</button>
            <button disabled={busy} className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-50">{editingId === null ? "Save (tests first)" : "Save changes (tests first)"}</button>
          </div>
        </form>
      )}

      <div className="flex gap-6">
        <div className="w-72 shrink-0 space-y-2">
          {loading && <p className="text-sm text-slate-400">Loading...</p>}
          {!loading && connections.length === 0 && !showForm && (
            <div className="rounded-xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-400">
              <p>No connections yet.</p>
              <button onClick={openNew} className="mt-2 text-cyan-300 underline">Add your first database</button>
            </div>
          )}
          {connections.map((c) => {
            const t = rowTest[c.id];
            return (
              <div key={c.id} className={`rounded-lg border p-3 ${selected === c.id ? "border-cyan-500/60 bg-cyan-500/5" : "border-slate-800 bg-surface"}`}>
                <button onClick={() => setSelected(c.id)} className="block w-full text-left">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{c.name}</span>
                    <span className="rounded bg-slate-700/60 px-1.5 text-[10px] text-slate-300">{LABEL[c.engine]}</span>
                  </div>
                  <div className="truncate text-xs text-slate-400">{c.host}{c.engine === "mongodb+srv" ? "" : `:${c.port}`}/{c.database}</div>
                </button>
                <div className="mt-2 flex items-center gap-3 text-xs">
                  <button onClick={() => setSelected(c.id)} className="text-cyan-300">Explore</button>
                  <button onClick={() => onRowTest(c.id)} className="text-slate-300 hover:text-white">Test</button>
                  <button onClick={() => openEdit(c)} className="text-slate-300 hover:text-white">Edit</button>
                  <button onClick={() => onDelete(c.id)} className="ml-auto text-red-400 hover:text-red-300">Delete</button>
                </div>
                {t === "busy" && <p className="mt-1 text-xs text-slate-400">Testing...</p>}
                {t && t !== "busy" && <p className={`mt-1 text-xs ${t.ok ? "text-emerald-400" : "text-red-400"}`}>{t.text}</p>}
              </div>
            );
          })}
        </div>

        <div className="min-w-0 flex-1">
          {selected === null
            ? <p className="text-sm text-slate-400">Select a connection to explore its {connections.find((c) => c.id === selected)?.engine?.startsWith("mongodb") ? "collections" : "tables"}.</p>
            : <Explorer connectionId={selected} />}
        </div>
      </div>
    </div>
  );
}
