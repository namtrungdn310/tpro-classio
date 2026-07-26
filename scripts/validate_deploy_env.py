"""Fail-closed validation for immutable staging/production Compose inputs."""

from __future__ import annotations

import os
import re
import sys
from urllib.parse import urlparse

IMAGE_PATTERN = re.compile(
    r"^(?P<registry>[a-z0-9.-]+(?::[0-9]+)?)/"
    r"[a-z0-9._/-]+@sha256:(?P<digest>[0-9a-f]{64})$"
)


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ValueError(f"{name} is required")
    return value


def _validate_image(name: str, allowlist: set[str]) -> None:
    value = _required(name)
    match = IMAGE_PATTERN.fullmatch(value)
    if match is None or match.group("digest") == "0" * 64:
        raise ValueError(
            f"{name} must be an immutable registry image pinned by a real "
            "@sha256:<64 lowercase hex> digest"
        )
    if match.group("registry") not in allowlist:
        raise ValueError(
            f"{name} registry is not allowlisted: {match.group('registry')}"
        )


def _validate_origin(name: str, *, https_only: bool) -> None:
    value = _required(name)
    parsed = urlparse(value)
    allowed_schemes = {"https"} if https_only else {"http", "https"}
    if (
        parsed.scheme not in allowed_schemes
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.params
        or parsed.query
        or parsed.fragment
    ):
        scheme_hint = "HTTPS" if https_only else "HTTP(S)"
        raise ValueError(f"{name} must be a credential-free {scheme_hint} origin")


def validate() -> None:
    allowlist = {
        item.strip().lower()
        for item in os.environ.get(
            "TPRO_IMAGE_REGISTRY_ALLOWLIST", "ghcr.io,docker.io"
        ).split(",")
        if item.strip()
    }
    if not allowlist:
        raise ValueError("TPRO_IMAGE_REGISTRY_ALLOWLIST must not be empty")

    _validate_image("BACKEND_IMAGE", allowlist)
    _validate_image("FRONTEND_IMAGE", allowlist)
    _validate_origin("APP_ORIGIN", https_only=True)
    _validate_origin("NEXT_INTERNAL_API_URL", https_only=False)

    if _required("AUTH_COOKIE_SECURE").lower() != "true":
        raise ValueError("AUTH_COOKIE_SECURE must be exactly true")


def main() -> int:
    try:
        validate()
    except ValueError as exc:
        print(f"Deploy preflight failed: {exc}", file=sys.stderr)
        return 2
    print("Deploy environment preflight passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
