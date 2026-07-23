import re

DEFAULT_FEE_REMINDER_TEMPLATE = """TPRO English xin thông báo học phí {{ky_hoc_phi}} của em {{ten_hoc_vien}}:
{{chi_tiet_hoc_phi}}
Ngày đến hạn: {{ngay_den_han}}.
Tổng học phí cần thanh toán: {{tong_tien}}.
Phụ huynh vui lòng thanh toán giúp trung tâm. Cảm ơn phụ huynh."""

DEFAULT_FEE_RECEIPT_TEMPLATE = """TPRO English xác nhận đã nhận học phí {{ky_hoc_phi}} của em {{ten_hoc_vien}}:
{{chi_tiet_hoc_phi}}
Ngày đến hạn: {{ngay_den_han}}.
Tổng học phí đã nhận: {{tong_tien}}.
Cảm ơn phụ huynh."""

FEE_MESSAGE_COMMON_TOKENS = frozenset(
    {
        "chi_tiet_hoc_phi",
        "ky_hoc_phi",
        "ngay_den_han",
        "ten_hoc_vien",
        "tong_tien",
    }
)
FEE_MESSAGE_TOKEN_PATTERN = re.compile(r"{{([a-z_]+)}}")
MAX_FEE_MESSAGE_TEMPLATE_LENGTH = 1400
LEGACY_OVERDUE_TOKEN = "{{nhac_qua_han}}"
DUE_DATE_TOKEN = "{{ngay_den_han}}"
CLASS_AMOUNT_TOKEN = "{{chi_tiet_hoc_phi}}"


def normalize_fee_message_template(value: str) -> str:
    normalized = value.replace("\r\n", "\n").replace("\r", "\n").strip()
    if any(
        ord(character) < 32 and character not in {"\n", "\t"}
        for character in normalized
    ):
        raise ValueError("Mẫu tin nhắn chứa ký tự điều khiển không hợp lệ")
    return normalized


def normalize_fee_notification_message(value: str) -> str:
    normalized = value.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        raise ValueError("Nội dung thông báo không được để trống")
    if any(
        ord(character) < 32 and character not in {"\n", "\t"}
        for character in normalized
    ):
        raise ValueError("Nội dung thông báo chứa ký tự điều khiển không hợp lệ")
    return normalized


def upgrade_legacy_fee_message_template(
    value: str,
    *,
    allow_legacy_overdue_token: bool,
) -> str:
    upgraded = (
        value.replace(LEGACY_OVERDUE_TOKEN, "") if allow_legacy_overdue_token else value
    )
    if DUE_DATE_TOKEN not in upgraded and CLASS_AMOUNT_TOKEN in upgraded:
        upgraded = upgraded.replace(
            CLASS_AMOUNT_TOKEN,
            f"{CLASS_AMOUNT_TOKEN}\nNgày đến hạn: {DUE_DATE_TOKEN}.",
            1,
        )
    return upgraded


def validate_fee_message_template(
    value: str,
    *,
    allow_legacy_overdue_token: bool,
) -> str:
    normalized = upgrade_legacy_fee_message_template(
        normalize_fee_message_template(value),
        allow_legacy_overdue_token=allow_legacy_overdue_token,
    )
    if not 20 <= len(normalized) <= MAX_FEE_MESSAGE_TEMPLATE_LENGTH:
        raise ValueError("Mẫu tin nhắn phải có từ 20 đến 1400 ký tự")
    tokens = set(FEE_MESSAGE_TOKEN_PATTERN.findall(normalized))
    allowed_tokens = set(FEE_MESSAGE_COMMON_TOKENS)

    unknown_tokens = sorted(tokens - allowed_tokens)
    if unknown_tokens or _has_malformed_token(normalized):
        raise ValueError("Mẫu tin nhắn chứa biến không được hệ thống hỗ trợ")

    missing_tokens = sorted(FEE_MESSAGE_COMMON_TOKENS - tokens)
    if missing_tokens:
        raise ValueError(
            "Mẫu tin nhắn phải giữ đủ thông tin học viên, kỳ học phí, "
            "tên lớp, số tiền, ngày đến hạn và tổng tiền"
        )
    return normalized


def _has_malformed_token(value: str) -> bool:
    without_valid_tokens = FEE_MESSAGE_TOKEN_PATTERN.sub("", value)
    return "{" in without_valid_tokens or "}" in without_valid_tokens
