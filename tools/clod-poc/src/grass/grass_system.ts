import * as THREE from "three";
import type { ClodPageNode, PageFootprint } from "../types.js";
import {
  DEFAULT_GRASS_SHADER_MODE,
  GRASS_SHADER_MODES,
  resolveGrassSettings,
  type GrassLighting,
  type GrassSettings,
} from "./grass_config.js";
import type { GrassBladeInstance } from "./grass_cpu_patch.js";
import type {
  GrassGeometryBuilder,
  GrassMaterialFactory,
  GrassMaterialHandle,
} from "./grass_geometry.js";
import type { GrassWebGpuBackendAccess } from "./grass_gpu_ring.js";
import {
  resolveGrassGpuPresentation,
  type GrassGpuPresentation,
} from "./grass_gpu_presentation.js";
import { GrassCpuPatchRuntime } from "./grass_cpu_patch_runtime.js";
import { GrassGpuRingRuntime } from "./grass_gpu_ring_runtime.js";
import { GrassMaterialRuntime } from "./grass_material_runtime.js";
import { GrassPatchFactory } from "./grass_patch_factory.js";
import { GrassSharedGeometries, grassGeometryKey } from "./grass_shared_geometries.js";
import type { GrassStats } from "./grass_stats.js";
import type { GrassGpuRingComputeFactory, GrassPatch } from "./grass_system_support.js";
import { buildGrassStats } from "./grass_system_stats_builder.js";

export {
  grassThinnedInstanceCount,
  type GrassGpuRingComputeFactory,
} from "./grass_system_support.js";

export interface GrassSystemOptions {
  scene: THREE.Scene;
  nodes: ClodPageNode[];
  worldCells: number;
  settings: GrassSettings;
  lighting: GrassLighting;
  supportsRing?: boolean;
  gpuDevice?: GPUDevice | null;
  gpuBackend?: GrassWebGpuBackendAccess | null;
  material?: GrassMaterialHandle;
  createMaterial?: GrassMaterialFactory;
  buildGeometry?: GrassGeometryBuilder;
  createGpuRingCompute?: GrassGpuRingComputeFactory;
}

export class GrassSystem {
  private readonly scene: THREE.Scene;
  private readonly worldCells: number;
  private readonly root = new THREE.Group();
  private readonly geometries = new GrassSharedGeometries();
  private readonly materials: GrassMaterialRuntime;
  private readonly gpuRing: GrassGpuRingRuntime;
  private readonly cpuPatches: GrassCpuPatchRuntime;
  private readonly injectedGeometryBuilder: GrassGeometryBuilder | null;
  private settings: GrassSettings;
  private stats: GrassStats = {
    mode: DEFAULT_GRASS_SHADER_MODE,
    blades: 0,
    patches: 0,
    visiblePatches: 0,
    culledPatches: 0,
    nearPatches: 0,
    midPatches: 0,
    coveragePatches: 0,
    superPatches: 0,
    generatedCandidates: 0,
    acceptedCandidates: 0,
    edgeSuppressedCandidates: 0,
    patchRebuildCount: 0,
    buildMs: 0,
    midBladeCount: 0,
    gpuRingStatus: "disabled",
    gpuRingCandidateCount: 0,
    gpuRingVisibleNear: 0,
    gpuRingVisibleMid: 0,
    gpuRingVisibleFar: 0,
    gpuRingVisibleSuper: 0,
    gpuRingDispatchMs: null,
    gpuRingReadbackMs: null,
  };
  private readonly lastCenter: THREE.Vector3;

  constructor(options: GrassSystemOptions) {
    this.scene = options.scene;
    this.worldCells = options.worldCells;
    this.settings = resolveGrassSettings(options.settings);
    this.injectedGeometryBuilder = options.buildGeometry ?? null;
    this.geometries.rebuild(this.settings);
    this.materials = new GrassMaterialRuntime({
      settings: this.settings,
      lighting: options.lighting,
      material: options.material,
      createMaterial: options.createMaterial,
    }, GRASS_SHADER_MODES);
    this.gpuRing = new GrassGpuRingRuntime({
      root: this.root,
      worldCells: this.worldCells,
      supportsRing: options.supportsRing === true,
      gpuDevice: options.gpuDevice,
      gpuBackend: options.gpuBackend,
      geometries: this.geometries,
      materialFor: (mode) => this.materials.materialFor(mode),
      sharedMaterials: () => this.materials.sharedMaterials(),
      rebuildInjectedRingMaterial: (buffers) => this.materials.rebuildInjectedRingMaterial(this.settings, buffers),
      createGpuRingCompute: options.createGpuRingCompute,
    });
    this.cpuPatches = new GrassCpuPatchRuntime({
      nodes: options.nodes,
      worldCells: this.worldCells,
      root: this.root,
      geometries: this.geometries,
      injectedGeometryBuilder: this.injectedGeometryBuilder,
      materialFor: (mode) => this.materials.materialFor(mode),
    });
    this.lastCenter = new THREE.Vector3(this.worldCells * 0.5, 0, this.worldCells * 0.5);
    this.root.name = "grass";
    this.scene.add(this.root);
    this.root.visible = this.settings.enabled;
    if (this.settings.enabled) this.rebuild();
  }

  setEnabled(enabled: boolean): void {
    const wasEnabled = this.settings.enabled;
    this.settings.enabled = enabled;
    this.root.visible = enabled;
    if (!enabled || wasEnabled) {
      this.updateStats();
      return;
    }
    if (this.updateGpuPresentation(this.lastCenter) !== "unavailable") {
      this.updateStats();
      return;
    }
    if (this.cpuPatches.patches.length === 0) this.cpuPatches.refreshForCenter(this.lastCenter, this.settings);
    this.updateStats();
  }

  updateSettings(settings: Partial<GrassSettings>): void {
    const wasRing = this.gpuRing.isRingMode(this.settings);
    const wasEnabled = this.settings.enabled;
    const previousMode = this.settings.shaderMode;
    const previousGeometryKey = grassGeometryKey(this.settings);
    this.settings = resolveGrassSettings({ ...this.settings, ...settings });
    if (grassGeometryKey(this.settings) !== previousGeometryKey) {
      this.geometries.rebuild(this.settings);
      this.clearCpuAndGpu();
      this.gpuRing.resetFailure();
    }
    if (wasRing !== this.gpuRing.isRingMode(this.settings)) {
      this.clearCpuAndGpu();
      this.gpuRing.resetFailure();
    }
    if (this.materials.hasInjectedFactory && previousMode !== this.settings.shaderMode) {
      this.materials.replaceInjectedMaterial(this.settings, this.cpuPatches.patches);
    }
    this.materials.updateSettings(this.settings, this.gpuRing.meshes);
    this.cpuPatches.markDirty();
    if (this.settings.enabled && !wasEnabled) {
      this.gpuRing.updateCpuFallbackStatus(this.settings);
      if (this.updateGpuPresentation(this.lastCenter) !== "unavailable") {
        this.updateStats();
        return;
      }
      if (this.cpuPatches.patches.length === 0) this.cpuPatches.refreshForCenter(this.lastCenter, this.settings);
    } else {
      this.root.visible = this.settings.enabled;
    }
    this.updateStats();
  }

  updateLighting(lighting: GrassLighting): void {
    this.materials.updateLighting(lighting);
  }

  update(timeSeconds: number, center: THREE.Vector3, camera?: THREE.Camera): void {
    this.materials.updateTime(timeSeconds, center);
    this.lastCenter.copy(center);
    if (!this.settings.enabled) {
      this.updateStats();
      return;
    }
    if (this.updateGpuPresentation(center, camera) !== "unavailable") {
      this.updateStats();
      return;
    }
    if (this.gpuRing.hasResources) {
      this.gpuRing.clearRing();
      this.gpuRing.clearCompute();
    }
    this.gpuRing.updateCpuFallbackStatus(this.settings);
    if (this.cpuPatches.refreshIfNeeded(center, this.settings)) this.updateStats();
  }

  rebuild(): void {
    this.clearCpuAndGpu();
    this.gpuRing.resetFailure();
    if (this.settings.enabled && this.updateGpuPresentation(this.lastCenter) === "unavailable") {
      this.gpuRing.clearRing();
      this.gpuRing.clearCompute();
      this.gpuRing.updateCpuFallbackStatus(this.settings);
      this.cpuPatches.refreshForCenter(this.lastCenter, this.settings);
    }
    this.root.visible = this.settings.enabled;
    this.updateStats();
  }

  markPatchesDirty(): void {
    this.cpuPatches.markDirty();
  }

  removePatchesForNodes(nodeIds: Iterable<string>): void {
    const ids = new Set(nodeIds);
    if (ids.size === 0) return;
    if (this.gpuRing.canUse(this.settings)) {
      this.gpuRing.clearCompute();
      if (this.updateGpuPresentation(this.lastCenter) === "rendering") {
        this.updateStats();
        return;
      }
    }
    this.cpuPatches.removeForNodes(ids);
    this.updateStats();
  }

  rebuildNodePatches(nodeIds: Iterable<string>): void {
    this.removePatchesForNodes(nodeIds);
    if (this.isGpuRingRendering()) return;
    this.cpuPatches.refreshForCenter(this.lastCenter, this.settings);
    this.updateStats();
  }

  dispose(): void {
    this.cpuPatches.clear();
    this.gpuRing.clearRing();
    this.root.clear();
    this.scene.remove(this.root);
    this.geometries.dispose();
    this.gpuRing.clearCompute();
    this.materials.dispose();
  }

  getBladeCount(): number {
    return this.isGpuRingRendering() ? this.gpuRing.bladeCount : this.cpuPatches.bladeCount;
  }

  getStats(): GrassStats {
    this.updateStats();
    return { ...this.stats };
  }

  setRingDebug(enabled: boolean): void {
    this.gpuRing.setDebug(enabled);
  }

  private updateGpuPresentation(
    center: THREE.Vector3,
    camera?: THREE.Camera,
  ): GrassGpuPresentation {
    if (!this.gpuRing.canUse(this.settings)) return "unavailable";

    const ringKey = this.gpuRing.currentKey(this.settings);
    const presentation = resolveGrassGpuPresentation(
      this.gpuRing.updateCounters(this.settings, center, camera),
      this.isGpuRingRendering(),
    );
    if (presentation === "unavailable") {
      this.gpuRing.failedGpuRingKey = ringKey;
      return presentation;
    }
    if (presentation === "rendering") {
      if (this.cpuPatches.patches.length > 0) this.cpuPatches.clear();
      return presentation;
    }
    if (this.cpuPatches.patches.length === 0) {
      this.cpuPatches.refreshForCenter(center, this.settings);
    }
    return presentation;
  }

  private isGpuRingRendering(): boolean {
    return this.gpuRing.meshes.some((mesh) => mesh.visible);
  }

  private clearCpuAndGpu(): void {
    this.cpuPatches.clear();
    this.gpuRing.clearRing();
    this.gpuRing.clearCompute();
    this.updateStats();
  }

  private updateStats(): void {
    this.gpuRing.refreshStats(this.settings);
    this.stats = buildGrassStats({
      mode: this.settings.shaderMode,
      ringMode: this.gpuRing.isRingMode(this.settings),
      activeGpu: this.isGpuRingRendering(),
      patches: this.cpuPatches.patches,
      ringMeshes: this.gpuRing.meshes,
      ringTierCounts: this.gpuRing.tierCounts,
      ringBladeCount: this.gpuRing.bladeCount,
      bladeCount: this.cpuPatches.bladeCount,
      generationStats: this.cpuPatches.generationStats,
      patchRebuildCount: this.cpuPatches.patchRebuildCount,
      buildMs: this.cpuPatches.buildMs,
      gpuRingStats: this.gpuRing.stats,
    });
  }

  createTerrainPatch(nodeId: string, footprint: PageFootprint, instances: GrassBladeInstance[]): GrassPatch {
    return new GrassPatchFactory({
      settings: this.settings,
      classicBladeGeometry: this.geometries.classicBladeGeometry,
      terrainPatchNearGeometry: this.geometries.terrainPatchNearGeometry,
      terrainPatchNearCrossedGeometry: this.geometries.terrainPatchNearCrossedGeometry,
      terrainPatchMidGeometry: this.geometries.terrainPatchMidGeometry,
      terrainPatchFarGeometry: this.geometries.terrainPatchFarGeometry,
      terrainPatchSuperGeometry: this.geometries.terrainPatchSuperGeometry,
      injectedGeometryBuilder: this.injectedGeometryBuilder,
      materialFor: (mode) => this.materials.materialFor(mode),
    }).createPatch(nodeId, footprint, instances);
  }

  currentGpuRingKey(): string {
    return this.gpuRing.currentKey(this.settings);
  }

  get gpuRingFailedKey(): string {
    return this.gpuRing.failedGpuRingKey;
  }

  set gpuRingFailedKey(value: string) {
    this.gpuRing.failedGpuRingKey = value;
  }
}
