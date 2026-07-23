import type { StudentFeeGroup } from "@/lib/fees/view-model";
import type { FeeUnpayTargetState } from "@/lib/types";
import { formatCurrency } from "@/lib/utils/format";

export type FeeConfirmationAction = "pay" | "unpay" | "unnotify";

export type FeeConfirmationTarget = {
  action: FeeConfirmationAction;
  group: StudentFeeGroup;
};

export function canRestoreNotifiedFeeState(group: StudentFeeGroup): boolean {
  return (
    group.records.length > 0 &&
    group.records.every(
      (record) =>
        record.notified_at !== null &&
        record.notification_channel !== null &&
        Boolean(record.notification_message?.trim()),
    )
  );
}

export function getDefaultUnpayTargetState(
  group: StudentFeeGroup,
): FeeUnpayTargetState {
  return canRestoreNotifiedFeeState(group) ? "NOTIFIED_UNPAID" : "UNNOTIFIED";
}

export function getFeeConfirmationContent(
  target: FeeConfirmationTarget | null,
  unpayTargetState: FeeUnpayTargetState = "NOTIFIED_UNPAID",
): {
  title: string;
  description: string;
  confirmLabel: string;
  tone: "default" | "danger";
} {
  if (!target) {
    return {
      title: "Xác nhận thao tác",
      description: "",
      confirmLabel: "Xác nhận",
      tone: "default",
    };
  }

  const { group } = target;
  const classNames = group.classes.map((class_) => class_.name).join(", ");
  if (target.action === "pay") {
    return {
      title: "Ghi nhận đã nộp học phí",
      description: `Xác nhận đã nhận ${formatCurrency(group.total_amount)} của ${group.student_name} cho ${classNames}. Giao dịch này sẽ được lưu vào lịch sử thanh toán.`,
      confirmLabel: "Xác nhận đã nộp",
      tone: "default",
    };
  }

  if (target.action === "unpay") {
    const targetDescription =
      unpayTargetState === "UNNOTIFIED"
        ? "trở về trạng thái chưa báo, chưa nộp; nội dung thông báo đã lưu (nếu có) sẽ được xoá"
        : "trở về trạng thái đã báo, chưa nộp và giữ nguyên nội dung thông báo";
    return {
      title: "Hoàn tác ghi nhận đã nộp",
      description: `Khoản ${formatCurrency(group.total_amount)} của ${group.student_name} sẽ ${targetDescription}. Hệ thống vẫn giữ bút toán sửa sai để đối soát.`,
      confirmLabel: "Hoàn tác",
      tone: "danger",
    };
  }

  return {
    title: "Chuyển về trạng thái chưa báo",
    description: `Học phí của ${group.student_name} sẽ được tính lại theo dữ liệu lớp hiện tại. Khoản không còn hợp lệ sẽ được gỡ khỏi kỳ thu này.`,
    confirmLabel: "Chuyển về chưa báo",
    tone: "danger",
  };
}
