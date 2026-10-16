import time

import jwt

from app.core.config import settings


def _token(user_id: int, issued_ago_s: int, expires_in_s: int) -> str:
    now = int(time.time())
    return jwt.encode({"sub": str(user_id), "iat": now - issued_ago_s, "exp": now + expires_in_s},
                      settings.jwt_secret, algorithm="HS256")


def test_session_lasts_30_days():
    assert settings.jwt_expire_minutes == 60 * 24 * 30


def test_fresh_token_is_not_replaced(client, auth):
    r = client.get("/api/auth/me", headers=auth)
    assert r.status_code == 200 and "x-new-token" not in r.headers


def test_old_token_is_replaced_by_a_fresh_one(client, auth):
    uid = client.get("/api/auth/me", headers=auth).json()["id"]
    old = _token(uid, issued_ago_s=2 * 86400, expires_in_s=3600)
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {old}"})
    assert r.status_code == 200 and r.headers["x-new-token"]
    r2 = client.get("/api/auth/me", headers={"Authorization": f"Bearer {r.headers['x-new-token']}"})
    assert r2.status_code == 200 and "x-new-token" not in r2.headers


def test_expired_token_needs_a_new_login(client, auth):
    uid = client.get("/api/auth/me", headers=auth).json()["id"]
    expired = _token(uid, issued_ago_s=31 * 86400, expires_in_s=-10)
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {expired}"}).status_code == 401
