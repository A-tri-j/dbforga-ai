from app.core.crypto import encrypt
from app.core.db import SessionLocal
from app.domain.models import DbConnection


def _add_connection(uid: int) -> None:
    with SessionLocal() as db:
        db.add(DbConnection(user_id=uid, name="local", engine="postgresql", host="localhost", port=5432,
                            database="d", username="u", password_encrypted=encrypt("TOP-SECRET-PW"), ssl=False))
        db.commit()


def test_export_contains_data_but_no_secrets(client, auth):
    _add_connection(client.get("/api/auth/me", headers=auth).json()["id"])
    r = client.get("/api/account/export", headers=auth)
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    assert "TOP-SECRET-PW" not in r.text and "password" not in r.text.lower()
    assert r.json()["connections"][0]["name"] == "local"


def test_storage_reports_counts_and_session(client, auth):
    _add_connection(client.get("/api/auth/me", headers=auth).json()["id"])
    body = client.get("/api/account/storage", headers=auth).json()
    assert body["counts"]["connections"] == 1 and body["session_days"] == 30
    assert body["storage_kind"] == "sqlite" and body["location"].endswith("test.db")


def test_account_endpoints_need_login(client):
    assert client.get("/api/account/export").status_code == 401
    assert client.get("/api/account/storage").status_code == 401
