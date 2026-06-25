import * as THREE from "three";
import {
  uniform,
  vec3,
  vec4,
  wgslFn,
} from "three/tsl";
import type { BorderCoastOceanConfig } from "../config/borderCoastOceanConfig.js";
import surfBandWgsl from "../shaders/surfBand.wgsl?raw";
import { extractWgslFunction } from "../shaders/wgslFunction.js";
import { createCoastOceanTransitionGpu } from "./coastOceanTransition.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export const SURF_BAND_WGSL = surfBandWgsl;

export interface SurfMaskGpuHandle {
  alphaNode: TslNode;
  tintNode: TslNode;
  setTime(timeSeconds: number): void;
}

const surfHash = wgslFn(extractWgslFunction(SURF_BAND_WGSL, "surf_hash"));
const surfHash2 = wgslFn(
  extractWgslFunction(SURF_BAND_WGSL, "surf_hash2"),
  [surfHash] as any,
);
const surfNoise2 = wgslFn(
  extractWgslFunction(SURF_BAND_WGSL, "surf_noise2"),
  [surfHash2] as any,
);
const surfCenteredBand = wgslFn(
  extractWgslFunction(SURF_BAND_WGSL, "surf_centered_band"),
);
const surfBandStyle = wgslFn(
  extractWgslFunction(SURF_BAND_WGSL, "surf_band_style"),
  [
    surfNoise2,
    surfCenteredBand,
  ] as any,
);

/**
 * Builds the WebGPU surf mask. Coast distance, rounded corners, coast-type
 * selection/blending, procedural noise, and animation all execute in WGSL.
 */
export function createSurfMaskGpu(
  worldXZ: TslNode,
  config: BorderCoastOceanConfig,
  seed: number,
): SurfMaskGpuHandle {
  const transition = createCoastOceanTransitionGpu(worldXZ, config, seed);
  const uSurfWidths = uniform(new THREE.Vector3(
    config.surf.beach_foam_width_m,
    config.surf.cliff_foam_width_m,
    config.surf.reef_foam_width_m,
  ));
  const uSurfParams = uniform(new THREE.Vector4(
    config.surf.foam_noise_scale,
    config.surf.foam_speed,
    config.surf.shore_choppiness,
    0,
  ));

  const styleNode = surfBandStyle({
    world_xz: worldXZ,
    transition_primary: transition.primary,
    transition_secondary: transition.secondary,
    surf_widths: uSurfWidths,
    surf_params: uSurfParams,
    seed_value: (seed ^ config.coast.seed_offset) >>> 0,
  }) as TslNode;

  return {
    alphaNode: config.surf.enabled && config.coast.enabled ? styleNode.w : vec4(0).x,
    tintNode: styleNode.xyz,
    setTime(timeSeconds) {
      uSurfParams.value.w = Math.max(0, timeSeconds);
    },
  };
}

export function surfFoamColorNode(config: BorderCoastOceanConfig): TslNode {
  const color = new THREE.Color(config.deep_ocean.shading.foam_color);
  return vec3(color.r, color.g, color.b);
}
