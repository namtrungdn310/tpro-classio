import { getGroupCopyMessage, type StudentFeeGroup } from "@/lib/fees/view-model";
import type { FeeMessageTemplateValues } from "@/lib/fees/message-templates";

export async function copyFeeMessage(
  group: StudentFeeGroup,
  isPaid: boolean,
  templates: FeeMessageTemplateValues,
) {
  const message = getGroupCopyMessage(group, isPaid, templates);
  await copyText(message);
}

export async function copyText(message: string) {
  await navigator.clipboard.writeText(message);
}
