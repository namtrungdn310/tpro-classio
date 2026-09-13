import { cp, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const standaloneRoot = join(root, ".next", "standalone");

// `next build` intentionally leaves static/public assets outside the standalone
// tree. Docker copies both directories in separate layers; the production-path
// E2E launcher must reproduce that exact artifact layout before starting it.
await mkdir(join(standaloneRoot, ".next"), { recursive: true });
await cp(join(root, ".next", "static"), join(standaloneRoot, ".next", "static"), {
  recursive: true,
  force: true,
});
await cp(join(root, "public"), join(standaloneRoot, "public"), {
  recursive: true,
  force: true,
});

const child = spawn(process.execPath, [join(standaloneRoot, "server.js")], {
  cwd: standaloneRoot,
  env: {
    ...process.env,
    PORT: process.env.PORT ?? "3100",
    HOSTNAME: process.env.HOSTNAME ?? "127.0.0.1",
  },
  stdio: "inherit",
});

const forward = (signal) => {
  if (!child.killed) child.kill(signal);
};

process.on("SIGINT", () => forward("SIGINT"));
process.on("SIGTERM", () => forward("SIGTERM"));
child.on("error", (error) => {
  console.error("Unable to start standalone E2E server:", error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
