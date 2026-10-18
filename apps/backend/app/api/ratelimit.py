import threading
import time
from collections import deque

from fastapi import Depends, HTTPException, Request

from app.api.deps import get_current_user
from app.core.config import settings
from app.domain.models import User


class SlidingWindowLimiter:
    """In memory, so it needs a single backend process (one uvicorn worker)."""

    def __init__(self) -> None:
        self._hits: dict[str, tuple[deque[float], int]] = {}
        self._lock = threading.Lock()
        self._calls = 0

    def check(self, key: str, limit: int, window_s: int) -> int | None:
        """None = allowed. Otherwise the seconds to wait."""
        now = time.monotonic()
        with self._lock:
            self._calls += 1
            if self._calls % 1000 == 0:
                self._cleanup(now)
            q, _ = self._hits.setdefault(key, (deque(), window_s))
            while q and now - q[0] > window_s:
                q.popleft()
            if len(q) >= limit:
                return max(1, int(window_s - (now - q[0])) + 1)
            q.append(now)
            self._hits[key] = (q, window_s)
            return None

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)

    def _cleanup(self, now: float) -> None:
        for key in [k for k, (q, w) in self._hits.items() if not q or now - q[-1] > w]:
            del self._hits[key]


limiter = SlidingWindowLimiter()


def client_ip(request: Request) -> str:
    if settings.trust_proxy:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def enforce(key: str, limit: int, window_s: int) -> None:
    if not settings.rate_limit_enabled:
        return
    wait = limiter.check(key, limit, window_s)
    if wait is not None:
        raise HTTPException(
            status_code=429, detail=f"Too many requests. Try again in {wait} seconds.",
            headers={"Retry-After": str(wait)},
        )


def limit_ip(name: str, limit: int, window_s: int):
    def dependency(request: Request) -> None:
        enforce(f"{name}:ip:{client_ip(request)}", limit, window_s)
    return dependency


def limit_user(name: str, limit: int, window_s: int):
    def dependency(user: User = Depends(get_current_user)) -> None:
        enforce(f"{name}:user:{user.id}", limit, window_s)
    return dependency
