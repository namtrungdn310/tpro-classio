from typing import Annotated
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import Response
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import Principal, require_management
from app.schemas.banking import (
    BankAccountCreate,
    BankAccountListResponse,
    BankAccountResponse,
    BankAccountUpdate,
    BankingOverviewResponse,
    Pay2SConnectionUpsert,
    Pay2SProviderStatusResponse,
    Pay2SBankConnectRequest,
    Pay2SBankConnectResponse,
    Pay2SBankOtpRequest,
    Pay2SSupportedBanksResponse,
    Pay2SWebhookResponse,
)
from app.services.banking_service import (
    archive_bank_account,
    create_bank_account,
    get_banking_overview,
    get_pay2s_status,
    get_pay2s_supported_banks,
    list_bank_accounts,
    update_bank_account,
    upsert_pay2s_connection,
    verify_pay2s_connection,
    connect_pay2s_bank,
    confirm_pay2s_bank_otp,
    create_pay2s_webhook,
)
from app.services.banking_qr_storage_service import get_bank_qr_image
from app.models.banking import WorkspacePaymentAccount
from sqlalchemy import select

router = APIRouter(tags=["banking"])


@router.get("/overview", response_model=BankingOverviewResponse)
async def get_banking_overview_route(
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> BankingOverviewResponse:
    return await get_banking_overview(db)


@router.get("/accounts", response_model=BankAccountListResponse)
async def list_bank_accounts_route(
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> BankAccountListResponse:
    return await list_bank_accounts(db)


@router.post(
    "/accounts", response_model=BankAccountResponse, status_code=status.HTTP_201_CREATED
)
async def create_bank_account_route(
    payload: BankAccountCreate,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> BankAccountResponse:
    response = await create_bank_account(db, payload, actor_id=principal.user_id)
    await db.commit()
    return response


@router.post(
    "/accounts/manual",
    response_model=BankAccountResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_manual_bank_account_route(
    payload_json: Annotated[str, Form()],
    qr_image: Annotated[UploadFile | None, File()] = None,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> BankAccountResponse:
    """Create a manual account and optionally persist its QR in private Storage."""
    try:
        payload = BankAccountCreate.model_validate_json(payload_json)
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Dữ liệu tài khoản ngân hàng không hợp lệ.",
        ) from exc
    if payload.provider_account_id or payload.provider_bank_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tài khoản Pay2S không dùng ảnh QR gốc thủ công.",
        )
    response = await create_bank_account(
        db,
        payload,
        actor_id=principal.user_id,
        qr_image=qr_image,
        workspace_id=principal.workspace_id,
    )
    await db.commit()
    return response


@router.get("/accounts/{account_id}/qr")
async def get_bank_account_qr_route(
    account_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> Response:
    account = await db.scalar(
        select(WorkspacePaymentAccount).where(
            WorkspacePaymentAccount.id == str(account_id),
            WorkspacePaymentAccount.is_active.is_(True),
        )
    )
    if account is None or not account.qr_object_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Ảnh QR không tồn tại."
        )
    image_bytes, version = await get_bank_qr_image(account.qr_object_path)
    etag = f'"{version}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED)
    return Response(
        content=image_bytes,
        media_type="image/webp",
        headers={"ETag": etag, "Cache-Control": "private, max-age=3600"},
    )


@router.patch("/accounts/{account_id}", response_model=BankAccountResponse)
async def update_bank_account_route(
    account_id: UUID,
    payload: BankAccountUpdate,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> BankAccountResponse:
    response = await update_bank_account(
        db, account_id, payload, actor_id=principal.user_id
    )
    if response is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy tài khoản ngân hàng",
        )
    await db.commit()
    return response


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_bank_account_route(
    account_id: UUID,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> None:
    found = await archive_bank_account(db, account_id, actor_id=principal.user_id)
    if not found:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy tài khoản ngân hàng",
        )
    await db.commit()


@router.get("/providers/pay2s", response_model=Pay2SProviderStatusResponse)
async def get_pay2s_status_route(
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> Pay2SProviderStatusResponse:
    return await get_pay2s_status(db)


@router.get(
    "/providers/pay2s/supported-banks",
    response_model=Pay2SSupportedBanksResponse,
)
async def get_pay2s_supported_banks_route(
    principal: Principal = Depends(require_management),
) -> Pay2SSupportedBanksResponse:
    """Safe, curated catalog for the Pay2S-only picker."""
    return await get_pay2s_supported_banks()


@router.put("/providers/pay2s", response_model=Pay2SProviderStatusResponse)
async def upsert_pay2s_connection_route(
    payload: Pay2SConnectionUpsert,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> Pay2SProviderStatusResponse:
    response = await upsert_pay2s_connection(db, payload, actor_id=principal.user_id)
    await db.commit()
    return response


@router.post("/providers/pay2s/verify", response_model=Pay2SProviderStatusResponse)
async def verify_pay2s_connection_route(
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> Pay2SProviderStatusResponse:
    response = await verify_pay2s_connection(db, actor_id=principal.user_id)
    await db.commit()
    return response


@router.post("/providers/pay2s/banks", response_model=Pay2SBankConnectResponse)
async def connect_pay2s_bank_route(
    payload: Pay2SBankConnectRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> Pay2SBankConnectResponse:
    response = await connect_pay2s_bank(db, payload, actor_id=principal.user_id)
    await db.commit()
    return response


@router.post(
    "/providers/pay2s/banks/confirm-otp", response_model=Pay2SBankConnectResponse
)
async def confirm_pay2s_bank_otp_route(
    payload: Pay2SBankOtpRequest,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> Pay2SBankConnectResponse:
    response = await confirm_pay2s_bank_otp(db, payload, actor_id=principal.user_id)
    await db.commit()
    return response


@router.post(
    "/providers/pay2s/accounts/{account_id}/webhook",
    response_model=Pay2SWebhookResponse,
)
async def create_pay2s_webhook_route(
    account_id: UUID,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(require_management),
) -> Pay2SWebhookResponse:
    response = await create_pay2s_webhook(
        db, str(account_id), actor_id=principal.user_id
    )
    await db.commit()
    return response
