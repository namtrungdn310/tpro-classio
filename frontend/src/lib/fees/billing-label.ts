import type { ClassType } from "@/lib/types";
import { getCourseWeeks } from "@/lib/utils/format";

export function formatFeeBillingLabel(
  classType: ClassType,
  billingCycleMonths: number,
  billingCycleWeeks?: number | null,
) {
  if (classType === "MONTHLY") {
    return "Theo tháng";
  }

  return `Theo gói · ${getCourseWeeks(billingCycleMonths, billingCycleWeeks)} tuần`;
}
