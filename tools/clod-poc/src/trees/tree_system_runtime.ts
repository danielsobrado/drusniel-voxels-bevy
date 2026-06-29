import * as THREE from "three";
import type { ClodPageNode } from "../types.js";
import { treeGpuRingComputeUnsupportedReason } from "../gpu/tree_ring_compute.js";
import type { TreeLod, TreeSettings, TreeSpeciesId } from "./tree_config.js";
import type { TreeTerrainSampler } from "./tree_instances.js";
import type { TreeHydrologyWater } from "./tree_node_material.js";
import type { EnvironmentLighting } from "../environment/environment.js";
import type { ForestLightingMaterialState } from "../forest_lighting/index.js";
import { packTreeSystemGpuFrustumPlanes, treeSystemUsesGpuRingDraw } from "./tree_system_gpu_policy.js";
import { createEmptyTreeSystemStats } from "./tree_system_stats.js";
import { planTreeSystemSettingsUpdate } from "./tree_system_settings_plan.js";
import { treeCpuFallbackGpuStatus, treeGpuRuntimeStatus, treeReportsGpuRingStats } from "./tree_system_gpu_status.js";
import { planTreePatchRemoval } from "./tree_system_patch_removal.js";
import { removeTreePatchResources } from "./tree_system_lifecycle.js";
import type { TreeMeshBoundsState } from "./tree_system_mesh_bounds.js";
import { treeLodCastsShadow } from "./tree_system_shadow_policy.js";
import { buildVisibleTreeLightingProxies } from "./tree_system_lighting_proxies.js";
import { resolveTreeSystemLod } from "./tree_system_lod_resolution.js";
import { createTreeLodCounts, refreshTreePatchesForCenter, resetTreeLodCounts, updateTreePatchLods, type TreeCpuPatchRuntimeInput } from "./tree_system_cpu_runtime.js";
import { createTreeSystemGpuRingDrawResources } from "./tree_system_gpu_ring_resources.js";
import { clearTreeGpuRing, createTreeGpuRingRuntimeState, treeGpuRingMaterialHandles, updateTreeGpuRingTrees, type TreeGpuRingRuntimeInput } from "./tree_system_gpu_ring_runtime.js";
import { TreeSystemAssets } from "./tree_system_assets_runtime.js";
import { TreeGpuLightingProxyCache } from "./tree_system_gpu_lighting_proxy_cache.js";
import { buildTreeRuntimeStats } from "./tree_system_runtime_stats.js";
import type { FallingTree, TreeGpuRingDrawResources, TreeLightingProxy, TreePatch, TreeStats, TreeSystemOptions, TreeWebGpuBackendAccess } from "./tree_system_types.js";

export type {
  FallingTree,
  TreeImpostorStatus,
  TreeLightingProxy,
  TreeStats,
  TreeSystemOptions,
  TreeWebGpuBackendAccess,
} from "./tree_system_types.js";

export function treeUsesGpuRingDraw(settings: TreeSettings): boolean {
  return treeSystemUsesGpuRingDraw(settings);
}

export function packTreeGpuFrustumPlanes(camera?: THREE.Camera, out = new Float32Array(24)): Float32Array {
  return packTreeSystemGpuFrustumPlanes(camera, out);
}

export class TreeSystem {
  private readonly scene: THREE.Scene;
  private readonly nodes: ClodPageNode[];
  private readonly worldCells: number;
  private readonly root = new THREE.Group();
  private readonly sampler: TreeTerrainSampler | undefined;
  private readonly gpuDevice: GPUDevice | null;
  private readonly gpuBackend: TreeWebGpuBackendAccess | null;
  private readonly supportsGpuTrees: boolean;
  private readonly gpuRingUnsupportedReason: string | null;
  private settings: TreeSettings;
  private readonly assets: TreeSystemAssets;
  private readonly hydrologyWater: TreeHydrologyWater | undefined;
  private readonly meshBoundsState = new WeakMap<THREE.InstancedMesh, TreeMeshBoundsState>();
  private patches: TreePatch[] = [];
  private patchesDirty = true;
  private readonly gpuRing = createTreeGpuRingRuntimeState(null);
  private currentLighting: EnvironmentLighting | undefined;
  private readonly lastRefreshCenter = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0);
  private readonly lastCenter: THREE.Vector3;
  private readonly useTreePrepass: boolean;
  // Visible instance count per *primary* LOD (crossfade secondary draws excluded),
  // so the reported LOD distribution still sums to the visible instance count.
  private readonly lodCounts = createTreeLodCounts();
  private stats: TreeStats = createEmptyTreeSystemStats();
  private readonly gpuLightingProxyCache = new TreeGpuLightingProxyCache();

  constructor(options: TreeSystemOptions) {
    this.scene = options.scene;
    this.nodes = options.nodes
      .filter((node) => node.level === 0)
      .sort((a, b) => a.footprint.minZ - b.footprint.minZ || a.footprint.minX - b.footprint.minX);
    this.worldCells = options.worldCells;
    this.settings = { ...options.settings };
    this.sampler = options.sampler;
    this.gpuDevice = options.gpuDevice ?? null;
    this.gpuBackend = options.gpuBackend ?? null;
    this.supportsGpuTrees = options.supportsGpuTrees ?? !!this.gpuDevice;
    this.gpuRingUnsupportedReason = this.gpuDevice
      ? treeGpuRingComputeUnsupportedReason(this.gpuDevice)
      : null;
    this.currentLighting = options.lighting;
    this.hydrologyWater = options.hydrologyWaterTexture
      ? { texture: options.hydrologyWaterTexture, worldSize: this.worldCells }
      : undefined;
    this.assets = new TreeSystemAssets({
      settings: this.settings,
      webgpu: options.webgpu ?? false,
      lighting: options.lighting,
      hydrologyWater: this.hydrologyWater,
      impostorAtlases: options.impostorAtlases,
    });
    this.lastCenter = new THREE.Vector3(this.worldCells * 0.5, 0, this.worldCells * 0.5);
    this.useTreePrepass = typeof location === "undefined"
      ? true
      : new URLSearchParams(location.search).get("prepass") !== "0";
    this.root.name = "trees";
    this.scene.add(this.root);
    this.root.visible = this.settings.enabled;
    if (this.settings.enabled && !this.usesGpuRingDraw()) this.rebuild();
  }

  updateLighting(lighting: EnvironmentLighting): void {
    this.currentLighting = lighting;
    this.assets.updateLighting(lighting);
    for (const handle of treeGpuRingMaterialHandles(this.gpuRing)) {
      handle.updateLighting?.(lighting);
    }
  }

  updateForestLighting(state: ForestLightingMaterialState | null): void {
    this.assets.updateForestLighting(state);
    for (const handle of treeGpuRingMaterialHandles(this.gpuRing)) {
      handle.updateForestLighting?.(state);
    }
  }

  setEnabled(enabled: boolean): void {
    const wasEnabled = this.settings.enabled;
    this.settings.enabled = enabled;
    this.root.visible = enabled;
    if (enabled && !wasEnabled && !this.usesGpuRingDraw()) this.refreshForCenter(this.lastCenter);
    if (!enabled) {
      this.resetLodCounts();
      this.updateStats();
    }
  }

  updateSettings(settings: Partial<TreeSettings>): void {
    const plan = planTreeSystemSettingsUpdate(this.settings, settings, this.assets.geometryKey);
    Object.assign(this.settings, settings);
    this.gpuLightingProxyCache.clear();
    if (plan.clearGpuRing) {
      this.clearGpuRing();
      if (plan.nextGpuStatus) this.gpuRing.status = plan.nextGpuStatus;
    }
    if (plan.needsGeometry) {
      this.assets.rebuildGeometries();
      this.clearPatches();
    }
    this.assets.refreshMaterials(this.patches);
    if (plan.needsPatchRefresh) this.patchesDirty = true;
    this.setEnabled(this.settings.enabled);
  }

  update(timeSeconds: number, center: THREE.Vector3, camera?: THREE.Camera): void {
    this.assets.materialHandle.setTime(timeSeconds);
    for (const handle of treeGpuRingMaterialHandles(this.gpuRing)) {
      handle.setTime(timeSeconds);
      handle.setFadeCenter?.(center.x, center.z);
    }
    this.lastCenter.copy(center);
    const cameraPosition = camera?.position ?? center;
    if (!this.settings.enabled) {
      this.resetLodCounts();
      this.updateStats();
      return;
    }
    if (this.usesGpuRingDraw()) {
      if (this.patches.length > 0) this.clearPatches();
      if (updateTreeGpuRingTrees(this.gpuRingRuntimeInput(), center, camera)) {
        this.updateStats();
        return;
      }
    } else {
      this.clearGpuRing();
      this.updateCpuFallbackGpuStatus();
    }
    if (this.patchesDirty || this.lastRefreshCenter.distanceTo(center) >= this.settings.refreshDistanceM) {
      this.refreshForCenter(center);
    }
    this.updatePatchLods(center, cameraPosition);
  }

  rebuild(): void {
    this.clearPatches();
    this.clearGpuRing();
    if (this.usesGpuRingDraw()) {
      this.updateStats();
      return;
    }
    if (this.settings.enabled) this.refreshForCenter(this.lastCenter);
    this.root.visible = this.settings.enabled;
  }

  /** Schedule deferred re-scatter on the next update cycle. */
  markPatchesDirty(): void {
    this.patchesDirty = true;
  }

  /** Remove patches for edited LOD0 nodes (fast path — no re-scatter).
   *  Returns tree instances whose support was removed (for falling animation). */
  removePatchesForNodes(nodeIds: Iterable<string>): FallingTree[] {
    const ids = new Set(nodeIds);
    if (ids.size === 0) return [];
    if (this.usesGpuRingDraw()) {
      this.clearGpuRing();
      this.resetLodCounts();
      this.gpuRing.visibleCount = 0;
      this.gpuRing.overflowed = false;
      this.gpuRing.dispatchMs = null;
      this.gpuRing.status = treeGpuRuntimeStatus(this.settings, {
        supportsGpuTrees: this.supportsGpuTrees,
        hasDevice: !!this.gpuDevice,
        hasBackend: !!this.gpuBackend,
        unsupportedReason: this.gpuRingUnsupportedReason,
      });
      this.root.visible = this.settings.enabled;
      this.updateStats();
      return [];
    }
    const plan = planTreePatchRemoval(this.patches, ids);
    for (const patch of plan.removed) this.removePatch(patch);
    this.patches = plan.retained;
    return plan.falling;
  }

  rebuildNodePatches(nodeIds: Iterable<string>): void {
    this.removePatchesForNodes(nodeIds);
    if (!this.usesGpuRingDraw()) {
      this.refreshForCenter(this.lastCenter);
    }
  }

  dispose(): void {
    this.clearGpuRing();
    this.clearPatches();
    this.scene.remove(this.root);
    this.assets.dispose();
  }

  getStats(): TreeStats {
    this.updateStats();
    return { ...this.stats };
  }

  getLightingProxies(): TreeLightingProxy[] {
    if (!this.settings.enabled) return [];
    if (this.reportsGpuRingStats()) return this.getGpuRingLightingProxies();
    return buildVisibleTreeLightingProxies(this.settings, this.patches);
  }

  private getGpuRingLightingProxies(): TreeLightingProxy[] {
    return this.gpuLightingProxyCache.get({
      centerX: this.lastCenter.x,
      centerZ: this.lastCenter.z,
      worldCells: this.worldCells,
      settings: this.settings,
      sampler: this.sampler,
    });
  }

  async bakeImpostors(renderer: unknown): Promise<{ supported: boolean; reason: string | null }> {
    const result = await this.assets.bakeImpostors(renderer);
    if (result.supported) {
      this.clearGpuRing();
      this.assets.applyMaterials(this.patches);
      this.assets.replaceImpostorMeshGeometries(this.patches, this.meshBoundsState);
      this.updatePatchLods(this.lastCenter, this.lastCenter);
    }
    return { supported: result.supported, reason: result.reason };
  }

  private refreshForCenter(center: THREE.Vector3): void {
    this.lastRefreshCenter.copy(center);
    const result = refreshTreePatchesForCenter(this.cpuPatchRuntimeInput(), center);
    this.patches = result.patches;
    this.patchesDirty = result.patchesDirty;
    this.updatePatchLods(center, center);
  }

  private updatePatchLods(center: THREE.Vector3, cameraPosition: THREE.Vector3 = center): void {
    updateTreePatchLods(this.cpuPatchRuntimeInput(), center, cameraPosition, this.lodCounts);
    this.updateStats();
  }

  private cpuPatchRuntimeInput(): TreeCpuPatchRuntimeInput {
    return {
      root: this.root,
      nodes: this.nodes,
      patches: this.patches,
      settings: this.settings,
      sampler: this.sampler,
      worldCells: this.worldCells,
      meshBoundsState: this.meshBoundsState,
      impostorAtlases: this.assets.impostorAtlases,
      geometryFor: (species, lod) => this.assets.geometryFor(species, lod),
      materialFor: (species, lod) => this.assets.materialFor(species, lod),
      castsShadow: (lod) => this.treeLodCastsShadow(lod),
      resolveLod: (species, lod) => this.resolveLod(species, lod),
    };
  }

  private resetLodCounts(): void {
    resetTreeLodCounts(this.lodCounts);
  }

  /**
   * Remap the LOD that gets drawn for an instance. Currently only honours
   * `impostors.fallbackToPlaceholder`: when impostors are on but no baked atlas
   * is ready and placeholder fallback is disabled, clamp the impostor band to the
   * far mesh instead of drawing the procedural placeholder cards.
   */
  private resolveLod(species: TreeSpeciesId, lod: TreeLod): TreeLod {
    return resolveTreeSystemLod({
      species,
      lod,
      settings: this.settings,
      impostorAtlases: this.assets.impostorAtlases,
    });
  }

  private usesGpuRingDraw(): boolean {
    return treeSystemUsesGpuRingDraw(this.settings);
  }

  private updateCpuFallbackGpuStatus(): void {
    this.gpuRing.status = treeCpuFallbackGpuStatus(this.settings);
  }

  private reportsGpuRingStats(): boolean {
    return treeReportsGpuRingStats(
      this.usesGpuRingDraw(),
      this.gpuRing.status,
      !!this.gpuRing.draw,
      !!this.gpuRing.compute,
      this.gpuRing.stats.status,
    );
  }

  private gpuRingRuntimeInput(): TreeGpuRingRuntimeInput {
    return {
      state: this.gpuRing,
      root: this.root,
      settings: this.settings,
      worldCells: this.worldCells,
      sampler: this.sampler,
      gpuDevice: this.gpuDevice,
      gpuBackend: this.gpuBackend,
      supportsGpuTrees: this.supportsGpuTrees,
      unsupportedReason: this.gpuRingUnsupportedReason,
      lodCounts: this.lodCounts,
      createDrawResources: (maxInstancesPerGroup) => this.createGpuRingDrawResources(maxInstancesPerGroup),
      geometryForGpuRing: (species, lod) => this.assets.geometryForGpuRing(species, lod),
    };
  }

  private createGpuRingDrawResources(maxInstancesPerGroup: number): TreeGpuRingDrawResources {
    if (!this.gpuBackend) throw new Error("Cannot create WebGPU tree draw resources without a backend");
    return createTreeSystemGpuRingDrawResources({
      backend: this.gpuBackend,
      root: this.root,
      ringPrepassTwins: this.gpuRing.prepassTwins,
      settings: this.settings,
      worldCells: this.worldCells,
      currentLighting: this.currentLighting,
      hydrologyWater: this.hydrologyWater,
      impostorAtlases: this.assets.impostorAtlases,
      crownProxyGeometry: this.assets.crownProxyGeometry,
      useTreePrepass: this.useTreePrepass,
      geometryForGpuRing: (species, lod) => this.assets.geometryForGpuRing(species, lod),
    }, maxInstancesPerGroup);
  }

  private treeLodCastsShadow(lod: TreeLod): boolean {
    return treeLodCastsShadow(this.settings, lod);
  }

  private clearPatches(): void {
    for (const patch of this.patches) this.removePatch(patch);
    this.patches = [];
    this.resetLodCounts();
    this.updateStats();
  }

  private clearGpuRing(): void {
    clearTreeGpuRing(this.gpuRingRuntimeInput());
    this.gpuLightingProxyCache.clear();
  }

  private removePatch(patch: TreePatch): void {
    removeTreePatchResources(this.root, patch);
  }

  private updateStats(): void {
    this.stats = buildTreeRuntimeStats({
      patches: this.patches,
      lodCounts: this.lodCounts,
      reportsGpuRingStats: this.reportsGpuRingStats(),
      gpuRing: this.gpuRing,
      debugShowGpuCounts: this.settings.gpu.debugShowGpuCounts,
      impostorStatus: this.assets.impostorStatus,
      impostorReason: this.assets.impostorReason,
    });
  }
}
