"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthBrand } from "@/components/layout/auth-brand";
import { LoadingLabel } from "@/components/ui/loading-label";
import { authSubmitClassName } from "@/components/ui/auth-field";
import { startGoogleOnboarding } from "@/lib/api/auth";
import { getApiErrorMessage } from "@/lib/api/errors";

function isGoogleAuthorizationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === "https://accounts.google.com" &&
      url.pathname === "/o/oauth2/v2/auth" &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export default function GoogleOnboardingPage() {
  const searchParams = useSearchParams();
  const callbackErrorDetail = searchParams.get("detail")?.trim();
  const callbackError =
    searchParams.get("error") === "oauth_failed"
      ? callbackErrorDetail || "Không thể liên kết tài khoản Google. Vui lòng thử lại."
      : "";
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState(callbackError);

  useEffect(() => {
    setError(callbackError);
  }, [callbackError]);

  async function startGoogleLink() {
    if (isStarting) return;

    setIsStarting(true);
    setError("");
    try {
      const { authorization_url: authorizationUrl } = await startGoogleOnboarding();
      if (!isGoogleAuthorizationUrl(authorizationUrl)) {
        throw new Error("Invalid Google authorization URL");
      }
      window.location.assign(authorizationUrl);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "Không thể bắt đầu liên kết Google. Vui lòng thử lại.",
        ),
      );
      setIsStarting(false);
    }
  }

  return (
    <main className="auth-screen flex items-center justify-center px-4">
      <section className="auth-card max-w-[400px]">
        <div className="auth-card-header">
          <AuthBrand />
          <h1 className="page-title-text text-gray-950">Liên kết tài khoản Google</h1>
          <p className="form-message-text mt-1 text-gray-500">
            Dùng đúng tài khoản Google có email bạn vừa xác minh để đồng bộ ảnh đại diện.
          </p>
        </div>

        <div className="flex flex-col gap-4 pt-2">
          {error ? (
            <p
              role="alert"
              className="form-message-text rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700"
            >
              {error}
            </p>
          ) : null}

          <button
            type="button"
            disabled={isStarting}
            onClick={() => void startGoogleLink()}
            className={authSubmitClassName}
          >
            {isStarting ? <LoadingLabel label="Đang chuyển đến Google" /> : "Tiếp tục với Google"}
          </button>

          <Link href="/login" className="auth-action-link text-center">
            Huỷ và quay lại đăng nhập
          </Link>
        </div>
      </section>
    </main>
  );
}
