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
import { registerAccount } from "@/lib/api/auth";
import { getApiErrorMessage } from "@/lib/api/errors";
import { createPendingOtpFlow, savePendingOtpFlow } from "@/lib/auth/otp-flow";
import {
  fieldFeedbackAfterBlur,
  fieldFeedbackAfterInput,
  fieldFeedbackAfterSubmit,
  initialFieldFeedback,
  shouldShowFieldError,
  type FieldFeedbackState,
} from "@/lib/auth/field-feedback";
import { moveFocusOnValidArrowDown } from "@/lib/auth/field-navigation";
import { passwordSchema } from "@/lib/auth/password";
import { cn } from "@/lib/utils";
import { validationMessages } from "@/lib/forms/validation-messages";
import { savedInfoAutocomplete } from "@/lib/forms/saved-info-policy";

const usernameSchema = z
  .string()
  .trim()
  .min(3, validationMessages.usernameLength)
  .max(20, validationMessages.usernameLength)
  .regex(/^[A-Za-z0-9]+$/, validationMessages.usernameCharacters);

const registerEmailSchema = z
  .string()
  .trim()
  .min(1, validationMessages.required("email"))
  .email(validationMessages.emailFormat);

const registerSchema = z
  .object({
    username: usernameSchema,
    email: registerEmailSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, validationMessages.required("mật khẩu xác nhận")),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: validationMessages.passwordConfirmation,
    path: ["confirmPassword"],
  });

type RegisterFormValues = z.infer<typeof registerSchema>;
type RegisterFieldName = keyof RegisterFormValues;

const initialRegisterFeedback: Record<RegisterFieldName, FieldFeedbackState> = {
  username: initialFieldFeedback,
  email: initialFieldFeedback,
  password: initialFieldFeedback,
  confirmPassword: initialFieldFeedback,
};

export default function RegisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [invitation] = useState(() => ({
    token: searchParams.get("token") ?? "",
    email: searchParams.get("email") ?? "",
  }));
  const [error, setError] = useState("");
  const [fieldFeedback, setFieldFeedback] = useState(initialRegisterFeedback);

  const invitationToken = invitation.token;
  const invitationEmail = invitation.email;

  const {
    formState: { errors, isSubmitted, isSubmitting },
    getValues,
    handleSubmit,
    register,
    setError: setFieldError,
    setFocus,
    trigger,
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    shouldFocusError: true,
    defaultValues: {
      username: "",
      email: invitationEmail,
      password: "",
      confirmPassword: "",
    },
  });

  // Keep the one-time secret in memory only for the registration request. It
  // must not remain in browser history, referrers or copied address-bar URLs.
  useEffect(() => {
    if (!invitationToken || typeof window === "undefined") return;
    window.history.replaceState(window.history.state, "", window.location.pathname);
  }, [invitationToken]);

  // If no token, show error state — links must come from invitation
  if (!invitationToken) {
    return (
      <main className="auth-screen flex items-center justify-center px-4">
        <section className="auth-card">
          <div className="auth-card-header">
            <AuthBrand />
            <h1 className="page-title-text text-gray-950">Đăng ký tài khoản</h1>
          </div>
          <p className="form-message-text rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
            Đăng ký chỉ dành cho tài khoản được mời. Vui lòng sử dụng đường dẫn trong email mời.
          </p>
          <Link href="/login" className="auth-action-link mt-5 block text-center">
            Quay lại đăng nhập
          </Link>
        </section>
      </main>
    );
  }

  const usernameRegistration = register("username");
  const emailRegistration = register("email");
  const passwordRegistration = register("password");
  const confirmPasswordRegistration = register("confirmPassword");

  function updateFieldFeedback(
    field: RegisterFieldName,
    update: (current: FieldFeedbackState) => FieldFeedbackState,
  ) {
    setFieldFeedback((current) => ({
      ...current,
      [field]: update(current[field]),
    }));
  }

  function restoreSubmitErrors() {
    setFieldFeedback((current) => ({
      username: fieldFeedbackAfterSubmit(current.username),
      email: fieldFeedbackAfterSubmit(current.email),
      password: fieldFeedbackAfterSubmit(current.password),
      confirmPassword: fieldFeedbackAfterSubmit(current.confirmPassword),
    }));
  }

  const usernameError =
    errors.username?.message && shouldShowFieldError(fieldFeedback.username, isSubmitted)
      ? errors.username.message
      : undefined;
  const emailError =
    errors.email?.message && shouldShowFieldError(fieldFeedback.email, isSubmitted)
      ? errors.email.message
      : undefined;
  const passwordError =
    errors.password?.message && shouldShowFieldError(fieldFeedback.password, isSubmitted)
      ? errors.password.message
      : undefined;
  const confirmPasswordError =
    errors.confirmPassword?.message &&
    shouldShowFieldError(fieldFeedback.confirmPassword, isSubmitted)
      ? errors.confirmPassword.message
      : undefined;
  const visibleServerError =
    usernameError || emailError || passwordError || confirmPasswordError ? "" : error;

  async function onSubmit(values: RegisterFormValues) {
    restoreSubmitErrors();
    setError("");
    try {
      const email = values.email.trim().toLowerCase();
      const response = await registerAccount(
        email,
        values.password,
        invitationToken,
        values.username.trim(),
      );
      savePendingOtpFlow(createPendingOtpFlow("register", email, response.otp_expires_in_seconds));
      router.replace("/otp");
    } catch (requestError) {
      const message = getApiErrorMessage(requestError, "Không thể tạo tài khoản bằng email này.");
      if (message.toLocaleLowerCase("vi-VN").includes("email này đã được đăng ký")) {
        setFieldError("email", { type: "server", message }, { shouldFocus: true });
        return;
      }
      setError(message);
    }
  }

  return (
    <main className="auth-screen flex items-center justify-center px-4">
      <section className="auth-card">
        <div className="auth-card-header">
          <AuthBrand />
          <h1 className="page-title-text text-gray-950">Đăng ký tài khoản</h1>
        </div>

        <form
          noValidate
          className="auth-form-stack"
          onSubmit={handleSubmit(onSubmit, restoreSubmitErrors)}
        >
          <AuthField id="register-username" label="Tên đăng nhập" error={usernameError}>
            <input
              id="register-username"
              type="text"
              inputMode="text"
              autoComplete={savedInfoAutocomplete.disabled}
              enterKeyHint="next"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              {...usernameRegistration}
              onKeyDown={(event) =>
                moveFocusOnValidArrowDown(
                  event,
                  usernameSchema.safeParse(event.currentTarget.value).success,
                  () => setFocus("email"),
                )
              }
              onInput={(event) => {
                const value = event.currentTarget.value;
                setError("");
                updateFieldFeedback("username", (current) =>
                  fieldFeedbackAfterInput(current, value),
                );
              }}
              onBlur={(event) => {
                updateFieldFeedback("username", fieldFeedbackAfterBlur);
                void usernameRegistration.onBlur(event);
              }}
              aria-invalid={Boolean(usernameError)}
              aria-describedby={usernameError ? "register-username-error" : undefined}
              className={cn(authInputClassName, usernameError && authErrorInputClassName)}
            />
          </AuthField>

          <AuthField id="register-email" label="Email" error={emailError}>
            <input
              id="register-email"
              type="email"
              inputMode="email"
              autoComplete={savedInfoAutocomplete.otpEmail}
              enterKeyHint="next"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              readOnly={Boolean(invitationEmail)}
              {...emailRegistration}
              onKeyDown={(event) =>
                moveFocusOnValidArrowDown(
                  event,
                  registerEmailSchema.safeParse(event.currentTarget.value).success,
                  () => setFocus("password"),
                )
              }
              onInput={(event) => {
                const value = event.currentTarget.value;
                setError("");
                updateFieldFeedback("email", (current) =>
                  fieldFeedbackAfterInput(current, value),
                );
              }}
              onBlur={(event) => {
                updateFieldFeedback("email", fieldFeedbackAfterBlur);
                void emailRegistration.onBlur(event);
              }}
              aria-invalid={Boolean(emailError)}
              aria-describedby={emailError ? "register-email-error" : undefined}
              className={cn(
                authInputClassName,
                emailError && authErrorInputClassName,
                invitationEmail && "bg-gray-50 text-gray-500",
              )}
            />
          </AuthField>

          <AuthField id="register-password" label="Mật khẩu" error={passwordError}>
            <PasswordInput
              id="register-password"
              autoComplete="new-password"
              enterKeyHint="next"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              {...passwordRegistration}
              onChange={(event) => {
                void passwordRegistration.onChange(event);
                if (getValues("confirmPassword")) {
                  void trigger("confirmPassword");
                }
              }}
              onKeyDown={(event) =>
                moveFocusOnValidArrowDown(
                  event,
                  passwordSchema.safeParse(event.currentTarget.value).success,
                  () => setFocus("confirmPassword"),
                )
              }
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
              aria-invalid={Boolean(passwordError)}
              aria-describedby={passwordError ? "register-password-error" : undefined}
              className={cn(authInputClassName, passwordError && authErrorInputClassName)}
            />
          </AuthField>

          <AuthField
            id="register-confirm-password"
            label="Xác nhận mật khẩu"
            error={confirmPasswordError}
          >
            <PasswordInput
              id="register-confirm-password"
              autoComplete="new-password"
              enterKeyHint="done"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              {...confirmPasswordRegistration}
              onInput={(event) => {
                const value = event.currentTarget.value;
                setError("");
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
                confirmPasswordError ? "register-confirm-password-error" : undefined
              }
              className={cn(
                authInputClassName,
                confirmPasswordError && authErrorInputClassName,
              )}
            />
          </AuthField>

          {visibleServerError ? (
            <p role="alert" className="form-message-text text-red-600">
              {visibleServerError}
            </p>
          ) : null}

          <div className="pt-2">
            <button type="submit" disabled={isSubmitting} className={authSubmitClassName}>
              {isSubmitting ? <LoadingLabel label="Đang đăng ký" /> : "Đăng ký"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
