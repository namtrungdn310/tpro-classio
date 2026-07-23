from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

import jwt
from fastapi import HTTPException, status
from jwt import InvalidTokenError

from app.core.config import settings


def create_access_token(
    data: dict[str, Any], expires_delta: timedelta | None = None
) -> str:
    expires_at = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    )
    payload = data.copy()
    payload.update(
        {
            "iss": settings.internal_token_issuer,
            "aud": settings.internal_token_audience,
            "iat": datetime.now(timezone.utc),
            "exp": expires_at,
            "jti": str(uuid4()),
        }
    )
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def verify_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(
            token,
            settings.secret_key,
            algorithms=[settings.algorithm],
            audience=settings.internal_token_audience,
            issuer=settings.internal_token_issuer,
            options={"require": ["sub", "iss", "aud", "iat", "exp", "jti"]},
        )
    except InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Phiên đăng nhập không hợp lệ hoặc đã hết hạn",
            headers={"WWW-Authenticate": "Bearer"},
        ) from None
