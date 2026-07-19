import type { BiomeVisualSeason } from "./biome-visual-acceptance-profile.js";
import {
  BIOME_VISUAL_SEASONS,
  BIOME_VISUAL_SEASON_PROFILES,
} from "./biome-visual-acceptance-profile.js";
import type { ImageDeltaMetrics } from "./biome-visual-image-metrics.js";

export interface BiomeVisualRuntimeState {
  readonly enabled: boolean;
  readonly seasonT: number;
  readonly green: number;
  readonly autumn: number;
  readonly bloom: number;
  readonly snowlineM: number;
  readonly frostAmount: number;
  readonly wetness: number;
}

export interface BiomeVisualAcceptanceMetrics {
  readonly terrainWinterSummer: ImageDeltaMetrics;
  readonly grassWinterSummer: ImageDeltaMetrics;
  readonly treesSummerAutumn: ImageDeltaMetrics;
  readonly understorySummerAutumn: ImageDeltaMetrics;
  readonly bloomSpringAutumn: ImageDeltaMetrics;
}

export interface BiomeVisualAcceptanceInput {
  readonly runtimeStates: Readonly<Record<BiomeVisualSeason, BiomeVisualRuntimeState>>;
  readonly metrics: BiomeVisualAcceptanceMetrics;
  readonly webGpuErrors: Readonly<Record<BiomeVisualSeason, number>>;
}

export interface BiomeVisualAcceptanceResult {
  readonly passed: boolean;
  readonly failures: readonly string[];
}

const STATE_EPSILON = 0.001;
const TERRAIN_MIN_CHANGED_PIXELS = 1_000;
const TERRAIN_MIN_CHANGED_RATIO = 0.002;
const TERRAIN_MIN_MEAN_DELTA = 0.15;
const VEGETATION_MIN_MASK_PIXELS = 64;
const VEGETATION_MIN_CHANGED_RATIO = 0.03;
const VEGETATION_MIN_MEAN_DELTA = 1.0;

export function evaluateBiomeVisualAcceptance(
  input: BiomeVisualAcceptanceInput,
): BiomeVisualAcceptanceResult {
  const failures: string[] = [];

  for (const season of BIOME_VISUAL_SEASONS) {
    evaluateRuntimeState(season, input.runtimeStates[season], failures);
    evaluateWebGpuErrors(season, input.webGpuErrors[season], failures);
  }

  evaluateTerrainDelta(input.metrics.terrainWinterSummer, failures);
  evaluateVegetationDelta("grass winter/summer", input.metrics.grassWinterSummer, failures);
  evaluateVegetationDelta("trees summer/autumn", input.metrics.treesSummerAutumn, failures);
  evaluateVegetationDelta("understory summer/autumn", input.metrics.understorySummerAutumn, failures);
  evaluateVegetationDelta("flower bloom spring/autumn", input.metrics.bloomSpringAutumn, failures);

  return { passed: failures.length === 0, failures };
}

function evaluateRuntimeState(
  season: BiomeVisualSeason,
  state: BiomeVisualRuntimeState,
  failures: string[],
): void {
  const profile = BIOME_VISUAL_SEASON_PROFILES[season];
  if (!state.enabled) failures.push(`${season}: biome visual state is disabled`);
  expectNear(failures, `${season}.seasonT`, state.seasonT, profile.seasonT);
  expectNear(failures, `${season}.green`, state.green, profile.expected.green);
  expectNear(failures, `${season}.autumn`, state.autumn, profile.expected.autumn);
  expectNear(failures, `${season}.bloom`, state.bloom, profile.expected.bloom);
  expectNear(failures, `${season}.snowlineM`, state.snowlineM, profile.expected.snowlineM);
  expectNear(failures, `${season}.frostAmount`, state.frostAmount, profile.expected.frostAmount);
  expectNear(failures, `${season}.wetness`, state.wetness, 0);
}

function evaluateWebGpuErrors(
  season: BiomeVisualSeason,
  errors: number,
  failures: string[],
): void {
  if (!Number.isFinite(errors) || errors !== 0) {
    failures.push(`${season}: expected zero WebGPU errors, got ${errors}`);
  }
}

function evaluateTerrainDelta(metrics: ImageDeltaMetrics, failures: string[]): void {
  if (metrics.changedPixels < TERRAIN_MIN_CHANGED_PIXELS) {
    failures.push(`terrain winter/summer changed only ${metrics.changedPixels} pixels`);
  }
  if (metrics.changedRatio < TERRAIN_MIN_CHANGED_RATIO) {
    failures.push(`terrain winter/summer changed ratio ${metrics.changedRatio.toFixed(4)} is too low`);
  }
  if (metrics.meanRgbDelta < TERRAIN_MIN_MEAN_DELTA) {
    failures.push(`terrain winter/summer mean RGB delta ${metrics.meanRgbDelta.toFixed(3)} is too low`);
  }
}

function evaluateVegetationDelta(
  label: string,
  metrics: ImageDeltaMetrics,
  failures: string[],
): void {
  if (metrics.sampledPixels < VEGETATION_MIN_MASK_PIXELS) {
    failures.push(`${label} mask has only ${metrics.sampledPixels} pixels`);
    return;
  }
  if (metrics.changedRatio < VEGETATION_MIN_CHANGED_RATIO) {
    failures.push(`${label} changed ratio ${metrics.changedRatio.toFixed(4)} is too low`);
  }
  if (metrics.meanRgbDelta < VEGETATION_MIN_MEAN_DELTA) {
    failures.push(`${label} mean RGB delta ${metrics.meanRgbDelta.toFixed(3)} is too low`);
  }
}

function expectNear(
  failures: string[],
  label: string,
  actual: number,
  expected: number,
): void {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > STATE_EPSILON) {
    failures.push(`${label}: expected ${expected}, got ${actual}`);
  }
}
