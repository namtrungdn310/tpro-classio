import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const bffSource = read("src/app/api/proxy/[...path]/route.ts");
const callbackSource = read("src/app/auth/google/callback/route.ts");
const googlePageSource = read("src/app/onboarding/google/page.tsx");
const loginSource = read("src/app/login/page.tsx");
const proxySource = read("src/proxy.ts");
const recoverySource = read("src/app/onboarding/recovery/page.tsx");
const registerSource = read("src/app/register/page.tsx");
const totpSource = read("src/app/onboarding/totp/page.tsx");
const nginxSource = readFileSync(
  new URL("../../nginx/tpro-classio.conf", import.meta.url),
  "utf8",
);
const authApiSource = read("src/lib/api/auth.ts");

test("BFF forwards only the opaque pre-auth cookie in both directions", () => {
  assert.match(bffSource, /FLOW_SESSION_COOKIE_KEY/);
  assert.match(bffSource, /readUpstreamFlowCookie/);
  assert.match(bffSource, /headers\.set\("Cookie", `\$\{FLOW_SESSION_COOKIE_KEY\}=/);
  assert.doesNotMatch(bffSource, /headers\.set\("Cookie", request\.headers\.get\("cookie"\)/);
});

test("temporary BFF failures are never cacheable", () => {
  assert.match(
    bffSource,
    /function buildProxyErrorResponse[\s\S]*"Cache-Control": "no-store"/,
  );
});

test("logout clears every browser auth stage even if upstream revocation is unavailable", () => {
  assert.match(
    bffSource,
    /if \(path === "auth\/logout"\) \{[\s\S]*clearSession: true,[\s\S]*clearPasswordReset: true,[\s\S]*clearFlow: true/,
  );
  assert.match(bffSource, /clearFlowSession: path === "auth\/logout"/);
  assert.match(bffSource, /path === "auth\/logout" \|\|[\s\S]*auth\/password\/reset\/complete/);
});

test("invite secrets are removed from the address bar before onboarding", () => {
  assert.match(registerSource, /window\.history\.replaceState/);
  assert.match(registerSource, /window\.location\.pathname/);
  assert.match(proxySource, /pathname === "\/register"/);
  assert.match(
    nginxSource,
    /location = \/register \{[\s\S]*?access_log off;[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:3000;/,
  );
});

test("Google authorization and callback remain server-controlled", () => {
  assert.match(googlePageSource, /url\.origin === "https:\/\/accounts\.google\.com"/);
  assert.match(googlePageSource, /url\.pathname === "\/o\/oauth2\/v2\/auth"/);
  assert.match(callbackSource, /redirect: "manual"/);
  assert.match(callbackSource, /"Referrer-Policy", "no-referrer"/);
  assert.match(callbackSource, /upstreamTarget\.pathname === "\/onboarding\/totp"/);
  assert.doesNotMatch(callbackSource, /window\.|localStorage|sessionStorage/);
  assert.match(
    nginxSource,
    /location = \/auth\/google\/callback \{[\s\S]*?access_log off;[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:3000;/,
  );
});

test("TOTP provisioning never sends its secret to a third-party QR service", () => {
  assert.match(totpSource, /qr_code_data_url/);
  assert.match(authApiSource, /\^data:image\\\/png;base64/);
  assert.doesNotMatch(totpSource, /qrserver|encodeURIComponent\(totpUri\)|https:\/\//);
});

test("pre-auth and recovery pages are guarded by the correct cookie stage", () => {
  assert.match(proxySource, /"\/onboarding\/google"/);
  assert.match(proxySource, /"\/onboarding\/totp"/);
  assert.match(proxySource, /"\/login\/totp"/);
  assert.match(proxySource, /"\/onboarding\/recovery"/);
  assert.match(proxySource, /PRE_AUTH_PAGES\.has\(pathname\) && !hasFlowSession/);
  assert.doesNotMatch(proxySource, /PROTECTED_PREFIXES[\s\S]*"\/onboarding\/recovery"/);
});

test("onboarding creates the full session only after recovery codes are confirmed", () => {
  assert.doesNotMatch(totpSource, /refresh\(\)/);
  assert.match(totpSource, /router\.replace\("\/onboarding\/recovery"\)/);
  assert.match(recoverySource, /confirmOnboardingRecoveryCodes/);
  assert.match(recoverySource, /await refresh\(\)/);
  assert.match(recoverySource, /fetchStartedRef/);
});

test("login continuations use a closed discriminator rather than an arbitrary redirect", () => {
  assert.match(loginSource, /login_totp: "\/login\/totp"/);
  assert.match(loginSource, /onboarding_google: "\/onboarding\/google"/);
  assert.match(loginSource, /onboarding_totp: "\/onboarding\/totp"/);
  assert.doesNotMatch(loginSource, /next_path|window\.location\.assign\(result/);
});
