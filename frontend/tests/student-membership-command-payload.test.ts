import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const studentPageSource = readFileSync(
  resolve(process.cwd(), "src/app/(dashboard)/students/page.tsx"),
  "utf8",
);

test("transfer mode enforces exactly one target class and mode switch prunes to one class", () => {
  // Check onAddClass replaces class when in transfer mode
  assert.match(
    studentPageSource,
    /if \(draftEnrollmentActionMode === "transfer"\) \{\s*setDraftTransferTargetClassIds\(\[classId\]\)/,
  );

  // Check onModeChange prunes to first class when switching to transfer mode
  assert.match(
    studentPageSource,
    /if \(mode === "transfer" && draftTransferTargetClassIds\.length > 1\) \{\s*const firstClassId = draftTransferTargetClassIds\[0\];/,
  );
});

test("students/page.tsx sends contract_version 3 for targets/date changes and expected_preview_fingerprint", () => {
  assert.match(studentPageSource, /contract_version: contractVersion/);
  assert.match(studentPageSource, /expected_preview_fingerprint: enrollmentActionPlan\.previewMeta\?\.previewFingerprint \?\? null/);
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
