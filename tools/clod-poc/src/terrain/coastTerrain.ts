import { computeBorderDistance, type BorderPosition } from "../border/borderDistance.js";
import { sampleCoastMask } from "../border/coastMask.js";
import type {
  BorderCoastOceanConfig,
  CoastMaterialsConfig,
} from "../config/borderCoastOceanConfig.js";
import { shapeBeach } from "./beachShape.js";
import { shapeCliff } from "./cliffShape.js";

export type CoastSurfaceMaterial = keyof CoastMaterialsConfig | "inland";

export interface CoastTerrainSample {
  height: number;
  affected: boolean;
  material: CoastSurfaceMaterial;
  materialWeights: {
    drySand: number;
    wetSand: number;
    shallowSeabed: number;
    duneGrass: number;
    cliffRock: number;
    beachRock: number;
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function dominantMaterial(
  weights: CoastTerrainSample["materialWeights"],
): CoastSurfaceMaterial {
  const entries = Object.entries(weights) as [keyof typeof weights, number][];
  let best: keyof typeof weights | null = null;
  let bestWeight = 0;
  for (const [key, weight] of entries) {
    if (weight > bestWeight) {
      best = key;
      bestWeight = weight;
    }
  }
  if (best === "drySand") return "dry_sand";
  if (best === "wetSand") return "wet_sand";
  if (best === "shallowSeabed") return "shallow_seabed";
  if (best === "duneGrass") return "dune_grass";
  if (best === "cliffRock") return "cliff_rock";
  if (best === "beachRock") return "beach_rock";
  return "inland";
}

export function shapeCoastTerrain(
  pos: BorderPosition,
  baseHeight: number,
  config: BorderCoastOceanConfig,
  seed: number,
): CoastTerrainSample {
  const emptyWeights: CoastTerrainSample["materialWeights"] = {
    drySand: 0,
    wetSand: 0,
    shallowSeabed: 0,
    duneGrass: 0,
    cliffRock: 0,
    beachRock: 0,
  };
  if (!config.coast.enabled) {
    return { height: baseHeight, affected: false, material: "inland", materialWeights: emptyWeights };
  }

  const border = computeBorderDistance(pos, config.world.bounds);
  if (!border.inside) {
    return { height: baseHeight, affected: false, material: "inland", materialWeights: emptyWeights };
  }

  const mask = sampleCoastMask(pos, config.world.bounds, config.coast, seed);
  const inlandFadeStart = Math.max(0, config.coast.band.width_m - config.coast.band.inner_fade_m);
  const coastInfluence = 1 - smoothstep(
    inlandFadeStart,
    config.coast.band.width_m,
    Math.max(0, mask.distortedDistanceToBorder),
  );
  if (coastInfluence <= 0) {
    return { height: baseHeight, affected: false, material: "inland", materialWeights: emptyWeights };
  }

  const shapeSeed = (seed ^ config.coast.seed_offset) >>> 0;
  const beach = shapeBeach({
    baseHeight,
    waterLevel: config.world.water_level,
    distortedDistanceToBorder: mask.distortedDistanceToBorder,
    coastInfluence,
    x: pos.x,
    z: pos.z,
    seed: shapeSeed,
    band: config.coast.band,
    beach: config.coast.beach,
  });
  const cliff = shapeCliff({
    baseHeight,
    waterLevel: config.world.water_level,
    distortedDistanceToBorder: mask.distortedDistanceToBorder,
    coastInfluence,
    x: pos.x,
    z: pos.z,
    seed: shapeSeed,
    band: config.coast.band,
    cliff: config.coast.cliff,
  });

  const beachWeight = mask.weights.sandyBeach;
  const rockyWeight = mask.weights.rockyBeach;
  const cliffWeight = mask.weights.cliff;
  const coveWeight = mask.weights.cove;
  const reefWeight = mask.weights.reef;
  const beachShapeWeight = beachWeight + coveWeight + reefWeight;
  const cliffShapeWeight = cliffWeight + rockyWeight + coveWeight;
  const shapeWeightSum = Math.max(Number.EPSILON, beachShapeWeight + cliffShapeWeight);
  const blendedHeight = (
    beach.height * beachShapeWeight
    + cliff.height * cliffShapeWeight
  ) / shapeWeightSum;
  const terminalAlpha = 1 - smoothstep(
    0,
    config.coast.band.outer_fade_m,
    border.distanceToNearestBorder,
  );
  const terminalHeight = config.world.water_level
    - config.coast.band.outer_fade_m * config.coast.beach.slope;
  const height = blendedHeight * (1 - terminalAlpha)
    + Math.min(blendedHeight, terminalHeight) * terminalAlpha;

  const materialWeights: CoastTerrainSample["materialWeights"] = {
    drySand: beach.drySand * (beachWeight + coveWeight),
    wetSand: beach.wetSand * (beachWeight + coveWeight),
    shallowSeabed: beach.shallowSeabed * (beachWeight + coveWeight + reefWeight),
    duneGrass: beach.duneGrass * beachWeight,
    cliffRock: cliff.cliffRock * (cliffWeight + coveWeight),
    beachRock: cliff.beachRock * (rockyWeight + coveWeight + reefWeight),
  };

  return {
    height,
    affected: true,
    material: dominantMaterial(materialWeights),
    materialWeights,
  };
}

export function coastMaterialToPhase1Biome(material: CoastSurfaceMaterial): number | null {
  if (material === "dune_grass") return 0;
  if (material === "dry_sand" || material === "wet_sand" || material === "shallow_seabed") return 1;
  if (material === "cliff_rock" || material === "beach_rock") return 2;
  return null;
}
