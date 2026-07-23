import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { passwordSchema } from "../src/lib/auth/password";

function read(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const loginSource = read("src/app/login/page.tsx");
const registerSource = read("src/app/register/page.tsx");
const resetSource = read("src/app/reset-password/page.tsx");
const otpSource = read("src/app/otp/page.tsx");
const accountSource = read("src/components/settings/account-settings-section.tsx");
const securitySource = read("src/components/settings/security-settings-section.tsx");
const accessSource = read("src/components/settings/user-access-panel.tsx");
const loginTotpSource = read("src/app/login/totp/page.tsx");
const onboardingTotpSource = read("src/app/onboarding/totp/page.tsx");

test("auth fields validate on blur first and update live while correcting", () => {
  for (const source of [loginSource, registerSource, resetSource, otpSource]) {
    assert.match(source, /mode: "onBlur"/);
    assert.match(source, /reValidateMode: "onChange"/);
  }

  assert.doesNotMatch(registerSource, /onFocus=\{\(\) => setError\(""\)\}/);
  assert.doesNotMatch(resetSource, /onFocus=\{\(\) => setError\(""\)\}/);
  assert.doesNotMatch(otpSource, /onFocus=\{\(\) => setError\(""\)\}/);
});

test("valid submissions restore feedback before an API can return a field error", () => {
  assert.match(registerSource, /async function onSubmit[\s\S]*?restoreSubmitErrors\(\);[\s\S]*?await registerAccount/);
  assert.match(accountSource, /async function submit[\s\S]*?setUsernameFeedback\(fieldFeedbackAfterSubmit\);[\s\S]*?await updateMyUsername/);
  assert.match(securitySource, /async function changePassword[\s\S]*?restoreSubmitErrors\(\);[\s\S]*?await verifyPasswordResetOtp/);
});

test("registration keeps dependent confirmation validation current", () => {
  assert.match(registerSource, /if \(getValues\("confirmPassword"\)\) \{[\s\S]*?trigger\("confirmPassword"\)/);
});

test("login session and credential errors are form alerts, not password field errors", () => {
  assert.match(loginSource, /const visibleFormError = emailError \|\| passwordValidationError \? "" : error/);
  assert.match(loginSource, /<AuthField id="login-password" label="Mật khẩu" error=\{passwordValidationError\}>/);
  assert.match(loginSource, /\{visibleFormError \? \([\s\S]*?role="alert"/);
});

test("OTP controller exposes focus and blur semantics and never duplicates expiry feedback", () => {
  assert.match(otpSource, /<OtpInput[\s\S]*?ref=\{field\.ref\}[\s\S]*?id="otp-code"/);
  assert.match(otpSource, /onBlur=\{field\.onBlur\}/);
  assert.match(otpSource, /htmlFor="otp-code"[\s\S]*?Mã OTP email/);
  assert.match(otpSource, /groupLabel="Mã OTP email gồm 6 chữ số"/);
  for (const source of [otpSource, loginTotpSource, onboardingTotpSource]) {
    assert.match(source, /layout="auth"/);
  }
  assert.match(otpSource, /const visibleOtpError = otpExpired \? undefined : otpError/);
  assert.match(otpSource, /\{visibleOtpError \? \(/);
});

test("invitation distinguishes a missing email from an invalid email", () => {
  assert.match(accessSource, /\.min\(1, validationMessages\.required\("email"\)\)/);
  assert.match(accessSource, /\.email\(validationMessages\.emailFormat\)/);
});

test("invite-only registration dead end keeps the shared login action link", () => {
  assert.match(registerSource, /import Link from "next\/link"/);
  assert.match(registerSource, /<Link href="\/login" className="auth-action-link mt-5 block text-center">/);
  assert.match(registerSource, /Quay lại đăng nhập/);
});

test("empty password fields use a required message before strength rules", () => {
  const result = passwordSchema.safeParse("");
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.issues[0]?.message, "Vui lòng nhập mật khẩu.");
  }
  assert.match(loginSource, /\.min\(1, validationMessages\.required\("mật khẩu"\)\)/);
});
