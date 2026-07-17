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
import {
  understoryRingAcceptParams,
  understoryRingCell,
  understoryRingGroupCapacity,
  understoryRingTerrainGate,
  UNDERSTORY_RING_GROUP_COUNT,
} from "./understory_ring_math.js";
import { sampleUnderstoryEcology } from "./understory_ecology.js";
import { clamp01 } from "../trees/tree_noise.js";
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
  private gpuRingStats: UnderstoryGpuRingStats = emptyGpuRingStats("disabled", null);
  private gpuLightingProxyCache: { key: string; proxies: UnderstoryLightingProxy[] } | null = null;
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
    if (!wasEnabled && !this.usesGpuRingDraw()) this.refreshForCenter(this.lastCenter);
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
    for (const handle of this.gpuRingDraw?.materialHandles ?? []) {
      handle?.updateSettings(this.settings);
    }
    if (needsPatchRefresh) this.patchesDirty = true;
    this.setEnabled(this.settings.enabled);
  }

  update(timeSeconds: number, center: THREE.Vector3, camera?: THREE.Camera): void {
    this.materialHandle.setTime(timeSeconds);
    for (const handle of this.gpuRingDraw?.materialHandles ?? []) {
      handle?.setTime(timeSeconds);
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
    if (this.usesGpuRingDraw()) {
      this.clearGpuRing();
      this.markPatchesDirty();
      return;
    }
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
    for (const handle of this.gpuRingDraw?.materialHandles ?? []) {
      handle?.updateForestLighting(state);
    }
  }

  updateLighting(lighting: EnvironmentLighting): void {
    this.currentLighting = lighting;
    this.materialHandle.updateLighting?.(lighting);
    for (const handle of this.gpuRingDraw?.materialHandles ?? []) {
      handle?.updateLighting?.(lighting);
    }
  }

  getLightingProxies(): UnderstoryLightingProxy[] {
    if (!this.settings.enabled) return [];
    // The GPU ring keeps instances on-GPU, so approximate the lighting
    // contribution from the same CPU ecology field instead of reading back.
    if (this.usesGpuRingDraw()) return this.gpuRingLightingProxies();
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

  /** Coarse deterministic ecology sampling used as the lighting stand-in for the
   *  GPU ring: same terrain gate + ecology density as the compute shader, evaluated
   *  on a sparse grid and cached until the ring center moves. */
  private gpuRingLightingProxies(): UnderstoryLightingProxy[] {
    const center = this.lastCenter;
    const key = [
      Math.round(center.x / GPU_LIGHTING_PROXY_REFRESH_M),
      Math.round(center.z / GPU_LIGHTING_PROXY_REFRESH_M),
      this.settings.seed,
      this.settings.distanceM,
      this.settings.placement.spacingM,
      this.settings.ecology.enabled ? 1 : 0,
    ].join("|");
    if (this.gpuLightingProxyCache?.key === key) return this.gpuLightingProxyCache.proxies;
    const sampler = this.sampler ?? defaultUnderstoryTerrainSampler;
    const acceptParams = understoryRingAcceptParams(this.settings);
    const step = Math.max(1, understoryRingCell(this.settings) * GPU_LIGHTING_PROXY_STEP_CELLS);
    const radius = this.settings.distanceM;
    const proxies: UnderstoryLightingProxy[] = [];
    for (let dz = -radius; dz <= radius; dz += step) {
      for (let dx = -radius; dx <= radius; dx += step) {
        if (dx * dx + dz * dz > radius * radius) continue;
        const wx = center.x + dx;
        const wz = center.z + dz;
        const height = sampler.surfaceHeight(wx, wz);
        const normalY = sampler.surfaceNormal(wx, wz)[1];
        const ground = understoryRingTerrainGate(height, normalY, acceptParams);
        if (ground < 0) continue;
        const ecology = sampleUnderstoryEcology(wx, wz, height, normalY, ground, this.settings);
        if (ecology.density <= 0.05) continue;
        proxies.push({
          x: wx,
          z: wz,
          classId: "shrub",
          scale: 1,
          densityWeight: clamp01(ecology.density),
        });
      }
    }
    this.gpuLightingProxyCache = { key, proxies };
    return proxies;
  }

  private ensureGpuRingCompute(): void {
    if (!this.gpuDevice || !this.gpuBackend || !this.usesGpuRingDraw()) return;
    const key = understoryGpuRingKey(this.settings, this.worldCells);
    if (this.gpuRingCompute && this.gpuRingKey === key) return;
    if (this.gpuRingInit && this.gpuRingKey === key) return;

    if (this.gpuRingCompute || this.gpuRingInit || this.gpuRingDraw || this.ringMeshes.length > 0) {
      this.clearGpuRing();
    }

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
      if (!mesh) continue;
      mesh.visible = false;
      this.root.add(mesh);
      this.ringMeshes.push(mesh);
    }
    this.gpuRingStats = emptyGpuRingStats("initializing", this.gpuRingStats.counts);

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
      if (this.gpuRingKey !== initKey || this.gpuRingGeneration !== initGeneration) return;
      console.warn("[understory] GPU ring compute init failed:", error);
      this.gpuRingStats = { ...this.gpuRingStats, status: "failed", reason: String(error) };
    }).finally(() => {
      if (this.gpuRingKey === initKey && this.gpuRingGeneration === initGeneration) this.gpuRingInit = null;
    });
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

  private gpuRingIndexCounts(): number[] {
    const counts = new Array<number>(UNDERSTORY_RING_GROUP_COUNT).fill(0);
    if (!this.gpuRingDraw) return counts;
    for (let group = 0; group < UNDERSTORY_RING_GROUP_COUNT && group < this.gpuRingDraw.meshes.length; group++) {
      const mesh = this.gpuRingDraw.meshes[group];
      if (!mesh) continue;
      const idx = mesh.geometry.getIndex();
      counts[group] = idx ? idx.count : 0;
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
    this.gpuLightingProxyCache = null;
    this.gpuRingStats = emptyGpuRingStats(this.gpuDevice ? "idle" : "disabled", null);
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

    let totalInstances = this.patches.reduce((sum, patch) => sum + patch.instances.length, 0);
    let added = 0;
    let deferred = false;
    for (const { node } of candidates) {
      if (totalInstances >= this.settings.maxInstances) break;
      if (added >= this.settings.maxNewPatchesPerFrame) {
        deferred = true;
        break;
      }
      const footprint = clampFootprint(node.footprint, this.worldCells);
      const rejection = rejectUnderstoryPatchBeforeGeneration(
        footprint,
        this.settings,
        this.sampler ?? defaultUnderstoryTerrainSampler,
        this.worldCells,
      );
      if (rejection.reject) {
        recordUnderstoryEarlyRejection(this.earlyGenerationStats, rejection);
        continue;
      }
      const patch = this.createPatch(node, this.settings.maxInstances - totalInstances);
      totalInstances += patch.instances.length;
      this.patches.push(patch);
      this.root.add(patch.group);
      added++;
    }
    this.patchesDirty = deferred;
    this.updatePatchVisibility(center);
  }

  private createPatch(node: ClodPageNode, capacityLeft: number): UnderstoryPatch {
    const generationStats = emptyUnderstoryGenerationStats();
    const footprint = clampFootprint(node.footprint, this.worldCells);
    const instances = generateUnderstoryInstances(
      footprint,
      this.settings,
      capacityLeft,
      generationStats,
      this.sampler,
      this.worldCells,
    );
    const centerX = footprintCenterX(footprint);
    const centerZ = footprintCenterZ(footprint);
    const group = new THREE.Group();
    group.name = `understory-patch-${node.id}`;
    group.position.set(centerX, 0, centerZ);
    const meshes = {} as Record<UnderstoryClass, THREE.InstancedMesh>;
    for (const cls of UNDERSTORY_CLASSES) {
      const classInstances = instances.filter((instance) => instance.classId === cls);
      const capacity = Math.max(1, classInstances.length);
      const geometry = this.geometries[cls].clone();
      geometry.setAttribute("understoryWindPhase", new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
      geometry.setAttribute("understoryWorldXZ", new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2));
      const mesh = new THREE.InstancedMesh(geometry, this.materialFor(cls), capacity);
      mesh.name = `understory-${node.id}-${cls}`;
      mesh.count = 0;
      mesh.frustumCulled = true;
      mesh.castShadow = this.classCastsShadow(cls);
      mesh.receiveShadow = false;
      meshes[cls] = mesh;
      group.add(mesh);
    }
    const patch = {
      nodeId: node.id,
      footprint,
      centerX,
      centerZ,
      radius: footprintRadius(footprint),
      group,
      instances,
      meshes,
      visible: false,
      generationStats,
    };
    this.populatePatchMeshes(patch);
    return patch;
  }

  private populatePatchMeshes(patch: UnderstoryPatch): void {
    const counts = new Map<UnderstoryClass, number>();
    for (const cls of UNDERSTORY_CLASSES) counts.set(cls, 0);
    for (const instance of patch.instances) {
      const mesh = patch.meshes[instance.classId];
      const index = counts.get(instance.classId) ?? 0;
      if (index >= mesh.instanceMatrix.count) continue;
      this.translation.set(instance.position[0] - patch.centerX, instance.position[1], instance.position[2] - patch.centerZ);
      this.rotation.setFromAxisAngle(this.upAxis, instance.rotationY);
      this.scale.setScalar(instance.scale);
      this.matrix.compose(this.translation, this.rotation, this.scale);
      mesh.setMatrixAt(index, this.matrix);
      const phase = mesh.geometry.getAttribute("understoryWindPhase") as THREE.InstancedBufferAttribute;
      (phase.array as Float32Array)[index] = instance.windPhase;
      const worldXZ = mesh.geometry.getAttribute("understoryWorldXZ") as THREE.InstancedBufferAttribute;
      const worldArray = worldXZ.array as Float32Array;
      worldArray[index * 2] = instance.position[0];
      worldArray[index * 2 + 1] = instance.position[2];
      counts.set(instance.classId, index + 1);
    }
    for (const cls of UNDERSTORY_CLASSES) {
      const mesh = patch.meshes[cls];
      const count = counts.get(cls) ?? 0;
      mesh.count = count;
      mesh.visible = count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      const phase = mesh.geometry.getAttribute("understoryWindPhase");
      if (phase) phase.needsUpdate = true;
      const worldXZ = mesh.geometry.getAttribute("understoryWorldXZ");
      if (worldXZ) worldXZ.needsUpdate = true;
      if (count > 0) {
        mesh.computeBoundingBox();
        mesh.computeBoundingSphere();
      }
    }
  }

  private updatePatchVisibility(center: THREE.Vector3): void {
    for (const patch of this.patches) {
      const visible = distance2d(center.x, center.z, patch.centerX, patch.centerZ) <= this.settings.distanceM + patch.radius;
      patch.visible = visible;
      patch.group.visible = visible;
      for (const mesh of Object.values(patch.meshes)) mesh.visible = visible && mesh.count > 0;
    }
    this.updateStats();
  }

  private clearPatches(): void {
    for (const patch of this.patches) this.removePatch(patch);
    this.patches = [];
    Object.assign(this.earlyGenerationStats, emptyUnderstoryGenerationStats());
    this.updateStats();
  }

  private removePatch(patch: UnderstoryPatch): void {
    this.root.remove(patch.group);
    for (const mesh of Object.values(patch.meshes)) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
  }

  private materialFor(cls: UnderstoryClass): THREE.Material {
    return this.settings.render.debugColorByClass
      ? this.materialHandle.debugMaterials[cls]
      : this.materialHandle.regularMaterial;
  }

  private applyMaterials(): void {
    for (const patch of this.patches) {
      for (const cls of UNDERSTORY_CLASSES) {
        patch.meshes[cls].material = this.materialFor(cls);
        patch.meshes[cls].castShadow = this.classCastsShadow(cls);
      }
    }
  }

  private classCastsShadow(cls: UnderstoryClass): boolean {
    if (!this.settings.render.shadows) return false;
    return UNDERSTORY_CLASSES.indexOf(cls) <= UNDERSTORY_CLASSES.indexOf(this.settings.render.maxShadowClass);
  }

  private updateStats(): void {
    const stats = emptyUnderstoryStats();
    const gpuRing = this.gpuStatus === "ring" || this.gpuStatus === "error";
    if (gpuRing) {
      const c = this.gpuRingStats.counts;
      stats.totalInstances = this.gpuVisibleCount;
      stats.shrub = c.shrub;
      stats.fern = c.fern;
      stats.sapling = c.sapling;
      stats.flower = c.flower;
      stats.deadLog = c.dead_log;
      stats.stump = c.stump;
      stats.generatedCandidates = this.gpuRingStats.candidateCount;
      stats.acceptedCandidates = this.gpuRingStats.acceptedCandidates || this.gpuVisibleCount;
    } else {
      mergeGenerationStats(stats, this.earlyGenerationStats);
      for (const patch of this.patches) {
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
    stats.gpuStatus = this.gpuStatus;
    stats.gpuCandidateCount = gpuRing ? this.gpuRingStats.candidateCount : 0;
    stats.gpuCandidateCountBeforePrefilter = gpuRing ? this.gpuRingStats.candidateCountBeforePrefilter ?? this.gpuRingStats.candidateCount : 0;
    stats.gpuCandidateCountAfterPrefilter = gpuRing ? this.gpuRingStats.candidateCountAfterPrefilter ?? this.gpuRingStats.candidateCount : 0;
    stats.gpuPrefilterTestedClusters = gpuRing ? this.gpuRingStats.prefilterTestedClusters ?? 0 : 0;
    stats.gpuPrefilterRejectedClusters = gpuRing ? this.gpuRingStats.prefilterRejectedClusters ?? 0 : 0;
    stats.gpuPrefilterAcceptedClusters = gpuRing ? this.gpuRingStats.prefilterAcceptedClusters ?? 0 : 0;
    stats.gpuPrefilterUnknownKeptClusters = gpuRing ? this.gpuRingStats.prefilterUnknownKeptClusters ?? 0 : 0;
    stats.gpuPrefilterFarSummaryConsulted = gpuRing
      ? this.gpuRingStats.prefilterFarSummaryConsulted ?? this.gpuRingStats.prefilterSourceFarSummary ?? 0
      : 0;
    stats.gpuPrefilterSourceFarSummary = gpuRing ? this.gpuRingStats.prefilterSourceFarSummary ?? 0 : 0;
    stats.gpuPrefilterSourceTerrainSampler = gpuRing ? this.gpuRingStats.prefilterSourceTerrainSampler ?? 0 : 0;
    stats.gpuPrefilterSourceFallback = gpuRing ? this.gpuRingStats.prefilterSourceFallback ?? 0 : 0;
    stats.gpuAcceptedCount = gpuRing ? (this.gpuRingStats.acceptedCandidates || this.gpuVisibleCount) : 0;
    stats.gpuVisibleCount = gpuRing ? this.gpuVisibleCount : 0;
    stats.gpuOverflowed = this.gpuOverflowed;
    stats.gpuDispatchMs = this.gpuDispatchMs;
    this.stats = stats;
  }
}

const GPU_LIGHTING_PROXY_REFRESH_M = 8;
const GPU_LIGHTING_PROXY_STEP_CELLS = 3;

function emptyGpuRingStats(status: UnderstoryGpuRingStats["status"], counts: UnderstoryGpuRingStats["counts"] | null): UnderstoryGpuRingStats {
  return {
    status,
    candidateCount: 0,
    candidateCountBeforePrefilter: 0,
    candidateCountAfterPrefilter: 0,
    prefilterTestedClusters: 0,
    prefilterRejectedClusters: 0,
    prefilterAcceptedClusters: 0,
    prefilterUnknownKeptClusters: 0,
    prefilterFarSummaryConsulted: 0,
    prefilterSourceFarSummary: 0,
    prefilterSourceTerrainSampler: 0,
    prefilterSourceFallback: 0,
    acceptedCandidates: 0,
    counts: counts ?? { shrub: 0, fern: 0, sapling: 0, flower: 0, dead_log: 0, stump: 0 },
    groupCounts: [],
    overflowed: false,
    submitMs: null,
    readbackMs: null,
    skippedDispatches: 0,
  };
}

export {
  emptyUnderstoryStats,
  understoryUsesGpuRingDraw,
  type UnderstoryLightingProxy,
  type UnderstoryStats,
} from "./understory_system_support.js";
