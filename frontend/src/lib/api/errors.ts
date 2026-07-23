import axios from "axios";

const SESSION_REPLACED_DETAIL = "Phiên đăng nhập đã bị thay thế trên thiết bị khác";

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (!axios.isAxiosError(error)) {
    return fallback;
  }

  if (error.code === "ECONNABORTED") {
    return "Máy chủ phản hồi quá lâu. Vui lòng thử lại.";
  }

  if (!error.response) {
    return "Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối và thử lại.";
  }

  if (error.response.status >= 500) {
    return "Hệ thống đang tạm thời gián đoạn. Vui lòng thử lại sau ít phút.";
  }

  const detail = error.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) {
    return normalizeErrorMessage(detail.trim(), fallback);
  }

  if (Array.isArray(detail) && detail.length > 0) {
    const firstErr = detail[0];
    if (typeof firstErr === "object" && firstErr !== null && "msg" in firstErr) {
      const msg = String(firstErr.msg);
      if (msg.includes("string should match pattern") || msg.includes("string does not match pattern")) {
        return "Thông tin nhập vào chưa đúng định dạng.";
      }
      return normalizeErrorMessage(msg, fallback);
    }
  }

  return fallback;
}

export function getApiErrorDetail(error: unknown): string | null {
  if (!axios.isAxiosError(error)) {
    return null;
  }

  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail.trim() : null;
}

export function isSessionReplacedError(error: unknown): boolean {
  const detail = getApiErrorDetail(error);
  return detail === SESSION_REPLACED_DETAIL;
}

export type AuthFailureKind = "session-replaced" | "unauthenticated" | "transient";

/** Only a definitive 401 is allowed to discard local authenticated state. */
export function classifyAuthFailure(error: unknown): AuthFailureKind {
  if (isSessionReplacedError(error)) {
    return "session-replaced";
  }
  if (axios.isAxiosError(error) && error.response?.status === 401) {
    return "unauthenticated";
  }
  return "transient";
}

export function buildSessionReplacedLoginUrl(): string {
  return "/login?reason=session-replaced";
}

function normalizeErrorMessage(message: string, fallback: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes("field required")) {
    return "Vui lòng nhập đầy đủ thông tin bắt buộc.";
  }
  if (normalized.includes("value is not a valid email")) {
    return "Email chưa đúng định dạng. Ví dụ: ten@example.com.";
  }
  if (normalized.includes("network error")) {
    return "Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối và thử lại.";
  }
  if (normalized.includes("timeout")) {
    return "Máy chủ phản hồi quá lâu. Vui lòng thử lại.";
  }

  return message || fallback;
}
