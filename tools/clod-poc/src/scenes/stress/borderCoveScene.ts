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

function coveDistance(x: number, z: number): number {
  const pocket = 34 * Math.exp(-Math.pow((x - 128) / 42, 2));
  return z - (42 + pocket + Math.sin(x * 0.05) * 4);
}

export const BORDER_COVE_FIXTURE: FixtureDef = {
  name: "border_cove",
  description: "Sheltered cove blending beach, cliff, and shallow rocky reef",
  height: (x, z) => {
    const distance = coveDistance(x, z);
    const center = Math.exp(-Math.pow((x - 128) / 35, 2));
    const beach = -2 + distance * 0.05;
    const cliff = -3 + smoothstep(-5, 20, distance) * 27;
    const coveBlend = center;
    return cliff * (1 - coveBlend) + beach * coveBlend
      + Math.sin(x * 0.11 + z * 0.07) * (1 - coveBlend) * 1.4;
  },
  material: (x, z) => {
    const weights = BORDER_COVE_FIXTURE.materialWeights!(x, z);
    return weights.indexOf(Math.max(...weights));
  },
  materialWeights: (x, z) => {
    const center = Math.exp(-Math.pow((x - 128) / 38, 2));
    const distance = coveDistance(x, z);
    const seabed = 1 - smoothstep(0, 20, distance);
    const rock = (1 - center) * 0.8 + seabed * 0.35;
    const sand = center * 0.8 + seabed * 0.65;
    const grass = smoothstep(55, 95, distance) * center * 0.3;
    const sum = rock + sand + grass;
    return [grass / sum, sand / sum, rock / sum, 0];
  },
  coastTypeColor: (x) => {
    const center = Math.exp(-Math.pow((x - 128) / 38, 2));
    return [0.55 + center * 0.35, 0.25 + center * 0.45, 0.3];
  },
};

export function buildBorderCoveScene(
  scene: THREE.Scene,
  params: StressSceneParams,
): TerrainBuildResult {
  return buildTerrainForFixture(BORDER_COVE_FIXTURE, params, scene);
}
