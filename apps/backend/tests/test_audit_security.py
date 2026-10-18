from app.api import query as query_api
from app.core.db import SessionLocal
from app.core.crypto import encrypt
from app.domain.models import DbConnection
from app.services import audit, query_runner

PW = "password123"  # the password the `auth` fixture registers with


def _events(client, auth) -> list[dict]:
    return client.get("/api/account/audit?limit=200", headers=auth).json()


def _connection(client, auth) -> int:
    uid = client.get("/api/auth/me", headers=auth).json()["id"]
    with SessionLocal() as db:
        row = DbConnection(user_id=uid, name="local", engine="postgresql", host="localhost", port=5432,
                           database="d", username="u", password_encrypted=encrypt("pw"), ssl=False)
        db.add(row)
        db.commit()
        return row.id


def _execute(client, auth, cid: int, sql: str, **extra):
    body = {"sql": sql, "query_id": "q-test-0001", "read_only": False, "confirm_destructive": True, **extra}
    return client.post(f"/api/connections/{cid}/query/execute", json=body, headers=auth)


def test_match_event_rules():
    assert audit.match_event("POST", "/api/connections") == "connection.create"
    assert audit.match_event("DELETE", "/api/connections/7") == "connection.delete"
    assert audit.match_event("GET", "/api/account/export") == "data.export"
    assert audit.match_event("GET", "/api/connections") is None


def test_register_and_login_are_recorded_without_secrets(client, auth):
    client.post("/api/auth/login", json={"email": "nobody@testmail.io", "password": "x" * 8})
    events = {e["event"] for e in _events(client, auth)}
    assert {"account.register"} <= events
    assert PW not in str(_events(client, auth))


def test_failed_login_is_visible_to_the_account_owner(client, auth):
    email = client.get("/api/auth/me", headers=auth).json()["email"]
    assert client.post("/api/auth/login", json={"email": email, "password": "wrong-password"}).status_code == 401
    assert "login.failed" in {e["event"] for e in _events(client, auth)}


def test_audit_is_private_to_each_user(client, auth):
    mine = _events(client, auth)
    other = client.post("/api/auth/register", json={"email": "other-audit@testmail.io", "password": PW})
    assert other.status_code in (201, 409)
    assert all(e["event"] != "x" for e in mine)
    assert client.get("/api/account/audit").status_code == 401


def test_connection_create_and_export_are_audited_by_the_middleware(client, auth, monkeypatch):
    from app.api import connections as conn_api
    monkeypatch.setattr(conn_api, "test_connection", lambda p: "ok")
    body = {"name": "c", "engine": "postgresql", "host": "db.example.org", "port": 5432,
            "database": "d", "username": "u", "password": "pw-1-secret", "ssl": True}
    assert client.post("/api/connections", json=body, headers=auth).status_code == 201
    client.get("/api/account/export", headers=auth)
    events = _events(client, auth)
    assert {"connection.create", "data.export"} <= {e["event"] for e in events}
    assert "pw-1-secret" not in str(events)


def test_loosening_a_protection_needs_the_password(client, auth):
    tight = {"force_read_only": True, "block_destructive": True, "query_timeout_seconds": 10, "max_rows": 500}
    assert client.put("/api/account/security", json=tight, headers=auth).status_code == 200  # tightening is free

    relaxed = {**tight, "force_read_only": False}
    assert client.put("/api/account/security", json=relaxed, headers=auth).status_code == 403
    assert client.put("/api/account/security", json={**relaxed, "password": "wrong-password"}, headers=auth).status_code == 403
    assert client.put("/api/account/security", json={**relaxed, "password": PW}, headers=auth).status_code == 200
    assert client.get("/api/account/security", headers=auth).json()["force_read_only"] is False
    assert "security.denied" in {e["event"] for e in _events(client, auth)}


def test_destructive_statements_can_be_blocked(client, auth):
    cid = _connection(client, auth)
    settings_body = {"force_read_only": False, "block_destructive": True, "query_timeout_seconds": 30, "max_rows": 5000}
    client.put("/api/account/security", json=settings_body, headers=auth)
    r = _execute(client, auth, cid, "DROP TABLE student")
    assert r.status_code == 403
    assert "policy.blocked" in {e["event"] for e in _events(client, auth)}


def test_server_clamps_what_the_browser_asks_for(client, auth, monkeypatch):
    cid = _connection(client, auth)
    client.put("/api/account/security", headers=auth,
               json={"force_read_only": True, "block_destructive": False, "query_timeout_seconds": 10, "max_rows": 100})
    seen = {}

    def fake_run(**kw):
        seen.update(kw)
        return {"status": "ok", "message": None, "columns": [], "rows": [], "row_count": 0,
                "rows_affected": None, "truncated": False, "duration_ms": 1}

    monkeypatch.setattr(query_runner, "run_statement", fake_run)
    monkeypatch.setattr(query_api, "get_engine", lambda row: object())
    r = _execute(client, auth, cid, "SELECT 1", read_only=False, timeout_seconds=120, max_rows=10000)
    assert r.status_code == 200
    assert seen["read_only"] is True and seen["timeout_s"] == 10 and seen["max_rows"] == 100


def test_read_only_account_cannot_import(client, auth):
    client.put("/api/account/security", headers=auth,
               json={"force_read_only": True, "block_destructive": False, "query_timeout_seconds": 30, "max_rows": 5000})
    body = {"connection_id": 1, "schema_name": "public", "table_name": "t", "mode": "create", "confirm": True,
            "columns": [{"source_index": 0, "target": "a", "type": "text"}]}
    assert client.post("/api/imports/abc123/execute", json=body, headers=auth).status_code == 403
