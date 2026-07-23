"use client";

import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AuthBrand } from "@/components/layout/auth-brand";
import {
  AuthField,
  authErrorInputClassName,
  authInputClassName,
  authSubmitClassName,
} from "@/components/ui/auth-field";
import { PasswordInput } from "@/components/ui/password-input";
import { LoadingLabel } from "@/components/ui/loading-label";
import { isAuthContinuation, login } from "@/lib/api/auth";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
  fieldFeedbackAfterBlur,
  fieldFeedbackAfterInput,
  fieldFeedbackAfterSubmit,
  initialFieldFeedback,
  shouldShowFieldError,
  type FieldFeedbackState,
} from "@/lib/auth/field-feedback";
import { moveFocusOnValidArrowDown } from "@/lib/auth/field-navigation";
import { cn } from "@/lib/utils";
import { validationMessages } from "@/lib/forms/validation-messages";
import { savedInfoAutocomplete } from "@/lib/forms/saved-info-policy";

const loginEmailSchema = z
  .string()
  .trim()
  .min(1, validationMessages.required("email"))
  .email(validationMessages.emailFormat);

const loginSchema = z.object({
  email: loginEmailSchema,
  password: z
    .string()
    .min(1, validationMessages.required("mật khẩu"))
    .min(8, validationMessages.passwordMinLength),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const initialLoginFeedback: Record<keyof LoginFormValues, FieldFeedbackState> = {
  email: initialFieldFeedback,
  password: initialFieldFeedback,
};

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState("");
  const [fieldFeedback, setFieldFeedback] = useState(initialLoginFeedback);
  const passwordResetSucceeded = searchParams.get("password_reset") === "success";
  const {
    formState: { errors, isSubmitted, isSubmitting },
    handleSubmit,
    register,
    setFocus,
    trigger,
    watch,
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: {
      email: "",
      password: "",
    },
  });

  useEffect(() => {
    const reason = searchParams.get("reason");
    if (reason === "session-replaced") {
      setError("Phiên đăng nhập đã được sử dụng trên một thiết bị khác. Vui lòng đăng nhập lại.");
      return;
    }
    if (reason === "flow-expired") {
      setError("Phiên xác thực hai bước đã hết hạn. Vui lòng đăng nhập lại.");
      return;
    }

    setError("");
  }, [searchParams]);

  async function onSubmit(values: LoginFormValues) {
    restoreSubmitErrors();
    setError("");

    try {
      const email = values.email.trim().toLowerCase();
      const result = await login(email, values.password);
      if (isAuthContinuation(result)) {
        const nextPage = {
          login_totp: "/login/totp",
          onboarding_google: "/onboarding/google",
          onboarding_totp: "/onboarding/totp",
        } as const;
        router.replace(nextPage[result.next_step]);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Email hoặc mật khẩu không chính xác."));
    }
  }

  const emailValue = watch("email");
  const passwordValue = watch("password");
  const emailRegistration = register("email");
  const passwordRegistration = register("password");

  function updateFieldFeedback(
    field: keyof LoginFormValues,
    update: (current: FieldFeedbackState) => FieldFeedbackState,
  ) {
    setFieldFeedback((current) => ({
      ...current,
      [field]: update(current[field]),
    }));
  }

  function restoreSubmitErrors() {
    setFieldFeedback((current) => ({
      email: fieldFeedbackAfterSubmit(current.email),
      password: fieldFeedbackAfterSubmit(current.password),
    }));
  }

  useEffect(() => {
    if (passwordValue.length > 0 && emailValue.length === 0 && !errors.email) {
      void trigger("email");
    }
  }, [emailValue, errors.email, passwordValue, trigger]);

  const shouldShowEmailError =
    Boolean(errors.email?.message) &&
    (shouldShowFieldError(fieldFeedback.email, isSubmitted) || passwordValue.length > 0);
  const shouldShowPasswordError =
    Boolean(errors.password?.message) &&
    shouldShowFieldError(fieldFeedback.password, isSubmitted);
  const emailError = shouldShowEmailError ? errors.email?.message : undefined;
  const passwordValidationError = shouldShowPasswordError ? errors.password?.message : undefined;
  const visibleFormError = emailError || passwordValidationError ? "" : error;
  const visibleError = emailError ?? passwordValidationError ?? visibleFormError;

  return (
    <main className="auth-screen flex items-center justify-center px-4">
      <section className="auth-card">
        <div className="auth-card-header">
          <AuthBrand />
          <h1 className="page-title-text text-gray-950">Đăng nhập</h1>
        </div>

        <form
          noValidate
          className="auth-form-stack"
          onSubmit={handleSubmit(onSubmit, restoreSubmitErrors)}
        >
          <AuthField id="login-email" label="Email" error={emailError}>
            <input
              id="login-email"
              type="email"
              inputMode="email"
              autoComplete={savedInfoAutocomplete.loginIdentifier}
              enterKeyHint="next"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              {...emailRegistration}
              onInput={(event) => {
                const value = event.currentTarget.value;
                setError("");
                updateFieldFeedback("email", (current) =>
                  fieldFeedbackAfterInput(current, value),
                );
              }}
              onKeyDown={(event) =>
                moveFocusOnValidArrowDown(
                  event,
                  loginEmailSchema.safeParse(event.currentTarget.value).success,
                  () => setFocus("password"),
                )
              }
              onBlur={(event) => {
                updateFieldFeedback("email", fieldFeedbackAfterBlur);
                void emailRegistration.onBlur(event);
              }}
              aria-invalid={Boolean(emailError)}
              aria-describedby={emailError ? "login-email-error" : undefined}
              className={cn(authInputClassName, emailError && authErrorInputClassName)}
            />
          </AuthField>

          <AuthField id="login-password" label="Mật khẩu" error={passwordValidationError}>
            <PasswordInput
              id="login-password"
              autoComplete={savedInfoAutocomplete.loginPassword}
              enterKeyHint="done"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              {...passwordRegistration}
              onInput={(event) => {
                const value = event.currentTarget.value;
                setError("");
                updateFieldFeedback("password", (current) =>
                  fieldFeedbackAfterInput(current, value),
                );
              }}
              onBlur={(event) => {
                updateFieldFeedback("password", fieldFeedbackAfterBlur);
                void passwordRegistration.onBlur(event);
              }}
              aria-invalid={Boolean(passwordValidationError)}
              aria-describedby={
                passwordValidationError ? "login-password-error" : undefined
              }
              className={cn(
                authInputClassName,
                passwordValidationError && authErrorInputClassName,
              )}
            />
          </AuthField>

          {visibleFormError ? (
            <p role="alert" className="form-message-text text-red-600">
              {visibleFormError}
            </p>
          ) : null}

          {passwordResetSucceeded && !visibleError ? (
            <p className="form-message-text text-emerald-700">
              Mật khẩu đã được cập nhật. Vui lòng đăng nhập lại.
            </p>
          ) : null}

          <div className="pt-2">
            <button type="submit" disabled={isSubmitting} className={authSubmitClassName}>
              {isSubmitting ? <LoadingLabel label="Đang đăng nhập" /> : "Đăng nhập"}
            </button>
          </div>
        </form>

        <div className="mt-5 flex items-center justify-between">
          <Link href="/register" className="auth-action-link">
            Đăng ký
          </Link>
          <Link href="/reset-password" className="auth-action-link">
            Quên mật khẩu
          </Link>
        </div>
      </section>
    </main>
  );
}
