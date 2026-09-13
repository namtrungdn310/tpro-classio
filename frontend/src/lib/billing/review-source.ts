/** Keep the actual server source; do not label every review as an admission edit. */
export function billingReviewSource(kind: string): string {
  const labels: Record<string, string> = {
    INITIAL: "Kiểm tra lịch thu ban đầu",
    INITIAL_BACKDATED: "Ghi danh với ngày bắt đầu trong quá khứ",
    ENROLLMENT_DATE_CHANGE: "Đổi ngày ghi danh theo luồng cũ",
    CLASS_START_DATE_CHANGE: "Đổi ngày bắt đầu lớp theo luồng cũ",
    PACKAGE_DURATION_CHANGE: "Đổi thời lượng gói học",
    BILLING_SCHEDULE_CHANGE: "Đổi mốc thu học phí",
  };
  return labels[kind] ?? "Lịch thu được yêu cầu kiểm tra";
}
