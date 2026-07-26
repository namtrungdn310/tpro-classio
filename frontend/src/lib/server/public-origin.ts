export function normalizePublicAppOrigin(
  configuredValue: string | undefined,
): string | null {
  const configuredOrigin = configuredValue?.trim();
  if (!configuredOrigin) {
    return null;
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(configuredOrigin);
  } catch {
    throw new TypeError("APP_ORIGIN must be an absolute HTTP(S) origin");
  }

  if (
    (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") ||
    parsedOrigin.username ||
    parsedOrigin.password ||
    parsedOrigin.search ||
    parsedOrigin.hash ||
    (parsedOrigin.pathname !== "/" && parsedOrigin.pathname !== "")
  ) {
    throw new TypeError(
      "APP_ORIGIN must not contain credentials, a path, query or fragment",
    );
  }

  return parsedOrigin.origin;
}

export function isLoopbackPublicOrigin(value: string | undefined): boolean {
  try {
    const origin = normalizePublicAppOrigin(value);
    if (!origin) {
      return false;
    }
    const hostname = new URL(origin).hostname;
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}
