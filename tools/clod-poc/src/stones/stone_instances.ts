// GPU-driven stone overlay. Boot scatter writes per-class source regions on movement; a
// per-frame GPU view pass culls sources (frustum + per-class draw distance), picks the
// LOD/variant draw group, and compacts indirect draw arguments — no CPU readbacks.

import * as THREE from "three";
import {
  StorageBufferAttribute,
  StorageInstancedBufferAttribute,
} from "three/webgpu";
import { isRenderableIndirectDrawGeometry, renderableIndirectDrawCountForGeometry } from "../gpu/indirect_draw_geometry.js";
import { getDigEditsSnapshot } from "../terrain/terrain.js";
import type { ClodPageNode } from "../types.js";
import {
  StoneGpuScatterCompute,
  stoneGpuScatterUnsupportedReason,
  stoneGpuSourceClassCap,
  type StoneGpuScatterBuffers,
  type StoneGpuScatterCounts,
  type StoneGpuViewConfig,
} from "../gpu/stone_scatter_compute.js";
import type { GrassHydrologyData } from "../gpu/grass_ring_compute.js";
import { resolveDigEdits } from "../gpu/terrain_field_core.js";
import {
  createStoneNodeMaterial,
  type StoneHydrologyWater,
  type StoneNodeMaterialHandle,
} from "../gpu/stone_node_material.js";
import { buildRock, ROCK_PRESETS, type RockPreset } from "./rock_builder.js";
import { hashCombine, hashString, Rng } from "./seed.js";
import { STONE_CLASSES, type StoneClass, type StoneSettings } from "./stone_config.js";
import { runtimeWorldUsesCameraRelativeCoordinates } from "../world/runtime_world_policy.js";

export interface StoneLighting {
  light: THREE.Vector3;
  sunColor: THREE.Color;
  skyLight: THREE.Color;
  groundLight: THREE.Color;
}

export interface StoneWebGpuBackendAccess {
  createStorageAttribute(attribute: THREE.BufferAttribute): void;
  createIndirectStorageAttribute(attribute: THREE.BufferAttribute): void;
  get(attribute: THREE.BufferAttribute): { buffer?: GPUBuffer };
}

export interface StoneSystemOptions {
  scene: THREE.Scene;
  nodes: ClodPageNode[];
  worldCells: number;
  settings: StoneSettings;
  lighting: StoneLighting;
  gpuDevice?: GPUDevice | null;
  gpuBackend?: StoneWebGpuBackendAccess | null;
  /** Hydrology water field (RGBA32F; G = wet mask, B = carved-bed Y) so GPU stones
   *  snap to the carved terrain instead of floating, and drop in water bodies. */
  hydrologyWaterTexture?: THREE.Texture | null;
  /** Baked hydrology grid for GPU scatter carved-bed sampling. */
  hydrologyGpuData?: GrassHydrologyData | null;
  /** Called when scatter submission or asynchronous telemetry changes the public stats. */
  onStats?: (stats: StoneStats) => void;
}

export interface StoneEarlyTerrainReasonCounts {
  below_water?: number;
  too_steep?: number;
  outside_world?: number;
  too_far?: number;
  density_mask?: number;
  tile_budget?: number;
  class_budget?: number;
  terrain_hidden?: number;
}

export type StoneGpuTelemetryState = "unknown" | "last-known" | "fresh";

export interface StoneStats {
  total: number;
  large: number;
  medium: number;
  small: number;
  visible: number;
  drawnNear: number;
  drawnFar: number;
  groups: number;
  gpuTelemetryState?: StoneGpuTelemetryState;
  gpuCandidateCount?: number;
  gpuCandidateCountBeforePrefilter?: number;
  gpuCandidateCountAfterPrefilter?: number;
  gpuPrefilterTestedClusters?: number;
  gpuPrefilterRejectedClusters?: number;
  gpuPrefilterAcceptedClusters?: number;
  gpuPrefilterUnknownKeptClusters?: number;
  gpuPrefilterFarSummaryConsulted?: number;
  gpuPrefilterSourceFarSummary?: number;
  gpuPrefilterSourceTerrainSampler?: number;
  gpuPrefilterSourceFallback?: number;
  gpuTimingSupported?: boolean;
  gpuTimingPending?: boolean;
  gpuClearMs?: number | null;
  gpuWorldMs?: number | null;
  gpuViewMs?: number | null;
  gpuIndirectMs?: number | null;
  earlyTerrainReasonCounts?: StoneEarlyTerrainReasonCounts;
}

interface StoneDraw {
  classId: StoneClass;
  classIndex: number;
  group: number;
  lod: number;
  variant: number;
  mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>;
}

interface StoneGroupLayout {
  groupCount: number;
  classView: [number, number, number, number][];
  classVariants: [number, number, number];
  classGroupCounts: [number, number, number];
  entries: { classId: StoneClass; classIndex: number; variant: number; lod: number; detail: number; preset: RockPreset; seed: number }[];
}

type IndirectInstancedBufferGeometry = THREE.InstancedBufferGeometry & {
  setIndirect?(attribute: THREE.BufferAttribute, offset: number): void;
};

const CLASS_INDEX: Record<StoneClass, number> = { large: 0, medium: 1, small: 2 };
const CLASS_BY_INDEX: readonly StoneClass[] = ["large", "medium", "small"] as const;
const STONE_RING_MIN_REFRESH_M = 0.5;
const STONE_MAX_VARIANTS = 4;
const STONE_MAX_LODS = 2;
/** LOD switch distance as a fraction of the class's effective draw distance. */
const STONE_LOD_NEAR_FRACTION = 0.4;

export function stoneGpuGroupLayout(settings: StoneSettings): StoneGroupLayout {
  const layout: StoneGroupLayout = {
    groupCount: 0,
    classView: [],
    classVariants: [1, 1, 1],
    classGroupCounts: [0, 0, 0],
    entries: [],
  };
  const ringRadius = Math.max(0.1, settings.ringRadiusM);
  for (const classId of STONE_CLASSES) {
    const classIndex = CLASS_INDEX[classId];
    const config = settings.classes[classId];
    const lodDetails = config.lodDetails.length > 0 ? config.lodDetails.slice(0, STONE_MAX_LODS) : [1];
    const variants = Math.max(1, Math.min(STONE_MAX_VARIANTS, Math.floor(config.variants)));
    const presets = config.presets.length > 0 ? config.presets : ["cobble"];
    const groupBase = layout.groupCount;
    const maxDistance = Math.max(1, config.maxDistance);
    const lodNearM = Math.min(maxDistance, ringRadius) * STONE_LOD_NEAR_FRACTION;
    layout.classView[classIndex] = [maxDistance, lodNearM, lodDetails.length, groupBase];
    layout.classVariants[classIndex] = variants;
    layout.classGroupCounts[classIndex] = variants * lodDetails.length;
    for (let variant = 0; variant < variants; variant++) {
      const presetName = presets[variant % presets.length] as RockPreset;
      const preset = presetName in ROCK_PRESETS ? presetName : "cobble";
      const seed = hashCombine(settings.seedSalt >>> 0, hashString(`stone-gpu:${classId}:${variant}`));
      for (let lod = 0; lod < lodDetails.length; lod++) {
        layout.entries.push({ classId, classIndex, variant, lod, detail: lodDetails[lod], preset, seed });
        layout.groupCount++;
      }
    }
  }
  return layout;
}

export class StoneSystem {
  private readonly scene: THREE.Scene;
  private readonly worldCells: number;
  private readonly gpuDevice: GPUDevice | null;
  private readonly gpuBackend: StoneWebGpuBackendAccess | null;
  private readonly onStats: ((stats: StoneStats) => void) | null;
  private readonly root = new THREE.Group();
  private readonly defaultScatterCenter: THREE.Vector3;
  private readonly lastScatterCenter = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY);
  private readonly frustumPlaneScratch = new Float32Array(24);
  private readonly cameraPositionScratch = new THREE.Vector3();
  private settings: StoneSettings;
  private currentLighting: StoneLighting;
  private visibleClasses = new Set<StoneClass>(STONE_CLASSES);
  private draws: StoneDraw[] = [];
  private materialHandle: StoneNodeMaterialHandle | null = null;
  private readonly hydrologyWater: StoneHydrologyWater | undefined;
  private readonly hydrologyGpuData: GrassHydrologyData | null;
  private scatterCompute: StoneGpuScatterCompute | null = null;
  private generation = 0;
  private drawsReady = false;
  private groupIndexCounts: number[] = [];
  private stats: StoneStats = emptyStats();

  constructor(options: StoneSystemOptions) {
    this.scene = options.scene;
    void options.nodes;
    this.worldCells = options.worldCells;
    this.defaultScatterCenter = new THREE.Vector3(this.worldCells * 0.5, 0, this.worldCells * 0.5);
    this.hydrologyWater = options.hydrologyWaterTexture
      ? {
        texture: options.hydrologyWaterTexture,
        worldSize: options.worldCells,
        res: options.hydrologyGpuData?.res ?? 1,
      }
      : undefined;
    this.hydrologyGpuData = options.hydrologyGpuData ?? null;
    this.settings = { ...options.settings, debug: { ...options.settings.debug } };
    this.currentLighting = cloneLighting(options.lighting);
    this.gpuDevice = options.gpuDevice ?? null;
    this.gpuBackend = options.gpuBackend ?? null;
    this.onStats = options.onStats ?? null;
    this.root.name = "stones";
    this.scene.add(this.root);
    this.root.visible = this.settings.enabled;
    if (this.settings.enabled) this.rebuild();
  }

  setEnabled(enabled: boolean): void {
    this.settings.enabled = enabled;
    this.root.visible = enabled;
    if (enabled) this.rebuild();
    else this.clear();
  }

  updateSettings(settings: Partial<StoneSettings>): void {
    Object.assign(this.settings, settings);
    if (settings.debug) this.settings.debug = { ...settings.debug };
    if (this.settings.enabled) this.rebuild();
    else this.clear();
    this.root.visible = this.settings.enabled;
  }

  updateLighting(lighting: StoneLighting): void {
    this.currentLighting = cloneLighting(lighting);
    this.materialHandle?.setLighting(lighting);
  }

  /** Show only the given size classes (debug). */
  setVisibleClasses(classes: Iterable<StoneClass>): void {
    this.visibleClasses = new Set(classes);
    this.applyClassVisibility();
  }

  rebuild(): void {
    this.clear();
    if (!this.settings.enabled) return;
    if (!this.gpuDevice || !this.gpuBackend) return;
    const unsupported = stoneGpuScatterUnsupportedReason(this.gpuDevice);
    if (unsupported) {
      console.warn(unsupported);
      return;
    }
    const maxInstances = Math.max(0, Math.floor(this.settings.maxInstances));
    if (maxInstances === 0 || this.settings.density <= 0) return;

    const generation = ++this.generation;
    this.drawsReady = false;
    const layout = stoneGpuGroupLayout(this.settings);
    const sourceClassCap = stoneGpuSourceClassCap(this.settings);
    const groupCap = Math.min(sourceClassCap, Math.max(1024, Math.ceil(sourceClassCap / 4)));
    const capacity = layout.groupCount * groupCap;
    const instanceA = this.createStorageInstancedAttribute("instance-a", capacity);
    const instanceB = this.createStorageInstancedAttribute("instance-b", capacity);
    const indirect = new StorageBufferAttribute(new Uint32Array(layout.groupCount * 5), 5);
    indirect.name = "stone-gpu-indirect";
    this.gpuBackend.createIndirectStorageAttribute(indirect);
    this.materialHandle = createStoneNodeMaterial(
      this.currentLighting,
      { instanceA, instanceB, capacity },
      this.hydrologyWater,
      {
        classColors: this.settings.debug.classColors,
        groupCap,
        classGroupCounts: layout.classGroupCounts,
      },
    );

    this.groupIndexCounts = new Array<number>(layout.groupCount).fill(0);
    for (let group = 0; group < layout.entries.length; group++) {
      const draw = this.createDraw(layout.entries[group], group, groupCap, indirect);
      if (!draw) continue;
      this.groupIndexCounts[group] = this.indexCountFor(draw.mesh.geometry);
      this.draws.push(draw);
      this.root.add(draw.mesh);
    }
    this.applyClassVisibility();
    if (this.draws.length === 0) {
      this.materialHandle?.material.dispose();
      this.materialHandle = null;
      this.groupIndexCounts = [];
      this.stats = emptyStats();
      this.onStats?.(this.getStats());
      return;
    }

    const buffers: StoneGpuScatterBuffers = {
      instanceA: this.gpuBufferForAttribute(instanceA),
      instanceB: this.gpuBufferForAttribute(instanceB),
      indirectArgs: this.gpuBufferForAttribute(indirect),
    };
    const viewConfig: StoneGpuViewConfig = {
      sourceClassCap,
      groupCap,
      groupCount: layout.groupCount,
      classView: layout.classView,
      classVariants: layout.classVariants,
      groupIndexCounts: this.groupIndexCounts,
    };
    const edits = resolveDigEdits(getDigEditsSnapshot());
    void StoneGpuScatterCompute.create(this.gpuDevice, edits, buffers, this.hydrologyGpuData, viewConfig)
      .then((compute) => {
        if (generation !== this.generation) {
          compute.destroy();
          return;
        }
        this.scatterCompute = compute;
        this.scatterForCenter(this.defaultScatterCenter);
      })
      .catch((error) => {
        if (generation !== this.generation) return;
        console.warn("stone GPU scatter init failed", error);
      });
  }

  /** GPU stones use the same camera-centred ring model as trees and grass; the
   *  per-frame view pass culls the scattered sources against the live camera. */
  update(center: THREE.Vector3, camera?: THREE.Camera): void {
    if (!this.settings.enabled || !this.scatterCompute || this.draws.length === 0) return;
    const refreshDistance = Math.max(STONE_RING_MIN_REFRESH_M, this.settings.ringRefreshDistanceM);
    if (!this.drawsReady || distance2d(this.lastScatterCenter, center) >= refreshDistance) {
      this.scatterForCenter(center);
    }
    if (this.drawsReady) {
      const cameraPosition = camera?.getWorldPosition(this.cameraPositionScratch) ?? center;
      this.scatterCompute.view({
        cameraX: cameraPosition.x,
        cameraY: cameraPosition.y,
        cameraZ: cameraPosition.z,
        frustumPlanes: this.frustumPlanes(camera),
      });
    }
    this.refreshGpuTiming();
  }

  getStats(): StoneStats {
    this.refreshGpuTiming();
    return { ...this.stats, earlyTerrainReasonCounts: { ...(this.stats.earlyTerrainReasonCounts ?? {}) } };
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.root);
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

  private scatterForCenter(center: THREE.Vector3): void {
    const compute = this.scatterCompute;
    if (!compute) return;
    const generation = this.generation;
    const unboundedCenter = runtimeWorldUsesCameraRelativeCoordinates();
    const centerX = stoneScatterCenterCoord(center.x, 0, this.worldCells, unboundedCenter);
    const centerZ = stoneScatterCenterCoord(center.z, 0, this.worldCells, unboundedCenter);
    const submitted = compute.run({
      worldCells: this.worldCells,
      centerX,
      centerZ,
      unboundedWorld: unboundedCenter,
      settings: this.settings,
    }, (counts) => {
      if (generation !== this.generation || compute !== this.scatterCompute) return;
      this.applyTelemetry(counts);
      this.stats.gpuTelemetryState = "fresh";
      this.applyClassVisibility();
      this.onStats?.(this.getStats());
    });
    if (!submitted) return;

    this.drawsReady = true;
    if (this.stats.gpuTelemetryState !== "unknown") this.stats.gpuTelemetryState = "last-known";
    this.lastScatterCenter.set(centerX, 0, centerZ);
    this.refreshGpuTiming();
    this.applyClassVisibility();
    this.onStats?.(this.getStats());
  }

  private applyTelemetry(counts: StoneGpuScatterCounts): void {
    this.stats.large = counts.large;
    this.stats.medium = counts.medium;
    this.stats.small = counts.small;
    this.stats.total = counts.large + counts.medium + counts.small;
    this.stats.gpuCandidateCount = counts.candidatesTotal;
    this.stats.gpuCandidateCountBeforePrefilter = counts.candidatesTotal;
    this.stats.gpuCandidateCountAfterPrefilter = counts.totalAccepted;
    this.stats.gpuPrefilterTestedClusters = counts.candidatesTotal;
    this.stats.gpuPrefilterRejectedClusters = counts.rejectedTotal;
    this.stats.gpuPrefilterAcceptedClusters = counts.totalAccepted;
    this.stats.gpuPrefilterUnknownKeptClusters = 0;
    this.stats.gpuPrefilterFarSummaryConsulted = 0;
    this.stats.gpuPrefilterSourceFarSummary = 0;
    this.stats.gpuPrefilterSourceTerrainSampler = counts.candidatesTotal;
    this.stats.gpuPrefilterSourceFallback = 0;
    this.stats.earlyTerrainReasonCounts = {
      outside_world: counts.rejectedOutsideWorld,
      too_far: counts.rejectedTooFar,
      below_water: counts.rejectedBelowWater,
      too_steep: counts.rejectedTooSteep,
      density_mask: counts.rejectedDensityMask,
      tile_budget: counts.rejectedTileBudget,
      class_budget: counts.rejectedClassBudget,
      // GPU scatter has no terrain-occlusion reject; leave 0 so reason sums stay exact.
      terrain_hidden: 0,
    };
    this.stats.groups = this.draws.length;
  }

  private refreshGpuTiming(): void {
    const timing = this.scatterCompute?.timingSnapshot();
    if (!timing) return;
    this.stats.gpuTimingSupported = timing.supported;
    this.stats.gpuTimingPending = timing.pending;
    this.stats.gpuClearMs = timing.timingsMs.clear ?? null;
    this.stats.gpuWorldMs = timing.timingsMs.world ?? null;
    this.stats.gpuViewMs = timing.timingsMs.view ?? null;
    this.stats.gpuIndirectMs = timing.timingsMs.indirect ?? null;
  }

  private createDraw(
    entry: StoneGroupLayout["entries"][number],
    group: number,
    groupCap: number,
    indirect: StorageBufferAttribute,
  ): StoneDraw | null {
    if (!this.materialHandle) throw new Error("Stone material must exist before creating draws");
    const built = buildRock(entry.preset, new Rng(entry.seed), entry.detail);
    if (!isRenderableIndirectDrawGeometry(built.geometry)) return null;
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", built.geometry.getAttribute("position"));
    geometry.setAttribute("normal", built.geometry.getAttribute("normal"));
    geometry.setAttribute("vdata", built.geometry.getAttribute("vdata"));
    geometry.setIndex(built.geometry.getIndex());
    geometry.instanceCount = groupCap;
    this.setIndirect(geometry, indirect, group * 5 * Uint32Array.BYTES_PER_ELEMENT);
    const mesh = new THREE.Mesh(geometry, this.materialHandle.material);
    mesh.name = `stones-gpu-${entry.classId}-v${entry.variant}-lod${entry.lod}`;
    mesh.frustumCulled = false;
    return { classId: entry.classId, classIndex: entry.classIndex, group, lod: entry.lod, variant: entry.variant, mesh };
  }

  private createStorageInstancedAttribute(name: string, count: number): StorageInstancedBufferAttribute {
    if (!this.gpuBackend) throw new Error("Cannot create WebGPU stone storage attribute without a backend");
    const attribute = new StorageInstancedBufferAttribute(Math.max(1, count), 4);
    attribute.name = `stone-${name}`;
    this.gpuBackend.createStorageAttribute(attribute);
    return attribute;
  }

  private setIndirect(
    geometry: THREE.InstancedBufferGeometry,
    indirect: StorageBufferAttribute,
    indirectOffset: number,
  ): void {
    const indirectGeometry = geometry as IndirectInstancedBufferGeometry;
    if (!indirectGeometry.setIndirect) {
      throw new Error("GPU stones require InstancedBufferGeometry.setIndirect support");
    }
    indirectGeometry.setIndirect(indirect, indirectOffset);
  }

  private gpuBufferForAttribute(attribute: THREE.BufferAttribute): GPUBuffer {
    if (!this.gpuBackend) throw new Error("Cannot read WebGPU stone buffer without a backend");
    const buffer = this.gpuBackend.get(attribute).buffer;
    if (!buffer) throw new Error(`Missing GPU buffer for ${attribute.name || "stone attribute"}`);
    return buffer;
  }

  private indexCountFor(geometry: THREE.BufferGeometry): number {
    return renderableIndirectDrawCountForGeometry(geometry);
  }

  private applyClassVisibility(): void {
    for (const draw of this.draws) {
      draw.mesh.visible = this.drawsReady && this.visibleClasses.has(draw.classId);
    }
    this.refreshVisibleStats();
  }

  private refreshVisibleStats(): void {
    this.stats.visible = 0;
    for (const classId of CLASS_BY_INDEX) {
      if (this.visibleClasses.has(classId)) this.stats.visible += this.stats[classId];
    }
    this.stats.drawnNear = this.stats.visible;
    this.stats.drawnFar = 0;
    this.stats.groups = this.draws.length;
  }

  private clear(): void {
    this.generation++;
    this.scatterCompute?.destroy();
    this.scatterCompute = null;
    this.lastScatterCenter.set(Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY);
    this.groupIndexCounts = [];
    this.drawsReady = false;
    for (const draw of this.draws) {
      this.root.remove(draw.mesh);
      draw.mesh.geometry.dispose();
    }
    this.draws = [];
    this.materialHandle?.material.dispose();
    this.materialHandle = null;
    this.stats = emptyStats();
    this.onStats?.(this.getStats());
  }
}

function emptyStats(): StoneStats {
  return {
    total: 0,
    large: 0,
    medium: 0,
    small: 0,
    visible: 0,
    drawnNear: 0,
    drawnFar: 0,
    groups: 0,
    gpuTelemetryState: "unknown",
    gpuTimingSupported: false,
    gpuTimingPending: false,
    gpuClearMs: null,
    gpuWorldMs: null,
    gpuViewMs: null,
    gpuIndirectMs: null,
  };
}

function distance2d(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function stoneScatterCenterCoord(value: number, min: number, max: number, unbounded: boolean): number {
  if (!Number.isFinite(value)) return min;
  return unbounded ? value : Math.min(max, Math.max(min, value));
}

function cloneLighting(lighting: StoneLighting): StoneLighting {
  return {
    light: lighting.light.clone(),
    sunColor: lighting.sunColor.clone(),
    skyLight: lighting.skyLight.clone(),
    groundLight: lighting.groundLight.clone(),
  };
}
