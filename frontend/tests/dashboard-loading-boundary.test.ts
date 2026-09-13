import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const dashboardRoot = new URL("../src/app/(dashboard)/", import.meta.url);
const queryProvider = readFileSync(
  new URL("../src/lib/providers/query-provider.tsx", import.meta.url),
  "utf8",
);
const routePrefetch = readFileSync(
  new URL("../src/lib/query-prefetch.ts", import.meta.url),
  "utf8",
);

test("dashboard overview skeleton is scoped to the overview page", () => {
  assert.equal(
    existsSync(new URL("loading.tsx", dashboardRoot)),
    false,
    "A route-group loading file would flash the overview skeleton on every dashboard route",
  );

  const overviewPage = readFileSync(new URL("page.tsx", dashboardRoot), "utf8");
  assert.match(overviewPage, /return <DashboardClient \/>/);
  assert.doesNotMatch(overviewPage, /Suspense|prefetchDashboardQueries|cache: "no-store"/);

  const overviewClient = readFileSync(new URL("dashboard-client.tsx", dashboardRoot), "utf8");
  assert.match(
    overviewClient,
    /!hasSettledOverview \|\| !hasSettledClasses \|\| !hasSettledOccurrences/,
    "The first visit must keep one coherent skeleton until all dashboard sections settle",
  );
});

test("data-heavy dashboard routes retain their own loading skeleton", () => {
  assert.equal(existsSync(new URL("students/loading.tsx", dashboardRoot)), true);
  assert.equal(existsSync(new URL("classes/loading.tsx", dashboardRoot)), true);
  assert.equal(existsSync(new URL("staff/loading.tsx", dashboardRoot)), true);
});

test("dashboard revisits render cached data immediately and refresh stale data in background", () => {
  assert.match(queryProvider, /refetchOnMount: false/);
  assert.match(
    queryProvider,
    /setQueryDefaults\(\["dashboard"\], \{\s*staleTime: 60 \* 1000,\s*gcTime: 15 \* 60 \* 1000,/,
  );
  assert.match(routePrefetch, /dashboard: 60 \* 1000/);
  assert.match(routePrefetch, /case "\/"[\s\S]*prefetchIfStale/);

  const overviewClient = readFileSync(new URL("dashboard-client.tsx", dashboardRoot), "utf8");
  assert.doesNotMatch(
    overviewClient,
    /const isInitialLoading\s*=\s*[^;]*isFetching/,
    "A background refresh must not replace cached dashboard content with the initial skeleton",
  );
  assert.match(overviewClient, /overviewQuery\.refetch\(\)/);
  assert.match(overviewClient, /classesQuery\.refetch\(\)/);
  assert.match(overviewClient, /occurrencesQuery\.refetch\(\)/);
});
