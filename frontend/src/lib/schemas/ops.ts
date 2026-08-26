import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });

export const opsOverviewSchema = z.object({
  generated_at: isoDateTime,
  status: z.enum(["operational", "degraded"]),
  workspaces: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      owner_user_id: z.string().uuid().nullable(),
      admin_count: z.number().int().nonnegative(),
      active_admin_count: z.number().int().nonnegative(),
      open_request_count: z.number().int().nonnegative(),
      review_request_count: z.number().int().nonnegative(),
      quarantined_count: z.number().int().nonnegative(),
      provider_status: z.string(),
      provider_last_error: z.string().nullable(),
      last_received_at: isoDateTime.nullable(),
    }),
  ),
  incidents: z.array(
    z.object({
      incident_id: z.string(),
      severity: z.enum(["low", "medium", "high", "critical"]),
      title: z.string(),
      summary: z.string(),
    }),
  ),
});
