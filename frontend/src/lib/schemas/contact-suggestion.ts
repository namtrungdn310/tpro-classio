import { z } from "zod";

export const contactSuggestionResponseSchema = z
  .object({
    phone: z.string().min(1).max(32),
    zalo_name: z.string().min(1).max(100),
  })
  .nullable();
