"""Encryption and keyed hashing for server-side authentication credentials.

The application signing key and credential-encryption key intentionally have
different duties.  AUTH_ENCRYPTION_KEY must be an independent production
secret and is never returned to clients or written to logs.
"""

import base64
import hashlib
import hmac

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from fastapi import HTTPException, status

from app.core.config import settings


def ensure_auth_encryption_configured() -> None:
    if len(settings.auth_encryption_key) < 32:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Máy chủ chưa cấu hình khóa mã hóa luồng xác thực.",
        )


def _purpose_key(purpose: str) -> bytes:
    ensure_auth_encryption_configured()
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"tpro-classio-auth-credentials-v1",
        info=purpose.encode("utf-8"),
    ).derive(settings.auth_encryption_key.encode("utf-8"))


def encrypt_credential(value: str, *, purpose: str) -> str:
    key = base64.urlsafe_b64encode(_purpose_key(purpose))
    return Fernet(key).encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_credential(value: str, *, purpose: str) -> str:
    key = base64.urlsafe_b64encode(_purpose_key(purpose))
    try:
        return Fernet(key).decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Không thể đọc thông tin xác thực đã mã hóa.",
        ) from exc


def keyed_secret_hash(value: str, *, purpose: str) -> str:
    return hmac.new(
        _purpose_key(purpose), value.encode("utf-8"), hashlib.sha256
    ).hexdigest()
