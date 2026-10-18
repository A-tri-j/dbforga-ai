from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)  # bcrypt limit


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: EmailStr


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    description: str
    created_at: datetime


class ConnectionIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    engine: Literal["postgresql", "mysql", "mongodb", "mongodb+srv"]
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(ge=1, le=65535)
    database: str = Field(min_length=1, max_length=255)
    username: str = Field(default="", max_length=255)
    password: str = Field(default="", max_length=500)
    ssl: bool = False

    @model_validator(mode="after")
    def _username_for_sql(self):
        if self.engine in ("postgresql", "mysql") and not self.username:
            raise ValueError("Username is required")
        return self

class ConnectionTestIn(ConnectionIn):
    connection_id: int | None = None  # edit mode: empty password means "use the saved one"


class ConnectionUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    engine: Literal["postgresql", "mysql", "mongodb", "mongodb+srv"]
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(ge=1, le=65535)
    database: str = Field(min_length=1, max_length=255)
    username: str = Field(default="", max_length=255)
    password: str | None = Field(default=None, max_length=500)  # None keeps the saved password
    ssl: bool = False

    @model_validator(mode="after")
    def _username_for_sql(self):
        if self.engine in ("postgresql", "mysql") and not self.username:
            raise ValueError("Username is required")
        return self


class LocalDb(BaseModel):
    engine: Literal["postgresql", "mysql", "mongodb"]
    label: str
    host: str
    port: int


class DetectOut(BaseModel):
    available: bool
    found: list[LocalDb]


class StorageOut(BaseModel):
    app_mode: str
    storage_kind: str
    location: str | None
    size_bytes: int | None
    session_days: int
    counts: dict[str, int]


class ConnectionOut(BaseModel):  # password is never returned
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    engine: str
    host: str
    port: int
    database: str
    username: str
    ssl: bool


class TestResult(BaseModel):
    ok: bool
    message: str
    server_version: str | None = None


class ColumnOut(BaseModel):
    name: str
    type: str
    nullable: bool
    default: str | None
    primary_key: bool


class ForeignKeyOut(BaseModel):
    name: str | None = None
    columns: list[str]
    ref_schema: str
    ref_table: str
    ref_columns: list[str]


class IndexOut(BaseModel):
    name: str
    columns: list[str]
    unique: bool


class TableDetail(BaseModel):
    schema_name: str = Field(alias="schema")
    table: str
    columns: list[ColumnOut]
    foreign_keys: list[ForeignKeyOut]
    indexes: list[IndexOut]
    model_config = ConfigDict(populate_by_name=True)


class ExecuteIn(BaseModel):
    sql: str = Field(min_length=1, max_length=100_000)
    query_id: str = Field(min_length=8, max_length=64)
    read_only: bool = True
    confirm_destructive: bool = False
    max_rows: int = Field(default=5000, ge=1, le=10000)
    timeout_seconds: int = Field(default=30, ge=1, le=300)


class ExecuteOut(BaseModel):
    status: Literal["ok", "error", "cancelled", "timeout", "confirmation_required"]
    message: str | None = None
    statement_type: str | None = None
    columns: list[str] = []
    rows: list[list[Any]] = []
    documents: list[Any] = []
    row_count: int = 0
    rows_affected: int | None = None
    truncated: bool = False
    duration_ms: int = 0


class CancelIn(BaseModel):
    query_id: str = Field(min_length=8, max_length=64)


class CancelOut(BaseModel):
    cancelled: bool


class HistoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    connection_id: int | None
    connection_name: str
    sql: str
    statement_type: str
    status: str
    duration_ms: int
    row_count: int
    created_at: datetime


class SavedQueryIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    sql: str = Field(min_length=1, max_length=100_000)
    connection_id: int | None = None


class SavedQueryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    sql: str
    connection_id: int | None
    created_at: datetime


class GraphColumn(BaseModel):
    name: str
    type: str
    nullable: bool
    primary_key: bool
    foreign_key: bool


class GraphTable(BaseModel):
    name: str
    columns: list[GraphColumn]


class Relationship(BaseModel):
    id: str
    source_table: str
    source_columns: list[str]
    target_table: str
    target_columns: list[str]
    kind: Literal["foreign_key", "inferred"]
    reason: str | None = None


class GraphOut(BaseModel):
    schema_name: str
    tables: list[GraphTable]
    relationships: list[Relationship]
    truncated: bool
    omitted_cross_schema_fks: int


class SnapshotIn(BaseModel):
    schema_name: str = Field(min_length=1, max_length=255)
    label: str = Field(default="", max_length=120)


class SnapshotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    connection_id: int | None
    connection_name: str
    engine: str
    schema_name: str
    label: str
    table_count: int
    created_at: datetime


class SchemaRef(BaseModel):
    type: Literal["live", "snapshot"]
    connection_id: int | None = None
    schema_name: str | None = None
    snapshot_id: int | None = None


class CompareIn(BaseModel):
    base: SchemaRef      # current state
    desired: SchemaRef   # state the migration should produce


class StatementOut(BaseModel):
    sql: str
    destructive: bool


class CompareOut(BaseModel):
    base_label: str
    desired_label: str
    engine: str
    identical: bool
    tables_added: list[str]
    tables_removed: list[str]
    tables_changed: list[dict[str, Any]]
    statements: list[StatementOut]
    warnings: list[str]


class ImportOut(BaseModel):
    import_id: str
    filename: str
    kind: Literal["csv", "xlsx"]


class ColumnProfile(BaseModel):
    index: int
    name: str
    original_name: str
    inferred_type: str
    null_count: int
    distinct_count: int
    max_length: int
    samples: list[str]
    is_key_candidate: bool


class ProfileOut(BaseModel):
    import_id: str
    filename: str
    kind: Literal["csv", "xlsx"]
    encoding: str | None
    delimiter: str | None
    sheets: list[str]
    sheet: str | None
    row_count: int
    duplicate_row_count: int
    columns: list[ColumnProfile]
    key_candidates: list[str]
    preview_columns: list[str]
    preview_rows: list[list[str]]
    suggested_table_name: str
    suggested_primary_key: str | None


class ImportColumnMap(BaseModel):
    source_index: int = Field(ge=0)
    target: str = Field(min_length=1, max_length=128)
    type: Literal["integer", "bigint", "float", "boolean", "date", "timestamp", "varchar", "text"] = "text"
    nullable: bool = True
    primary_key: bool = False


class ImportExecuteIn(BaseModel):
    connection_id: int
    schema_name: str = Field(min_length=1, max_length=255)
    table_name: str = Field(min_length=1, max_length=128)
    mode: Literal["create", "append"]
    sheet: str | None = None
    columns: list[ImportColumnMap] = Field(min_length=1, max_length=500)
    on_error: Literal["abort", "skip"] = "abort"
    confirm: bool = False


class ImportErrorItem(BaseModel):
    row: int
    column: str
    value: str
    message: str


class ImportReport(BaseModel):
    status: Literal["ok", "failed"]
    message: str
    rows_read: int
    rows_valid: int
    rows_invalid: int
    rows_inserted: int
    db_rows_before: int | None
    db_rows_after: int | None
    error_count: int
    errors: list[ImportErrorItem]
    errors_truncated: bool


ProviderName = Literal["openai", "groq", "xai"]


class ProviderStatus(BaseModel):
    provider: ProviderName
    label: str
    suggested_model: str
    configured: bool
    model: str | None = None
    key_hint: str | None = None
    is_default: bool = False


class ValidateIn(BaseModel):
    provider: ProviderName
    api_key: str = Field(min_length=8, max_length=300)


class ValidateOut(BaseModel):
    valid: bool
    models: list[str] = []
    message: str | None = None


class KeyIn(BaseModel):
    api_key: str | None = Field(default=None, min_length=8, max_length=300)
    model: str = Field(min_length=1, max_length=120)


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class ChatIn(BaseModel):
    mode: Literal["chat", "generate_sql", "explain", "debug"] = "chat"
    message: str = Field(default="", max_length=8000)
    sql: str | None = Field(default=None, max_length=50_000)
    error: str | None = Field(default=None, max_length=4000)
    connection_id: int | None = None
    schema_name: str | None = None
    provider: ProviderName | None = None
    dialect: Literal["postgresql", "mysql", "mongodb"] | None = None
    history: list[ChatMessage] = Field(default=[], max_length=20)


class ChatOut(BaseModel):
    reply: str
    provider: str
    model: str
    suggested_sql: str | None
    schema_tables_sent: int


class DashboardSummary(BaseModel):
    projects: int
    connections: int
    queries_24h: int
    queries_total: int
    saved_queries: int
    snapshots: int
    ai_providers: int
    recent_queries: list[HistoryOut]


class AnalyzeIn(BaseModel):
    sql: str = Field(min_length=1, max_length=100_000)
    schema_name: str = Field(min_length=1, max_length=255)
    query_id: str = Field(min_length=8, max_length=64)
    execute: bool = False  # True = EXPLAIN ANALYZE (actually runs a SELECT)
    timeout_seconds: int = Field(default=30, ge=1, le=300)


class FindingOut(BaseModel):
    severity: Literal["info", "warning"]
    title: str
    detail: str
    node_id: int | None = None


class IndexRecOut(BaseModel):
    schema_name: str
    table: str
    columns: list[str]
    reason: str
    sql: str
    caveat: str


class AnalyzeOut(BaseModel):
    status: Literal["ok", "error", "cancelled", "timeout"]
    message: str | None = None
    engine: str
    analyzed: bool
    plan: list[dict[str, Any]] = []
    summary: dict[str, Any] = {}
    findings: list[FindingOut] = []
    recommendations: list[IndexRecOut] = []
    raw_text: str | None = None
    duration_ms: int = 0


class CreateIndexIn(BaseModel):
    schema_name: str = Field(min_length=1, max_length=255)
    table: str = Field(min_length=1, max_length=255)
    columns: list[str] = Field(min_length=1, max_length=4)
    confirm: bool = False


class CreateIndexOut(BaseModel):
    created: bool
    index_name: str
    sql: str


class PdfTableOut(BaseModel):
    id: str
    page: int
    method: Literal["lines", "text-alignment"]
    rows: list[list[str]]
    header_guess: bool
    truncated: bool


class PdfExtractOut(BaseModel):
    filename: str
    pages_total: int
    pages_scanned: int
    tables: list[PdfTableOut]
    notes: list[str]


class PdfTableIn(BaseModel):
    headers: list[str] = Field(min_length=1, max_length=100)
    rows: list[list[str]] = Field(max_length=5000)


class PdfPreviewOut(BaseModel):
    row_count: int
    duplicate_row_count: int
    columns: list[ColumnProfile]
    key_candidates: list[str]


class PdfConfirmIn(PdfTableIn):
    connection_id: int
    schema_name: str = Field(min_length=1, max_length=255)
    table_name: str = Field(min_length=1, max_length=63)
    on_error: Literal["abort", "skip"] = "abort"
    confirm: bool = False


class StarterQuery(BaseModel):
    title: str
    sql: str


class PdfConfirmOut(BaseModel):
    report: ImportReport
    xlsx_import_id: str | None
    table_name: str
    queries: list[StarterQuery]


class SecurityOut(BaseModel):
    force_read_only: bool
    block_destructive: bool
    query_timeout_seconds: int
    max_rows: int


class SecurityIn(BaseModel):
    force_read_only: bool
    block_destructive: bool
    query_timeout_seconds: int = Field(ge=5, le=120)
    max_rows: int = Field(ge=100, le=10000)
    password: str | None = Field(default=None, max_length=72)  # needed only to relax a protection


class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    event: str
    detail: str
    ip: str | None
    created_at: datetime
