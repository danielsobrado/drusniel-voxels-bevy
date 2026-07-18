import type { BiomeVisualState } from "../environment/biome_visual_state.js";
import { readEnvironmentalMaskSettings } from "../environment_masks/environment_mask_runtime.js";
import type { RiverMistMaskSettings } from "../environment_masks/environment_mask_types.js";
import { HYDROLOGY_BODY_RIVER } from "./hydrologyGrid.js";
import type { WaterFieldResult } from "./waterField.js";

export const RIVER_MIST_QUERY_KEYS = [
  "riverMist",
  "waterRiverMist",
  "coldRiverMist",
] as const;

export interface RiverMistRuntimeSettings {
  readonly enabled: boolean;
  readonly mask: RiverMistMaskSettings;
}

export function readRiverMistRuntimeSettings(
  searchParams: URLSearchParams,
): RiverMistRuntimeSettings {
  const settings = readEnvironmentalMaskSettings();
  const mask = settings.riverMist;
  const particles = mask.particles;
  return {
    enabled: settings.enabled
      && mask.enabled
      && mask.strength > 0
      && mask.maxShoreDistanceM > 0
      && particles.maxParticles > 0
      && particles.maxEmittersPerTick > 0
      && particles.spawnProbability > 0
      && queryFlag(searchParams, RIVER_MIST_QUERY_KEYS, false),
    mask,
  };
}

export function riverMistSignal(
  sample: WaterFieldResult,
  biome: Pick<BiomeVisualState, "enabled" | "morningMist"> | null,
  settings: RiverMistRuntimeSettings,
): number {
  if (!settings.enabled || !biome?.enabled) return 0;
  if (sample.bodyKind !== HYDROLOGY_BODY_RIVER || sample.depth <= 0.03 || sample.bodyMask <= 0.08) return 0;
  if (!Number.isFinite(sample.shoreDistance) || sample.shoreDistance < 0) return 0;

  const mask = settings.mask;
  const flow = smoothRamp(mask.minFlowStrength, mask.minFlowStrength * 3 + 0.001, sample.flow.speed);
  const shore = 1 - smoothRamp(mask.maxShoreDistanceM * 0.55, mask.maxShoreDistanceM, sample.shoreDistance);
  return clamp01(mask.strength)
    * clamp01(sample.bodyMask)
    * clamp01(biome.morningMist)
    * flow
    * shore;
}

function queryFlag(
  searchParams: URLSearchParams,
  keys: readonly string[],
  fallback: boolean,
): boolean {
  for (const key of keys) {
    const raw = searchParams.get(key);
    if (raw === null) continue;
    if (raw === "") return true;
    const normalized = raw.trim().toLowerCase();
    if (["1", "true", "on", "yes"].includes(normalized)) return true;
    if (["0", "false", "off", "no"].includes(normalized)) return false;
  }
  return fallback;
}

function smoothRamp(start: number, end: number, value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (!(end > start)) return value >= end ? 1 : 0;
  const t = clamp01((value - start) / (end - start));
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
