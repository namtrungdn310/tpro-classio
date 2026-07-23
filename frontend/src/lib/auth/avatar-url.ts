const AVATAR_VERSION_PATTERN = /^[a-f0-9]{16}$/;

/** Accept only the authenticated, same-origin private-avatar BFF route. */
export function isPrivateAvatarUrl(value: string, userId: string): boolean {
  const prefix = `/api/proxy/auth/avatars/${userId}?v=`;
  return value.startsWith(prefix) && AVATAR_VERSION_PATTERN.test(value.slice(prefix.length));
}
