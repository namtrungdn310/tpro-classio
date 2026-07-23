import type { StudentFeeGroup } from "@/lib/fees/view-model";
import type {
  FeePaymentMethod,
  FeeRecordResponse,
  FeeRefundReceipt,
} from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/utils/format";

export type FeeRefundAllocation = {
  record_id: string;
  amount: number;
};

export type FeeRefundAmountErrors = Record<string, string>;

export function getRefundableFeeRecords(group: StudentFeeGroup) {
  return group.records.filter(
    (record) => record.status === "PAID" && record.refundable_amount > 0,
  );
}

export function buildRefundAllocations(
  records: FeeRecordResponse[],
  amounts: Readonly<Record<string, number | null>>,
): FeeRefundAllocation[] {
  return records.flatMap((record) => {
    const amount = amounts[record.id];
    return typeof amount === "number" && Number.isSafeInteger(amount) && amount > 0
      ? [{ record_id: record.id, amount }]
      : [];
  });
}

export function validateRefundAllocations(
  records: FeeRecordResponse[],
  allocations: FeeRefundAllocation[],
) {
  if (allocations.length === 0) {
    return "Vui lòng nhập số tiền cần hoàn cho ít nhất một lớp.";
  }

  const recordsById = new Map(records.map((record) => [record.id, record]));
  for (const allocation of allocations) {
    const record = recordsById.get(allocation.record_id);
    if (!record) {
      return "Khoản học phí đã chọn không còn khả dụng.";
    }
    if (allocation.amount > record.refundable_amount) {
      return `Số tiền hoàn cho lớp ${record.class_name} không được vượt ${formatCurrency(record.refundable_amount)}.`;
    }
  }

  return null;
}

export function getRefundAmountErrors(
  records: FeeRecordResponse[],
  amounts: Readonly<Record<string, number | null>>,
): FeeRefundAmountErrors {
  const errors: FeeRefundAmountErrors = {};
  let hasValidAmount = false;

  for (const record of records) {
    const amount = amounts[record.id];
    if (amount === null || amount === undefined) {
      continue;
    }
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      errors[record.id] = "Số tiền hoàn phải là số nguyên lớn hơn 0đ.";
      continue;
    }
    if (amount > record.refundable_amount) {
      errors[record.id] = `Số tiền hoàn không được vượt ${formatCurrency(record.refundable_amount)}.`;
      continue;
    }
    hasValidAmount = true;
  }

  if (!hasValidAmount && Object.keys(errors).length === 0 && records[0]) {
    errors[records[0].id] = "Vui lòng nhập số tiền cần hoàn cho ít nhất một lớp.";
  }

  return errors;
}

export function getRefundMethodLabel(method: FeePaymentMethod) {
  return method === "cash" ? "tiền mặt" : "chuyển khoản";
}

export function buildRefundReceiptMessage(
  group: StudentFeeGroup,
  receipt: FeeRefundReceipt,
) {
  const recordsById = new Map(group.records.map((record) => [record.id, record]));
  const details = receipt.items
    .map((item) => {
      const record = recordsById.get(item.record_id);
      return `${record?.class_name ?? "Lớp học"}: ${formatCurrency(item.amount)}`;
    })
    .join("\n");

  return [
    `TPRO English xác nhận đã hoàn học phí cho em ${group.student_name}.`,
    details,
    `Tổng tiền hoàn: ${formatCurrency(receipt.total_amount)}.`,
    `Ngày hoàn: ${formatDate(receipt.refund_date)} · Hình thức: ${getRefundMethodLabel(receipt.refund_method)}.`,
    "Phụ huynh vui lòng kiểm tra giúp trung tâm. Cảm ơn phụ huynh.",
  ].join("\n");
}
