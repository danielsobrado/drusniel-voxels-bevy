import type { TreeLod, TreeSpeciesId } from "./tree_config.js";
import { treeLodCastsShadow } from "./tree_system_shadow_policy.js";
import { resolveTreeSystemLod } from "./tree_system_lod_resolution.js";
import { createTreeSystemGpuRingDrawResources } from "./tree_system_gpu_ring_resources.js";
import { clearTreeGpuRing } from "./tree_system_gpu_ring_runtime.js";
import { buildTreeRuntimeStats } from "./tree_system_runtime_stats.js";
import type { TreeSystem } from "./tree_system_runtime.js";
import { treeLodWithinDepthPrepass } from "./tree_depth_prepass_runtime.js";

export function treeCpuPatchInput(self: TreeSystem) {
  return {
    root: self.root, nodes: self.nodes, patches: self.patches,
    settings: self.settings, sampler: self.sampler,
    terrainOcclusionSampler: self.terrainOcclusionSampler,
    earlyTerrainRejectionStats: self.earlyTerrainRejectionStats,
    worldCells: self.worldCells,
    meshBoundsState: self.meshBoundsState,
    impostorAtlases: self.assets.impostorAtlases,
    geometryFor: (s: TreeSpeciesId, l: TreeLod) => self.assets.geometryFor(s, l),
    materialFor: (s: TreeSpeciesId, l: TreeLod) => self.assets.materialFor(s, l),
    castsShadow: (l: TreeLod) => treeLodCastsShadow(self.settings, l),
    resolveLod: (s: TreeSpeciesId, l: TreeLod) => resolveTreeSystemLod({ species: s, lod: l, settings: self.settings, impostorAtlases: self.assets.impostorAtlases }),
    prepassNodesFor: self.useCpuTreePrepass
      ? (_s: TreeSpeciesId, l: TreeLod) => treeLodWithinDepthPrepass(self.treePrepassMaxLod, l)
        ? self.assets.materialHandle.prepassNodesFor?.(l)
        : undefined
      : undefined,
  };
}

export function treeGpuRingInput(self: TreeSystem) {
  return {
    state: self.gpuRing, root: self.root, settings: self.settings,
    worldCells: self.worldCells, sampler: self.sampler,
    gpuDevice: self.gpuDevice, gpuBackend: self.gpuBackend,
    supportsGpuTrees: self.supportsGpuTrees,
    unsupportedReason: self.gpuRingUnsupportedReason,
    lodCounts: self.lodCounts,
    createDrawResources: (m: number) => self.createGpuRingResources(m),
    geometryForGpuRing: (s: string, l: TreeLod) => self.assets.geometryForGpuRing(s as TreeSpeciesId, l),
  };
}

export function treeCreateGpuRingResources(self: TreeSystem, maxInstancesPerGroup: number) {
  return createTreeSystemGpuRingDrawResources({
    backend: self.gpuBackend!, root: self.root,
    ringPrepassTwins: self.gpuRing.prepassTwins, settings: self.settings,
    worldCells: self.worldCells, currentLighting: self.currentLighting,
    hydrologyWater: self.hydrologyWater, impostorAtlases: self.assets.impostorAtlases,
    crownProxyGeometry: self.assets.crownProxyGeometry,
    useTreePrepass: self.useTreePrepass,
    treePrepassMaxLod: self.treePrepassMaxLod,
    geometryForGpuRing: (s, l) => self.assets.geometryForGpuRing(s, l),
  }, maxInstancesPerGroup);
}

export function treeClearGpuRing(self: TreeSystem): void {
  clearTreeGpuRing(treeGpuRingInput(self));
}

export function treeUpdateStats(self: TreeSystem): void {
  self.stats = buildTreeRuntimeStats({
    patches: self.patches, geometries: self.assets.geometries,
    lodCounts: self.lodCounts, reportsGpuRingStats: true,
    gpuRing: self.gpuRing, debugShowGpuCounts: self.settings.gpu.debugShowGpuCounts,
    impostorStatus: self.assets.impostorStatus, impostorReason: self.assets.impostorReason,
    earlyTerrainRejectionStats: self.earlyTerrainRejectionStats,
  });
}
