import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function findTestFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        return findTestFiles(entryPath);
      }
      return entry.isFile() && entry.name.endsWith(".test.ts") ? [entryPath] : [];
    })
    .sort((left, right) => left.localeCompare(right));
}

const testFiles = findTestFiles(resolve("tests"));
if (testFiles.length === 0) {
  process.stderr.write("No frontend test files were discovered.\n");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...testFiles],
  {
    stdio: "inherit",
    windowsHide: true,
  },
);

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
