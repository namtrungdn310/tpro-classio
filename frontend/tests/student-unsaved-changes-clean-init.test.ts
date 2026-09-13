import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const studentPage = readFileSync(
  join(process.cwd(), "src/app/(dashboard)/students/page.tsx"),
  "utf8",
);

test("student dialog clean initialization and unsaved changes invariants", () => {
  // 1. StudentWorkspaceDialog has key to cleanly reset state on student switch
  assert.match(
    studentPage,
    /<StudentWorkspaceDialog[\s\S]*?key=\{workspaceStudent\.id\}[\s\S]*?student=\{workspaceStudent\}/,
  );

  // 2. Initial form values are seeded directly from student data so watch() doesn't start empty
  assert.match(
    studentPage,
    /defaultValues:\s*getStudentInitialFormValues\(student,\s*currentClass\)/,
  );

  // 3. Initial enrollment fees state is seeded immediately with class slot fallback
  assert.match(
    studentPage,
    /useState<EnrollmentFeeValues>\([\s\S]*?getStudentInitialEnrollmentFees\(student,\s*classes\)/,
  );

  // 4. hasEnrollmentFeeChanges compares against initialSlotIds to prevent false dirty state for legacy enrollments
  assert.match(
    studentPage,
    /const\s+initialSlotIds\s*=\s*getEnrollmentInitialSlotIds\(enrollment,\s*classes\);/,
  );
  assert.match(
    studentPage,
    /\[\.\.\.draft\.selected_slot_ids\]\.sort\(\)\.join\("\|"\)\s*!==\s*\[\.\.\.initialSlotIds\]\.sort\(\)\.join\("\|"\)/,
  );

  // 5. Update payload only includes selected_slot_ids when different from initial slots
  assert.match(
    studentPage,
    /const\s+initialSlots\s*=\s*getEnrollmentInitialSlotIds\(enrollment,\s*classes\);/,
  );

  // 6. SessionSelector and hasMissingSessionSelection resolve initial slots when enrollment slots are empty
  assert.match(
    studentPage,
    /selectedSlotIds=\{[\s\S]*?enrollmentFees\[enrollment\.id\]\?\.selected_slot_ids[\s\S]*?getEnrollmentInitialSlotIds\(enrollment,\s*classes\)[\s\S]*?\}/,
  );
});
