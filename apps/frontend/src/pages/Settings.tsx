import { useEffect, useState } from "react";
import {
  getProviderModels, listProviders, removeKey, saveKey, setDefaultProvider, validateKey,
  type ProviderStatus,
} from "../lib/api";

const field = "rounded-md border border-slate-700 bg-transparent px-2 py-1.5 text-sm";

function ProviderCard({ status, onChanged }: { status: ProviderStatus; onChanged: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState(status.model ?? status.suggested_model);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try { await fn(); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" }); }
    finally { setBusy(false); }
  };

  const loadModels = () =>
    run(async () => {
      if (apiKey) {
        const r = await validateKey(status.provider, apiKey);
        if (!r.valid) { setMsg({ ok: false, text: r.message ?? "The key was rejected" }); return; }
        setModels(r.models);
        setModel((prev) => [status.model, status.suggested_model, prev].find((m) => m && r.models.includes(m)) ?? r.models[0] ?? prev);
        setMsg({ ok: true, text: `Key is valid. ${r.models.length} models available.` });
      } else {
        const list = await getProviderModels(status.provider);
        setModels(list);
        setMsg({ ok: true, text: `${list.length} models available.` });
      }
    });

  const save = () =>
    run(async () => {
      await saveKey(status.provider, apiKey || null, model);
      setApiKey("");  // the key leaves browser memory as soon as it is saved
      setModels([]);
      setMsg({ ok: true, text: "Saved." });
      onChanged();
    });

  const remove = () =>
    run(async () => {
      if (!window.confirm(`Remove the ${status.label} key?`)) return;
      await removeKey(status.provider);
      onChanged();
    });

  const makeDefault = () => run(async () => { await setDefaultProvider(status.provider); onChanged(); });

  return (
    <div className="space-y-3 rounded-lg border border-slate-800 bg-surface p-4">
      <div className="flex items-center gap-3">
        <h3 className="font-medium">{status.label}</h3>
        {status.configured && (
          <span className="text-xs text-emerald-400">Key saved ({status.key_hint}) · model {status.model}</span>
        )}
        {status.is_default && <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-xs text-cyan-300">default</span>}
        {status.configured && !status.is_default && (
          <button onClick={makeDefault} disabled={busy} className="text-xs text-cyan-300">Make default</button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
          placeholder={status.configured ? "New API key (leave empty to keep the saved one)" : "API key"}
          className={`${field} w-80`}
        />
        <input
          list={`models-${status.provider}`} value={model} onChange={(e) => setModel(e.target.value)}
          placeholder="Model" className={`${field} w-56`}
        />
        <datalist id={`models-${status.provider}`}>{models.map((m) => <option key={m} value={m} />)}</datalist>
      </div>

      <div className="flex gap-2">
        <button onClick={loadModels} disabled={busy || (!apiKey && !status.configured)} className="rounded-md border border-slate-600 px-3 py-1.5 text-sm disabled:opacity-40">
          {apiKey ? "Validate key & load models" : "Load models"}
        </button>
        <button onClick={save} disabled={busy || !model || (!status.configured && !apiKey)} className="rounded-md bg-cyan-500 px-3 py-1.5 text-sm font-medium text-slate-950 disabled:opacity-40">
          {status.configured ? (apiKey ? "Replace key" : "Save model") : "Save key"}
        </button>
        {status.configured && (
          <button onClick={remove} disabled={busy} className="rounded-md border border-red-500/50 px-3 py-1.5 text-sm text-red-400">Remove</button>
        )}
      </div>
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</p>}
    </div>
  );
}

export default function Settings() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () =>
    listProviders()
      .then(setProviders)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <section className="space-y-3">
        <h2 className="text-lg font-medium">AI providers</h2>
        <p className="text-sm text-slate-400">
          Add your own API key. It is checked with the provider, stored encrypted on the server, and never shown again (only the last 4 characters).
        </p>
        {loading && <p className="text-sm text-slate-400">Loading...</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
        {providers.map((p) => <ProviderCard key={`${p.provider}-${p.model}-${p.configured}`} status={p} onChanged={load} />)}
      </section>
    </div>
  );
}
