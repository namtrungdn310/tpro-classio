import assert from "node:assert/strict";
import test from "node:test";
import { buildPrivateAvatarResponse } from "../src/lib/server/backend-image-response";

test("avatar proxy preserves binary WebP bytes and safe cache validators", async () => {
  const bytes = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x00, 0xff, 0x80, 0x7f]);
  const upstream = new Response(bytes, {
    headers: {
      "Content-Type": "image/webp",
      ETag: '"avatar-hash"',
      "Set-Cookie": "must-not-cross-bff=secret",
      "X-Upstream-Debug": "private",
    },
  });

  const response = buildPrivateAvatarResponse(upstream);

  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.equal(response.headers.get("etag"), '"avatar-hash"');
  assert.equal(response.headers.get("cache-control"), "private, max-age=3600");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("x-upstream-debug"), null);
});

test("avatar proxy supports 304 and rejects content-type confusion", () => {
  const notModified = buildPrivateAvatarResponse(
    new Response(null, { status: 304, headers: { ETag: '"avatar-hash"' } }),
  );
  assert.equal(notModified.status, 304);
  assert.equal(notModified.body, null);

  assert.throws(
    () => buildPrivateAvatarResponse(new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } })),
    /Unexpected private avatar content type/,
  );
});
