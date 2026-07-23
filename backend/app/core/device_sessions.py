import base64
import hashlib
import json
import re
from dataclasses import dataclass
from typing import Mapping

from fastapi import HTTPException, Request, status

DEVICE_TYPE_DESKTOP = "desktop"
DEVICE_TYPE_MOBILE = "mobile"
DEVICE_ID_HEADER = "x-tpro-device-id"
DEVICE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{16,128}$")


@dataclass(frozen=True)
class DeviceSessionContext:
    device_type: str
    session_nonce: str


def classify_device_type(headers: Mapping[str, str]) -> str:
    sec_ch_mobile = headers.get("sec-ch-ua-mobile", "").strip().lower()
    if sec_ch_mobile in {"?1", "1", "true"}:
        return DEVICE_TYPE_MOBILE

    user_agent = headers.get("user-agent", "").lower()
    mobile_markers = (
        "android",
        "iphone",
        "ipad",
        "ipod",
        "mobile",
        "tablet",
        "windows phone",
    )
    return (
        DEVICE_TYPE_MOBILE
        if any(marker in user_agent for marker in mobile_markers)
        else DEVICE_TYPE_DESKTOP
    )


def read_device_id(request: Request) -> str:
    device_id = request.headers.get(DEVICE_ID_HEADER, "").strip()
    if not DEVICE_ID_PATTERN.fullmatch(device_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Không nhận diện được thiết bị đăng nhập",
        )
    return device_id


def hash_device_value(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def read_request_user_agent(request: Request) -> str:
    return request.headers.get("user-agent", "").strip()


def read_supabase_session_id(access_token: str) -> str | None:
    try:
        payload_part = access_token.split(".")[1]
        normalized_payload = payload_part.replace("-", "+").replace("_", "/")
        padded_payload = normalized_payload + "=" * (-len(normalized_payload) % 4)
        payload = json.loads(base64.b64decode(padded_payload).decode("utf-8"))
    except (IndexError, ValueError, json.JSONDecodeError):
        return None

    session_id = payload.get("session_id")
    return session_id if isinstance(session_id, str) and session_id else None
