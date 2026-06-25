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

function roundedCornerDistance(x: number, z: number): number {
  const radius = 82 + Math.sin((x + z) * 0.055) * 8 + Math.sin(x * 0.12) * 3;
  return Math.hypot(x - 8, z - 8) - radius;
}

export const BORDER_CORNER_FIXTURE: FixtureDef = {
  name: "border_corner",
  description: "Rounded noisy corner coast close to rectangular world bounds",
  height: (x, z) => {
    const distance = roundedCornerDistance(x, z);
    const shore = -3 + distance * 0.055;
    const inland = 9 + Math.sin(x * 0.035) + Math.cos(z * 0.04);
    return shore * (1 - smoothstep(55, 100, distance))
      + inland * smoothstep(55, 100, distance);
  },
  material: (x, z) => {
    const weights = BORDER_CORNER_FIXTURE.materialWeights!(x, z);
    return weights.indexOf(Math.max(...weights));
  },
  materialWeights: (x, z) => {
    const distance = roundedCornerDistance(x, z);
    const grass = smoothstep(58, 105, distance);
    const rock = (1 - grass) * smoothstep(0.35, 0.8, Math.sin((x - z) * 0.08) * 0.5 + 0.5) * 0.45;
    const sand = Math.max(0, 1 - grass);
    const sum = grass + rock + sand;
    return [grass / sum, sand / sum, rock / sum, 0];
  },
  coastTypeColor: (x, z) => {
    const rock = Math.sin((x - z) * 0.08) > 0.3;
    return rock ? [0.62, 0.38, 0.25] : [0.93, 0.72, 0.3];
  },
};

export function buildBorderCornerScene(
  scene: THREE.Scene,
  params: StressSceneParams,
): TerrainBuildResult {
  return buildTerrainForFixture(BORDER_CORNER_FIXTURE, params, scene);
}
