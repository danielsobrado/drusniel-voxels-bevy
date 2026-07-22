import * as THREE from "three";
import type { ClodPageNode } from "../types.js";
import { UNDERSTORY_CLASSES, type UnderstoryClass, type UnderstorySettings } from "./understory_config.js";
import {
  createUnderstoryGeometryMap,
  disposeUnderstoryGeometryMap,
  type UnderstoryGeometryMap,
} from "./understory_geometry.js";
import { createUnderstoryMaterialHandle, type UnderstoryMaterialHandle } from "./understory_material.js";
import { createUnderstoryNodeMaterialHandle } from "./understory_node_material.js";
import type { ForestLightingMaterialState } from "../forest_lighting/index.js";
import type { EnvironmentLighting } from "../environment/environment.js";
import type { UnderstoryHydrologyData, UnderstoryWebGpuBackendAccess } from "../gpu/understory_ring_compute.js";
import { UnderstoryGpuRingRuntime } from "./understory_gpu_ring_runtime.js";
import { UnderstoryCpuPatchRuntime } from "./understory_cpu_patch_runtime.js";
import { UnderstoryGpuLightingProxyCache } from "./understory_gpu_lighting_proxies.js";
import type { UnderstoryTerrainSampler } from "./understory_instances.js";
import {
  emptyUnderstoryStats,
  mergeGenerationStats,
  type UnderstoryLightingProxy,
  type UnderstoryStats,
} from "./understory_system_support.js";

export interface UnderstorySystemOptions {
  scene: THREE.Scene;
  nodes: ClodPageNode[];
  worldCells: number;
  settings: UnderstorySettings;
  sampler?: UnderstoryTerrainSampler;
  webgpu?: boolean;
  lighting?: EnvironmentLighting;
  gpuDevice?: GPUDevice | null;
  gpuBackend?: UnderstoryWebGpuBackendAccess | null;
  supportsGpu?: boolean;
  hydrologyData?: UnderstoryHydrologyData | null;
  hydrologyWaterTexture?: THREE.Texture | null;
}

export class UnderstorySystem {
  private readonly scene: THREE.Scene;
  private readonly sampler: UnderstoryTerrainSampler | undefined;
  private readonly root = new THREE.Group();
  private settings: UnderstorySettings;
  private geometries: UnderstoryGeometryMap;
  private materialHandle: UnderstoryMaterialHandle;
  private readonly lastCenter: THREE.Vector3;
  private stats: UnderstoryStats = emptyUnderstoryStats();
  private readonly supportsGpu: boolean;
  private gpuStatus: UnderstoryStats["gpuStatus"] = "disabled";
  private readonly gpuRing: UnderstoryGpuRingRuntime;
  private readonly cpuPatches: UnderstoryCpuPatchRuntime;
  private readonly gpuLightingProxies = new UnderstoryGpuLightingProxyCache();

  constructor(options: UnderstorySystemOptions) {
    this.scene = options.scene;
    this.settings = options.settings;
    this.sampler = options.sampler;
    this.supportsGpu = options.supportsGpu ?? !!options.gpuDevice;
    this.geometries = createUnderstoryGeometryMap(this.settings);
    this.materialHandle = options.webgpu
      ? createUnderstoryNodeMaterialHandle(this.settings, options.lighting)
      : createUnderstoryMaterialHandle(this.settings);
    this.lastCenter = new THREE.Vector3(options.worldCells * 0.5, 0, options.worldCells * 0.5);
    this.root.name = "understory";
    this.root.visible = this.settings.enabled;
    this.scene.add(this.root);

    this.gpuRing = new UnderstoryGpuRingRuntime({
      root: this.root,
      worldCells: options.worldCells,
      supportsGpu: this.supportsGpu,
      gpuDevice: options.gpuDevice,
      gpuBackend: options.gpuBackend,
      hydrologyData: options.hydrologyData,
      hydrologyWaterTexture: options.hydrologyWaterTexture,
      lighting: options.lighting,
      sampler: this.sampler,
    });
    this.cpuPatches = new UnderstoryCpuPatchRuntime({
      nodes: options.nodes,
      worldCells: options.worldCells,
      root: this.root,
      sampler: this.sampler,
      geometries: () => this.geometries,
      materialFor: (cls) => this.materialFor(cls),
      classCastsShadow: (cls) => this.classCastsShadow(cls),
    });

    if (this.settings.enabled && !this.usesGpuRingDraw()) this.rebuild();
  }

  setEnabled(enabled: boolean): void {
    const wasEnabled = this.settings.enabled;
    this.settings.enabled = enabled;
    this.root.visible = enabled;
    if (!enabled) {
      this.gpuStatus = "disabled";
      this.updateStats();
      return;
    }
    if (!wasEnabled && !this.usesGpuRingDraw()) {
      this.cpuPatches.refreshForCenter(this.lastCenter, this.settings);
      this.updateStats();
    }
  }

  private usesGpuRingDraw(): boolean {
    return this.gpuRing.canUse(this.settings);
  }

  private updateCpuFallbackGpuStatus(): void {
    if (!this.settings.gpu.enabled) {
      this.gpuStatus = "disabled";
      return;
    }
    if (this.settings.gpu.debugForceCpu) {
      this.gpuStatus = "fallback-cpu";
      return;
    }
    if (!this.supportsGpu || !this.gpuRing.hasDevice || !this.gpuRing.hasBackend) {
      this.gpuStatus = this.settings.gpu.fallbackToCpu ? "fallback-cpu" : "unsupported";
      return;
    }
    if (this.gpuRing.unsupportedReason) {
      this.gpuStatus = this.settings.gpu.fallbackToCpu ? "fallback-cpu" : "unsupported";
      return;
    }
    this.gpuStatus = this.settings.gpu.fallbackToCpu ? "fallback-cpu" : "disabled";
  }

  updateSettings(settings: Partial<UnderstorySettings>): void {
    const needsGeometry = settings.classes !== undefined;
    const needsPatchRefresh =
      needsGeometry ||
      settings.enabled !== undefined ||
      settings.seed !== undefined ||
      settings.distanceM !== undefined ||
      settings.refreshDistanceM !== undefined ||
      settings.maxInstances !== undefined ||
      settings.placement !== undefined ||
      settings.ecology !== undefined;
    this.settings = { ...this.settings, ...settings };
    if (needsGeometry) {
      disposeUnderstoryGeometryMap(this.geometries);
      this.geometries = createUnderstoryGeometryMap(this.settings);
      this.cpuPatches.clear();
    }
    this.materialHandle.updateSettings(this.settings);
    this.applyMaterials();
    for (const handle of this.gpuRing.draw?.materialHandles ?? []) {
      handle?.updateSettings(this.settings);
    }
    if (needsPatchRefresh) this.cpuPatches.markDirty();
    this.setEnabled(this.settings.enabled);
  }

  update(timeSeconds: number, center: THREE.Vector3, camera?: THREE.Camera): void {
    this.materialHandle.setTime(timeSeconds);
    for (const handle of this.gpuRing.draw?.materialHandles ?? []) {
      handle?.setTime(timeSeconds);
    }
    this.lastCenter.copy(center);
    if (!this.settings.enabled) {
      this.updateStats();
      return;
    }
    if (this.usesGpuRingDraw()) {
      if (this.cpuPatches.patches.length > 0) this.cpuPatches.clear();
      if (this.gpuRing.update(this.settings, center, camera)) {
        this.gpuStatus = "ring";
        this.updateStats();
        return;
      }
      // Fallback stays in the façade (props-style boolean handoff).
      if (this.settings.gpu.fallbackToCpu && this.gpuRing.lastFailure === "runtime") {
        this.clearGpuRing();
        this.gpuStatus = "fallback-cpu";
        this.cpuPatches.ensure(this.settings, center);
        this.updateStats();
        return;
      }
      this.gpuStatus = this.gpuRing.statusAfterFailure();
      this.updateStats();
      return;
    }
    if (this.gpuRing.hasResources) this.clearGpuRing();
    this.updateCpuFallbackGpuStatus();
    this.cpuPatches.update(this.settings, center);
    this.updateStats();
  }

  rebuild(): void {
    this.clearGpuRing();
    this.cpuPatches.clear();
    if (this.settings.enabled) {
      if (this.usesGpuRingDraw()) {
        this.gpuStatus = "ring";
      } else {
        this.updateCpuFallbackGpuStatus();
        this.cpuPatches.refreshForCenter(this.lastCenter, this.settings);
      }
    } else {
      this.gpuStatus = "disabled";
    }
    this.root.visible = this.settings.enabled;
    this.updateStats();
  }

  markPatchesDirty(): void {
    this.cpuPatches.markDirty();
  }

  removePatchesForNodes(nodeIds: Iterable<string>): void {
    this.cpuPatches.removeForNodes(nodeIds);
  }

  rebuildNodePatches(nodeIds: Iterable<string>): void {
    if (this.usesGpuRingDraw()) {
      this.clearGpuRing();
      this.cpuPatches.markDirty();
      return;
    }
    this.cpuPatches.removeForNodes(nodeIds);
    this.cpuPatches.refreshForCenter(this.lastCenter, this.settings);
  }

  dispose(): void {
    this.clearGpuRing();
    this.cpuPatches.clear();
    this.scene.remove(this.root);
    disposeUnderstoryGeometryMap(this.geometries);
    this.materialHandle.dispose();
  }

  getStats(): UnderstoryStats {
    this.updateStats();
    return { ...this.stats };
  }

  updateForestLighting(state: ForestLightingMaterialState | null): void {
    this.materialHandle.updateForestLighting(state);
    for (const handle of this.gpuRing.draw?.materialHandles ?? []) {
      handle?.updateForestLighting(state);
    }
  }

  updateLighting(lighting: EnvironmentLighting): void {
    this.gpuRing.setLighting(lighting);
    this.materialHandle.updateLighting?.(lighting);
    for (const handle of this.gpuRing.draw?.materialHandles ?? []) {
      handle?.updateLighting?.(lighting);
    }
  }

  getLightingProxies(): UnderstoryLightingProxy[] {
    if (!this.settings.enabled) return [];
    // The GPU ring keeps instances on-GPU, so approximate the lighting
    // contribution from the same CPU ecology field instead of reading back.
    if (this.usesGpuRingDraw()) {
      return this.gpuLightingProxies.get({
        centerX: this.lastCenter.x,
        centerZ: this.lastCenter.z,
        settings: this.settings,
        sampler: this.sampler,
      });
    }
    const proxies: UnderstoryLightingProxy[] = [];
    for (const patch of this.cpuPatches.patches) {
      if (!patch.visible) continue;
      for (const instance of patch.instances) {
        proxies.push({
          x: instance.position[0],
          z: instance.position[2],
          classId: instance.classId,
          scale: instance.scale,
          densityWeight: this.settings.classes[instance.classId].density,
        });
      }
    }
    return proxies;
  }

  /** Deadline-bounded variant of {@link getLightingProxies} for the per-frame
   *  forest-lighting budget: the GPU-ring ecology scan is spread across frames
   *  and the previous proxy set is returned (ready=false) until it completes. */
  getLightingProxiesBudgeted(deadlineMs: number): { proxies: readonly UnderstoryLightingProxy[]; ready: boolean } {
    if (!this.settings.enabled) return { proxies: [], ready: true };
    if (!this.usesGpuRingDraw()) return { proxies: this.getLightingProxies(), ready: true };
    return this.gpuLightingProxies.getBudgeted({
      centerX: this.lastCenter.x,
      centerZ: this.lastCenter.z,
      settings: this.settings,
      sampler: this.sampler,
    }, deadlineMs);
  }

  private clearGpuRing(): void {
    this.gpuRing.clear();
    this.gpuLightingProxies.clear();
  }

  private materialFor(cls: UnderstoryClass): THREE.Material {
    return this.settings.render.debugColorByClass
      ? this.materialHandle.debugMaterials[cls]
      : this.materialHandle.regularMaterial;
  }

  private applyMaterials(): void {
    this.cpuPatches.applyMaterials();
  }

  private classCastsShadow(cls: UnderstoryClass): boolean {
    if (!this.settings.render.shadows) return false;
    return UNDERSTORY_CLASSES.indexOf(cls) <= UNDERSTORY_CLASSES.indexOf(this.settings.render.maxShadowClass);
  }

  private updateStats(): void {
    const stats = emptyUnderstoryStats();
    const gpuRing = this.gpuStatus === "ring" || this.gpuStatus === "error";
    if (gpuRing) {
      const c = this.gpuRing.stats.counts;
      stats.totalInstances = this.gpuRing.visibleCount;
      stats.shrub = c.shrub;
      stats.fern = c.fern;
      stats.sapling = c.sapling;
      stats.flower = c.flower;
      stats.deadLog = c.dead_log;
      stats.stump = c.stump;
      stats.generatedCandidates = this.gpuRing.stats.candidateCount;
      stats.acceptedCandidates = this.gpuRing.stats.acceptedCandidates || this.gpuRing.visibleCount;
    } else {
      mergeGenerationStats(stats, this.cpuPatches.earlyGenerationStats);
      for (const patch of this.cpuPatches.patches) {
        stats.totalInstances += patch.instances.length;
        stats.patches++;
        if (patch.visible) stats.visiblePatches++;
        else stats.culledPatches++;
        mergeGenerationStats(stats, patch.generationStats);
        for (const instance of patch.instances) {
          if (instance.classId === "shrub") stats.shrub++;
          else if (instance.classId === "fern") stats.fern++;
          else if (instance.classId === "sapling") stats.sapling++;
          else if (instance.classId === "flower") stats.flower++;
          else if (instance.classId === "dead_log") stats.deadLog++;
          else stats.stump++;
        }
      }
    }
    const ringStats = this.gpuRing.stats;
    stats.gpuStatus = this.gpuStatus;
    stats.gpuCandidateCount = gpuRing ? ringStats.candidateCount : 0;
    stats.gpuCandidateCountBeforePrefilter = gpuRing ? ringStats.candidateCountBeforePrefilter ?? ringStats.candidateCount : 0;
    stats.gpuCandidateCountAfterPrefilter = gpuRing ? ringStats.candidateCountAfterPrefilter ?? ringStats.candidateCount : 0;
    stats.gpuPrefilterTestedClusters = gpuRing ? ringStats.prefilterTestedClusters ?? 0 : 0;
    stats.gpuPrefilterRejectedClusters = gpuRing ? ringStats.prefilterRejectedClusters ?? 0 : 0;
    stats.gpuPrefilterAcceptedClusters = gpuRing ? ringStats.prefilterAcceptedClusters ?? 0 : 0;
    stats.gpuPrefilterUnknownKeptClusters = gpuRing ? ringStats.prefilterUnknownKeptClusters ?? 0 : 0;
    stats.gpuPrefilterFarSummaryConsulted = gpuRing
      ? ringStats.prefilterFarSummaryConsulted ?? ringStats.prefilterSourceFarSummary ?? 0
      : 0;
    stats.gpuPrefilterSourceFarSummary = gpuRing ? ringStats.prefilterSourceFarSummary ?? 0 : 0;
    stats.gpuPrefilterSourceTerrainSampler = gpuRing ? ringStats.prefilterSourceTerrainSampler ?? 0 : 0;
    stats.gpuPrefilterSourceFallback = gpuRing ? ringStats.prefilterSourceFallback ?? 0 : 0;
    stats.gpuAcceptedCount = gpuRing ? (ringStats.acceptedCandidates || this.gpuRing.visibleCount) : 0;
    stats.gpuVisibleCount = gpuRing ? this.gpuRing.visibleCount : 0;
    stats.gpuOverflowed = this.gpuRing.overflowed;
    stats.gpuDispatchMs = this.gpuRing.dispatchMs;
    this.stats = stats;
  }
}

export {
  emptyUnderstoryStats,
  understoryUsesGpuRingDraw,
  type UnderstoryLightingProxy,
  type UnderstoryStats,
} from "./understory_system_support.js";
