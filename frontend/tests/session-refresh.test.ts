import assert from "node:assert/strict";
import test from "node:test";
import {
  SessionRefreshCoordinator,
  type SessionRefreshResult,
} from "../src/lib/server/session-refresh";
import { classifyAuthFailure } from "../src/lib/api/errors";

const refreshedResult: SessionRefreshResult = {
  kind: "refreshed",
  session: {
    access_token: "new-access-token",
    refresh_token: "new-refresh-token",
  },
};

test("refresh coordinator shares one in-flight rotation", async () => {
  const coordinator = new SessionRefreshCoordinator(10_000);
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const rotate = async () => {
    calls += 1;
    await gate;
    return refreshedResult;
  };

  const first = coordinator.run("old-token:device", rotate);
  const concurrent = coordinator.run("old-token:device", rotate);
  release();

  assert.equal(first, concurrent);
  assert.deepEqual(await first, refreshedResult);
  assert.equal(calls, 1);
});

test("refresh coordinator retains the settled result for staggered old-cookie requests", async () => {
  let now = 1_000;
  const coordinator = new SessionRefreshCoordinator(10_000, () => now);
  let calls = 0;
  const rotate = async () => {
    calls += 1;
    return refreshedResult;
  };

  await coordinator.run("old-token:device", rotate);
  now += 2_900;
  const staggered = await coordinator.run("old-token:device", rotate);

  assert.deepEqual(staggered, refreshedResult);
  assert.equal(calls, 1);

  now += 10_001;
  await coordinator.run("old-token:device", rotate);
  assert.equal(calls, 2);
});

test("refresh coordinator does not cache temporary refresh failures", async () => {
  const coordinator = new SessionRefreshCoordinator(10_000);
  let calls = 0;
  const rotate = async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error("temporary outage");
    }
    return refreshedResult;
  };

  await assert.rejects(coordinator.run("old-token:device", rotate));
  assert.deepEqual(await coordinator.run("old-token:device", rotate), refreshedResult);
  assert.equal(calls, 2);
});

test("refresh coordinator bounds cached token generations", async () => {
  const coordinator = new SessionRefreshCoordinator(10_000, Date.now, 2);
  let calls = 0;
  const rotate = async () => {
    calls += 1;
    return refreshedResult;
  };

  await coordinator.run("token-a", rotate);
  await coordinator.run("token-b", rotate);
  await coordinator.run("token-c", rotate);
  await coordinator.run("token-a", rotate);

  assert.equal(calls, 4);
});

test("only a definitive authentication failure invalidates local auth state", () => {
  assert.equal(
    classifyAuthFailure({
      isAxiosError: true,
      response: { status: 401, data: { detail: "Phiên đăng nhập không hợp lệ" } },
    }),
    "unauthenticated",
  );
  assert.equal(
    classifyAuthFailure({
      isAxiosError: true,
      response: {
        status: 401,
        data: { detail: "Phiên đăng nhập đã bị thay thế trên thiết bị khác" },
      },
    }),
    "session-replaced",
  );
  assert.equal(
    classifyAuthFailure({ isAxiosError: true, response: { status: 502, data: {} } }),
    "transient",
  );
  assert.equal(classifyAuthFailure({ isAxiosError: true, code: "ECONNABORTED" }), "transient");
});
