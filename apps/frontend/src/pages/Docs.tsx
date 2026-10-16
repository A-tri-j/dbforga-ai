import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CATEGORIES, docText, docs, type Block } from "../docs/content";

function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 === 1
          ? <code key={i} className="rounded bg-slate-800 px-1 py-0.5 font-mono text-[12px] text-cyan-200">{part}</code>
          : <span key={i}>{part}</span>,
      )}
    </>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const openable = lang === "sql" || lang === "mongo";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard not available */ }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/70">
      <div className="flex items-center gap-3 border-b border-slate-800 px-3 py-1 text-[11px] uppercase tracking-wide text-slate-500">
        <span>{lang === "mongo" ? "mongosh" : lang}</span>
        <button onClick={copy} className="ml-auto normal-case text-slate-300 hover:text-white">{copied ? "Copied" : "Copy"}</button>
        {openable && (
          <button onClick={() => navigate("/sql", { state: { sql: code } })} className="normal-case text-cyan-300 hover:text-cyan-200" title="Adds it to your editor. Nothing runs automatically.">
            Open in editor
          </button>
        )}
      </div>
      <pre className="overflow-auto p-3 font-mono text-xs leading-relaxed text-slate-200">{code}</pre>
    </div>
  );
}

function BlockView({ b }: { b: Block }) {
  switch (b.t) {
    case "p":
      return <p className="text-sm leading-relaxed text-slate-300"><Inline text={b.text} /></p>;
    case "h":
      return <h3 className="pt-2 text-base font-semibold text-slate-100">{b.text}</h3>;
    case "list":
      return (
        <ul className="space-y-1.5 text-sm text-slate-300">
          {b.items.map((it, i) => <li key={i} className="flex gap-2"><span className="text-cyan-400">•</span><span><Inline text={it} /></span></li>)}
        </ul>
      );
    case "code":
      return <CodeBlock lang={b.lang} code={b.code} />;
    case "table":
      return (
        <div className="overflow-auto rounded-lg border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900 text-slate-300">
              <tr>{b.head.map((c, i) => <th key={i} className="p-2 font-medium">{c}</th>)}</tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-800/70 align-top">
                  {r.map((c, j) => <td key={j} className="p-2 text-slate-300"><Inline text={c} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "note":
      return (
        <div className={`rounded-lg border px-3 py-2 text-sm ${b.kind === "warn" ? "border-amber-500/40 bg-amber-500/5 text-amber-200" : "border-cyan-500/30 bg-cyan-500/5 text-cyan-100"}`}>
          <b>{b.kind === "warn" ? "Careful: " : "Tip: "}</b><Inline text={b.text} />
        </div>
      );
  }
}

export default function Docs() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const index = Math.max(0, docs.findIndex((d) => d.slug === slug));
  const doc = docs[index];
  const searchable = useMemo(() => docs.map((d) => ({ d, text: docText(d) })), []);
  const query = q.trim().toLowerCase();
  const results = query ? searchable.filter((s) => s.text.includes(query)).map((s) => s.d) : null;
  const prev = docs[index - 1];
  const next = docs[index + 1];

  const link = (slugValue: string, title: string, active: boolean, key?: string) => (
    <Link key={key ?? slugValue} to={`/docs/${slugValue}`}
      className={`block rounded-md px-3 py-1.5 text-sm ${active ? "bg-cyan-500/10 text-cyan-200" : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"}`}>
      {title}
    </Link>
  );

  return (
    <div className="mx-auto flex max-w-6xl gap-8">
      <nav className="sticky top-0 hidden h-[calc(100vh-4rem)] w-64 shrink-0 overflow-auto md:block">
        <h1 className="mb-3 text-xl font-semibold">Docs &amp; Tutorials</h1>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the docs..." className="mb-4 w-full rounded-md border border-slate-700 bg-transparent px-3 py-2 text-sm" />
        {results ? (
          <div className="space-y-0.5">
            <p className="px-3 pb-1 text-xs text-slate-500">{results.length} result(s)</p>
            {results.map((d) => link(d.slug, `${d.title}  ·  ${d.category}`, d.slug === doc.slug))}
          </div>
        ) : (
          CATEGORIES.map((c) => (
            <div key={c} className="mb-4">
              <div className="mb-1 px-3 text-[10px] font-medium uppercase tracking-wider text-slate-600">{c}</div>
              {docs.filter((d) => d.category === c).map((d) => link(d.slug, d.title, d.slug === doc.slug))}
            </div>
          ))
        )}
      </nav>

      <article className="min-w-0 max-w-3xl flex-1 space-y-4 pb-12">
        <div className="md:hidden">
          <select value={doc.slug} onChange={(e) => { navigate(`/docs/${e.target.value}`); }} className="w-full rounded-md border border-slate-700 bg-surface px-2 py-2 text-sm">
            {docs.map((d) => <option key={d.slug} value={d.slug}>{d.category}: {d.title}</option>)}
          </select>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-cyan-400">{doc.category}</div>
          <h2 className="mt-1 text-3xl font-bold tracking-tight">{doc.title}</h2>
          <p className="mt-1 text-sm text-slate-400">{doc.summary}</p>
        </div>
        {doc.blocks.map((b, i) => <BlockView key={i} b={b} />)}

        <div className="flex justify-between border-t border-slate-800 pt-4 text-sm">
          {prev ? <Link to={`/docs/${prev.slug}`} className="text-cyan-300 hover:text-cyan-200">← {prev.title}</Link> : <span />}
          {next ? <Link to={`/docs/${next.slug}`} className="text-cyan-300 hover:text-cyan-200">{next.title} →</Link> : <span />}
        </div>
      </article>
    </div>
  );
}
