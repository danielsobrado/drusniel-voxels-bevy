import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  WATER_FOAM_MAX_COVERAGE,
  WATER_FOAM_PATTERN_END,
  WATER_FOAM_PATTERN_START,
  WATER_FOAM_RIVER_SHORE_ATTENUATION,
  WATER_FOAM_SHORE_DISTANCE_WEIGHT,
} from "./water_foam_model.js";
import { WATER_FRAG } from "./water_glsl_fragment.js";

const SOURCE = readFileSync(new URL("./water_glsl_fragment.ts", import.meta.url), "utf8");

describe("WebGL water foam parity", () => {
  it("injects the canonical foam constants into the shader", () => {
    expect(WATER_FRAG).toContain(String(WATER_FOAM_PATTERN_START));
    expect(WATER_FRAG).toContain(String(WATER_FOAM_PATTERN_END));
    expect(WATER_FRAG).toContain(String(WATER_FOAM_SHORE_DISTANCE_WEIGHT));
    expect(WATER_FRAG).toContain(String(WATER_FOAM_RIVER_SHORE_ATTENUATION));
    expect(WATER_FRAG).toContain(String(WATER_FOAM_MAX_COVERAGE));
  });

  it("requires speed and drop together and removes the rapid foam floor", () => {
    expect(WATER_FRAG).toContain("riverFast * riverDrop * riverWeight");
    expect(WATER_FRAG).toContain("(shoreSource + rapidSource) * breakup * wetFade");
    expect(WATER_FRAG).not.toContain("0.25 + 0.75 * breakup");
  });

  it("attenuates river shoreline foam and the distance fallback", () => {
    expect(WATER_FRAG).toContain("distanceContact * 0.35");
    expect(WATER_FRAG).toContain("mix(1.0, 0.28, riverWeight)");
    expect(WATER_FRAG).not.toContain("float bankContact = max(\n      1.0 - smoothstep");
  });

  it("lights foam from the environment instead of mixing flat white", () => {
    expect(WATER_FRAG).toContain("float waterLuminance");
    expect(WATER_FRAG).toContain("vec3 litFoam = uFoamColor * foamLighting");
    expect(WATER_FRAG).toContain("mix(litWater, litFoam, foam)");
    expect(WATER_FRAG).not.toContain("mix(litWater, uFoamColor, foam)");
  });

  it("keeps canonical values imported rather than duplicated in TypeScript", () => {
    expect(SOURCE).toContain("WATER_FOAM_PATTERN_START");
    expect(SOURCE).toContain("WATER_FOAM_MAX_COVERAGE");
  });
});
