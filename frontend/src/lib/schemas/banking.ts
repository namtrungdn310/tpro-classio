import { z } from "zod";

const bankQrSourceSchema = z
  .string()
  .refine(
    (value) =>
      value.startsWith("/api/proxy/banking/accounts/") ||
      z.url().safeParse(value).success,
    "Đường dẫn ảnh QR không hợp lệ",
  );

const bankAccountResponseSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1),
  bank_code: z.string().min(2),
  bank_name: z.string().min(2),
  account_number: z.string().regex(/^\d{4,30}$/),
  account_name: z.string().min(2),
  qr_source_url: bankQrSourceSchema.nullable(),
  provider_account_id: z.string().nullable(),
  provider_bank_id: z.string().nullable(),
  va_number: z.string().nullable(),
  provider_status: z.string(),
  connection_type: z.enum(["external", "pay2s"]).default("external"),
  webhook_configured: z.boolean().default(false),
  is_default: z.boolean(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const bankingOverviewSchema = z.object({
  accounts: z.array(bankAccountResponseSchema),
  provider: z.object({
    provider: z.literal("pay2s"),
    status: z.enum([
      "not_configured",
      "pending_verification",
      "connected",
      "error",
      "disabled",
    ]),
    plan: z.string().min(1),
    merchant_id: z.string().nullable(),
    partner_code: z.string().nullable(),
    collection_partner_code: z.string().nullable(),
    access_key_configured: z.boolean(),
    webhook_configured: z.boolean(),
    webhook_url: z.string().url().nullable(),
    connected_at: z.string().nullable(),
    last_error: z.string().nullable(),
  }),
  readiness: z.object({
    provider_verified: z.boolean(),
    receiving_account_connected: z.boolean(),
    collection_link_configured: z.boolean(),
    transaction_webhook_configured: z.boolean(),
    qr_creation_ready: z.boolean(),
    automatic_recording_ready: z.boolean(),
    blocker: z
      .enum([
        "provider_disabled",
        "qr_disabled",
        "provider_not_verified",
        "receiving_account_missing",
        "partner_code_missing",
        "ipn_url_missing",
        "webhook_ingress_disabled",
        "auto_post_disabled",
      ])
      .nullable(),
  }),
});

export const bankAccountListSchema = z.object({
  accounts: z.array(bankAccountResponseSchema),
});

export const pay2sProviderStatusSchema = bankingOverviewSchema.shape.provider;

export const pay2sSupportedBanksSchema = z.object({
  banks: z.array(
    z.object({
      code: z.string().min(2).max(20),
      short_name: z.string().min(2).max(160),
      name: z.string().min(2).max(240),
    }),
  ),
  source: z.literal("pay2s_official_snapshot"),
  verified_at: z.string(),
});
