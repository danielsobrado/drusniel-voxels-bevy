import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DEEP_SHADER_SOURCE = readFileSync(new URL("./deep_ocean_material.ts", import.meta.url), "utf8");
const DEEP_NODE_SOURCE = readFileSync(new URL("./deep_ocean_node_material.ts", import.meta.url), "utf8");
const DEEP_VISUAL_SOURCE = readFileSync(new URL("./deep_ocean_visual.ts", import.meta.url), "utf8");
const WATER_CONFIG_SOURCE = readFileSync(new URL("./waterConfig.ts", import.meta.url), "utf8");
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
    for (const source of [WATER_CONFIG_SOURCE, CLIPMAP_SHADER_SOURCE]) {
      expect(source).toContain("0.025");
      expect(source).toContain("0.10");
    }
    for (const source of [DEEP_SHADER_SOURCE, DEEP_NODE_SOURCE, CLIPMAP_SHADER_SOURCE]) {
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

  it("keeps deep ocean fog driven by border ocean shading config", () => {
    expect(DEEP_SHADER_SOURCE).toContain("fogDistanceM");
    expect(DEEP_SHADER_SOURCE).toContain("params.fogDistanceM");
    expect(DEEP_VISUAL_SOURCE).toContain("shading.fogFarM / NODE_FOG_DISTANCE_SCALE");
  });

  it("keeps reference-style sky reflection on the visible clipmap shader", () => {
    expect(CLIPMAP_SHADER_SOURCE).toContain("skyReflection");
    expect(CLIPMAP_SHADER_SOURCE).toContain("envReflection");
    expect(CLIPMAP_SHADER_SOURCE).toContain("384.0");
  });
});
