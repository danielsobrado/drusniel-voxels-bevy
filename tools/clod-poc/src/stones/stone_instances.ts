// GPU-driven stone overlay. Boot scatter writes per-class instance regions and indirect draw
// arguments; per-frame updates only refresh the toroidal scatter ring when the center moves.

import * as THREE from "three";
import {
  StorageBufferAttribute,
  StorageInstancedBufferAttribute,
} from "three/webgpu";
import { getDigEditsSnapshot } from "../terrain/terrain.js";
import type { ClodPageNode } from "../types.js";
import {
  STONE_GPU_CLASS_COUNT,
  StoneGpuScatterCompute,
  stoneGpuScatterUnsupportedReason,
  type StoneGpuScatterBuffers,
} from "../gpu/stone_scatter_compute.js";
import type { GrassHydrologyData } from "../gpu/grass_ring_compute.js";
import { resolveDigEdits } from "../gpu/terrain_field_core.js";
import {
  createStoneNodeMaterial,
  type StoneHydrologyWater,
  type StoneNodeMaterialHandle,
} from "../gpu/stone_node_material.js";
import { buildRock, type RockPreset } from "./rock_builder.js";
import { hashCombine, hashString, Rng } from "./seed.js";
import { STONE_CLASSES, type StoneClass, type StoneSettings } from "./stone_config.js";

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
  /** Called when async scatter finishes and `getStats()` counts become valid. */
  onStats?: (stats: StoneStats) => void;
}

export interface StoneStats {
  total: number;
  large: number;
  medium: number;
  small: number;
  visible: number;
  drawnNear: number;
  drawnFar: number;
  groups: number;
}

interface StoneDraw {
  classId: StoneClass;
  classIndex: number;
  mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>;
}

type IndirectInstancedBufferGeometry = THREE.InstancedBufferGeometry & {
  setIndirect?(attribute: THREE.BufferAttribute, offset: number): void;
};

const CLASS_INDEX: Record<StoneClass, number> = { large: 0, medium: 1, small: 2 };
const CLASS_BY_INDEX: readonly StoneClass[] = ["large", "medium", "small"] as const;
const DRAW_PRESET: Record<StoneClass, RockPreset> = {
  large: "talus",
  medium: "cobble",
  small: "cobble",
};
const DRAW_DETAIL: Record<StoneClass, number> = { large: 2, medium: 1, small: 1 };
const STONE_RING_MIN_REFRESH_M = 0.5;

export class StoneSystem {
  private readonly scene: THREE.Scene;
  private readonly worldCells: number;
  private readonly gpuDevice: GPUDevice | null;
  private readonly gpuBackend: StoneWebGpuBackendAccess | null;
  private readonly onStats: ((stats: StoneStats) => void) | null;
  private readonly root = new THREE.Group();
  private readonly defaultScatterCenter: THREE.Vector3;
  private readonly lastScatterCenter = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY);
  private settings: StoneSettings;
  private currentLighting: StoneLighting;
  private visibleClasses = new Set<StoneClass>(STONE_CLASSES);
  private draws: StoneDraw[] = [];
  private materialHandle: StoneNodeMaterialHandle | null = null;
  private readonly hydrologyWater: StoneHydrologyWater | undefined;
  private readonly hydrologyGpuData: GrassHydrologyData | null;
  private scatterCompute: StoneGpuScatterCompute | null = null;
  private scatterRunning = false;
  private generation = 0;
  private drawsReady = false;
  private indexCounts: [number, number, number] = [0, 0, 0];
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
    this.settings = { ...options.settings };
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
    const capacity = maxInstances * STONE_GPU_CLASS_COUNT;
    const instanceA = this.createStorageInstancedAttribute("instance-a", capacity);
    const instanceB = this.createStorageInstancedAttribute("instance-b", capacity);
    const indirect = new StorageBufferAttribute(new Uint32Array(STONE_GPU_CLASS_COUNT * 5), 5);
    indirect.name = "stone-gpu-indirect";
    this.gpuBackend.createIndirectStorageAttribute(indirect);
    this.materialHandle = createStoneNodeMaterial(this.currentLighting, { instanceA, instanceB, capacity }, this.hydrologyWater);

    this.indexCounts = [0, 0, 0];
    for (const classId of STONE_CLASSES) {
      const draw = this.createDraw(classId, maxInstances, indirect);
      this.indexCounts[draw.classIndex] = this.indexCountFor(draw.mesh.geometry);
      this.draws.push(draw);
      this.root.add(draw.mesh);
    }
    this.applyClassVisibility();

    const buffers: StoneGpuScatterBuffers = {
      instanceA: this.gpuBufferForAttribute(instanceA),
      instanceB: this.gpuBufferForAttribute(instanceB),
      indirectArgs: this.gpuBufferForAttribute(indirect),
    };
    const edits = resolveDigEdits(getDigEditsSnapshot());
    void StoneGpuScatterCompute.create(this.gpuDevice, edits, buffers, this.hydrologyGpuData)
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

  /** GPU stones use the same camera-centred ring model as trees and grass. */
  update(center: THREE.Vector3): void {
    if (!this.settings.enabled || !this.scatterCompute || this.draws.length === 0) return;
    const refreshDistance = Math.max(STONE_RING_MIN_REFRESH_M, this.settings.ringRefreshDistanceM);
    if (!this.drawsReady || distance2d(this.lastScatterCenter, center) >= refreshDistance) {
      this.scatterForCenter(center);
    }
  }

  getStats(): StoneStats {
    return { ...this.stats };
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.root);
  }

  private scatterForCenter(center: THREE.Vector3): void {
    const compute = this.scatterCompute;
    if (!compute || this.scatterRunning) return;
    const generation = this.generation;
    const centerX = clampFinite(center.x, 0, this.worldCells);
    const centerZ = clampFinite(center.z, 0, this.worldCells);
    this.scatterRunning = true;
    void compute.run({
      worldCells: this.worldCells,
      centerX,
      centerZ,
      settings: this.settings,
      indexCounts: this.indexCounts,
    }).then((counts) => {
      if (generation !== this.generation || compute !== this.scatterCompute) return;
      this.drawsReady = true;
      this.stats.large = counts.large;
      this.stats.medium = counts.medium;
      this.stats.small = counts.small;
      this.stats.total = counts.large + counts.medium + counts.small;
      this.stats.groups = this.draws.length;
      this.lastScatterCenter.set(centerX, 0, centerZ);
      this.applyClassVisibility();
      this.onStats?.(this.getStats());
    }).catch((error) => {
      if (generation !== this.generation) return;
      console.warn("stone GPU ring scatter failed", error);
    }).finally(() => {
      if (generation === this.generation) this.scatterRunning = false;
    });
  }

  private createDraw(
    classId: StoneClass,
    maxInstances: number,
    indirect: StorageBufferAttribute,
  ): StoneDraw {
    if (!this.materialHandle) throw new Error("Stone material must exist before creating draws");
    const classIndex = CLASS_INDEX[classId];
    const seed = hashCombine(this.settings.seedSalt >>> 0, hashString(`stone-gpu:${classId}`));
    const built = buildRock(DRAW_PRESET[classId], new Rng(seed), DRAW_DETAIL[classId]);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", built.geometry.getAttribute("position"));
    geometry.setAttribute("normal", built.geometry.getAttribute("normal"));
    geometry.setAttribute("vdata", built.geometry.getAttribute("vdata"));
    geometry.setIndex(built.geometry.getIndex());
    geometry.instanceCount = maxInstances;
    this.setIndirect(geometry, indirect, classIndex * 5 * Uint32Array.BYTES_PER_ELEMENT);
    const mesh = new THREE.Mesh(geometry, this.materialHandle.material);
    mesh.name = `stones-gpu-${classId}`;
    mesh.frustumCulled = false;
    return { classId, classIndex, mesh };
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
    return geometry.getIndex()?.count ?? geometry.getAttribute("position")?.count ?? 0;
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
    this.scatterRunning = false;
    this.lastScatterCenter.set(Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY);
    this.indexCounts = [0, 0, 0];
    this.drawsReady = false;
    for (const draw of this.draws) {
      this.root.remove(draw.mesh);
      draw.mesh.geometry.dispose();
      draw.mesh.material.dispose();
    }
    this.draws = [];
    this.materialHandle?.material.dispose();
    this.materialHandle = null;
    this.stats = emptyStats();
    this.onStats?.(this.getStats());
  }
}

function emptyStats(): StoneStats {
  return { total: 0, large: 0, medium: 0, small: 0, visible: 0, drawnNear: 0, drawnFar: 0, groups: 0 };
}

function distance2d(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function clampFinite(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function cloneLighting(lighting: StoneLighting): StoneLighting {
  return {
    light: lighting.light.clone(),
    sunColor: lighting.sunColor.clone(),
    skyLight: lighting.skyLight.clone(),
    groundLight: lighting.groundLight.clone(),
  };
}
