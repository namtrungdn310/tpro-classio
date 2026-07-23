import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authSource = readFileSync(
  new URL("../src/lib/hooks/useAuth.tsx", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("../src/components/layout/dashboard-shell.tsx", import.meta.url),
  "utf8",
);
const navbarSource = readFileSync(
  new URL("../src/components/layout/navbar.tsx", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);
const otpInputSource = readFileSync(
  new URL("../src/components/ui/otp-input.tsx", import.meta.url),
  "utf8",
);
const authPageSources = [
  "login/page.tsx",
  "register/page.tsx",
  "reset-password/page.tsx",
  "otp/page.tsx",
  "login/totp/page.tsx",
  "onboarding/google/page.tsx",
  "onboarding/totp/page.tsx",
  "onboarding/recovery/page.tsx",
].map((relativePath) => ({
  relativePath,
  source: readFileSync(
    new URL(`../src/app/${relativePath}`, import.meta.url),
    "utf8",
  ),
}));

test("logout hides protected content before credentials and query data are cleared", () => {
  assert.match(authSource, /setIsLoggingOut\(true\);[\s\S]*await queryClient\.cancelQueries\(\);[\s\S]*await logoutRequest\(\)/);
  assert.match(authSource, /window\.location\.replace\("\/login"\)/);
  assert.match(shellSource, /if \(isLoggingOut\) return <DashboardSessionScreen label="Đang đăng xuất"/);
  assert.match(shellSource, /role="status"/);
  assert.doesNotMatch(navbarSource, /router\.push\("\/login"\)/);
});

test("auth surfaces share one restrained depth background and a clean card", () => {
  assert.match(
    globalStyles,
    /background: radial-gradient\(ellipse at 50% 42%, #fff 0%, #f7f9fc 46%, #edf1f6 100%\)/,
  );
  assert.doesNotMatch(globalStyles, /\.auth-screen::before/);
  assert.doesNotMatch(globalStyles, /\.auth-screen::after/);
  assert.doesNotMatch(globalStyles, /clip-path/);
  assert.doesNotMatch(globalStyles, /url\("\/logo-mark-bw\.png"\)/);
  assert.match(globalStyles, /min-height: 100vh/);
  assert.match(globalStyles, /min-height: 100dvh/);
  assert.match(globalStyles, /overflow-x: hidden/);
  assert.doesNotMatch(globalStyles, /\n  height: 100dvh/);
  assert.match(globalStyles, /0 14px 32px -14px/);
  assert.match(globalStyles, /0 30px 64px -32px/);
  assert.doesNotMatch(globalStyles, /\.auth-card::before/);
  assert.match(otpInputSource, /minmax\(0, 1fr\)/);
  assert.match(otpInputSource, /clamp\(0\.25rem, 2vw, 0\.5rem\)/);
  assert.doesNotMatch(otpInputSource, /minmax\(0, 2\.75rem\)/);

  for (const { relativePath, source } of authPageSources) {
    assert.match(source, /className="auth-screen/, `${relativePath} must use auth-screen`);
    assert.match(source, /className="auth-card/, `${relativePath} must use auth-card`);
  }
});
