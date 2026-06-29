import { treeGeometryKey, type TreeSettings } from "./tree_config.js";

export interface TreeSystemSettingsPlan {
  nextGeometryKey: string;
  needsGeometry: boolean;
  needsPatchRefresh: boolean;
  clearGpuRing: boolean;
  nextGpuStatus: "disabled" | "fallback-cpu" | null;
}

export function planTreeSystemSettingsUpdate(
  current: TreeSettings,
  patch: Partial<TreeSettings>,
  currentGeometryKey: string,
): TreeSystemSettingsPlan {
  const next = structuredCloneTreeSettings(current);
  Object.assign(next, patch);
  const nextGeometryKey = treeGeometryKey(next);
  const needsGeometry = nextGeometryKey !== currentGeometryKey;
  const needsPatchRefresh = needsGeometry ||
    patch.enabled !== undefined ||
    patch.seed !== undefined ||
    patch.distanceM !== undefined ||
    patch.refreshDistanceM !== undefined ||
    patch.maxInstances !== undefined ||
    patch.placement !== undefined ||
    patch.lod !== undefined;
  const clearGpuRing = patch.gpu !== undefined;
  const nextGpuStatus = !patch.gpu
    ? null
    : !patch.gpu.enabled
      ? "disabled"
      : patch.gpu.debugForceCpu
        ? "fallback-cpu"
        : null;
  return {
    nextGeometryKey,
    needsGeometry,
    needsPatchRefresh,
    clearGpuRing,
    nextGpuStatus,
  };
}

function structuredCloneTreeSettings(settings: TreeSettings): TreeSettings {
  if (typeof structuredClone === "function") return structuredClone(settings);
  return JSON.parse(JSON.stringify(settings)) as TreeSettings;
}
