import type { UserMe } from "@/lib/api/auth";

type ManagementIdentity = Pick<UserMe, "role" | "is_owner"> | null | undefined;

/**
 * Mirrors the backend Principal.is_management invariant.
 *
 * The owner is exposed with the effective `dev` role, while delegated
 * managers use `admin`. Keep this decision in one place so owner controls do
 * not disappear when a page is rendered from fresh `/auth/me` data.
 */
export function isManagementUser(user: ManagementIdentity): boolean {
  return Boolean(user && (user.is_owner || user.role === "dev" || user.role === "admin"));
}
