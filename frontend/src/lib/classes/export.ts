import type { ClassResponse } from "@/lib/types";
import {
  getClassAssistantNames,
  getClassCategoryLabel,
  getClassGradeYearLabel,
  getClassScheduleSummary,
  getClassTeacherNames,
} from "@/lib/classes/presentation";
import { exportExcelWorkbook, sanitizeExcelFileName } from "@/lib/excel/workbook";
import { formatClassType } from "@/lib/utils/format";

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Đang hoạt động",
  SCHEDULED: "Sắp mở",
  COMPLETED: "Đã kết thúc",
  CANCELLED: "Đã hủy",
};

export async function exportClasses(
  records: ClassResponse[],
  scopeLabel: string,
) {
  const rows = records.map((class_, index) => ({
    STT: index + 1,
    "Tên lớp": class_.name,
    "Nhóm lớp": getClassCategoryLabel(class_),
    "Khối / năm học": getClassGradeYearLabel(class_) ?? "",
    "Hình thức học phí": formatClassType(class_.type),
    "Mức học phí (đ)": class_.base_fee,
    "Lịch học": getClassScheduleSummary(class_, { fallback: "Chưa xếp lịch" }),
    "Giáo viên": getClassTeacherNames(class_).join(", "),
    "Trợ giảng": getClassAssistantNames(class_).join(", "),
    "Số học viên": class_.student_count,
    "Ngày bắt đầu": toExcelDate(class_.start_date),
    "Ngày kết thúc": toExcelDate(class_.end_date),
    "Trạng thái": STATUS_LABELS[class_.effective_status] ?? class_.effective_status,
  }));

  await exportExcelWorkbook([
    {
      name: "Danh sach lop",
      title: "TPRO English · Danh sách lớp học",
      description: `Phạm vi: ${scopeLabel} · ${rows.length} lớp theo bộ lọc đang xem`,
      rows,
    },
  ], `LopHoc_${sanitizeExcelFileName(scopeLabel)}_${monthKey()}.xlsx`);
}

function toExcelDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date;
}

function monthKey() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date());
}
