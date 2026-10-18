import logging
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from app.api.ratelimit import client_ip
from app.core.db import SessionLocal
from app.core.security import decode_token
from app.services import audit

from app.api import (
    account, ai, auth, connections, dashboard, health, history, imports, learning,
    pdf, performance, projects, query, schema_tools,
)
from app.core.config import settings
from app.core.logging import setup_logging
from app.core.migrate import run_migrations
from app.core.startup import validate_settings

setup_logging()
log = logging.getLogger("dbforge")
access_log = logging.getLogger("dbforge.access")

production = settings.env == "production"
if production:
    problems = validate_settings()
    if problems:
        raise RuntimeError("Unsafe configuration, refusing to start:\n- " + "\n- ".join(problems))

run_migrations()

app = FastAPI(
    title=settings.app_name,
    docs_url=None if production else "/docs",
    redoc_url=None if production else "/redoc",
    openapi_url=None if production else "/openapi.json",
)


@app.middleware("http")
async def request_log(request: Request, call_next):
    request_id = uuid.uuid4().hex[:12]
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        access_log.exception("%s %s %s -> unhandled error", request_id, request.method, request.url.path)
        raise
    response.headers["X-Request-ID"] = request_id
    if request.url.path not in ("/api/health", "/api/ready"):
        # path only: no query string, headers or body are ever logged
        access_log.info("%s %s %s %s %dms", request_id, request.method, request.url.path, response.status_code,
                        int((time.perf_counter() - started) * 1000))
    return response


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    h = response.headers
    h["X-Content-Type-Options"] = "nosniff"
    h["X-Frame-Options"] = "DENY"
    h["Referrer-Policy"] = "no-referrer"
    h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if request.url.path.startswith("/api/"):
        h["Cache-Control"] = "no-store"
    if production:
        h["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        if request.headers.get("x-forwarded-proto", request.url.scheme) == "https":
            h["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


@app.middleware("http")
async def audit_log(request: Request, call_next):
    response = await call_next(request)
    event = audit.match_event(request.method, request.url.path)
    if event and response.status_code < 400:
        auth_header = request.headers.get("authorization", "")
        payload = decode_token(auth_header[7:]) if auth_header.lower().startswith("bearer ") else None
        if payload:
            def write() -> None:
                with SessionLocal() as db:
                    audit.record(db, int(payload["sub"]), event, request.url.path, client_ip(request))
            await run_in_threadpool(write)
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-New-Token", "X-Request-ID", "Retry-After"],
)

for module in (health, auth, projects, connections, query, history, schema_tools, imports, ai, dashboard,
               learning, performance, pdf, account):
    app.include_router(module.router, prefix="/api")

log.info("DBForge AI started (mode=%s, env=%s)", settings.app_mode, settings.env)
