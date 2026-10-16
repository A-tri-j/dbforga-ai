export type Engine = "postgresql" | "mysql" | "mongodb" | "mongodb+srv";
export type ParsedConn = { engine: Engine; host: string; port: number; database: string; username: string; password: string; ssl: boolean };

const DEFAULT_PORT: Record<Engine, number> = { postgresql: 5432, mysql: 3306, mongodb: 27017, "mongodb+srv": 27017 };
const SCHEMES: Record<string, Engine> = {
  postgres: "postgresql", postgresql: "postgresql", mysql: "mysql", mariadb: "mysql",
  mongodb: "mongodb", "mongodb+srv": "mongodb+srv",
};

const decode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

export function parseConnectionString(input: string): ParsedConn | null {
  const m = input.trim().match(/^([a-z][a-z0-9+.-]*):\/\/(?:([^/?#]*)@)?([^/?#@]+)(?:\/([^?#]*))?(?:\?([^#]*))?$/i);
  if (!m) return null;
  const engine = SCHEMES[m[1].toLowerCase()];
  if (!engine) return null;

  const userinfo = m[2] ?? "";
  const colon = userinfo.indexOf(":");
  const username = decode(colon < 0 ? userinfo : userinfo.slice(0, colon));
  const password = decode(colon < 0 ? "" : userinfo.slice(colon + 1));

  let host = m[3];
  let port = DEFAULT_PORT[engine];
  if (engine !== "mongodb+srv") {
    const first = m[3].split(",")[0];
    const pm = first.match(/:(\d+)$/);
    if (pm) port = Number(pm[1]);
    if (engine !== "mongodb") host = first.replace(/:(\d+)$/, ""); // MongoDB keeps the full host list
  }

  const params = new URLSearchParams(m[5] ?? "");
  const get = (k: string) => (params.get(k) ?? "").toLowerCase();
  const ssl =
    engine === "mongodb+srv" ||
    ["require", "verify-ca", "verify-full"].includes(get("sslmode")) ||
    ["true", "1", "required", "verify_ca", "verify_identity"].includes(get("ssl")) ||
    get("tls") === "true" || get("usessl") === "true" ||
    /^(required|verify)/.test(get("ssl-mode"));

  return { engine, host, port, database: decode(m[4] ?? ""), username, password, ssl };
}

export function hintFor(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("private or local")) return "This server cannot reach local addresses. Use a database reachable from the internet, or the desktop app.";
  if (m.includes("could not be resolved") || m.includes("name or service not known") || m.includes("getaddrinfo")) return "Check the host name for typos.";
  if (m.includes("refused")) return "Nothing is listening there. Is the database running, and is the port right?";
  if (m.includes("timed out") || m.includes("timeout")) return "The server did not answer. Check the host, port, firewall and the provider's IP allowlist.";
  if (m.includes("password authentication failed") || m.includes("access denied") || m.includes("authentication failed")) return "Check the username and password.";
  if (m.includes("ssl") || m.includes("tls") || m.includes("encryption")) return "Try ticking SSL. Cloud databases usually require it.";
  if (m.includes("does not exist") || m.includes("unknown database")) return "Check the database name.";
  return "";
}
