import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import * as api from "../lib/api";

type AuthState = {
  user: api.User | null;
  loading: boolean;
  expired: boolean;
  signIn: (email: string, password: string, remember?: boolean) => Promise<void>;
  signUp: (email: string, password: string, remember?: boolean) => Promise<void>;
  signOut: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<api.User | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const onLogout = () => { setUser(null); setExpired(true); };
    window.addEventListener("dbforge:logout", onLogout);
    return () => window.removeEventListener("dbforge:logout", onLogout);
  }, []);

  useEffect(() => {
    if (!api.getToken()) {
      setLoading(false);
      return;
    }
    api.me()
      .then(setUser)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const signIn = async (email: string, password: string, remember = true) => {
    const { access_token } = await api.login(email, password);
    api.setToken(access_token, remember);
    setUser(await api.me());
    setExpired(false);
  };

  const signUp = async (email: string, password: string, remember = true) => {
    await api.register(email, password);
    await signIn(email, password, remember);
  };

  const signOut = () => {
    api.setToken(null);
    setUser(null);
    setExpired(false);
  };

  return (
    <AuthContext.Provider value={{ user, loading, expired, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
