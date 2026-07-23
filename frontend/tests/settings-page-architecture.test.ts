import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../src/app/(dashboard)/settings/page.tsx", import.meta.url),
  "utf8",
);
const accountSource = readFileSync(
  new URL("../src/components/settings/account-settings-section.tsx", import.meta.url),
  "utf8",
);
const securitySource = readFileSync(
  new URL("../src/components/settings/security-settings-section.tsx", import.meta.url),
  "utf8",
);
const cardSource = readFileSync(
  new URL("../src/components/settings/settings-card.tsx", import.meta.url),
  "utf8",
);
const accessSource = readFileSync(
  new URL("../src/components/settings/user-access-panel.tsx", import.meta.url),
  "utf8",
);
const roleSource = readFileSync(
  new URL("../src/components/settings/settings-role.ts", import.meta.url),
  "utf8",
);
const otpInputSource = readFileSync(
  new URL("../src/components/ui/otp-input.tsx", import.meta.url),
  "utf8",
);
const unsavedNoticeSource = readFileSync(
  new URL("../src/components/ui/unsaved-changes-notice.tsx", import.meta.url),
  "utf8",
);
const authApiSource = readFileSync(new URL("../src/lib/api/auth.ts", import.meta.url), "utf8");
const otpPageSource = readFileSync(new URL("../src/app/otp/page.tsx", import.meta.url), "utf8");
const loginPageSource = readFileSync(new URL("../src/app/login/page.tsx", import.meta.url), "utf8");

test("settings page is split into focused responsive sections and reserves access management for owner", () => {
  assert.match(pageSource, /<AccountSettingsSection user=\{user\}/);
  assert.match(pageSource, /<SecuritySettingsSection user=\{user\}/);
  assert.match(pageSource, /const canManageUsers = Boolean\(user\.is_owner\)/);
  assert.match(pageSource, /canManageUsers \? \(/);
  assert.match(pageSource, /overflow-x-hidden/);
  assert.match(pageSource, /min-\[1360px\]:h-full/);
  assert.match(pageSource, /min-\[1360px\]:overflow-hidden/);
  assert.match(pageSource, /minmax\(470px,500px\)/);
  assert.doesNotMatch(pageSource, /deleteUser|Xoá tài khoản|isAdmin/);
  assert.match(cardSource, /min-w-0 shrink-0 overflow-hidden/);
  assert.doesNotMatch(cardSource, /shadow-\[0_8px_28px/);
  assert.doesNotMatch(cardSource, /description\??:|\{description\}/);
});

test("account settings use shared typography, accessible labels, loading feedback and refresh user cache", () => {
  assert.match(accountSource, /SettingsField/);
  assert.match(accountSource, /formTextControlClassName/);
  assert.doesNotMatch(cardSource, /settingsInputClassName|settingsErrorInputClassName|@deprecated/);
  assert.match(accountSource, /<SaveButton/);
  assert.doesNotMatch(accountSource, /h-8 w-auto rounded-md/);
  assert.doesNotMatch(accountSource, /min-w-\[68px\]/);
  assert.match(accountSource, /isSaving=\{isSubmitting\}/);
  assert.match(accountSource, /invalidateQueries\(\{ queryKey: authQueryKeys\.users \}\)/);
  assert.match(accountSource, /getSettingsRoleLabel/);
  assert.match(accountSource, /<UnsavedChangesNotice/);
  assert.match(accountSource, /hasUsernameValidationError/);
  assert.match(accountSource, /const hasExceededUsernameLength = usernameValue\.trim\(\)\.length > 20/);
  assert.match(
    accountSource,
    /hasExceededUsernameLength \|\| shouldShowFieldError\(usernameFeedback, isSubmitted\)/,
  );
  assert.match(accountSource, /variant="inline"/);
  assert.match(accountSource, /errorId="settings-username-error"[\s\S]*action=\{/);
  assert.doesNotMatch(accountSource, /min-h-\[52px\]/);
  assert.match(accountSource, /user\.avatar_url/);
  assert.doesNotMatch(accountSource, /role\.description|Thông tin đã được cập nhật/);
  assert.match(accountSource, /fieldFeedbackAfterInput/);
  assert.match(accountSource, /fieldFeedbackAfterBlur/);
  assert.match(
    accountSource,
    /const hasUsernameChanges = usernameValue\.trim\(\) !== initialUsername\.trim\(\)/,
  );
  assert.match(accountSource, /disabled=\{!hasUsernameChanges\}/);
  assert.doesNotMatch(accountSource, /Thông tin nhận diện và phạm vi quyền/);
  assert.match(roleSource, /viewer: "Viewer"/);
  assert.doesNotMatch(roleSource, /description:/);
});

test("password change uses dedicated reauthentication and server OTP lifetime with guarded submissions", () => {
  assert.match(authApiSource, /post<\{ message: string \}>\("\/auth\/me\/password\/verify"/);
  assert.doesNotMatch(securitySource, /\blogin\(/);
  assert.match(securitySource, /response\.otp_expires_in_seconds/);
  assert.match(securitySource, /REAUTH_VALIDITY_MS = 5 \* 60 \* 1000/);
  assert.match(securitySource, /isSendingOtp/);
  assert.match(securitySource, /await requestEmailOtp\(false\)/);
  assert.match(securitySource, /requestEmailOtp\(otpSent\)/);
  assert.match(securitySource, /<PasswordInput/);
  assert.match(securitySource, /\{isVerified \? \(/);
  assert.match(securitySource, /<fieldset disabled=\{isSubmitting\}/);
  assert.match(securitySource, /min-\[1360px\]:flex-1 min-\[1360px\]:shrink/);
  assert.match(securitySource, /className="settings-reveal min-\[1360px\]:flex/);
  assert.match(securitySource, /className="mt-auto border-t border-gray-200/);
  assert.doesNotMatch(
    securitySource,
    /className="mt-auto border-t border-gray-200 bg-gray-50\/70/,
  );
  assert.doesNotMatch(securitySource, /divide-y divide-gray-100/);
  assert.match(securitySource, /<div className="border-t border-gray-100">/);
  assert.doesNotMatch(securitySource, /disabled:opacity-50/);
  assert.match(securitySource, /Đổi mật khẩu sẽ đăng xuất các phiên đang hoạt động/);
  assert.match(securitySource, /LoadingLabel label="Đang cập nhật"/);
  assert.match(securitySource, /label="Mã OTP email"/);
  assert.match(securitySource, /actionClassName="h-11"/);
  assert.match(securitySource, /layout="compact"/);
  assert.match(securitySource, /groupLabel="Mã OTP email gồm 6 chữ số"/);
  assert.match(securitySource, /const value = event\.currentTarget\.value;/);
  assert.match(securitySource, /handleSubmit\(changePassword, restoreSubmitErrors\)/);
  assert.match(securitySource, /otpSent && \(!otpExpired \|\| !otpError\)/);
  assert.doesNotMatch(securitySource, /Đổi mật khẩu bằng hai bước/);
  assert.match(otpInputSource, /forwardRef<HTMLInputElement, OtpInputProps>/);
  assert.match(otpInputSource, /onBlur\?\.\(\)/);
  assert.match(otpInputSource, /max-w-11/);
  assert.match(unsavedNoticeSource, /shouldShowUnsavedChanges/);
  assert.match(unsavedNoticeSource, /hasChanges && !hasErrors && !isSaving/);
});

test("user access panel cannot bypass onboarding when an account is still pending", () => {
  assert.match(authApiSource, /account_status: AccountStatus/);
  assert.match(authApiSource, /userAccountsSchema\.parse\(data\)/);
  assert.match(authApiSource, /`\/auth\/users\/\$\{userId\}\/status`/);
  assert.match(accessSource, /status === "pending"/);
  assert.match(accessSource, /Chưa hoàn tất/);
  assert.match(accessSource, /kind: "role"; nextRole: UserRole/);
  assert.match(accessSource, /"disable" \| "reactivate"/);
  assert.doesNotMatch(accessSource, /kind === "approve"|"Phê duyệt"/);
  assert.match(accessSource, /<ConfirmationDialog/);
  assert.match(accessSource, /getAccountStatus\(account\) !== "active"/);
  assert.match(accessSource, /Các phiên đăng nhập hiện tại sẽ bị thu hồi/);
  assert.match(accessSource, /role="status"/);
  assert.match(accessSource, /motion-reduce:animate-none/);
  assert.match(accessSource, /pendingById/);
  assert.match(accessSource, /className="ml-auto flex items-center gap-2"/);
  assert.match(accessSource, /<DataSectionError/);
  assert.match(accessSource, /refetchOnWindowFocus: "always"/);
  assert.match(accessSource, /refetchInterval: 30_000/);
  assert.match(accessSource, /refetchIntervalInBackground: false/);
  assert.match(accessSource, /<ColumnHeader align="center">Thao tác<\/ColumnHeader>/);
  assert.match(accessSource, /align === "center" \? "text-center" : "text-left"/);
  assert.doesNotMatch(accessSource, /Phê duyệt tài khoản và quản lý phạm vi truy cập/);
  assert.doesNotMatch(accessSource, /quyền Viewer hiện tại/);
  assert.doesNotMatch(accessSource, /deleteUser|Trash2|overflow-x-auto/);
  assert.doesNotMatch(accessSource, /account_status \?\? "active"/);
});

test("invitation email validation follows the shared submit and correction lifecycle", () => {
  assert.match(accessSource, /fieldFeedbackAfterInput/);
  assert.match(accessSource, /fieldFeedbackAfterBlur/);
  assert.match(accessSource, /fieldFeedbackAfterSubmit/);
  assert.match(accessSource, /formTextControlErrorClassName/);
  assert.match(
    accessSource,
    /aria-describedby=\{inviteError \? "invite-email-error" : undefined\}/,
  );
  assert.match(accessSource, /id="invite-email-error" role="alert"/);
  assert.match(accessSource, /type="submit"[\s\S]*?disabled=\{isInviting\}/);
  assert.match(accessSource, /<Button[\s\S]*?variant="outline"[\s\S]*?>[\s\S]*?Huỷ/);
  assert.match(accessSource, /<Button[\s\S]*?type="submit"[\s\S]*?Tạo lời mời/);
  assert.doesNotMatch(accessSource, /className="flex-1 rounded-lg/);
  assert.doesNotMatch(accessSource, /disabled=\{!inviteEmailIsValid/);
});

test("registration verification enters mandatory Google and TOTP onboarding", () => {
  assert.match(otpPageSource, /router\.replace\("\/onboarding\/google"\)/);
  assert.doesNotMatch(otpPageSource, /\/login\?registration=pending/);
  assert.doesNotMatch(loginPageSource, /Tài khoản đang chờ tài khoản Dev phê duyệt/);
});
