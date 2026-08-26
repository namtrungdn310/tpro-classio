from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import HTMLResponse, JSONResponse
from app.core.database import get_db
from app.services.pay2s_service import ingest_pay2s_collection_ipn, ingest_pay2s_webhook

router = APIRouter(tags=["payment-webhooks"])


@router.get("/pay2s/return", response_class=HTMLResponse)
async def show_pay2s_payment_return() -> HTMLResponse:
    """Public completion page; payment state is updated only by signed IPN.

    Pay2S requires an HTTPS redirect URL.  Local development exposes this
    static page through the same Cloudflare Tunnel as the webhook.  No query
    parameter is trusted and this endpoint never marks a fee as paid.
    """

    response = HTMLResponse(
        """<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>TPRO English · Thanh toán học phí</title>
  <style>
    :root { color-scheme: light; font-family: Arial, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center;
      background: #f5f7fb; color: #172033; }
    main { width: min(420px, calc(100% - 40px)); padding: 32px;
      border: 1px solid #dce2ec; border-radius: 16px; background: white;
      box-shadow: 0 10px 30px rgba(15, 35, 80, .08); text-align: center; }
    h1 { margin: 0 0 12px; font-size: 24px; }
    p { margin: 0; color: #5b667a; font-size: 16px; line-height: 1.55; }
  </style>
</head>
<body><main>
  <h1>Đã tiếp nhận giao dịch</h1>
  <p>TPRO English sẽ tự động ghi nhận sau khi ngân hàng và Pay2S xác nhận. Bạn có thể đóng trang này.</p>
</main></body>
</html>""",
        status_code=status.HTTP_200_OK,
    )
    response.headers.update(
        {
            "Cache-Control": "no-store",
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
        }
    )
    return response


@router.post("/pay2s")
async def receive_pay2s_webhook(request: Request) -> JSONResponse:
    # Pay2S Partner sends a per-webhook Bearer token. Keep the DB session local
    # and never return provider data in the acknowledgement.
    raw_body = await request.body()
    if len(raw_body) > 256 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Payload webhook vượt quá kích thước cho phép.",
        )
    async for db in get_db():
        await ingest_pay2s_webhook(
            db,
            raw_body=raw_body,
            authorization=request.headers.get("authorization"),
            signature=request.headers.get("x-pay2s-signature"),
            event_id_header=request.headers.get("x-pay2s-event-id"),
            merchant_id_header=request.headers.get("x-pay2s-merchant-id"),
        )
        # Pay2S documents a JSON acknowledgement with ``success: true``.
        # Keep the provider acknowledgement intentionally minimal. Internal
        # delivery ids remain in server-side telemetry and never become an
        # oracle for an attacker or a provider retry client.
        return JSONResponse({"success": True}, status_code=status.HTTP_200_OK)
    raise RuntimeError("database session was not created")


@router.post("/pay2s/ipn")
async def receive_pay2s_collection_ipn(request: Request) -> JSONResponse:
    """Receive the signed result of a Pay2S Collection Link payment.

    This is intentionally separate from ``/pay2s``: Collection Link does not
    send the Partner webhook ``transactions[]`` payload and authenticates via
    its HMAC rather than a per-webhook Bearer token.
    """
    raw_body = await request.body()
    if len(raw_body) > 64 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Payload IPN vượt quá kích thước cho phép.",
        )
    async for db in get_db():
        await ingest_pay2s_collection_ipn(db, raw_body=raw_body)
        return JSONResponse({"success": True}, status_code=status.HTTP_200_OK)
    raise RuntimeError("database session was not created")
