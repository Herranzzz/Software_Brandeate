from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status

from app.models import User


TOKEN_TTL_HOURS = 2          # access token: 2 horas
REFRESH_TOKEN_TTL_DAYS = 30  # refresh token: 30 días


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000)
    return f"{salt}${digest.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        salt, expected_hash = password_hash.split("$", 1)
    except ValueError:
        return False

    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000)
    return hmac.compare_digest(digest.hex(), expected_hash)


def create_access_token(user: User, secret: str) -> str:
    payload = {
        "sub": user.id,
        "role": user.role.value,
        "type": "access",
        "exp": int((datetime.now(timezone.utc) + timedelta(hours=TOKEN_TTL_HOURS)).timestamp()),
    }
    return _sign_payload(payload, secret)


def create_refresh_token(user: User, secret: str) -> str:
    """Crea un refresh token de larga duración (30 días)."""
    payload = {
        "sub": user.id,
        "type": "refresh",
        "jti": secrets.token_hex(16),  # ID único para permitir revocación futura
        "exp": int((datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_TTL_DAYS)).timestamp()),
    }
    return _sign_payload(payload, secret)


def decode_access_token(token: str, secret: str) -> dict:
    payload = _decode_and_verify(token, secret)
    if payload.get("type") != "access":
        raise _auth_error("Not an access token")
    return payload


def decode_refresh_token(token: str, secret: str) -> dict:
    payload = _decode_and_verify(token, secret)
    if payload.get("type") != "refresh":
        raise _auth_error("Not a refresh token")
    return payload


def _sign_payload(payload: dict, secret: str) -> str:
    encoded_payload = _b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(secret.encode("utf-8"), encoded_payload.encode("utf-8"), hashlib.sha256).digest()
    return f"{encoded_payload}.{_b64encode(signature)}"


def _decode_and_verify(token: str, secret: str) -> dict:
    try:
        encoded_payload, encoded_signature = token.split(".", 1)
    except ValueError as exc:
        raise _auth_error() from exc

    expected_signature = hmac.new(secret.encode("utf-8"), encoded_payload.encode("utf-8"), hashlib.sha256).digest()
    if not hmac.compare_digest(_b64decode(encoded_signature), expected_signature):
        raise _auth_error()

    try:
        payload = json.loads(_b64decode(encoded_payload).decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise _auth_error() from exc

    if payload.get("exp", 0) < int(datetime.now(timezone.utc).timestamp()):
        raise _auth_error("Token expired")

    return payload


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("utf-8")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _auth_error(detail: str = "Invalid authentication token") -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)
