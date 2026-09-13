import assert from "node:assert/strict";
import test from "node:test";
import { studentQueryKeys } from "../src/lib/students/query-keys";

test("student list keys normalize equivalent filters", () => {
  const first = studentQueryKeys.list({
    class_id: "class-1",
    status: "active",
    search: "  TP000000001  ",
  });
  const second = studentQueryKeys.list({
    class_id: "class-1",
    status: "active",
    search: "TP000000001",
    limit: 80,
  });

  assert.deepEqual(first, second);
  assert.deepEqual(studentQueryKeys.summary(), ["students", "summary"]);
  assert.deepEqual(studentQueryKeys.detail("student-1"), ["students", "detail", "student-1"]);
});

test("class prefetch can use the exact same key as the visible infinite query", () => {
  const filters = { class_id: "class-1", status: "active" as const, limit: 80 };
  assert.deepEqual(studentQueryKeys.list(filters), studentQueryKeys.list({ ...filters }));
});
