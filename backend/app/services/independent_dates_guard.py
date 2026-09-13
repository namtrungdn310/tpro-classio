"""Contract gate for the staged independent-date rollout."""

from fastapi import HTTPException

from app.core.config import settings


def require_date_contract(contract_version: int, *, has_date_edit: bool) -> None:
    if contract_version == 4:
        if not settings.independent_billing_dates_enabled:
            raise HTTPException(
                409,
                detail={
                    "code": "INDEPENDENT_DATES_NOT_ENABLED",
                    "message": "Tính năng tách ngày ghi danh và lịch thu chưa được bật trên môi trường này.",
                },
            )
    elif has_date_edit and settings.independent_billing_dates_enabled:
        raise HTTPException(
            409,
            detail={
                "code": "DATE_CONTRACT_UPGRADE_REQUIRED",
                "message": "Vui lòng tải lại ứng dụng trước khi sửa ngày ghi danh.",
            },
        )
