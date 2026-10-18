import pytest

from app.api.ratelimit import SlidingWindowLimiter
from app.core import startup
from app.core.config import settings
from app.core.logging import redact


def test_limiter_blocks_after_the_limit_and_resets():
    lim = SlidingWindowLimiter()
    assert all(lim.check("k", 3, 60) is None for _ in range(3))
    wait = lim.check("k", 3, 60)
    assert wait is not None and wait >= 1
    assert lim.check("other", 3, 60) is None
    lim.reset("k")
    assert lim.check("k", 3, 60) is None


def test_login_is_rate_limited(client, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    email = "limit-test@testmail.io"
    client.post("/api/auth/register", json={"email": email, "password": "password123"})
    codes = [client.post("/api/auth/login", json={"email": email, "password": "wrong-password"}).status_code for _ in range(8)]
    assert set(codes) == {401}
    blocked = client.post("/api/auth/login", json={"email": email, "password": "wrong-password"})
    assert blocked.status_code == 429 and int(blocked.headers["retry-after"]) >= 1
    other = client.post("/api/auth/login", json={"email": "someone-else@testmail.io", "password": "x" * 8})
    assert other.status_code == 401  # a different account is not affected


def test_registration_can_be_closed(client, monkeypatch):
    monkeypatch.setattr(settings, "allow_registration", False)
    r = client.post("/api/auth/register", json={"email": "closed@testmail.io", "password": "password123"})
    assert r.status_code == 403


def test_security_headers_and_request_id(client):
    r = client.get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["x-request-id"]


def test_ready_checks_the_database(client):
    assert client.get("/api/ready").json() == {"status": "ready"}


@pytest.mark.parametrize("text,secret", [
    ("failed for postgresql://admin:Sup3rSecret@db.example.org:5432/app", "Sup3rSecret"),
    ("Authorization: Bearer abc.def.ghi-123", "abc.def.ghi-123"),
    ("key sk-abcdefghijklmnop was rejected", "sk-abcdefghijklmnop"),
    ('{"password": "hunter2hunter2"}', "hunter2hunter2"),
    ("mongodb+srv://user:pa55w0rd@cluster0.x.mongodb.net/db", "pa55w0rd"),
])
def test_logs_never_contain_secrets(text, secret):
    assert secret not in redact(text)


def test_production_check_rejects_unsafe_settings(monkeypatch):
    monkeypatch.setattr(settings, "app_mode", "web")
    monkeypatch.setattr(settings, "jwt_secret", "short")
    monkeypatch.setattr(settings, "database_url", "sqlite:///./x.db")
    monkeypatch.setattr(settings, "allow_private_hosts", True)
    monkeypatch.setattr(settings, "cors_origins", ["*"])
    assert len(startup.validate_settings()) == 4


def test_production_check_accepts_a_safe_setup(monkeypatch):
    monkeypatch.setattr(settings, "app_mode", "web")
    monkeypatch.setattr(settings, "jwt_secret", "x" * 40)
    monkeypatch.setattr(settings, "database_url", "postgresql+psycopg://u:p@host/db")
    monkeypatch.setattr(settings, "allow_private_hosts", False)
    monkeypatch.setattr(settings, "cors_origins", ["https://app.example.com"])
    assert startup.validate_settings() == []
