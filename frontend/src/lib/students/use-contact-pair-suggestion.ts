import { useEffect, useState } from "react";
import { lookupContactSuggestion } from "@/lib/api/students";

export type ContactOwner = "student" | "parent";
export type ContactPairSuggestion = {
  target: "zalo" | "phone";
  value: string;
};

type ContactSuggestionQuery =
  | { target: "zalo"; phone: string; zaloName?: never }
  | { target: "phone"; phone?: never; zaloName: string };

export function getContactSuggestionQuery(
  zaloValue: string | null | undefined,
  phoneValue: string | null | undefined,
): ContactSuggestionQuery | null {
  const zaloName = zaloValue?.trim() ?? "";
  const rawPhone = phoneValue?.trim() ?? "";
  const phone = normalizeVietnamPhone(rawPhone);

  if (!zaloName && isValidVietnamMobilePhone(phone)) {
    return { target: "zalo", phone };
  }
  if (zaloName && !rawPhone) {
    return { target: "phone", zaloName };
  }
  return null;
}

export function useContactPairSuggestion({
  enabled = true,
  owner,
  phoneValue,
  zaloValue,
}: {
  enabled?: boolean;
  owner: ContactOwner;
  phoneValue: string | null | undefined;
  zaloValue: string | null | undefined;
}) {
  const [suggestion, setSuggestion] = useState<ContactPairSuggestion | null>(null);

  useEffect(() => {
    const query = enabled ? getContactSuggestionQuery(zaloValue, phoneValue) : null;
    setSuggestion(null);
    if (!query) {
      return;
    }

    let isCurrent = true;
    const timeoutId = window.setTimeout(async () => {
      try {
        const contact = await lookupContactSuggestion({
          owner,
          phone: query.phone,
          zaloName: query.zaloName,
        });
        if (!isCurrent || !contact) {
          return;
        }

        const value = query.target === "zalo" ? contact.zalo_name.trim() : contact.phone.trim();
        setSuggestion(value ? { target: query.target, value } : null);
      } catch {
        // Suggestions are optional assistance; network errors must not interrupt editing.
      }
    }, 350);

    return () => {
      isCurrent = false;
      window.clearTimeout(timeoutId);
    };
  }, [enabled, owner, phoneValue, zaloValue]);

  // Hide immediately in render when privacy is toggled; do not wait for the
  // effect cleanup that cancels an in-flight request.
  return enabled ? suggestion : null;
}

function normalizeVietnamPhone(value: string) {
  const digitsOnly = value.replace(/\D/g, "");
  if (digitsOnly.startsWith("84")) {
    return `0${digitsOnly.slice(2)}`;
  }
  return digitsOnly;
}

function isValidVietnamMobilePhone(value: string) {
  return /^0(?:3|5|7|8|9)\d{8}$/.test(value);
}
