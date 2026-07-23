import type { FeeRecordResponse } from "@/lib/types";
import {
  DEFAULT_FEE_MESSAGE_TEMPLATES,
  MAX_RENDERED_FEE_MESSAGE_LENGTH,
  upgradeLegacyFeeMessageTemplate,
  type FeeMessageTemplateValues,
} from "@/lib/fees/message-templates";
import { getClassSortKey } from "@/lib/utils/class-groups";
import { formatCurrency, formatDate } from "@/lib/utils/format";

export type StudentFeeGroup = {
  student_id: string;
  student_name: string;
  student_zalo: string | null;
  student_phone: string | null;
  student_contact_hidden: boolean;
  parent_zalo: string | null;
  parent_phone: string | null;
  parent_contact_hidden: boolean;
  total_amount: number;
  gross_paid_amount: number;
  refunded_amount: number;
  net_collected_amount: number;
  refundable_amount: number;
  enrollment_date: string | null;
  enrollment_dates: string[];
  due_date: string | null;
  due_dates: string[];
  paid_date: string | null;
  notified_at: string | null;
  classes: Array<{ id: string; name: string }>;
  records: FeeRecordResponse[];
};

export function buildStudentFeeGroups(records: FeeRecordResponse[]) {
  const groups = new Map<string, StudentFeeGroup>();

  for (const record of records) {
    const current = groups.get(record.student_id);
    const next: StudentFeeGroup = current ?? {
      student_id: record.student_id,
      student_name: record.student_name,
      student_zalo: record.student_zalo,
      student_phone: record.student_phone,
      student_contact_hidden: record.student_contact_hidden,
      parent_zalo: record.parent_zalo,
      parent_phone: record.parent_phone,
      parent_contact_hidden: record.parent_contact_hidden,
      total_amount: 0,
      gross_paid_amount: 0,
      refunded_amount: 0,
      net_collected_amount: 0,
      refundable_amount: 0,
      enrollment_date: null,
      enrollment_dates: [],
      due_date: null,
      due_dates: [],
      paid_date: null,
      notified_at: null,
      classes: [],
      records: [],
    };

    next.records.push(record);
    next.student_contact_hidden ||= record.student_contact_hidden;
    next.student_zalo ??= record.student_zalo;
    next.student_phone ??= record.student_phone;
    next.parent_contact_hidden ||= record.parent_contact_hidden;
    next.parent_zalo ??= record.parent_zalo;
    next.parent_phone ??= record.parent_phone;
    next.total_amount += record.final_amount;
    next.gross_paid_amount += record.paid_amount ?? 0;
    next.refunded_amount += record.refunded_amount;
    next.net_collected_amount += record.net_collected_amount;
    next.refundable_amount += record.refundable_amount;
    next.enrollment_dates = addDistinctDate(next.enrollment_dates, record.enrollment_date);
    next.due_dates = addDistinctDate(next.due_dates, record.due_date);
    next.enrollment_date = next.enrollment_dates[0] ?? null;
    next.due_date = next.due_dates[0] ?? null;
    next.paid_date = getLaterDate(next.paid_date, record.paid_date);
    next.notified_at = getLaterDate(next.notified_at, record.notified_at);
    if (!next.classes.some((class_) => class_.id === record.class_id)) {
      next.classes.push({ id: record.class_id, name: record.class_name });
    }
    groups.set(record.student_id, next);
  }

  const groupedRecords = Array.from(groups.values());

  for (const group of groupedRecords) {
    group.classes.sort(compareClassNames);
    group.records.sort(
      (first, second) =>
        compareClassNames(
          { name: first.class_name },
          { name: second.class_name },
        ) ||
        (first.due_date ?? "9999-12-31").localeCompare(second.due_date ?? "9999-12-31"),
    );
  }

  return groupedRecords.sort((first, second) => {
    const firstDate = first.due_date ?? first.paid_date ?? "9999-12-31";
    const secondDate = second.due_date ?? second.paid_date ?? "9999-12-31";
    return (
      firstDate.localeCompare(secondDate) ||
      first.student_name.localeCompare(second.student_name, "vi")
    );
  });
}

export function renderGroupFeeMessage(
  group: StudentFeeGroup,
  isPaid: boolean,
  template: string,
) {
  const periodLabel = formatFeePeriod(group.records[0]?.period);
  const periodText = periodLabel || "kỳ hiện tại";
  const detailLines = group.records.map((record) => {
    const amount = isPaid
      ? record.paid_amount ?? record.final_amount
      : record.final_amount;
    return `${record.class_name}: ${formatCurrency(amount)}`;
  });
  const dueDateText = formatGroupDueDates(group.records);
  const total = group.records.reduce(
    (sum, record) =>
      sum + (isPaid ? record.paid_amount ?? record.final_amount : record.final_amount),
    0,
  );

  const replacements = {
    "{{ten_hoc_vien}}": group.student_name,
    "{{ky_hoc_phi}}": periodText,
    "{{chi_tiet_hoc_phi}}": detailLines.join("\n"),
    "{{ngay_den_han}}": dueDateText,
    "{{tong_tien}}": formatCurrency(total),
  };
  let message = upgradeLegacyFeeMessageTemplate(template, !isPaid).replace(
    /{{(?:ten_hoc_vien|ky_hoc_phi|chi_tiet_hoc_phi|ngay_den_han|tong_tien)}}/g,
    (token) => replacements[token as keyof typeof replacements],
  );
  message = message
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (isPaid && group.refunded_amount > 0) {
    const refundDetails = group.records
      .filter((record) => record.refunded_amount > 0)
      .map(
        (record) =>
          `${record.class_name}: đã hoàn ${formatCurrency(record.refunded_amount)}, thực nhận ${formatCurrency(record.net_collected_amount)}`,
      );
    message = [
      message,
      "Cập nhật sau hoàn phí:",
      ...refundDetails,
      `Tổng đã hoàn: ${formatCurrency(group.refunded_amount)}.`,
      `Tổng học phí trung tâm còn ghi nhận: ${formatCurrency(group.net_collected_amount)}.`,
    ].join("\n");
  }

  if (message.length > MAX_RENDERED_FEE_MESSAGE_LENGTH) {
    throw new Error(
      `Nội dung sau khi điền dữ liệu vượt quá ${MAX_RENDERED_FEE_MESSAGE_LENGTH} ký tự.`,
    );
  }
  return message;
}

export function getGroupCopyMessage(
  group: StudentFeeGroup,
  isPaid: boolean,
  templates: FeeMessageTemplateValues = DEFAULT_FEE_MESSAGE_TEMPLATES,
) {
  if (!isPaid) {
    const storedMessages = group.records
      .map((record) => record.notification_message?.trim() ?? "")
      .filter(Boolean);
    if (storedMessages.length === group.records.length) {
      return [...new Set(storedMessages)].join("\n\n");
    }
  }

  return renderGroupFeeMessage(
    group,
    isPaid,
    isPaid
      ? templates.payment_received_template
      : templates.payment_reminder_template,
  );
}

function addDistinctDate(dates: string[], value: string | null) {
  if (!value || dates.includes(value)) {
    return dates;
  }

  return [...dates, value].sort((first, second) => first.localeCompare(second));
}

function compareClassNames(first: { name: string }, second: { name: string }) {
  const firstKey = getClassSortKey(first.name);
  const secondKey = getClassSortKey(second.name);
  return firstKey[0] - secondKey[0] || firstKey[1].localeCompare(secondKey[1], "vi");
}

function getLaterDate(first: string | null, second: string | null) {
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }
  return first >= second ? first : second;
}

function formatFeePeriod(period: string | undefined) {
  if (!period || !/^\d{4}-\d{2}$/.test(period)) {
    return "";
  }

  const [year, month] = period.split("-");
  return `tháng ${Number(month)}/${year}`;
}

function formatGroupDueDates(records: FeeRecordResponse[]) {
  const entries = records.map((record) => ({
    className: record.class_name,
    value: formatDueDateValue(record.due_date),
  }));
  const distinctValues = new Set(entries.map(({ value }) => value));
  if (distinctValues.size === 1) {
    return entries[0]?.value ?? "Chưa xác định";
  }

  return entries.map(({ className, value }) => `${className}: ${value}`).join("; ");
}

function formatDueDateValue(dueDate: string | null) {
  if (!dueDate) return "Chưa xác định";
  return formatDate(dueDate);
}
