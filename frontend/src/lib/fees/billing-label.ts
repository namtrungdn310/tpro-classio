import type { ClassType } from "@/lib/types";
import { getCourseWeeks } from "@/lib/utils/format";

export function formatFeeBillingLabel(
  classType: ClassType,
  billingCycleMonths: number,
) {
  if (classType === "MONTHLY") {
    return "Theo tháng";
  }

  return `Theo khóa · ${getCourseWeeks(billingCycleMonths)} tuần`;
}
