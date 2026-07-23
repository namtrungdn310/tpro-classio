"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthBrand } from "@/components/layout/auth-brand";
import { LoadingLabel } from "@/components/ui/loading-label";
import { authSubmitClassName } from "@/components/ui/auth-field";
import { confirmOnboardingRecoveryCodes, getRecoveryCodes } from "@/lib/api/auth";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useAuth } from "@/lib/hooks/useAuth";
import { noSavedInfoFormProps } from "@/lib/forms/saved-info-policy";

export default function OnboardingRecoveryPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const fetchStartedRef = useRef(false);
  const confirmationInFlightRef = useRef(false);
  const [codes, setCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    if (fetchStartedRef.current) return;
    fetchStartedRef.current = true;

    async function fetchCodes() {
      try {
        const data = await getRecoveryCodes();
        if (data.length === 0) {
          throw new Error("Empty recovery code response");
        }
        setCodes(data);
      } catch (err) {
        setError(
          getApiErrorMessage(
            err,
            "Không lấy được mã khôi phục. Vui lòng liên hệ quản trị viên.",
          ),
        );
      } finally {
        setLoading(false);
      }
    }
    void fetchCodes();
  }, []);

  async function handleConfirm() {
    if (!confirmed || codes.length === 0 || confirmationInFlightRef.current) return;

    confirmationInFlightRef.current = true;
    setIsConfirming(true);
    setError("");
    try {
      await confirmOnboardingRecoveryCodes();
      await refresh();
      router.replace("/");
      router.refresh();
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "Không thể hoàn tất thiết lập bảo mật. Vui lòng thử lại.",
        ),
      );
    } finally {
      confirmationInFlightRef.current = false;
      setIsConfirming(false);
    }
  }

  return (
    <main className="auth-screen flex items-center justify-center px-4">
      <section className="auth-card max-w-[440px]">
        <div className="auth-card-header">
          <AuthBrand />
          <h1 className="page-title-text text-gray-950">Mã khôi phục dự phòng</h1>
          <p className="form-message-text mt-1 text-gray-500">
            Hãy lưu các mã vào nơi an toàn. Bạn chỉ có thể xem lại chúng trong bước này,
            trước khi xác nhận hoàn tất.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <LoadingLabel label="Đang tải" />
          </div>
        ) : error && codes.length === 0 ? (
          <div className="flex flex-col gap-4">
            <p role="alert" className="form-message-text rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">
              {error}
            </p>
            <Link href="/login" className="auth-action-link text-center">
              Bắt đầu lại từ đăng nhập
            </Link>
          </div>
        ) : (
          <form
            {...noSavedInfoFormProps}
            className="flex flex-col gap-4 pt-2"
            onSubmit={(event) => {
              event.preventDefault();
              void handleConfirm();
            }}
          >
            {error ? (
              <p
                role="alert"
                className="form-message-text rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700"
              >
                {error}
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-gray-200 bg-gray-50 p-4">
              {codes.map((code) => (
                <span
                  key={code}
                  className="font-mono form-input-text rounded bg-white px-2 py-1 text-center text-gray-800 shadow-sm"
                >
                  {code}
                </span>
              ))}
            </div>

            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                id="recovery-confirm"
                autoComplete="off"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-gray-300 accent-gray-800"
              />
              <span className="form-message-text text-gray-700">
                Tôi đã lưu các mã khôi phục vào nơi an toàn.
              </span>
            </label>

            <button
              type="submit"
              disabled={!confirmed || codes.length === 0 || isConfirming}
              className={authSubmitClassName}
            >
              {isConfirming ? <LoadingLabel label="Đang hoàn tất" /> : "Hoàn tất và vào hệ thống"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
