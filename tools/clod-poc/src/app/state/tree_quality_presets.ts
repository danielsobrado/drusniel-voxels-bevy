import type { PostProcessQualityPreset } from "./postprocess_quality_presets.js";

export interface TreeQualityPresetState {
  treeDistance: number;
  treeMaxInstances: number;
  treeDensity: number;
  treeSpacing: number;
  treeGpuEnabled: boolean;
  treeGpuForceCpu: boolean;
  treeGpuShowCounts: boolean;
  treeGpuReadbackVisibleLists: boolean;
  treeGpuValidateAgainstCpu: boolean;
  treeGpuMaxVisible: number;
}

interface TreeQualityPresetConfig {
  distanceM: number;
  maxInstances: number;
  density: number;
  spacingM: number;
  gpuEnabled: boolean;
  gpuForceCpu: boolean;
  gpuShowCounts: boolean;
  gpuReadbackVisibleLists: boolean;
  gpuValidateAgainstCpu: boolean;
  gpuMaxVisible: number;
}

const TREE_QUALITY_PRESETS: Record<Exclude<PostProcessQualityPreset, "custom">, TreeQualityPresetConfig> = {
  ultra: {
    distanceM: 620,
    maxInstances: 9000,
    density: 1.2,
    spacingM: 5.5,
    gpuEnabled: true,
    gpuForceCpu: false,
    gpuShowCounts: false,
    gpuReadbackVisibleLists: false,
    gpuValidateAgainstCpu: false,
    gpuMaxVisible: 50_000,
  },
  balanced: {
    distanceM: 420,
    maxInstances: 6000,
    density: 0.85,
    spacingM: 7.0,
    gpuEnabled: true,
    gpuForceCpu: false,
    gpuShowCounts: false,
    gpuReadbackVisibleLists: false,
    gpuValidateAgainstCpu: false,
    gpuMaxVisible: 30_000,
  },
  perf: {
    distanceM: 300,
    maxInstances: 3500,
    density: 0.55,
    spacingM: 9.0,
    gpuEnabled: true,
    gpuForceCpu: false,
    gpuShowCounts: false,
    gpuReadbackVisibleLists: false,
    gpuValidateAgainstCpu: false,
    gpuMaxVisible: 16_000,
  },
  potato: {
    distanceM: 180,
    maxInstances: 1500,
    density: 0.3,
    spacingM: 12.0,
    gpuEnabled: true,
    gpuForceCpu: false,
    gpuShowCounts: false,
    gpuReadbackVisibleLists: false,
    gpuValidateAgainstCpu: false,
    gpuMaxVisible: 8_000,
  },
};

export function applyTreeQualityPreset(state: TreeQualityPresetState, preset: PostProcessQualityPreset): void {
  if (preset === "custom") return;

  const config = TREE_QUALITY_PRESETS[preset];
  state.treeDistance = config.distanceM;
  state.treeMaxInstances = config.maxInstances;
  state.treeDensity = config.density;
  state.treeSpacing = config.spacingM;
  state.treeGpuEnabled = config.gpuEnabled;
  state.treeGpuForceCpu = config.gpuForceCpu;
  state.treeGpuShowCounts = config.gpuShowCounts;
  state.treeGpuReadbackVisibleLists = config.gpuReadbackVisibleLists;
  state.treeGpuValidateAgainstCpu = config.gpuValidateAgainstCpu;
  state.treeGpuMaxVisible = config.gpuMaxVisible;
}
