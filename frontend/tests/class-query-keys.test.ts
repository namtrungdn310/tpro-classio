import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { extname, relative } from "node:path";
import test from "node:test";
import { classQueryKeys } from "../src/lib/classes/query-keys";

const sourceRoot = new URL("../src/", import.meta.url);

function getTsxFiles(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return getTsxFiles(entryUrl);
    return extname(entry.name) === ".tsx" || extname(entry.name) === ".ts" ? [entryUrl] : [];
  });
}

const sourceFiles = getTsxFiles(sourceRoot).map((url) => ({
  name: relative(new URL("..", sourceRoot).pathname, url.pathname).replaceAll("\\", "/"),
  source: readFileSync(url, "utf8"),
}));

test("canonical class query keys cover list, detail, history, occurrences, adjustments, exception and availability", () => {
  const summaryKey = classQueryKeys.summary("2026-09-01");
  const listKey = classQueryKeys.list("operational", "2026-09-01");
  const detailKey = classQueryKeys.detail("c-1");
  const historyKey = classQueryKeys.history("c-1");
  const occurrenceKey = classQueryKeys.occurrences("c-1", { from: "2026-09-01", to: "2026-09-07" });
  const adjustmentKey = classQueryKeys.adjustments("c-1", {});
  const exceptionKey = classQueryKeys.exception("e-1");
  const availabilityKey = classQueryKeys.availability({
    classId: "c-1",
    startDate: "2026-09-01",
    endDate: "2026-09-07",
    teacherIds: ["b", "a"],
    assistantIds: [],
  });
  const reversedAvailabilityKey = classQueryKeys.availability({
    classId: "c-1",
    startDate: "2026-09-01",
    endDate: "2026-09-07",
    teacherIds: ["a", "b"],
    assistantIds: [],
  });

  assert.deepEqual(summaryKey, ["classes", "summary", "2026-09-01"]);
  assert.deepEqual(listKey, ["classes", { scope: "operational", dateKey: "2026-09-01" }]);
  assert.deepEqual(detailKey, ["classes", "detail", "c-1"]);
  assert.deepEqual(historyKey, ["classes", "history", "c-1"]);
  assert.deepEqual(occurrenceKey, ["classes", "occurrences", "c-1", { from: "2026-09-01", to: "2026-09-07" }]);
  assert.deepEqual(adjustmentKey, ["classes", "adjustments", "c-1", {}]);
  assert.deepEqual(exceptionKey, ["classes", "exception", "e-1"]);
  // Teacher ordering không làm đổi key (sort deterministic).
  assert.deepEqual(availabilityKey, reversedAvailabilityKey);
});

test("all class query keys originate from the canonical module — no literal duplicate arrays", () => {
  const literalPattern = /\[\s*"classes"\s*,/g;
  for (const file of sourceFiles) {
    if (file.name.endsWith("lib/classes/query-keys.ts")) {
      continue;
    }
    for (const match of file.source.matchAll(literalPattern)) {
      const lineStart = file.source.lastIndexOf("\n", match.index) + 1;
      const line = file.source.slice(lineStart, file.source.indexOf("\n", lineStart));
      assert.ok(
        /classQueryKeys\./.test(file.source.slice(Math.max(0, match.index - 120), match.index)),
        `${file.name} has a literal class query array: ${line.trim()}`,
      );
    }
  }
});

test("class list mutations use the targeted invalidation matrix, never a blanket fees/students wipe", () => {
  const pageSource = readFileSync(
    new URL("../src/app/(dashboard)/classes/page.tsx", import.meta.url),
    "utf8",
  );
  const invalidationSource = readFileSync(
    new URL("../src/lib/query/invalidation.ts", import.meta.url),
    "utf8",
  );
  assert.match(pageSource, /invalidateClassScopeData/);
  assert.match(
    pageSource,
    /invalidateDomainQueries\(queryClient, \{ classes: true, dashboard: true \}\)/,
  );
  assert.doesNotMatch(pageSource, /invalidateQueries\(\{ queryKey: \["students"\] \}\)/);
  assert.doesNotMatch(pageSource, /invalidateQueries\(\{ queryKey: \["fees"\] \}\)/);
  assert.doesNotMatch(pageSource, /refreshDependencies/);
  // Invalidation vẫn chạm dashboard + toàn bộ class scopes (qua helper).
  assert.match(invalidationSource, /classQueryKeys\.all/);
  assert.match(invalidationSource, /\[\"dashboard\"\]/);
});
