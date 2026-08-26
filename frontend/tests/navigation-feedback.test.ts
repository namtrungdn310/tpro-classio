import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const tabNav = source("../src/components/layout/tab-nav.tsx");
const bottomNav = source("../src/components/layout/bottom-nav.tsx");
const navbar = source("../src/components/layout/navbar.tsx");
const navigationFeedback = source(
  "../src/lib/hooks/useOptimisticNavigation.ts",
);
const globalStyles = source("../src/app/globals.css");
const bankingLoading = source(
  "../src/app/(dashboard)/banking/loading.tsx",
);

test("primary navigation gives immediate optimistic selection feedback", () => {
  for (const navigation of [tabNav, bottomNav]) {
    assert.match(navigation, /useOptimisticNavigation\(pathname\)/);
    assert.match(navigation, /showNavigationIntent\(href\)/);
    assert.match(navigation, /isActive\(optimisticPathname, tab\.href\)/);
  }
  assert.match(navigationFeedback, /NAVIGATION_FEEDBACK_TIMEOUT_MS = 4_000/);
});

test("settings and banking use App Router prefetch and loading boundaries", () => {
  assert.match(navbar, /<Link[\s\S]*href="\/settings"/);
  assert.doesNotMatch(navbar, /router\.push\("\/settings"\)/);
  assert.match(bankingLoading, /aria-busy="true"/);
});

test("route entrance remains subtle and fast", () => {
  assert.match(globalStyles, /\.page-enter\s*\{[\s\S]*140ms/);
  assert.doesNotMatch(globalStyles, /\.page-enter\s*\{[\s\S]*220ms/);
});
