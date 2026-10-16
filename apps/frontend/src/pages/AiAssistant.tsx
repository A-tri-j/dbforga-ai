import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  aiChat, getSchemas, listConnections, listProviders,
  type ChatMode, type Connection, type ProviderName, type ProviderStatus,
} from "../lib/api";

const field = "rounded-md border border-slate-700 bg-surface px-2 py-1.5 text-sm";
const area = "w-full rounded-md border border-slate-700 bg-transparent px-3 py-2 text-sm";

type Entry = { role: "user" | "assistant"; content: string; suggestedSql?: string | null; meta?: string };

const MODES: { id: ChatMode; label: string }[] = [
  { id: "chat", label: "Ask" },
  { id: "generate_sql", label: "Generate SQL" },
  { id: "explain", label: "Explain SQL" },
  { id: "debug", label: "Debug error" },
];

function ReplyView({ text }: { text: string }) {
  const parts = text.split(/```(?:\w+)?\n([\s\S]*?)```/g);
  return (
    <div className="space-y-2">
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <pre key={i} className="overflow-auto rounded-md bg-slate-900 p-3 font-mono text-xs text-slate-200">{p}</pre>
        ) : p.trim() ? (
          <p key={i} className="whitespace-pre-wrap">{p.trim()}</p>
        ) : null,
      )}
    </div>
  );
}

export default function AiAssistant() {
  const navigate = useNavigate();
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [providerChoice, setProviderChoice] = useState<ProviderName | "">("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState<number | null>(null);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [schema, setSchema] = useState("");
  const [mode, setMode] = useState<ChatMode>("chat");
  const [message, setMessage] = useState("");
  const [sql, setSql] = useState("");
  const [errText, setErrText] = useState("");
  const [transcript, setTranscript] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([listProviders(), listConnections()])
      .then(([p, c]) => { setProviders(p); setConnections(c); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
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

  const configured = providers.filter((p) => p.configured);

  const canSend =
    !busy && configured.length > 0 &&
    (mode === "chat" || mode === "generate_sql" ? message.trim() !== "" : sql.trim() !== "" && (mode === "explain" || errText.trim() !== ""));

  const onSend = async () => {
    setBusy(true); setError("");
    const label =
      mode === "chat" ? message
      : mode === "generate_sql" ? `Generate SQL: ${message}`
      : mode === "explain" ? `Explain this SQL:\n${sql}`
      : `Debug this SQL:\n${sql}\nError: ${errText}`;
    try {
      const r = await aiChat({
        mode, message, sql: sql || null, error: errText || null,
        connection_id: connectionId, schema_name: connectionId !== null ? schema : null,
        provider: providerChoice || null,
        history: mode === "chat" ? transcript.slice(-10).map(({ role, content }) => ({ role, content })) : [],
      });
      setTranscript((t) => [
        ...t,
        { role: "user", content: label },
        {
          role: "assistant", content: r.reply, suggestedSql: r.suggested_sql,
          meta: `${r.provider} · ${r.model}${connectionId !== null ? ` · ${r.schema_tables_sent} tables of schema structure sent` : " · no schema sent"}`,
        },
      ]);
      setMessage("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The request failed");
    } finally { setBusy(false); }
  };

  if (loading) return <p className="text-slate-400">Loading...</p>;

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">AI Assistant</h1>

      {configured.length === 0 ? (
        <p className="text-sm text-amber-300">
          No AI provider configured. <Link to="/settings" className="underline">Add your API key in Settings</Link>.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <select value={providerChoice} onChange={(e) => setProviderChoice(e.target.value as ProviderName | "")} className={field}>
            <option value="">Default provider</option>
            {configured.map((p) => <option key={p.provider} value={p.provider}>{p.label} ({p.model})</option>)}
          </select>
          <select value={connectionId ?? ""} onChange={(e) => setConnectionId(e.target.value ? Number(e.target.value) : null)} className={field}>
            <option value="">No database (general help)</option>
            {connections.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.engine})</option>)}
          </select>
          {connectionId !== null && (
            <select value={schema} onChange={(e) => setSchema(e.target.value)} className={field}>
              {schemas.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>
      )}

      <p className="text-xs text-slate-500">
        Sent to your AI provider: your input, any SQL or error text you provide, and (if a database is chosen) the schema structure: table and column names and types. Row data is never sent. Error messages can contain data values, so check them before sending. SQL is never run automatically.
      </p>

      <div className="space-y-3">
        {transcript.map((m, i) => (
          <div key={i} className={`rounded-lg border p-3 text-sm ${m.role === "user" ? "border-slate-800 bg-surface" : "border-cyan-500/30 bg-cyan-500/5"}`}>
            {m.role === "user" ? <p className="whitespace-pre-wrap text-slate-300">{m.content}</p> : <ReplyView text={m.content} />}
            {m.role === "assistant" && (
              <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
                <span>{m.meta}</span>
                {m.suggestedSql && (
                  <button
                    onClick={() => navigate("/sql", { state: { sql: m.suggestedSql, connectionId } })}
                    className="text-cyan-300 hover:text-cyan-200"
                  >
                    Open in SQL editor (review before running)
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && <p className="text-sm text-slate-400">Thinking...</p>}
      </div>

      <div className="space-y-2">
        <div className="flex gap-2">
          {MODES.map((m) => (
            <button key={m.id} onClick={() => setMode(m.id)}
              className={`rounded-md px-3 py-1.5 text-sm ${mode === m.id ? "bg-cyan-500/10 text-cyan-300" : "text-slate-400 hover:bg-slate-800/60"}`}>
              {m.label}
            </button>
          ))}
        </div>
        {(mode === "chat" || mode === "generate_sql") && (
          <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={8000}
            placeholder={mode === "chat" ? "Ask about your database or SQL..." : "Describe the query you need..."} className={area} />
        )}
        {(mode === "explain" || mode === "debug") && (
          <textarea rows={5} value={sql} onChange={(e) => setSql(e.target.value)} placeholder="Paste the SQL..." className={`${area} font-mono`} />
        )}
        {mode === "debug" && (
          <textarea rows={3} value={errText} onChange={(e) => setErrText(e.target.value)} placeholder="Paste the error message..." className={area} />
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button onClick={onSend} disabled={!canSend} className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-40">
          {busy ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
}
