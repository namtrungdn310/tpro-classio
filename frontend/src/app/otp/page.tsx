"use client";

import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { AuthBrand } from "@/components/layout/auth-brand";
import {
  AuthField,
  authErrorInputClassName,
  authInputClassName,
  authSubmitClassName,
} from "@/components/ui/auth-field";
import { OtpInput } from "@/components/ui/otp-input";
import { PasswordInput } from "@/components/ui/password-input";
import { LoadingLabel } from "@/components/ui/loading-label";
import {
  completePasswordReset,
  resendRegisterOtp,
  startPasswordReset,
  verifyPasswordResetOtp,
  verifyRegisterOtp,
} from "@/lib/api/auth";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
  clearPendingOtpFlow,
  createPendingOtpFlow,
  formatOtpRemaining,
  getPendingOtpFlow,
  getOtpRemainingSeconds,
  isOtpExpired,
  savePendingOtpFlow,
  type PendingOtpFlow,
} from "@/lib/auth/otp-flow";
import { passwordSchema as strongPasswordSchema } from "@/lib/auth/password";
import { cn } from "@/lib/utils";
import { validationMessages } from "@/lib/forms/validation-messages";
import { noSavedInfoFormProps } from "@/lib/forms/saved-info-policy";
import {
  fieldFeedbackAfterBlur,
  fieldFeedbackAfterInput,
  fieldFeedbackAfterSubmit,
  initialFieldFeedback,
  shouldShowFieldError,
} from "@/lib/auth/field-feedback";

const otpSchema = z.object({
  otp: z.string().regex(/^\d{6}$/, validationMessages.otpFormat),
});

const passwordSchema = z.object({
  newPassword: strongPasswordSchema,
});

type OtpFormValues = z.infer<typeof otpSchema>;
type PasswordFormValues = z.infer<typeof passwordSchema>;

const purposeCopy: Record<PendingOtpFlow["purpose"], { title: string; subtitle: string }> = {
  register: {
    title: "Xác thực đăng ký",
    subtitle: "Nhập mã OTP đã gửi đến email bên dưới.",
  },
  "reset-password": {
    title: "Xác thực đặt lại mật khẩu",
    subtitle: "Nhập mã OTP đã gửi đến email bên dưới.",
  },
};

export default function OtpPage() {
  const router = useRouter();
  const [flow, setFlow] = useState<PendingOtpFlow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isResetVerified, setIsResetVerified] = useState(false);
  const [resetTokenExpiresAt, setResetTokenExpiresAt] = useState<number | null>(null);
  const [remainingOtpSeconds, setRemainingOtpSeconds] = useState(0);
  const [passwordFeedback, setPasswordFeedback] = useState(initialFieldFeedback);
  const [isResending, setIsResending] = useState(false);
  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    reset,
  } = useForm<OtpFormValues>({
    resolver: zodResolver(otpSchema),
    mode: "onSubmit",
    reValidateMode: "onChange",
    shouldFocusError: true,
    defaultValues: { otp: "" },
  });
  const {
    formState: {
      errors: passwordErrors,
      isSubmitted: isPasswordSubmitted,
      isSubmitting: isPasswordSubmitting,
    },
    handleSubmit: handlePasswordSubmit,
    register: registerPassword,
  } = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    shouldFocusError: true,
    defaultValues: { newPassword: "" },
  });

  useEffect(() => {
    setFlow(getPendingOtpFlow());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!flow) {
      setRemainingOtpSeconds(0);
      return;
    }

    const updateRemaining = () => setRemainingOtpSeconds(getOtpRemainingSeconds(flow.expires_at));
    updateRemaining();
    const timerId = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timerId);
  }, [flow]);

  const copy = useMemo(() => {
    return flow ? purposeCopy[flow.purpose] : null;
  }, [flow]);
  const changeEmailHref = flow?.purpose === "reset-password" ? "/reset-password" : "/register";
  const isPasswordStep = flow?.purpose === "reset-password" && isResetVerified;
  const otpExpired = flow ? isOtpExpired(flow.expires_at) : false;
  const resetTokenRemainingSeconds = resetTokenExpiresAt
    ? getOtpRemainingSeconds(resetTokenExpiresAt)
    : 0;
  const pageTitle = isPasswordStep ? "Tạo mật khẩu mới" : copy?.title;
  const pageSubtitle = isPasswordStep
    ? "Nhập mật khẩu mới để hoàn tất việc đặt lại."
    : copy?.subtitle;
  const otpError = (errors.otp?.message ?? error) || undefined;
  const visibleOtpError = otpExpired ? undefined : otpError;
  const newPasswordRegistration = registerPassword("newPassword");
  const newPasswordError =
    passwordErrors.newPassword?.message &&
    shouldShowFieldError(passwordFeedback, isPasswordSubmitted)
      ? passwordErrors.newPassword.message
      : undefined;

  async function onSubmit(values: OtpFormValues) {
    if (!flow) {
      return;
    }

    setError("");
    setMessage("");

    if (otpExpired) {
      setError("Mã OTP đã hết hạn. Hãy gửi lại mã mới.");
      return;
    }

    try {
      const otp = values.otp.trim();
      if (flow.purpose === "register") {
        await verifyRegisterOtp(flow.email, otp);
        clearPendingOtpFlow();
        // The BFF keeps the opaque flow cookie HttpOnly. Google identity must
        // be linked before the account can enroll its TOTP factor.
        router.replace("/onboarding/google");
        return;
      } else {
        const resetData = await verifyPasswordResetOtp(flow.email, otp);
        setIsResetVerified(true);
        setResetTokenExpiresAt(Date.now() + resetData.reset_token_expires_in_seconds * 1000);
        reset({ otp: "" });
        setMessage("");
      }
    } catch (requestError) {
      const detail = getApiErrorMessage(
        requestError,
        "Mã OTP không chính xác hoặc đã hết hạn.",
      );
      setError(detail);
    }
  }

  async function onSubmitNewPassword(values: PasswordFormValues) {
    setPasswordFeedback(fieldFeedbackAfterSubmit);
    if (!isResetVerified) {
      setError("Phiên đặt lại mật khẩu không hợp lệ. Vui lòng xác thực lại mã OTP.");
      return;
    }

    setError("");
    setMessage("");

    if (resetTokenRemainingSeconds <= 0) {
      setIsResetVerified(false);
      setResetTokenExpiresAt(null);
      setError("Phiên đặt lại mật khẩu đã hết hạn. Vui lòng gửi lại mã OTP.");
      return;
    }

    try {
      await completePasswordReset(values.newPassword);
      clearPendingOtpFlow();
      router.replace("/login?password_reset=success");
      router.refresh();
    } catch (requestError) {
      const detail = getApiErrorMessage(requestError, "Không thể cập nhật mật khẩu. Vui lòng thử lại.");
      if (detail.toLowerCase().includes("hết hạn")) {
        setIsResetVerified(false);
        setResetTokenExpiresAt(null);
      }
      setError(detail);
    }
  }

  async function resendOtp() {
    if (!flow || isResending) {
      return;
    }

    setError("");
    setMessage("");
    setIsResending(true);

    try {
      const response =
        flow.purpose === "register"
          ? await resendRegisterOtp(flow.email)
          : await startPasswordReset(flow.email);

      const nextFlow = createPendingOtpFlow(
        flow.purpose,
        flow.email,
        response.otp_expires_in_seconds,
      );
      savePendingOtpFlow(nextFlow);
      setFlow(nextFlow);
      setIsResetVerified(false);
      setResetTokenExpiresAt(null);
      reset({ otp: "" });
      setMessage("Đã gửi lại mã OTP.");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Không thể gửi lại mã OTP. Vui lòng thử lại."));
    } finally {
      setIsResending(false);
    }
  }

  if (!loaded) {
    return (
      <main className="auth-screen flex items-center justify-center px-4">
        <section className="auth-card h-72 animate-pulse" />
      </main>
    );
  }

  if (!flow || !copy) {
    return (
      <main className="auth-screen flex items-center justify-center px-4">
        <section className="auth-card">
          <AuthBrand />
          <h1 className="page-title-text text-gray-950">Không có mã đang chờ</h1>
          <p className="auth-subtitle">
            Phiên xác thực không còn hiệu lực. Vui lòng bắt đầu lại.
          </p>
          <Link
            href="/login"
            className="auth-primary-button mt-5 inline-flex items-center justify-center"
          >
            Quay lại đăng nhập
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-screen flex items-center justify-center px-4">
      <section className="auth-card">
        <div className="auth-card-header">
          <AuthBrand />
          <h1 className="page-title-text text-gray-950">{pageTitle}</h1>
          <p className="auth-subtitle">{pageSubtitle}</p>
          <p className="form-label-text mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-gray-900">
            {flow.email}
          </p>
          {isPasswordStep && resetTokenExpiresAt ? (
            <p className="caption-text mt-2 text-gray-500">
              Phiên đặt mật khẩu còn hiệu lực {formatOtpRemaining(resetTokenRemainingSeconds)}.
            </p>
          ) : null}
        </div>

        {!isPasswordStep ? (
          <form
            noValidate
            className="auth-form-stack"
            onSubmit={handleSubmit(onSubmit)}
          >
            <div>
              <label htmlFor="otp-code" className="form-label-text mb-2 block text-gray-700">
                Mã OTP email
              </label>
              <Controller
                control={control}
                name="otp"
                render={({ field }) => (
                  <OtpInput
                    ref={field.ref}
                    id="otp-code"
                    value={field.value}
                    onChange={(value) => {
                      setError("");
                      field.onChange(value);
                    }}
                    onBlur={field.onBlur}
                    disabled={otpExpired}
                    autoFocus
                    invalid={Boolean(visibleOtpError || otpExpired)}
                    describedBy={
                      otpExpired ? "otp-status" : visibleOtpError ? "otp-error" : undefined
                    }
                    groupLabel="Mã OTP email gồm 6 chữ số"
                    layout="auth"
                  />
                )}
              />
              <p
                id="otp-status"
                className={`caption-text mt-2 text-center ${otpExpired ? "text-red-600" : "text-gray-500"}`}
              >
                {otpExpired
                  ? "Mã OTP đã hết hạn. Hãy gửi lại mã mới."
                  : `Mã OTP còn hiệu lực ${formatOtpRemaining(remainingOtpSeconds)}.`}
              </p>
              {visibleOtpError ? (
                <p id="otp-error" role="alert" className="form-message-text mt-1 text-red-600">
                  {visibleOtpError}
                </p>
              ) : null}
              {message ? <p className="form-message-text mt-1 text-gray-600">{message}</p> : null}
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmitting || otpExpired}
                className={authSubmitClassName}
              >
                {isSubmitting ? <LoadingLabel label="Đang xác thực" /> : "Xác thực"}
              </button>
            </div>
          </form>
        ) : (
          <form
            {...noSavedInfoFormProps}
            noValidate
            className="auth-form-stack"
            onSubmit={handlePasswordSubmit(onSubmitNewPassword, () =>
              setPasswordFeedback(fieldFeedbackAfterSubmit)
            )}
          >
            <AuthField
              id="otp-new-password"
              label="Mật khẩu mới"
              error={newPasswordError}
            >
              <PasswordInput
                id="otp-new-password"
                autoComplete="new-password"
                enterKeyHint="done"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                {...newPasswordRegistration}
                onInput={(event) => {
                  const value = event.currentTarget.value;
                  setError("");
                  setPasswordFeedback((current) => fieldFeedbackAfterInput(current, value));
                }}
                onBlur={(event) => {
                  setPasswordFeedback(fieldFeedbackAfterBlur);
                  void newPasswordRegistration.onBlur(event);
                }}
                aria-invalid={Boolean(newPasswordError)}
                aria-describedby={newPasswordError ? "otp-new-password-error" : undefined}
                className={cn(
                  authInputClassName,
                  newPasswordError && authErrorInputClassName,
                )}
              />
            </AuthField>

            {error ? (
              <p role="alert" className="form-message-text text-red-600">
                {error}
              </p>
            ) : null}

            <div className="pt-2">
              <button
                type="submit"
                disabled={isPasswordSubmitting || resetTokenRemainingSeconds <= 0}
                className={authSubmitClassName}
              >
                {isPasswordSubmitting ? (
                  <LoadingLabel label="Đang cập nhật" />
                ) : (
                  "Lưu mật khẩu mới"
                )}
              </button>
            </div>
          </form>
        )}

        <div className="mt-5 flex items-center justify-between">
          {isPasswordStep ? (
            <button
              type="button"
              onClick={() => {
                setError("");
                setMessage("");
                setIsResetVerified(false);
                setResetTokenExpiresAt(null);
              }}
              className="auth-action-link"
            >
              Nhập lại OTP
            </button>
          ) : (
            <Link href={changeEmailHref} className="auth-action-link">
              Đổi email
            </Link>
          )}
          {!isPasswordStep ? (
            <button
              type="button"
              onClick={resendOtp}
              disabled={isResending}
              className="auth-action-link disabled:cursor-wait disabled:opacity-60"
            >
              {isResending ? <LoadingLabel label="Đang gửi lại" /> : "Gửi lại mã"}
            </button>
          ) : null}
        </div>
      </section>
    </main>
  );
}
