import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceDir = dirname(fileURLToPath(import.meta.url));

describe("terraform menu", () => {
  it("uses available material slots rather than render-active slots", () => {
    const source = readFileSync(resolve(sourceDir, "terraform_menu.ts"), "utf8");

    expect(source).toContain("materialController.availableTerrainSlots()");
    expect(source).not.toContain("materialController.activeTerrainSlots()");
  });
});
