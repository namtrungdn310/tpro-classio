import { getFeeOperations, getFeePaidReceipts, type FeeOperationFilters, type FeePaidReceiptFilters } from "@/lib/api/reports";
import { exportExcelWorkbook } from "@/lib/excel/workbook";
import { formatStudentCode } from "@/lib/students/student-code";
import type { FeeOperation, FeePaidReceiptSummary, PaymentReconciliationItem } from "@/lib/types";
import { formatPeriod } from "@/lib/utils/format";

const ACTION_LABELS: Record<string, string> = {
  notify: "Gửi nhắc học phí",
  unnotify: "Hủy trạng thái đã nhắc",
  payment: "Ghi nhận học phí",
  payment_reversal: "Hoàn tác ghi nhận",
  refund: "Hoàn học phí",
  refund_reversal: "Hoàn tác hoàn phí",
  sync: "Đồng bộ học phí",
  template_update: "Cập nhật mẫu nhắc phí",
};

export async function exportPaidReceipts(filters: FeePaidReceiptFilters, filterLabel: string) {
  const receipts = await collectAll(filters, async (cursor) => {
    const page = await getFeePaidReceipts({ ...filters, cursor, limit: 100 });
    return { rows: page.receipts, cursor: page.next_cursor };
  });
  await exportExcelWorkbook([receiptSheet(receipts, filterLabel)], `SoThuHocPhi_${monthKey()}.xlsx`);
  return receipts.length;
}

export async function exportFeeOperations(filters: FeeOperationFilters, filterLabel: string) {
  const operations = await collectAll(filters, async (cursor) => {
    const page = await getFeeOperations({ ...filters, cursor, limit: 100 });
    return { rows: page.operations, cursor: page.next_cursor };
  });
  await exportExcelWorkbook([operationSheet(operations, filterLabel)], `NhatKyHocPhi_${monthKey()}.xlsx`);
  return operations.length;
}

export async function exportReconciliation(items: PaymentReconciliationItem[]) {
  const rows = items.map((item, index) => ({
    STT: index + 1,
    "Lý do cần kiểm tra": item.review_reason ?? "Cần kiểm tra thủ công",
    "Ngân hàng nhận": item.bank_name ?? "",
    "Số tài khoản nhận": item.account_number ?? "",
    "Số tiền (đ)": item.amount ?? "",
    "Nội dung chuyển khoản": item.content ?? "",
    "Mã giao dịch": item.provider_transaction_id ?? "",
    "Thời gian giao dịch": toExcelDate(item.transaction_date),
    "Thời gian tiếp nhận": toExcelDate(item.received_at),
    "Trạng thái": item.status,
  }));
  await exportExcelWorkbook([{
    name: "Doi soat",
    title: "TPRO English · Giao dịch cần kiểm tra",
    description: `${rows.length} giao dịch cần admin kiểm tra`,
    rows,
  }], `DoiSoatHocPhi_${monthKey()}.xlsx`);
  return rows.length;
}

function receiptSheet(receipts: FeePaidReceiptSummary[], filterLabel: string) {
  return {
    name: "So thu",
    title: "TPRO English · Sổ thu học phí",
    description: `${filterLabel} · ${receipts.length} phiếu thu`,
    rows: receipts.map((receipt, index) => ({
      STT: index + 1,
      "Mã phiếu": receipt.receipt_id,
      "Mã học viên": receipt.student_code ? formatStudentCode(receipt.student_code) : "",
      "Học viên": receipt.student_name,
      "Lớp học": receipt.class_names.join(", "),
      "Kỳ học phí": receipt.period ? formatPeriod(receipt.period) : "",
      "Ngày nộp": toExcelDate(receipt.paid_date),
      "Hình thức": receipt.payment_method === "cash" ? "Tiền mặt" : "Chuyển khoản",
      "Nguồn ghi nhận": receipt.payment_origin === "pay2s" ? "Pay2S tự động" : "Thủ công",
      "Tài khoản nhận": receipt.settlement_bank_name ?? "",
      "Số tiền đã nhận (đ)": receipt.gross_amount,
      "Đã hoàn (đ)": receipt.refunded_amount,
      "Thực thu (đ)": receipt.net_amount,
      "Người ghi nhận": receipt.actor_name || receipt.actor_username || "Hệ thống",
    })),
  };
}

function operationSheet(operations: FeeOperation[], filterLabel: string) {
  return {
    name: "Nhat ky",
    title: "TPRO English · Nhật ký học phí",
    description: `${filterLabel} · ${operations.length} hoạt động`,
    rows: operations.flatMap((operation) => operation.items.map((item) => ({
      "Thời điểm": toExcelDate(operation.occurred_at),
      "Hoạt động": ACTION_LABELS[operation.action] ?? operation.action,
      "Mã học viên": item.student_code ? formatStudentCode(item.student_code) : "",
      "Học viên": item.student_name ?? "",
      "Lớp học": item.class_name ?? "",
      "Kỳ học phí": item.period ? formatPeriod(item.period) : "",
      "Số tiền tăng/giảm (đ)": item.amount_delta,
      "Trạng thái trước": item.state_before ?? "",
      "Trạng thái sau": item.state_after ?? "",
      "Lý do / nội dung": item.reason || item.message || "",
      "Người thao tác": operation.actor_name || operation.actor_username || "Hệ thống",
      "Mã hoạt động": operation.id,
    }))),
  };
}

async function collectAll<TFilters, TRow>(
  _filters: TFilters,
  fetchPage: (cursor: string) => Promise<{ rows: TRow[]; cursor: string | null }>,
) {
  const rows: TRow[] = [];
  let cursor = "";
  for (let pageNumber = 0; pageNumber < 500; pageNumber += 1) {
    const page = await fetchPage(cursor);
    rows.push(...page.rows);
    if (!page.cursor) return rows;
    cursor = page.cursor;
  }
  throw new Error("Danh sách quá lớn để xuất trong một lần.");
}

function toExcelDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : date;
}

function monthKey() {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
}
