import * as THREE from "three";
import type { ClodPageNode } from "../types.js";
import { UNDERSTORY_CLASSES, type UnderstoryClass, type UnderstorySettings } from "./understory_config.js";
import {
  createUnderstoryGeometryMap,
  disposeUnderstoryGeometryMap,
  type UnderstoryGeometryMap,
} from "./understory_geometry.js";
import {
  defaultUnderstoryTerrainSampler,
  emptyUnderstoryGenerationStats,
  generateUnderstoryInstances,
  type UnderstoryTerrainSampler,
} from "./understory_instances.js";
import {
  recordUnderstoryEarlyRejection,
  rejectUnderstoryPatchBeforeGeneration,
} from "./understory_patch_terrain_rejection.js";
import { createUnderstoryMaterialHandle, type UnderstoryMaterialHandle } from "./understory_material.js";
import { createUnderstoryNodeMaterialHandle } from "./understory_node_material.js";
import type { ForestLightingMaterialState } from "../forest_lighting/index.js";
import type { EnvironmentLighting } from "../environment/environment.js";
import {
  UnderstoryGpuRingCompute,
  understoryGpuRingComputeUnsupportedReason,
  createGpuRingDrawResources,
  clearGpuRingDraw,
  type UnderstoryGpuRingDrawResources,
  type UnderstoryGpuRingStats,
  type UnderstoryWebGpuBackendAccess,
  type UnderstoryHydrologyData,
} from "../gpu/understory_ring_compute.js";
import { understoryRingGroupCapacity, understoryRingCell } from "./understory_ring_math.js";
import { getDigEditsSnapshot } from "../terrain/terrain.js";
import { resolveDigEdits } from "../gpu/terrain_field_core.js";
import { generateUnderstoryRingValidationCounts } from "./understory_ring_validation.js";
import {
  clampFootprint,
  distance2d,
  emptyUnderstoryStats,
  footprintCenterX,
  footprintCenterZ,
  footprintRadius,
  mergeGenerationStats,
  understoryGpuRingKey,
  understoryUsesGpuRingDraw,
  type UnderstoryLightingProxy,
  type UnderstoryPatch,
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
  private readonly nodes: ClodPageNode[];
  private readonly worldCells: number;
  private readonly sampler: UnderstoryTerrainSampler | undefined;
  private readonly root = new THREE.Group();
  private readonly matrix = new THREE.Matrix4();
  private readonly translation = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly upAxis = new THREE.Vector3(0, 1, 0);
  private settings: UnderstorySettings;
  private geometries: UnderstoryGeometryMap;
  private materialHandle: UnderstoryMaterialHandle;
  private patches: UnderstoryPatch[] = [];
  private patchesDirty = true;
  private readonly lastRefreshCenter = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0);
  private readonly lastCenter: THREE.Vector3;
  private stats: UnderstoryStats = emptyUnderstoryStats();
  private readonly earlyGenerationStats = emptyUnderstoryGenerationStats();
  private readonly gpuDevice: GPUDevice | null;
  private readonly gpuBackend: UnderstoryWebGpuBackendAccess | null;
  private readonly supportsGpu: boolean;
  private readonly gpuRingUnsupportedReason: string | null;
  private currentLighting: EnvironmentLighting | undefined;
  private gpuStatus: UnderstoryStats["gpuStatus"] = "disabled";
  private gpuVisibleCount = 0;
  private gpuOverflowed = false;
  private gpuDispatchMs: number | null = null;
  private gpuRingCompute: UnderstoryGpuRingCompute | null = null;
  private gpuRingInit: Promise<void> | null = null;
  private gpuRingKey = "";
  private gpuRingGeneration = 0;
  private gpuRingDraw: UnderstoryGpuRingDrawResources | null = null;
  private ringMeshes: THREE.Mesh[] = [];
  private gpuRingStats: UnderstoryGpuRingStats = {
    status: "disabled",
    candidateCount: 0,
    acceptedCandidates: 0,
    counts: { shrub: 0, fern: 0, sapling: 0, flower: 0, dead_log: 0, stump: 0 },
    groupCounts: [],
    overflowed: false,
    submitMs: null,
    readbackMs: null,
    skippedDispatches: 0,
  };
  private lastGpuValidationSignature = "";
  private readonly frustumPlaneScratch = new Float32Array(24);
  private readonly hydrologyData: UnderstoryHydrologyData | null;
  private readonly hydrologyWaterTexture: THREE.Texture | null;

  constructor(options: UnderstorySystemOptions) {
    this.scene = options.scene;
    this.nodes = options.nodes
      .filter((node) => node.level === 0)
      .sort((a, b) => a.footprint.minZ - b.footprint.minZ || a.footprint.minX - b.footprint.minX);
    this.worldCells = options.worldCells;
    this.settings = options.settings;
    this.sampler = options.sampler;
    this.gpuDevice = options.gpuDevice ?? null;
    this.gpuBackend = options.gpuBackend ?? null;
    this.supportsGpu = options.supportsGpu ?? !!this.gpuDevice;
    this.currentLighting = options.lighting;
    this.hydrologyData = options.hydrologyData ?? null;
    this.hydrologyWaterTexture = options.hydrologyWaterTexture ?? null;
    this.gpuRingUnsupportedReason = this.gpuDevice
      ? understoryGpuRingComputeUnsupportedReason(this.gpuDevice)
      : null;
    this.geometries = createUnderstoryGeometryMap(this.settings);
    this.materialHandle = options.webgpu
      ? createUnderstoryNodeMaterialHandle(this.settings, options.lighting)
      : createUnderstoryMaterialHandle(this.settings);
    this.lastCenter = new THREE.Vector3(this.worldCells * 0.5, 0, this.worldCells * 0.5);
    this.root.name = "understory";
    this.root.visible = this.settings.enabled;
    this.scene.add(this.root);
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
    if (!wasEnabled) this.refreshForCenter(this.lastCenter);
  }

  private usesGpuRingDraw(): boolean {
    return understoryUsesGpuRingDraw(this.settings) && this.supportsGpu && !!this.gpuDevice && !this.gpuRingUnsupportedReason;
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
    if (!this.supportsGpu || !this.gpuDevice || !this.gpuBackend) {
      this.gpuStatus = this.settings.gpu.fallbackToCpu ? "fallback-cpu" : "unsupported";
      return;
    }
    if (this.gpuRingUnsupportedReason) {
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
      this.clearPatches();
    }
    this.materialHandle.updateSettings(this.settings);
    this.applyMaterials();
    for (const handle of Object.values(this.gpuRingDraw?.materialHandles ?? {})) {
      handle.updateSettings(this.settings);
    }
    if (needsPatchRefresh) this.patchesDirty = true;
    this.setEnabled(this.settings.enabled);
  }

  update(timeSeconds: number, center: THREE.Vector3, camera?: THREE.Camera): void {
    this.materialHandle.setTime(timeSeconds);
    for (const handle of Object.values(this.gpuRingDraw?.materialHandles ?? {})) {
      handle.setTime(timeSeconds);
    }
    this.lastCenter.copy(center);
    if (!this.settings.enabled) {
      this.updateStats();
      return;
    }
    if (this.usesGpuRingDraw()) {
      if (this.patches.length > 0) this.clearPatches();
      this.updateGpuRingUnderstory(center, camera);
      return;
    }
    if (this.gpuRingCompute || this.gpuRingInit || this.gpuRingDraw || this.ringMeshes.length > 0) {
      this.clearGpuRing();
    }
    this.updateCpuFallbackGpuStatus();
    if (this.patchesDirty || this.lastRefreshCenter.distanceTo(center) >= this.settings.refreshDistanceM) {
      this.refreshForCenter(center);
    } else {
      this.updatePatchVisibility(center);
    }
  }

  rebuild(): void {
    this.clearGpuRing();
    this.clearPatches();
    if (this.settings.enabled) {
      if (this.usesGpuRingDraw()) {
        this.gpuStatus = "ring";
      } else {
        this.updateCpuFallbackGpuStatus();
        this.refreshForCenter(this.lastCenter);
      }
    } else {
      this.gpuStatus = "disabled";
    }
    this.root.visible = this.settings.enabled;
  }

  markPatchesDirty(): void {
    this.patchesDirty = true;
  }

  removePatchesForNodes(nodeIds: Iterable<string>): void {
    const ids = new Set(nodeIds);
    if (ids.size === 0) return;
    const retained: UnderstoryPatch[] = [];
    for (const patch of this.patches) {
      if (ids.has(patch.nodeId)) this.removePatch(patch);
      else retained.push(patch);
    }
    this.patches = retained;
  }

  rebuildNodePatches(nodeIds: Iterable<string>): void {
    this.removePatchesForNodes(nodeIds);
    this.refreshForCenter(this.lastCenter);
  }

  dispose(): void {
    this.clearGpuRing();
    this.clearPatches();
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
    for (const handle of Object.values(this.gpuRingDraw?.materialHandles ?? {})) {
      handle.updateForestLighting(state);
    }
  }

  updateLighting(lighting: EnvironmentLighting): void {
    this.currentLighting = lighting;
    this.materialHandle.updateLighting?.(lighting);
    for (const handle of Object.values(this.gpuRingDraw?.materialHandles ?? {})) {
      handle.updateLighting?.(lighting);
    }
  }

  getLightingProxies(): UnderstoryLightingProxy[] {
    if (!this.settings.enabled) return [];
    const proxies: UnderstoryLightingProxy[] = [];
    for (const patch of this.patches) {
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

  private ensureGpuRingCompute(): void {
    if (!this.gpuDevice || !this.gpuBackend || !this.usesGpuRingDraw()) return;
    const key = understoryGpuRingKey(this.settings, this.worldCells);
    if (this.gpuRingCompute && this.gpuRingKey === key) return;
    if (this.gpuRingInit && this.gpuRingKey === key) return;

    this.clearGpuRingDraw();
    this.gpuRingKey = key;
    this.gpuRingDraw = createGpuRingDrawResources(
      this.settings,
      this.worldCells,
      this.gpuBackend,
      this.currentLighting,
      this.hydrologyData,
      this.hydrologyWaterTexture,
    );
    for (const mesh of this.gpuRingDraw.meshes) {
      mesh.visible = false;
      this.root.add(mesh);
      this.ringMeshes.push(mesh);
    }
    this.gpuRingStats = { status: "initializing", candidateCount: 0, acceptedCandidates: 0, counts: this.gpuRingStats.counts, groupCounts: [], overflowed: false, submitMs: null, readbackMs: null, skippedDispatches: 0 };

    const initKey = key;
    const initGeneration = this.gpuRingGeneration;
    const edits = resolveDigEdits(getDigEditsSnapshot());
    this.gpuRingInit = UnderstoryGpuRingCompute.create(
      this.gpuDevice, edits, this.gpuRingDraw.outputBuffers, this.settings, this.hydrologyData,
    ).then((compute) => {
      if (this.gpuRingKey !== initKey || this.gpuRingGeneration !== initGeneration) {
        compute.destroy();
        return;
      }
      this.gpuRingCompute = compute;
      this.gpuRingStats = compute.stats(this.settings.enabled);
    }).catch((error) => {
      console.warn("[understory] GPU ring compute init failed:", error);
      this.gpuRingStats = { ...this.gpuRingStats, status: "failed", reason: String(error) };
    }).finally(() => { this.gpuRingInit = null; });
  }

  private updateGpuRingUnderstory(center: THREE.Vector3, camera?: THREE.Camera): void {
    if (!this.supportsGpu || !this.gpuDevice || !this.gpuBackend) {
      this.gpuStatus = this.gpuDevice ? "unsupported" : "disabled";
      this.gpuRingStats = { ...this.gpuRingStats, status: "failed", reason: this.gpuDevice ? "unsupported" : "no device" };
      this.updateStats();
      return;
    }
    if (this.gpuRingUnsupportedReason) {
      this.gpuStatus = "unsupported";
      this.gpuRingStats = { ...this.gpuRingStats, status: "failed", reason: this.gpuRingUnsupportedReason };
      this.updateStats();
      return;
    }

    this.ensureGpuRingCompute();
    this.gpuRingStats = this.gpuRingCompute?.stats(true) ?? this.gpuRingStats;

    const gpu = this.settings.gpu;
    if (this.gpuRingStats.status === "failed" && gpu.fallbackToCpu) {
      this.clearGpuRing();
      this.gpuStatus = "fallback-cpu";
      this.updateStats();
      if (this.patchesDirty || this.lastRefreshCenter.distanceTo(center) >= this.settings.refreshDistanceM) {
        this.refreshForCenter(center);
      } else {
        this.updatePatchVisibility(center);
      }
      return;
    }

    if (this.gpuRingCompute && this.gpuRingDraw) {
      const indexCounts = this.gpuRingIndexCounts();
      const dispatched = this.gpuRingCompute.dispatch({
        centerX: center.x,
        centerZ: center.z,
        worldCells: this.worldCells,
        maxInstancesPerGroup: understoryRingGroupCapacity(this.settings),
        indexCounts,
        frustumPlanes: this.frustumPlanes(camera),
        hydroEnabled: !!this.hydrologyData,
      });
      if (dispatched) {
        for (const mesh of this.ringMeshes) mesh.visible = true;
      }
      this.gpuRingStats = this.gpuRingCompute.stats(true);
      this.validateGpuRingAgainstCpu(center, camera);
    }

    const c = this.gpuRingStats.counts;
    this.gpuVisibleCount = c.shrub + c.fern + c.sapling + c.flower + c.dead_log + c.stump;
    this.gpuOverflowed = this.gpuRingStats.overflowed;
    this.gpuDispatchMs = this.gpuRingStats.submitMs;
    this.gpuStatus = this.gpuRingStats.status === "failed" ? "error" : "ring";
    this.updateStats();
  }

  private validateGpuRingAgainstCpu(center: THREE.Vector3, camera?: THREE.Camera): void {
    if (!this.settings.gpu.debugValidateAgainstCpu || this.gpuRingStats.readbackMs === null) return;

    const signature = [
      Math.round(center.x / understoryRingCell(this.settings)),
      Math.round(center.z / understoryRingCell(this.settings)),
      this.gpuRingStats.groupCounts.join(","),
      this.gpuRingStats.overflowed ? 1 : 0,
    ].join("|");
    if (signature === this.lastGpuValidationSignature) return;
    this.lastGpuValidationSignature = signature;

    const expected = generateUnderstoryRingValidationCounts({
      centerX: center.x,
      centerZ: center.z,
      worldCells: this.worldCells,
      settings: this.settings,
      sampler: this.sampler,
      maxInstancesPerGroup: understoryRingGroupCapacity(this.settings),
      frustumPlanes: this.frustumPlanes(camera),
    });
    const maxDelta = UNDERSTORY_CLASSES.reduce((max, cls) =>
      Math.max(max, Math.abs((this.gpuRingStats.counts[cls] ?? 0) - (expected.counts[cls] ?? 0))),
    0);
    const gpuTotal = this.gpuVisibleCount;
    const cpuTotal = UNDERSTORY_CLASSES.reduce((sum, cls) => sum + (expected.counts[cls] ?? 0), 0);
    const tolerance = Math.max(4, Math.ceil(Math.max(cpuTotal, gpuTotal) * 0.02));
    if (maxDelta > tolerance || expected.overflowed !== this.gpuRingStats.overflowed) {
      console.warn(
        "[understory-gpu-ring] CPU/GPU count parity failed " +
        `gpu=${JSON.stringify(this.gpuRingStats.counts)} cpu=${JSON.stringify(expected.counts)} ` +
        `maxDelta=${maxDelta} tolerance=${tolerance} ` +
        `overflow gpu=${this.gpuRingStats.overflowed} cpu=${expected.overflowed}`,
      );
    }
  }

  private frustumPlanes(camera?: THREE.Camera): Float32Array {
    if (!camera) {
      this.frustumPlaneScratch.fill(0);
      for (let i = 0; i < 6; i++) this.frustumPlaneScratch[i * 4 + 3] = 1_000_000;
      return this.frustumPlaneScratch;
    }
    const frustum = new THREE.Frustum();
    const projScreenMatrix = new THREE.Matrix4();
    (camera as THREE.Camera & { updateProjectionMatrix?: () => void }).updateProjectionMatrix?.();
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreenMatrix);
    for (let i = 0; i < 6; i++) {
      const plane = frustum.planes[i];
      const offset = i * 4;
      this.frustumPlaneScratch[offset] = plane.normal.x;
      this.frustumPlaneScratch[offset + 1] = plane.normal.y;
      this.frustumPlaneScratch[offset + 2] = plane.normal.z;
      this.frustumPlaneScratch[offset + 3] = plane.constant;
    }
    return this.frustumPlaneScratch;
  }

  private gpuRingIndexCounts(): [number, number, number, number, number, number] {
    const counts = [0, 0, 0, 0, 0, 0] as [number, number, number, number, number, number];
    if (!this.gpuRingDraw) return counts;
    for (let i = 0; i < UNDERSTORY_CLASSES.length && i < this.gpuRingDraw.meshes.length; i++) {
      const geom = this.gpuRingDraw.meshes[i].geometry;
      const idx = geom.getIndex();
      counts[i] = idx ? idx.count : 0;
    }
    return counts;
  }

  private clearGpuRing(): void {
    if (!this.gpuRingCompute && !this.gpuRingInit && !this.gpuRingDraw && this.ringMeshes.length === 0) return;
    this.gpuRingGeneration++;
    this.gpuRingCompute?.destroy();
    this.gpuRingCompute = null;
    this.gpuRingInit = null;
    this.gpuRingKey = "";
    this.clearGpuRingDraw();
    this.gpuVisibleCount = 0;
    this.gpuOverflowed = false;
    this.gpuDispatchMs = null;
    this.lastGpuValidationSignature = "";
    this.gpuRingStats = { status: this.gpuDevice ? "idle" : "disabled", candidateCount: 0, acceptedCandidates: 0, counts: { shrub: 0, fern: 0, sapling: 0, flower: 0, dead_log: 0, stump: 0 }, groupCounts: [], overflowed: false, submitMs: null, readbackMs: null, skippedDispatches: 0 };
  }

  private clearGpuRingDraw(): void {
    for (const mesh of this.ringMeshes) {
      this.root.remove(mesh);
    }
    this.ringMeshes = [];
    clearGpuRingDraw(this.gpuRingDraw);
    this.gpuRingDraw = null;
  }

  private refreshForCenter(center: THREE.Vector3): void {
    this.lastRefreshCenter.copy(center);
    this.patchesDirty = false;
    const distance = this.settings.distanceM;
    const retained: UnderstoryPatch[] = [];
    for (const patch of this.patches) {
      if (distance2d(center.x, center.z, patch.centerX, patch.centerZ) > distance + patch.radius) {
        this.removePatch(patch);
      } else {
        retained.push(patch);
      }
    }
    this.patches = retained;

    const existing = new Set(this.patches.map((patch) => patch.nodeId));
    const candidates = this.nodes
      .filter((node) => !existing.has(node.id))
      .map((node) => ({ node, distance: distance2d(center.x, center.z, footprintCenterX(node.footprint), footprintCenterZ(node.footprint)) }))
      .filter(({ node, distance: d }) => d <= distance + footprintRadius(node.footprint))
      .sort((a, b) => a.distance - b.distance);

    let remainingBudget = Math.max(0, this.settings.maxInstances - this.instanceCount());
    for (const { node } of candidates) {
      if (remainingBudget <= 0) break;
      const footprint = clampFootprint(node.footprint, this.worldCells);
      if (rejectUnderstoryPatchBeforeGeneration(this.settings, footprint, this.sampler ?? defaultUnderstoryTerrainSampler)) {
        recordUnderstoryEarlyRejection(this.earlyGenerationStats, node.id);
        continue;
      }
      const instances = generateUnderstoryInstances(node.id, footprint, this.worldCells, this.settings, this.sampler, remainingBudget);
      if (instances.length === 0) continue;
      const patch = this.createPatch(node.id, footprint, instances);
      this.patches.push(patch);
      this.root.add(patch.group);
      remainingBudget -= instances.length;
    }
    this.updatePatchVisibility(center);
  }
