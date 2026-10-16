import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import Sidebar from "./Sidebar";

export default function Layout() {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-6 text-slate-400">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6 lg:p-8">
        <Outlet />
      </main>

    </div>
  );
}
