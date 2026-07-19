import type { TreeLod, TreeSpeciesId } from "./tree_config.js";
import { treeLodCastsShadow } from "./tree_system_shadow_policy.js";
import { resolveTreeSystemLod } from "./tree_system_lod_resolution.js";
import {
  createTreeSystemGpuRingDrawResources,
  type TreeGpuRingDrawResourcesInput,
} from "./tree_system_gpu_ring_resources.js";
import { refreshTreeGpuRingImpostorsTransactionally } from "./tree_gpu_ring_impostor_refresh_transaction.js";
import { treeGpuRingRequiresClear } from "./tree_gpu_ring_clear_policy.js";
import { treeReportsGpuRingStats } from "./tree_system_gpu_status.js";
import { treeSystemUsesGpuRingDraw } from "./tree_system_gpu_policy.js";
import { clearTreeGpuRing } from "./tree_system_gpu_ring_runtime.js";
import { buildTreeRuntimeStats } from "./tree_system_runtime_stats.js";
import type { TreeSystem } from "./tree_system_runtime.js";
import { treeLodWithinDepthPrepass } from "./tree_depth_prepass_runtime.js";
import { selectTreeCpuPrepassNodes } from "./tree_system_prepass_policy.js";

export function treeCpuPatchInput(self: TreeSystem) {
  return {
    root: self.root, nodes: self.nodes, patches: self.patches,
    settings: self.settings, sampler: self.sampler,
    terrainOcclusionSampler: self.terrainOcclusionSampler,
    earlyTerrainRejectionStats: self.earlyTerrainRejectionStats,
    worldCells: self.worldCells,
    meshBoundsState: self.meshBoundsState,
    impostorAtlases: self.assets.impostorAtlases,
    geometryFor: (species: TreeSpeciesId, lod: TreeLod) => self.assets.geometryFor(species, lod),
    materialFor: (species: TreeSpeciesId, lod: TreeLod) => self.assets.materialFor(species, lod),
    castsShadow: (lod: TreeLod) => treeLodCastsShadow(self.settings, lod),
    resolveLod: (species: TreeSpeciesId, lod: TreeLod) => resolveTreeSystemLod({
      species,
      lod,
      settings: self.settings,
      impostorAtlases: self.assets.impostorAtlases,
    }),
    prepassNodesFor: self.useCpuTreePrepass
      ? (species: TreeSpeciesId, lod: TreeLod) => {
          if (!treeLodWithinDepthPrepass(self.treePrepassMaxLod, lod)) return undefined;
          return selectTreeCpuPrepassNodes({
            lod,
            bakedImpostor: self.settings.impostors.enabled && self.assets.impostorAtlases[species]?.ready === true,
            impostorMaterial: self.assets.impostorMaterials[species],
            baseNodes: self.assets.materialHandle.prepassNodesFor?.(lod),
          });
        }
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
    createDrawResources: (maxInstances: number) => self.createGpuRingResources(maxInstances),
    geometryForGpuRing: (species: string, lod: TreeLod) => self.assets.geometryForGpuRing(species as TreeSpeciesId, lod),
  };
}

export function treeCreateGpuRingResources(self: TreeSystem, maxInstancesPerGroup: number) {
  return createTreeSystemGpuRingDrawResources(treeGpuRingDrawResourcesInput(self), maxInstancesPerGroup);
}

export function treeRefreshGpuRingImpostors(self: TreeSystem): boolean {
  const draw = self.gpuRing.draw;
  if (!draw) return false;
  return refreshTreeGpuRingImpostorsTransactionally(treeGpuRingDrawResourcesInput(self), draw);
}

export function treeClearGpuRing(self: TreeSystem): void {
  if (!treeGpuRingRequiresClear(self.gpuRing)) return;
  clearTreeGpuRing(treeGpuRingInput(self));
}

export function treeUpdateStats(self: TreeSystem): void {
  self.stats = buildTreeRuntimeStats({
    patches: self.patches,
    geometries: self.assets.geometries,
    lodCounts: self.lodCounts,
    reportsGpuRingStats: treeReportsGpuRingStats(
      treeSystemUsesGpuRingDraw(self.settings),
      self.gpuRing.status,
      !!self.gpuRing.draw,
      !!self.gpuRing.compute,
      self.gpuRing.stats.status,
    ),
    gpuRing: self.gpuRing,
    debugShowGpuCounts: self.settings.gpu.debugShowGpuCounts,
    impostorStatus: self.assets.impostorStatus,
    impostorReason: self.assets.impostorReason,
    earlyTerrainRejectionStats: self.earlyTerrainRejectionStats,
  });
}

function treeGpuRingDrawResourcesInput(self: TreeSystem): TreeGpuRingDrawResourcesInput {
  if (!self.gpuBackend) throw new Error("Cannot create WebGPU tree draw resources without a backend");
  return {
    backend: self.gpuBackend,
    root: self.root,
    ringPrepassTwins: self.gpuRing.prepassTwins,
    settings: self.settings,
    worldCells: self.worldCells,
    currentLighting: self.currentLighting,
    currentForestLighting: self.currentForestLighting,
    hydrologyWater: self.hydrologyWater,
    impostorAtlases: self.assets.impostorAtlases,
    foliageAtlas: self.assets.foliageAtlas,
    crownProxyGeometry: self.assets.crownProxyGeometry,
    useTreePrepass: self.useTreePrepass,
    treePrepassMaxLod: self.treePrepassMaxLod,
    geometryForGpuRing: (species, lod) => self.assets.geometryForGpuRing(species, lod),
  };
}
