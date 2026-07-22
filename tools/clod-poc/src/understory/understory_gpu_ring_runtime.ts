import * as THREE from "three";
import type { UnderstorySettings } from "./understory_config.js";
import { UNDERSTORY_CLASSES } from "./understory_config.js";
import type { EnvironmentLighting } from "../environment/environment.js";
import type { UnderstoryTerrainSampler } from "./understory_instances.js";
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
  understoryRingCell,
  understoryRingGroupCapacity,
  UNDERSTORY_RING_GROUP_COUNT,
} from "./understory_ring_math.js";
import { getDigEditsSnapshot } from "../terrain/terrain.js";
import { resolveDigEdits } from "../gpu/terrain_field_core.js";
import { generateUnderstoryRingValidationCounts } from "./understory_ring_validation.js";
import { understoryGpuRingKey, type UnderstoryStats } from "./understory_system_support.js";

export interface UnderstoryGpuRingRuntimeOptions {
  root: THREE.Group;
  worldCells: number;
  supportsGpu: boolean;
  gpuDevice?: GPUDevice | null;
  gpuBackend?: UnderstoryWebGpuBackendAccess | null;
  hydrologyData?: UnderstoryHydrologyData | null;
  hydrologyWaterTexture?: THREE.Texture | null;
  lighting?: EnvironmentLighting;
  sampler?: UnderstoryTerrainSampler;
}

export class UnderstoryGpuRingRuntime {
  private readonly root: THREE.Group;
  private readonly worldCells: number;
  private readonly supportsGpu: boolean;
  private readonly gpuDevice: GPUDevice | null;
  private readonly gpuBackend: UnderstoryWebGpuBackendAccess | null;
  readonly unsupportedReason: string | null;
  private readonly hydrologyData: UnderstoryHydrologyData | null;
  private readonly hydrologyWaterTexture: THREE.Texture | null;
  private lighting: EnvironmentLighting | undefined;
  private readonly sampler: UnderstoryTerrainSampler | undefined;

  private compute: UnderstoryGpuRingCompute | null = null;
  private init: Promise<void> | null = null;
  private key = "";
  private generation = 0;
  draw: UnderstoryGpuRingDrawResources | null = null;
  ringMeshes: THREE.Mesh[] = [];
  stats: UnderstoryGpuRingStats = emptyGpuRingStats("disabled", null);
  private lastValidationSignature = "";
  private readonly frustumPlaneScratch = new Float32Array(24);

  visibleCount = 0;
  overflowed = false;
  dispatchMs: number | null = null;
  /** Set by {@link update}: capability gate miss vs runtime failure after ensure. */
  lastFailure: "none" | "capability" | "runtime" = "none";

  constructor(options: UnderstoryGpuRingRuntimeOptions) {
    this.root = options.root;
    this.worldCells = options.worldCells;
    this.supportsGpu = options.supportsGpu;
    this.gpuDevice = options.gpuDevice ?? null;
    this.gpuBackend = options.gpuBackend ?? null;
    this.hydrologyData = options.hydrologyData ?? null;
    this.hydrologyWaterTexture = options.hydrologyWaterTexture ?? null;
    this.lighting = options.lighting;
    this.sampler = options.sampler;
    this.unsupportedReason = this.gpuDevice
      ? understoryGpuRingComputeUnsupportedReason(this.gpuDevice)
      : null;
    this.stats = emptyGpuRingStats(this.gpuDevice ? "idle" : "disabled", null);
  }

  get hasDevice(): boolean {
    return !!this.gpuDevice;
  }

  get hasBackend(): boolean {
    return !!this.gpuBackend;
  }

  get hasResources(): boolean {
    return !!this.compute || !!this.init || !!this.draw || this.ringMeshes.length > 0;
  }

  setLighting(lighting: EnvironmentLighting): void {
    this.lighting = lighting;
  }

  /** True when settings + device capability allow the GPU ring path. */
  canUse(settings: UnderstorySettings): boolean {
    return settings.enabled
      && settings.gpu.enabled
      && !settings.gpu.debugForceCpu
      && this.supportsGpu
      && !!this.gpuDevice
      && !this.unsupportedReason;
  }

  ensure(settings: UnderstorySettings): void {
    if (!this.gpuDevice || !this.gpuBackend || !this.canUse(settings)) return;
    const key = understoryGpuRingKey(settings, this.worldCells);
    if (this.compute && this.key === key) return;
    if (this.init && this.key === key) return;

    if (this.hasResources) this.clear();

    this.key = key;
    this.draw = createGpuRingDrawResources(
      settings,
      this.worldCells,
      this.gpuBackend,
      this.lighting,
      this.hydrologyData,
      this.hydrologyWaterTexture,
    );
    for (const mesh of this.draw.meshes) {
      if (!mesh) continue;
      mesh.visible = false;
      this.root.add(mesh);
      this.ringMeshes.push(mesh);
    }
    this.stats = emptyGpuRingStats("initializing", this.stats.counts);

    const initKey = key;
    const initGeneration = this.generation;
    const edits = resolveDigEdits(getDigEditsSnapshot());
    this.init = UnderstoryGpuRingCompute.create(
      this.gpuDevice, edits, this.draw.outputBuffers, settings, this.hydrologyData,
    ).then((compute) => {
      if (this.key !== initKey || this.generation !== initGeneration) {
        compute.destroy();
        return;
      }
      this.compute = compute;
      this.stats = compute.stats(settings.enabled);
    }).catch((error) => {
      if (this.key !== initKey || this.generation !== initGeneration) return;
      console.warn("[understory] GPU ring compute init failed:", error);
      this.stats = { ...this.stats, status: "failed", reason: String(error) };
    }).finally(() => {
      if (this.key === initKey && this.generation === initGeneration) this.init = null;
    });
  }

  /**
   * Drive the GPU ring for one frame.
   * Returns true when the GPU path owns the frame (including initializing).
   * Returns false on failure — façade may CPU-fallback when {@link lastFailure} is `"runtime"`.
   */
  update(settings: UnderstorySettings, center: THREE.Vector3, camera?: THREE.Camera): boolean {
    this.lastFailure = "none";
    if (!this.supportsGpu || !this.gpuDevice || !this.gpuBackend) {
      this.visibleCount = 0;
      this.overflowed = false;
      this.dispatchMs = null;
      this.stats = {
        ...this.stats,
        status: "failed",
        reason: this.gpuDevice ? "unsupported" : "no device",
      };
      this.lastFailure = "capability";
      return false;
    }
    if (this.unsupportedReason) {
      this.visibleCount = 0;
      this.overflowed = false;
      this.dispatchMs = null;
      this.stats = { ...this.stats, status: "failed", reason: this.unsupportedReason };
      this.lastFailure = "capability";
      return false;
    }

    this.ensure(settings);
    this.stats = this.compute?.stats(true) ?? this.stats;

    if (this.stats.status === "failed") {
      this.syncCountersFromStats();
      this.lastFailure = "runtime";
      return false;
    }

    if (this.compute && this.draw) {
      const indexCounts = this.indexCounts();
      const dispatched = this.compute.dispatch({
        centerX: center.x,
        centerZ: center.z,
        worldCells: this.worldCells,
        maxInstancesPerGroup: understoryRingGroupCapacity(settings),
        indexCounts,
        frustumPlanes: this.packFrustumPlanes(camera),
        hydroEnabled: !!this.hydrologyData,
      });
      if (dispatched) {
        for (const mesh of this.ringMeshes) mesh.visible = true;
      }
      this.stats = this.compute.stats(true);
      this.validateAgainstCpu(settings, center, camera);
    }

    this.syncCountersFromStats();
    if (this.stats.status === "failed") {
      this.lastFailure = "runtime";
      return false;
    }
    return true;
  }

  /** Façade gpuStatus after a failed {@link update} when not falling back to CPU. */
  statusAfterFailure(): UnderstoryStats["gpuStatus"] {
    if (this.lastFailure === "capability") {
      if (this.unsupportedReason) return "unsupported";
      return this.gpuDevice ? "unsupported" : "disabled";
    }
    return "error";
  }

  clear(): void {
    if (!this.hasResources) return;
    this.generation++;
    this.compute?.destroy();
    this.compute = null;
    this.init = null;
    this.key = "";
    this.clearDraw();
    this.visibleCount = 0;
    this.overflowed = false;
    this.dispatchMs = null;
    this.lastValidationSignature = "";
    this.lastFailure = "none";
    this.stats = emptyGpuRingStats(this.gpuDevice ? "idle" : "disabled", null);
  }

  packFrustumPlanes(camera?: THREE.Camera): Float32Array {
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

  private syncCountersFromStats(): void {
    const c = this.stats.counts;
    this.visibleCount = c.shrub + c.fern + c.sapling + c.flower + c.dead_log + c.stump;
    this.overflowed = this.stats.overflowed;
    this.dispatchMs = this.stats.submitMs;
  }

  private validateAgainstCpu(settings: UnderstorySettings, center: THREE.Vector3, camera?: THREE.Camera): void {
    if (!settings.gpu.debugValidateAgainstCpu || this.stats.readbackMs === null) return;

    const signature = [
      Math.round(center.x / understoryRingCell(settings)),
      Math.round(center.z / understoryRingCell(settings)),
      this.stats.groupCounts.join(","),
      this.stats.overflowed ? 1 : 0,
    ].join("|");
    if (signature === this.lastValidationSignature) return;
    this.lastValidationSignature = signature;

    const expected = generateUnderstoryRingValidationCounts({
      centerX: center.x,
      centerZ: center.z,
      worldCells: this.worldCells,
      settings,
      sampler: this.sampler,
      maxInstancesPerGroup: understoryRingGroupCapacity(settings),
      frustumPlanes: this.packFrustumPlanes(camera),
    });
    const maxDelta = UNDERSTORY_CLASSES.reduce((max, cls) =>
      Math.max(max, Math.abs((this.stats.counts[cls] ?? 0) - (expected.counts[cls] ?? 0))),
    0);
    const gpuTotal = this.visibleCount;
    const cpuTotal = UNDERSTORY_CLASSES.reduce((sum, cls) => sum + (expected.counts[cls] ?? 0), 0);
    const tolerance = Math.max(4, Math.ceil(Math.max(cpuTotal, gpuTotal) * 0.02));
    if (maxDelta > tolerance || expected.overflowed !== this.stats.overflowed) {
      console.warn(
        "[understory-gpu-ring] CPU/GPU count parity failed " +
        `gpu=${JSON.stringify(this.stats.counts)} cpu=${JSON.stringify(expected.counts)} ` +
        `maxDelta=${maxDelta} tolerance=${tolerance} ` +
        `overflow gpu=${this.stats.overflowed} cpu=${expected.overflowed}`,
      );
    }
  }

  private indexCounts(): number[] {
    const counts = new Array<number>(UNDERSTORY_RING_GROUP_COUNT).fill(0);
    if (!this.draw) return counts;
    for (let group = 0; group < UNDERSTORY_RING_GROUP_COUNT && group < this.draw.meshes.length; group++) {
      const mesh = this.draw.meshes[group];
      if (!mesh) continue;
      const idx = mesh.geometry.getIndex();
      counts[group] = idx ? idx.count : 0;
    }
    return counts;
  }

  private clearDraw(): void {
    for (const mesh of this.ringMeshes) {
      this.root.remove(mesh);
    }
    this.ringMeshes = [];
    clearGpuRingDraw(this.draw);
    this.draw = null;
  }
}

export function emptyGpuRingStats(
  status: UnderstoryGpuRingStats["status"],
  counts: UnderstoryGpuRingStats["counts"] | null,
): UnderstoryGpuRingStats {
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
