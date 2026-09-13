"""Private, validated storage for manually supplied receiving-account QR images."""

import hashlib
import io
import logging
from uuid import uuid4

import httpx
from fastapi import HTTPException, UploadFile, status
from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import settings

logger = logging.getLogger("tpro_classio.banking_qr_storage")

_ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
_ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
_MAX_PIXELS = 16_000_000


async def _normalise_qr_image(upload: UploadFile) -> bytes:
    """Validate image bytes and emit a bounded, lossless WebP QR image."""
    if upload.content_type not in _ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Ảnh QR phải là PNG, JPG hoặc WebP.",
        )

    chunks: list[bytes] = []
    total = 0
    try:
        while chunk := await upload.read(64 * 1024):
            total += len(chunk)
            if total > settings.banking_qr_max_bytes:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail="Ảnh QR vượt quá dung lượng 2 MB.",
                )
            chunks.append(chunk)
    finally:
        await upload.close()

    raw_bytes = b"".join(chunks)
    if not raw_bytes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Chưa nhận được ảnh QR.",
        )

    try:
        with Image.open(io.BytesIO(raw_bytes)) as probe:
            if probe.format not in _ALLOWED_FORMATS:
                raise ValueError("unexpected image format")
            width, height = probe.size
            if width <= 0 or height <= 0 or width * height > _MAX_PIXELS:
                raise ValueError("invalid image dimensions")
            probe.verify()

        with Image.open(io.BytesIO(raw_bytes)) as source:
            image = ImageOps.exif_transpose(source)
            if image.mode in {"RGBA", "LA"} or (
                image.mode == "P" and "transparency" in image.info
            ):
                rgba = image.convert("RGBA")
                background = Image.new("RGB", rgba.size, "white")
                background.paste(rgba, mask=rgba.getchannel("A"))
                image = background
            else:
                image = image.convert("RGB")
            image.thumbnail(
                (settings.banking_qr_max_dimension, settings.banking_qr_max_dimension),
                Image.Resampling.LANCZOS,
            )
            output = io.BytesIO()
            # QR codes contain hard edges. Lossless output prevents compression
            # artifacts from making a valid code harder to scan.
            image.save(output, format="WEBP", lossless=True, method=6)
            webp_bytes = output.getvalue()
    except HTTPException:
        raise
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
    ) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tệp đã chọn không phải là ảnh QR hợp lệ.",
        ) from exc

    if not webp_bytes or len(webp_bytes) > settings.banking_qr_max_bytes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Không thể tối ưu ảnh QR trong giới hạn 2 MB.",
        )
    return webp_bytes


def _storage_headers(*, content_type: str | None = None) -> dict[str, str]:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Kho ảnh QR riêng tư chưa được cấu hình.",
        )
    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    if content_type:
        headers["Content-Type"] = content_type
    return headers


async def store_bank_qr_image(
    upload: UploadFile,
    *,
    workspace_id: str,
    account_id: str,
) -> str:
    """Store a normalised QR beneath its workspace/account ownership path."""
    webp_bytes = await _normalise_qr_image(upload)
    object_path = (
        f"workspaces/{workspace_id}/payment-accounts/{account_id}/{uuid4().hex}.webp"
    )
    upload_url = (
        f"{settings.supabase_url.rstrip('/')}/storage/v1/object/"
        f"{settings.banking_qr_storage_bucket}/{object_path}"
    )
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.put(
                upload_url,
                content=webp_bytes,
                headers={
                    **_storage_headers(content_type="image/webp"),
                    "x-upsert": "false",
                    "Cache-Control": "private, max-age=3600",
                },
            )
    except httpx.HTTPError as exc:
        logger.warning("Private banking QR upload failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Không thể tải ảnh QR lên. Hãy thử lại.",
        ) from exc
    if response.status_code not in (200, 201):
        logger.warning(
            "Private banking QR upload failed with status %s", response.status_code
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Không thể tải ảnh QR lên. Hãy thử lại.",
        )
    return object_path


async def get_bank_qr_image(object_path: str) -> tuple[bytes, str]:
    """Fetch one private WebP object after the caller has passed workspace ACL."""
    storage_url = (
        f"{settings.supabase_url.rstrip('/')}/storage/v1/object/authenticated/"
        f"{settings.banking_qr_storage_bucket}/{object_path}"
    )
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(storage_url, headers=_storage_headers())
    except httpx.HTTPError as exc:
        logger.warning("Private banking QR read failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Không thể tải ảnh QR.",
        ) from exc
    if response.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ảnh QR không tồn tại.",
        )
    return response.content, hashlib.sha256(response.content).hexdigest()
