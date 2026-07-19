import { describe, expect, it } from "vitest";
import type { BiomeVisualState } from "./biome_visual_state.js";
import {
  biomeVisualMaterialStateSignature,
  injectBiomeVisualCustomFoliageShader,
  resolveBiomeVisualMaterialState,
  resolveGrassSeasonalColor,
} from "./biome_visual_material_routing.js";

function state(overrides: Partial<BiomeVisualState> = {}): BiomeVisualState {
  return {
    enabled: true,
    seasonT: 0.5,
    green: 1,
    autumn: 0,
    bloom: 0.5,
    snowlineM: 1_500,
    glacialMurkiness: 0,
    morningMist: 0,
    pollenAmount: 0,
    frostAmount: 0,
    wetness: 0,
    ...overrides,
  };
}

describe("biome visual material routing", () => {
  it("resolves a neutral response when the shared state is unavailable", () => {
    expect(resolveBiomeVisualMaterialState(null)).toEqual({
      enabled: 0,
      green: 1,
      autumn: 0,
      bloom: 1,
      snowlineM: 1_000_000,
      frost: 0,
      dew: 0,
    });
  });

  it("derives dew from wetness without stacking it on frost", () => {
    const resolved = resolveBiomeVisualMaterialState(state({ wetness: 0.8, frostAmount: 0.25 }));
    expect(resolved.frost).toBe(0.25);
    expect(resolved.dew).toBeCloseTo(0.6);
  });

  it("makes low-green grass drier and frost grass cooler", () => {
    const source = [0.18, 0.34, 0.12] as const;
    const dry = resolveGrassSeasonalColor(
      source,
      resolveBiomeVisualMaterialState(state({ green: 0.15, autumn: 0.8 })),
    );
    const frost = resolveGrassSeasonalColor(
      source,
      resolveBiomeVisualMaterialState(state({ frostAmount: 1 })),
    );

    expect(dry[0] / dry[1]).toBeGreaterThan(source[0] / source[1]);
    expect(frost[2]).toBeGreaterThan(source[2]);
  });

  it("changes the material signature only when a routed value changes", () => {
    const first = resolveBiomeVisualMaterialState(state());
    const same = resolveBiomeVisualMaterialState(state());
    const changed = resolveBiomeVisualMaterialState(state({ bloom: 0.9 }));

    expect(biomeVisualMaterialStateSignature(first)).toBe(biomeVisualMaterialStateSignature(same));
    expect(biomeVisualMaterialStateSignature(first)).not.toBe(biomeVisualMaterialStateSignature(changed));
  });

  it("injects uniforms and output tint into custom WebGL foliage shaders", () => {
    const shader = injectBiomeVisualCustomFoliageShader(
      "void main() { gl_FragColor = vec4(albedo, coverage); }",
      false,
    );

    expect(shader).toContain("uniform float uBiomeVisualGreen;");
    expect(shader).toContain("vec3 biomeVisualFoliageColor");
    expect(shader).toContain("gl_FragColor.rgb = biomeVisualFoliageColor(gl_FragColor.rgb);");
  });

  it("keeps GLSL version directives first", () => {
    const shader = injectBiomeVisualCustomFoliageShader(
      "#version 300 es\nout vec4 fragColor;\nvoid main() { gl_FragColor = vec4(1.0); }",
      true,
    );

    expect(shader?.startsWith("#version 300 es\n")).toBe(true);
    expect(shader).toContain("uBiomeVisualBloom");
  });

  it("does not modify shaders without a fragment output", () => {
    expect(injectBiomeVisualCustomFoliageShader("void main() {}", false)).toBeNull();
  });
});
