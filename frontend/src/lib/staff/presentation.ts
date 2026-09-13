import type { StaffAssignedClass, StaffResponse, StaffType } from "@/lib/types";
import {
  createPreparedSearchMatcher,
  prepareSearchCorpus,
  type PreparedSearchCorpus,
} from "@/lib/utils/search";

export type StaffScope = "assigned" | "unassigned" | "inactive";

export type PreparedStaffRecord = {
  activeClasses: StaffAssignedClass[];
  assignedClasses: StaffAssignedClass[];
  hasOperationalAssignment: boolean;
  scope: StaffScope;
  summaryRoles: string;
  searchCorpus: PreparedSearchCorpus;
  staff: StaffResponse;
};

export function getStaffTypeLabel(type?: StaffType | null): string {
  if (type === "TEACHER") return "Giáo viên";
  if (type === "ASSISTANT") return "Trợ giảng";
  return "";
}

export function hasOperationalAssignment(
  assignedClasses: readonly StaffAssignedClass[],
): boolean {
  return assignedClasses.some((item) => item.is_active);
}

export function getStaffScope(staff: StaffResponse): StaffScope {
  if (!staff.is_active) return "inactive";
  return hasOperationalAssignment(staff.assigned_classes) ? "assigned" : "unassigned";
}

export function getStaffSummaryRoles(
  assignedClasses: readonly StaffAssignedClass[],
): string {
  const operational = assignedClasses.filter((c) => c.is_active);
  const roles = new Set<string>();
  for (const c of operational) {
    if (c.role === "TEACHER") roles.add("Giáo viên");
    else if (c.role === "ASSISTANT") roles.add("Trợ giảng");
  }
  if (roles.size === 0) return "Chưa phân công";
  return Array.from(roles).join(" · ");
}

export function prepareStaffRecords(
  staff: StaffResponse[],
  includePrivateSearchValues: boolean,
): PreparedStaffRecord[] {
  return staff.map((item) => {
    const assignedClasses = [...item.assigned_classes].sort((a, b) =>
      a.name.localeCompare(b.name, "vi"),
    );
    const activeClasses = assignedClasses.filter((class_) => class_.is_active);
    const operational = activeClasses.length > 0;
    const scope: StaffScope = !item.is_active
      ? "inactive"
      : operational
        ? "assigned"
        : "unassigned";
    const summaryRoles = getStaffSummaryRoles(assignedClasses);

    return {
      activeClasses,
      assignedClasses,
      hasOperationalAssignment: operational,
      scope,
      summaryRoles,
      searchCorpus: prepareSearchCorpus([
        item.full_name,
        summaryRoles,
        ...assignedClasses.map((class_) => class_.name),
        ...(includePrivateSearchValues
          ? [item.zalo_name ?? "", item.phone ?? "", item.email ?? ""]
          : []),
      ]),
      staff: item,
    };
  });
}

export function filterAndSortStaff(
  records: PreparedStaffRecord[],
  filters: {
    search: string;
    scope?: StaffScope;
  },
) {
  const matchesSearch = createPreparedSearchMatcher(filters.search);

  return records
    .filter((record) => {
      const matchesScope = !filters.scope || record.scope === filters.scope;
      return matchesScope && matchesSearch(record.searchCorpus);
    })
    .sort((a, b) => a.staff.full_name.localeCompare(b.staff.full_name, "vi"));
}
