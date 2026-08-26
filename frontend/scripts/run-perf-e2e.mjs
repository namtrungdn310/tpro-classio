import { spawnSync } from "node:child_process";

// Run only the R8 performance E2E spec on the default (chromium) project so
// the gate is fast and deterministic; Firefox path is covered by the regular
// E2E suite.  Intentionally separate from `test:e2e:schedule`.
const spec = "tests/e2e/performance.spec.ts";

const result = spawnSync(
  "npx",
  ["playwright", "test", spec, "--project=chromium"],
  { stdio: "inherit", windowsHide: true, shell: true },
);

process.exit(result.status ?? 1);
