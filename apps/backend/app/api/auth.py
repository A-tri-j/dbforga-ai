from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.ratelimit import client_ip, enforce, limiter
from app.api.schemas import Credentials, TokenOut, UserOut
from app.core.config import settings
from app.core.db import get_db
from app.core.security import create_token, hash_password, verify_password
from app.domain.models import User
from app.services import audit

router = APIRouter(prefix="/auth", tags=["auth"])

# Checked when the email does not exist, so a wrong email takes as long as a wrong password.
_DUMMY_HASH = hash_password("not-a-real-password")


@router.post("/register", response_model=UserOut, status_code=201)
def register(body: Credentials, request: Request, db: Session = Depends(get_db)):
    if not settings.allow_registration:
        raise HTTPException(status_code=403, detail="Registration is closed on this server")
    ip = client_ip(request)
    enforce(f"register:{ip}", 10, 3600)
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(email=email, password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    audit.record(db, user.id, "account.register", "", ip)
    return user


@router.post("/login", response_model=TokenOut)
def login(body: Credentials, request: Request, db: Session = Depends(get_db)):
    ip, email = client_ip(request), body.email.lower()
    enforce(f"login-ip:{ip}", 40, 600)
    enforce(f"login:{ip}:{email}", 8, 600)
    user = db.scalar(select(User).where(User.email == email))
    ok = verify_password(body.password, user.password_hash if user else _DUMMY_HASH)
    if user is None or not ok:
        if user is not None:  # shown to that account's owner in the Activity log
            audit.record(db, user.id, "login.failed", "", ip)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    limiter.reset(f"login:{ip}:{email}")
    audit.record(db, user.id, "login.ok", "", ip)
    return TokenOut(access_token=create_token(user.id))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user
