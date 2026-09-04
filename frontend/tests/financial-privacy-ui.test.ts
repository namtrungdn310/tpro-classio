import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const providerSource = readFileSync(
  new URL("../src/components/providers/financial-privacy-provider.tsx", import.meta.url),
  "utf8",
);
const amountSource = readFileSync(
  new URL("../src/components/ui/financial-amount.tsx", import.meta.url),
  "utf8",
);
const dashboardCardSource = readFileSync(
  new URL("../src/components/dashboard/dashboard-fee-summary.tsx", import.meta.url),
  "utf8",
);
const dashboardClientSource = readFileSync(
  new URL("../src/app/(dashboard)/dashboard-client.tsx", import.meta.url),
  "utf8",
);
const navbarSource = readFileSync(
  new URL("../src/components/layout/navbar.tsx", import.meta.url),
  "utf8",
);

test("financial privacy is a per-user client preference for management users only", () => {
  assert.match(providerSource, /isManagementUser\(user\)/);
  assert.match(providerSource, /getFinancialPrivacyStorageKey\(user\.id\)/);
  assert.match(providerSource, /window\.localStorage\.setItem/);
  assert.match(dashboardCardSource, /<FinancialPrivacyToggle \/>/);
  assert.match(dashboardCardSource, /isFinancialPrivacyHidden/);
  assert.doesNotMatch(
    readFileSync(new URL("../src/components/layout/financial-privacy-toggle.tsx", import.meta.url), "utf8"),
    /<span className="hidden lg:inline">/,
  );
  assert.match(
    dashboardClientSource,
    /<FinancialPrivacyProvider>[\s\S]*<DashboardFeeSummaryCard[\s\S]*<\/FinancialPrivacyProvider>/,
  );
  assert.doesNotMatch(navbarSource, /FinancialPrivacyToggle/);
  assert.match(providerSource, /storedHidden === true/);
});

test("masked financial values do not expose their amount through a title attribute", () => {
  assert.match(amountSource, /aria-label=\{isMasked \? "Số tiền đang được ẩn" : undefined\}/);
  assert.match(amountSource, /title=\{isMasked \? undefined : displayValue\}/);
  assert.match(amountSource, /FINANCIAL_AMOUNT_MASK/);
});

test("dashboard paid count keeps its text label visible while masking only the count", () => {
  assert.match(dashboardCardSource, /FINANCIAL_AMOUNT_MASK/);
  assert.match(dashboardCardSource, /khoản đã nộp/);
  assert.match(
    dashboardCardSource,
    /isFinancialPrivacyHidden[\s\S]*\? FINANCIAL_AMOUNT_MASK[\s\S]*:\s*`\$\{fees\.paid_record_count\} \/ \$\{fees\.record_count\}`/,
  );
});
