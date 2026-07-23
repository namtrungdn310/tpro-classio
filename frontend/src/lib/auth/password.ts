import { z } from "zod";
import { validationMessages } from "@/lib/forms/validation-messages";

export const passwordSchema = z
  .string()
  .min(1, validationMessages.required("mật khẩu"))
  .min(8, validationMessages.passwordMinLength)
  .max(128, validationMessages.passwordMaxLength)
  .regex(/\p{Lu}/u, validationMessages.passwordUppercase)
  .regex(/\d/, validationMessages.passwordNumber)
  .regex(/[^\p{L}\p{N}\s]/u, validationMessages.passwordSpecial);
