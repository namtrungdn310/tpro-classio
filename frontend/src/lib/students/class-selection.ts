import type { ClassResponse, ClassType } from "@/lib/types";
import { getClassSortKey } from "@/lib/utils/class-groups";
import { createSmartSearchMatcher } from "@/lib/utils/search";
import { getCourseWeeks } from "@/lib/utils/format";

export type ClassSelectionFilters = {
  duration: string;
  search: string;
  type: ClassType | "";
};

export function filterAndSortClassSelection(
  classes: ClassResponse[],
  filters: ClassSelectionFilters,
) {
  const matchesSearch = createSmartSearchMatcher(filters.search);

  return [...classes]
    .filter((class_) => {
      const matchesName = matchesSearch([
        class_.name,
        class_.display_name,
        class_.primary_label,
        class_.secondary_label,
      ]);
      const matchesType = filters.type === "" || class_.type === filters.type;
      const matchesDuration =
        filters.duration === "" ||
        getCourseWeeks(class_.billing_cycle_months, class_.billing_cycle_weeks) ===
          Number(filters.duration);
      return matchesName && matchesType && matchesDuration;
    })
    .sort((first, second) => {
      const [firstGroup, firstName] = getClassSortKey(first.name);
      const [secondGroup, secondName] = getClassSortKey(second.name);
      return firstGroup - secondGroup || firstName.localeCompare(secondName, "vi");
    });
}
