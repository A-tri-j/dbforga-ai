import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, BookOpen, Bot, CheckCircle2, Circle, Database, FolderKanban, Gauge, GitCompare,
  GraduationCap, History as HistoryIcon, Network, Settings as SettingsIcon, Terminal, Upload,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { getDashboard, getHealth, type DashboardSummary } from "../lib/api";
import { timeAgo } from "../lib/format";

type Feature = { to: string; icon: LucideIcon; title: string; text: string; accent: string };

const features: Feature[] = [
  { to: "/databases", icon: Database, title: "Database Explorer", accent: "bg-cyan-500/15 text-cyan-300",
    text: "Connect PostgreSQL or MySQL and browse schemas, tables, columns, keys and indexes." },
  { to: "/sql", icon: Terminal, title: "SQL Editor", accent: "bg-blue-500/15 text-blue-300",
    text: "One page: AI prompt, editor, AI explain and chat, CSV/Excel/PDF import and a live ER diagram." },
  { to: "/er", icon: Network, title: "ER Diagrams", accent: "bg-violet-500/15 text-violet-300",
    text: "Live diagrams from real foreign keys. Guessed relationships are clearly marked." },
  { to: "/compare", icon: GitCompare, title: "Schema Compare", accent: "bg-fuchsia-500/15 text-fuchsia-300",
    text: "Snapshot schemas, compare them and preview migration SQL. Nothing runs automatically." },
  { to: "/import", icon: Upload, title: "Data Import", accent: "bg-emerald-500/15 text-emerald-300",
    text: "CSV and Excel profiling, type inference, column mapping and a verified transactional import." },
  { to: "/ai", icon: Bot, title: "AI Assistant", accent: "bg-amber-500/15 text-amber-300",
    text: "Generate, explain and debug SQL with your own OpenAI, Groq or Grok key." },
  { to: "/history", icon: HistoryIcon, title: "History & Saved Queries", accent: "bg-sky-500/15 text-sky-300",
    text: "Search every query you ran and keep your favorites one click away." },
  { to: "/docs", icon: BookOpen, title: "Docs & Tutorials", accent: "bg-teal-500/15 text-teal-300",
    text: "App guides plus PostgreSQL, MySQL and MongoDB tutorials. Examples open in the editor." },
  { to: "/settings", icon: SettingsIcon, title: "Settings", accent: "bg-slate-500/20 text-slate-300",
    text: "Manage AI providers, keys and models." },
  { to: "/performance", icon: Gauge, title: "Performance Analyzer", accent: "bg-rose-500/15 text-rose-300",
    text: "Real EXPLAIN plans, findings and index suggestions. Indexes are created only after you confirm." },
  { to: "/learn", icon: GraduationCap, title: "Learn & Interview Practice", accent: "bg-lime-500/15 text-lime-300",
    text: "SQL and DBMS lessons, practice exercises and interview questions, with saved progress." },
];

const statusColor: Record<string, string> = {
  ok: "text-emerald-400", error: "text-red-400", timeout: "text-red-400", cancelled: "text-amber-300",
};

function StatCard({ label, value, icon: Icon, to }: { label: string; value: number | null; icon: LucideIcon; to: string }) {
  return (
    <Link to={to} className="group rounded-xl border border-slate-800 bg-surface/80 p-4 transition hover:border-cyan-500/40">
      <div className="flex items-center justify-between text-slate-400">
        <span className="text-xs uppercase tracking-wide">{label}</span>
        <Icon size={16} className="text-slate-500 transition group-hover:text-cyan-300" />
      </div>
      <div className="mt-2 text-3xl font-semibold text-white">{value ?? "…"}</div>
    </Link>
  );
}

function Step({ done, title, text, to }: { done: boolean; title: string; text: string; to: string }) {
  return (
    <Link to={to} className={`flex gap-3 rounded-xl border p-4 transition ${done ? "border-emerald-500/30 bg-emerald-500/5" : "border-slate-800 bg-surface/80 hover:border-cyan-500/40"}`}>
      {done ? <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-400" /> : <Circle size={20} className="mt-0.5 shrink-0 text-slate-600" />}
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-0.5 text-xs text-slate-400">{text}</div>
      </div>
    </Link>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [health, setHealth] = useState<"loading" | "ok" | "error">("loading");
  const [mode, setMode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    getHealth().then((h) => { setMode(h.mode); setHealth("ok"); }).catch(() => setHealth("error"));
    getDashboard().then(setSummary).catch((e: Error) => setError(e.message));
  }, []);

  const name = user?.email.split("@")[0] ?? "there";
  const s = summary;
  const allDone = !!s && s.connections > 0 && s.queries_total > 0 && s.ai_providers > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-br from-hero-from via-hero-via to-hero-to p-8">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-sm text-cyan-300">From Data to Insight With AI</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">
              Welcome back, <span className="bg-gradient-to-r from-cyan-300 to-blue-400 bg-clip-text text-transparent">{name}</span>
            </h1>
            <p className="mt-2 max-w-xl text-sm text-slate-400">
              Connect a database, write and run SQL, explore your schema, import data and get AI help, all in one workspace.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link to="/databases" className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-400">New connection</Link>
              <Link to="/sql" className="rounded-lg border border-slate-600 px-4 py-2 text-sm hover:border-cyan-500/50">Open SQL editor</Link>
              <Link to="/import" className="rounded-lg border border-slate-600 px-4 py-2 text-sm hover:border-cyan-500/50">Import data</Link>
              <Link to="/ai" className="rounded-lg border border-slate-600 px-4 py-2 text-sm hover:border-cyan-500/50">Ask AI</Link>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs">
            <span className={`h-2 w-2 rounded-full ${health === "ok" ? "bg-emerald-400" : health === "error" ? "bg-red-400" : "bg-slate-500"}`} />
            {health === "loading" && "Checking backend..."}
            {health === "ok" && `Backend online · ${mode} mode`}
            {health === "error" && "Backend unreachable"}
          </div>
        </div>
      </section>

      {error && <p className="text-sm text-red-400">Could not load your summary: {error}</p>}

      {/* Stats (real counts from your account) */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Projects" value={s?.projects ?? null} icon={FolderKanban} to="/projects" />
        <StatCard label="Connections" value={s?.connections ?? null} icon={Database} to="/databases" />
        <StatCard label="Queries (24h)" value={s?.queries_24h ?? null} icon={Terminal} to="/history" />
        <StatCard label="Saved queries" value={s?.saved_queries ?? null} icon={HistoryIcon} to="/history" />
        <StatCard label="AI providers" value={s?.ai_providers ?? null} icon={Bot} to="/settings" />
      </section>

      {/* Getting started */}
      {s && !allDone && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Getting started</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <Step done={s.connections > 0} to="/databases" title="1. Add a database connection" text="PostgreSQL or MySQL. Neon works too." />
            <Step done={s.queries_total > 0} to="/sql" title="2. Run your first query" text="Open the SQL editor and press Ctrl+Enter." />
            <Step done={s.ai_providers > 0} to="/settings" title="3. Connect an AI provider" text="Add your own OpenAI, Groq or Grok key." />
          </div>
        </section>
      )}

      {/* Features */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">Everything in DBForge AI</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(({ to, icon: Icon, title, text, accent }) => (
            <Link key={to} to={to} className="group flex flex-col rounded-xl border border-slate-800 bg-surface/80 p-4 transition hover:-translate-y-0.5 hover:border-cyan-500/40">
              <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-lg ${accent}`}><Icon size={20} /></div>
              <div className="text-sm font-semibold">{title}</div>
              <p className="mt-1 flex-1 text-xs leading-relaxed text-slate-400">{text}</p>
              <span className="mt-3 flex items-center gap-1 text-xs text-cyan-300 opacity-0 transition group-hover:opacity-100">
                Open <ArrowRight size={12} />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Recent activity */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent queries</h2>
          <Link to="/history" className="text-xs text-cyan-300 hover:text-cyan-200">View all</Link>
        </div>
        {s && s.recent_queries.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-sm text-slate-400">
            No queries yet. Open the <Link to="/sql" className="text-cyan-300 underline">SQL editor</Link> and run one.
          </p>
        )}
        <ul className="space-y-2">
          {s?.recent_queries.map((q) => (
            <li key={q.id} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-surface/80 px-4 py-3">
              <span className="w-16 shrink-0 text-xs font-medium text-slate-200">{q.statement_type}</span>
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-slate-300">{q.sql.replace(/\s+/g, " ")}</code>
              <span className={`text-xs ${statusColor[q.status] ?? ""}`}>{q.status}</span>
              <span className="hidden text-xs text-slate-500 sm:inline">{q.connection_name} · {timeAgo(q.created_at)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
