import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceDir = dirname(fileURLToPath(import.meta.url));

describe("stone node material visibility floor", () => {
  it("keeps wet and ambient-lit stones above the black-collapse floor", () => {
    const source = readFileSync(resolve(sourceDir, "stone_node_material.ts"), "utf8");

    expect(source).toContain("const STONE_MIN_LIGHTING = 0.30");
    expect(source).toContain("const STONE_MIN_AO = 0.55");
    expect(source).toContain("rock.mul(vec3(0.62, 0.68, 0.66))");
    expect(source).toContain("material.colorNode = rock.mul(stableLighting)");
  });
});
