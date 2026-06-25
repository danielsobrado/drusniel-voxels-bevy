import type { CoastMaterialsConfig } from "../config/borderCoastOceanConfig.js";
import type { CoastTerrainSample } from "./coastTerrain.js";

export interface CoastMaterialPalette {
  materialIds: readonly string[];
}

export interface CoastMaterialWeightInput {
  coast: CoastTerrainSample;
  materials: CoastMaterialsConfig;
  palette: CoastMaterialPalette;
  inlandWeights: readonly number[];
}

export interface CoastMaterialWeightResult {
  weights: number[];
  dominantSlot: number;
  wetSandUsesFallback: boolean;
}

function materialSlot(
  materialId: string,
  palette: CoastMaterialPalette,
  fallbacks: readonly string[] = [],
): number {
  for (const candidate of [materialId, ...fallbacks]) {
    const slot = palette.materialIds.indexOf(candidate);
    if (slot >= 0) return slot;
  }
  throw new Error(
    `Coast materials: material '${materialId}' is unavailable and no fallback exists in [${palette.materialIds.join(", ")}]`,
  );
}

function add(weights: number[], slot: number, amount: number): void {
  if (amount > 0) weights[slot] += amount;
}

function normalized(weights: readonly number[]): number[] {
  const sum = weights.reduce((total, weight) => total + Math.max(0, weight), 0);
  if (sum <= Number.EPSILON) return weights.map(() => 0);
  return weights.map((weight) => Math.max(0, weight) / sum);
}

function dominantSlot(weights: readonly number[]): number {
  let slot = 0;
  for (let index = 1; index < weights.length; index += 1) {
    if (weights[index] > weights[slot]) slot = index;
  }
  return slot;
}

export function buildCoastMaterialWeights(
  input: CoastMaterialWeightInput,
): CoastMaterialWeightResult {
  if (input.palette.materialIds.length === 0) {
    throw new Error("Coast materials: palette must contain at least one material");
  }
  if (input.inlandWeights.length !== input.palette.materialIds.length) {
    throw new Error(
      `Coast materials: inland weight count ${input.inlandWeights.length} does not match palette size ${input.palette.materialIds.length}`,
    );
  }

  const inland = normalized(input.inlandWeights);
  if (!input.coast.affected) {
    return {
      weights: inland,
      dominantSlot: dominantSlot(inland),
      wetSandUsesFallback: false,
    };
  }

  const drySandSlot = materialSlot(
    input.materials.dry_sand,
    input.palette,
    ["sand", "dirt"],
  );
  const wetSandExactSlot = input.palette.materialIds.indexOf(input.materials.wet_sand);
  const wetSandSlot = wetSandExactSlot >= 0 ? wetSandExactSlot : drySandSlot;
  const seabedSlot = materialSlot(
    input.materials.shallow_seabed,
    input.palette,
    [input.materials.dry_sand, "sand", "dirt"],
  );
  const grassSlot = materialSlot(
    input.materials.dune_grass,
    input.palette,
    ["grass", "dirt"],
  );
  const cliffRockSlot = materialSlot(
    input.materials.cliff_rock,
    input.palette,
    ["rock", "dirt"],
  );
  const beachRockSlot = materialSlot(
    input.materials.beach_rock,
    input.palette,
    [input.materials.cliff_rock, "rock", "dirt"],
  );

  const raw = input.coast.materialWeights;
  const coastWeights = input.palette.materialIds.map(() => 0);
  add(coastWeights, drySandSlot, raw.drySand);
  add(coastWeights, wetSandSlot, raw.wetSand);
  add(coastWeights, seabedSlot, raw.shallowSeabed);
  add(coastWeights, grassSlot, raw.duneGrass);
  add(coastWeights, cliffRockSlot, raw.cliffRock);

  // Rocky beaches use the same continuous mask for sand and rock. Existing beach
  // and seabed masks add further sand where present, yielding a non-binary blend.
  add(coastWeights, drySandSlot, raw.beachRock);
  add(coastWeights, beachRockSlot, raw.beachRock);

  const coastCoverage = Math.min(
    1,
    raw.drySand
      + raw.wetSand
      + raw.shallowSeabed
      + raw.duneGrass
      + raw.cliffRock
      + raw.beachRock,
  );
  const normalizedCoast = normalized(coastWeights);
  const weights = normalizedCoast.map(
    (weight, slot) => weight * coastCoverage + inland[slot] * (1 - coastCoverage),
  );
  const finalWeights = normalized(weights);

  return {
    weights: finalWeights,
    dominantSlot: dominantSlot(finalWeights),
    wetSandUsesFallback: wetSandExactSlot < 0 && raw.wetSand > 0,
  };
}
