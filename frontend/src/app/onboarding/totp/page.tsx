"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthBrand } from "@/components/layout/auth-brand";
import { OtpInput } from "@/components/ui/otp-input";
import { LoadingLabel } from "@/components/ui/loading-label";
import { authSubmitClassName } from "@/components/ui/auth-field";
import { enrollTotp, verifyOnboardingTotp } from "@/lib/api/auth";
import { getApiErrorMessage } from "@/lib/api/errors";
import { noSavedInfoFormProps } from "@/lib/forms/saved-info-policy";

type Step = "loading" | "scan" | "error";

export default function OnboardingTotpPage() {
  const router = useRouter();
  const enrollmentStartedRef = useRef(false);
  const submissionInFlightRef = useRef(false);

  const [step, setStep] = useState<Step>("loading");
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  const startEnrollment = useCallback(async () => {
    setStep("loading");
    setError("");
    setCode("");
    setQrCodeDataUrl("");
    setSecret("");
    try {
      const data = await enrollTotp();
      setQrCodeDataUrl(data.qr_code_data_url);
      setSecret(data.secret);
      setStep("scan");
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "Không thể khởi tạo mã xác thực. Vui lòng thử lại.",
        ),
      );
      setStep("error");
    }
  }, []);

  useEffect(() => {
    if (enrollmentStartedRef.current) return;
    enrollmentStartedRef.current = true;
    void startEnrollment();
  }, [startEnrollment]);

  async function handleVerify() {
    if (code.length !== 6 || submissionInFlightRef.current) return;
    submissionInFlightRef.current = true;
    setIsSubmitting(true);
    setError("");
    try {
      await verifyOnboardingTotp(code);
      router.replace("/onboarding/recovery");
    } catch (err) {
      setError(getApiErrorMessage(err, "Mã không đúng hoặc đã hết hạn. Vui lòng thử lại."));
    } finally {
      submissionInFlightRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-screen flex items-center justify-center px-4">
      <section className="auth-card max-w-[400px]">
        <div className="auth-card-header">
          <AuthBrand />
          <h1 className="page-title-text text-gray-950">Thiết lập xác thực hai bước</h1>
          <p className="form-message-text mt-1 text-gray-500">
            Quét mã QR bằng Google Authenticator, sau đó nhập mã 6 số bên dưới.
          </p>
        </div>

        {step === "loading" ? (
          <div className="flex justify-center py-8">
            <LoadingLabel label="Đang khởi tạo" />
          </div>
        ) : step === "error" ? (
          <div className="flex flex-col gap-4 pt-2">
            <p
              role="alert"
              className="form-message-text rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700"
            >
              {error}
            </p>
            <button
              type="button"
              onClick={() => void startEnrollment()}
              className={authSubmitClassName}
            >
              Thử lại
            </button>
          </div>
        ) : (
          <form
            {...noSavedInfoFormProps}
            className="flex flex-col items-center gap-5 pt-2"
            onSubmit={(event) => {
              event.preventDefault();
              void handleVerify();
            }}
          >
            {qrCodeDataUrl ? (
              <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrCodeDataUrl}
                  alt="Mã QR thiết lập Google Authenticator"
                  width={200}
                  height={200}
                />
              </div>
            ) : null}

            <button
              type="button"
              className="form-message-text text-gray-400 underline underline-offset-2"
              onClick={() => setShowSecret((v) => !v)}
            >
              {showSecret ? "Ẩn mã thiết lập" : "Nhập thủ công thay cho quét QR"}
            </button>

            {showSecret && secret ? (
              <p className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-center font-mono form-input-text tracking-widest text-gray-800 select-all">
                {secret}
              </p>
            ) : null}

            <div className="w-full">
              <label htmlFor="totp-code" className="form-label-text mb-2 block text-gray-700">
                Mã xác thực (6 chữ số)
              </label>
              <OtpInput
                id="totp-code"
                value={code}
                onChange={(value) => {
                  setCode(value);
                  setError("");
                }}
                disabled={isSubmitting}
                autoFocus
                invalid={Boolean(error)}
                describedBy={error ? "onboarding-totp-error" : undefined}
                layout="auth"
              />
              {error ? (
                <p id="onboarding-totp-error" role="alert" className="form-message-text mt-1.5 text-red-600">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="w-full">
              <button
                type="submit"
                disabled={code.length !== 6 || isSubmitting}
                className={authSubmitClassName}
              >
                {isSubmitting ? <LoadingLabel label="Đang xác minh" /> : "Xác minh và tiếp tục"}
              </button>
            </div>
          </form>
        )}

        {step !== "loading" ? (
          <Link href="/login" className="auth-action-link mt-4 block text-center">
            Bắt đầu lại từ đăng nhập
          </Link>
        ) : null}
      </section>
    </main>
  );
}
