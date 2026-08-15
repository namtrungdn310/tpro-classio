import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:8788",
    headless: true,
    viewport: { width: 1440, height: 900 },
    contextOptions: { reducedMotion: "reduce" },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "node scripts/e2e-serve.mjs",
      url: "http://127.0.0.1:8788/",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // The app is built with `output: standalone`; run the generated server
      // so production-path tests exercise the same artifact Docker runs.
      command: "node scripts/e2e-standalone-serve.mjs",
      env: { PORT: "3100", HOSTNAME: "127.0.0.1" },
      url: "http://127.0.0.1:3100/classes",
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
  ],
});
