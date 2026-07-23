import { apiClient } from "@/lib/api/client";
import {
  feeOperationListSchema,
  feeOperationSchema,
} from "@/lib/schemas/reports";
import type {
  FeeOperation,
  FeeOperationAction,
  FeeOperationListResponse,
} from "@/lib/types";

export type FeeOperationFilters = {
  action?: FeeOperationAction | "";
  period?: string;
  q?: string;
  date_from?: string;
  date_to?: string;
  cursor?: string;
  limit?: number;
};

export async function getFeeOperations(
  filters: FeeOperationFilters = {},
): Promise<FeeOperationListResponse> {
  const { data } = await apiClient.get<unknown>("/reports/fees/operations", {
    params: {
      ...filters,
      action: filters.action || undefined,
      period: filters.period || undefined,
      q: filters.q?.trim() || undefined,
      cursor: filters.cursor || undefined,
    },
  });
  return feeOperationListSchema.parse(data);
}

export async function getFeeOperation(operationId: string): Promise<FeeOperation> {
  const { data } = await apiClient.get<unknown>(
    `/reports/fees/operations/${operationId}`,
  );
  return feeOperationSchema.parse(data);
}

