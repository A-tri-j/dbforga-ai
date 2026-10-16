import { useEffect, useState, type FormEvent } from "react";
import { createProject, deleteProject, listProjects, type Project } from "../lib/api";

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const load = () =>
    listProjects()
      .then(setProjects)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await createProject(name, description);
      setName("");
      setDescription("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    }
  };

  const onDelete = async (id: number) => {
    if (!window.confirm("Delete this project?")) return;
    try {
      await deleteProject(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete project");
    }
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold">Projects</h1>

      <form onSubmit={onCreate} className="mt-4 flex gap-2">
        <input
          required placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded-md border border-slate-700 bg-transparent px-3 py-2 text-sm"
        />
        <input
          placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)}
          className="flex-1 rounded-md border border-slate-700 bg-transparent px-3 py-2 text-sm"
        />
        <button className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950">Add</button>
      </form>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {loading && <p className="mt-4 text-sm text-slate-400">Loading...</p>}
      {!loading && projects.length === 0 && (
        <p className="mt-4 text-sm text-slate-400">No projects yet. Create your first one above.</p>
      )}

      <ul className="mt-4 space-y-2">
        {projects.map((p) => (
          <li key={p.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-surface p-3">
            <div>
              <div className="text-sm font-medium">{p.name}</div>
              {p.description && <div className="text-xs text-slate-400">{p.description}</div>}
            </div>
            <button onClick={() => onDelete(p.id)} className="text-xs text-red-400 hover:text-red-300">
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
