import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DEEP_SHADER_SOURCE = readFileSync(new URL("./deep_ocean_material.ts", import.meta.url), "utf8");
const DEEP_NODE_SOURCE = readFileSync(new URL("./deep_ocean_node_material.ts", import.meta.url), "utf8");
const CLIPMAP_SHADER_SOURCE = readFileSync(new URL("./waterMaterial.ts", import.meta.url), "utf8");

describe("deep ocean material", () => {
  it("keeps reference-style sky reflection and sun glints in deep-ocean render paths", () => {
    for (const source of [DEEP_SHADER_SOURCE, DEEP_NODE_SOURCE]) {
      expect(source).toContain("skyReflection");
      expect(source).toContain("512");
      expect(source).toContain("0.92");
      expect(source).toContain("0.75");
    }
  });

  it("keeps deep blue water with teal shallow scattering", () => {
    for (const source of [DEEP_SHADER_SOURCE, DEEP_NODE_SOURCE, CLIPMAP_SHADER_SOURCE]) {
      expect(source).toContain("0.025");
      expect(source).toContain("0.10");
      expect(source).toContain("0.45");
      expect(source).toContain("0.62");
    }
  });

  it("keeps deep ocean displacement in render materials", () => {
    expect(DEEP_SHADER_SOURCE).toContain("uniform vec4 uWaveA");
    expect(DEEP_SHADER_SOURCE).toContain("DEEP_OCEAN_WAVE_COUNT");
    expect(DEEP_NODE_SOURCE).toContain("material.positionNode = displacedPosition");
    expect(DEEP_NODE_SOURCE).toContain("DEEP_OCEAN_GPU_WAVES");
  });

  it("keeps reference-style sky reflection on the visible clipmap shader", () => {
    expect(CLIPMAP_SHADER_SOURCE).toContain("skyReflection");
    expect(CLIPMAP_SHADER_SOURCE).toContain("envReflection");
    expect(CLIPMAP_SHADER_SOURCE).toContain("384.0");
  });
});
