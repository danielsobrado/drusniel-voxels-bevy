import { treePcg2d01 } from "../../vegetation/gpu_authority/pcg2d.js";
import { TREE_SPECIES } from "../tree_config_types.js";
import type { TreeCompetitionInput, TreeCompetitionSample } from "./types.js";

const RADII = [8, 16, 32] as const;
const DIRECTION_COUNT = 8;
const COMPETITION_OCCUPANCY_CHANNEL = 0x1005;

export function sampleTreeCompetition(input: TreeCompetitionInput): TreeCompetitionSample {
  const speciesIndex = Math.max(0, TREE_SPECIES.indexOf(input.species));
  let totalPressure = 0;
  let pressureX = 0;
  let pressureZ = 0;
  for (const radius of RADII) {
    for (let direction = 0; direction < DIRECTION_COUNT; direction++) {
      const angle = direction / DIRECTION_COUNT * Math.PI * 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      const sampleX = Math.floor((input.positionXZ[0] + dx * radius) / 3.4);
      const sampleZ = Math.floor((input.positionXZ[1] + dz * radius) / 3.4);
      const occupancy = treePcg2d01(sampleX, sampleZ, (input.worldSeed ^ COMPETITION_OCCUPANCY_CHANNEL ^ speciesIndex) >>> 0)[0];
      const pressure = smoothstep(0.42, 0.92, occupancy) / RADII.length;
      totalPressure += pressure;
      pressureX += dx * pressure;
      pressureZ += dz * pressure;
    }
  }
  const crownPressure = clamp(totalPressure / DIRECTION_COUNT, 0, 1);
  const directionalMagnitude = Math.hypot(pressureX, pressureZ);
  const openX = directionalMagnitude > 1e-9 ? -pressureX / directionalMagnitude : 1;
  const openZ = directionalMagnitude > 1e-9 ? -pressureZ / directionalMagnitude : 0;
  return {
    crownPressure,
    directionalPressure: clamp(directionalMagnitude / DIRECTION_COUNT, 0, 1),
    openLightDirectionXZ: [openX, openZ],
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
