import { z } from "zod";
import { getContactPairError } from "@/lib/forms/contact-pair";
import { validationMessages } from "@/lib/forms/validation-messages";

const PHONE_ALLOWED_CHARACTERS = /^[\d+().\s-]*$/;
const EMAIL_PATTERN = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

const staffFormFields = {
  full_name: z
    .string()
    .trim()
    .min(1, validationMessages.required("họ và tên"))
    .max(255, "Họ và tên không được vượt quá 255 ký tự."),
  staff_type: z.enum(["TEACHER", "ASSISTANT"]),
  zalo_name: z
    .string()
    .trim()
    .max(100, "Tên Zalo không được vượt quá 100 ký tự."),
  phone: z
    .string()
    .trim()
    .max(32, "Số điện thoại không được vượt quá 32 ký tự.")
    .refine((value) => !value || PHONE_ALLOWED_CHARACTERS.test(value), validationMessages.phoneFormat)
    .refine(
      (value) => !value || /^0(?:3|5|7|8|9)\d{8}$/.test(normalizeVietnamPhone(value)),
      validationMessages.phoneFormat,
    ),
  email: z
    .string()
    .trim()
    .max(320, "Email không được vượt quá 320 ký tự.")
    .refine(
      (value) => !value || EMAIL_PATTERN.test(value),
      "Email nhân sự không hợp lệ.",
    ),
  checkin_window_hours: z
    .union([z.number(), z.string()])
    .optional()
    .refine((val) => {
      if (val === "" || val === null || val === undefined) return true;
      const num = Number(val);
      return !isNaN(num) && Number.isInteger(num) && num >= 0 && num <= 720;
    }, "Số giờ phải từ 0 đến 720."),
  checkin_window_minutes: z
    .union([z.number(), z.string()])
    .optional()
    .refine((val) => {
      if (val === "" || val === null || val === undefined) return true;
      const num = Number(val);
      return !isNaN(num) && Number.isInteger(num) && num >= 0 && num <= 59;
    }, "Số phút phải từ 0 đến 59."),
  checkin_window_after_hours: z
    .number()
    .optional(),
};

function buildStaffFormSchema(requireContact: boolean) {
  return z.object(staffFormFields).superRefine((values, context) => {
    if (requireContact && !values.zalo_name.trim()) {
      context.addIssue({
        code: "custom",
        path: ["zalo_name"],
        message: validationMessages.required("tên Zalo nhân sự"),
      });
    }
    if (requireContact && !values.phone.trim()) {
      context.addIssue({
        code: "custom",
        path: ["phone"],
        message: validationMessages.required("số điện thoại nhân sự"),
      });
    }
    addContactPairIssue(values.zalo_name, values.phone, context);

    const hasExplicitHours = values.checkin_window_hours !== undefined && values.checkin_window_hours !== "";
    const hasExplicitMinutes = values.checkin_window_minutes !== undefined && values.checkin_window_minutes !== "";

    if (hasExplicitHours || hasExplicitMinutes) {
      const h = hasExplicitHours ? Number(values.checkin_window_hours) : 24;
      const m = hasExplicitMinutes ? Number(values.checkin_window_minutes) : 0;
      if (h === 0 && m === 0) {
        context.addIssue({
          code: "custom",
          path: ["checkin_window_hours"],
          message: "Cửa sổ chấm công tối thiểu 1 phút.",
        });
      }
    } else if (values.checkin_window_after_hours !== undefined) {
      if (values.checkin_window_after_hours < 1) {
        context.addIssue({
          code: "custom",
          path: ["checkin_window_after_hours"],
          message: "Cửa sổ chấm công tối thiểu 1 giờ.",
        });
      } else if (values.checkin_window_after_hours > 720) {
        context.addIssue({
          code: "custom",
          path: ["checkin_window_after_hours"],
          message: "Cửa sổ chấm công tối đa 720 giờ.",
        });
      }
    }
  });
}

/** Editing remains compatible with legacy staff rows whose contact is empty. */
export const staffFormSchema = buildStaffFormSchema(false);

/** Newly created staff must have a complete contact pair. */
export const staffCreateFormSchema = buildStaffFormSchema(true);

export type StaffFormValues = z.infer<typeof staffFormSchema>;

export const staffResponseSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().trim().min(1).max(255),
  staff_type: z.enum(["TEACHER", "ASSISTANT"]),
  zalo_name: z.string().trim().min(1).max(100).nullable(),
  phone: z.string().max(32).nullable(),
  email: z.string().trim().max(320).nullable().nullish().default(null),
  checkin_window_after_hours: z.number().int().min(1).max(720).default(24),
  current_rate: z.number().int().nullable().nullish().default(null),
  attendance_account_status: z
    .enum(["connected", "disabled", "invited", "expired", "not_connected"])
    .default("not_connected"),
  is_active: z.boolean(),
  assigned_classes: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(1),
        is_active: z.boolean(),
      }),
    )
    .default([]),
  created_at: z.string(),
  updated_at: z.string(),
}).superRefine((values, context) => {
  addContactPairIssue(values.zalo_name, values.phone, context);
});

export const staffResponseListSchema = z.array(staffResponseSchema);

export const teacherOptionResponseListSchema = z.array(
  z.object({
    id: z.string().uuid(),
    full_name: z.string().trim().min(1).max(255),
    staff_type: z.enum(["TEACHER", "ASSISTANT"]),
    email: z.string().trim().max(320).nullable().nullish().default(null),
  }),
);

export function normalizeVietnamPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("84") ? `0${digits.slice(2)}` : digits;
}

function addContactPairIssue(
  zaloName: string | null,
  phone: string | null,
  context: z.RefinementCtx,
) {
  const error = getContactPairError(zaloName, phone, "nhân sự");
  if (!error) return;
  context.addIssue({
    code: "custom",
    path: [error.missingField === "zalo" ? "zalo_name" : "phone"],
    message: error.message,
  });
}
