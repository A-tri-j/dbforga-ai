import json

from app.adapters import ai_providers
from app.adapters.ai_providers import ProviderError
from app.core.db import SessionLocal
from app.domain.models import AiProviderKey

SECRET = "sk-test-SECRET-VALUE-1234"


def test_key_lifecycle_never_leaks(client, auth, monkeypatch):
    monkeypatch.setattr(ai_providers, "list_models", lambda p, k, **kw: ["m1", "m2"])
    r = client.put("/api/ai/keys/openai", json={"api_key": SECRET, "model": "m1"}, headers=auth)
    assert r.status_code == 200 and SECRET not in r.text
    body = r.json()
    assert body["configured"] and body["is_default"] and body["key_hint"] == "…1234"

    listing = client.get("/api/ai/providers", headers=auth)
    assert SECRET not in listing.text
    with SessionLocal() as db:
        rows = db.query(AiProviderKey).all()
        assert rows and all(SECRET not in x.api_key_encrypted for x in rows)

    assert client.delete("/api/ai/keys/openai", headers=auth).status_code == 204
    after = client.get("/api/ai/providers", headers=auth).json()
    assert not next(p for p in after if p["provider"] == "openai")["configured"]


def test_invalid_key_is_not_stored(client, auth, monkeypatch):
    def reject(p, k, **kw):
        raise ProviderError("invalid_key", "The provider rejected this API key")

    monkeypatch.setattr(ai_providers, "list_models", reject)
    r = client.put("/api/ai/keys/groq", json={"api_key": SECRET, "model": "m1"}, headers=auth)
    assert r.status_code == 400
    assert not next(p for p in client.get("/api/ai/providers", headers=auth).json() if p["provider"] == "groq")["configured"]


def test_unknown_model_rejected(client, auth, monkeypatch):
    monkeypatch.setattr(ai_providers, "list_models", lambda p, k, **kw: ["m1"])
    r = client.put("/api/ai/keys/xai", json={"api_key": SECRET, "model": "nope"}, headers=auth)
    assert r.status_code == 400


def test_generate_sql_returns_review_only_suggestion(client, auth, monkeypatch):
    monkeypatch.setattr(ai_providers, "list_models", lambda p, k, **kw: ["m1"])
    client.put("/api/ai/keys/openai", json={"api_key": SECRET, "model": "m1"}, headers=auth)
    captured = {}

    def fake_chat(provider, api_key, model, messages, **kw):
        captured["messages"] = messages
        return "Try this:\n```sql\nSELECT 1;\n```"

    monkeypatch.setattr(ai_providers, "chat", fake_chat)
    r = client.post("/api/ai/chat", json={"mode": "generate_sql", "message": "one"}, headers=auth)
    assert r.status_code == 200
    assert r.json()["suggested_sql"] == "SELECT 1;"
    assert captured["messages"][0]["role"] == "system"
    assert SECRET not in json.dumps(captured["messages"])


def test_chat_without_provider(client, auth):
    r = client.post("/api/ai/chat", json={"mode": "chat", "message": "hi"}, headers=auth)
    assert r.status_code == 400


def test_chat_requires_auth(client):
    assert client.post("/api/ai/chat", json={"mode": "chat", "message": "hi"}).status_code == 401


def test_provider_error_mapping(client, auth, monkeypatch):
    monkeypatch.setattr(ai_providers, "list_models", lambda p, k, **kw: ["m1"])
    client.put("/api/ai/keys/openai", json={"api_key": SECRET, "model": "m1"}, headers=auth)

    def limited(*a, **kw):
        raise ProviderError("rate_limited", "Rate limit or quota exceeded at the provider")

    monkeypatch.setattr(ai_providers, "chat", limited)
    r = client.post("/api/ai/chat", json={"mode": "chat", "message": "hi"}, headers=auth)
    assert r.status_code == 429


def test_unsupported_provider(client, auth):
    r = client.put("/api/ai/keys/other", json={"api_key": SECRET, "model": "m"}, headers=auth)
    assert r.status_code == 422
