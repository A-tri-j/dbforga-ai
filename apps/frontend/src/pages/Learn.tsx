import { useEffect, useState } from "react";
import { exercises, lessons, questions, SAMPLE_SCHEMA } from "../learn/content";
import { listProgress, markProgress, unmarkProgress } from "../lib/api";

type Tab = "lessons" | "practice" | "interview";

export default function Learn() {
  const [tab, setTab] = useState<Tab>("lessons");
  const [done, setDone] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lessonId, setLessonId] = useState(lessons[0].id);
  const [open, setOpen] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Record<string, { hint?: boolean; solution?: boolean }>>({});

  useEffect(() => {
    listProgress()
      .then((ids) => setDone(new Set(ids)))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const toggle = async (id: string) => {
    const wasDone = done.has(id);
    setDone((prev) => { const n = new Set(prev); if (wasDone) n.delete(id); else n.add(id); return n; });
    try {
      await (wasDone ? unmarkProgress(id) : markProgress(id));
    } catch (e) {
      setDone((prev) => { const n = new Set(prev); if (wasDone) n.add(id); else n.delete(id); return n; });
      setError(e instanceof Error ? e.message : "Could not save progress");
    }
  };

  const count = (ids: string[]) => ids.filter((i) => done.has(i)).length;
  const tabs: { id: Tab; label: string; ids: string[] }[] = [
    { id: "lessons", label: "Lessons", ids: lessons.map((l) => l.id) },
    { id: "practice", label: "Practice", ids: exercises.map((e) => e.id) },
    { id: "interview", label: "Interview", ids: questions.map((q) => q.id) },
  ];
  const lesson = lessons.find((l) => l.id === lessonId) ?? lessons[0];

  const DoneButton = ({ id }: { id: string }) => (
    <button onClick={() => toggle(id)} className={`rounded-md border px-3 py-1.5 text-xs ${done.has(id) ? "border-emerald-500/50 text-emerald-300" : "border-slate-600 text-slate-300"}`}>
      {done.has(id) ? "✓ Completed (click to undo)" : "Mark as done"}
    </button>
  );

  return (
    <div className="max-w-5xl space-y-4">
      <h1 className="text-2xl font-semibold">Learn</h1>
      <p className="rounded-lg border border-slate-800 bg-surface px-4 py-2 text-xs text-slate-400">
        Learning content is separate from your databases. Nothing on this page runs against a connection. Your progress is saved to your account.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-slate-400">Loading progress...</p>}

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`rounded-md px-3 py-1.5 text-sm ${tab === t.id ? "bg-cyan-500/10 text-cyan-300" : "text-slate-400 hover:bg-slate-800/60"}`}>
            {t.label} <span className="text-xs text-slate-500">{count(t.ids)}/{t.ids.length}</span>
          </button>
        ))}
      </div>

      {tab === "lessons" && (
        <div className="flex gap-5">
          <ul className="w-64 shrink-0 space-y-1">
            {lessons.map((l) => (
              <li key={l.id}>
                <button onClick={() => setLessonId(l.id)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm ${lessonId === l.id ? "bg-cyan-500/10 text-cyan-200" : "text-slate-300 hover:bg-slate-800/60"}`}>
                  <span className="mr-1">{done.has(l.id) ? "✓" : "○"}</span>{l.title}
                  <span className="ml-1 text-[10px] uppercase text-slate-500">{l.topic}</span>
                </button>
              </li>
            ))}
          </ul>
          <article className="min-w-0 flex-1 space-y-4 rounded-xl border border-slate-800 bg-surface p-5">
            <div>
              <h2 className="text-xl font-semibold">{lesson.title}</h2>
              <p className="text-sm text-slate-400">{lesson.summary}</p>
            </div>
            {lesson.sections.map((s, i) => (
              <div key={i} className="space-y-2">
                {s.heading && <h3 className="text-sm font-medium text-cyan-200">{s.heading}</h3>}
                <p className="text-sm leading-relaxed text-slate-300">{s.text}</p>
                {s.code && <pre className="overflow-auto rounded-md bg-slate-900 p-3 font-mono text-xs text-slate-200">{s.code}</pre>}
              </div>
            ))}
            <DoneButton id={lesson.id} />
          </article>
        </div>
      )}

      {tab === "practice" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-surface p-4 text-sm">
            <div className="mb-1 font-medium">Practice schema (imaginary, not your database)</div>
            <ul className="font-mono text-xs text-slate-400">{SAMPLE_SCHEMA.map((l) => <li key={l}>{l}</li>)}</ul>
            <p className="mt-2 text-xs text-slate-500">Write your answer here, then compare it with the solution. The query is not executed anywhere.</p>
          </div>
          {exercises.map((ex, i) => (
            <div key={ex.id} className="space-y-3 rounded-xl border border-slate-800 bg-surface p-4">
              <div className="font-medium">{i + 1}. {ex.title}</div>
              <p className="text-sm text-slate-300">{ex.prompt}</p>
              <textarea rows={4} value={answers[ex.id] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [ex.id]: e.target.value }))}
                placeholder="Write your SQL here..." className="w-full rounded-md border border-slate-700 bg-transparent px-3 py-2 font-mono text-xs" />
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setShown((s) => ({ ...s, [ex.id]: { ...s[ex.id], hint: !s[ex.id]?.hint } }))} className="rounded-md border border-slate-600 px-3 py-1.5 text-xs">Hint</button>
                <button onClick={() => setShown((s) => ({ ...s, [ex.id]: { ...s[ex.id], solution: !s[ex.id]?.solution } }))} className="rounded-md border border-slate-600 px-3 py-1.5 text-xs">Solution</button>
                <DoneButton id={ex.id} />
              </div>
              {shown[ex.id]?.hint && <p className="text-xs text-amber-300">Hint: {ex.hint}</p>}
              {shown[ex.id]?.solution && (
                <div className="space-y-2">
                  <pre className="overflow-auto rounded-md bg-slate-900 p-3 font-mono text-xs text-slate-200">{ex.solution}</pre>
                  <p className="text-xs text-slate-400">{ex.explanation}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "interview" && (
        <div className="space-y-2">
          {questions.map((q) => (
            <div key={q.id} className="rounded-xl border border-slate-800 bg-surface">
              <button onClick={() => setOpen(open === q.id ? null : q.id)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm">
                <span><span className="mr-2">{done.has(q.id) ? "✓" : "○"}</span>{q.question} <span className="ml-1 text-[10px] uppercase text-slate-500">{q.topic}</span></span>
                <span className="text-slate-500">{open === q.id ? "−" : "+"}</span>
              </button>
              {open === q.id && (
                <div className="space-y-3 border-t border-slate-800 px-4 py-3">
                  <p className="text-sm text-slate-300">{q.answer}</p>
                  <DoneButton id={q.id} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
