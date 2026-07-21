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
  const debugColorChanged = patch.render?.debugColorByLod !== undefined &&
    patch.render.debugColorByLod !== current.render.debugColorByLod;
  const gpuRenderChanged = patch.render !== undefined && (
    patch.render.alphaTest !== current.render.alphaTest ||
    patch.render.castShadows !== current.render.castShadows ||
    patch.render.receiveShadows !== current.render.receiveShadows ||
    patch.render.depthPrepass !== current.render.depthPrepass ||
    patch.render.farCheapMaterial !== current.render.farCheapMaterial
  );
  const shadowPolicyChanged = patch.lod?.shadowsMaxLod !== undefined &&
    patch.lod.shadowsMaxLod !== current.lod.shadowsMaxLod;
  // Only rebuild the ring when a gpu setting that actually owns GPU resources changes.
  // Pure policy/diagnostic flags (fallbackToCpu, debugShowGpuCounts, debugValidateAgainstCpu)
  // must not tear it down: destroying the compute buffers mid-frame, while the previous
  // frame's submit still references them, raises "buffer used in submit while destroyed"
  // on the WebGPU backend.
  const gpuResourcesChanged = patch.gpu !== undefined && treeGpuRingResourcesChanged(current.gpu, patch.gpu);
  const clearGpuRing = needsGeometry ||
    gpuResourcesChanged ||
    gpuRenderChanged ||
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

type TreeGpuSettingsShape = TreeSettings["gpu"];

/** True when a gpu setting that owns GPU resources changed, so the ring must be
 *  rebuilt. Excludes pure policy/diagnostic flags (fallbackToCpu, debugShowGpuCounts,
 *  debugValidateAgainstCpu) that never touch a buffer or pipeline. */
function treeGpuRingResourcesChanged(current: TreeGpuSettingsShape, next: TreeGpuSettingsShape): boolean {
  return current.enabled !== next.enabled ||
    current.preferWebGpu !== next.preferWebGpu ||
    current.scatterEnabled !== next.scatterEnabled ||
    current.cullEnabled !== next.cullEnabled ||
    current.maxVisible !== next.maxVisible ||
    current.workgroupSize !== next.workgroupSize ||
    current.readbackVisibleLists !== next.readbackVisibleLists ||
    current.debugForceCpu !== next.debugForceCpu ||
    treeGpuTerrainVisibilityChanged(current.terrainVisibility, next.terrainVisibility);
}

function treeGpuTerrainVisibilityChanged(
  current: TreeGpuSettingsShape["terrainVisibility"],
  next: TreeGpuSettingsShape["terrainVisibility"],
): boolean {
  return current.enabled !== next.enabled ||
    current.minDistanceM !== next.minDistanceM ||
    current.sampleCount !== next.sampleCount ||
    current.heightMarginM !== next.heightMarginM ||
    current.crownHeightM !== next.crownHeightM;
}

function structuredCloneTreeSettings(settings: TreeSettings): TreeSettings {
  if (typeof structuredClone === "function") return structuredClone(settings);
  return JSON.parse(JSON.stringify(settings)) as TreeSettings;
}
