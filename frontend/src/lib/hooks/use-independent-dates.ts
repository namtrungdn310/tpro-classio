"use client";

import { useQuery } from "@tanstack/react-query";
import { getDateCapabilities } from "@/lib/api/billing-dates";

export function useIndependentDates(enabled = true) {
  return useQuery({
    queryKey: ["date-capabilities"],
    queryFn: ({ signal }) => getDateCapabilities(signal),
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: { independent_billing_dates: true },
    retry: false,
  });
}
