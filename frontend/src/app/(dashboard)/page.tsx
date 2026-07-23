import { Suspense } from "react";
import { cookies, headers } from "next/headers";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import DashboardClient from "./dashboard-client";
import { DashboardOverviewSkeleton } from "@/components/dashboard/dashboard-overview-skeleton";
import { ACCESS_TOKEN_COOKIE_KEY, DEVICE_ID_COOKIE_KEY } from "@/lib/auth/session";
import { prefetchDashboardQueries } from "@/lib/server/api";

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardOverviewSkeleton />}>
      <DashboardContent />
    </Suspense>
  );
}

async function DashboardContent() {
  const queryClient = new QueryClient();
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE_KEY)?.value ?? null;
  const deviceId = cookieStore.get(DEVICE_ID_COOKIE_KEY)?.value ?? null;

  await prefetchDashboardQueries(queryClient, {
    accessToken,
    deviceId,
    userAgent: requestHeaders.get("user-agent"),
    secChUaMobile: requestHeaders.get("sec-ch-ua-mobile"),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DashboardClient />
    </HydrationBoundary>
  );
}
