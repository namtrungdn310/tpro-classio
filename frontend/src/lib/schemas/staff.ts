import { z } from "zod";
import { getContactPairError } from "@/lib/forms/contact-pair";
import { validationMessages } from "@/lib/forms/validation-messages";

const PHONE_ALLOWED_CHARACTERS = /^[\d+().\s-]*$/;

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
