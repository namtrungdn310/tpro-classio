import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  getVietnamBankLogoPath,
  POPULAR_VIETNAM_BANKS,
} from "../src/lib/vietnam-banks";

test("manual bank picker keeps a focused list of popular Vietnamese banks with local logos", () => {
  assert.equal(POPULAR_VIETNAM_BANKS.length, 20);
  assert.deepEqual(
    POPULAR_VIETNAM_BANKS.map((bank) => bank.code).sort(),
    [
      "ICB", "VCB", "BIDV", "VBA", "MB", "TCB", "ACB", "VPB", "TPB", "STB",
      "HDB", "VIB", "SHB", "OCB", "MSB", "EIB", "LPB", "SEAB", "NAB", "ABB",
    ].sort(),
  );

  for (const bank of POPULAR_VIETNAM_BANKS) {
    const logoPath = getVietnamBankLogoPath(bank.code);
    assert.equal(logoPath, `/bank-logos/${bank.code}.png`);
    assert.ok(existsSync(resolve("public", logoPath.slice(1))), `missing logo for ${bank.code}`);
  }
});
