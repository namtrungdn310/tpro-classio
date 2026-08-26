import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const workspaceSources = [
  source("../src/components/students/student-workspace-dialog.tsx"),
  source("../src/components/classes/class-workspace-dialog.tsx"),
  source("../src/components/staff/staff-workspace-dialog.tsx"),
  source("../src/components/fees/fees-table.tsx"),
];
const studentWorkspaceSource = workspaceSources[0];

test("desktop action rails share the same readable type and interaction rhythm", () => {
  for (const workspaceSource of workspaceSources) {
    assert.match(
      workspaceSource,
      /h-11 min-h-11 w-full[^"\n]*cursor-pointer[^"\n]*text-\[14px\][^"\n]*font-semibold leading-5/,
    );
    assert.match(workspaceSource, /focus-visible:ring-primary\/40/);
  }
});

test("mobile action rails remain compact without clipping available actions", () => {
  for (const workspaceSource of workspaceSources) {
    assert.match(
      workspaceSource,
      /scrollbar-hidden flex shrink-0 items-center gap-1\.5 overflow-x-auto/,
    );
    assert.match(workspaceSource, /h-9 shrink-0 cursor-pointer[^"\n]*text-\[13px\] font-semibold leading-4/);
  }
});

test("action rails keep semantic colors and never use low-contrast body text", () => {
  for (const workspaceSource of workspaceSources) {
    assert.match(workspaceSource, /text-gray-600 hover:bg-primary-soft\/70 hover:text-primary/);
    assert.doesNotMatch(workspaceSource, /text-gray-[34]00 hover:bg-primary-soft/);
  }
});

test("student action rail yields to nested transfer and date overlays", () => {
  assert.match(
    studentWorkspaceSource,
    /!nestedOverlayOpen && !confirmDiscardOpen[\s\S]*workspace-action-rail-in/,
  );
  assert.match(studentWorkspaceSource, /onNestedOverlayChange: setNestedOverlayOpen/);
});
