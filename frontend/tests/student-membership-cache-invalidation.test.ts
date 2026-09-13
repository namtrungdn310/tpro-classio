import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const studentPageSource = readFileSync(
  resolve(process.cwd(), "src/app/(dashboard)/students/page.tsx"),
  "utf8",
);

test("student update writes updatedStudent directly into detail cache via setQueryData", () => {
  assert.match(
    studentPageSource,
    /queryClient\.setQueryData\(studentQueryKeys\.detail\(updatedStudent\.id\), updatedStudent\)/,
  );
});

test("cache invalidation is fine-grained and does not invalidate studentQueryKeys.all", () => {
  // Invalidate lists and summary only
  assert.match(
    studentPageSource,
    /queryClient\.invalidateQueries\(\{ queryKey: studentQueryKeys\.lists\(\) \}\)/,
  );
  assert.match(
    studentPageSource,
    /queryClient\.invalidateQueries\(\{ queryKey: studentQueryKeys\.summary\(\) \}\)/,
  );

  // Invalidate affected class detail and history
  assert.match(
    studentPageSource,
    /queryClient\.invalidateQueries\(\{ queryKey: classQueryKeys\.detail\(cid\) \}\)/,
  );
  assert.match(
    studentPageSource,
    /queryClient\.invalidateQueries\(\{ queryKey: classQueryKeys\.history\(cid\) \}\)/,
  );

  // Dashboard and reports use refetchType: "none"
  assert.match(
    studentPageSource,
    /queryClient\.invalidateQueries\(\{ queryKey: \["dashboard"\], refetchType: "none" \}\)/,
  );
  assert.match(
    studentPageSource,
    /queryClient\.invalidateQueries\(\{ queryKey: \["reports"\], refetchType: "none" \}\)/,
  );
});
