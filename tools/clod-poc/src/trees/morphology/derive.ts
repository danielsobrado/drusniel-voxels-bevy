import { treePcg2dU32 } from "../../vegetation/gpu_authority/pcg2d.js";
import type { TreeSpeciesId } from "../tree_config_types.js";
import type { TreeSpeciesMorphologyRuntimeSettings } from "../tree_config_types.js";
import { MORPH_CHANNEL, TREE_MORPHOLOGY_RUNTIME_DEFAULTS } from "./constants.js";
import type {
  TreeCompetitionSample,
  TreeEcologySample,
  TreeIdentity,
  TreeInstanceMorphology,
  TreeTerrainSample,
} from "./types.js";
import { clampTreeInstanceMorphology } from "./validation.js";

const PREVAILING_WIND_XZ: readonly [number, number] = normalize2([0.8, 0.6]);

export function deriveTreeInstanceMorphology(
  identity: TreeIdentity,
  species: TreeSpeciesId,
  terrain: TreeTerrainSample,
  ecology: TreeEcologySample,
  competition: TreeCompetitionSample,
  runtimeConfig: TreeSpeciesMorphologyRuntimeSettings = TREE_MORPHOLOGY_RUNTIME_DEFAULTS[species],
): TreeInstanceMorphology {
  const config = runtimeConfig;
  const age01 = clamp(
    0.10
      + hash01(identity, MORPH_CHANNEL.AGE) * 0.78
      + ecology.oldForestBias * 0.22
      - competition.crownPressure * 0.18,
    0,
    1,
  );
  const branchDroop = clamp(
    config.baseDroop
      + age01 * config.ageDroop
      + ecology.moisture * config.moistureDroop
      + hashSigned(identity, MORPH_CHANNEL.DROOP) * 0.08,
    -0.18,
    0.32,
  );
  const health01 = clamp(
    0.72
      + ecology.moistureSuitability * 0.18
      + ecology.temperatureSuitability * 0.14
      - competition.crownPressure * 0.18
      - ecology.stress * 0.32
      + hashSigned(identity, MORPH_CHANNEL.HEALTH) * 0.10,
    0,
    1,
  );
  const stiffness = clamp(
    config.baseStiffness + (1 - age01) * 0.12 + health01 * 0.08 - branchDroop * 0.25,
    0.65,
    1.35,
  );

  const slopeDirection = normalize2(terrain.downhillDirectionXZ);
  const randomLeanDirection = hashDirection(identity, MORPH_CHANNEL.LEAN);
  let leanX = slopeDirection[0] * terrain.slope01 * config.slopeLean
    + PREVAILING_WIND_XZ[0] * config.windLean
    + randomLeanDirection[0] * config.randomLean;
  let leanZ = slopeDirection[1] * terrain.slope01 * config.slopeLean
    + PREVAILING_WIND_XZ[1] * config.windLean
    + randomLeanDirection[1] * config.randomLean;
  const leanScale = lerp(0.55, 1.15, age01) * lerp(1.20, 0.75, stiffness);
  [leanX, leanZ] = clampLength([leanX * leanScale, leanZ * leanScale], 0.22);

  const openLight = normalize2(competition.openLightDirectionXZ);
  const randomBiasDirection = hashDirection(identity, MORPH_CHANNEL.CROWN_BIAS);
  const [crownBiasX, crownBiasZ] = clampLength([
    openLight[0] * competition.directionalPressure * 0.28 + randomBiasDirection[0] * 0.07,
    openLight[1] * competition.directionalPressure * 0.28 + randomBiasDirection[1] * 0.07,
  ], 0.35);

  return clampTreeInstanceMorphology({
    age01,
    leanX,
    leanZ,
    crownBiasX,
    crownBiasZ,
    crownWidth: clamp(
      0.88 + age01 * 0.20 - competition.crownPressure * 0.12
        + hashSigned(identity, MORPH_CHANNEL.WIDTH) * 0.08,
      0.82,
      1.18,
    ),
    crownFlattening: clamp(
      1.00 - terrain.exposure01 * config.exposureFlattening + age01 * config.ageFlattening
        + hashSigned(identity, MORPH_CHANNEL.FLAT) * 0.06,
      0.82,
      1.20,
    ),
    branchDroop,
    foliageDensity: clamp(
      0.58 + health01 * 0.48 + age01 * 0.10 - competition.crownPressure * 0.12,
      0.55,
      1.15,
    ),
    health01,
    rootFlare: clamp(
      0.85 + age01 * 0.28 + terrain.exposedRootPotential * 0.18
        + hashSigned(identity, MORPH_CHANNEL.FLARE) * 0.08,
      0.75,
      1.35,
    ),
    stiffness,
  });
}

export function hash01(identity: TreeIdentity, channel: number): number {
  const [word] = treePcg2dU32(identity.stableIdLo | 0, identity.stableIdHi | 0, channel);
  return (word & 0xffffff) / 16777216;
}

export function hashSigned(identity: TreeIdentity, channel: number): number {
  return hash01(identity, channel) * 2 - 1;
}

function hashDirection(identity: TreeIdentity, channel: number): [number, number] {
  const angle = hash01(identity, channel) * Math.PI * 2;
  return [Math.cos(angle), Math.sin(angle)];
}

function normalize2(input: readonly [number, number]): [number, number] {
  const length = Math.hypot(input[0], input[1]);
  return length > 1e-12 ? [input[0] / length, input[1] / length] : [0, 0];
}

function clampLength(input: [number, number], maxLength: number): [number, number] {
  const length = Math.hypot(input[0], input[1]);
  if (length <= maxLength || length <= 1e-12) return input;
  return [input[0] * maxLength / length, input[1] * maxLength / length];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
