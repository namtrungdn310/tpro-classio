import { z } from "zod";

export const MAX_FEE_MESSAGE_TEMPLATE_LENGTH = 1_400;
export const MAX_RENDERED_FEE_MESSAGE_LENGTH = 2_000;
export const MAX_FEE_MESSAGE_TEMPLATE_VERSION = 2_147_483_647;

export const FEE_MESSAGE_TOKENS = [
  { token: "{{ten_hoc_vien}}", label: "Tên học viên" },
  { token: "{{ky_hoc_phi}}", label: "Kỳ học phí" },
  { token: "{{chi_tiet_hoc_phi}}", label: "Tên lớp: Số tiền" },
  { token: "{{ngay_den_han}}", label: "Ngày đến hạn" },
  { token: "{{tong_tien}}", label: "Tổng tiền" },
] as const;

export type FeeMessageTemplateSegment =
  | { type: "text"; value: string }
  | { type: "token"; label: string; value: string };

export function normalizeFeeMessageTemplateLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

export function splitFeeMessageTemplateLines(value: string): string[] {
  return normalizeFeeMessageTemplateLineEndings(value).split("\n");
}

const FEE_MESSAGE_TOKEN_LABELS = new Map<string, string>(
  FEE_MESSAGE_TOKENS.map(({ token, label }) => [token, label]),
);

const COMMON_TOKENS = FEE_MESSAGE_TOKENS.map(({ token }) => token);
const TOKEN_PATTERN = /{{[a-z_]+}}/g;
const LEGACY_OVERDUE_TOKEN = "{{nhac_qua_han}}";
const DUE_DATE_TOKEN = "{{ngay_den_han}}";
const CLASS_AMOUNT_TOKEN = "{{chi_tiet_hoc_phi}}";

export function tokenizeFeeMessageTemplate(value: string): FeeMessageTemplateSegment[] {
  const segments: FeeMessageTemplateSegment[] = [];
  let cursor = 0;

  for (const match of value.matchAll(TOKEN_PATTERN)) {
    const index = match.index;
    const token = match[0];
    if (index > cursor) {
      segments.push({ type: "text", value: value.slice(cursor, index) });
    }

    const label = FEE_MESSAGE_TOKEN_LABELS.get(token);
    segments.push(
      label
        ? { type: "token", label, value: token }
        : { type: "text", value: token },
    );
    cursor = index + token.length;
  }

  if (cursor < value.length) {
    segments.push({ type: "text", value: value.slice(cursor) });
  }

  return segments;
}

function createTemplateSchema(allowLegacyOverdueToken: boolean) {
  return z
    .string()
    .transform((value) =>
      upgradeLegacyFeeMessageTemplate(
        normalizeTemplate(value),
        allowLegacyOverdueToken,
      ),
    )
    .pipe(
    z
      .string()
      .min(20, "Nội dung cần có ít nhất 20 ký tự.")
      .max(
        MAX_FEE_MESSAGE_TEMPLATE_LENGTH,
        `Nội dung không được vượt quá ${MAX_FEE_MESSAGE_TEMPLATE_LENGTH} ký tự.`,
      )
      .refine(
        (value) =>
          ![...value].some(
            (character) =>
              character.charCodeAt(0) < 32 && character !== "\n" && character !== "\t",
          ),
        "Nội dung chứa ký tự điều khiển không hợp lệ.",
      ),
    );
}

const reminderTemplateSchema = createTemplateSchema(true);
const receivedTemplateSchema = createTemplateSchema(false);

const feeMessageTemplateValuesObjectSchema = z.object({
  payment_reminder_template: reminderTemplateSchema,
  payment_received_template: receivedTemplateSchema,
});

export const feeMessageTemplateValuesSchema =
  feeMessageTemplateValuesObjectSchema.superRefine((templates, context) => {
    validateTokens(
      templates.payment_reminder_template,
      COMMON_TOKENS,
      "payment_reminder_template",
      context,
    );
    validateTokens(
      templates.payment_received_template,
      COMMON_TOKENS,
      "payment_received_template",
      context,
    );
  });

export const feeMessageTemplatesResponseSchema =
  z.object({
      active: feeMessageTemplateValuesObjectSchema,
      defaults: feeMessageTemplateValuesObjectSchema,
      is_customized: z.boolean(),
      version: z
        .number()
        .int()
        .nonnegative()
        .max(MAX_FEE_MESSAGE_TEMPLATE_VERSION),
      updated_at: z.string().nullable(),
    });

export type FeeMessageTemplateValues = z.infer<typeof feeMessageTemplateValuesSchema>;

export function upgradeLegacyFeeMessageTemplate(
  value: string,
  allowLegacyOverdueToken = true,
): string {
  let upgraded = allowLegacyOverdueToken
    ? value.replaceAll(LEGACY_OVERDUE_TOKEN, "")
    : value;
  if (!upgraded.includes(DUE_DATE_TOKEN) && upgraded.includes(CLASS_AMOUNT_TOKEN)) {
    upgraded = upgraded.replace(
      CLASS_AMOUNT_TOKEN,
      `${CLASS_AMOUNT_TOKEN}\nNgày đến hạn: ${DUE_DATE_TOKEN}.`,
    );
  }
  return upgraded;
}

function normalizeTemplate(value: string) {
  // Preserve the message exactly as the admin authored it. Only line-ending
  // bytes differ across platforms; hard breaks, including intentional blank
  // and trailing lines, are part of the persisted Zalo content.
  return normalizeFeeMessageTemplateLineEndings(value);
}

function validateTokens(
  value: string,
  allowedTokens: readonly string[],
  path: keyof FeeMessageTemplateValues,
  context: z.RefinementCtx,
) {
  const foundTokens = value.match(TOKEN_PATTERN) ?? [];
  const foundTokenSet = new Set<string>(foundTokens);
  const contentWithoutValidTokens = value.replace(TOKEN_PATTERN, "");
  const allowedTokenSet = new Set<string>(allowedTokens);
  const hasUnknownToken = foundTokens.some((token) => !allowedTokenSet.has(token));

  if (
    hasUnknownToken ||
    contentWithoutValidTokens.includes("{") ||
    contentWithoutValidTokens.includes("}")
  ) {
    context.addIssue({
      code: "custom",
      path: [path],
      message: "Nội dung chứa biến không được hệ thống hỗ trợ.",
    });
    return;
  }

  const missingToken = COMMON_TOKENS.some((token) => !foundTokenSet.has(token));
  if (missingToken) {
    context.addIssue({
      code: "custom",
      path: [path],
      message:
        "Cần giữ đủ tên học viên, kỳ học phí, tên lớp, số tiền, ngày đến hạn và tổng tiền.",
    });
  }
}
