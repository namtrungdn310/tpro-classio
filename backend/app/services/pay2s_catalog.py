"""The Pay2S payment-bank capability catalog.

This is deliberately *not* the much larger VietQR directory.  A bank can
produce a VietQR code yet still be unavailable to Pay2S Collection Link or
Partner reconciliation.  Keep only banks explicitly published by Pay2S as
payment-capable here, and refresh this snapshot only after a provider-contract
verification run.
"""

from __future__ import annotations

from dataclasses import dataclass
import unicodedata


@dataclass(frozen=True)
class Pay2SPaymentBank:
    code: str
    short_name: str
    name: str


# Official Pay2S bank-code page, verified 2026-08-21.  This snapshot is an
# allow-list: an unknown code must never enter the Pay2S flow just because it
# is accepted by VietQR or by a browser-supplied form value.
PAY2S_PAYMENT_BANKS: tuple[Pay2SPaymentBank, ...] = (
    Pay2SPaymentBank("VCB", "Vietcombank", "Ngân hàng TMCP Ngoại thương Việt Nam"),
    Pay2SPaymentBank("CTG", "VietinBank", "Ngân hàng TMCP Công thương Việt Nam"),
    Pay2SPaymentBank("TCB", "Techcombank", "Ngân hàng TMCP Kỹ thương Việt Nam"),
    Pay2SPaymentBank("BIDV", "BIDV", "Ngân hàng TMCP Đầu tư và Phát triển Việt Nam"),
    Pay2SPaymentBank("ACB", "ACB", "Ngân hàng TMCP Á Châu"),
    Pay2SPaymentBank("MBB", "MB", "Ngân hàng TMCP Quân đội"),
    Pay2SPaymentBank("TPB", "TPBank", "Ngân hàng TMCP Tiên Phong"),
)

_BANK_BY_CODE = {bank.code: bank for bank in PAY2S_PAYMENT_BANKS}

_REMOTE_BANK_ALIASES: dict[str, tuple[str, ...]] = {
    "VCB": ("vietcombank", "ngoai thuong"),
    "CTG": ("vietinbank", "cong thuong"),
    "TCB": ("techcombank", "ky thuong"),
    "BIDV": ("bidv", "dau tu va phat trien"),
    "ACB": ("acb", "a chau"),
    "MBB": ("mbbank", "mb bank", "quan doi"),
    "TPB": ("tpbank", "tien phong"),
}


def _normalized_bank_name(value: str | None) -> str:
    if not value:
        return ""
    decomposed = unicodedata.normalize("NFKD", value)
    return " ".join(
        "".join(
            character
            for character in decomposed
            if not unicodedata.combining(character)
        )
        .lower()
        .split()
    )


def get_pay2s_payment_bank(code: str | None) -> Pay2SPaymentBank | None:
    return _BANK_BY_CODE.get((code or "").strip().upper())


def resolve_pay2s_payment_bank(
    code: str | None, bank_name: str | None
) -> Pay2SPaymentBank | None:
    """Resolve Pay2S rows whose bank-list response omits ``shortBankName``."""

    direct = get_pay2s_payment_bank(code)
    if direct is not None:
        return direct
    normalized_name = _normalized_bank_name(bank_name)
    for bank_code, aliases in _REMOTE_BANK_ALIASES.items():
        if any(alias in normalized_name for alias in aliases):
            return _BANK_BY_CODE[bank_code]
    return None


def is_pay2s_payment_bank(code: str | None) -> bool:
    return get_pay2s_payment_bank(code) is not None
