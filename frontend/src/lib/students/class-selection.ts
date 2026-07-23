import type { ClassResponse, ClassType } from "@/lib/types";
import { getClassSortKey } from "@/lib/utils/class-groups";
import { createSmartSearchMatcher } from "@/lib/utils/search";

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
      const matchesName = matchesSearch([class_.name]);
      const matchesType = filters.type === "" || class_.type === filters.type;
      const matchesDuration =
        filters.duration === "" || class_.billing_cycle_months === Number(filters.duration);
      return matchesName && matchesType && matchesDuration;
    })
    .sort((first, second) => {
      const [firstGroup, firstName] = getClassSortKey(first.name);
      const [secondGroup, secondName] = getClassSortKey(second.name);
      return firstGroup - secondGroup || firstName.localeCompare(secondName, "vi");
    });
}
