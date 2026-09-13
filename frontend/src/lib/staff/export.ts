import { exportExcelWorkbook, sanitizeExcelFileName } from "@/lib/excel/workbook";
import type { PreparedStaffRecord } from "@/lib/staff/presentation";
import type { StaffAttendanceHistory, StaffPayrollSummary } from "@/lib/api/staff";

const ACCOUNT_LABELS: Record<string, string> = {
  connected: "Đã kết nối",
  disabled: "Đã tắt",
  invited: "Đã gửi lời mời",
  expired: "Lời mời hết hạn",
  not_connected: "Chưa kết nối",
};

export async function exportStaff(
  records: PreparedStaffRecord[],
  scopeLabel: string,
) {
  const rows = records.map(({ staff, activeClasses, summaryRoles }, index) => ({
    STT: index + 1,
    "Họ và tên": staff.full_name,
    "Vai trò": summaryRoles,
    "Trạng thái": staff.is_active ? "Đang làm việc" : "Đã nghỉ",
    "Email chấm công": staff.email ?? "",
    "Kết nối chấm công": ACCOUNT_LABELS[staff.attendance_account_status] ?? "Chưa kết nối",
    "Tên Zalo": staff.zalo_name ?? "",
    "Số điện thoại": staff.phone ?? "",
    "Lớp đang phụ trách": activeClasses.map((class_) => class_.name).join(", "),
    "Thù lao hiện tại (đ/buổi)": staff.current_rate ?? "",
    "Cho phép chấm công sau giờ học (giờ)": staff.checkin_window_after_hours,
    "Ngày thêm": toExcelDate(staff.created_at),
  }));

  await exportExcelWorkbook([
    {
      name: "Danh sach nhan su",
      title: "TPRO English · Danh sách nhân sự",
      description: `Phạm vi: ${scopeLabel} · ${rows.length} nhân sự theo bộ lọc đang xem`,
      rows,
    },
  ], `NhanSu_${sanitizeExcelFileName(scopeLabel)}_${monthKey()}.xlsx`);
}

export async function exportStaffPayroll(
  staffName: string,
  payroll: StaffPayrollSummary,
  attendance: StaffAttendanceHistory,
) {
  const attendanceRows = attendance.items.map((item, index) => ({
    STT: index + 1,
    "Lớp học": item.class_name ?? "Lớp đã đóng",
    "Vai trò": item.role === "TEACHER" ? "Giáo viên" : "Trợ giảng",
    "Bắt đầu buổi": toExcelDate(item.occurrence_start_at),
    "Kết thúc buổi": toExcelDate(item.occurrence_end_at),
    "Ngày chấm": toExcelDate(item.checkin_at),
    "Thù lao (đ)": item.rate_amount,
    "Trạng thái": item.reversed_at ? "Đã hủy" : "Đã ghi nhận",
    "Lý do hủy": item.reversal_reason ?? "",
  }));
  const settlementRows = payroll.settlements.map((item, index) => ({
    STT: index + 1,
    "Ngày tất toán": toExcelDate(item.created_at),
    "Số tiền (đ)": item.total_amount,
    "Hình thức": item.method === "cash" ? "Tiền mặt" : "Chuyển khoản",
    "Tài khoản": item.settlement_bank_name ?? "",
    "Số tài khoản": item.settlement_account_number ?? "",
    "Trạng thái": item.reversed_at ? "Đã hoàn tác" : "Đã tất toán",
    "Mã tham chiếu": item.reference ?? "",
  }));
  await exportExcelWorkbook([
    {
      name: "Cham cong",
      title: `TPRO English · Chấm công · ${staffName}`,
      description: `${attendanceRows.length} lượt chấm công · Số dư chưa tất toán: ${payroll.balance.toLocaleString("vi-VN")}đ`,
      rows: attendanceRows,
    },
    {
      name: "Tat toan",
      title: `TPRO English · Lịch sử tất toán · ${staffName}`,
      description: `${settlementRows.length} lần tất toán`,
      rows: settlementRows,
    },
  ], `ThuLao_${sanitizeExcelFileName(staffName)}_${monthKey()}.xlsx`);
}

function toExcelDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date;
}

function monthKey() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date());
}
