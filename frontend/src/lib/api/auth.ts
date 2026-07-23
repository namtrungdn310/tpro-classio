import { z } from "zod";
import { apiClient } from "@/lib/api/client";
import { isPrivateAvatarUrl } from "@/lib/auth/avatar-url";

const sessionResponseSchema = z.object({
  token_type: z.string().optional(),
  role: z.enum(["admin", "viewer"]),
  is_owner: z.boolean(),
});

export type SessionResponse = z.infer<typeof sessionResponseSchema>;

const authContinuationSchema = z.object({
  message: z.string(),
  requires_mfa: z.literal(true),
  next_step: z.enum(["login_totp", "onboarding_google", "onboarding_totp"]),
});

export type AuthContinuationResponse = z.infer<typeof authContinuationSchema>;

const userMeSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().email(),
    role: z.enum(["admin", "viewer"]),
    username: z.string().nullable(),
    full_name: z.string().nullable(),
    avatar_url: z.string().nullable(),
    is_owner: z.boolean(),
  })
  .superRefine((user, context) => {
    if (user.avatar_url && !isPrivateAvatarUrl(user.avatar_url, user.id)) {
      context.addIssue({
        code: "custom",
        path: ["avatar_url"],
        message: "Invalid private avatar URL",
      });
    }
  });

export type UserMe = z.infer<typeof userMeSchema>;

export type UserAccount = {
  id: string;
  email: string;
  role: string;
  account_status: AccountStatus;
  username: string | null;
  full_name: string | null;
  is_owner: boolean;
  created_at: string | null;
};

export type AccountStatus = "pending" | "active" | "disabled";

const userAccountSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["admin", "viewer"]),
  account_status: z.enum(["pending", "active", "disabled"]),
  username: z.string().nullable(),
  full_name: z.string().nullable(),
  is_owner: z.boolean(),
  created_at: z.string().nullable(),
});

const userAccountsSchema = z.array(userAccountSchema);

export type PasswordResetOtpResponse = {
  reset_token_expires_in_seconds: number;
};

const otpStartResponseSchema = z.object({
  message: z.string(),
  otp_expires_in_seconds: z.number().int().positive().max(3600),
});

export type OtpStartResponse = z.infer<typeof otpStartResponseSchema>;

const totpEnrollResponseSchema = z.object({
  factor_id: z.string().uuid(),
  totp_uri: z.string().startsWith("otpauth://totp/"),
  secret: z.string().regex(/^[A-Z2-7]{16,128}$/),
  qr_code_data_url: z
    .string()
    .max(1_000_000)
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/),
});

export type TotpEnrollResponse = z.infer<typeof totpEnrollResponseSchema>;

export type GoogleOnboardingStartResponse = {
  authorization_url: string;
};

const invitationResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: z.literal("viewer"),
  invite_url: z.string().url(),
  expires_at: z.string().datetime({ offset: true }),
  consumed: z.boolean(),
  revoked: z.boolean(),
  created_at: z.string().datetime({ offset: true }),
});

export type InvitationResponse = z.infer<typeof invitationResponseSchema>;

// ─── Auth ────────────────────────────────────────────────────────────────────

export async function login(
  email: string,
  password: string,
): Promise<SessionResponse | AuthContinuationResponse> {
  const { data } = await apiClient.post<unknown>("/auth/login", {
    email,
    password,
  });
  return z.union([sessionResponseSchema, authContinuationSchema]).parse(data);
}

export function isAuthContinuation(
  response: SessionResponse | AuthContinuationResponse,
): response is AuthContinuationResponse {
  return "requires_mfa" in response && response.requires_mfa === true;
}

export async function registerAccount(
  email: string,
  password: string,
  invitationToken: string,
  username?: string,
): Promise<OtpStartResponse> {
  const { data } = await apiClient.post<unknown>("/auth/register", {
    email,
    password,
    invitation_token: invitationToken,
    username: username || undefined,
  });
  return otpStartResponseSchema.parse(data);
}

export async function resendRegisterOtp(email: string): Promise<OtpStartResponse> {
  const { data } = await apiClient.post<unknown>("/auth/register/resend", { email });
  return otpStartResponseSchema.parse(data);
}

export async function verifyRegisterOtp(
  email: string,
  otp: string,
): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>("/auth/register/verify", {
    email,
    otp,
  });
  return data;
}

export async function startPasswordReset(email: string): Promise<OtpStartResponse> {
  const { data } = await apiClient.post<unknown>("/auth/password/reset/start", { email });
  return otpStartResponseSchema.parse(data);
}

export async function verifyPasswordResetOtp(
  email: string,
  otp: string,
): Promise<PasswordResetOtpResponse> {
  const { data } = await apiClient.post<PasswordResetOtpResponse>(
    "/auth/password/reset/verify-otp",
    { email, otp },
  );
  return data;
}

export async function completePasswordReset(
  newPassword: string,
): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>("/auth/password/reset/complete", {
    new_password: newPassword,
  });
  return data;
}

export async function getMe(): Promise<UserMe> {
  const { data } = await apiClient.get<unknown>("/auth/me");
  return userMeSchema.parse(data);
}

export async function updateMyUsername(username: string): Promise<{ message: string }> {
  const { data } = await apiClient.patch<{ message: string }>("/auth/me/username", { username });
  return data;
}

export async function verifyMyPassword(password: string): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>("/auth/me/password/verify", {
    password,
  });
  return data;
}

export async function logout(): Promise<void> {
  await apiClient.post("/auth/logout", {});
}

// ─── TOTP / MFA ──────────────────────────────────────────────────────────────

export async function startGoogleOnboarding(): Promise<GoogleOnboardingStartResponse> {
  const { data } = await apiClient.post<GoogleOnboardingStartResponse>(
    "/auth/onboarding/google/start",
  );
  return data;
}

export async function enrollTotp(): Promise<TotpEnrollResponse> {
  const { data } = await apiClient.post<unknown>("/auth/onboarding/totp/enroll");
  return totpEnrollResponseSchema.parse(data);
}

export async function verifyOnboardingTotp(code: string): Promise<{ message: string }> {
  const { data } = await apiClient.post<unknown>("/auth/onboarding/totp/verify", {
    code,
  });
  return z.object({ message: z.string() }).parse(data);
}

export async function getRecoveryCodes(): Promise<string[]> {
  const { data } = await apiClient.post<unknown>("/auth/onboarding/recovery-codes");
  return z.array(z.string().regex(/^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/)).min(1).parse(data);
}

export async function confirmOnboardingRecoveryCodes(): Promise<SessionResponse> {
  const { data } = await apiClient.post<unknown>("/auth/onboarding/recovery/confirm");
  return sessionResponseSchema.parse(data);
}

export async function verifyLoginTotp(code: string): Promise<SessionResponse> {
  const { data } = await apiClient.post<unknown>("/auth/login/totp/verify", { code });
  return sessionResponseSchema.parse(data);
}

export async function verifyLoginRecoveryCode(recoveryCode: string): Promise<SessionResponse> {
  const { data } = await apiClient.post<unknown>("/auth/login/recovery/verify", {
    recovery_code: recoveryCode,
  });
  return sessionResponseSchema.parse(data);
}

// ─── Users ───────────────────────────────────────────────────────────────────

export async function getUsers(): Promise<UserAccount[]> {
  const { data } = await apiClient.get<unknown>("/auth/users");
  return userAccountsSchema.parse(data);
}

export async function updateUserRole(
  userId: string,
  role: "admin" | "viewer",
): Promise<UserAccount> {
  const { data } = await apiClient.patch<UserAccount>(`/auth/users/${userId}/role`, { role });
  return data;
}

export async function updateUserStatus(
  userId: string,
  status: Exclude<AccountStatus, "pending">,
): Promise<UserAccount> {
  const { data } = await apiClient.patch<UserAccount>(`/auth/users/${userId}/status`, { status });
  return data;
}

// ─── Invitations ─────────────────────────────────────────────────────────────

export async function createInvitation(email: string): Promise<InvitationResponse> {
  const { data } = await apiClient.post<unknown>("/auth/invitations", { email });
  return invitationResponseSchema.parse(data);
}
