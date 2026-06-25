import type { FixtureDef } from "../../clod/stressFixtures.js";
import type { StressSceneParams } from "../../clod/stress/stressSceneConfig.js";
import {
  buildTerrainForFixture,
  type TerrainBuildResult,
} from "../../clod/stress/stressTerrainFactory.js";
import type * as THREE from "three";

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function coastDistance(x: number, z: number): number {
  return z - (28 + Math.sin(x * 0.055) * 7 + Math.sin(x * 0.017 + 1.3) * 10);
}

export const BORDER_BEACH_FIXTURE: FixtureDef = {
  name: "border_beach",
  description: "Long noisy beach crossing page borders with a shallow reef zone",
  height: (x, z) => {
    const distance = coastDistance(x, z);
    const shore = -2 + distance * 0.045;
    const inland = 5 + Math.sin(x * 0.025) * 0.8 + Math.sin(z * 0.08) * 0.4;
    const blend = smoothstep(70, 120, distance);
    const dune = Math.sin(x * 0.09 + z * 0.035) * 0.7
      * smoothstep(42, 72, distance)
      * (1 - smoothstep(72, 105, distance));
    return shore * (1 - blend) + inland * blend + dune;
  },
  material: (x, z) => {
    const weights = BORDER_BEACH_FIXTURE.materialWeights!(x, z);
    return weights.indexOf(Math.max(...weights));
  },
  materialWeights: (x, z) => {
    const distance = coastDistance(x, z);
    const grass = smoothstep(70, 115, distance);
    const rock = (1 - smoothstep(-8, 12, distance))
      * smoothstep(0.45, 0.9, Math.sin(x * 0.043) * 0.5 + 0.5) * 0.45;
    const sand = Math.max(0, 1 - grass);
    const sum = grass + sand + rock;
    return [grass / sum, sand / sum, rock / sum, 0];
  },
  coastTypeColor: (x, z) => {
    const distance = coastDistance(x, z);
    const reef = distance < 8 && Math.sin(x * 0.043) > 0.35;
    return reef ? [0.15, 0.75, 0.65] : [0.95, 0.78, 0.32];
  },
};

export function buildBorderBeachScene(
  scene: THREE.Scene,
  params: StressSceneParams,
): TerrainBuildResult {
  return buildTerrainForFixture(BORDER_BEACH_FIXTURE, params, scene);
}
