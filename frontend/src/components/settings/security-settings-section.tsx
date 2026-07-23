"use client";

import { useEffect, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, ShieldAlert, ShieldCheck } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { useToast } from "@/components/providers/toast-provider";
import {
  SettingsCard,
  SettingsField,
} from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import {
  formTextControlClassName,
  formTextControlErrorClassName,
} from "@/components/ui/form-text-control";
import { LoadingLabel } from "@/components/ui/loading-label";
import { OtpInput } from "@/components/ui/otp-input";
import { PasswordInput } from "@/components/ui/password-input";
import {
  completePasswordReset,
  startPasswordReset,
  verifyMyPassword,
  verifyPasswordResetOtp,
  type UserMe,
} from "@/lib/api/auth";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatOtpRemaining, getOtpRemainingSeconds } from "@/lib/auth/otp-flow";
import { passwordSchema } from "@/lib/auth/password";
import {
  fieldFeedbackAfterBlur,
  fieldFeedbackAfterInput,
  fieldFeedbackAfterSubmit,
  initialFieldFeedback,
  shouldShowFieldError,
  type FieldFeedbackState,
} from "@/lib/auth/field-feedback";
import { noSavedInfoFormProps, savedInfoAutocomplete } from "@/lib/forms/saved-info-policy";
import { validationMessages } from "@/lib/forms/validation-messages";
import { cn } from "@/lib/utils";

const REAUTH_VALIDITY_MS = 5 * 60 * 1000;

const reauthSchema = z.object({
  currentPassword: z.string().min(1, validationMessages.required("mật khẩu hiện tại")),
});

const passwordChangeSchema = z
  .object({
    newPassword: z
      .string()
      .min(1, validationMessages.required("mật khẩu mới"))
      .pipe(passwordSchema),
    confirmPassword: z.string().min(1, validationMessages.required("mật khẩu xác nhận")),
    otp: z.string().regex(/^\d{6}$/, validationMessages.otpFormat),
  })
  .superRefine((values, context) => {
    if (values.newPassword !== values.confirmPassword) {
      context.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: validationMessages.passwordConfirmation,
      });
    }
  });

type ReauthValues = z.infer<typeof reauthSchema>;
type PasswordChangeValues = z.infer<typeof passwordChangeSchema>;
type PasswordChangeFieldName = keyof PasswordChangeValues;

const initialPasswordChangeFeedback: Record<PasswordChangeFieldName, FieldFeedbackState> = {
  newPassword: initialFieldFeedback,
  confirmPassword: initialFieldFeedback,
  otp: initialFieldFeedback,
};

export function SecuritySettingsSection({ user }: { user: UserMe }) {
  const notify = useToast();
  const currentPasswordRef = useRef<HTMLInputElement | null>(null);
  const newPasswordRef = useRef<HTMLInputElement | null>(null);
  const [verifiedUntil, setVerifiedUntil] = useState<number | null>(null);
  const [otpExpiresAt, setOtpExpiresAt] = useState<number | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldFeedback, setFieldFeedback] = useState(initialPasswordChangeFeedback);
  const {
    formState: { errors: reauthErrors, isSubmitting: isVerifying },
    handleSubmit: handleReauthSubmit,
    register: registerReauth,
    reset: resetReauth,
    clearErrors: clearReauthErrors,
    setError: setReauthError,
  } = useForm<ReauthValues>({
    resolver: zodResolver(reauthSchema),
    mode: "onSubmit",
    reValidateMode: "onChange",
    shouldFocusError: true,
    defaultValues: { currentPassword: "" },
  });
  const {
    control,
    formState: { errors, isSubmitted, isSubmitting },
    handleSubmit,
    getValues,
    register,
    reset,
    resetField,
    clearErrors,
    setError,
    trigger,
  } = useForm<PasswordChangeValues>({
    resolver: zodResolver(passwordChangeSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    shouldFocusError: true,
    defaultValues: { newPassword: "", confirmPassword: "", otp: "" },
  });

  const isVerified = verifiedUntil !== null && verifiedUntil > clock;
  const verifiedRemainingSeconds = verifiedUntil
    ? Math.max(0, Math.ceil((verifiedUntil - clock) / 1000))
    : 0;
  const otpRemainingSeconds = otpExpiresAt ? getOtpRemainingSeconds(otpExpiresAt, clock) : 0;
  const otpExpired = otpExpiresAt !== null && otpRemainingSeconds <= 0;
  const otpSent = otpExpiresAt !== null;

  useEffect(() => {
    if (!verifiedUntil && !otpExpiresAt) return;
    setClock(Date.now());
    const timerId = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timerId);
  }, [otpExpiresAt, verifiedUntil]);

  useEffect(() => {
    if (!verifiedUntil) return;
    const timeoutId = window.setTimeout(() => {
      setVerifiedUntil(null);
      setOtpExpiresAt(null);
      setFormError(null);
      reset({ newPassword: "", confirmPassword: "", otp: "" });
      setFieldFeedback(initialPasswordChangeFeedback);
      notify.info("Phiên xác thực đã hết hạn. Hãy kiểm tra lại mật khẩu hiện tại.");
      window.requestAnimationFrame(() => currentPasswordRef.current?.focus());
    }, Math.max(0, verifiedUntil - Date.now()));
    return () => window.clearTimeout(timeoutId);
  }, [notify, reset, verifiedUntil]);

  useEffect(() => {
    if (!isVerified) return;
    window.requestAnimationFrame(() => newPasswordRef.current?.focus());
  }, [isVerified]);

  async function verifyCurrentPassword(values: ReauthValues) {
    setFormError(null);
    try {
      await verifyMyPassword(values.currentPassword);
      resetReauth({ currentPassword: "" });
      setClock(Date.now());
      setVerifiedUntil(Date.now() + REAUTH_VALIDITY_MS);
      setOtpExpiresAt(null);
      reset({ newPassword: "", confirmPassword: "", otp: "" });
      setFieldFeedback(initialPasswordChangeFeedback);
      const otpWasSent = await requestEmailOtp(false);
      if (!otpWasSent) {
        notify.warning("Đã xác thực mật khẩu nhưng chưa thể gửi mã OTP.");
      }
    } catch (error) {
      setReauthError("currentPassword", {
        type: "server",
        message: getApiErrorMessage(
          error,
          "Không thể xác thực mật khẩu hiện tại. Vui lòng thử lại.",
        ),
      });
    }
  }

  async function requestEmailOtp(isResend: boolean) {
    setFormError(null);
    setIsSendingOtp(true);
    try {
      const response = await startPasswordReset(user.email);
      const expiresAt = Date.now() + response.otp_expires_in_seconds * 1000;
      setClock(Date.now());
      setOtpExpiresAt(expiresAt);
      resetField("otp");
      setFieldFeedback((current) => ({
        ...current,
        otp: initialFieldFeedback,
      }));
      notify.success(
        isResend
          ? "Đã gửi lại mã OTP đến email của bạn."
          : "Đã xác thực mật khẩu và gửi mã OTP đến email của bạn.",
      );
      return true;
    } catch (error) {
      setFormError(getApiErrorMessage(error, "Không thể gửi mã OTP. Vui lòng thử lại."));
      return false;
    } finally {
      setIsSendingOtp(false);
    }
  }

  async function sendOtp() {
    if (!isVerified || isSendingOtp) return;
    await requestEmailOtp(otpSent);
  }

  async function changePassword(values: PasswordChangeValues) {
    restoreSubmitErrors();
    setFormError(null);
    if (!isVerified) {
      notify.warning("Phiên xác thực đã hết hạn. Hãy kiểm tra lại mật khẩu hiện tại.");
      return;
    }
    if (!otpExpiresAt || otpExpired) {
      setError("otp", { type: "manual", message: "Mã OTP đã hết hạn. Hãy gửi lại mã mới." });
      return;
    }
    try {
      await verifyPasswordResetOtp(user.email, values.otp);
      await completePasswordReset(values.newPassword);
      window.location.replace("/login?password_reset=success");
    } catch (error) {
      const message = getApiErrorMessage(
        error,
        "Không thể cập nhật mật khẩu. Vui lòng kiểm tra mã OTP và thử lại.",
      );
      if (/otp|mã/i.test(message)) {
        setError("otp", { type: "server", message });
      } else {
        setFormError(message);
      }
    }
  }

  function updateFieldFeedback(
    field: PasswordChangeFieldName,
    update: (current: FieldFeedbackState) => FieldFeedbackState,
  ) {
    setFieldFeedback((current) => ({
      ...current,
      [field]: update(current[field]),
    }));
  }

  function restoreSubmitErrors() {
    setFieldFeedback((current) => ({
      newPassword: fieldFeedbackAfterSubmit(current.newPassword),
      confirmPassword: fieldFeedbackAfterSubmit(current.confirmPassword),
      otp: fieldFeedbackAfterSubmit(current.otp),
    }));
  }

  const currentPasswordError = reauthErrors.currentPassword?.message;
  const newPasswordError =
    errors.newPassword?.message &&
    shouldShowFieldError(fieldFeedback.newPassword, isSubmitted)
      ? errors.newPassword.message
      : undefined;
  const confirmPasswordError =
    errors.confirmPassword?.message &&
    shouldShowFieldError(fieldFeedback.confirmPassword, isSubmitted)
      ? errors.confirmPassword.message
      : undefined;
  const otpError =
    errors.otp?.message && shouldShowFieldError(fieldFeedback.otp, isSubmitted)
      ? errors.otp.message
      : undefined;
  const { ref: currentPasswordFormRef, ...currentPasswordRegistration } =
    registerReauth("currentPassword");
  const { ref: newPasswordFormRef, ...newPasswordRegistration } = register("newPassword");
  const confirmPasswordRegistration = register("confirmPassword");

  return (
    <SettingsCard
      title="Bảo mật tài khoản"
      icon={<ShieldCheck aria-hidden="true" />}
      className="min-[1360px]:flex min-[1360px]:min-h-0 min-[1360px]:flex-1 min-[1360px]:shrink min-[1360px]:flex-col"
    >
      {!isVerified ? (
        <form
          {...noSavedInfoFormProps}
          noValidate
          onSubmit={handleReauthSubmit(verifyCurrentPassword)}
        >
          <SettingsField
            htmlFor="settings-current-password"
            label="Mật khẩu hiện tại"
            error={currentPasswordError}
            errorId="settings-current-password-error"
            action={
              <Button
                type="submit"
                disabled={isVerifying}
                className="h-8 rounded-md bg-gray-950 px-3 text-sm text-white hover:bg-black"
              >
                {isVerifying ? <LoadingLabel label="Đang kiểm tra" /> : "Kiểm tra"}
              </Button>
            }
          >
            <PasswordInput
              {...currentPasswordRegistration}
              ref={(node) => {
                currentPasswordFormRef(node);
                currentPasswordRef.current = node;
              }}
              id="settings-current-password"
              autoComplete={savedInfoAutocomplete.disabled}
              enterKeyHint="done"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onInput={() => {
                clearReauthErrors("currentPassword");
                setFormError(null);
              }}
              aria-invalid={Boolean(currentPasswordError)}
              aria-describedby={
                currentPasswordError ? "settings-current-password-error" : undefined
              }
              className={cn(
                formTextControlClassName,
                currentPasswordError && formTextControlErrorClassName,
              )}
            />
          </SettingsField>
        </form>
      ) : (
        <div
          role="status"
          className="settings-reveal flex shrink-0 items-start gap-2.5 border-b border-emerald-100 bg-emerald-50/70 px-4 py-2.5 text-emerald-800 sm:px-5"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-[13px] font-medium leading-5">
            Đã xác thực. Bạn còn {formatOtpRemaining(verifiedRemainingSeconds)} để hoàn tất thay đổi.
          </p>
        </div>
      )}

      {isVerified ? (
        <form
          {...noSavedInfoFormProps}
          noValidate
          className="settings-reveal min-[1360px]:flex min-[1360px]:min-h-0 min-[1360px]:flex-1 min-[1360px]:flex-col"
          onSubmit={handleSubmit(changePassword, restoreSubmitErrors)}
        >
          <fieldset disabled={isSubmitting}>
            <legend className="sr-only">Đặt mật khẩu mới</legend>
            <div>
              <SettingsField
                className="py-2.5"
                htmlFor="settings-new-password"
                label="Mật khẩu mới"
                error={newPasswordError}
                errorId="settings-new-password-error"
              >
                <PasswordInput
                  {...newPasswordRegistration}
                  ref={(node) => {
                    newPasswordFormRef(node);
                    newPasswordRef.current = node;
                  }}
                  id="settings-new-password"
                  autoComplete={savedInfoAutocomplete.disabled}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    void newPasswordRegistration.onChange(event);
                    setFormError(null);
                    updateFieldFeedback("newPassword", (current) =>
                      fieldFeedbackAfterInput(current, value),
                    );
                    if (getValues("confirmPassword")) {
                      void trigger("confirmPassword");
                    }
                  }}
                  onBlur={(event) => {
                    updateFieldFeedback("newPassword", fieldFeedbackAfterBlur);
                    void newPasswordRegistration.onBlur(event);
                  }}
                  aria-invalid={Boolean(newPasswordError)}
                  aria-describedby={newPasswordError ? "settings-new-password-error" : undefined}
                  className={cn(
                    formTextControlClassName,
                    newPasswordError && formTextControlErrorClassName,
                  )}
                />
              </SettingsField>

              <SettingsField
                className="py-2.5"
                htmlFor="settings-confirm-password"
                label="Xác nhận mật khẩu"
                error={confirmPasswordError}
                errorId="settings-confirm-password-error"
              >
                <PasswordInput
                  {...confirmPasswordRegistration}
                  id="settings-confirm-password"
                  autoComplete={savedInfoAutocomplete.disabled}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    void confirmPasswordRegistration.onChange(event);
                    setFormError(null);
                    updateFieldFeedback("confirmPassword", (current) =>
                      fieldFeedbackAfterInput(current, value),
                    );
                  }}
                  onBlur={(event) => {
                    updateFieldFeedback("confirmPassword", fieldFeedbackAfterBlur);
                    void confirmPasswordRegistration.onBlur(event);
                  }}
                  aria-invalid={Boolean(confirmPasswordError)}
                  aria-describedby={
                    confirmPasswordError ? "settings-confirm-password-error" : undefined
                  }
                  className={cn(
                    formTextControlClassName,
                    confirmPasswordError && formTextControlErrorClassName,
                  )}
                />
              </SettingsField>
            </div>

            <div className="border-t border-gray-100">
              <SettingsField
                className="py-2.5"
                htmlFor="settings-password-otp"
                label="Mã OTP email"
                error={otpError}
                errorId="settings-password-otp-error"
                actionClassName="h-11"
                action={
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSendingOtp}
                    onClick={() => void sendOtp()}
                    className="h-8 rounded-md px-3 text-sm"
                  >
                    {isSendingOtp ? (
                      <LoadingLabel label="Đang gửi" />
                    ) : otpSent ? (
                      "Gửi lại mã"
                    ) : (
                      "Gửi mã"
                    )}
                  </Button>
                }
              >
                <Controller
                  control={control}
                  name="otp"
                  render={({ field }) => (
                    <OtpInput
                      key={otpExpiresAt ?? "otp-empty"}
                      ref={field.ref}
                      id="settings-password-otp"
                      value={field.value}
                      onChange={(value) => {
                        clearErrors("otp");
                        setFormError(null);
                        updateFieldFeedback("otp", (current) =>
                          fieldFeedbackAfterInput(current, value),
                        );
                        field.onChange(value);
                      }}
                      onBlur={() => {
                        updateFieldFeedback("otp", fieldFeedbackAfterBlur);
                        field.onBlur();
                      }}
                      autoFocus={otpSent && !otpExpired}
                      disabled={!otpSent || otpExpired}
                      invalid={Boolean(otpError)}
                      describedBy={otpError ? "settings-password-otp-error" : undefined}
                      groupLabel="Mã OTP email gồm 6 chữ số"
                      layout="compact"
                    />
                  )}
                />
                {otpSent && (!otpExpired || !otpError) ? (
                  <p className={cn("caption-text mt-1", otpExpired ? "text-red-600" : "text-gray-500")}>
                    {otpExpired
                      ? "Mã OTP đã hết hạn. Hãy gửi lại mã mới."
                      : `Mã OTP còn hiệu lực ${formatOtpRemaining(otpRemainingSeconds)}.`}
                  </p>
                ) : null}
              </SettingsField>
            </div>
          </fieldset>

          <div className="mt-auto border-t border-gray-200 bg-white px-4 py-2.5 sm:px-5">
            <div className="flex items-start gap-2 text-[13px] leading-5 text-gray-600">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
              <p>Đổi mật khẩu sẽ đăng xuất các phiên đang hoạt động trên những thiết bị khác.</p>
            </div>
            {formError ? (
              <p role="alert" className="mt-2 text-[13px] font-medium leading-5 text-red-600">
                {formError}
              </p>
            ) : null}
            <div className="mt-3 flex justify-end">
              <Button
                type="submit"
                disabled={!otpSent || otpExpired || isSubmitting}
                className="h-8 rounded-md bg-gray-950 px-4 text-sm text-white hover:bg-black"
              >
                {isSubmitting ? <LoadingLabel label="Đang cập nhật" /> : "Cập nhật mật khẩu"}
              </Button>
            </div>
          </div>
        </form>
      ) : null}
    </SettingsCard>
  );
}
