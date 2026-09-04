import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { studentMembershipPreviewResponseSchema } from "../src/lib/schemas/student";

const studentPageSource = readFileSync(
  resolve(process.cwd(), "src/app/(dashboard)/students/page.tsx"),
  "utf8",
);

const startDateDialogSource = readFileSync(
  resolve(process.cwd(), "src/components/students/student-start-date-dialog.tsx"),
  "utf8",
);

test("studentMembershipPreviewResponseSchema preserves enrollment_updates and decisions", () => {
  const previewData = {
    can_apply: true,
    preview_fingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    expires_at: "2026-09-03T15:00:00Z",
    student_updated_at: "2026-09-03T14:30:00Z",
    targets: [],
    source: null,
    warnings: [],
    enrollment_updates: [
      {
        enrollment_id: "11111111-1111-4111-8111-111111111111",
        student_id: "22222222-2222-4222-8222-222222222222",
        student_name: "Nguyen Van A",
        class_id: "33333333-3333-4333-8333-333333333333",
        class_name: "Starters 1",
        old_enrollment_date: "2026-08-01",
        new_enrollment_date: "2026-09-01",
        must_change: false,
        recommended_decision: "KEEP_CURRENT_THEN_REANCHOR",
        protected_fee_count: 1,
        mutable_fee_count: 1,
        decisions: [
          {
            decision_code: "KEEP_CURRENT_THEN_REANCHOR",
            label: "Giữ kỳ hiện tại, chuyển lịch từ kỳ kế tiếp",
            description: "Bảo vệ kỳ thu hiện tại",
            recommended: true,
            coverage_start: "2026-09-01",
            coverage_end: "2026-09-30",
            due_date: "2026-09-05",
            first_anchor_cycle_no: 1,
            skipped_cycle_count: 1,
            superseded_fee_count: 0,
            protected_fee_count: 1,
            review_required: false,
            available_cycles: [],
          },
          {
            decision_code: "REANCHOR_CURRENT_CYCLE",
            label: "Tính lại từ kỳ đang học hiện tại",
            description: "Hủy khoản thu cũ và tính lại",
            recommended: false,
            coverage_start: "2026-09-01",
            coverage_end: "2026-09-30",
            due_date: "2026-09-05",
            first_anchor_cycle_no: 0,
            skipped_cycle_count: 0,
            superseded_fee_count: 1,
            protected_fee_count: 1,
            review_required: false,
            available_cycles: [],
          },
        ],
      },
    ],
  };

  const parsed = studentMembershipPreviewResponseSchema.safeParse(previewData);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.enrollment_updates.length, 1);
    assert.equal(parsed.data.enrollment_updates[0]?.decisions.length, 2);
    assert.equal(
      parsed.data.enrollment_updates[0]?.recommended_decision,
      "KEEP_CURRENT_THEN_REANCHOR",
    );
  }
});

test("StudentStartDateDialog presents canonical decision options clearly", () => {
  // Option 1: Thu nốt kỳ cũ cuối cùng, rồi đổi qua kỳ mới
  assert.match(
    startDateDialogSource,
    /Thu nốt (cho xong )?kỳ (cũ|cuối) cuối cùng, rồi (mới )?đổi qua kỳ mới/,
  );
  assert.match(startDateDialogSource, /KEEP_CURRENT_THEN_REANCHOR/);

  // Option 2: Bỏ qua kỳ cũ và qua kỳ mới
  assert.match(
    startDateDialogSource,
    /Bỏ (luôn|qua) kỳ cũ và qua kỳ mới( luôn)?/,
  );
  assert.match(startDateDialogSource, /REANCHOR_CURRENT_CYCLE/);

  // Option 3: Giữ nguyên toàn bộ lịch thu cũ
  assert.match(
    startDateDialogSource,
    /Giữ nguyên toàn bộ lịch thu cũ/,
  );
  assert.match(startDateDialogSource, /KEEP_EXISTING_SCHEDULE/);

  // Accessible reason input without autocomplete
  assert.match(startDateDialogSource, /autoComplete="off"/);
  assert.match(startDateDialogSource, /Xác nhận & Cập nhật học phí/);
});

test("StudentFormDialog integrates StudentStartDateDialog on enrollment date change", () => {
  // Renders StudentStartDateDialog in overlay
  assert.match(studentPageSource, /<StudentStartDateDialog/);

  // Intercepts submit to preview membership when date changes
  assert.match(studentPageSource, /previewStudentMembership\(student\.id/);
  assert.match(studentPageSource, /pendingDateReview/);

  // Passes decision_code to update mutation
  assert.match(studentPageSource, /payload\.decision_code = dateDecisions\[enrollment\.id\]/);

  // Removed old confusing toast notification
  assert.doesNotMatch(
    studentPageSource,
    /Ngày bắt đầu đã thay đổi\. Hãy mở trang Học phí để kiểm tra/,
  );
});

test("StudentStartDateDialog enforces zero icons, native thin caret, and no redundant close button", () => {
  // Absolutely no icons imported from react-icons in StudentStartDateDialog
  assert.doesNotMatch(startDateDialogSource, /from "react-icons/);
  // No redundant close button in header (since footer already has Hủy bỏ)
  assert.doesNotMatch(startDateDialogSource, /aria-label="Đóng"/);
  assert.doesNotMatch(startDateDialogSource, />Đóng<\/button>/);
  // Textarea uses font-normal, text-[15px] and caret-gray-900 for thin browser caret
  assert.match(startDateDialogSource, /caret-gray-900/);
  assert.match(startDateDialogSource, /font-normal/);
  assert.match(startDateDialogSource, /text-\[15px\]/);
});

test("EnrollmentFeeSection provides same-row billing status and note without icons", () => {
  // Same row container for date input and billing status button
  assert.match(studentPageSource, /flex items-start gap-2/);
  // Case 1: unnotified -> "Áp dụng" button with pure white background and primary text
  assert.match(studentPageSource, /Áp dụng/);
  assert.match(studentPageSource, /bg-white px-3 text-sm font-medium text-primary/);
  // Distinct Case 2: notified -> "Xử lý kỳ thu"
  assert.match(studentPageSource, /Xử lý kỳ thu/);
  // Enriched note line below date input bounded to the date input column (no "Tự động")
  assert.match(studentPageSource, /Kỳ thu: Đổi từ kỳ cũ/);
  assert.doesNotMatch(studentPageSource, /Kỳ thu: Tự động/);
  assert.match(studentPageSource, /Kỳ hiện tại/);
  // Uses synchronized LoadingLabel and design tokens
  assert.match(studentPageSource, /<LoadingLabel label="Đang kiểm tra" \/>/);
  assert.match(studentPageSource, /helper-text text-gray-600/);
  assert.match(studentPageSource, /form-input-text inline-flex h-8/);
});

test("Enrollment date change caches checked date and does not re-trigger loading on blur", () => {
  // Uses lastCheckedDateMapRef to prevent redundant checks
  assert.match(studentPageSource, /lastCheckedDateMapRef\.current\[enrollmentId\] === inputDate/);
  // onEnrollmentDateBlur does NOT call checkDateImpact
  assert.doesNotMatch(
    studentPageSource,
    /onEnrollmentDateBlur=\{[\s\S]*?checkDateImpact/,
  );
});
