from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    account, ai, auth, connections, dashboard, health, history, imports, learning,
    pdf, performance, projects, query, schema_tools,
)
from app.core.config import settings
from app.core.db import Base, engine
from app.domain import models  # noqa: F401  (registers tables)

Base.metadata.create_all(engine)

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-New-Token"],
)

app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(account.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(connections.router, prefix="/api")
app.include_router(query.router, prefix="/api")
app.include_router(history.router, prefix="/api")
app.include_router(schema_tools.router, prefix="/api")
app.include_router(imports.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(performance.router, prefix="/api")
app.include_router(learning.router, prefix="/api")
app.include_router(pdf.router, prefix="/api")




