import { apiClient } from "@/lib/api/client";
import { contactSuggestionResponseSchema } from "@/lib/schemas/contact-suggestion";
import type { ContactSuggestionResponse } from "@/lib/types";

export type ContactSuggestionOwner = "student" | "parent" | "staff";

export async function lookupContactSuggestion({
  owner,
  phone,
  zaloName,
}: {
  owner: ContactSuggestionOwner;
  phone?: string;
  zaloName?: string;
}): Promise<ContactSuggestionResponse | null> {
  const { data } = await apiClient.post<unknown>("/contact-suggestions/lookup", {
    owner,
    phone,
    zalo_name: zaloName,
  });
  return contactSuggestionResponseSchema.parse(data);
}
