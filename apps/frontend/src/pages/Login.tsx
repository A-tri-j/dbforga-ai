import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function Login() {
  const { user, signIn, signUp, expired } = useAuth();
  const [remember, setRemember] = useState(true);
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await (mode === "login" ? signIn(email, password, remember) : signUp(email, password, remember));
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center">
      <form onSubmit={onSubmit} className="w-80 space-y-3 rounded-lg border border-slate-800 bg-surface p-6">
        <h1 className="text-xl font-semibold">
          DBForge <span className="text-cyan-400">AI</span>
        </h1>
        <input
          type="email" required placeholder="Email" value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-slate-700 bg-transparent px-3 py-2 text-sm"
        />
        <input
          type="password" required minLength={8} maxLength={72} placeholder="Password (min 8)" value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border border-slate-700 bg-transparent px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Keep me signed in (up to 30 days)
        </label>
        {expired && <p className="text-sm text-amber-300">Your session expired. Please sign in again.</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
        >
          {busy ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
        </button>
        <button
          type="button"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
          className="w-full text-xs text-slate-400 hover:text-slate-200"
        >
          {mode === "login" ? "No account? Register" : "Have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
