import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboardSource = readFileSync(
  new URL("../src/app/(dashboard)/dashboard-client.tsx", import.meta.url),
  "utf8",
);

test("dashboard refresh keeps dots and hides the refresh icon while loading", () => {
  const headerStatusStart = dashboardSource.indexOf("function DashboardHeaderStatus");
  const headerStatusEnd = dashboardSource.indexOf("function OverviewTopSection");
  const headerStatusSource = dashboardSource.slice(headerStatusStart, headerStatusEnd);
  assert.match(headerStatusSource, /<LoadingLabel label=\"Đang tải\" \/>/);
  assert.doesNotMatch(headerStatusSource, /animate-spin/);
  assert.match(headerStatusSource, /!isRefreshing \? \(/);
  assert.match(headerStatusSource, /<RefreshCw \/>/);
});
