export * from "./tree_system_runtime_types.js";
export * from "./tree_system_runtime_defaults.js";
export * from "./tree_system_runtime_wrappers.js";

import * as THREE from "three";
import type { ClodPageNode } from "../types.js";
import { treeGpuRingComputeUnsupportedReason } from "../gpu/tree_ring_compute.js";
import type { TreeSettings } from "./tree_config.js";
import type { TreeTerrainSampler } from "./tree_instances.js";
import type { TreeTerrainOcclusionSampler } from "./tree_terrain_occlusion.js";
import type { TreeHydrologyWater } from "./tree_node_material.js";
import type { EnvironmentLighting } from "../environment/environment.js";
import type { ForestLightingMaterialState } from "../forest_lighting/index.js";
import { treeSystemUsesGpuRingDraw } from "./tree_system_gpu_policy.js";
import { createEmptyTreeSystemStats } from "./tree_system_stats.js";
import { createEmptyTreeEarlyTerrainRejectionStats } from "./tree_patch_terrain_rejection.js";
import { planTreeSystemSettingsUpdate } from "./tree_system_settings_plan.js";
import { treeCpuFallbackGpuStatus, treeGpuRuntimeStatus, treeReportsGpuRingStats } from "./tree_system_gpu_status.js";
import { planTreePatchRemoval } from "./tree_system_patch_removal.js";
import { removeTreePatchResources } from "./tree_system_lifecycle.js";
import type { TreeMeshBoundsState } from "./tree_system_mesh_bounds.js";
import { buildVisibleTreeLightingProxies } from "./tree_system_lighting_proxies.js";
import { createTreeLodCounts, refreshTreePatchesForCenter, resetTreeLodCounts, updateTreePatchLods } from "./tree_system_cpu_runtime.js";
import { createTreeGpuRingRuntimeState, treeGpuRingMaterialHandles, updateTreeGpuRingTrees } from "./tree_system_gpu_ring_runtime.js";
import { TreeSystemAssets } from "./tree_system_assets_runtime.js";
import { TreeGpuLightingProxyCache } from "./tree_system_gpu_lighting_proxy_cache.js";
import type { FallingTree, TreeLightingProxy, TreePatch, TreeStats, TreeSystemOptions, TreeWebGpuBackendAccess } from "./tree_system_types.js";
import type { TreeIsolatedRenderer } from "./tree_system_runtime_types.js";
import { treeCpuPatchInput, treeGpuRingInput, treeCreateGpuRingResources, treeClearGpuRing, treeUpdateStats } from "./tree_system_runtime_privates.js";

export class TreeSystem {
  readonly scene: THREE.Scene;
  readonly nodes: ClodPageNode[];
  readonly worldCells: number;
  readonly root = new THREE.Group();
  readonly sampler: TreeTerrainSampler | undefined;
  readonly terrainOcclusionSampler: TreeTerrainOcclusionSampler | undefined;
  readonly gpuDevice: GPUDevice | null;
  readonly gpuBackend: TreeWebGpuBackendAccess | null;
  readonly supportsGpuTrees: boolean;
  readonly gpuRingUnsupportedReason: string | null;
  settings: TreeSettings;
  readonly assets: TreeSystemAssets;
  readonly hydrologyWater: TreeHydrologyWater | undefined;
  readonly meshBoundsState = new WeakMap<THREE.InstancedMesh, TreeMeshBoundsState>();
  patches: TreePatch[] = [];
  patchesDirty = true;
  readonly gpuRing = createTreeGpuRingRuntimeState(null);
  currentLighting: EnvironmentLighting | undefined;
  readonly lastRefreshCenter = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0);
  readonly lastCenter: THREE.Vector3;
  readonly useTreePrepass: boolean;
  readonly useCpuTreePrepass: boolean;
  readonly lodCounts = createTreeLodCounts();
  stats: TreeStats = createEmptyTreeSystemStats();
  readonly earlyTerrainRejectionStats = createEmptyTreeEarlyTerrainRejectionStats();
  readonly gpuLightingProxyCache = new TreeGpuLightingProxyCache();
  measureScene: THREE.Scene | null = null;

  constructor(options: TreeSystemOptions) {
    this.scene = options.scene;
    this.nodes = options.nodes.filter(n => n.level === 0).sort((a, b) => a.footprint.minZ - b.footprint.minZ || a.footprint.minX - b.footprint.minX);
    this.worldCells = options.worldCells;
    this.settings = { ...options.settings };
    this.sampler = options.sampler;
    this.terrainOcclusionSampler = options.terrainOcclusionSampler;
    this.gpuDevice = options.gpuDevice ?? null;
    this.gpuBackend = options.gpuBackend ?? null;
    this.supportsGpuTrees = options.supportsGpuTrees ?? !!this.gpuDevice;
    this.gpuRingUnsupportedReason = this.gpuDevice ? treeGpuRingComputeUnsupportedReason(this.gpuDevice) : null;
    this.currentLighting = options.lighting;
    this.hydrologyWater = options.hydrologyWaterTexture ? { texture: options.hydrologyWaterTexture, worldSize: this.worldCells } : undefined;
    this.assets = new TreeSystemAssets({ settings: this.settings, webgpu: options.webgpu ?? false, lighting: options.lighting, hydrologyWater: this.hydrologyWater, impostorAtlases: options.impostorAtlases });
    this.lastCenter = new THREE.Vector3(this.worldCells * 0.5, 0, this.worldCells * 0.5);
    this.useTreePrepass = typeof location === "undefined" ? true : new URLSearchParams(location.search).get("prepass") !== "0";
    this.useCpuTreePrepass = typeof location !== "undefined" && new URLSearchParams(location.search).get("treeCpuPrepass") === "1";
    this.root.name = "trees";
    this.scene.add(this.root);
    this.root.visible = this.settings.enabled;
    if (this.settings.enabled && !treeSystemUsesGpuRingDraw(this.settings)) this.refreshForCenter(this.lastCenter);
  }

  updateLighting(lighting: EnvironmentLighting): void {
    this.currentLighting = lighting;
    this.assets.updateLighting(lighting);
    for (const handle of treeGpuRingMaterialHandles(this.gpuRing)) handle.updateLighting?.(lighting);
  }

  updateForestLighting(state: ForestLightingMaterialState | null): void {
    this.assets.updateForestLighting(state);
    for (const handle of treeGpuRingMaterialHandles(this.gpuRing)) handle.updateForestLighting?.(state);
  }

  setEnabled(enabled: boolean): void {
    const wasEnabled = this.settings.enabled;
    this.settings.enabled = enabled;
    this.root.visible = enabled;
    if (enabled && !wasEnabled && !treeSystemUsesGpuRingDraw(this.settings)) this.refreshForCenter(this.lastCenter);
    if (!enabled) { this.updateStats(); resetTreeLodCounts(this.lodCounts); }
  }

  renderIsolatedForTiming(renderer: TreeIsolatedRenderer, target: THREE.RenderTarget, camera: THREE.Camera): void {
    const prevParent = this.root.parent;
    const wasVisible = this.root.visible;
    this.root.visible = true;
    if (!this.measureScene) this.measureScene = new THREE.Scene();
    this.measureScene.add(this.root);
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(this.measureScene, camera);
    renderer.setRenderTarget(prevTarget);
    this.root.visible = wasVisible;
    if (prevParent) prevParent.add(this.root);
    else this.measureScene.remove(this.root);
  }

  updateSettings(settings: Partial<TreeSettings>): void {
    const plan = planTreeSystemSettingsUpdate(this.settings, settings, this.assets.geometryKey);
    Object.assign(this.settings, settings);
    this.gpuLightingProxyCache.clear();
    if (plan.clearGpuRing) {
      this.clearGpuRing();
      if (plan.nextGpuStatus) this.gpuRing.status = plan.nextGpuStatus;
    }
    if (plan.needsGeometry) { this.assets.rebuildGeometries(); this.clearPatches(); }
    this.assets.refreshMaterials(this.patches);
    if (plan.needsPatchRefresh) this.patchesDirty = true;
    this.setEnabled(this.settings.enabled);
  }

  update(timeSeconds: number, center: THREE.Vector3, camera?: THREE.Camera): void {
    this.assets.materialHandle.setTime(timeSeconds);
    for (const handle of treeGpuRingMaterialHandles(this.gpuRing)) handle.setTime(timeSeconds);
    this.lastCenter.copy(center);
    const cameraPosition = camera?.position ?? center;
    if (!this.settings.enabled) { resetTreeLodCounts(this.lodCounts); this.updateStats(); return; }
    if (treeSystemUsesGpuRingDraw(this.settings)) {
      if (this.patches.length > 0) this.clearPatches();
      if (updateTreeGpuRingTrees(treeGpuRingInput(this), center, camera)) { this.updateStats(); return; }
      if (!this.settings.gpu.fallbackToCpu) {
        resetTreeLodCounts(this.lodCounts);
        this.updateStats();
        return;
      }
    } else {
      this.clearGpuRing();
      this.gpuRing.status = treeCpuFallbackGpuStatus(this.settings);
    }
    if (this.patchesDirty || this.lastRefreshCenter.distanceTo(center) >= this.settings.refreshDistanceM) this.refreshForCenter(center, cameraPosition);
    this.updatePatchLods(center, cameraPosition);
  }

  rebuild(): void {
    this.clearPatches();
    this.clearGpuRing();
    if (treeSystemUsesGpuRingDraw(this.settings)) { this.updateStats(); return; }
    if (this.settings.enabled) this.refreshForCenter(this.lastCenter);
    this.root.visible = this.settings.enabled;
  }

  markPatchesDirty(): void { this.patchesDirty = true; }

  removePatchesForNodes(nodeIds: Iterable<string>): FallingTree[] {
    const ids = new Set(nodeIds);
    if (ids.size === 0) return [];
    if (treeSystemUsesGpuRingDraw(this.settings)) {
      this.clearGpuRing();
      resetTreeLodCounts(this.lodCounts);
      this.gpuRing.visibleCount = 0;
      this.gpuRing.overflowed = false;
      this.gpuRing.dispatchMs = null;
      this.gpuRing.status = treeGpuRuntimeStatus(this.settings, { supportsGpuTrees: this.supportsGpuTrees, hasDevice: !!this.gpuDevice, hasBackend: !!this.gpuBackend, unsupportedReason: this.gpuRingUnsupportedReason });
      this.root.visible = this.settings.enabled;
      this.updateStats();
      return [];
    }
    const plan = planTreePatchRemoval(this.patches, ids);
    for (const patch of plan.removed) removeTreePatchResources(this.root, patch);
    this.patches = plan.retained;
    return plan.falling;
  }

  rebuildNodePatches(nodeIds: Iterable<string>): void {
    this.removePatchesForNodes(nodeIds);
    if (!treeSystemUsesGpuRingDraw(this.settings)) this.refreshForCenter(this.lastCenter);
  }

  dispose(): void { this.clearGpuRing(); this.clearPatches(); this.scene.remove(this.root); this.assets.dispose(); }

  getStats(): TreeStats { this.updateStats(); return { ...this.stats }; }

  getLightingProxies(): TreeLightingProxy[] {
    if (!this.settings.enabled) return [];
    const gpRingOn = treeSystemUsesGpuRingDraw(this.settings);
    if (treeReportsGpuRingStats(gpRingOn, this.gpuRing.status, !!this.gpuRing.draw, !!this.gpuRing.compute, this.gpuRing.stats.status)) {
      return this.gpuLightingProxyCache.get({ centerX: this.lastCenter.x, centerZ: this.lastCenter.z, worldCells: this.worldCells, settings: this.settings, sampler: this.sampler });
    }
    return buildVisibleTreeLightingProxies(this.settings, this.patches);
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

  refreshForCenter(center: THREE.Vector3, cameraPosition: THREE.Vector3 = center): void {
    this.lastRefreshCenter.copy(center);
    const result = refreshTreePatchesForCenter(treeCpuPatchInput(this), center, cameraPosition);
    this.patches = result.patches;
    this.patchesDirty = result.patchesDirty;
    this.updatePatchLods(center, cameraPosition);
  }

  updatePatchLods(center: THREE.Vector3, cameraPosition: THREE.Vector3 = center): void {
    updateTreePatchLods(treeCpuPatchInput(this), center, cameraPosition, this.lodCounts);
    this.updateStats();
  }

  createGpuRingResources(maxInstancesPerGroup: number) {
    if (!this.gpuBackend) throw new Error("Cannot create WebGPU tree draw resources without a backend");
    return treeCreateGpuRingResources(this, maxInstancesPerGroup);
  }

  clearPatches(): void {
    for (const patch of this.patches) removeTreePatchResources(this.root, patch);
    this.patches = []; this.updateStats(); resetTreeLodCounts(this.lodCounts);
  }

  clearGpuRing(): void { treeClearGpuRing(this); this.gpuLightingProxyCache.clear(); }

  updateStats(): void {
    treeUpdateStats(this);
  }
}
