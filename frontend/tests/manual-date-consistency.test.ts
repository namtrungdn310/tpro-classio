import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

test("all editable calendar dates use the shared manual control", () => {
  const files = sourceFiles(resolve("src"));
  const source = files.map((file) => readFileSync(file, "utf8")).join("\n");

  assert.doesNotMatch(source, /DatePickerSlide|date-picker-slide/);
  assert.doesNotMatch(source, /type\s*=\s*["']date["']/);

  const expectedConsumers = [
    "components/classes/class-form-dialog.tsx",
    "components/classes/class-makeup-workspace.tsx",
    "components/staff/staff-payroll-dialog.tsx",
    "app/(dashboard)/students/page.tsx",
  ];
  for (const relativePath of expectedConsumers) {
    assert.match(
      readFileSync(resolve("src", relativePath), "utf8"),
      /ManualDateInput/,
      `Missing the shared date control in ${relativePath}`,
    );
  }
});
