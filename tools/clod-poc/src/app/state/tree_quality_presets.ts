import type { PostProcessQualityPreset } from "./postprocess_quality_presets.js";
import type { TreeLod, TreeSettings } from "../../trees/tree_config.js";

export type TreeShadowMaxLod = TreeLod | "none";

export const TREE_SHADOW_MAX_LOD_VALUES: readonly TreeShadowMaxLod[] = ["none", "near", "mid", "far", "impostor"];

export interface TreeQualityPresetState {
  treeQualityPreset: PostProcessQualityPreset;
  treeDistance: number;
  treeMaxInstances: number;
  treeDensity: number;
  treeSpacing: number;
  treeShadowMaxLod: TreeShadowMaxLod;
  treeWindEnabled: boolean;
  treeWindStrength: number;
  treeGustStrength: number;
  treeTrunkSwayStrength: number;
  treeLeafFlutterStrength: number;
  treeGpuEnabled: boolean;
  treeGpuFallbackToCpu: boolean;
  treeGpuForceCpu: boolean;
  treeGpuShowCounts: boolean;
  treeGpuReadbackVisibleLists: boolean;
  treeGpuValidateAgainstCpu: boolean;
  treeGpuMaxVisible: number;
}

export type TreeLodBudgets = TreeSettings["lod"]["budgets"];

interface TreeQualityPresetConfig {
  distanceM: number;
  impostorStartM: number;
  impostorResolutionPx: number;
  bakeAgeLayers: boolean;
  maxInstances: number;
  density: number;
  spacingM: number;
  shadowMaxLod: TreeShadowMaxLod;
  windEnabled: boolean;
  windStrength: number;
  gustStrength: number;
  trunkSwayStrength: number;
  leafFlutterStrength: number;
  gpuEnabled: boolean;
  gpuFallbackToCpu: boolean;
  gpuForceCpu: boolean;
  gpuShowCounts: boolean;
  gpuReadbackVisibleLists: boolean;
  gpuValidateAgainstCpu: boolean;
  gpuMaxVisible: number;
  budgets: TreeLodBudgets;
}

const TREE_QUALITY_PRESETS: Record<Exclude<PostProcessQualityPreset, "custom">, TreeQualityPresetConfig> = {
  ultra: {
    distanceM: 1200,
    impostorStartM: 460,
    impostorResolutionPx: 160,
    bakeAgeLayers: false,
    maxInstances: 12_000,
    density: 1.2,
    spacingM: 5.5,
    shadowMaxLod: "impostor",
    windEnabled: true,
    windStrength: 0.18,
    gustStrength: 0.12,
    trunkSwayStrength: 0.45,
    leafFlutterStrength: 0.18,
    gpuEnabled: true,
    gpuFallbackToCpu: true,
    gpuForceCpu: false,
    gpuShowCounts: false,
    gpuReadbackVisibleLists: false,
    gpuValidateAgainstCpu: false,
    gpuMaxVisible: 128_000,
    budgets: {
      nearMaxVertices: 260_000,
      midMaxVertices: 90_000,
      farMaxVertices: 40_000,
      impostorMaxVertices: 240,
    },
  },
  balanced: {
    distanceM: 900,
    impostorStartM: 420,
    impostorResolutionPx: 128,
    bakeAgeLayers: false,
    maxInstances: 9000,
    density: 0.85,
    spacingM: 7.0,
    shadowMaxLod: "impostor",
    windEnabled: true,
    windStrength: 0.12,
    gustStrength: 0.08,
    trunkSwayStrength: 0.32,
    leafFlutterStrength: 0.10,
    gpuEnabled: true,
    gpuFallbackToCpu: true,
    gpuForceCpu: false,
    gpuShowCounts: false,
    gpuReadbackVisibleLists: false,
    gpuValidateAgainstCpu: false,
    gpuMaxVisible: 96_000,
    budgets: {
      nearMaxVertices: 140_000,
      midMaxVertices: 45_000,
      farMaxVertices: 16_000,
      impostorMaxVertices: 240,
    },
  },
  perf: {
    distanceM: 500,
    impostorStartM: 300,
    impostorResolutionPx: 64,
    bakeAgeLayers: false,
    maxInstances: 5000,
    density: 0.55,
    spacingM: 9.0,
    shadowMaxLod: "far",
    windEnabled: false,
    windStrength: 0,
    gustStrength: 0,
    trunkSwayStrength: 0,
    leafFlutterStrength: 0,
    gpuEnabled: true,
    gpuFallbackToCpu: true,
    gpuForceCpu: false,
    gpuShowCounts: false,
    gpuReadbackVisibleLists: false,
    gpuValidateAgainstCpu: false,
    gpuMaxVisible: 40_000,
    budgets: {
      nearMaxVertices: 75_000,
      midMaxVertices: 24_000,
      farMaxVertices: 8_000,
      impostorMaxVertices: 120,
    },
  },
  potato: {
    distanceM: 240,
    impostorStartM: 140,
    impostorResolutionPx: 48,
    bakeAgeLayers: false,
    maxInstances: 2000,
    density: 0.3,
    spacingM: 12.0,
    shadowMaxLod: "none",
    windEnabled: false,
    windStrength: 0,
    gustStrength: 0,
    trunkSwayStrength: 0,
    leafFlutterStrength: 0,
    gpuEnabled: true,
    gpuFallbackToCpu: true,
    gpuForceCpu: false,
    gpuShowCounts: false,
    gpuReadbackVisibleLists: false,
    gpuValidateAgainstCpu: false,
    gpuMaxVisible: 16_000,
    budgets: {
      nearMaxVertices: 32_000,
      midMaxVertices: 12_000,
      farMaxVertices: 4_000,
      impostorMaxVertices: 80,
    },
  },
};

export function isTreeShadowMaxLod(value: string | null): value is TreeShadowMaxLod {
  return TREE_SHADOW_MAX_LOD_VALUES.includes(value as TreeShadowMaxLod);
}

export function treeLodBudgetsForQualityPreset(
  preset: PostProcessQualityPreset,
  fallback: TreeLodBudgets,
): TreeLodBudgets {
  if (preset === "custom") return fallback;
  return { ...TREE_QUALITY_PRESETS[preset].budgets };
}

export function treeImpostorTileResolutionForQualityPreset(
  preset: PostProcessQualityPreset,
  fallback: number,
): number {
  if (preset === "custom") return fallback;
  return TREE_QUALITY_PRESETS[preset].impostorResolutionPx;
}

export function treeImpostorBakeAgeLayersForQualityPreset(
  preset: PostProcessQualityPreset,
  fallback: boolean,
): boolean {
  if (preset === "custom") return fallback;
  return TREE_QUALITY_PRESETS[preset].bakeAgeLayers;
}

export function treeImpostorStartFractionForQualityPreset(
  preset: PostProcessQualityPreset,
  distanceM: number,
  fallback: number,
): number {
  if (preset === "custom") return fallback;
  const safeDistance = Math.max(1, distanceM);
  return Math.max(0, Math.min(1, TREE_QUALITY_PRESETS[preset].impostorStartM / safeDistance));
}

export function applyTreeQualityPreset(state: TreeQualityPresetState, preset: PostProcessQualityPreset): void {
  state.treeQualityPreset = preset;
  if (preset === "custom") return;

  const config = TREE_QUALITY_PRESETS[preset];
  state.treeDistance = config.distanceM;
  state.treeMaxInstances = config.maxInstances;
  state.treeDensity = config.density;
  state.treeSpacing = config.spacingM;
  state.treeShadowMaxLod = config.shadowMaxLod;
  state.treeWindEnabled = config.windEnabled;
  state.treeWindStrength = config.windStrength;
  state.treeGustStrength = config.gustStrength;
  state.treeTrunkSwayStrength = config.trunkSwayStrength;
  state.treeLeafFlutterStrength = config.leafFlutterStrength;
  state.treeGpuEnabled = config.gpuEnabled;
  state.treeGpuFallbackToCpu = config.gpuFallbackToCpu;
  state.treeGpuForceCpu = config.gpuForceCpu;
  state.treeGpuShowCounts = config.gpuShowCounts;
  state.treeGpuReadbackVisibleLists = config.gpuReadbackVisibleLists;
  state.treeGpuValidateAgainstCpu = config.gpuValidateAgainstCpu;
  state.treeGpuMaxVisible = config.gpuMaxVisible;
}
