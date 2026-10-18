const API_URL = import.meta.env.VITE_API_URL as string;
const TOKEN_KEY = "dbforge_token";

export const getToken = (): string | null => {
  try { return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
};

// remember = keep me signed in (local storage). Otherwise the token lives only until the window is closed.
export function setToken(t: string | null, remember = true): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    if (t) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, t);
  } catch { /* storage unavailable */ }
}

function refreshToken(t: string): void {
  try {
    if (sessionStorage.getItem(TOKEN_KEY)) sessionStorage.setItem(TOKEN_KEY, t);
    else localStorage.setItem(TOKEN_KEY, t);
  } catch { /* storage unavailable */ }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const fresh = res.headers.get("X-New-Token");
  if (fresh) refreshToken(fresh);
  if (res.status === 401 && token) {
    setToken(null);
    window.dispatchEvent(new Event("dbforge:logout"));
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail =
      typeof body?.detail === "string" ? body.detail : res.status >= 500 ? "Server error" : "Invalid input";
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type User = { id: number; email: string };
export type Project = { id: number; name: string; description: string; created_at: string };

export const getHealth = () => request<{ status: string; app: string; mode: string }>("/health");
export const register = (email: string, password: string) =>
  request<User>("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) });
export const login = (email: string, password: string) =>
  request<{ access_token: string }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
export const me = () => request<User>("/auth/me");
export const listProjects = () => request<Project[]>("/projects");
export const createProject = (name: string, description: string) =>
  request<Project>("/projects", { method: "POST", body: JSON.stringify({ name, description }) });
export const deleteProject = (id: number) => request<void>(`/projects/${id}`, { method: "DELETE" });

export type ConnectionInput = {
  name: string;
  engine: "postgresql" | "mysql" | "mongodb" | "mongodb+srv";
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
};
export type Connection = Omit<ConnectionInput, "password"> & { id: number };
export type TestResult = { ok: boolean; message: string; server_version: string | null };
export type ColumnInfo = { name: string; type: string; nullable: boolean; default: string | null; primary_key: boolean };
export type ForeignKeyInfo = { name: string | null; columns: string[]; ref_schema: string; ref_table: string; ref_columns: string[] };
export type IndexInfo = { name: string; columns: string[]; unique: boolean };
export type TableDetail = {
  schema: string;
  table: string;
  columns: ColumnInfo[];
  foreign_keys: ForeignKeyInfo[];
  indexes: IndexInfo[];
};

export type LocalDb = { engine: "postgresql" | "mysql" | "mongodb"; label: string; host: string; port: number };

export const listConnections = () => request<Connection[]>("/connections");
export const testConnection = (c: ConnectionInput, connectionId?: number) =>
  request<TestResult>("/connections/test", { method: "POST", body: JSON.stringify({ ...c, connection_id: connectionId ?? null }) });
export const testSavedConnection = (id: number) => request<TestResult>(`/connections/${id}/test`, { method: "POST" });
export const updateConnection = (id: number, c: Omit<ConnectionInput, "password"> & { password: string | null }) =>
  request<Connection>(`/connections/${id}`, { method: "PUT", body: JSON.stringify(c) });
export const detectLocal = () => request<{ available: boolean; found: LocalDb[] }>("/connections/detect-local");
export const createConnection = (c: ConnectionInput) =>
  request<Connection>("/connections", { method: "POST", body: JSON.stringify(c) });
export const deleteConnection = (id: number) => request<void>(`/connections/${id}`, { method: "DELETE" });
export const getSchemas = (id: number) => request<string[]>(`/connections/${id}/schemas`);
export const getTables = (id: number, schema: string) =>
  request<string[]>(`/connections/${id}/tables?schema=${encodeURIComponent(schema)}`);
export const getTableDetail = (id: number, schema: string, table: string) =>
  request<TableDetail>(`/connections/${id}/tables/${encodeURIComponent(table)}?schema=${encodeURIComponent(schema)}`);

export type ExecuteResult = {
  status: "ok" | "error" | "cancelled" | "timeout" | "confirmation_required";
  message: string | null;
  statement_type: string | null;
  columns: string[];
  rows: unknown[][];
  documents?: unknown[];
  row_count: number;
  rows_affected: number | null;
  truncated: boolean;
  duration_ms: number;
};

export const executeQuery = (
  connectionId: number,
  body: { sql: string; query_id: string; read_only: boolean; confirm_destructive: boolean },
) =>
  request<ExecuteResult>(`/connections/${connectionId}/query/execute`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const cancelQuery = (connectionId: number, queryId: string) =>
  request<{ cancelled: boolean }>(`/connections/${connectionId}/query/cancel`, {
    method: "POST",
    body: JSON.stringify({ query_id: queryId }),
  });

export type HistoryItem = {
  id: number;
  connection_id: number | null;
  connection_name: string;
  sql: string;
  statement_type: string;
  status: string;
  duration_ms: number;
  row_count: number;
  created_at: string;
};
export type SavedQuery = {
  id: number;
  name: string;
  sql: string;
  connection_id: number | null;
  created_at: string;
};

export const listHistory = (q: string, offset: number, limit = 50) =>
  request<HistoryItem[]>(`/history?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`);
export const deleteHistoryItem = (id: number) => request<void>(`/history/${id}`, { method: "DELETE" });
export const clearHistory = () => request<void>("/history", { method: "DELETE" });
export const listSavedQueries = () => request<SavedQuery[]>("/saved-queries");
export const createSavedQuery = (b: { name: string; sql: string; connection_id: number | null }) =>
  request<SavedQuery>("/saved-queries", { method: "POST", body: JSON.stringify(b) });
export const deleteSavedQuery = (id: number) => request<void>(`/saved-queries/${id}`, { method: "DELETE" });

export type GraphColumn = { name: string; type: string; nullable: boolean; primary_key: boolean; foreign_key: boolean };
export type GraphTable = { name: string; columns: GraphColumn[] };
export type Relationship = {
  id: string;
  source_table: string;
  source_columns: string[];
  target_table: string;
  target_columns: string[];
  kind: "foreign_key" | "inferred";
  reason: string | null;
};
export type Graph = {
  schema_name: string;
  tables: GraphTable[];
  relationships: Relationship[];
  truncated: boolean;
  omitted_cross_schema_fks: number;
};
export type Snapshot = {
  id: number;
  connection_id: number | null;
  connection_name: string;
  engine: string;
  schema_name: string;
  label: string;
  table_count: number;
  created_at: string;
};
export type SchemaRef = {
  type: "live" | "snapshot";
  connection_id?: number | null;
  schema_name?: string | null;
  snapshot_id?: number | null;
};
type ColLite = { name: string; type: string; nullable: boolean; default: string | null };
type FkLite = { name: string | null; columns: string[]; ref_table: string; ref_columns: string[] };
type IdxLite = { name: string | null; columns: string[]; unique: boolean };
export type TableDiff = {
  table: string;
  columns_added: ColLite[];
  columns_removed: ColLite[];
  columns_changed: { name: string; changes: string[] }[];
  fks_added: FkLite[];
  fks_removed: FkLite[];
  indexes_added: IdxLite[];
  indexes_removed: IdxLite[];
  primary_key_changed: { from: string[]; to: string[] } | null;
};
export type CompareResult = {
  base_label: string;
  desired_label: string;
  engine: string;
  identical: boolean;
  tables_added: string[];
  tables_removed: string[];
  tables_changed: TableDiff[];
  statements: { sql: string; destructive: boolean }[];
  warnings: string[];
};

export const getGraph = (id: number, schema: string) =>
  request<Graph>(`/connections/${id}/graph?schema=${encodeURIComponent(schema)}`);
export const createSnapshot = (id: number, schema_name: string, label: string) =>
  request<Snapshot>(`/connections/${id}/snapshots`, { method: "POST", body: JSON.stringify({ schema_name, label }) });
export const listSnapshots = () => request<Snapshot[]>("/snapshots");
export const deleteSnapshot = (id: number) => request<void>(`/snapshots/${id}`, { method: "DELETE" });
export const compareSchemas = (base: SchemaRef, desired: SchemaRef) =>
  request<CompareResult>("/schema/compare", { method: "POST", body: JSON.stringify({ base, desired }) });

export type ColumnProfile = {
  index: number;
  name: string;
  original_name: string;
  inferred_type: string;
  null_count: number;
  distinct_count: number;
  max_length: number;
  samples: string[];
  is_key_candidate: boolean;
};
export type ImportProfile = {
  import_id: string;
  filename: string;
  kind: "csv" | "xlsx";
  encoding: string | null;
  delimiter: string | null;
  sheets: string[];
  sheet: string | null;
  row_count: number;
  duplicate_row_count: number;
  columns: ColumnProfile[];
  key_candidates: string[];
  preview_columns: string[];
  preview_rows: string[][];
  suggested_table_name: string;
  suggested_primary_key: string | null;
};
export type ImportColumnMap = {
  source_index: number;
  target: string;
  type: string;
  nullable: boolean;
  primary_key: boolean;
};
export type ImportReport = {
  status: "ok" | "failed";
  message: string;
  rows_read: number;
  rows_valid: number;
  rows_invalid: number;
  rows_inserted: number;
  db_rows_before: number | null;
  db_rows_after: number | null;
  error_count: number;
  errors: { row: number; column: string; value: string; message: string }[];
  errors_truncated: boolean;
};

export async function uploadImport(file: File): Promise<{ import_id: string; filename: string; kind: string }> {
  const form = new FormData();
  form.append("file", file);
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_URL}/imports`, { method: "POST", body: form, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(typeof body?.detail === "string" ? body.detail : "Upload failed");
  }
  return res.json();
}

export const getImportProfile = (id: string, sheet?: string) =>
  request<ImportProfile>(`/imports/${id}/profile${sheet ? `?sheet=${encodeURIComponent(sheet)}` : ""}`);

export const executeImport = (
  id: string,
  body: {
    connection_id: number;
    schema_name: string;
    table_name: string;
    mode: "create" | "append";
    sheet: string | null;
    columns: ImportColumnMap[];
    on_error: "abort" | "skip";
    confirm: boolean;
  },
) => request<ImportReport>(`/imports/${id}/execute`, { method: "POST", body: JSON.stringify(body) });

export const deleteImport = (id: string) => request<void>(`/imports/${id}`, { method: "DELETE" });

export type ProviderName = "openai" | "groq" | "xai";
export type ProviderStatus = {
  provider: ProviderName;
  label: string;
  suggested_model: string;
  configured: boolean;
  model: string | null;
  key_hint: string | null;
  is_default: boolean;
};
export type ChatMode = "chat" | "generate_sql" | "explain" | "debug";
export type ChatReply = {
  reply: string;
  provider: string;
  model: string;
  suggested_sql: string | null;
  schema_tables_sent: number;
};

export const listProviders = () => request<ProviderStatus[]>("/ai/providers");
export const validateKey = (provider: ProviderName, api_key: string) =>
  request<{ valid: boolean; models: string[]; message: string | null }>("/ai/validate", {
    method: "POST",
    body: JSON.stringify({ provider, api_key }),
  });
export const getProviderModels = (provider: ProviderName) =>
  request<string[]>(`/ai/providers/${provider}/models`);
export const saveKey = (provider: ProviderName, api_key: string | null, model: string) =>
  request<ProviderStatus>(`/ai/keys/${provider}`, { method: "PUT", body: JSON.stringify({ api_key, model }) });
export const setDefaultProvider = (provider: ProviderName) =>
  request<ProviderStatus>(`/ai/keys/${provider}/default`, { method: "POST" });
export const removeKey = (provider: ProviderName) =>
  request<void>(`/ai/keys/${provider}`, { method: "DELETE" });
export const aiChat = (body: {
  mode: ChatMode;
  message: string;
  sql: string | null;
  error: string | null;
  connection_id: number | null;
  schema_name: string | null;
  provider: ProviderName | null;
  history: { role: "user" | "assistant"; content: string }[];
  dialect?: "postgresql" | "mysql" | "mongodb" | null;
}) => request<ChatReply>("/ai/chat", { method: "POST", body: JSON.stringify(body) });

export type DashboardSummary = {
  projects: number;
  connections: number;
  queries_24h: number;
  queries_total: number;
  saved_queries: number;
  snapshots: number;
  ai_providers: number;
  recent_queries: HistoryItem[];
};
export const getDashboard = () => request<DashboardSummary>("/dashboard/summary");

export type PlanNode = {
  id: number;
  node_type: string | null;
  relation: string | null;
  schema: string | null;
  index_name: string | null;
  cost_total: number | null;
  plan_rows: number | null;
  actual_rows: number | null;
  actual_time_ms: number | null;
  loops: number | null;
  filter: string | null;
  condition: string | null;
  rows_removed: number | null;
  is_full_scan: boolean;
  sort_on_disk: boolean;
  children: PlanNode[];
};
export type Finding = { severity: "info" | "warning"; title: string; detail: string; node_id: number | null };
export type IndexRec = { schema_name: string; table: string; columns: string[]; reason: string; sql: string; caveat: string };
export type AnalyzeResult = {
  status: "ok" | "error" | "cancelled" | "timeout";
  message: string | null;
  engine: string;
  analyzed: boolean;
  plan: PlanNode[];
  summary: {
    total_cost?: number | null;
    planning_ms?: number | null;
    execution_ms?: number | null;
    node_count?: number;
    full_scans?: number;
    index_scans?: number;
    health?: "ok" | "attention";
  };
  findings: Finding[];
  recommendations: IndexRec[];
  raw_text: string | null;
  duration_ms: number;
};

export const analyzeQuery = (
  connectionId: number,
  body: { sql: string; schema_name: string; query_id: string; execute: boolean },
) =>
  request<AnalyzeResult>(`/connections/${connectionId}/analyze`, { method: "POST", body: JSON.stringify(body) });

export const createIndex = (
  connectionId: number,
  body: { schema_name: string; table: string; columns: string[]; confirm: boolean },
) =>
  request<{ created: boolean; index_name: string; sql: string }>(`/connections/${connectionId}/indexes`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const listProgress = () => request<string[]>("/learn/progress");
export const markProgress = (id: string) => request<void>(`/learn/progress/${id}`, { method: "PUT" });
export const unmarkProgress = (id: string) => request<void>(`/learn/progress/${id}`, { method: "DELETE" });

export type PdfTable = {
  id: string;
  page: number;
  method: "lines" | "text-alignment";
  rows: string[][];
  header_guess: boolean;
  truncated: boolean;
};
export type PdfExtract = {
  filename: string;
  pages_total: number;
  pages_scanned: number;
  tables: PdfTable[];
  notes: string[];
};
export type PdfPreview = {
  row_count: number;
  duplicate_row_count: number;
  columns: ColumnProfile[];
  key_candidates: string[];
};
export type PdfConfirmResult = {
  report: ImportReport;
  xlsx_import_id: string | null;
  table_name: string;
  queries: { title: string; sql: string }[];
};

export async function extractPdf(file: File): Promise<PdfExtract> {
  const form = new FormData();
  form.append("file", file);
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_URL}/pdf/extract`, { method: "POST", body: form, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(typeof body?.detail === "string" ? body.detail : res.status === 413 ? "File too large" : "Upload failed");
  }
  return res.json();
}

export const previewPdfTable = (headers: string[], rows: string[][]) =>
  request<PdfPreview>("/pdf/preview", { method: "POST", body: JSON.stringify({ headers, rows }) });

export const confirmPdfImport = (body: {
  headers: string[];
  rows: string[][];
  connection_id: number;
  schema_name: string;
  table_name: string;
  on_error: "abort" | "skip";
  confirm: boolean;
}) => request<PdfConfirmResult>("/pdf/confirm", { method: "POST", body: JSON.stringify(body) });

export async function downloadPdfXlsx(id: string, filename: string) {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_URL}/pdf/xlsx/${id}`, { headers });
  if (!res.ok) throw new Error("Download failed (the file may have expired)");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export type StorageInfo = {
  app_mode: string;
  storage_kind: string;
  location: string | null;
  size_bytes: number | null;
  session_days: number;
  counts: Record<string, number>;
};
export const getStorage = () => request<StorageInfo>("/account/storage");

export async function downloadExport() {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_URL}/account/export`, { headers });
  if (!res.ok) throw new Error("Export failed");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = "dbforge-export.json";
  a.click();
  URL.revokeObjectURL(url);
}

export type SecuritySettings = {
  force_read_only: boolean;
  block_destructive: boolean;
  query_timeout_seconds: number;
  max_rows: number;
};
export type AuditItem = { id: number; event: string; detail: string; ip: string | null; created_at: string };

export const getSecurity = () => request<SecuritySettings>("/account/security");
export const saveSecurity = (s: SecuritySettings & { password: string | null }) =>
  request<SecuritySettings>("/account/security", { method: "PUT", body: JSON.stringify(s) });
export const getAudit = (offset = 0, limit = 50) =>
  request<AuditItem[]>(`/account/audit?limit=${limit}&offset=${offset}`);

