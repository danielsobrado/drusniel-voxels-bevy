import type { TreeSettings } from "./tree_config.js";
import { treeGeometryKey } from "./tree_geometry.js";

export interface TreeSystemSettingsPlan {
  nextGeometryKey: string;
  needsGeometry: boolean;
  needsPatchRefresh: boolean;
  clearGpuRing: boolean;
  applyGpuRingDebugColor: boolean;
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
  const ecologyChanged = patch.ecology !== undefined;
  const speciesChanged = patch.species !== undefined;
  const windChanged = patch.wind !== undefined;
  const impostorsChanged = patch.impostors !== undefined;
  const needsPatchRefresh = needsGeometry ||
    patch.enabled !== undefined ||
    patch.seed !== undefined ||
    patch.distanceM !== undefined ||
    patch.refreshDistanceM !== undefined ||
    patch.maxInstances !== undefined ||
    patch.placement !== undefined ||
    patch.lod !== undefined ||
    ecologyChanged ||
    speciesChanged;
  const farMaterialChanged = patch.render?.farCheapMaterial !== undefined &&
    patch.render.farCheapMaterial !== current.render.farCheapMaterial;
  const debugColorChanged = patch.render?.debugColorByLod !== undefined &&
    patch.render.debugColorByLod !== current.render.debugColorByLod;
  const shadowPolicyChanged = patch.lod?.shadowsMaxLod !== undefined &&
    patch.lod.shadowsMaxLod !== current.lod.shadowsMaxLod;
  const clearGpuRing = needsGeometry ||
    patch.gpu !== undefined ||
    farMaterialChanged ||
    shadowPolicyChanged ||
    ecologyChanged ||
    speciesChanged ||
    windChanged ||
    impostorsChanged;
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
    applyGpuRingDebugColor: debugColorChanged && !clearGpuRing,
    nextGpuStatus,
  };
}

function structuredCloneTreeSettings(settings: TreeSettings): TreeSettings {
  if (typeof structuredClone === "function") return structuredClone(settings);
  return JSON.parse(JSON.stringify(settings)) as TreeSettings;
}
