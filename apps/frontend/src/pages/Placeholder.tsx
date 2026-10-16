export default function Placeholder({ title }: { title: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-700 p-10 text-center text-slate-400">
      <h2 className="text-lg text-slate-200">{title}</h2>
      <p className="mt-1 text-sm">Not implemented yet. Planned for a later day.</p>
    </div>
  );
}
