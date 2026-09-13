import { apiClient } from "@/lib/api/client";
import {
  opsOverviewSchema,
} from "@/lib/schemas/ops";
import type {
  OpsOverviewResponse,
} from "@/lib/types";

export async function getOpsOverview(): Promise<OpsOverviewResponse> {
  const { data } = await apiClient.get<unknown>("/ops/overview");
  return opsOverviewSchema.parse(data);
}

export async function disableWorkspacePay2S(
  workspaceId: string,
  reason: string,
): Promise<{ applied: boolean }> {
  const { data } = await apiClient.post<{ applied: boolean }>(
    `/ops/workspaces/${workspaceId}/pay2s/disable`,
    { reason },
  );
  return data;
}
