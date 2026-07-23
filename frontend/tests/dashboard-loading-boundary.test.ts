import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const dashboardRoot = new URL("../src/app/(dashboard)/", import.meta.url);

test("dashboard overview skeleton is scoped to the overview page", () => {
  assert.equal(
    existsSync(new URL("loading.tsx", dashboardRoot)),
    false,
    "A route-group loading file would flash the overview skeleton on every dashboard route",
  );

  const overviewPage = readFileSync(new URL("page.tsx", dashboardRoot), "utf8");
  assert.match(overviewPage, /<Suspense fallback={<DashboardOverviewSkeleton \/>}>/);
});

test("data-heavy dashboard routes retain their own loading skeleton", () => {
  assert.equal(existsSync(new URL("students/loading.tsx", dashboardRoot)), true);
  assert.equal(existsSync(new URL("classes/loading.tsx", dashboardRoot)), true);
  assert.equal(existsSync(new URL("staff/loading.tsx", dashboardRoot)), true);
});
