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
import {
  DEFAULT_TREE_DEPTH_PREPASS_MAX_LOD,
  parseTreeDepthPrepassMaxLod,
  treeDepthPrepassEnabled,
  type TreeDepthPrepassMaxLod,
} from "./tree_depth_prepass_runtime.js";
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
import { createTreeGpuRingRuntimeState, treeGpuRingMaterialHandles } from "./tree_system_gpu_ring_runtime.js";
import { updateTreeGpuRingTreesSafely } from "./tree_system_gpu_ring_safe_update.js";
import { treeGpuCpuPatchHandoffAction } from "./tree_system_gpu_cpu_handoff.js";
import { TreeSystemAssets } from "./tree_system_assets_runtime.js";
import { TreeGpuLightingProxyCache } from "./tree_system_gpu_lighting_proxy_cache.js";
import { TreePlacementDebugOverlay } from "./tree_placement_debug_overlay.js";
import type { FallingTree, TreeLightingProxy, TreePatch, TreeStats, TreeSystemOptions, TreeWebGpuBackendAccess } from "./tree_system_types.js";
import type { TreeIsolatedRenderer } from "./tree_system_runtime_types.js";
import {
  treeCpuPatchInput,
  treeGpuRingInput,
  treeCreateGpuRingResources,
  treeRefreshGpuRingImpostors,
  treeClearGpuRing,
  treeUpdateStats,
} from "./tree_system_runtime_privates.js";
import {
  executeTreeImpostorBakeHandoff,
  treeImpostorBakeHandoffAction,
} from "./tree_impostor_bake_handoff.js";

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
  currentForestLighting: ForestLightingMaterialState | null = null;
  readonly lastRefreshCenter = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0);
  readonly lastCenter: THREE.Vector3;
  useTreePrepass: boolean;
  useCpuTreePrepass: boolean;
  treePrepassMaxLod: TreeDepthPrepassMaxLod;
  private readonly cpuTreePrepassRequested: boolean;
  readonly lodCounts = createTreeLodCounts();
  stats: TreeStats = createEmptyTreeSystemStats();
  readonly earlyTerrainRejectionStats = createEmptyTreeEarlyTerrainRejectionStats();
  readonly gpuLightingProxyCache = new TreeGpuLightingProxyCache();
  readonly placementDebugOverlay = new TreePlacementDebugOverlay(this.root);
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
    const searchParams = typeof location === "undefined" ? null : new URLSearchParams(location.search);
    const globalPrepassDisabled = searchParams?.get("prepass") === "0";
    const treePrepassDisabled = searchParams?.get("treePrepass") === "0";
    this.treePrepassMaxLod = globalPrepassDisabled || treePrepassDisabled
      ? "none"
      : parseTreeDepthPrepassMaxLod(searchParams?.get("treePrepassMaxLod") ?? DEFAULT_TREE_DEPTH_PREPASS_MAX_LOD);
    this.useTreePrepass = treeDepthPrepassEnabled(this.treePrepassMaxLod);
    this.cpuTreePrepassRequested = searchParams?.get("treeCpuPrepass") === "1";
    this.useCpuTreePrepass = this.cpuTreePrepassRequested && this.useTreePrepass;
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
    this.currentForestLighting = state;
    this.assets.updateForestLighting(state);
    for (const handle of treeGpuRingMaterialHandles(this.gpuRing)) handle.updateForestLighting?.(state);
  }

  setDepthPrepassMaxLod(maxLod: TreeDepthPrepassMaxLod): void {
    if (this.treePrepassMaxLod === maxLod) return;
    this.treePrepassMaxLod = maxLod;
    this.useTreePrepass = treeDepthPrepassEnabled(maxLod);
    this.useCpuTreePrepass = this.cpuTreePrepassRequested && this.useTreePrepass;
    this.clearGpuRing();
    this.clearPatches();
    if (this.settings.enabled && !treeSystemUsesGpuRingDraw(this.settings)) this.refreshForCenter(this.lastCenter);
    this.updateStats();
  }

  setEnabled(enabled: boolean): void {
    const wasEnabled = this.settings.enabled;
    this.settings.enabled = enabled;
    this.root.visible = enabled;
    if (enabled && !wasEnabled && !treeSystemUsesGpuRingDraw(this.settings)) this.refreshForCenter(this.lastCenter);
    if (!enabled) {
      resetTreeLodCounts(this.lodCounts);
      this.updateStats();
    }
    this.updatePlacementDebugOverlay();
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
    this.updatePlacementDebugOverlay();
  }

  update(timeSeconds: number, center: THREE.Vector3, camera?: THREE.Camera): void {
    this.assets.materialHandle.setTime(timeSeconds);
    for (const handle of treeGpuRingMaterialHandles(this.gpuRing)) handle.setTime(timeSeconds);
    this.lastCenter.copy(center);
    const cameraPosition = camera?.position ?? center;
    if (!this.settings.enabled) { resetTreeLodCounts(this.lodCounts); this.updateStats(); return; }
    if (treeSystemUsesGpuRingDraw(this.settings)) {
      const gpuUpdated = updateTreeGpuRingTreesSafely(treeGpuRingInput(this), center, camera);
      const patchAction = treeGpuCpuPatchHandoffAction({
        gpuUpdated,
        gpuReady: !!this.gpuRing.compute && !!this.gpuRing.draw,
        fallbackToCpu: this.settings.gpu.fallbackToCpu,
      });
      if (patchAction === "retire" && this.patches.length > 0) this.clearPatches();
      if (gpuUpdated) { this.updateStats(); return; }
      if (!this.settings.gpu.fallbackToCpu) {
        resetTreeLodCounts(this.lodCounts);
        this.updateStats();
        return;
      }
    } else {
      this.clearGpuRing();
      this.gpuRing.status = treeCpuFallbackGpuStatus(this.settings);
    }
    if (this.patchesDirty || this.lastRefreshCenter.distanceTo(center) >= this.settings.refreshDistanceM) {
      this.refreshForCenter(center, cameraPosition);
    } else {
      this.updatePatchLods(center, cameraPosition);
    }
  }

  rebuild(): void {
    this.clearPatches();
    this.clearGpuRing();
    if (treeSystemUsesGpuRingDraw(this.settings)) { this.updateStats(); return; }
    if (this.settings.enabled) this.refreshForCenter(this.lastCenter);
    this.root.visible = this.settings.enabled;
    this.updatePlacementDebugOverlay();
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
      this.updatePlacementDebugOverlay();
      return [];
    }
    const plan = planTreePatchRemoval(this.patches, ids);
    for (const patch of plan.removed) removeTreePatchResources(this.root, patch);
    this.patches = plan.retained;
    this.updatePatchLods(this.lastCenter, this.lastCenter);
    this.updatePlacementDebugOverlay();
    return plan.falling;
  }

  rebuildNodePatches(nodeIds: Iterable<string>): void {
    this.removePatchesForNodes(nodeIds);
    if (!treeSystemUsesGpuRingDraw(this.settings)) this.refreshForCenter(this.lastCenter);
  }

  dispose(): void {
    this.clearGpuRing();
    this.clearPatches();
    this.placementDebugOverlay.dispose();
    this.scene.remove(this.root);
    this.assets.dispose();
  }

  getStats(): TreeStats { return { ...this.stats }; }

  getLightingProxies(): TreeLightingProxy[] {
    if (!this.settings.enabled) return [];
    const gpRingOn = treeSystemUsesGpuRingDraw(this.settings);
    if (treeReportsGpuRingStats(gpRingOn, this.gpuRing.status, !!this.gpuRing.draw, !!this.gpuRing.compute, this.gpuRing.stats.status)) {
      return this.gpuLightingProxyCache.get({ centerX: this.lastCenter.x, centerZ: this.lastCenter.z, worldCells: this.worldCells, settings: this.settings, sampler: this.sampler });
    }
    return buildVisibleTreeLightingProxies(this.settings, this.patches);
  }

  /** Deadline-bounded variant of {@link getLightingProxies} for the per-frame
   *  forest-lighting budget: the GPU-ring proxy scan is spread across frames
   *  and the previous proxy set is returned (ready=false) until it completes. */
  getLightingProxiesBudgeted(deadlineMs: number): { proxies: readonly TreeLightingProxy[]; ready: boolean } {
    if (!this.settings.enabled) return { proxies: [], ready: true };
    const gpRingOn = treeSystemUsesGpuRingDraw(this.settings);
    if (treeReportsGpuRingStats(gpRingOn, this.gpuRing.status, !!this.gpuRing.draw, !!this.gpuRing.compute, this.gpuRing.stats.status)) {
      return this.gpuLightingProxyCache.getBudgeted(
        { centerX: this.lastCenter.x, centerZ: this.lastCenter.z, worldCells: this.worldCells, settings: this.settings, sampler: this.sampler },
        deadlineMs,
      );
    }
    return { proxies: buildVisibleTreeLightingProxies(this.settings, this.patches), ready: true };
  }

  async bakeImpostors(renderer: unknown): Promise<{ supported: boolean; reason: string | null }> {
    const result = await this.assets.bakeImpostors(renderer);
    executeTreeImpostorBakeHandoff(
      treeImpostorBakeHandoffAction(this.settings, result.supported),
      {
        swapLive: () => {
          this.refreshGpuRingImpostors();
          // Geometry first: applyMaterials only assigns the billboard impostor
          // material to meshes that already carry the baked flat-card geometry.
          this.assets.replaceImpostorMeshGeometries(this.patches, this.meshBoundsState);
          this.assets.applyMaterials(this.patches);
          this.updatePatchLods(this.lastCenter, this.lastCenter);
        },
        rebuildGpu: () => {
          this.clearGpuRing();
          this.updateStats();
        },
        rebuildCpu: () => {
          this.clearPatches();
          this.patchesDirty = true;
          this.updateStats();
        },
        resetGpuConsumers: () => this.clearGpuRing(),
        resetCpuConsumers: () => {
          this.clearPatches();
          this.patchesDirty = true;
        },
      },
    );
    return { supported: result.supported, reason: result.reason };
  }

  refreshForCenter(center: THREE.Vector3, cameraPosition: THREE.Vector3 = center): void {
    this.lastRefreshCenter.copy(center);
    const result = refreshTreePatchesForCenter(treeCpuPatchInput(this), center, cameraPosition);
    this.patches = result.patches;
    this.patchesDirty = result.patchesDirty;
    this.updatePatchLods(center, cameraPosition);
    this.updatePlacementDebugOverlay();
  }

  updatePatchLods(center: THREE.Vector3, cameraPosition: THREE.Vector3 = center): void {
    updateTreePatchLods(treeCpuPatchInput(this), center, cameraPosition, this.lodCounts);
    this.updateStats();
  }

  createGpuRingResources(maxInstancesPerGroup: number) {
    if (!this.gpuBackend) throw new Error("Cannot create WebGPU tree draw resources without a backend");
    return treeCreateGpuRingResources(this, maxInstancesPerGroup);
  }

  refreshGpuRingImpostors(): boolean {
    const swapped = treeRefreshGpuRingImpostors(this);
    if (swapped) this.gpuLightingProxyCache.clear();
    return swapped;
  }

  clearPatches(): void {
    for (const patch of this.patches) removeTreePatchResources(this.root, patch);
    this.patches = [];
    resetTreeLodCounts(this.lodCounts);
    this.placementDebugOverlay.clear();
    this.updateStats();
  }

  clearGpuRing(): void { treeClearGpuRing(this); this.gpuLightingProxyCache.clear(); }

  updateStats(): void {
    treeUpdateStats(this);
  }

  private updatePlacementDebugOverlay(): void {
    this.placementDebugOverlay.update(this.patches, this.settings.enabled && this.settings.render.placementDebug);
  }
}
