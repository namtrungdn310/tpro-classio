import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("entity creation dialogs share the edit-class desktop frame size", () => {
  const shell = read("src/components/ui/form-dialog-shell.tsx");
  const classForm = read("src/components/classes/class-form-dialog.tsx");
  const studentForm = read("src/app/(dashboard)/students/page.tsx");
  const staffForm = read("src/components/staff/staff-form-dialog.tsx");

  assert.match(shell, /standard:\s*"sm:max-w-\[640px\]"/);
  assert.match(
    shell,
    /createEntityDialogFrameClassName\s*=\s*\n?\s*"sm:h-\[min\(680px,calc\(100dvh-2rem\)\)\]"/,
  );

  assert.match(classForm, /width=\{class_ \? "lg" : "standard"\}/);
  assert.match(classForm, /className: class_ \? undefined : createEntityDialogFrameClassName/);
  assert.match(studentForm, /width=\{student \? "lg" : "standard"\}/);
  assert.match(studentForm, /className: student \? undefined : createEntityDialogFrameClassName/);
  assert.match(staffForm, /width=\{staff \? "md" : "standard"\}/);
  assert.match(staffForm, /className: staff \? undefined : createEntityDialogFrameClassName/);
});
