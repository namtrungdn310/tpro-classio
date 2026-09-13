import { defineConfig } from "@playwright/test";
const port = process.env.E2E_PORT ?? "8819";

// Dedicated harness ports avoid interfering with a developer's existing app
// or another test run. This server never connects to real backend data.
export default defineConfig({
  testDir: "./tests/e2e", testMatch: ["suspensions.spec.ts", "makeup-workspace.spec.ts"], workers: 1, timeout: 30_000,
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true, viewport: { width: 1280, height: 900 },
    contextOptions: { reducedMotion: "reduce" }, screenshot: "only-on-failure", trace: "retain-on-failure" },
  // External harness mode never starts/stops a developer-owned process.
  webServer: process.env.E2E_EXTERNAL_HARNESS === "1" ? undefined : { command: "node scripts/e2e-serve.mjs", env: { E2E_PORT: port }, url: `http://127.0.0.1:${port}/`, reuseExistingServer: false, timeout: 120_000 },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }, { name: "firefox", use: { browserName: "firefox" } }],
});
