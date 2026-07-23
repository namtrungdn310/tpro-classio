"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthBrand } from "@/components/layout/auth-brand";
import { OtpInput } from "@/components/ui/otp-input";
import { LoadingLabel } from "@/components/ui/loading-label";
import { authInputClassName, authSubmitClassName } from "@/components/ui/auth-field";
import { verifyLoginTotp, verifyLoginRecoveryCode } from "@/lib/api/auth";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useAuth } from "@/lib/hooks/useAuth";
import { noSavedInfoFormProps, savedInfoAutocomplete } from "@/lib/forms/saved-info-policy";
import { cn } from "@/lib/utils";

const RECOVERY_CODE_PATTERN = /^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/;

function formatRecoveryCodeInput(value: string): string {
  const characters = value.toUpperCase().replace(/[^A-Z2-7]/g, "").slice(0, 16);
  return characters.match(/.{1,4}/g)?.join("-") ?? "";
}

export default function LoginTotpPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const submissionInFlightRef = useRef(false);
  const [code, setCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [showRecovery, setShowRecovery] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleTotpVerify() {
    if (code.length !== 6 || submissionInFlightRef.current) return;
    submissionInFlightRef.current = true;
    setIsSubmitting(true);
    setError("");
    try {
      await verifyLoginTotp(code);
      await refresh();
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(getApiErrorMessage(err, "Mã không đúng hoặc đã hết hạn."));
    } finally {
      submissionInFlightRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function handleRecoveryVerify() {
    if (!RECOVERY_CODE_PATTERN.test(recoveryCode) || submissionInFlightRef.current) return;
    submissionInFlightRef.current = true;
    setIsSubmitting(true);
    setError("");
    try {
      await verifyLoginRecoveryCode(recoveryCode.trim());
      await refresh();
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(getApiErrorMessage(err, "Mã khôi phục không đúng hoặc đã được sử dụng."));
    } finally {
      submissionInFlightRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-screen flex items-center justify-center px-4">
      <section className="auth-card">
        <div className="auth-card-header">
          <AuthBrand />
          <h1 className="page-title-text text-gray-950">Xác thực hai bước</h1>
          <p className="form-message-text mt-1 text-gray-500">
            {showRecovery
              ? "Nhập mã khôi phục dự phòng."
              : "Nhập mã 6 số từ ứng dụng Google Authenticator."}
          </p>
        </div>

        <form
          {...noSavedInfoFormProps}
          className="flex flex-col gap-4 pt-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (showRecovery) {
              void handleRecoveryVerify();
            } else {
              void handleTotpVerify();
            }
          }}
        >
          {!showRecovery ? (
            <>
              <div>
                <label htmlFor="login-totp-code" className="form-label-text mb-2 block text-gray-700">
                  Mã xác thực
                </label>
                <OtpInput
                  id="login-totp-code"
                  value={code}
                  onChange={(value) => {
                    setCode(value);
                    setError("");
                  }}
                  disabled={isSubmitting}
                  autoFocus
                  invalid={Boolean(error)}
                  describedBy={error ? "login-mfa-error" : undefined}
                  layout="auth"
                />
              </div>

              {error ? (
                <p id="login-mfa-error" role="alert" className="form-message-text text-red-600">{error}</p>
              ) : null}

              <button
                type="submit"
                disabled={code.length !== 6 || isSubmitting}
                className={authSubmitClassName}
              >
                {isSubmitting ? <LoadingLabel label="Đang xác minh" /> : "Xác minh"}
              </button>
            </>
          ) : (
            <>
              <div>
                <label htmlFor="recovery-code" className="form-label-text mb-1.5 block text-gray-700">
                  Mã khôi phục
                </label>
                <input
                  id="recovery-code"
                  type="text"
                  value={recoveryCode}
                  onChange={(event) => {
                    setRecoveryCode(formatRecoveryCodeInput(event.target.value));
                    setError("");
                  }}
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  autoComplete={savedInfoAutocomplete.disabled}
                  autoFocus
                  spellCheck={false}
                  disabled={isSubmitting}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "login-recovery-error" : undefined}
                  className={cn(authInputClassName, "h-10 font-mono tracking-widest")}
                />
              </div>

              {error ? (
                <p id="login-recovery-error" role="alert" className="form-message-text text-red-600">{error}</p>
              ) : null}

              <button
                type="submit"
                disabled={!RECOVERY_CODE_PATTERN.test(recoveryCode) || isSubmitting}
                className={authSubmitClassName}
              >
                {isSubmitting ? <LoadingLabel label="Đang xác minh" /> : "Dùng mã khôi phục"}
              </button>
            </>
          )}

          <button
            type="button"
            className="form-message-text text-center text-gray-400 underline underline-offset-2"
            onClick={() => { setShowRecovery((v) => !v); setError(""); setCode(""); setRecoveryCode(""); }}
          >
            {showRecovery ? "Quay lại nhập mã Authenticator" : "Dùng mã khôi phục dự phòng"}
          </button>

          <Link href="/login" className="auth-action-link text-center">
            Quay lại đăng nhập
          </Link>
        </form>
      </section>
    </main>
  );
}
