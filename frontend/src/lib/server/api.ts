import { QueryClient } from "@tanstack/react-query";
import type { ClassResponse, DashboardOverviewResponse } from "@/lib/types";
import { dashboardOverviewSchema } from "@/lib/schemas/dashboard";
import { classResponseListSchema } from "@/lib/schemas/class";
import { getBackendBaseUrl } from "@/lib/server/backend";

async function fetchServerJson<T>(
  path: string,
  options: {
    accessToken: string;
    deviceId: string;
    secChUaMobile?: string | null;
    userAgent?: string | null;
  },
): Promise<T> {
  const response = await fetch(`${getBackendBaseUrl()}${path}`, {
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      "X-TPRO-Device-Id": options.deviceId,
      ...(options.userAgent ? { "User-Agent": options.userAgent } : {}),
      ...(options.secChUaMobile ? { "sec-ch-ua-mobile": options.secChUaMobile } : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`Server fetch failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function prefetchDashboardQueries(
  queryClient: QueryClient,
  options: {
    accessToken: string | null;
    deviceId: string | null;
    secChUaMobile?: string | null;
    userAgent?: string | null;
  },
) {
  if (!options.accessToken || !options.deviceId) {
    return;
  }

  await Promise.allSettled([
    queryClient.prefetchQuery({
      queryKey: ["dashboard", "overview"],
      queryFn: () =>
        fetchServerJson<DashboardOverviewResponse>("/dashboard/overview", {
          accessToken: options.accessToken as string,
          deviceId: options.deviceId as string,
          secChUaMobile: options.secChUaMobile,
          userAgent: options.userAgent,
        }).then((data) => dashboardOverviewSchema.parse(data)),
    }),
    queryClient.prefetchQuery({
      queryKey: ["classes", { is_active: true }],
      queryFn: () =>
        fetchServerJson<ClassResponse[]>("/classes?is_active=true", {
          accessToken: options.accessToken as string,
          deviceId: options.deviceId as string,
          secChUaMobile: options.secChUaMobile,
          userAgent: options.userAgent,
        }).then((data) => classResponseListSchema.parse(data)),
    }),
  ]);
}
