import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const bootstrapDir = dirname(fileURLToPath(import.meta.url));

function readSource(name: string): string {
  return readFileSync(resolve(bootstrapDir, name), "utf8");
}

describe("clod_poc_bootstrap NAADF wiring", () => {
  it("enables far shell only for named NAADF scenes, not bare ?naadf=1", () => {
    const source = readSource("clod_poc_bootstrap.ts");
    expect(source).toContain("isNaadfScene(queryScene)");
    expect(source).not.toMatch(/\|\|\s*isNaadfCapable\s*;/);
  });
});
