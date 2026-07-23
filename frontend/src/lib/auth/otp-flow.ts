const OTP_FLOW_KEY = "tpro_pending_otp";

export type OtpPurpose = "register" | "reset-password";

export type PendingOtpFlow = {
  purpose: OtpPurpose;
  email: string;
  sent_at: number;
  expires_at: number;
};

function isOtpPurpose(value: unknown): value is OtpPurpose {
  return value === "register" || value === "reset-password";
}

export function savePendingOtpFlow(flow: PendingOtpFlow): void {
  window.sessionStorage.setItem(OTP_FLOW_KEY, JSON.stringify(flow));
}

export function createPendingOtpFlow(
  purpose: OtpPurpose,
  email: string,
  expiresInSeconds: number,
): PendingOtpFlow {
  const sentAt = Date.now();
  return {
    purpose,
    email,
    sent_at: sentAt,
    expires_at: sentAt + expiresInSeconds * 1000,
  };
}

export function getPendingOtpFlow(): PendingOtpFlow | null {
  if (typeof window === "undefined") {
    return null;
  }

  const rawFlow = window.sessionStorage.getItem(OTP_FLOW_KEY);
  if (!rawFlow) {
    return null;
  }

  try {
    const parsedFlow = JSON.parse(rawFlow) as Partial<PendingOtpFlow>;
    if (
      !parsedFlow.email ||
      !isOtpPurpose(parsedFlow.purpose) ||
      typeof parsedFlow.sent_at !== "number" ||
      typeof parsedFlow.expires_at !== "number"
    ) {
      clearPendingOtpFlow();
      return null;
    }

    return {
      purpose: parsedFlow.purpose,
      email: parsedFlow.email,
      sent_at: parsedFlow.sent_at,
      expires_at: parsedFlow.expires_at,
    };
  } catch {
    clearPendingOtpFlow();
    return null;
  }
}

export function getOtpRemainingSeconds(expiresAt: number, currentTime = Date.now()): number {
  return Math.max(0, Math.ceil((expiresAt - currentTime) / 1000));
}

export function isOtpExpired(expiresAt: number): boolean {
  return getOtpRemainingSeconds(expiresAt) <= 0;
}

export function formatOtpRemaining(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function clearPendingOtpFlow(): void {
  window.sessionStorage.removeItem(OTP_FLOW_KEY);
}
