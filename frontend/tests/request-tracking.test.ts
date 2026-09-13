import assert from "node:assert/strict";
import test from "node:test";

import {
  clearRequestTrace,
  completeRequestTracking,
  getRequestTrace,
  startRequestTracking,
  subscribeToRequests,
} from "../src/lib/performance/request-tracking";

test("request tracking strips query strings so search terms never reach the trace", () => {
  const meta = startRequestTracking(
    "GET",
    "/api/proxy/students?q=Nguyen%20Van%20A&page=2",
  );
  assert.equal(meta.path, "/api/proxy/students");
  assert.match(meta.id, /^[0-9a-f]{16}$/);
});

test("completed requests expose timing, status and response size", () => {
  clearRequestTrace();
  const meta = startRequestTracking("GET", "/api/proxy/classes");
  const startedAt = meta.startedAt;
  completeRequestTracking(meta, 200, 4096);

  const [entry] = getRequestTrace();
  assert.equal(entry.method, "GET");
  assert.equal(entry.path, "/api/proxy/classes");
  assert.equal(entry.status, 200);
  assert.equal(entry.responseBytes, 4096);
  assert.equal(entry.startedAt, startedAt);
  assert.ok(entry.durationMs >= 0);
  assert.ok(entry.completedAt >= entry.startedAt);
});

test("duplicate requests within the same burst are counted", () => {
  clearRequestTrace();
  const first = startRequestTracking("GET", "/api/proxy/fees");
  completeRequestTracking(first, 200, 10);
  const second = startRequestTracking("GET", "/api/proxy/fees");
  completeRequestTracking(second, 200, 10);

  const entries = getRequestTrace();
  assert.equal(entries[1].duplicates, 1);
});

test("errors record the status and a stable error code without PII", () => {
  clearRequestTrace();
  const meta = startRequestTracking("POST", "/api/proxy/classes");
  completeRequestTracking(meta, null, null, "ERR_NETWORK");

  const [entry] = getRequestTrace();
  assert.equal(entry.status, null);
  assert.equal(entry.error, "ERR_NETWORK");
  assert.equal(entry.responseBytes, null);
});

test("subscribers receive every new trace snapshot", () => {
  clearRequestTrace();
  const seen: number[] = [];
  const unsubscribe = subscribeToRequests((trace) => seen.push(trace.length));

  const meta = startRequestTracking("GET", "/api/proxy/classes");
  completeRequestTracking(meta, 200, 10);

  assert.deepEqual(seen, [1]);
  unsubscribe();
  const other = startRequestTracking("GET", "/api/proxy/classes");
  completeRequestTracking(other, 200, 10);
  assert.deepEqual(seen, [1]);
});

test("trace is bounded to a fixed ring size", () => {
  clearRequestTrace();
  for (let index = 0; index < 300; index += 1) {
    const meta = startRequestTracking("GET", "/api/proxy/classes");
    completeRequestTracking(meta, 200, 10);
  }
  const trace = getRequestTrace();
  assert.ok(trace.length <= 120);
  assert.equal(trace[trace.length - 1].id, trace[trace.length - 1].id);
});

test("clearing resets the trace and notifies subscribers", () => {
  clearRequestTrace();
  const meta = startRequestTracking("GET", "/api/proxy/classes");
  completeRequestTracking(meta, 200, 10);
  assert.equal(getRequestTrace().length, 1);

  let notified = false;
  const unsubscribe = subscribeToRequests(() => {
    notified = true;
  });
  clearRequestTrace();
  assert.equal(getRequestTrace().length, 0);
  assert.equal(notified, true);
  unsubscribe();
});