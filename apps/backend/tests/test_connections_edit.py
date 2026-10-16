from app.api import connections as conn_api
from app.core.db import SessionLocal
from app.domain.models import DbConnection

BODY = {"name": "c", "engine": "postgresql", "host": "db.example.org", "port": 5432,
        "database": "d", "username": "u", "password": "pw-1", "ssl": True}


def _stored(cid: int) -> str:
    with SessionLocal() as db:
        return db.get(DbConnection, cid).password_encrypted


def test_update_keeps_password_unless_a_new_one_is_given(client, auth, monkeypatch):
    monkeypatch.setattr(conn_api, "test_connection", lambda p: "ok")
    cid = client.post("/api/connections", json=BODY, headers=auth).json()["id"]
    before = _stored(cid)

    r = client.put(f"/api/connections/{cid}", json={**BODY, "name": "renamed", "password": None}, headers=auth)
    assert r.status_code == 200 and r.json()["name"] == "renamed" and _stored(cid) == before

    client.put(f"/api/connections/{cid}", json={**BODY, "password": "pw-2"}, headers=auth)
    assert _stored(cid) != before


def test_failed_test_blocks_the_update(client, auth, monkeypatch):
    monkeypatch.setattr(conn_api, "test_connection", lambda p: "ok")
    cid = client.post("/api/connections", json=BODY, headers=auth).json()["id"]

    def boom(p):
        raise ValueError("nope")

    monkeypatch.setattr(conn_api, "test_connection", boom)
    r = client.put(f"/api/connections/{cid}", json={**BODY, "name": "x", "password": None}, headers=auth)
    assert r.status_code == 400


def test_detect_local_is_off_on_hosted_servers(client, auth):
    assert client.get("/api/connections/detect-local", headers=auth).json() == {"available": False, "found": []}
