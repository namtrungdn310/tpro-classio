import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HOST = "127.0.0.1";
const PORT = Number(process.env.E2E_PORT ?? 8788);

/** Compile the app's Tailwind source so harness pages get real utility CSS. */
const postcssTailwindPlugin = {
  name: "postcss-tailwind",
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async (args) => {
      const source = await readFile(args.path, "utf8");
      const result = await postcss([tailwindcss]).process(source, {
        from: args.path,
      });
      return { contents: result.css, loader: "css" };
    });
  },
};

const dir = await mkdtemp(join(tmpdir(), "tpro-e2e-"));

await build({
  entryPoints: [
    join(ROOT, "src/app/globals.css"),
    join(ROOT, "tests/e2e/schedule-harness.tsx"),
    join(ROOT, "tests/e2e/form-dialog-harness.tsx"),
    join(ROOT, "tests/e2e/class-form-billing-harness.tsx"),
    join(ROOT, "tests/e2e/class-workspace-harness.tsx"),
    join(ROOT, "tests/e2e/makeup-workspace-harness.tsx"),
  ],
  bundle: true,
  format: "esm",
  splitting: true,
  jsx: "automatic",
  outdir: join(dir, "bundles"),
  outbase: ROOT,
  entryNames: "[name]",
  chunkNames: "[name]-[hash]",
  loader: { ".css": "css" },
  plugins: [postcssTailwindPlugin],
  tsconfig: join(ROOT, "tsconfig.json"),
  alias: {
    react: join(ROOT, "node_modules/react"),
    "react-dom": join(ROOT, "node_modules/react-dom"),
    "react-dom/client": join(ROOT, "node_modules/react-dom/client"),
    "next/dynamic": join(ROOT, "scripts/e2e-dynamic-shim.tsx"),
  },
});

const htmlPage = (title, script) => `<!doctype html>
<html lang="vi">
  <head><meta charset="utf-8" /><title>${title}</title>
  <link rel="stylesheet" href="/bundles/globals.css" /></head>
  <body><div id="root"></div><script type="module" src="${script}"></script></body>
</html>`;

await writeFile(join(dir, "index.html"), htmlPage("Schedule E2E", "/bundles/schedule-harness.js"));

await writeFile(
  join(dir, "form-dialog.html"),
  htmlPage("Form Dialog E2E", "/bundles/form-dialog-harness.js"),
);

await writeFile(
  join(dir, "class-form-billing.html"),
  htmlPage("Class Form Billing E2E", "/bundles/class-form-billing-harness.js"),
);

await writeFile(
  join(dir, "class-workspace.html"),
  htmlPage("Class Workspace E2E", "/bundles/class-workspace-harness.js"),
);

await writeFile(
  join(dir, "makeup-workspace.html"),
  htmlPage("Make-up Workspace E2E", "/bundles/makeup-workspace-harness.js"),
);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);

  // API stubs cho make-up workspace harness (không cần backend thật).
  const apiPath = url.pathname.replace(/^\/api\/proxy/, "");
  if (req.method === "POST" && /^\/classes\/[^/]+\/schedule-adjustments$/.test(apiPath)) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        adjustment: {
          id: "80000000-0000-4000-8000-000000000001",
          class_id: "11111111-1111-4111-8111-111111111111",
          reason_code: "TEACHER_UNAVAILABLE",
          reason_note: "E2E",
          affected_from: "2026-08-17",
          affected_through: "2026-08-17",
          status: "OPEN",
          created_by: "90000000-0000-4000-8000-000000000001",
          request_id: "00000000-0000-4000-8000-000000000001",
          version: 1,
          created_at: "2026-08-13T00:00:00Z",
          updated_at: "2026-08-13T00:00:00Z",
        },
        exceptions: [],
        billing_impact: "NONE",
      }),
    );
    return;
  }
  if (
    req.method === "POST" &&
    /^\/class-session-exceptions\/[^/]+\/makeup\/preview$/.test(apiPath)
  ) {
    let body = "";
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body || "{}");
    const start = new Date(parsed.replacement_start_at);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        exception_id: "22222222-2222-4222-8222-222222222222",
        original_start_at: "2026-08-17T11:00:00Z",
        original_end_at: "2026-08-17T12:00:00Z",
        duration_minutes: 60,
        replacement_start_at: start.toISOString(),
        replacement_end_at: end.toISOString(),
        staff: [
          {
            staff_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            role: "TEACHER",
            display_name: "Cô Hạnh",
            source_slot_key: "Thứ 2|18:00|19:00",
          },
        ],
        eligible_student_count: 3,
        conflicts: [],
        staff_inactive: [],
        can_schedule: true,
        billing_impact: "NONE",
      }),
    );
    return;
  }

  const file = url.pathname === "/" ? "/index.html" : url.pathname;
  try {
    const body = await readFile(join(dir, file));
    const contentType =
      extname(file) === ".js"
        ? "text/javascript"
        : extname(file) === ".css"
          ? "text/css"
          : "text/html";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

// Cleanup idempotent cho MỌI đường kết thúc: SIGINT, SIGTERM, uncaughtException,
// unhandledRejection và normal close. Chạy nhiều lần đều an toàn.
let cleanedUp = false;
async function cleanup(exitCode = 0) {
  if (cleanedUp) return;
  cleanedUp = true;
  server.close();
  await rm(dir, { recursive: true, force: true });
  process.exit(exitCode);
}

process.on("SIGINT", () => void cleanup(0));
process.on("SIGTERM", () => void cleanup(0));
process.on("uncaughtException", (error) => {
  console.error("uncaughtException in e2e-serve:", error);
  void cleanup(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection in e2e-serve:", reason);
  void cleanup(1);
});
process.on("exit", () => {
  if (!cleanedUp) {
    server.close();
    void rm(dir, { recursive: true, force: true });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`E2E harness served at http://${HOST}:${PORT}`);
});
