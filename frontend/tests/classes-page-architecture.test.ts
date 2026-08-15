import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../src/app/(dashboard)/classes/page.tsx", import.meta.url),
  "utf8",
);
const workspaceSource = readFileSync(
  new URL("../src/components/classes/class-workspace-dialog.tsx", import.meta.url),
  "utf8",
);
const modalHookSource = readFileSync(
  new URL("../src/lib/hooks/useModalDialog.ts", import.meta.url),
  "utf8",
);

test("row click opens the workspace directly with no intermediate actions dialog", () => {
  assert.match(pageSource, /onRowClick=\{openClassWorkspace\}/);
  assert.doesNotMatch(pageSource, /EntityActionsDialog/);
  assert.doesNotMatch(pageSource, /actionTarget/);
  assert.doesNotMatch(pageSource, /historyTarget/);
  assert.doesNotMatch(pageSource, /deleteTarget/);
});

test("workspace initial mode depends on permissions and scope", () => {
  assert.match(
    pageSource,
    /const canEdit = isAdmin && isOperationalScope && class_\.can_edit === true;/,
  );
  assert.match(pageSource, /mode: canEdit \? "edit" : "history"/);
  assert.match(
    pageSource,
    /showModeRail=\{Boolean\(isAdmin && isOperationalScope && workspace\.class\.can_edit\)\}/,
  );
});

test("workspace rail renders only permitted actions", () => {
  assert.match(workspaceSource, /canCancel=\{Boolean\(class_\.can_cancel\)\}/);
  assert.match(workspaceSource, /role="tablist"/);
  assert.match(workspaceSource, /aria-selected=\{active\}/);
  assert.match(workspaceSource, /aria-controls="class-workspace-panel"/);
  assert.doesNotMatch(workspaceSource, /Trash2|RiDeleteBin/);
  assert.match(workspaceSource, /CloseCircle/);
});

test("workspace action rail is compact and anchored to the centered frame", () => {
  assert.match(
    workspaceSource,
    /workspace-action-rail-in absolute left-full top-0 z-20 ml-3 hidden min-\[900px\]:block/,
  );
  assert.match(
    workspaceSource,
    /flex w-\[144px\].*rounded-xl.*p-2/,
  );
  assert.doesNotMatch(workspaceSource, /function workspaceStatusLabel/);
  assert.doesNotMatch(workspaceSource, /class_\.student_count\} học viên<\/p>/);
  assert.doesNotMatch(workspaceSource, /sm:pr-\[240px\]/);
  assert.doesNotMatch(workspaceSource, /fixed inset-y-0 right-0/);
  assert.doesNotMatch(workspaceSource, /<div className="flex min-w-0 items-stretch gap-2">/);
});

test("workspace frame keeps an explicit height for absolutely stacked mode panels", () => {
  assert.match(
    workspaceSource,
    /sm:h-\[min\(680px,calc\(100dvh-2rem\)\)\].*sm:max-w-\[640px\]/,
  );
  assert.doesNotMatch(
    workspaceSource,
    /sm:h-auto sm:max-h-\[calc\(100dvh-2rem\)\]/,
  );
});

test("workspace uses its internal mode bar until the compact rail fits", () => {
  assert.match(workspaceSource, /className=".*min-\[900px\]:hidden"/);
  assert.match(workspaceSource, /hidden min-\[900px\]:block/);
});

test("workspace keeps the edit form mounted and reports dirty state", () => {
  assert.match(workspaceSource, /onDirtyChange=\{setDirty\}/);
  assert.match(workspaceSource, /onNestedOverlayChange=\{setNestedOverlayOpen\}/);
  assert.match(workspaceSource, /embedded/);
  assert.match(workspaceSource, /dirty=\{item\.mode === "edit" && dirty\}/);
});

test("modal focus scope includes fixed rail controls and excludes hidden panels", () => {
  assert.match(modalHookSource, /function isFocusableVisible/);
  assert.match(modalHookSource, /closest\("\[inert\], \[aria-hidden='true'\]"\)/);
  assert.match(modalHookSource, /getComputedStyle\(element\)/);
  assert.doesNotMatch(modalHookSource, /element\.offsetParent !== null/);
});

test("workspace guards close with an unsaved-changes confirmation", () => {
  assert.match(
    workspaceSource,
    /if \(dirty && !isSaving && !isDeleting\) \{\s*setConfirmDiscardOpen\(true\);/,
  );
  assert.match(workspaceSource, /<ConfirmationDialog/);
  assert.match(workspaceSource, /confirmLabel="Rời khỏi"/);
});

test("workspace closes only when a complete pointer gesture occurs outside the frame", () => {
  assert.match(
    workspaceSource,
    /backdropPointerDownRef\.current =[\s\S]*event\.target\.dataset\.workspaceDismissSurface === "true"/,
  );
  assert.match(
    workspaceSource,
    /const endedOutside =[\s\S]*event\.target\.dataset\.workspaceDismissSurface === "true"[\s\S]*backdropPointerDownRef\.current && endedOutside[\s\S]*requestShellClose\(\)/,
  );
  assert.match(workspaceSource, /data-workspace-dismiss-surface="true"/);
  assert.match(workspaceSource, /backdropPointerDownRef\.current = false/);
  assert.doesNotMatch(
    workspaceSource,
    /aria-hidden="true"\s+className="absolute inset-0 bg-black\/35"\s+onPointerDown/,
  );
});

test("workspace cancel panel warns about unsaved changes before confirming", () => {
  assert.match(workspaceSource, /Bạn đang có thay đổi chưa lưu\. Các thay đổi này sẽ không được áp dụng nếu hủy lớp\./);
  assert.match(workspaceSource, /onCancelClass/);
  assert.doesNotMatch(workspaceSource, /optimistic/);
});
