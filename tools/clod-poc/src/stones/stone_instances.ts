// GPU-driven stone overlay. Boot scatter writes per-class instance regions and indirect draw
// arguments; per-frame updates do not scatter or upload instance matrices.

import * as THREE from "three";
import {
  StorageBufferAttribute,
  StorageInstancedBufferAttribute,
} from "three/webgpu";
import { getDigEditsSnapshot } from "../terrain.js";
import type { ClodPageNode } from "../types.js";
import {
  STONE_GPU_CLASS_COUNT,
  StoneGpuScatterCompute,
  stoneGpuClassRegion,
  stoneGpuScatterUnsupportedReason,
  type StoneGpuScatterBuffers,
} from "../gpu/stone_scatter_compute.js";
import { resolveDigEdits } from "../gpu/terrain_field_core.js";
import {
  createStoneNodeMaterial,
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
  /** Called when async boot scatter finishes and `getStats()` counts become valid. */
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

export class StoneSystem {
  private readonly scene: THREE.Scene;
  private readonly worldCells: number;
  private readonly gpuDevice: GPUDevice | null;
  private readonly gpuBackend: StoneWebGpuBackendAccess | null;
  private readonly onStats: ((stats: StoneStats) => void) | null;
  private readonly root = new THREE.Group();
  private settings: StoneSettings;
  private currentLighting: StoneLighting;
  private visibleClasses = new Set<StoneClass>(STONE_CLASSES);
  private draws: StoneDraw[] = [];
  private materialHandle: StoneNodeMaterialHandle | null = null;
  private scatterCompute: StoneGpuScatterCompute | null = null;
  private generation = 0;
  private stats: StoneStats = emptyStats();

  constructor(options: StoneSystemOptions) {
    this.scene = options.scene;
    void options.nodes;
    this.worldCells = options.worldCells;
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
    const capacity = maxInstances * STONE_GPU_CLASS_COUNT;
    const instanceA = this.createStorageInstancedAttribute("instance-a", capacity);
    const instanceB = this.createStorageInstancedAttribute("instance-b", capacity);
    const indirect = new StorageBufferAttribute(new Uint32Array(STONE_GPU_CLASS_COUNT * 5), 5);
    indirect.name = "stone-gpu-indirect";
    this.gpuBackend.createIndirectStorageAttribute(indirect);
    this.materialHandle = createStoneNodeMaterial(this.currentLighting, { instanceA, instanceB, capacity });

    const indexCounts: [number, number, number] = [0, 0, 0];
    for (const classId of STONE_CLASSES) {
      const draw = this.createDraw(classId, maxInstances, indirect);
      indexCounts[draw.classIndex] = this.indexCountFor(draw.mesh.geometry);
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
    void StoneGpuScatterCompute.create(this.gpuDevice, edits, buffers)
      .then(async (compute) => {
        if (generation !== this.generation) {
          compute.destroy();
          return;
        }
        this.scatterCompute = compute;
        const counts = await compute.run({
          worldCells: this.worldCells,
          settings: this.settings,
          indexCounts,
        });
        if (generation !== this.generation) {
          compute.destroy();
          return;
        }
        compute.destroy();
        this.scatterCompute = null;
        this.stats.large = counts.large;
        this.stats.medium = counts.medium;
        this.stats.small = counts.small;
        this.stats.total = counts.large + counts.medium + counts.small;
        this.stats.groups = this.draws.length;
        this.refreshVisibleStats();
        this.onStats?.(this.getStats());
      })
      .catch((error) => {
        if (generation !== this.generation) return;
        console.warn("stone GPU scatter failed", error);
      });
  }

  /** GPU stones are boot-scattered and indirect-drawn; no per-frame CPU matrix writes. */
  update(_center: THREE.Vector3): void {}

  getStats(): StoneStats {
    return { ...this.stats };
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.root);
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
      draw.mesh.visible = this.visibleClasses.has(draw.classId);
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
    for (const draw of this.draws) {
      this.root.remove(draw.mesh);
      draw.mesh.geometry.dispose();
    }
    this.draws = [];
    this.materialHandle?.material.dispose();
    this.materialHandle = null;
    this.stats = emptyStats();
  }
}

function cloneLighting(lighting: StoneLighting): StoneLighting {
  return {
    light: lighting.light.clone(),
    sunColor: lighting.sunColor.clone(),
    skyLight: lighting.skyLight.clone(),
    groundLight: lighting.groundLight.clone(),
  };
}

function emptyStats(): StoneStats {
  return { total: 0, large: 0, medium: 0, small: 0, visible: 0, drawnNear: 0, drawnFar: 0, groups: 0 };
}

export { stoneGpuClassRegion };
