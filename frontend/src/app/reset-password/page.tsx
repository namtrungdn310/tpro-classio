"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AuthBrand } from "@/components/layout/auth-brand";
import {
  AuthField,
  authErrorInputClassName,
  authInputClassName,
  authSubmitClassName,
} from "@/components/ui/auth-field";
import { LoadingLabel } from "@/components/ui/loading-label";
import { startPasswordReset } from "@/lib/api/auth";
import { getApiErrorMessage } from "@/lib/api/errors";
import { createPendingOtpFlow, savePendingOtpFlow } from "@/lib/auth/otp-flow";
import {
  fieldFeedbackAfterBlur,
  fieldFeedbackAfterInput,
  fieldFeedbackAfterSubmit,
  initialFieldFeedback,
  shouldShowFieldError,
} from "@/lib/auth/field-feedback";
import { cn } from "@/lib/utils";
import { validationMessages } from "@/lib/forms/validation-messages";
import { savedInfoAutocomplete } from "@/lib/forms/saved-info-policy";

const resetSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, validationMessages.required("email"))
    .email(validationMessages.emailFormat),
});

type ResetFormValues = z.infer<typeof resetSchema>;

export default function ResetPasswordPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [emailFeedback, setEmailFeedback] = useState(initialFieldFeedback);
  const {
    formState: { errors, isSubmitted, isSubmitting },
    handleSubmit,
    register,
  } = useForm<ResetFormValues>({
    resolver: zodResolver(resetSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    shouldFocusError: true,
    defaultValues: {
      email: "",
    },
  });
  const emailRegistration = register("email");
  const emailError =
    errors.email?.message && shouldShowFieldError(emailFeedback, isSubmitted)
      ? errors.email.message
      : undefined;
  const visibleServerError = emailError ? "" : error;

  async function onSubmit(values: ResetFormValues) {
    setEmailFeedback(fieldFeedbackAfterSubmit);
    setError("");

    try {
      const email = values.email.trim().toLowerCase();
      const response = await startPasswordReset(email);
      savePendingOtpFlow(
        createPendingOtpFlow("reset-password", email, response.otp_expires_in_seconds),
      );
      router.push("/otp");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Không thể gửi mã OTP. Vui lòng thử lại."));
    }
  }

  return (
    <main className="auth-screen flex items-center justify-center px-4">
      <section className="auth-card">
        <div className="auth-card-header">
          <AuthBrand />
          <h1 className="page-title-text text-gray-950">Quên mật khẩu</h1>
          <p className="auth-subtitle">
            Nhập email đã đăng ký để nhận mã OTP.
          </p>
        </div>

        <form
          noValidate
          className="auth-form-stack"
          onSubmit={handleSubmit(onSubmit, () =>
            setEmailFeedback(fieldFeedbackAfterSubmit)
          )}
        >
          <AuthField id="reset-email" label="Email" error={emailError}>
            <input
              id="reset-email"
              type="email"
              inputMode="email"
              autoComplete={savedInfoAutocomplete.otpEmail}
              enterKeyHint="done"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              {...emailRegistration}
              onInput={(event) => {
                const value = event.currentTarget.value;
                setError("");
                setEmailFeedback((current) =>
                  fieldFeedbackAfterInput(current, value),
                );
              }}
              onBlur={(event) => {
                setEmailFeedback(fieldFeedbackAfterBlur);
                void emailRegistration.onBlur(event);
              }}
              aria-invalid={Boolean(emailError)}
              aria-describedby={emailError ? "reset-email-error" : undefined}
              className={cn(authInputClassName, emailError && authErrorInputClassName)}
            />
          </AuthField>
          {visibleServerError ? (
            <p role="alert" className="form-message-text text-red-600">
              {visibleServerError}
            </p>
          ) : null}
          <div className="pt-2">
            <button type="submit" disabled={isSubmitting} className={authSubmitClassName}>
              {isSubmitting ? <LoadingLabel label="Đang gửi mã" /> : "Gửi mã OTP"}
            </button>
          </div>
        </form>

        <Link href="/login" className="auth-action-link mt-5 inline-flex">
          Quay lại đăng nhập
        </Link>
      </section>
    </main>
  );
}
