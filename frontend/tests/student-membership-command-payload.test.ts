import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const studentPageSource = readFileSync(
  resolve(process.cwd(), "src/app/(dashboard)/students/page.tsx"),
  "utf8",
);

test("transfer and supplement modes both preserve multiple selected target classes", () => {
  assert.match(
    studentPageSource,
    /setDraftTransferTargetClassIds\(\(current\) =>\s*current\.includes\(classId\) \? current : \[\.\.\.current, classId\]/,
  );
  assert.match(
    studentPageSource,
    /setDraftTargetEnrollmentConfigs\(\(current\) => \(\{\s*\.\.\.current,\s*\[classId\]: current\[classId\] \?\? newConfig/,
  );
  assert.doesNotMatch(studentPageSource, /setDraftTransferTargetClassIds\(\[classId\]\)/);
  assert.doesNotMatch(studentPageSource, /draftTransferTargetClassIds\.length > 1/);
});

test("students/page.tsx sends contract_version 3 for targets/date changes and expected_preview_fingerprint", () => {
  assert.match(studentPageSource, /contract_version: contractVersion/);
  assert.match(studentPageSource, /expected_preview_fingerprint: enrollmentActionPlan\.previewMeta\?\.previewFingerprint \?\? null/);
  assert.match(studentPageSource, /collect_source_final_cycle:/);
});

test("transfer preview exposes one compact final-cycle decision without duplicate guidance", () => {
  assert.match(studentPageSource, /Xem trước đổi lớp/);
  assert.match(studentPageSource, /Xử lý kỳ học phí cuối/);
  assert.match(studentPageSource, /Thu kỳ cuối/);
  assert.match(studentPageSource, /Không thu kỳ cuối/);
  assert.match(studentPageSource, /name="source-final-cycle-policy"/);
  assert.doesNotMatch(studentPageSource, /Cập nhật \{previewResponse\.source\.mutable_fee_count\} khoản phí/);
  assert.doesNotMatch(studentPageSource, /Học viên sẽ rời lớp hiện tại từ ngày bắt đầu sớm nhất/);
});

test("students/page.tsx maintains stable request_id across retries with identical payload", () => {
  assert.match(studentPageSource, /const submitRequestIdRef = useRef<string \| null>\(null\)/);
  assert.match(studentPageSource, /const lastSubmittedPayloadHashRef = useRef<string \| null>\(null\)/);
  assert.match(
    studentPageSource,
    /if \(!submitRequestIdRef\.current \|\| lastSubmittedPayloadHashRef\.current !== payloadHash\) \{\s*submitRequestIdRef\.current = crypto\.randomUUID\(\);\s*lastSubmittedPayloadHashRef\.current = payloadHash;\s*\}/,
  );
});

test("historical slot pruning informs the user with a gentle notice", () => {
  assert.match(
    studentPageSource,
    /Lịch học đã được cập nhật theo ngày bắt đầu\./,
  );
});

test("parent form submission re-previews if preview expired or draft mismatched", () => {
  assert.match(studentPageSource, /const isExpired = previewMeta\?\.previewExpiresAt/);
  assert.match(studentPageSource, /const isMismatched = previewMeta\?\.previewDraftKey !== currentDraftKey/);
  assert.match(
    studentPageSource,
    /if \(!previewMeta \|\| isExpired \|\| isMismatched\) \{\s*try \{\s*const freshPreview = await previewStudentMembership/,
  );
});
