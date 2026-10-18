from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "DBForge AI"
    app_mode: str = "web"  # "web" | "desktop"
    cors_origins: list[str] = ["http://localhost:5173"]

    # SQLite locally; Neon later: postgresql+psycopg://user:pass@host/db?sslmode=require
    database_url: str = "sqlite:///./dbforge.db"

    jwt_secret: str  # required, no default on purpose
    jwt_expire_minutes: int = 60 * 24 * 30      # 30 days, counted from the last refresh
    jwt_refresh_after_minutes: int = 60 * 24    # hand out a fresh token when the current one is older than a day

    encryption_key: str  # required
    allow_private_hosts: bool = False

    max_upload_mb: int = 20
    max_import_rows: int = 100_000

    env: str = "development"        # "production" turns on the strict startup checks
    log_level: str = "INFO"
    trust_proxy: bool = False       # true behind Render/Vercel proxies, so the real client IP is used
    rate_limit_enabled: bool = True
    allow_registration: bool = True


    model_config = SettingsConfigDict(env_file=".env", env_prefix="DBFORGE_")


settings = Settings()
