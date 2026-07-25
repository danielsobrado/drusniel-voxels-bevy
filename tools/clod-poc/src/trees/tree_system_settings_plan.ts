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
  // Compare values, not presence. The controller's makeSettings() always emits a complete
  // settings object, so a presence check is true on every update and would tear the GPU
  // ring down and rebuild it each time — destroying buffers while the previous frame's
  // submit still references them ("buffer used in submit while destroyed"), emitting
  // zero-vertex draws, and making trees blink as the ring repopulates.
  const ecologyChanged = treeSettingsSectionChanged(current.ecology, patch.ecology);
  const speciesChanged = treeSettingsSectionChanged(current.species, patch.species);
  const windChanged = treeSettingsSectionChanged(current.wind, patch.wind);
  const impostorsChanged = treeSettingsSectionChanged(current.impostors, patch.impostors);
  const needsPatchRefresh = needsGeometry ||
    scalarChanged(current.enabled, patch.enabled) ||
    scalarChanged(current.seed, patch.seed) ||
    scalarChanged(current.distanceM, patch.distanceM) ||
    scalarChanged(current.refreshDistanceM, patch.refreshDistanceM) ||
    scalarChanged(current.maxInstances, patch.maxInstances) ||
    treeSettingsSectionChanged(current.placement, patch.placement) ||
    treeSettingsSectionChanged(current.lod, patch.lod) ||
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
  // The max shadow LOD is enforced per frame by a packed uniform (settings_e.z, read by the
  // shader's shadow LOD gate), so moving between real LODs — or down to "none", which also
  // zeroes the shadow caster capacity — needs no new GPU resources. Only leaving "none"
  // does: the shadow ring buffers are not created while the capacity is zero. Rebuilding on
  // every change destroyed buffers the in-flight frame still referenced, which blacked out
  // the view with no console error once the device hit its warning cap.
  const shadowBuffersMissing = patch.lod?.shadowsMaxLod !== undefined &&
    current.lod.shadowsMaxLod === "none" &&
    patch.lod.shadowsMaxLod !== "none";
  // Only rebuild the ring when a gpu setting that actually owns GPU resources changes.
  // Pure policy/diagnostic flags (fallbackToCpu, debugShowGpuCounts, debugValidateAgainstCpu)
  // must not tear it down: destroying the compute buffers mid-frame, while the previous
  // frame's submit still references them, raises "buffer used in submit while destroyed"
  // on the WebGPU backend.
  const gpuResourcesChanged = patch.gpu !== undefined && treeGpuRingResourcesChanged(current.gpu, patch.gpu);
  const clearGpuRing = needsGeometry ||
    gpuResourcesChanged ||
    gpuRenderChanged ||
    shadowBuffersMissing ||
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

/** True when a scalar patch field is present and differs from the current value. */
function scalarChanged<T>(current: T, patch: T | undefined): boolean {
  return patch !== undefined && patch !== current;
}

/** True when a patch section is present and differs in value from the current settings.
 *  These sections are plain config data produced by the same builder, so a structural
 *  comparison is stable and avoids rebuilding on an unchanged object identity. */
function treeSettingsSectionChanged<T>(current: T, patch: T | undefined): boolean {
  if (patch === undefined) return false;
  return JSON.stringify(current) !== JSON.stringify(patch);
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
