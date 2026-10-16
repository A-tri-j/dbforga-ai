import time

from fastapi import Depends, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.security import create_token, decode_token
from app.domain.models import User

bearer = HTTPBearer(auto_error=False)


def get_current_user(
    response: Response,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if creds is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(creds.credentials)
    user = db.get(User, int(payload["sub"])) if payload else None
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    issued = payload.get("iat")
    if issued is None or time.time() - issued > settings.jwt_refresh_after_minutes * 60:
        response.headers["X-New-Token"] = create_token(user.id)  # sliding session
    return user
