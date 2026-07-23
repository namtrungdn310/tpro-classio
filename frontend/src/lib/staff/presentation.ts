import type { StaffAssignedClass, StaffResponse, StaffType } from "@/lib/types";
import {
  createPreparedSearchMatcher,
  prepareSearchCorpus,
  type PreparedSearchCorpus,
} from "@/lib/utils/search";

export type StaffStatusFilter = "ACTIVE" | "INACTIVE";

export type PreparedStaffRecord = {
  activeClasses: StaffAssignedClass[];
  assignedClasses: StaffAssignedClass[];
  searchCorpus: PreparedSearchCorpus;
  staff: StaffResponse;
};

export function getStaffTypeLabel(type: StaffType) {
  return type === "TEACHER" ? "Giáo viên" : "Trợ giảng";
}

export function countActiveStaff(staff: StaffResponse[]) {
  return staff.reduce((total, item) => total + Number(item.is_active), 0);
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
    return {
      activeClasses,
      assignedClasses,
      searchCorpus: prepareSearchCorpus([
        item.full_name,
        getStaffTypeLabel(item.staff_type),
        ...activeClasses.map((class_) => class_.name),
        ...(includePrivateSearchValues
          ? [item.zalo_name ?? "", item.phone ?? ""]
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
    staffType: StaffType | "";
    status: StaffStatusFilter;
  },
) {
  const matchesSearch = createPreparedSearchMatcher(filters.search);

  return records
    .filter(({ searchCorpus, staff }) => {
      const matchesType = !filters.staffType || staff.staff_type === filters.staffType;
      const matchesStatus = filters.status === "ACTIVE" ? staff.is_active : !staff.is_active;
      return matchesType && matchesStatus && matchesSearch(searchCorpus);
    })
    .sort((a, b) => {
      if (a.staff.staff_type !== b.staff.staff_type) {
        return a.staff.staff_type === "TEACHER" ? -1 : 1;
      }
      return a.staff.full_name.localeCompare(b.staff.full_name, "vi");
    });
}
