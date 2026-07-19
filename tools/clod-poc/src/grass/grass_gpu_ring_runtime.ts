import * as THREE from "three";
import { getDigEditsSnapshot, getDigEditRevision } from "../terrain/terrain.js";
import {
  GrassGpuRingCompute,
  grassGpuRingComputeUnsupportedReason,
  grassGpuRingDensityParams,
  grassGpuRingSlotCount,
  type GrassGpuRingStats,
} from "../gpu/grass_ring_compute.js";
import { renderableIndirectDrawCountForGeometry } from "../gpu/indirect_draw_geometry.js";
import { resolveDigEdits } from "../gpu/terrain_field_core.js";
import type { GrassSettings, GrassTier } from "./grass_config.js";
import {
  grassGpuRingDrawUnsupportedReason,
  grassGpuRingStableKey,
  grassGpuRingTierCapacity,
  type GrassGpuRingDrawResources,
  type GrassGpuTierDrawResources,
  type GrassRingInstanceBuffers,
  type GrassWebGpuBackendAccess,
} from "./grass_gpu_ring.js";
import { createGrassGpuRingDrawResources } from "./grass_gpu_ring_draw_resources.js";
import { grassRingBands } from "./grass_math.js";
import type { GrassGpuRingComputeFactory } from "./grass_system_support.js";
import type { GrassSharedGeometries } from "./grass_shared_geometries.js";

export interface GrassGpuRingRuntimeOptions {
  root: THREE.Group;
  worldCells: number;
  supportsRing: boolean;
  gpuDevice?: GPUDevice | null;
  gpuBackend?: GrassWebGpuBackendAccess | null;
  geometries: GrassSharedGeometries;
  materialFor: (mode: GrassSettings["shaderMode"]) => THREE.Material;
  sharedMaterials: () => Set<THREE.Material>;
  rebuildInjectedRingMaterial: (buffers: GrassRingInstanceBuffers) => void;
  createGpuRingCompute?: GrassGpuRingComputeFactory;
}

export class GrassGpuRingRuntime {
  private readonly root: THREE.Group;
  private readonly worldCells: number;
  private readonly supportsRing: boolean;
  private readonly gpuDevice: GPUDevice | null;
  private readonly gpuBackend: GrassWebGpuBackendAccess | null;
  private readonly unsupportedReason: string | null;
  private readonly geometries: GrassSharedGeometries;
  private readonly materialFor: (mode: GrassSettings["shaderMode"]) => THREE.Material;
  private readonly sharedMaterials: () => Set<THREE.Material>;
  private readonly rebuildInjectedRingMaterial: (buffers: GrassRingInstanceBuffers) => void;
  private readonly injectedGpuRingComputeFactory: GrassGpuRingComputeFactory | null;
  private readonly useGrassPrepass: boolean;
  private useGrassRingDebug: boolean;
  private lastRingDebugKey = "";
  private lastRingDebugTime = 0;
  private compute: GrassGpuRingCompute | null = null;
  private init: Promise<void> | null = null;
  private key = "";
  private failedKey = "";
  private lastDigEditRevision = -1;
  private draw: GrassGpuRingDrawResources | null = null;
  private readonly frustum = new THREE.Frustum();
  private readonly frustumMatrix = new THREE.Matrix4();
  private readonly frustumPlaneScratch = new Float32Array(24);
  private hasFrustum = false;
  stats: GrassGpuRingStats = emptyGrassGpuRingStats("disabled");
  meshes: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>[] = [];
  prepassTwins: THREE.Mesh[] = [];
  bladeCount = 0;
  tierCounts: Record<GrassTier, number> = { near: 0, mid: 0, far: 0, super: 0 };

  constructor(options: GrassGpuRingRuntimeOptions) {
    this.root = options.root;
    this.worldCells = options.worldCells;
    this.supportsRing = options.supportsRing;
    this.gpuDevice = options.gpuDevice ?? null;
    this.gpuBackend = options.gpuBackend ?? null;
    const computeUnsupportedReason = this.gpuDevice
      ? grassGpuRingComputeUnsupportedReason(this.gpuDevice)
      : null;
    this.unsupportedReason = computeUnsupportedReason ?? grassGpuRingDrawUnsupportedReason();
    this.geometries = options.geometries;
    this.materialFor = options.materialFor;
    this.sharedMaterials = options.sharedMaterials;
    this.rebuildInjectedRingMaterial = options.rebuildInjectedRingMaterial;
    this.injectedGpuRingComputeFactory = options.createGpuRingCompute ?? null;
    this.useGrassPrepass = typeof location === "undefined"
      ? true
      : new URLSearchParams(location.search).get("prepass") !== "0";
    this.useGrassRingDebug = typeof location !== "undefined"
      && new URLSearchParams(location.search).get("grassRingDebug") === "1";
  }

  isRingMode(settings: GrassSettings): boolean {
    return this.supportsRing && settings.shaderMode === "webgpu-ring-v1";
  }

  canUse(settings: GrassSettings): boolean {
    return settings.enabled
      && settings.shaderMode === "webgpu-ring-v1"
      && this.supportsRing
      && !!this.gpuDevice
      && !!this.gpuBackend
      && !this.unsupportedReason
      && this.failedKey !== this.currentKey(settings);
  }

  resetFailure(): void {
    this.failedKey = "";
  }

  get failedGpuRingKey(): string {
    return this.failedKey;
  }

  set failedGpuRingKey(value: string) {
    this.failedKey = value;
  }

  setDebug(enabled: boolean): void {
    this.useGrassRingDebug = enabled;
    this.lastRingDebugKey = "";
  }

  clearRing(): void {
    for (const twin of this.prepassTwins) {
      this.root.remove(twin);
      if (Array.isArray(twin.material)) {
        for (const material of twin.material) material.dispose();
      } else {
        twin.material.dispose();
      }
    }
    this.prepassTwins = [];
    const sharedMaterials = this.sharedMaterials();
    for (const mesh of this.meshes) {
      this.root.remove(mesh);
      mesh.geometry.dispose();
      if (!sharedMaterials.has(mesh.material)) mesh.material.dispose();
    }
    this.meshes = [];
    this.draw = null;
    this.bladeCount = 0;
    this.tierCounts = { near: 0, mid: 0, far: 0, super: 0 };
  }

  clearCompute(): void {
    this.compute?.destroy();
    this.compute = null;
    this.init = null;
    this.key = "";
    this.lastDigEditRevision = -1;
    this.hasFrustum = false;
    this.stats = emptyGrassGpuRingStats(this.gpuDevice ? "idle" : "disabled");
  }

  get hasResources(): boolean {
    return !!this.compute || !!this.init || !!this.draw || this.meshes.length > 0;
  }

  get hasDrawResources(): boolean {
    return !!this.draw;
  }

  updateCpuFallbackStatus(settings: GrassSettings): void {
    if (settings.shaderMode !== "webgpu-ring-v1") {
      this.stats = { ...this.stats, status: "disabled" };
      return;
    }
    if (!this.supportsRing) {
      this.stats = { ...this.stats, status: "unsupported" };
      return;
    }
    if (!this.gpuDevice || !this.gpuBackend) {
      this.stats = { ...this.stats, status: "fallback-cpu", reason: "no WebGPU device/backend" };
      return;
    }
    if (this.unsupportedReason) {
      this.stats = { ...this.stats, status: "failed", reason: this.unsupportedReason };
      return;
    }
    this.stats = { ...this.stats, status: "fallback-cpu" };
  }

  refreshStats(settings: GrassSettings): void {
    if (this.isRingMode(settings) && this.compute) this.stats = this.compute.stats(settings.enabled);
  }

  updateCounters(settings: GrassSettings, center: THREE.Vector3, camera?: THREE.Camera): boolean {
    if (!this.gpuDevice || !this.gpuBackend || !this.canUse(settings)) {
      this.stats = { ...this.stats, status: "disabled" };
      this.logDebug(settings, "disabled");
      return false;
    }
    if (this.unsupportedReason) {
      this.stats = { ...this.stats, status: "failed", reason: this.unsupportedReason };
      this.logDebug(settings, "unsupported");
      return false;
    }

    this.ensureCompute(settings);
    if (!this.compute) {
      if (this.failedKey) {
        this.logDebug(settings, "init-failed");
        return false;
      }
      this.logDebug(settings, "no-compute");
      return true;
    }
    this.syncDigEdits();
    const frustumPlanes = this.frustumPlanes(camera);
    if (!frustumPlanes) {
      this.stats = this.compute.stats(settings.enabled);
      this.logDebug(settings, "no-frustum");
      return true;
    }
    const dispatched = this.compute.dispatch({
      centerX: center.x,
      centerZ: center.z,
      worldCells: this.worldCells,
      bands: grassRingBands(settings),
      density: grassGpuRingDensityParams(settings),
      bladeHeight: settings.bladeHeight,
      bladeHeightVariation: settings.bladeHeightVariation,
      slopeMinY: settings.slopeMinY,
      minHeight: settings.minHeight,
      maxHeight: settings.maxHeight,
      maxInstancesPerTier: grassGpuRingTierCapacity(settings),
      seed: settings.seed,
      jitter: settings.placement.jitter,
      ...(settings.appearance
        ? { patchScale: settings.appearance.patchScale, patchStrength: settings.appearance.patchStrength }
        : {}),
      frustumPlanes,
    }, {
      near: this.indexCountFor(this.geometries.ringNearGeometry),
      mid: this.indexCountFor(this.geometries.ringMidGeometry),
      far: this.indexCountFor(this.geometries.ringFarGeometry),
      super: this.indexCountFor(this.geometries.ringSuperGeometry),
    });
    if (!dispatched) {
      this.stats = this.compute.stats(settings.enabled);
      this.handleFailure(this.stats.reason ?? "dispatch failed");
      this.logDebug(settings, "dispatch-failed");
      return false;
    }
    this.setDrawsVisible(true);
    this.stats = this.compute.stats(settings.enabled);
    this.tierCounts = {
      near: this.stats.counts.near,
      mid: this.stats.counts.mid,
      far: this.stats.counts.far,
      super: this.stats.counts.super,
    };
    this.bladeCount = this.tierCounts.near + this.tierCounts.mid + this.tierCounts.far + this.tierCounts.super;
    this.logDebug(settings, "dispatched");
    return true;
  }

  private ensureCompute(settings: GrassSettings): void {
    if (!this.gpuDevice || !this.gpuBackend || !this.canUse(settings)) return;
    const key = this.currentKey(settings);
    if (this.compute && this.key === key) {
      this.stats = this.compute.stats(settings.enabled);
      return;
    }
    if (this.init && this.key === key) return;
    if (this.failedKey === key) return;

    this.clearCompute();
    this.clearRing();
    this.key = key;
    const slotCount = grassGpuRingSlotCount(settings.ring);
    const tierCapacity = grassGpuRingTierCapacity(settings);
    this.draw = this.createDrawResources(settings, tierCapacity);
    this.meshes = Object.values(this.draw.tiers)
      .filter((tier): tier is GrassGpuTierDrawResources => !!tier)
      .map((tier) => tier.mesh);
    this.setDrawsVisible(false);
    for (const mesh of this.meshes) this.root.add(mesh);
    this.stats = {
      ...emptyGrassGpuRingStats("initializing"),
      candidateCount: slotCount,
      generatedCandidates: slotCount,
    };
    const initKey = key;
    const initDigRevision = getDigEditRevision();
    const edits = resolveDigEdits(getDigEditsSnapshot());
    const createCompute = this.injectedGpuRingComputeFactory ?? GrassGpuRingCompute.create;
    this.init = createCompute(this.gpuDevice, edits, this.draw.outputBuffers, settings.ring)
      .then((compute) => {
        if (this.key !== initKey) {
          compute.destroy();
          return;
        }
        this.compute = compute;
        this.lastDigEditRevision = initDigRevision;
        this.stats = compute.stats(settings.enabled);
      })
      .catch((error) => {
        if (this.key !== initKey) return;
        const reason = error instanceof Error ? error.message : String(error);
        this.failedKey = initKey;
        this.stats = { ...this.stats, status: "failed", reason };
        this.clearRing();
        this.clearCompute();
      })
      .finally(() => {
        if (this.key === initKey) this.init = null;
      });
  }

  private syncDigEdits(): void {
    if (!this.compute) return;
    const revision = getDigEditRevision();
    if (revision === this.lastDigEditRevision) return;
    this.compute.updateDigEdits(resolveDigEdits(getDigEditsSnapshot()));
    this.lastDigEditRevision = revision;
  }

  private createDrawResources(settings: GrassSettings, candidateCount: number): GrassGpuRingDrawResources {
    return createGrassGpuRingDrawResources({
      candidateCount,
      gpuBackend: this.gpuBackend,
      geometries: {
        near: this.geometries.ringNearGeometry,
        mid: this.geometries.ringMidGeometry,
        far: this.geometries.ringFarGeometry,
        super: this.geometries.ringSuperGeometry,
      },
      worldCells: this.worldCells,
      shaderMode: settings.shaderMode,
      useGrassRingDebug: this.useGrassRingDebug,
      useGrassPrepass: this.useGrassPrepass,
      materialFor: (mode) => this.materialFor(mode),
      rebuildInjectedRingMaterial: (buffers) => this.rebuildInjectedRingMaterial(buffers),
      addPrepassTwin: (twin) => {
        this.prepassTwins.push(twin);
        this.root.add(twin);
      },
      gpuBufferForAttribute: (attribute) => this.gpuBufferForAttribute(attribute),
    });
  }

  currentKey(settings: GrassSettings): string {
    return grassGpuRingStableKey(settings, this.worldCells);
  }

  private handleFailure(reason: string): void {
    this.stats = { ...this.stats, status: "failed", reason };
    this.clearRing();
    this.clearCompute();
  }

  private setDrawsVisible(visible: boolean): void {
    for (const mesh of this.meshes) mesh.visible = visible;
    for (const twin of this.prepassTwins) twin.visible = visible;
  }

  private frustumPlanes(camera?: THREE.Camera): Float32Array | null {
    if (!camera) {
      return this.hasFrustum ? this.frustumPlaneScratch : null;
    }
    camera.updateMatrixWorld();
    this.frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.frustumMatrix);
    for (let i = 0; i < 6; i++) {
      const plane = this.frustum.planes[i];
      const offset = i * 4;
      this.frustumPlaneScratch[offset] = plane.normal.x;
      this.frustumPlaneScratch[offset + 1] = plane.normal.y;
      this.frustumPlaneScratch[offset + 2] = plane.normal.z;
      this.frustumPlaneScratch[offset + 3] = plane.constant;
    }
    this.hasFrustum = true;
    return this.frustumPlaneScratch;
  }

  private indexCountFor(geometry: THREE.BufferGeometry): number {
    return renderableIndirectDrawCountForGeometry(geometry);
  }

  private gpuBufferForAttribute(attribute: THREE.BufferAttribute): GPUBuffer {
    if (!this.gpuBackend) throw new Error("Cannot read WebGPU grass buffer without a backend");
    const buffer = this.gpuBackend.get(attribute).buffer;
    if (!buffer) throw new Error(`Missing GPU buffer for ${attribute.name || "grass attribute"}`);
    return buffer;
  }

  private logDebug(settings: GrassSettings, stage: string): void {
    if (!this.useGrassRingDebug) return;
    const s = this.stats;
    const key = `${stage}|${s.reason ?? ""}`;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (key === this.lastRingDebugKey) return;
    if (now - this.lastRingDebugTime < 2000) return;
    this.lastRingDebugKey = key;
    this.lastRingDebugTime = now;
    // eslint-disable-next-line no-console
    console.info("[grass-ring-debug] state", {
      stage,
      status: s.status,
      reason: s.reason,
      hasDevice: !!this.gpuDevice,
      hasBackend: !!this.gpuBackend,
      isRingMode: this.isRingMode(settings),
      unsupported: this.unsupportedReason,
      counts: this.tierCounts,
      blades: this.bladeCount,
    });
  }
}

export function emptyGrassGpuRingStats(status: GrassGpuRingStats["status"]): GrassGpuRingStats {
  return {
    status,
    candidateCount: 0,
    prefilterTestedClusters: 0,
    prefilterRejectedClusters: 0,
    prefilterAcceptedClusters: 0,
    prefilterUnknownKeptClusters: 0,
    generatedCandidates: 0,
    acceptedCandidates: 0,
    counts: { near: 0, mid: 0, far: 0, super: 0 },
    submitMs: null,
    readbackMs: null,
    skippedDispatches: 0,
  };
}
