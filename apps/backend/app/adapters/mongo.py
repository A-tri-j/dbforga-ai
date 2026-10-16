from urllib.parse import quote_plus

import dns.resolver
from pymongo import MongoClient
from pymongo.errors import OperationFailure, PyMongoError, ServerSelectionTimeoutError

from app.adapters.sql_engine import ConnParams
from app.core.netguard import assert_host_allowed


def is_mongo(engine: str) -> bool:
    return engine in ("mongodb", "mongodb+srv")


def mongo_error(exc: Exception) -> str:
    if isinstance(exc, ServerSelectionTimeoutError):
        return "Could not reach the MongoDB server (timed out)"
    if isinstance(exc, OperationFailure):
        if exc.code == 18:
            return "Authentication failed"
        details = getattr(exc, "details", None) or {}
        return str(details.get("errmsg") or exc)[:300]
    if isinstance(exc, ValueError):
        return str(exc)[:300]
    text = str(exc)
    return text.splitlines()[0][:300] if text else exc.__class__.__name__


def _check_hosts(p: ConnParams) -> list[tuple[str, int]]:
    """SSRF guard. Returns the host list for standard URIs (empty for SRV)."""
    if p.engine == "mongodb+srv":
        try:
            answers = dns.resolver.resolve(f"_mongodb._tcp.{p.host.strip()}", "SRV", lifetime=10)
        except Exception as exc:
            raise ValueError("Could not resolve the Atlas (SRV) host") from exc
        for r in answers:
            assert_host_allowed(str(r.target).rstrip("."), int(r.port))
        return []
    hosts: list[tuple[str, int]] = []
    for part in p.host.split(","):
        host, _, port = part.strip().partition(":")
        if not host:
            continue
        number = int(port) if port.isdigit() else p.port
        assert_host_allowed(host, number)
        hosts.append((host, number))
    if not hosts:
        raise ValueError("Enter a host")
    return hosts


def _uri(p: ConnParams, hosts: list[tuple[str, int]], auth_source: str | None) -> str:
    cred = f"{quote_plus(p.username)}:{quote_plus(p.password)}@" if p.username else ""
    db = quote_plus(p.database)
    if p.engine == "mongodb+srv":
        base = f"mongodb+srv://{cred}{p.host.strip()}/{db}"
    else:
        base = f"mongodb://{cred}{','.join(f'{h}:{port}' for h, port in hosts)}/{db}"
    return base + (f"?authSource={quote_plus(auth_source)}" if auth_source else "")


def make_client(p: ConnParams) -> MongoClient:
    hosts = _check_hosts(p)
    sources: list[str | None] = list(dict.fromkeys(["admin", p.database])) if p.username else [None]
    kwargs: dict = dict(serverSelectionTimeoutMS=10000, connectTimeoutMS=10000, maxPoolSize=5, appname="DBForgeAI")
    if p.ssl or p.engine == "mongodb+srv":
        kwargs["tls"] = True
    last: Exception | None = None
    for source in sources:  # users live in "admin" or in their own database
        client = MongoClient(_uri(p, hosts, source), **kwargs)
        try:
            client.admin.command("ping")
            return client
        except OperationFailure as exc:
            client.close()
            last = exc
            if exc.code != 18:
                raise
        except PyMongoError:
            client.close()
            raise
    assert last is not None
    raise last


def test_connection(p: ConnParams) -> str:
    client = make_client(p)
    try:
        return f"MongoDB {client.server_info().get('version', '')}".strip()
    finally:
        client.close()
