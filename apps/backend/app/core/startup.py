from app.core.config import settings

WEAK_SECRETS = {"change-me", "changeme", "secret", "paste-output-of-command-below"}


def validate_settings() -> list[str]:
    """Problems that must stop a production server from starting."""
    problems: list[str] = []
    if len(settings.jwt_secret) < 32 or settings.jwt_secret.lower() in WEAK_SECRETS:
        problems.append("DBFORGE_JWT_SECRET must be a random string of at least 32 characters")
    if settings.app_mode == "web":
        if settings.database_url.startswith("sqlite"):
            problems.append("Web mode needs PostgreSQL in DBFORGE_DATABASE_URL (SQLite files are lost on most hosts)")
        if settings.allow_private_hosts:
            problems.append("DBFORGE_ALLOW_PRIVATE_HOSTS must be false on a hosted server")
        if not settings.cors_origins or "*" in settings.cors_origins:
            problems.append("DBFORGE_CORS_ORIGINS must list your frontend URL, not *")
        if any("localhost" in o or "127.0.0.1" in o for o in settings.cors_origins):
            problems.append("DBFORGE_CORS_ORIGINS still contains localhost")
    return problems
