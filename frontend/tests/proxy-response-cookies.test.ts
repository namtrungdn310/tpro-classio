import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import {
  ACCESS_TOKEN_COOKIE_KEY,
  DEVICE_ID_COOKIE_KEY,
  REFRESH_TOKEN_COOKIE_KEY,
} from "../src/lib/auth/session";
import { applyProxyResponseCookies } from "../src/lib/server/proxy-response-cookies";

function readSetCookies(response: NextResponse): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
}

test("rotated session cookies survive binary, 304 and retry-error response finalization", () => {
  for (const response of [
    new NextResponse(Uint8Array.from([0x52, 0x49, 0x46, 0x46]), {
      headers: { "Content-Type": "image/webp" },
    }),
    new NextResponse(null, { status: 304 }),
    NextResponse.json({ detail: "Không kết nối được máy chủ." }, { status: 502 }),
  ]) {
    applyProxyResponseCookies(response, {
      session: {
        access_token: "rotated-access",
        refresh_token: "rotated-refresh",
      },
      deviceId: "stable-device",
    });

    const setCookies = readSetCookies(response).join("\n");
    assert.match(setCookies, new RegExp(`${ACCESS_TOKEN_COOKIE_KEY}=rotated-access`));
    assert.match(setCookies, new RegExp(`${REFRESH_TOKEN_COOKIE_KEY}=rotated-refresh`));
    assert.match(setCookies, new RegExp(`${DEVICE_ID_COOKIE_KEY}=stable-device`));
    assert.doesNotMatch(setCookies, /rotated-access[^\n]*; Max-Age=0/);
    assert.doesNotMatch(setCookies, /rotated-refresh[^\n]*; Max-Age=0/);
  }
});

test("explicit session clearing wins over a newly issued session", () => {
  const response = NextResponse.json({ ok: true });
  applyProxyResponseCookies(response, {
    session: { access_token: "unused-access", refresh_token: "unused-refresh" },
    clearSession: true,
  });

  const setCookies = readSetCookies(response).join("\n");
  assert.match(setCookies, new RegExp(`${ACCESS_TOKEN_COOKIE_KEY}=;`));
  assert.match(setCookies, new RegExp(`${REFRESH_TOKEN_COOKIE_KEY}=;`));
  assert.doesNotMatch(setCookies, /unused-access|unused-refresh/);
});
