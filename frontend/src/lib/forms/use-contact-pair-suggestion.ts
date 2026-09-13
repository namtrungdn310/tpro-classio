import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  lookupContactSuggestion,
  type ContactSuggestionOwner,
} from "@/lib/api/contact-suggestions";

export type ContactPairSuggestion = {
  target: "zalo" | "phone";
  value: string;
};

export type ContactSuggestionSource = {
  owner: ContactSuggestionOwner;
  phone: string | null | undefined;
  zaloName: string | null | undefined;
};

export function handleContactSuggestionTab(
  event: ReactKeyboardEvent<HTMLElement>,
  suggestion: ContactPairSuggestion | null | undefined,
  onAccept: () => void,
) {
  if (event.key !== "Tab" || event.shiftKey || !suggestion) {
    return false;
  }

  const container = event.currentTarget;
  event.preventDefault();
  onAccept();

  window.requestAnimationFrame(() => {
    const targetInput = container.querySelector<HTMLInputElement>(
      `input[data-contact-part="${suggestion.target}"]`,
    );
    if (!targetInput || targetInput.disabled) {
      return;
    }

    targetInput.focus({ preventScroll: true });
    const cursorPosition = targetInput.value.length;
    targetInput.setSelectionRange(cursorPosition, cursorPosition);
  });

  return true;
}

type ContactSuggestionQuery =
  | { target: "zalo"; phone: string; zaloName?: never }
  | { target: "phone"; phone?: never; zaloName: string };

type RemoteSuggestionState = {
  key: string;
  sources: ContactSuggestionSource[] | null;
  suggestion: ContactPairSuggestion | null;
};

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
  localSources = [],
  owner,
  phoneValue,
  zaloValue,
}: {
  enabled?: boolean;
  localSources?: ContactSuggestionSource[];
  owner: ContactSuggestionOwner;
  phoneValue: string | null | undefined;
  zaloValue: string | null | undefined;
}) {
  const query = useMemo(
    () => (enabled ? getContactSuggestionQuery(zaloValue, phoneValue) : null),
    [enabled, phoneValue, zaloValue],
  );
  const queryKey = query
    ? `${owner}\u0000${query.target}\u0000${query.phone ?? query.zaloName}`
    : "";
  const localSuggestion = useMemo(
    () => (query ? lookupLocalContactSuggestion(localSources, owner, query) : null),
    [localSources, owner, query],
  );
  const [remoteState, setRemoteState] = useState<RemoteSuggestionState>({
    key: "",
    sources: null,
    suggestion: null,
  });

  useEffect(() => {
    if (!query || localSuggestion) {
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
        if (!isCurrent) {
          return;
        }

        const value =
          query.target === "zalo"
            ? contact?.zalo_name.trim() ?? ""
            : contact?.phone.trim() ?? "";
        setRemoteState({
          key: queryKey,
          sources: localSources,
          suggestion: value ? { target: query.target, value } : null,
        });
      } catch {
        // Suggestions are optional assistance; network errors must not interrupt editing.
        if (isCurrent) {
          setRemoteState({
            key: queryKey,
            sources: localSources,
            suggestion: null,
          });
        }
      }
    }, 120);

    return () => {
      isCurrent = false;
      window.clearTimeout(timeoutId);
    };
  }, [localSources, localSuggestion, owner, query, queryKey]);

  if (!enabled || !query) {
    return null;
  }
  return (
    localSuggestion ??
    (remoteState.key === queryKey && remoteState.sources === localSources
      ? remoteState.suggestion
      : null)
  );
}

export function lookupLocalContactSuggestion(
  sources: ContactSuggestionSource[],
  owner: ContactSuggestionOwner,
  query: ContactSuggestionQuery,
): ContactPairSuggestion | null {
  const matches = sources
    .filter((source) => source.owner === owner)
    .map((source) => {
      const phone = source.phone?.trim();
      const zaloName = source.zaloName?.trim();
      if (!phone || !zaloName) {
        return null;
      }

      if (query.target === "zalo") {
        return normalizeVietnamPhone(phone) === query.phone
          ? { phone, zaloName }
          : null;
      }

      return zaloName.toLocaleLowerCase("vi-VN") ===
        query.zaloName.trim().toLocaleLowerCase("vi-VN")
        ? { phone, zaloName }
        : null;
    })
    .filter((contact): contact is { phone: string; zaloName: string } =>
      Boolean(contact),
    );
  const uniqueSuggestions = new Map(
    matches.map((contact) => [
      `${normalizeVietnamPhone(contact.phone)}\u0000${contact.zaloName.toLocaleLowerCase("vi-VN")}`,
      contact,
    ]),
  );
  if (uniqueSuggestions.size !== 1) {
    return null;
  }

  const contact = [...uniqueSuggestions.values()][0];
  return {
    target: query.target,
    value: query.target === "zalo" ? contact.zaloName : contact.phone,
  };
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
