import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboardShellSource = readFileSync(
  new URL("../src/components/layout/dashboard-shell.tsx", import.meta.url),
  "utf8",
);
const dashboardSidebarSource = readFileSync(
  new URL("../src/components/layout/dashboard-sidebar.tsx", import.meta.url),
  "utf8",
);
const formTextControlSource = readFileSync(
  new URL("../src/components/ui/form-text-control.ts", import.meta.url),
  "utf8",
);

test("dashboard sidebar and header chrome block ambient text selection", () => {
  assert.match(
    dashboardShellSource,
    /<header className="dashboard-header[^"]*\bselect-none\b/,
  );
  assert.match(
    dashboardSidebarSource,
    /className="dashboard-sidebar[^"]*\bselect-none\b/,
  );
  assert.match(
    dashboardShellSource,
    /<BottomNav \/>/,
  );
});

test("header search inputs remain editable and selectable", () => {
  assert.match(
    formTextControlSource,
    /formTextControlClassName[\s\S]*\bselect-text\b/,
  );
});
