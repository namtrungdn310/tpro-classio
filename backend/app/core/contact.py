def validate_complete_contact_pair(
    *,
    zalo_name: str | None,
    phone: str | None,
    owner: str,
) -> None:
    has_zalo = bool(zalo_name and zalo_name.strip())
    has_phone = bool(phone and phone.strip())
    if has_zalo and not has_phone:
        raise ValueError(f"Vui lòng nhập số điện thoại {owner}.")
    if has_phone and not has_zalo:
        raise ValueError(f"Vui lòng nhập tên Zalo {owner}.")
