import type { BiomeVisualState } from "../environment/biome_visual_state.js";
import type { EnvironmentQuery } from "../environment_query/types.js";
import {
  createEnvironmentalMaskValues,
  evaluateEnvironmentalMaskValues,
} from "./environment_mask_math.js";
import type {
  EnvironmentalMaskMeta,
  EnvironmentalMaskSample,
  EnvironmentalMaskSettings,
} from "./environment_mask_types.js";

export interface EnvironmentalMaskEvaluationInput {
  readonly query: EnvironmentQuery;
  readonly settings: EnvironmentalMaskSettings;
  readonly biome: BiomeVisualState;
  readonly x: number;
  readonly z: number;
  readonly hintM?: number;
}

export function evaluateEnvironmentalMasks(input: EnvironmentalMaskEvaluationInput): EnvironmentalMaskSample {
  const hintM = input.hintM;
  const water = input.query.water(input.x, input.z, hintM);
  const river = input.query.river(input.x, input.z, hintM);
  const normal = input.query.surfaceNormal(input.x, input.z, hintM);
  const visibility = input.query.visibility(input.x, input.z, hintM);
  const validity = Object.freeze({
    water: water.meta.valid,
    river: river.meta.valid,
    normal: normal.meta.valid,
    visibility: visibility.meta.valid,
  });
  const meta: EnvironmentalMaskMeta = Object.freeze({
    cellSizeM: Math.max(water.meta.cellSizeM, river.meta.cellSizeM, normal.meta.cellSizeM, visibility.meta.cellSizeM),
    revision: Math.max(water.meta.revision, river.meta.revision, normal.meta.revision, visibility.meta.revision),
    validity,
    water: water.meta,
    river: river.meta,
    normal: normal.meta,
    visibility: visibility.meta,
  });
  const values = evaluateEnvironmentalMaskValues({
    settings: input.settings,
    biome: input.biome,
    waterValid: validity.water,
    riverValid: validity.river,
    normalValid: validity.normal,
    visibilityValid: validity.visibility,
    wetMask: water.wetMask,
    bodyKind: water.bodyKind,
    waterDepth: water.depth,
    shoreDistanceM: water.shoreDistanceM,
    flowStrength: river.flowStrength,
    bedDrop: river.bedDrop,
    rapidMask: river.rapidMask,
    normalY: normal.y,
    sunVisibility: visibility.sunVisibility,
  }, createEnvironmentalMaskValues());

  return Object.freeze({
    riverCobble: values.riverCobble,
    riverMist: values.riverMist,
    rapidSplash: values.rapidSplash,
    sunbeamMote: values.sunbeamMote,
    calmPool: values.calmPool,
    frost: values.frost,
    dew: values.dew,
    shoreDebris: values.shoreDebris,
    meta,
  });
}
