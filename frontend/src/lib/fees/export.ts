import type { FeeTab, UnpaidStage } from "@/lib/fees/types";
import type { StudentFeeGroup } from "@/lib/fees/view-model";
import type { FeeRecordResponse } from "@/lib/types";
import type { FeeTransactionListResponse } from "@/lib/types";
import { formatFeeBillingLabel } from "@/lib/fees/billing-label";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatPeriod,
} from "@/lib/utils/format";

type ExcelCell = string | number | null;

export type FeeExportContext = {
  activeTab: FeeTab;
  className?: string;
  period: string;
  unpaidStage: UnpaidStage;
};

export async function exportFeeGroups(
  groups: StudentFeeGroup[],
  context: FeeExportContext,
  transactionHistories: FeeTransactionListResponse[] = [],
) {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const summaryRows = buildFeeSummaryRows(groups, context);
  const detailRows = buildFeeDetailRows(groups, context);
  const transactionRows = buildFeeTransactionRows(
    groups,
    transactionHistories,
    context,
  );
  const toSheetData = (rows: Array<Record<string, ExcelCell>>) => {
    const headers = Object.keys(rows[0] ?? {});
    return [
      headers.map((header) => ({ value: header, fontWeight: "bold" as const })),
      ...rows.map((row) => headers.map((header) => row[header] ?? "")),
    ];
  };

  const sheets = [
    {
      columns: getAutoFitColumns(summaryRows),
      data: toSheetData(summaryRows),
      sheet: "Tong hop",
      stickyRowsCount: 1,
    },
    {
      columns: getAutoFitColumns(detailRows),
      data: toSheetData(detailRows),
      sheet: "Chi tiet",
      stickyRowsCount: 1,
    },
  ];
  if (transactionRows.length > 0) {
    sheets.push({
      columns: getAutoFitColumns(transactionRows),
      data: toSheetData(transactionRows),
      sheet: "Giao dich",
      stickyRowsCount: 1,
    });
  }

  await writeExcelFile(sheets).toFile(getFeeExportFileName(context));
}

export function buildFeeSummaryRows(
  groups: StudentFeeGroup[],
  context: FeeExportContext,
) {
  const status = getFeeExportStatus(context);

  return groups.map((group) => ({
    "Trạng thái": status,
    "Kỳ thu": formatPeriod(context.period),
    "Học viên": group.student_name,
    "Lớp học": group.classes.map((class_) => class_.name).join(", "),
    "Hình thức học phí": group.records
      .map(
        (record) =>
          `${record.class_name}: ${formatFeeBillingLabel(
            record.class_type,
            record.billing_cycle_months,
          )}`,
      )
      .join("; "),
    "Zalo học viên": group.student_zalo ?? "",
    "SĐT học viên": group.student_phone ?? "",
    "Zalo phụ huynh": group.parent_zalo ?? "",
    "SĐT phụ huynh": group.parent_phone ?? "",
    [context.activeTab === "unpaid" && context.unpaidStage === "unnotified"
      ? "Ngày bắt đầu"
      : context.activeTab === "unpaid" && context.unpaidStage === "notified"
        ? "Ngày đến hạn"
        : "Ngày đã báo"]:
      context.activeTab === "unpaid" && context.unpaidStage === "unnotified"
        ? formatDateList(group.enrollment_dates)
        : context.activeTab === "unpaid" && context.unpaidStage === "notified"
          ? formatDateList(group.due_dates)
          : formatDate(group.notified_at || group.due_date),
    [context.activeTab === "unpaid" && context.unpaidStage === "unnotified"
      ? "Ngày đến hạn"
      : context.activeTab === "unpaid" && context.unpaidStage === "notified"
        ? "Ngày đã báo"
        : "Ngày nộp"]:
      context.activeTab === "unpaid" && context.unpaidStage === "unnotified"
        ? formatDateList(group.due_dates)
        : context.activeTab === "unpaid" && context.unpaidStage === "notified"
          ? formatDate(group.notified_at)
          : formatDate(group.paid_date),
    "Tổng tiền (đ)": group.total_amount,
    "Đã nhận (đ)": group.gross_paid_amount,
    "Đã hoàn (đ)": group.refunded_amount,
    "Thực thu (đ)": group.net_collected_amount,
    "Chi tiết khoản": group.records
      .map(
        (record) =>
          `${record.class_name}: ${formatCurrency(record.final_amount)}`,
      )
      .join("; "),
  }));
}

export function buildFeeDetailRows(
  groups: StudentFeeGroup[],
  context: FeeExportContext,
) {
  return groups.flatMap((group) =>
    group.records.map((record) => ({
      "Trạng thái": getRecordExportStatus(record),
      "Kỳ thu": formatPeriod(context.period),
      "Học viên": group.student_name,
      "Lớp học": record.class_name,
      "Hình thức học phí": formatFeeBillingLabel(
        record.class_type,
        record.billing_cycle_months,
      ),
      "Zalo học viên": group.student_zalo ?? "",
      "SĐT học viên": group.student_phone ?? "",
      "Zalo phụ huynh": group.parent_zalo ?? "",
      "SĐT phụ huynh": group.parent_phone ?? "",
      "Ngày bắt đầu": formatDate(record.enrollment_date),
      "Ngày đến hạn": formatDate(record.due_date),
      "Ngày đã báo": formatDateTime(record.notified_at),
      "Ngày nộp": formatDate(record.paid_date),
      "Học phí gốc (đ)": record.base_amount,
      "Giảm trừ (đ)": record.discount_amount,
      "Số tiền cần thu (đ)": record.final_amount,
      "Đã nộp (đ)": record.paid_amount ?? "",
      "Đã hoàn (đ)": record.refunded_amount,
      "Thực thu (đ)": record.net_collected_amount,
      "Trạng thái hoàn": getRefundExportStatus(record.refund_state),
    })),
  );
}

export function buildFeeTransactionRows(
  groups: StudentFeeGroup[],
  histories: FeeTransactionListResponse[],
  context: FeeExportContext,
) {
  const recordContext = new Map(
    groups.flatMap((group) =>
      group.records.map((record) => [
        record.id,
        {
          className: record.class_name,
          studentName: group.student_name,
        },
      ] as const),
    ),
  );

  return histories.flatMap((history) => {
    const record = recordContext.get(history.fee_record_id);
    if (!record) return [];
    return history.transactions.map((transaction) => ({
      "Kỳ thu": formatPeriod(context.period),
      "Học viên": record.studentName,
      "Lớp học": record.className,
      "Loại giao dịch": getTransactionExportLabel(transaction.entry_type),
      "Số tiền tăng/giảm (đ)": transaction.amount,
      "Ngày giao dịch": formatDate(transaction.transaction_date),
      "Hình thức":
        transaction.payment_method === "cash" ? "Tiền mặt" : "Chuyển khoản",
      "Lý do / nội dung": transaction.note ?? "",
      "Người thao tác": transaction.created_by_name ?? "Tài khoản đã xoá",
      "Mã yêu cầu": transaction.request_id ?? "",
      "Mã giao dịch": transaction.id,
      "Tham chiếu giao dịch": transaction.related_payment_id ?? "",
    }));
  });
}

function getTransactionExportLabel(
  type: FeeTransactionListResponse["transactions"][number]["entry_type"],
) {
  if (type === "payment") return "Ghi nhận đã nộp";
  if (type === "payment_reversal") return "Hoàn tác ghi nhận đã nộp";
  if (type === "refund") return "Hoàn phí";
  return "Hoàn tác hoàn phí";
}

function getRefundExportStatus(state: FeeRecordResponse["refund_state"]) {
  if (state === "FULL") return "Đã hoàn toàn bộ";
  if (state === "PARTIAL") return "Đã hoàn một phần";
  return "Chưa hoàn";
}

function getFeeExportStatus(context: FeeExportContext) {
  if (context.activeTab === "paid") {
    return "Đã nộp";
  }

  return context.unpaidStage === "unnotified"
    ? "Chưa báo phụ huynh"
    : "Đã báo, chưa nộp";
}

function getRecordExportStatus(record: FeeRecordResponse) {
  if (record.notification_state === "PAID") {
    return "Đã nộp";
  }
  if (record.notification_state === "NOTIFIED_UNPAID") {
    return "Đã báo, chưa nộp";
  }
  return "Chưa báo phụ huynh";
}

function getAutoFitColumns(rows: Array<Record<string, ExcelCell>>) {
  const headers = Object.keys(rows[0] ?? {});

  return headers.map((header) => {
    const maxContentLength = rows.reduce((max, row) => {
      const content = row[header] == null ? "" : String(row[header]);
      return Math.max(max, content.length);
    }, header.length);

    return { width: Math.min(Math.max(maxContentLength + 3, 12), 48) };
  });
}

function getFeeExportFileName(context: FeeExportContext) {
  const statusName =
    context.activeTab === "paid"
      ? "DaNop"
      : context.unpaidStage === "unnotified"
        ? "ChuaBao"
        : "DaBaoChuaNop";
  const parts = ["HocPhi", context.period, statusName, context.className]
    .filter(Boolean)
    .map((part) => sanitizeFileName(String(part)));

  return `${parts.join("_")}.xlsx`;
}

function sanitizeFileName(value: string) {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "_");
}

function formatDateList(values: string[]) {
  return values.length > 0
    ? values.map((value) => formatDate(value)).join(", ")
    : "—";
}
