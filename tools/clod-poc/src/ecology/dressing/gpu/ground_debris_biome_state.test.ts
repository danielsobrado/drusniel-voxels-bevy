import { beforeEach, describe, expect, it } from "vitest";
import type { ResolvedBiomeVisualMaterialState } from "../../../environment/biome_visual_material_state.js";
import {
  groundDebrisBiomeUniforms,
  resetGroundDebrisBiomeStateForTests,
  updateGroundDebrisBiomeState,
} from "./ground_debris_biome_state.js";

const BASE_STATE: ResolvedBiomeVisualMaterialState = Object.freeze({
  enabled: 1,
  green: 0.4,
  autumn: 0.7,
  bloom: 0.2,
  snowlineM: 900,
  frost: 0.35,
  dew: 0.6,
});

describe("shared ground-debris biome uniforms", () => {
  beforeEach(() => resetGroundDebrisBiomeStateForTests());

  it("updates only the fields consumed by ground debris", () => {
    expect(updateGroundDebrisBiomeState(BASE_STATE)).toBe(true);
    const uniforms = groundDebrisBiomeUniforms();
    expect(uniforms.enabled.value).toBe(1);
    expect(uniforms.autumn.value).toBe(0.7);
    expect(uniforms.frost.value).toBe(0.35);
    expect(uniforms.dew.value).toBe(0.6);
    expect(uniforms.snowlineM.value).toBe(900);
  });

  it("does not rewrite shared uniforms when the consumed signature is unchanged", () => {
    expect(updateGroundDebrisBiomeState(BASE_STATE)).toBe(true);
    expect(updateGroundDebrisBiomeState({ ...BASE_STATE, green: 0.9, bloom: 1 })).toBe(false);
    expect(updateGroundDebrisBiomeState({ ...BASE_STATE, autumn: 0.71 })).toBe(true);
  });
});
