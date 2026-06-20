import * as THREE from "three";
import { StorageBufferAttribute, StorageInstancedBufferAttribute } from "three/webgpu";
import { getDigEditsSnapshot } from "../terrain.js";
import type { ClodPageNode, PageFootprint } from "../types.js";
import {
  GrassGpuRingCompute,
  grassGpuRingComputeUnsupportedReason,
  grassGpuRingSlotCount,
  grassGpuRingTierRegion,
  type GrassGpuRingStats,
} from "../gpu/grass_ring_compute.js";
import { resolveDigEdits } from "../gpu/terrain_field_core.js";
import { depthPrepassTwin } from "../rendering/veg_prepass.js";
import {
  DEFAULT_GRASS_SHADER_MODE,
  GRASS_SHADER_MODES,
  grassRowsForSegments,
  resolveGrassSettings,
  type GrassLighting,
  type GrassSettings,
  type GrassShaderMode,
  type GrassTier,
} from "./grass_config.js";
import { generateGrassInstances, type GrassBladeInstance } from "./grass_cpu_patch.js";
import {
  cloneLighting,
  createBladeGeometry,
  createGrassBladeClumpGeometry,
  createGrassClumpGeometry,
  createGrassMaterial,
  createGrassTuftGeometry,
  grassShaderDefinition,
  populateGrassGeometry,
  type GrassGeometryBuilder,
  type GrassMaterialFactory,
  type GrassMaterialHandle,
} from "./grass_geometry.js";
import {
  gpuBuffersForTier,
  grassGpuRingDrawUnsupportedReason,
  grassGpuRingKey,
  grassGpuRingTierCapacity,
  type GrassGpuRingDrawResources,
  type GrassGpuSharedDrawAttributes,
  type GrassGpuTierDrawResources,
  type GrassRingInstanceBuffers,
  type GrassWebGpuBackendAccess,
  type IndirectInstancedBufferGeometry,
} from "./grass_gpu_ring.js";
import type { GrassGenerationStats, GrassStats } from "./grass_stats.js";
import { grassFadeDistance, grassRingBands } from "./grass_math.js";

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
}

interface GrassPatch {
  nodeId: string;
  meshes: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>[];
  centerX: number;
  centerZ: number;
  radius: number;
  bladeCount: number;
  midBladeCount: number;
  visibleTier: "hidden" | GrassTier;
}

export class GrassSystem {
  private readonly scene: THREE.Scene;
  private readonly nodes: ClodPageNode[];
  private readonly worldCells: number;
  private readonly root = new THREE.Group();
  private readonly classicBladeGeometry = createBladeGeometry();
  private terrainPatchNearGeometry!: THREE.BufferGeometry;
  private terrainPatchNearCrossedGeometry!: THREE.BufferGeometry;
  private terrainPatchMidGeometry!: THREE.BufferGeometry;
  private terrainPatchFarGeometry!: THREE.BufferGeometry;
  private terrainPatchSuperGeometry!: THREE.BufferGeometry;
  private ringNearGeometry!: THREE.BufferGeometry;
  private ringMidGeometry!: THREE.BufferGeometry;
  private ringFarGeometry!: THREE.BufferGeometry;
  private ringSuperGeometry!: THREE.BufferGeometry;
  private readonly materials = new Map<GrassShaderMode, THREE.ShaderMaterial>();
  private readonly supportsRing: boolean;
  private readonly gpuDevice: GPUDevice | null;
  private readonly gpuBackend: GrassWebGpuBackendAccess | null;
  private readonly gpuRingUnsupportedReason: string | null;
  private gpuRingCompute: GrassGpuRingCompute | null = null;
  private gpuRingInit: Promise<void> | null = null;
  private gpuRingKey = "";
  private gpuRingDraw: GrassGpuRingDrawResources | null = null;
  private gpuRingStats: GrassGpuRingStats = {
    status: "disabled",
    candidateCount: 0,
    generatedCandidates: 0,
    acceptedCandidates: 0,
    counts: { near: 0, mid: 0, far: 0, super: 0 },
    dispatchMs: null,
    readbackMs: null,
    skippedDispatches: 0,
  };
  private injectedMaterial: GrassMaterialHandle | null;
  private readonly injectedMaterialFactory: GrassMaterialFactory | null;
  private readonly injectedGeometryBuilder: GrassGeometryBuilder | null;
  private readonly useGrassPrepass: boolean;
  private useGrassRingDebug: boolean;
  private lastRingDebugKey = "";
  private lastRingDebugTime = 0;
  private currentLighting: GrassLighting;
  private settings: GrassSettings;
  private sharedGeometryKey = "";
  private patches: GrassPatch[] = [];
  private patchesDirty = true;
  private ringMeshes: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>[] = [];
  private ringPrepassTwins: THREE.Mesh[] = [];
  private ringBladeCount = 0;
  private ringTierCounts: Record<GrassTier, number> = { near: 0, mid: 0, far: 0, super: 0 };
  private readonly lastRefreshCenter = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0);
  private readonly frustum = new THREE.Frustum();
  private readonly frustumMatrix = new THREE.Matrix4();
  private readonly frustumPlaneScratch = new Float32Array(24);
  private hasGpuRingFrustum = false;
  private bladeCount = 0;
  private patchRebuildCount = 0;
  private grassBuildMs = 0;
  private generationStats: GrassGenerationStats = {
    generatedCandidates: 0,
    acceptedCandidates: 0,
    edgeSuppressedCandidates: 0,
  };
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
    this.nodes = options.nodes
      .filter((node) => node.level === 0)
      .sort((a, b) => a.footprint.minZ - b.footprint.minZ || a.footprint.minX - b.footprint.minX);
    this.worldCells = options.worldCells;
    this.settings = resolveGrassSettings(options.settings);
    this.rebuildSharedGeometries();
    this.supportsRing = options.supportsRing === true;
    this.gpuDevice = options.gpuDevice ?? null;
    this.gpuBackend = options.gpuBackend ?? null;
    const computeUnsupportedReason = this.gpuDevice
      ? grassGpuRingComputeUnsupportedReason(this.gpuDevice)
      : null;
    this.gpuRingUnsupportedReason = computeUnsupportedReason ?? grassGpuRingDrawUnsupportedReason();
    this.currentLighting = cloneLighting(options.lighting);
    this.injectedMaterialFactory = options.createMaterial ?? null;
    this.injectedMaterial = options.material ?? null;
    this.injectedGeometryBuilder = options.buildGeometry ?? null;
    this.useGrassPrepass = typeof location === "undefined"
      ? true
      : new URLSearchParams(location.search).get("prepass") !== "0";
    this.useGrassRingDebug = typeof location !== "undefined"
      && new URLSearchParams(location.search).get("grassRingDebug") === "1";
    if (this.injectedMaterialFactory) this.replaceInjectedMaterial();
    if (!this.injectedMaterial) {
      for (const mode of GRASS_SHADER_MODES) {
        this.materials.set(mode, createGrassMaterial(this.settings, options.lighting, mode));
      }
    }
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
    if (enabled && !wasEnabled) {
      if (this.isRingMode()) {
        this.updateGpuRingCounters(this.lastCenter);
      }
      else if (this.patches.length === 0) this.refreshForCenter(this.lastCenter);
    }
  }

  updateSettings(settings: Partial<GrassSettings>): void {
    const wasRing = this.isRingMode();
    const previousMode = this.settings.shaderMode;
    const previousGeometryKey = this.grassGeometryKey(this.settings);
    this.settings = resolveGrassSettings({ ...this.settings, ...settings });
    if (this.grassGeometryKey(this.settings) !== previousGeometryKey) {
      this.rebuildSharedGeometries();
      this.clearPatches();
      this.clearRing();
      this.clearGpuRingCompute();
    }
    const nowRing = this.isRingMode();
    if (wasRing !== nowRing) {
      this.clearPatches();
      this.clearRing();
      this.clearGpuRingCompute();
    }
    if (this.injectedMaterialFactory && previousMode !== this.settings.shaderMode) {
      this.replaceInjectedMaterial();
    }
    this.updateMaterialUniforms();
    this.patchesDirty = true;
    this.setEnabled(this.settings.enabled);
  }

  updateLighting(lighting: GrassLighting): void {
    this.currentLighting = cloneLighting(lighting);
    if (this.injectedMaterial) {
      this.injectedMaterial.updateLighting?.(lighting);
      return;
    }
    for (const material of this.materials.values()) {
      material.uniforms.uLight.value.copy(lighting.light);
      material.uniforms.uSunColor.value.copy(lighting.sunColor);
      material.uniforms.uSkyLight.value.copy(lighting.skyLight);
      material.uniforms.uGroundLight.value.copy(lighting.groundLight);
    }
  }

  update(timeSeconds: number, center: THREE.Vector3, camera?: THREE.Camera): void {
    if (this.injectedMaterial) {
      this.injectedMaterial.setTime?.(timeSeconds);
      this.injectedMaterial.setFadeCenter?.(center.x, center.z);
    } else {
      for (const material of this.materials.values()) {
        material.uniforms.uTime.value = timeSeconds;
      }
    }
    this.lastCenter.copy(center);
    if (!this.settings.enabled) {
      this.updateStats();
      return;
    }
    if (this.isRingMode()) {
      this.updateGpuRingCounters(center, camera);
      return;
    }
    if (this.patchesDirty || this.lastRefreshCenter.distanceTo(center) >= this.settings.patchFallback.refreshDistance) {
      this.refreshForCenter(center);
    }
  }

  rebuild(): void {
    this.clearPatches();
    this.clearRing();
    this.clearGpuRingCompute();
    if (this.settings.enabled) {
      if (this.isRingMode()) {
        this.updateGpuRingCounters(this.lastCenter);
      }
      else this.refreshForCenter(this.lastCenter);
    }
    this.root.visible = this.settings.enabled;
  }

  /** Regenerate grass for edited LOD0 pages so blades track the current surface. */
  rebuildNodePatches(nodeIds: Iterable<string>): void {
    const ids = new Set(nodeIds);
    if (ids.size === 0) return;
    if (this.isRingMode()) {
      this.clearGpuRingCompute();
      this.updateGpuRingCounters(this.lastCenter);
      return;
    }
    const retained: GrassPatch[] = [];
    for (const patch of this.patches) {
      if (ids.has(patch.nodeId)) {
        this.removePatch(patch);
        this.bladeCount -= patch.bladeCount;
      } else {
        retained.push(patch);
      }
    }
    this.patches = retained;
    this.refreshForCenter(this.lastCenter);
  }

  dispose(): void {
    this.clearPatches();
    this.clearRing();
    this.root.clear();
    this.scene.remove(this.root);
    this.classicBladeGeometry.dispose();
    this.terrainPatchNearGeometry.dispose();
    this.terrainPatchNearCrossedGeometry.dispose();
    this.terrainPatchMidGeometry.dispose();
    this.terrainPatchFarGeometry.dispose();
    this.terrainPatchSuperGeometry.dispose();
    this.ringNearGeometry.dispose();
    this.ringMidGeometry.dispose();
    this.ringFarGeometry.dispose();
    this.ringSuperGeometry.dispose();
    this.clearGpuRingCompute();
    for (const material of this.materials.values()) material.dispose();
    this.injectedMaterial?.dispose?.();
  }

  private rebuildSharedGeometries(): void {
    const key = this.grassGeometryKey(this.settings);
    if (key === this.sharedGeometryKey) return;
    this.sharedGeometryKey = key;
    this.terrainPatchNearGeometry?.dispose();
    this.terrainPatchNearCrossedGeometry?.dispose();
    this.terrainPatchMidGeometry?.dispose();
    this.terrainPatchFarGeometry?.dispose();
    this.terrainPatchSuperGeometry?.dispose();
    this.ringNearGeometry?.dispose();
    this.ringMidGeometry?.dispose();
    this.ringFarGeometry?.dispose();
    this.ringSuperGeometry?.dispose();

    const nearRows = grassRowsForSegments(this.settings.blade.nearSegments);
    const midRows = grassRowsForSegments(this.settings.blade.midSegments, 0);
    this.terrainPatchNearGeometry = createGrassClumpGeometry(
      this.settings.blade.nearBladesPerInstance,
      this.settings.blade.nearSegments,
      this.settings,
    );
    this.terrainPatchNearCrossedGeometry = createGrassBladeClumpGeometry(
      this.settings.blade.nearBladesPerInstance,
      nearRows,
      this.settings.seed + 0x9e3779b9,
    );
    this.terrainPatchMidGeometry = createGrassClumpGeometry(
      this.settings.blade.midBladesPerInstance,
      this.settings.blade.midSegments,
      this.settings,
    );
    this.terrainPatchFarGeometry = createGrassTuftGeometry(this.settings);
    this.terrainPatchSuperGeometry = createGrassTuftGeometry(this.settings.blade.farTuftWidthM * 1.45 / Math.max(this.settings.blade.widthM, 0.001));
    this.ringNearGeometry = createGrassBladeClumpGeometry(this.settings.blade.nearBladesPerInstance, nearRows, 0x9e3779b9);
    this.ringMidGeometry = createGrassBladeClumpGeometry(this.settings.blade.midBladesPerInstance, midRows, 0x85ebca6b);
    this.ringFarGeometry = createGrassTuftGeometry(this.settings);
    this.ringSuperGeometry = createGrassTuftGeometry(this.settings.blade.farTuftWidthM * 1.45 / Math.max(this.settings.blade.widthM, 0.001));
  }

  private grassGeometryKey(settings: GrassSettings): string {
    return [
      settings.seed,
      settings.blade.nearBladesPerInstance,
      settings.blade.midBladesPerInstance,
      settings.blade.nearSegments,
      settings.blade.midSegments,
      settings.blade.farTuftWidthM,
      settings.blade.widthM,
    ].join("|");
  }

  getBladeCount(): number {
    if (this.isRingMode()) return this.ringBladeCount;
    return this.bladeCount;
  }

  getStats(): GrassStats {
    this.updateStats();
    return { ...this.stats };
  }

  private clearPatches(): void {
    for (const patch of this.patches) {
      this.removePatch(patch);
    }
    this.patches = [];
    this.bladeCount = 0;
    this.patchRebuildCount = 0;
    this.grassBuildMs = 0;
    this.generationStats = {
      generatedCandidates: 0,
      acceptedCandidates: 0,
      edgeSuppressedCandidates: 0,
    };
    this.updateStats();
  }

  private clearRing(): void {
    for (const twin of this.ringPrepassTwins) {
      this.root.remove(twin);
      if (Array.isArray(twin.material)) {
        for (const material of twin.material) material.dispose();
      } else {
        twin.material.dispose();
      }
    }
    this.ringPrepassTwins = [];
    const sharedMaterials = new Set<THREE.Material>([
      ...this.materials.values(),
      ...(this.injectedMaterial ? [this.injectedMaterial.material] : []),
    ]);
    for (const mesh of this.ringMeshes) {
      this.root.remove(mesh);
      mesh.geometry.dispose();
      if (!sharedMaterials.has(mesh.material)) mesh.material.dispose();
    }
    this.ringMeshes = [];
    this.gpuRingDraw = null;
    this.ringBladeCount = 0;
    this.ringTierCounts = { near: 0, mid: 0, far: 0, super: 0 };
    this.updateStats();
  }

  private clearGpuRingCompute(): void {
    this.gpuRingCompute?.destroy();
    this.gpuRingCompute = null;
    this.gpuRingInit = null;
    this.gpuRingKey = "";
    this.hasGpuRingFrustum = false;
    this.gpuRingStats = {
      status: this.gpuDevice ? "idle" : "disabled",
      candidateCount: 0,
      generatedCandidates: 0,
      acceptedCandidates: 0,
      counts: { near: 0, mid: 0, far: 0, super: 0 },
      dispatchMs: null,
      readbackMs: null,
      skippedDispatches: 0,
    };
  }

  private isRingMode(): boolean {
    return this.supportsRing && this.settings.shaderMode === "webgpu-ring-v1";
  }

  /** ?grassRingDebug=1: surface why the ring is/ isn't producing instances (one log per state change). */
  /** Runtime toggle for the ?grassRingDebug console logging (GUI checkbox). */
  setRingDebug(enabled: boolean): void {
    this.useGrassRingDebug = enabled;
    this.lastRingDebugKey = "";
  }

  private logRingDebug(stage: string): void {
    if (!this.useGrassRingDebug) return;
    const s = this.gpuRingStats;
    // Dedupe on the state transition (not the live blade count); additionally rate-limit to once
    // every 2s so a state that oscillates every frame can't flood the console (still readable).
    // Key on stage + reason only - NOT status, which flips ready/running every readback and would
    // re-log forever. The 2s window is a backstop for anything else that oscillates.
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
      isRingMode: this.isRingMode(),
      unsupported: this.gpuRingUnsupportedReason,
      counts: this.ringTierCounts,
      blades: this.ringBladeCount,
    });
  }

  private updateGpuRingCounters(center: THREE.Vector3, camera?: THREE.Camera): void {
    if (!this.gpuDevice || !this.gpuBackend || !this.isRingMode()) {
      this.gpuRingStats = {
        ...this.gpuRingStats,
        status: "disabled",
      };
      this.logRingDebug("disabled");
      return;
    }
    if (this.gpuRingUnsupportedReason) {
      this.gpuRingStats = {
        ...this.gpuRingStats,
        status: "disabled",
        reason: this.gpuRingUnsupportedReason,
      };
      this.logRingDebug("unsupported");
      return;
    }

    this.ensureGpuRingCompute();
    if (!this.gpuRingCompute) {
      this.logRingDebug("no-compute");
      return;
    }
    const frustumPlanes = this.frustumPlanes(camera);
    if (!frustumPlanes) {
      this.gpuRingStats = this.gpuRingCompute.stats(this.settings.enabled);
      this.logRingDebug("no-frustum");
      return;
    }
    this.gpuRingCompute.dispatch({
      centerX: center.x,
      centerZ: center.z,
      worldCells: this.worldCells,
      bands: grassRingBands(this.settings),
      bladeHeight: this.settings.bladeHeight,
      bladeHeightVariation: this.settings.bladeHeightVariation,
      slopeMinY: this.settings.slopeMinY,
      minHeight: this.settings.minHeight,
      maxHeight: this.settings.maxHeight,
      maxInstancesPerTier: grassGpuRingTierCapacity(this.settings),
      seed: this.settings.seed,
      frustumPlanes,
    }, {
      near: this.indexCountFor(this.ringNearGeometry),
      mid: this.indexCountFor(this.ringMidGeometry),
      far: this.indexCountFor(this.ringFarGeometry),
      super: this.indexCountFor(this.ringSuperGeometry),
    });
    this.gpuRingStats = this.gpuRingCompute.stats(this.settings.enabled);
    this.ringTierCounts = {
      near: this.gpuRingStats.counts.near,
      mid: this.gpuRingStats.counts.mid,
      far: this.gpuRingStats.counts.far,
      super: this.gpuRingStats.counts.super,
    };
    this.ringBladeCount = this.ringTierCounts.near + this.ringTierCounts.mid + this.ringTierCounts.far + this.ringTierCounts.super;
    this.logRingDebug("dispatched");
  }

  private ensureGpuRingCompute(): void {
    if (!this.gpuDevice || !this.gpuBackend || !this.isRingMode()) return;
    const key = grassGpuRingKey(this.settings, this.worldCells);
    if (this.gpuRingCompute && this.gpuRingKey === key) {
      this.gpuRingStats = this.gpuRingCompute.stats(this.settings.enabled);
      return;
    }
    if (this.gpuRingInit && this.gpuRingKey === key) return;

    this.clearGpuRingCompute();
    this.clearRing();
    this.gpuRingKey = key;
    const slotCount = grassGpuRingSlotCount(this.settings.ring);
    const tierCapacity = grassGpuRingTierCapacity(this.settings);
    this.gpuRingDraw = this.createGpuRingDrawResources(tierCapacity);
    this.ringMeshes = Object.values(this.gpuRingDraw.tiers).map((tier) => tier.mesh);
    for (const mesh of this.ringMeshes) this.root.add(mesh);
    this.generationStats = {
      generatedCandidates: slotCount,
      acceptedCandidates: 0,
      edgeSuppressedCandidates: 0,
    };
    this.gpuRingStats = {
      status: "initializing",
      candidateCount: slotCount,
      generatedCandidates: slotCount,
      acceptedCandidates: 0,
      counts: { near: 0, mid: 0, far: 0, super: 0 },
      dispatchMs: null,
      readbackMs: null,
      skippedDispatches: 0,
    };
    const initKey = key;
    const edits = resolveDigEdits(getDigEditsSnapshot());
    this.gpuRingInit = GrassGpuRingCompute.create(this.gpuDevice, edits, this.gpuRingDraw.outputBuffers, this.settings.ring)
      .then((compute) => {
        if (this.gpuRingKey !== initKey) {
          compute.destroy();
          return;
        }
        this.gpuRingCompute = compute;
        this.gpuRingStats = compute.stats(this.settings.enabled);
      })
      .catch((error) => {
        if (this.gpuRingKey !== initKey) return;
        this.gpuRingStats = {
          ...this.gpuRingStats,
          status: "failed",
          reason: error instanceof Error ? error.message : String(error),
        };
      })
      .finally(() => {
        if (this.gpuRingKey === initKey) this.gpuRingInit = null;
      });
  }

  private frustumPlanes(camera?: THREE.Camera): Float32Array | null {
    if (!camera) {
      return this.hasGpuRingFrustum ? this.frustumPlaneScratch : null;
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
    this.hasGpuRingFrustum = true;
    return this.frustumPlaneScratch;
  }

  private indexCountFor(geometry: THREE.BufferGeometry): number {
    return geometry.getIndex()?.count ?? geometry.getAttribute("position")?.count ?? 0;
  }

  private createGpuRingDrawResources(candidateCount: number): GrassGpuRingDrawResources {
    if (!this.gpuBackend) throw new Error("Cannot create WebGPU grass draw resources without a backend");
    const count = Math.max(1, candidateCount);
    const sharedInstanceCount = count * 4;
    const indirect = new StorageBufferAttribute(new Uint32Array(4 * 5), 5);
    indirect.name = "grass-ring-indirect";
    this.gpuBackend.createIndirectStorageAttribute(indirect);
    const sharedAttributes: GrassGpuSharedDrawAttributes = {
      offset: this.createStorageInstancedAttribute("shared-offset", sharedInstanceCount),
      packed0: this.createStorageInstancedAttribute("shared-packed0", sharedInstanceCount),
      packed1: this.createStorageInstancedAttribute("shared-packed1", sharedInstanceCount),
      terrainNormal: this.createStorageInstancedAttribute("shared-terrain-normal", sharedInstanceCount),
    };
    // Rebuild the node material to read these storage buffers (not attribute()) before the tier
    // meshes pick it up via materialFor - the 4*maxBlades vec4 buffers exceed the 64KB uniform limit
    // if bound as instanced attributes.
    this.rebuildInjectedRingMaterial({ ...sharedAttributes, capacity: sharedInstanceCount });

    const tiers = {
      near: this.createGpuRingTierDraw("near", count, this.ringNearGeometry, indirect, 0, sharedAttributes),
      mid: this.createGpuRingTierDraw("mid", count, this.ringMidGeometry, indirect, 5 * Uint32Array.BYTES_PER_ELEMENT, sharedAttributes),
      far: this.createGpuRingTierDraw("far", count, this.ringFarGeometry, indirect, 10 * Uint32Array.BYTES_PER_ELEMENT, sharedAttributes),
      super: this.createGpuRingTierDraw("super", count, this.ringSuperGeometry, indirect, 15 * Uint32Array.BYTES_PER_ELEMENT, sharedAttributes),
    } satisfies Record<GrassTier, GrassGpuTierDrawResources>;
    if (this.useGrassRingDebug) this.logGpuRingRegions(count);

    return {
      tiers,
      indirect,
      outputBuffers: {
        near: gpuBuffersForTier(sharedAttributes, (attribute) => this.gpuBufferForAttribute(attribute)),
        mid: gpuBuffersForTier(sharedAttributes, (attribute) => this.gpuBufferForAttribute(attribute)),
        far: gpuBuffersForTier(sharedAttributes, (attribute) => this.gpuBufferForAttribute(attribute)),
        super: gpuBuffersForTier(sharedAttributes, (attribute) => this.gpuBufferForAttribute(attribute)),
        indirectArgs: this.gpuBufferForAttribute(indirect),
      },
    };
  }

  private logGpuRingRegions(maxInstancesPerTier: number): void {
    const rows = (["near", "mid", "far", "super"] as const).map((tier, index) => ({
      tier,
      ...grassGpuRingTierRegion(index, maxInstancesPerTier),
    }));
    console.info("[grass-ring-debug] compact tier regions", rows);
  }

  private createGpuRingTierDraw(
    tier: GrassTier,
    count: number,
    bladeGeometry: THREE.BufferGeometry,
    indirect: StorageBufferAttribute,
    indirectOffset: number,
    sharedAttributes: GrassGpuSharedDrawAttributes,
  ): GrassGpuTierDrawResources {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", bladeGeometry.getAttribute("position"));
    geometry.setAttribute("uv", bladeGeometry.getAttribute("uv"));
    geometry.setAttribute("normal", bladeGeometry.getAttribute("normal"));
    geometry.setIndex(bladeGeometry.getIndex());
    // Per-instance data is read by the material as STORAGE buffers (storage().element(instanceIndex)),
    // not vertex attributes - binding these 4*maxBlades-vec4 buffers as instanced attributes overflows
    // the 64KB uniform limit. The buffers still live in sharedAttributes (compute output / material input).
    const { offset, packed0, packed1, terrainNormal } = sharedAttributes;
    geometry.instanceCount = count;
    this.setGpuRingIndirect(geometry, indirect, indirectOffset);
    geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3(-1, -1, -1),
      new THREE.Vector3(this.worldCells + 1, 256, this.worldCells + 1),
    );
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    const baseMaterial = this.materialFor(this.settings.shaderMode);
    const material = this.usesGpuRingPrepass(tier) ? baseMaterial.clone() : baseMaterial;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `grass-ring-gpu-${tier}`;
    mesh.frustumCulled = false;
    this.addGpuRingPrepassTwin(tier, mesh);
    return { mesh, offset, packed0, packed1, terrainNormal };
  }

  private usesGpuRingPrepass(tier: GrassTier): boolean {
    return this.useGrassPrepass && (tier === "near" || tier === "mid");
  }

  private addGpuRingPrepassTwin(tier: GrassTier, mesh: THREE.Mesh): void {
    if (!this.usesGpuRingPrepass(tier)) return;
    const materialNodes = mesh.material as unknown as { positionNode?: unknown; maskNode?: unknown };
    if (!materialNodes.positionNode) return;
    const twin = depthPrepassTwin(mesh, {
      positionNode: materialNodes.positionNode,
      maskNode: materialNodes.maskNode,
      side: THREE.DoubleSide,
    });
    this.ringPrepassTwins.push(twin);
    this.root.add(twin);
  }

  private createStorageInstancedAttribute(name: string, count: number): StorageInstancedBufferAttribute {
    if (!this.gpuBackend) throw new Error("Cannot create WebGPU grass storage attribute without a backend");
    const attribute = new StorageInstancedBufferAttribute(count, 4);
    attribute.name = `grass-ring-${name}`;
    this.gpuBackend.createStorageAttribute(attribute);
    return attribute;
  }

  private setGpuRingIndirect(
    geometry: THREE.InstancedBufferGeometry,
    indirect: StorageBufferAttribute,
    indirectOffset: number,
  ): void {
    const indirectGeometry = geometry as IndirectInstancedBufferGeometry;
    if (!indirectGeometry.setIndirect) {
      throw new Error(grassGpuRingDrawUnsupportedReason() ?? "Missing WebGPU indirect geometry support");
    }
    indirectGeometry.setIndirect(indirect, indirectOffset);
  }

  private gpuBufferForAttribute(attribute: THREE.BufferAttribute): GPUBuffer {
    if (!this.gpuBackend) throw new Error("Cannot read WebGPU grass buffer without a backend");
    const buffer = this.gpuBackend.get(attribute).buffer;
    if (!buffer) throw new Error(`Missing GPU buffer for ${attribute.name || "grass attribute"}`);
    return buffer;
  }

  private refreshForCenter(center: THREE.Vector3): void {
    // refreshPatches builds at most maxNewPatchesPerRefresh new patches and returns true if it
    // deferred more; keep patchesDirty set so update() finishes them over the next frames instead
    // of scattering every newly-in-range patch in one frame (the walk stutter).
    const deferred = this.refreshPatches(center);
    for (const patch of this.patches) {
      const distance = Math.hypot(center.x - patch.centerX, center.z - patch.centerZ);
      this.updatePatchVisibility(patch, distance);
    }
    this.lastRefreshCenter.copy(center);
    this.patchesDirty = deferred;
    this.updateStats();
  }

  /** Returns true if it hit the per-frame patch budget and left more nodes to build later. */
  private refreshPatches(center: THREE.Vector3): boolean {
    const nearbyNodes = this.nodes.filter((node) => {
      const footprint = node.footprint;
      const centerX = (footprint.minX + footprint.maxX) * 0.5;
      const centerZ = (footprint.minZ + footprint.maxZ) * 0.5;
      const radius = Math.hypot(footprint.maxX - footprint.minX, footprint.maxZ - footprint.minZ) * 0.5;
      return Math.hypot(center.x - centerX, center.z - centerZ) <= this.settings.distance + radius;
    });
    const nearbyIds = new Set(nearbyNodes.map((node) => node.id));
    const retainedPatches: GrassPatch[] = [];
    for (const patch of this.patches) {
      if (nearbyIds.has(patch.nodeId)) {
        retainedPatches.push(patch);
      } else {
        this.removePatch(patch);
        this.bladeCount -= patch.bladeCount;
      }
    }
    this.patches = retainedPatches;

    const retainedIds = new Set(this.patches.map((patch) => patch.nodeId));
    const newNodes = nearbyNodes.filter((node) => !retainedIds.has(node.id));
    let remainingBudget = Math.max(0, Math.floor(this.settings.maxBlades) - this.bladeCount);
    let built = 0;
    for (let index = 0; index < newNodes.length && remainingBudget > 0; index++) {
      // Each createPatch scatters blades + builds an InstancedBufferGeometry. Building every
      // newly-in-range node in one frame is the walk stutter; cap per frame and defer the rest.
      if (built >= this.settings.patchFallback.maxNewPatchesPerRefresh) return true;
      const node = newNodes[index];
      const source = node.footprint;
      const footprint: PageFootprint = {
        minX: THREE.MathUtils.clamp(source.minX, 0, this.worldCells),
        minZ: THREE.MathUtils.clamp(source.minZ, 0, this.worldCells),
        maxX: THREE.MathUtils.clamp(source.maxX, 0, this.worldCells),
        maxZ: THREE.MathUtils.clamp(source.maxZ, 0, this.worldCells),
      };
      const remainingNodes = newNodes.length - index;
      const patchBudget = Math.ceil(remainingBudget / remainingNodes);
      const buildStart = performance.now();
      const instances = generateGrassInstances(footprint, this.settings, patchBudget, this.generationStats);
      if (instances.length === 0) continue;
      const patch = this.createPatch(node.id, footprint, instances);
      this.grassBuildMs += performance.now() - buildStart;
      this.patchRebuildCount++;
      this.patches.push(patch);
      for (const mesh of patch.meshes) this.root.add(mesh);
      this.bladeCount += patch.bladeCount;
      remainingBudget -= patch.bladeCount;
      built++;
    }
    return false;
  }

  private createPatch(nodeId: string, footprint: PageFootprint, instances: GrassBladeInstance[]): GrassPatch {
    const shader = grassShaderDefinition(this.settings.shaderMode);
    if (shader.patchStyle === "terrain-patch") {
      return this.createTerrainPatch(nodeId, footprint, instances);
    }
    const geometry = this.injectedGeometryBuilder
      ? this.injectedGeometryBuilder(instances, { mode: this.settings.shaderMode, tier: "near", settings: this.settings })
      : new THREE.InstancedBufferGeometry();
    if (!this.injectedGeometryBuilder) {
      populateGrassGeometry(geometry, this.classicBladeGeometry, footprint, instances, this.settings);
    }

    const centerX = (footprint.minX + footprint.maxX) * 0.5;
    const centerZ = (footprint.minZ + footprint.maxZ) * 0.5;
    const radius = Math.hypot(footprint.maxX - footprint.minX, footprint.maxZ - footprint.minZ) * 0.5;
    return {
      nodeId,
      meshes: [new THREE.Mesh(geometry, this.materialFor(this.settings.shaderMode))],
      centerX,
      centerZ,
      radius,
      bladeCount: instances.length,
      midBladeCount: 0,
      visibleTier: "hidden",
    };
  }

  private createTerrainPatch(nodeId: string, footprint: PageFootprint, instances: GrassBladeInstance[]): GrassPatch {
    const nearBlade = this.settings.nearCrossedQuads
      ? this.terrainPatchNearCrossedGeometry
      : this.terrainPatchNearGeometry;
    const nearGeometry = this.injectedGeometryBuilder
      ? this.injectedGeometryBuilder(instances, {
          mode: this.settings.shaderMode,
          tier: "near",
          crossed: this.settings.nearCrossedQuads,
          settings: this.settings,
        })
      : new THREE.InstancedBufferGeometry();
    if (!this.injectedGeometryBuilder) {
      populateGrassGeometry(nearGeometry, nearBlade, footprint, instances, this.settings);
    }

    const midThinRatio = this.settings.lod.midInstanceFraction;
    const farThinRatio = this.settings.lod.farInstanceFraction || this.settings.lod.farDensityRatio;
    const midCount = this.thinnedCount(instances.length, midThinRatio);
    const midInstances = instances.slice(0, midCount).map((instance) => ({
      ...instance,
      height: instance.height * 1.55,
      edgeFade: Math.min(1, instance.edgeFade * 1.15),
      widthScale: (instance.widthScale ?? 1) * this.widthCompensation(midThinRatio),
    }));
    const midGeometry = this.injectedGeometryBuilder
      ? this.injectedGeometryBuilder(midInstances, { mode: this.settings.shaderMode, tier: "mid", settings: this.settings })
      : new THREE.InstancedBufferGeometry();
    if (!this.injectedGeometryBuilder) {
      populateGrassGeometry(midGeometry, this.terrainPatchMidGeometry, footprint, midInstances, this.settings);
    }

    const farCount = this.thinnedCount(instances.length, farThinRatio);
    const farInstances = instances.slice(0, farCount).map((instance) => ({
      ...instance,
      height: instance.height * 1.9,
      edgeFade: Math.min(1, instance.edgeFade * 1.25),
      widthScale: (instance.widthScale ?? 1) * this.widthCompensation(farThinRatio),
    }));
    const farGeometry = this.injectedGeometryBuilder
      ? this.injectedGeometryBuilder(farInstances, {
          mode: this.settings.shaderMode,
          tier: "far",
          crossed: true,
          settings: this.settings,
        })
      : new THREE.InstancedBufferGeometry();
    if (!this.injectedGeometryBuilder) {
      populateGrassGeometry(farGeometry, this.terrainPatchFarGeometry, footprint, farInstances, this.settings);
    }

    const superThinRatio = Math.max(0.001, farThinRatio * 0.5);
    const superCount = this.thinnedCount(instances.length, superThinRatio);
    const superInstances = instances.slice(0, superCount).map((instance) => ({
      ...instance,
      height: instance.height * 2.35,
      edgeFade: Math.min(1, instance.edgeFade * 1.35),
      widthScale: (instance.widthScale ?? 1) * this.widthCompensation(superThinRatio),
    }));
    const superGeometry = this.injectedGeometryBuilder
      ? this.injectedGeometryBuilder(superInstances, {
          mode: this.settings.shaderMode,
          tier: "super",
          crossed: true,
          settings: this.settings,
        })
      : new THREE.InstancedBufferGeometry();
    if (!this.injectedGeometryBuilder) {
      populateGrassGeometry(superGeometry, this.terrainPatchSuperGeometry, footprint, superInstances, this.settings);
    }

    const centerX = (footprint.minX + footprint.maxX) * 0.5;
    const centerZ = (footprint.minZ + footprint.maxZ) * 0.5;
    const radius = Math.hypot(footprint.maxX - footprint.minX, footprint.maxZ - footprint.minZ) * 0.5;
    const material = this.materialFor(this.settings.shaderMode);
    const nearMesh = new THREE.Mesh(nearGeometry, material);
    const midMesh = new THREE.Mesh(midGeometry, material);
    const farMesh = new THREE.Mesh(farGeometry, material);
    const superMesh = new THREE.Mesh(superGeometry, material);
    return {
      nodeId,
      meshes: [nearMesh, midMesh, farMesh, superMesh],
      centerX,
      centerZ,
      radius,
      bladeCount: instances.length,
      midBladeCount: midInstances.length + farInstances.length + superInstances.length,
      visibleTier: "hidden",
    };
  }

  private thinnedCount(instanceCount: number, thinRatio: number): number {
    if (instanceCount <= 0) return 0;
    return Math.max(1, Math.floor(instanceCount * THREE.MathUtils.clamp(thinRatio, 0, 1)));
  }

  private widthCompensation(thinRatio: number): number {
    return THREE.MathUtils.clamp(
      1 / Math.sqrt(Math.max(thinRatio, 0.001)),
      1,
      this.settings.blade.maxWidthCompensation,
    );
  }

  private updateMaterialUniforms(): void {
    if (this.injectedMaterial) {
      this.injectedMaterial.updateSettings?.(this.settings);
      this.syncGpuRingMaterialClones();
      return;
    }
    for (const [mode, material] of this.materials) {
      material.uniforms.uBladeWidth.value = this.settings.bladeWidth;
      material.uniforms.uWindDirection.value.set(this.settings.wind.direction[0], this.settings.wind.direction[1]);
      material.uniforms.uWindStrength.value = this.settings.windStrength;
      material.uniforms.uWindSpeed.value = this.settings.windSpeed;
      material.uniforms.uNearDistance.value = this.settings.distance * this.settings.lod.nearFraction;
      material.uniforms.uMidDistance.value = this.settings.distance * this.settings.lod.midFraction;
      material.uniforms.uFadeDistance.value = grassFadeDistance(this.settings);
      // Toggling alpha-to-coverage only flips a material flag + uniform (no recompile/rebuild).
      const useAlphaToCoverage =
        grassShaderDefinition(mode).patchStyle === "terrain-patch" && this.settings.alphaToCoverage;
      material.alphaToCoverage = useAlphaToCoverage;
      material.uniforms.uAlphaToCoverage.value = useAlphaToCoverage ? 1 : 0;
    }
  }

  private syncGpuRingMaterialClones(): void {
    if (!this.injectedMaterial) return;
    const source = this.injectedMaterial.material;
    for (const mesh of this.ringMeshes) {
      if (mesh.material === source) continue;
      mesh.material.alphaToCoverage = source.alphaToCoverage;
      mesh.material.needsUpdate = true;
    }
  }

  private updatePatchVisibility(patch: GrassPatch, distance: number): void {
    if (grassShaderDefinition(this.settings.shaderMode).patchStyle !== "terrain-patch") {
      const visible = distance <= this.settings.distance + patch.radius;
      patch.meshes[0].visible = visible;
      patch.visibleTier = visible ? "near" : "hidden";
      return;
    }

    const nearDistance = this.settings.distance * this.settings.lod.nearFraction + patch.radius;
    const midDistance = this.settings.distance * this.settings.lod.midFraction + patch.radius;
    const farDistance = this.settings.distance * this.settings.ring.farDistanceFraction + patch.radius;
    const coverageDistance = this.settings.distance + patch.radius;
    patch.meshes[0].visible = distance <= nearDistance;
    patch.meshes[1].visible = distance > nearDistance && distance <= midDistance;
    patch.meshes[2].visible = distance > midDistance && distance <= farDistance;
    patch.meshes[3].visible = distance > farDistance && distance <= coverageDistance;
    patch.visibleTier = patch.meshes[0].visible
      ? "near"
      : patch.meshes[1].visible
        ? "mid"
        : patch.meshes[2].visible ? "far" : patch.meshes[3].visible ? "super" : "hidden";
  }

  private removePatch(patch: GrassPatch): void {
    for (const mesh of patch.meshes) {
      this.root.remove(mesh);
      mesh.geometry.dispose();
    }
  }

  private materialFor(mode: GrassShaderMode): THREE.Material {
    if (this.injectedMaterial) return this.injectedMaterial.material;
    const material = this.materials.get(mode);
    if (!material) throw new Error(`Missing grass material for shader mode: ${mode}`);
    return material;
  }

  private replaceInjectedMaterial(): void {
    if (!this.injectedMaterialFactory) return;
    const previous = this.injectedMaterial;
    this.injectedMaterial = this.injectedMaterialFactory(this.settings, this.currentLighting);
    for (const patch of this.patches) {
      for (const mesh of patch.meshes) mesh.material = this.injectedMaterial.material;
    }
    previous?.dispose?.();
  }

  /**
   * Rebuild the injected node material to read per-instance data from the GPU-ring storage buffers
   * (storage().element) instead of vertex attributes. Called from createGpuRingDrawResources once
   * the buffers exist, before the tier meshes are built, so materialFor returns the storage-reading
   * material. Ring meshes are rebuilt in the same pass, so no live meshes reference the old material.
   */
  private rebuildInjectedRingMaterial(ringInstanceBuffers: GrassRingInstanceBuffers): void {
    if (!this.injectedMaterialFactory) return;
    const previous = this.injectedMaterial;
    this.injectedMaterial = this.injectedMaterialFactory(this.settings, this.currentLighting, ringInstanceBuffers);
    previous?.dispose?.();
  }

  private updateStats(): void {
    const gpu = this.gpuRingStats;
    if (this.isRingMode()) {
      if (this.gpuRingCompute) this.gpuRingStats = this.gpuRingCompute.stats(this.settings.enabled);
      const ringGpu = this.gpuRingStats;
      const visiblePatches = this.ringMeshes.filter((mesh) => mesh.visible).length;
      this.stats = {
        mode: this.settings.shaderMode,
        blades: this.ringBladeCount,
        patches: this.ringMeshes.length,
        visiblePatches,
        culledPatches: this.ringMeshes.length - visiblePatches,
        nearPatches: this.ringTierCounts.near > 0 ? 1 : 0,
        midPatches: this.ringTierCounts.mid > 0 ? 1 : 0,
        coveragePatches: this.ringTierCounts.far > 0 ? 1 : 0,
        superPatches: this.ringTierCounts.super > 0 ? 1 : 0,
        generatedCandidates: ringGpu.generatedCandidates,
        acceptedCandidates: ringGpu.acceptedCandidates,
        edgeSuppressedCandidates: this.generationStats.edgeSuppressedCandidates,
        patchRebuildCount: this.patchRebuildCount,
        buildMs: this.grassBuildMs,
        midBladeCount: this.ringTierCounts.mid + this.ringTierCounts.far + this.ringTierCounts.super,
        gpuRingStatus: ringGpu.status,
        gpuRingCandidateCount: ringGpu.candidateCount,
        gpuRingVisibleNear: ringGpu.counts.near,
        gpuRingVisibleMid: ringGpu.counts.mid,
        gpuRingVisibleFar: ringGpu.counts.far,
        gpuRingVisibleSuper: ringGpu.counts.super,
        gpuRingDispatchMs: ringGpu.dispatchMs,
        gpuRingReadbackMs: ringGpu.readbackMs,
      };
      return;
    }
    let visiblePatches = 0;
    let nearPatches = 0;
    let midPatches = 0;
    let coveragePatches = 0;
    let superPatches = 0;
    let midBladeCount = 0;
    for (const patch of this.patches) {
      if (patch.visibleTier !== "hidden") visiblePatches++;
      if (patch.visibleTier === "near") nearPatches++;
      else if (patch.visibleTier === "mid") midPatches++;
      else if (patch.visibleTier === "far") coveragePatches++;
      else if (patch.visibleTier === "super") superPatches++;
      midBladeCount += patch.midBladeCount;
    }
    this.stats = {
      mode: this.settings.shaderMode,
      blades: this.bladeCount,
      patches: this.patches.length,
      visiblePatches,
      culledPatches: this.patches.length - visiblePatches,
      nearPatches,
      midPatches,
      coveragePatches,
      superPatches,
      generatedCandidates: this.generationStats.generatedCandidates,
      acceptedCandidates: this.generationStats.acceptedCandidates,
      edgeSuppressedCandidates: this.generationStats.edgeSuppressedCandidates,
      patchRebuildCount: this.patchRebuildCount,
      buildMs: this.grassBuildMs,
      midBladeCount,
      gpuRingStatus: gpu.status,
      gpuRingCandidateCount: gpu.candidateCount,
      gpuRingVisibleNear: gpu.counts.near,
      gpuRingVisibleMid: gpu.counts.mid,
      gpuRingVisibleFar: gpu.counts.far,
      gpuRingVisibleSuper: gpu.counts.super,
      gpuRingDispatchMs: gpu.dispatchMs,
      gpuRingReadbackMs: gpu.readbackMs,
    };
  }
}
