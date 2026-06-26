import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SHADER_SOURCE = readFileSync(new URL("./deep_ocean_material.ts", import.meta.url), "utf8");
const NODE_SOURCE = readFileSync(new URL("./deep_ocean_node_material.ts", import.meta.url), "utf8");

describe("deep ocean material", () => {
  it("keeps reference-style sky reflection and sun glints in both render paths", () => {
    for (const source of [SHADER_SOURCE, NODE_SOURCE]) {
      expect(source).toContain("skyReflection");
      expect(source).toContain("512");
      expect(source).toContain("0.92");
      expect(source).toContain("0.75");
    }
  });

  it("keeps deep blue water with teal shallow scattering", () => {
    for (const source of [SHADER_SOURCE, NODE_SOURCE]) {
      expect(source).toContain("0.025");
      expect(source).toContain("0.10");
      expect(source).toContain("0.45");
      expect(source).toContain("0.62");
    }
  });
});
