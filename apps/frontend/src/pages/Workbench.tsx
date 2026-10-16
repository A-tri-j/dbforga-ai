import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor, IDisposable, Position } from "monaco-editor";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { format } from "sql-formatter";
import { useAuth } from "../auth/AuthContext";
import { useTheme } from "../lib/theme";
import ErFlow from "../components/ErFlow";
import PdfImportDialog from "../components/PdfImportDialog";
import ReplyView from "../components/ReplyView";
import ResultGrid from "../components/ResultGrid";
import {
  aiChat, cancelQuery, createSavedQuery, executeQuery, getGraph, getSchemas, listConnections, listProviders,
  type Connection, type ExecuteResult, type Graph, type PdfConfirmResult, type ProviderStatus,
} from "../lib/api";
import { splitStatements, statementAt } from "../lib/sqlSplit";
import ImportData from "./ImportData";

type Dialect = "postgresql" | "mysql" | "mongodb";

const DDL = new Set(["CREATE", "ALTER", "DROP"]);
const field = "rounded-md border border-slate-700 bg-surface px-2 py-1.5 text-sm";
const panelHead = "border-b border-slate-800 bg-slate-900/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400";
const SQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "OFFSET", "JOIN", "LEFT JOIN", "RIGHT JOIN",
  "INNER JOIN", "ON", "AS", "AND", "OR", "NOT", "IN", "IS NULL", "IS NOT NULL", "LIKE", "BETWEEN", "DISTINCT", "COUNT",
  "SUM", "AVG", "MIN", "MAX", "INSERT INTO", "VALUES", "UPDATE", "SET", "DELETE FROM", "CREATE TABLE", "ALTER TABLE",
  "DROP TABLE", "UNION", "UNION ALL", "CASE", "WHEN", "THEN", "ELSE", "END", "EXISTS", "ASC", "DESC", "EXPLAIN",
  "PRIMARY KEY", "FOREIGN KEY", "REFERENCES", "NOT NULL", "DEFAULT", "ILIKE", "RETURNING", "SERIAL", "AUTO_INCREMENT",
];
const MONGO_KEYWORDS = [
  "find", "findOne", "aggregate", "countDocuments", "estimatedDocumentCount", "distinct", "insertOne", "insertMany",
  "updateOne", "updateMany", "replaceOne", "deleteOne", "deleteMany", "createIndex", "createCollection", "dropIndex", "drop",
  "sort", "limit", "skip", "$match", "$group", "$sort", "$project", "$lookup", "$unwind", "$limit", "$skip", "$count",
  "$sum", "$avg", "$min", "$max", "$push", "$addToSet", "$gt", "$gte", "$lt", "$lte", "$eq", "$ne", "$in", "$nin",
  "$and", "$or", "$not", "$exists", "$regex", "$set", "$unset", "$inc", "ObjectId", "ISODate",
];

const toDialect = (engine?: string): Dialect | undefined =>
  engine === "mongodb" || engine === "mongodb+srv" ? "mongodb" : engine === "postgresql" || engine === "mysql" ? engine : undefined;

type ChatEntry = { role: "user" | "assistant"; content: string; suggestedSql?: string | null };
type BatchItem = { sql: string; status: string; message: string | null; ms: number };

const storageKey = (uid?: number) => `dbforge_workbench_script_${uid ?? "anon"}`;
const loadScript = (uid?: number) => { try { return localStorage.getItem(storageKey(uid)) ?? ""; } catch { return ""; } };
const saveScript = (uid: number | undefined, text: string) => { try { localStorage.setItem(storageKey(uid), text); } catch { /* storage unavailable */ } };

export default function Workbench() {
  const { user } = useAuth();
  const { resolved } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const incoming = location.state as { sql?: string; connectionId?: number | null } | null;

  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState<number | null>(null);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [schema, setSchema] = useState("");
  const [dialect, setDialect] = useState<Dialect>("postgresql");
  const [readOnly, setReadOnly] = useState(true);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [graphBusy, setGraphBusy] = useState(false);
  const [graphError, setGraphError] = useState("");
  const [graphAt, setGraphAt] = useState<Date | null>(null);
  const [erWide, setErWide] = useState(false);
  const [bottomTab, setBottomTab] = useState<"results" | "chat">("results");
  const [resultView, setResultView] = useState<"table" | "json">("table");
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [lastFailed, setLastFailed] = useState<{ sql: string; message: string } | null>(null);
  const [saveName, setSaveName] = useState<string | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [initialScript] = useState(() => loadScript(user?.id));

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const queryIdRef = useRef("");
  const providersRef = useRef<IDisposable[]>([]);
  const incomingHandled = useRef(false);
  const suggestRef = useRef<{ tables: string[]; columns: { table: string; name: string }[]; kind: Dialect }>({ tables: [], columns: [], kind: "postgresql" });
  const runRef = useRef<() => void>(() => {});

  const activeConn = connections.find((c) => c.id === connectionId);
  const effDialect: Dialect = toDialect(activeConn?.engine) ?? dialect;
  const isMongo = effDialect === "mongodb";
  const providerReady = providers.some((p) => p.configured);
  const dialectLabel = isMongo ? "MongoDB" : effDialect === "mysql" ? "MySQL" : "PostgreSQL";

  useEffect(() => {
    listConnections()
      .then((c) => {
        setConnections(c);
        const wanted = c.find((x) => x.id === incoming?.connectionId);
        if (c.length) setConnectionId(wanted ? wanted.id : c[0].id);
      })
      .catch((e: Error) => setError(e.message));
    listProviders().then(setProviders).catch(() => undefined);
    return () => providersRef.current.forEach((p) => p.dispose());
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

  const refreshGraph = async () => {
    if (connectionId === null || !schema) return;
    setGraphBusy(true); setGraphError("");
    try {
      setGraph(await getGraph(connectionId, schema));
      setGraphAt(new Date());
    } catch (e) {
      setGraphError(e instanceof Error ? e.message : "Could not load the diagram");
    } finally { setGraphBusy(false); }
  };

  useEffect(() => {
    setGraph(null);
    refreshGraph();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, schema]);

  useEffect(() => {
    suggestRef.current = {
      tables: graph?.tables.map((t) => t.name) ?? [],
      columns: graph?.tables.flatMap((t) => t.columns.map((c) => ({ table: t.name, name: c.name }))) ?? [],
      kind: effDialect,
    };
  }, [graph, effDialect]);

  const insertSql = (title: string, sql: string) => {
    const ed = editorRef.current;
    const model = ed?.getModel();
    if (!ed || !model) return;
    const prefix = model.getValue().trim() ? "\n\n" : "";
    const header = `${isMongo ? "//" : "--"} ${title.replace(/\s+/g, " ").slice(0, 120)}\n`;
    const body = sql.trim().replace(/;?\s*$/, ";");
    const end = model.getFullModelRange().getEndPosition();
    ed.executeEdits("workbench", [{
      range: { startLineNumber: end.lineNumber, startColumn: end.column, endLineNumber: end.lineNumber, endColumn: end.column },
      text: `${prefix}${header}${body}\n`,
    }]);
    const bodyLine = end.lineNumber + (prefix ? 2 : 0) + 1;
    ed.setPosition({ lineNumber: bodyLine, column: 1 });
    ed.revealLineInCenter(bodyLine);
    ed.focus();
  };

  const collectionRef = (name: string) =>
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? `db.${name}` : `db.getCollection(${JSON.stringify(name)})`;

  const tableRef = (name: string) => {
    const q = (n: string) => (/^[a-z_][a-z0-9_]*$/.test(n) ? n : effDialect === "mysql" ? `\`${n}\`` : `"${n}"`);
    return effDialect === "postgresql" && schema && schema !== "public" ? `${q(schema)}.${q(name)}` : q(name);
  };

  const exploreSql = (name: string) =>
    isMongo ? `${collectionRef(name)}.find({}).limit(100)` : `SELECT * FROM ${tableRef(name)} LIMIT 100`;

  const generate = async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true); setError(""); setNotice("");
    try {
      const r = await aiChat({
        mode: "generate_sql", message: prompt, sql: null, error: null,
        connection_id: connectionId, schema_name: connectionId !== null ? schema : null,
        provider: null, history: [], dialect: effDialect,
      });
      if (r.suggested_sql) {
        insertSql(`Prompt: ${prompt}`, r.suggested_sql);
        setNotice("Query added to the editor. Read it, then press Run (current statement) or Run all.");
        setPrompt("");
      } else {
        setChat((c) => [...c, { role: "user", content: prompt }, { role: "assistant", content: r.reply }]);
        setBottomTab("chat");
        setNotice("The AI answered without a query. See the AI Chat tab.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "The request failed");
    } finally { setGenerating(false); }
  };

  const runOne = async (connId: number, sql: string): Promise<ExecuteResult | null> => {
    let confirm = false;
    for (;;) {
      const id = crypto.randomUUID();
      queryIdRef.current = id;
      const r = await executeQuery(connId, { sql, query_id: id, read_only: readOnly, confirm_destructive: confirm });
      if (r.status === "confirmation_required" && !confirm) {
        if (!window.confirm(`This ${r.statement_type} statement changes data or schema. Run it?`)) return null;
        confirm = true;
        continue;
      }
      return r;
    }
  };

  const changesSchema = (r: ExecuteResult) => {
    const t = (r.statement_type ?? "").toUpperCase();
    return DDL.has(t) || (isMongo && t === "INSERT");  // inserting into a new collection creates it
  };

  const afterRun = (r: ExecuteResult, sql: string) => {
    setLastFailed(r.status === "error" ? { sql, message: r.message ?? "" } : null);
    setResultView("table");
    if (r.status === "ok" && changesSchema(r)) refreshGraph();
    if (r.status === "error" && /read-only/i.test(r.message ?? "")) {
      setNotice("This statement writes to the database. Turn off Read-only in the top bar to run it.");
    }
  };

  const currentStatement = (): string | null => {
    const ed = editorRef.current;
    const model = ed?.getModel();
    if (!ed || !model) return null;
    const sel = ed.getSelection();
    if (sel && !sel.isEmpty()) return model.getValueInRange(sel).trim() || null;
    const pos = ed.getPosition();
    return statementAt(model.getValue(), pos ? model.getOffsetAt(pos) : 0, isMongo)?.text ?? null;
  };

  const runCurrent = async () => {
    if (running) return;
    if (connectionId === null) { setError("Choose a connection to run queries."); return; }
    const sql = currentStatement();
    if (!sql) { setError("There is no statement at the cursor."); return; }
    setRunning(true); setError(""); setNotice(""); setResult(null); setBatch([]); setBottomTab("results");
    try {
      const r = await runOne(connectionId, sql);
      if (r === null) { setNotice("Not executed."); return; }
      setResult(r);
      afterRun(r, sql);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally { setRunning(false); }
  };

  const runAll = async () => {
    const ed = editorRef.current;
    if (!ed || running) return;
    if (connectionId === null) { setError("Choose a connection to run queries."); return; }
    const stmts = splitStatements(ed.getValue(), isMongo);
    if (stmts.length === 0) { setError("The editor has no statements."); return; }
    if (!window.confirm(`Run ${stmts.length} statement(s) in order? It stops at the first error.`)) return;
    setRunning(true); setError(""); setNotice(""); setResult(null); setBatch([]); setLastFailed(null); setBottomTab("results");
    const items: BatchItem[] = [];
    let rowsResult: ExecuteResult | null = null;
    let schemaChanged = false;
    let failed = false;
    try {
      for (const st of stmts) {
        const r = await runOne(connectionId, st.text);
        if (r === null) { items.push({ sql: st.text, status: "skipped", message: "Not confirmed", ms: 0 }); setBatch([...items]); break; }
        items.push({ sql: st.text, status: r.status, message: r.message, ms: r.duration_ms });
        setBatch([...items]);
        if (r.status !== "ok") { failed = true; setResult(r); afterRun(r, st.text); break; }
        if (r.columns.length > 0) rowsResult = r;
        if (changesSchema(r)) schemaChanged = true;
      }
      if (!failed && rowsResult) setResult(rowsResult);
      if (schemaChanged) await refreshGraph();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally { setRunning(false); }
  };

  useEffect(() => { runRef.current = runCurrent; });

  const cancel = () => {
    if (connectionId !== null) cancelQuery(connectionId, queryIdRef.current).catch(() => undefined);
  };

  const onFormat = () => {
    const ed = editorRef.current;
    const model = ed?.getModel();
    if (!ed || !model || isMongo) return;
    try {
      const formatted = format(ed.getValue(), { language: effDialect === "mysql" ? "mysql" : "postgresql" });
      ed.executeEdits("format", [{ range: model.getFullModelRange(), text: formatted }]);
      setError("");
    } catch (e) {
      setError(`Could not format: ${e instanceof Error ? e.message : "invalid SQL"}`);
    }
  };

  const onSave = async () => {
    const sql = currentStatement() ?? editorRef.current?.getValue().trim() ?? "";
    if (!sql || !saveName?.trim()) return;
    try {
      await createSavedQuery({ name: saveName.trim(), sql, connection_id: connectionId });
      setSaveName(null);
      setNotice("Query saved. Find it in History > Saved queries.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save query");
    }
  };

  const askAi = async (mode: "explain" | "debug", sql: string, errText: string | null, label: string) => {
    setBottomTab("chat");
    setChat((c) => [...c, { role: "user", content: label }]);
    setChatBusy(true);
    try {
      const r = await aiChat({
        mode, message: "", sql, error: errText,
        connection_id: connectionId, schema_name: connectionId !== null ? schema : null,
        provider: null, history: [], dialect: effDialect,
      });
      setChat((c) => [...c, { role: "assistant", content: r.reply, suggestedSql: r.suggested_sql }]);
    } catch (e) {
      setChat((c) => [...c, { role: "assistant", content: `⚠ ${e instanceof Error ? e.message : "The request failed"}` }]);
    } finally { setChatBusy(false); }
  };

  const explainCurrent = () => {
    const sql = currentStatement();
    if (!sql) { setError("There is no statement at the cursor."); return; }
    askAi("explain", sql, null, `Explain this query:\n${sql}`);
  };

  const fixLast = () => {
    if (lastFailed) askAi("debug", lastFailed.sql, lastFailed.message, `Fix this error:\n${lastFailed.sql}\n→ ${lastFailed.message}`);
  };

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text || chatBusy) return;
    setChatBusy(true);
    const history = chat.slice(-10).map(({ role, content }) => ({ role, content }));
    setChat((c) => [...c, { role: "user", content: text }]);
    setChatInput("");
    try {
      const r = await aiChat({
        mode: "chat", message: text, sql: null, error: null,
        connection_id: connectionId, schema_name: connectionId !== null ? schema : null,
        provider: null, history, dialect: effDialect,
      });
      setChat((c) => [...c, { role: "assistant", content: r.reply, suggestedSql: r.suggested_sql }]);
    } catch (e) {
      setChat((c) => [...c, { role: "assistant", content: `⚠ ${e instanceof Error ? e.message : "The request failed"}` }]);
    } finally { setChatBusy(false); }
  };

  const onPdfImported = (r: PdfConfirmResult) => {
    const body = r.queries.map((q) => `-- ${q.title}\n${q.sql};`).join("\n\n");
    insertSql(`Starter queries for ${r.table_name} (from PDF)`, body);
    refreshGraph();
    setPdfOpen(false);
    setNotice(`Table ${r.table_name} created. Starter queries were added to the editor. Read them, then press Run.`);
  };

  const onFileImported = (i: { connectionId: number; schema: string; table: string }) => {
    setNotice(`Table ${i.table} imported. The ER diagram was refreshed.`);
    if (i.connectionId !== connectionId) { setConnectionId(i.connectionId); return; }
    refreshGraph();
    insertSql(`Imported table ${i.table}`, exploreSql(i.table));
  };

  const onMount: OnMount = (ed, monaco) => {
    editorRef.current = ed;
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current());
    providersRef.current.forEach((p) => p.dispose());
    providersRef.current = ["sql", "javascript"].map((lang) =>
      monaco.languages.registerCompletionItemProvider(lang, {
        provideCompletionItems(model: editor.ITextModel, position: Position) {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
            startColumn: word.startColumn, endColumn: word.endColumn,
          };
          const { tables, columns, kind } = suggestRef.current;
          const words = kind === "mongodb" ? MONGO_KEYWORDS : SQL_KEYWORDS;
          return {
            suggestions: [
              ...words.map((k) => ({ label: k, insertText: k, range, kind: monaco.languages.CompletionItemKind.Keyword })),
              ...tables.map((t) => ({ label: t, insertText: t, range, kind: monaco.languages.CompletionItemKind.Class })),
              ...columns.map((c) => ({ label: c.name, detail: c.table, insertText: c.name, range, kind: monaco.languages.CompletionItemKind.Field })),
            ],
          };
        },
      }),
    );
    // "Open in editor" from History, Schema Compare, AI Assistant, ...
    if (incoming?.sql && !incomingHandled.current) {
      incomingHandled.current = true;
      insertSql("Opened from another page", incoming.sql);
      navigate("/sql", { replace: true, state: null });
    }
  };

  const statusColor = result?.status === "ok" ? "text-emerald-400" : result?.status === "cancelled" ? "text-amber-300" : "text-red-400";
  const aiTitle = providerReady ? "" : "Add an AI key in Settings first";
  const importBlocked = connectionId === null || readOnly || isMongo;
  const importHint = connectionId === null ? "Choose a connection first." : isMongo ? "CSV, Excel and PDF import supports SQL databases for now." : readOnly ? "Turn off Read-only to import." : "";
  const hasJson = !!result?.documents && result.documents.length > 0;

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-[560px] flex-col gap-3">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-semibold">SQL Editor</h1>
        <Link to="/docs/sql-editor" className="mr-2 text-xs text-cyan-300 hover:text-cyan-200">Help</Link>
        <select value={connectionId ?? ""} onChange={(e) => { setConnectionId(e.target.value ? Number(e.target.value) : null); setResult(null); setBatch([]); }} className={field}>
          <option value="">No connection</option>
          {connections.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.engine})</option>)}
        </select>
        {connectionId !== null && (
          <select value={schema} onChange={(e) => setSchema(e.target.value)} className={field} title={isMongo ? "Database" : "Schema"}>
            {schemas.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <select value={effDialect} disabled={connectionId !== null} onChange={(e) => setDialect(e.target.value as Dialect)} className={`${field} disabled:opacity-60`} title="Query language">
          <option value="postgresql">PostgreSQL</option>
          <option value="mysql">MySQL</option>
          <option value="mongodb">MongoDB</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-300">
          <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /> Read-only
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {saveName === null ? (
            <button onClick={() => setSaveName("")} className="rounded-md border border-slate-600 px-3 py-1.5 text-sm">Save</button>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); onSave(); }} className="flex gap-1">
              <input autoFocus required maxLength={120} value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Query name" className="w-36 rounded-md border border-slate-700 bg-transparent px-2 py-1.5 text-sm" />
              <button className="rounded-md bg-slate-700 px-2 py-1.5 text-sm">Save</button>
              <button type="button" onClick={() => setSaveName(null)} className="px-1 text-sm text-slate-400">×</button>
            </form>
          )}
          <button onClick={() => navigate("/performance", { state: { sql: currentStatement() ?? "", connectionId } })} disabled={isMongo} title={isMongo ? "Analyze supports SQL databases for now" : ""} className="rounded-md border border-slate-600 px-3 py-1.5 text-sm disabled:opacity-40">Analyze</button>
          <button onClick={explainCurrent} disabled={!providerReady} title={aiTitle || "Explain the statement at the cursor"} className="rounded-md border border-slate-600 px-3 py-1.5 text-sm disabled:opacity-40">Explain</button>
          {!isMongo && <button onClick={onFormat} className="rounded-md border border-slate-600 px-3 py-1.5 text-sm">Format</button>}
          <button onClick={runAll} disabled={running} className="rounded-md border border-cyan-500/50 px-3 py-1.5 text-sm text-cyan-300 disabled:opacity-40">Run all</button>
          {running ? (
            <button onClick={cancel} className="rounded-md bg-red-500 px-3 py-1.5 text-sm font-medium text-[#ffffff]">Cancel</button>
          ) : (
            <button onClick={runCurrent} className="rounded-md bg-cyan-500 px-3 py-1.5 text-sm font-medium text-slate-950">Run (Ctrl+Enter)</button>
          )}
        </div>
      </div>
      {connections.length === 0 && (
        <p className="text-xs text-amber-300">No saved connection yet. You can still generate queries, but to run them <Link to="/databases" className="underline">add a connection</Link>.</p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-amber-300">{notice}</p>}

      <div className="flex min-h-0 flex-1 gap-3">
        {/* Left: AI prompt, files, tables */}
        <aside className="flex w-64 shrink-0 flex-col overflow-hidden rounded-lg border border-slate-800 bg-panel/80">
          <div className={panelHead}>AI prompt</div>
          <div className="space-y-2 p-3">
            <textarea rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={8000}
              placeholder={isMongo ? "e.g. Show the 10 oldest students per department" : "e.g. Create tables for a college: students, departments, courses and enrollments, with primary and foreign keys"}
              className="w-full rounded-md border border-slate-700 bg-transparent px-3 py-2 text-sm" />
            <button onClick={generate} disabled={generating || !prompt.trim() || !providerReady}
              className="w-full rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-slate-950 disabled:opacity-40">
              {generating ? "Writing query..." : `Generate ${dialectLabel} query`}
            </button>
            {!providerReady && <p className="text-xs text-amber-300">No AI key yet. <Link to="/settings" className="underline">Add one in Settings</Link>.</p>}
            <p className="text-[11px] leading-snug text-slate-500">The AI only writes into the editor. Nothing runs until you press Run.</p>
          </div>

          <div className={panelHead}>Upload file</div>
          <div className="space-y-2 p-3">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setPdfOpen(true)} disabled={importBlocked} className="rounded-md border border-slate-600 px-2 py-2 text-xs disabled:opacity-40">PDF table</button>
              <button onClick={() => setImportOpen(true)} disabled={importBlocked} className="rounded-md border border-slate-600 px-2 py-2 text-xs disabled:opacity-40">CSV / Excel</button>
            </div>
            {importBlocked && <p className="text-[11px] text-slate-500">{importHint}</p>}
          </div>

          <div className={panelHead}>{isMongo ? "Collections" : "Tables"} {graphAt && <span className="normal-case text-slate-600">· live</span>}</div>
          <ul className="min-h-0 flex-1 overflow-auto p-2 text-sm">
            {connectionId === null && <li className="px-2 text-xs text-slate-500">Choose a connection.</li>}
            {graph && graph.tables.length === 0 && <li className="px-2 text-xs text-slate-500">{isMongo ? "No collections yet." : "No tables yet."}</li>}
            {graph?.tables.map((t) => (
              <li key={t.name}>
                <button onClick={() => insertSql(`Explore ${t.name}`, exploreSql(t.name))}
                  className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-slate-300 hover:bg-slate-800/60" title="Insert a query for this one">
                  <span className="truncate">{t.name}</span>
                  <span className="text-[10px] text-slate-500">{t.columns.length} {isMongo ? "fields" : "cols"}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Center: editor + bottom panel */}
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-800">
          <div className={panelHead}>{isMongo ? "script.js" : "script.sql"} <span className="normal-case text-slate-600">· saved automatically in this browser{isMongo ? " · end each statement with ;" : ""}</span></div>
          <div className="min-h-[180px] flex-1">
            <Editor
              height="100%" language={isMongo ? "javascript" : "sql"} theme={resolved === "light" ? "vs" : "vs-dark"} defaultValue={initialScript} onMount={onMount}
              onChange={(v) => saveScript(user?.id, v ?? "")}
              options={{ minimap: { enabled: false }, fontSize: 13, automaticLayout: true, scrollBeyondLastLine: false }}
            />
          </div>

          <div className="flex h-80 shrink-0 flex-col border-t border-slate-800 bg-panel-deep">
            <div className="flex border-b border-slate-800 bg-slate-900/60">
              {([["results", "Results"], ["chat", "AI Chat"]] as const).map(([id, label]) => (
                <button key={id} onClick={() => setBottomTab(id)}
                  className={`px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider ${bottomTab === id ? "border-b-2 border-cyan-400 text-cyan-200" : "text-slate-400"}`}>
                  {label}
                </button>
              ))}
              {bottomTab === "results" && hasJson && (
                <span className="ml-auto flex items-center gap-1 pr-2 text-[11px]">
                  {(["table", "json"] as const).map((v) => (
                    <button key={v} onClick={() => setResultView(v)} className={`rounded px-2 py-0.5 uppercase ${resultView === v ? "bg-cyan-500/20 text-cyan-200" : "text-slate-400"}`}>{v}</button>
                  ))}
                </span>
              )}
            </div>

            {bottomTab === "results" && (
              <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3 text-sm">
                {running && <p className="text-slate-400">Running...</p>}
                {batch.length > 0 && (
                  <ul className="space-y-1 text-xs">
                    {batch.map((b, i) => (
                      <li key={i} className="flex gap-2">
                        <span className={b.status === "ok" ? "text-emerald-400" : b.status === "skipped" ? "text-slate-400" : "text-red-400"}>{b.status === "ok" ? "✓" : "✗"}</span>
                        <code className="min-w-0 flex-1 truncate text-slate-300">{b.sql.replace(/\s+/g, " ")}</code>
                        <span className="text-slate-500">{b.ms} ms</span>
                        {b.status !== "ok" && b.message && <span className="text-red-300">{b.message}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {result && result.status !== "ok" && <p className={statusColor}>{result.message}</p>}
                {lastFailed && result?.status === "error" && (
                  <div>
                    <button onClick={fixLast} disabled={!providerReady} title={aiTitle} className="rounded-md border border-cyan-500/50 px-3 py-1.5 text-xs text-cyan-300 disabled:opacity-40">Ask AI to explain and fix this error</button>
                    <span className="ml-2 text-[11px] text-slate-500">The query and the error text are sent to your AI provider.</span>
                  </div>
                )}
                {result?.status === "ok" && result.columns.length > 0 && (
                  <>
                    <p className="text-slate-400">
                      {result.row_count} row{result.row_count === 1 ? "" : "s"} · {result.duration_ms} ms
                      {result.truncated && <span className="text-amber-300"> · only the first {result.row_count} rows are shown</span>}
                    </p>
                    {resultView === "json" && hasJson ? (
                      <pre className="overflow-auto rounded-md bg-slate-900 p-3 font-mono text-xs text-slate-200">{JSON.stringify(result.documents, null, 2)}</pre>
                    ) : (
                      <ResultGrid columns={result.columns} rows={result.rows} />
                    )}
                    {resultView === "json" && hasJson && <p className="text-[11px] text-slate-500">JSON view shows at most the first 200 documents.</p>}
                  </>
                )}
                {result?.status === "ok" && result.columns.length === 0 && (
                  <p className="text-emerald-400">{result.statement_type} executed · {result.rows_affected ?? 0} row(s) affected · {result.duration_ms} ms</p>
                )}
                {!running && !result && batch.length === 0 && <p className="text-slate-500">Results appear here.</p>}
              </div>
            )}

            {bottomTab === "chat" && (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3 text-sm">
                  {chat.length === 0 && <p className="text-xs text-slate-500">Ask anything about {dialectLabel} or your schema, or use Explain in the top bar. The AI sees {isMongo ? "collection and field names" : "table and column names"}, never your data.</p>}
                  {chat.map((m, i) => (
                    <div key={i} className={`rounded-lg border p-2.5 ${m.role === "user" ? "border-slate-800 bg-surface" : "border-cyan-500/30 bg-cyan-500/5"}`}>
                      {m.role === "user" ? <p className="whitespace-pre-wrap text-slate-300">{m.content}</p> : <ReplyView text={m.content} />}
                      {m.suggestedSql && (
                        <button onClick={() => insertSql("From AI chat", m.suggestedSql as string)} className="mt-2 text-xs text-cyan-300 hover:text-cyan-200">
                          Insert into editor (not run)
                        </button>
                      )}
                    </div>
                  ))}
                  {chatBusy && <p className="text-xs text-slate-400">Thinking...</p>}
                </div>
                <div className="flex gap-2 border-t border-slate-800 p-2">
                  <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} maxLength={8000}
                    onKeyDown={(e) => { if (e.key === "Enter") sendChat(); }}
                    placeholder={providerReady ? `Ask a ${dialectLabel} question...` : "Add an AI key in Settings first"} disabled={!providerReady}
                    className="min-w-0 flex-1 rounded-md border border-slate-700 bg-transparent px-3 py-1.5 text-sm" />
                  <button onClick={sendChat} disabled={chatBusy || !chatInput.trim() || !providerReady} className="rounded-md bg-cyan-500 px-4 py-1.5 text-sm font-medium text-slate-950 disabled:opacity-40">Send</button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Right: live diagram */}
        <aside className={`flex shrink-0 flex-col overflow-hidden rounded-lg border border-slate-800 bg-panel/80 ${erWide ? "w-[55%]" : "w-[28rem]"}`}>
          <div className={`${panelHead} flex items-center gap-2`}>
            <span>{isMongo ? "Collections diagram (inferred)" : "ER diagram (live)"}</span>
            <span className="ml-auto flex items-center gap-2 normal-case">
              {graphAt && <span className="text-slate-600">updated {graphAt.toLocaleTimeString()}</span>}
              <button onClick={refreshGraph} disabled={graphBusy || connectionId === null} className="rounded border border-slate-700 px-2 py-0.5 text-slate-300 disabled:opacity-40">{graphBusy ? "..." : "Refresh"}</button>
              <button onClick={() => setErWide((w) => !w)} className="rounded border border-slate-700 px-2 py-0.5 text-slate-300">{erWide ? "Shrink" : "Expand"}</button>
            </span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
            {graphError && <p className="text-xs text-red-400">{graphError}</p>}
            <div className="min-h-0 flex-1">
              {graph && graph.tables.length > 0 ? (
                <ErFlow graph={graph} filename={`er-${schema || "diagram"}.png`} />
              ) : (
                <div className="flex h-full items-center justify-center rounded-md border border-dashed border-slate-800 p-6 text-center text-xs text-slate-500">
                  {connectionId === null ? "Choose a connection to see its diagram." : isMongo ? "No collections yet. Insert a document and the diagram appears here." : "No tables yet. Run a CREATE TABLE statement and the diagram appears here."}
                </div>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              {isMongo
                ? "MongoDB has no foreign keys. Dashed amber lines are guessed from field names like studentId. Fields come from a sample of 100 documents."
                : "Solid cyan = real foreign key. Dashed amber = guessed from column names, not a constraint."}
            </p>
          </div>
        </aside>
      </div>

      {pdfOpen && activeConn && (
        <PdfImportDialog connection={activeConn} schema={schema} onClose={() => setPdfOpen(false)} onImported={onPdfImported} />
      )}
      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-xl border border-slate-700 bg-modal p-5">
            <div className="mb-2 flex justify-end">
              <button onClick={() => setImportOpen(false)} className="text-sm text-slate-400 hover:text-white">Close</button>
            </div>
            <ImportData initialConnectionId={connectionId} onImported={onFileImported} />
          </div>
        </div>
      )}
    </div>
  );
}
