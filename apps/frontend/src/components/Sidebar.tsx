import { NavLink } from "react-router-dom";
import {
  BookOpen, Bot, Database, FolderKanban, Gauge, GitCompare, GraduationCap, HardDrive, History as HistoryIcon, Home,
  LogOut, Monitor, Moon, Network, ScrollText, Settings, Sun, Terminal, Upload, type LucideIcon,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { useTheme, type ThemePref } from "../lib/theme";

type Item = { to: string; label: string; icon: LucideIcon };

const groups: { title: string; items: Item[] }[] = [
  {
    title: "Workspace",
    items: [
      { to: "/", label: "Home", icon: Home },
      { to: "/projects", label: "Projects", icon: FolderKanban },
      { to: "/databases", label: "Databases", icon: Database },
      { to: "/sql", label: "SQL Editor", icon: Terminal },
      { to: "/history", label: "History", icon: HistoryIcon },
    ],
  },
  {
    title: "Design & data",
    items: [
      { to: "/er", label: "ER Diagram", icon: Network },
      { to: "/compare", label: "Schema Compare", icon: GitCompare },
      { to: "/import", label: "Import", icon: Upload },
      { to: "/performance", label: "Performance", icon: Gauge },
    ],
  },
  {
    title: "Intelligence",
    items: [
      { to: "/ai", label: "AI Assistant", icon: Bot },
      { to: "/learn", label: "Learn", icon: GraduationCap },
    ],
  },
  {
    title: "System",
    items: [
      { to: "/activity", label: "Activity", icon: ScrollText },
      { to: "/docs", label: "Docs & Tutorials", icon: BookOpen },
      { to: "/storage", label: "My Data", icon: HardDrive },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];


export default function Sidebar() {
  const { user, signOut } = useAuth();
  const { pref, setPref } = useTheme();
  const nextTheme: Record<ThemePref, ThemePref> = { system: "light", light: "dark", dark: "system" };
  const ThemeIcon = pref === "system" ? Monitor : pref === "light" ? Sun : Moon;
  const initial = (user?.email[0] ?? "?").toUpperCase();

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-slate-800/80 bg-panel-deep/90 p-3">
      <div className="mb-5 flex items-center gap-2.5 px-2 pt-1">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 shadow-lg shadow-cyan-500/20">
          <Database size={18} className="text-white" />
        </div>
        <div className="leading-tight">
          <div className="text-base font-bold">DBForge <span className="text-cyan-400">AI</span></div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Database engineering</div>
        </div>
      </div>

      <nav className="flex-1 space-y-4 overflow-auto">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="mb-1 px-3 text-[10px] font-medium uppercase tracking-wider text-slate-600">{g.title}</div>
            <div className="space-y-0.5">
              {g.items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === "/"}
                  className={({ isActive }) =>
                    `relative flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition ${
                      isActive
                        ? "bg-cyan-500/10 text-cyan-200 before:absolute before:left-0 before:top-1.5 before:h-6 before:w-0.5 before:rounded before:bg-cyan-400"
                        : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                    }`
                  }
                >
                  <Icon size={16} /> {label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-900/50 p-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-500/20 text-sm font-semibold text-cyan-200">{initial}</div>
        <div className="min-w-0 flex-1 truncate text-xs text-slate-300">{user?.email}</div>
        <button onClick={() => setPref(nextTheme[pref])} title={`Theme: ${pref} (click to change)`} className="text-slate-500 hover:text-cyan-400"><ThemeIcon size={16} /></button>
        <button onClick={signOut} title="Sign out" className="text-slate-500 hover:text-red-400"><LogOut size={16} /></button>
      </div>
    </aside>
  );
}
