import { apiClient } from "@/lib/api/client";
import { dashboardOverviewSchema } from "@/lib/schemas/dashboard";
import type { DashboardOverviewResponse } from "@/lib/types";

export async function getDashboardOverview(): Promise<DashboardOverviewResponse> {
  const { data } = await apiClient.get<DashboardOverviewResponse>("/dashboard/overview");
  return dashboardOverviewSchema.parse(data);
}
