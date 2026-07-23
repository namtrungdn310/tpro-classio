const PRIVATE_AVATAR_CACHE_CONTROL = "private, max-age=3600";
const WEBP_CONTENT_TYPE = "image/webp";

function readSafeEtag(headers: Headers): string | null {
  const value = headers.get("etag");
  return value && value.length <= 200 && /^[\x21-\x7e]+$/.test(value) ? value : null;
}

/** Preserve avatar bytes as a stream while rebuilding a minimal safe header set. */
export function buildPrivateAvatarResponse(upstream: Response): Response {
  const isNotModified = upstream.status === 304;
  const contentType = upstream.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (!isNotModified && contentType !== WEBP_CONTENT_TYPE) {
    throw new TypeError("Unexpected private avatar content type");
  }

  const headers = new Headers({
    "Cache-Control": PRIVATE_AVATAR_CACHE_CONTROL,
    "X-Content-Type-Options": "nosniff",
  });
  if (!isNotModified) {
    headers.set("Content-Type", WEBP_CONTENT_TYPE);
  }
  const etag = readSafeEtag(upstream.headers);
  if (etag) {
    headers.set("ETag", etag);
  }

  return new Response(isNotModified ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}
