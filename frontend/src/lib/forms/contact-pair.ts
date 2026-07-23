export type ContactPairOwner = "học viên" | "phụ huynh" | "nhân sự";

export type ContactPairError = {
  missingField: "zalo" | "phone";
  message: string;
};

export type CompleteContactPair = {
  zalo: string;
  phone: string;
};

function normalizeContactValue(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function getContactPairError(
  zalo: string | null | undefined,
  phone: string | null | undefined,
  owner: ContactPairOwner,
): ContactPairError | null {
  const normalizedZalo = normalizeContactValue(zalo);
  const normalizedPhone = normalizeContactValue(phone);

  if (normalizedZalo && !normalizedPhone) {
    return {
      missingField: "phone",
      message: `Vui lòng nhập số điện thoại ${owner}.`,
    };
  }

  if (normalizedPhone && !normalizedZalo) {
    return {
      missingField: "zalo",
      message: `Vui lòng nhập tên Zalo ${owner}.`,
    };
  }

  return null;
}

export function getCompleteContactPair(
  zalo: string | null | undefined,
  phone: string | null | undefined,
): CompleteContactPair | null {
  const normalizedZalo = normalizeContactValue(zalo);
  const normalizedPhone = normalizeContactValue(phone);

  return normalizedZalo && normalizedPhone
    ? { zalo: normalizedZalo, phone: normalizedPhone }
    : null;
}
