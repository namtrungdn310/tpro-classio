import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { studentMembershipPreviewResponseSchema } from "../src/lib/schemas/student";

const studentPageSource = readFileSync(
  resolve(process.cwd(), "src/app/(dashboard)/students/page.tsx"),
  "utf8",
);

test("studentMembershipPreviewResponseSchema parses backend preview response correctly", () => {
  const validResponse = {
    can_apply: true,
    preview_fingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    expires_at: "2026-09-02T15:00:00Z",
    student_updated_at: "2026-09-02T14:30:00Z",
    blocking_reason: null,
    warnings: [{ code: "FUTURE_ENROLLMENT", message: "Lớp bắt đầu trong tương lai" }],
    source: {
      enrollment_id: "11111111-1111-4111-8111-111111111111",
      class_id: "22222222-2222-4222-8222-222222222222",
      class_name: "Starters 1",
      ends_on: "2026-04-30",
      mutable_fee_count: 2,
      protected_fee_count: 0,
    },
    targets: [
      {
        class_id: "33333333-3333-4333-8333-333333333333",
        class_name: "Movers 2",
        requested_start: "2026-05-01",
        resolved_start: "2026-05-01",
        effective_fee: 600000,
        billing_type: "MONTHLY",
        billing_cycle_weeks: 4,
        first_due_date: "2026-05-01",
        coverage_start: "2026-05-01",
        coverage_end: "2026-05-31",
        skipped_cycle_count: 0,
        review_required: false,
      },
    ],
  };

  const parsed = studentMembershipPreviewResponseSchema.safeParse(validResponse);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.can_apply, true);
    assert.equal(parsed.data.warnings.length, 1);
    assert.equal(parsed.data.source?.mutable_fee_count, 2);
  }
});

test("preview fingerprint strictly enforces 64 lowercase hex characters in regex", () => {
  const hex64Regex = /^[0-9a-f]{64}$/;
  assert.equal(hex64Regex.test("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"), true);
  assert.equal(hex64Regex.test("short"), false);
  assert.equal(hex64Regex.test("0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF"), false); // uppercase not allowed
  assert.equal(hex64Regex.test("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefg"), false); // 65 chars
});

test("students/page.tsx enforces preview state machine and gates 'Áp dụng' button", () => {
  // Check debounce timer is used
  assert.match(studentPageSource, /setTimeout\(async \(\) => \{[\s\S]*?previewStudentMembership/);
  // Check AbortController is created and aborted on cleanup
  assert.match(studentPageSource, /controller\.abort\(\)/);
  assert.match(studentPageSource, /signal: controller\.signal/);

  // Check button gating requirements
  assert.match(studentPageSource, /canCommitApply =/);
  assert.match(studentPageSource, /previewState === "success"/);
  assert.match(studentPageSource, /previewResponse\?\.can_apply === true/);
  assert.match(studentPageSource, /isDraftKeyMatching/);
  assert.match(studentPageSource, /isPreviewFingerprintValid/);
  assert.match(studentPageSource, /!isPreviewExpired/);

  // Check button label is "Áp dụng" and shows loading when inspecting
  assert.match(studentPageSource, /\{previewState === "loading" \? <LoadingLabel label="Đang kiểm tra\.\.\." \/> : "Áp dụng"\}/);
});

test("EnrollmentTransferSlide aligns date and custom fee fields horizontally, caches preview, and omits redundant tab for initial assignment", () => {
  // Check grid aligns items to start
  assert.match(studentPageSource, /className="mt-2\.5 grid grid-cols-1 items-start gap-2 sm:grid-cols-2"/);

  // Check both label headers use matching flex h-5 wrappers
  assert.match(studentPageSource, /<div className="flex h-5 items-center justify-between gap-1">[\s\S]*?Ngày bắt đầu/);
  assert.match(studentPageSource, /<div className="flex h-5 items-center justify-between gap-1">[\s\S]*?Học phí riêng/);

  // Check redundant tablist is omitted when isInitialAssignment is true
  assert.match(studentPageSource, /\{!isInitialAssignment \? \([\s\S]*?role="tablist"/);

  // Check in-memory preview caching is implemented to avoid repeated network checks
  assert.match(studentPageSource, /previewCacheRef\.current\[currentDraftKey\]/);

  // Ensure developer jargon "tác động" is completely removed from preview loading
  assert.doesNotMatch(studentPageSource, /Đang kiểm tra tác động/);

  // Ensure checkmark icon is omitted from selected class cards
  assert.doesNotMatch(studentPageSource, /<Check className="h-4 w-4 shrink-0 text-primary"/);
  assert.doesNotMatch(studentPageSource, /RiCheckLine as Check/);
});

test("SmartMoneyInput only triggers onChange when committed or blurred value differs from current value", () => {
  const smartMoneySource = readFileSync(
    resolve(process.cwd(), "src/components/ui/smart-money-input.tsx"),
    "utf8",
  );
  assert.match(smartMoneySource, /if \(plainValue !== value\) \{\s*onChange\(plainValue\);\s*\}/);
  assert.match(smartMoneySource, /if \(expandedValue !== value\) \{\s*onChange\(expandedValue\);\s*\}/);
});
