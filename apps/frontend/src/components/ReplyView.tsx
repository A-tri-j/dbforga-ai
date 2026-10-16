export default function ReplyView({ text }: { text: string }) {
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
