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

function cliffDistance(x: number, z: number): number {
  return z - (64 + Math.sin(x * 0.045) * 9);
}

export const BORDER_CLIFF_FIXTURE: FixtureDef = {
  name: "border_cliff",
  description: "Eroded cliff crossing a page border and the x=128,z=64 page corner",
  height: (x, z) => {
    const distance = cliffDistance(x, z);
    const face = smoothstep(-8, 18, distance);
    const erosion = Math.sin(x * 0.13 + z * 0.07) * 2.4 * Math.sin(face * Math.PI);
    const ledge = smoothstep(0.42, 0.5, face) * (1 - smoothstep(0.58, 0.66, face)) * 2.2;
    const top = 34 + Math.sin(x * 0.025) * 2;
    return -4 + face * (top + 4) + erosion + ledge;
  },
  material: (x, z) => {
    const weights = BORDER_CLIFF_FIXTURE.materialWeights!(x, z);
    return weights.indexOf(Math.max(...weights));
  },
  materialWeights: (x, z) => {
    const face = smoothstep(-8, 18, cliffDistance(x, z));
    const top = smoothstep(0.82, 1, face);
    const rock = 1 - top * 0.55;
    const grass = top * 0.35;
    const dirt = top * 0.2;
    const sum = rock + grass + dirt;
    return [grass / sum, dirt / sum, rock / sum, 0];
  },
  coastTypeColor: () => [0.78, 0.28, 0.16],
};

export function buildBorderCliffScene(
  scene: THREE.Scene,
  params: StressSceneParams,
): TerrainBuildResult {
  return buildTerrainForFixture(BORDER_CLIFF_FIXTURE, params, scene);
}
