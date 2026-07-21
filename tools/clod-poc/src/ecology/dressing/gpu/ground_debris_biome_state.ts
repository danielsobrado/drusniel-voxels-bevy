import { uniform } from "three/tsl";
import type { ResolvedBiomeVisualMaterialState } from "../../../environment/biome_visual_material_state.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export interface GroundDebrisBiomeUniforms {
  readonly enabled: TslNode;
  readonly autumn: TslNode;
  readonly frost: TslNode;
  readonly dew: TslNode;
  readonly snowlineM: TslNode;
}

const uniforms: GroundDebrisBiomeUniforms = Object.freeze({
  enabled: uniform(0),
  autumn: uniform(0),
  frost: uniform(0),
  dew: uniform(0),
  snowlineM: uniform(1_000_000),
});

let signature = "";

export function groundDebrisBiomeUniforms(): GroundDebrisBiomeUniforms {
  return uniforms;
}

export function updateGroundDebrisBiomeState(state: ResolvedBiomeVisualMaterialState): boolean {
  const nextSignature = [
    state.enabled,
    state.autumn,
    state.frost,
    state.dew,
    state.snowlineM,
  ].map((value) => value.toFixed(5)).join("|");
  if (nextSignature === signature) return false;
  signature = nextSignature;
  uniforms.enabled.value = state.enabled;
  uniforms.autumn.value = state.autumn;
  uniforms.frost.value = state.frost;
  uniforms.dew.value = state.dew;
  uniforms.snowlineM.value = state.snowlineM;
  return true;
}

export function resetGroundDebrisBiomeStateForTests(): void {
  signature = "";
  uniforms.enabled.value = 0;
  uniforms.autumn.value = 0;
  uniforms.frost.value = 0;
  uniforms.dew.value = 0;
  uniforms.snowlineM.value = 1_000_000;
}
