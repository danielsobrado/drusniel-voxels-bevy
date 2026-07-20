import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const systemSource = readFileSync(new URL("./system.ts", import.meta.url), "utf8");

describe("dressing exclusion revision refresh", () => {
  it("treats persistence changes as a dispatch trigger", () => {
    expect(systemSource).toContain("const persistenceChanged");
    expect(systemSource).toContain("!moved && !editsChanged && !persistenceChanged && !periodicRefresh");
  });
});
