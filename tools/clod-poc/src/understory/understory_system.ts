import * as THREE from "three";
import type { ClodPageNode, PageFootprint } from "../types.js";
import { UNDERSTORY_CLASSES, type UnderstoryClass, type UnderstorySettings } from "./understory_config.js";
import {
  createUnderstoryGeometryMap,
  disposeUnderstoryGeometryMap,
  type UnderstoryGeometryMap,
} from "./understory_geometry.js";
import {
  emptyUnderstoryGenerationStats,
  generateUnderstoryInstances,
  type UnderstoryGenerationStats,
  type UnderstoryInstance,
  type UnderstoryTerrainSampler,
} from "./understory_instances.js";
import { createUnderstoryMaterialHandle, type UnderstoryMaterialHandle } from "./understory_material.js";
import type { ForestLightingMaterialState } from "../forest_lighting/index.js";

export interface UnderstorySystemOptions {
  scene: THREE.Scene;
  nodes: ClodPageNode[];
  worldCells: number;
  settings: UnderstorySettings;
  sampler?: UnderstoryTerrainSampler;
}

export interface UnderstoryStats extends UnderstoryGenerationStats {
  totalInstances: number;
  patches: number;
  visiblePatches: number;
  culledPatches: number;
  shrub: number;
  fern: number;
  sapling: number;
  flower: number;
  deadLog: number;
  stump: number;
}

export interface UnderstoryLightingProxy {
  x: number;
  z: number;
  classId: UnderstoryClass;
  scale: number;
  densityWeight: number;
}

interface UnderstoryPatch {
  nodeId: string;
  footprint: PageFootprint;
  centerX: number;
  centerZ: number;
  radius: number;
  group: THREE.Group;
  instances: UnderstoryInstance[];
  meshes: Record<UnderstoryClass, THREE.InstancedMesh>;
  visible: boolean;
  generationStats: UnderstoryGenerationStats;
}

const INSTANCE_ATTRIBUTE_EPSILON = 1e-5;

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

  constructor(options: UnderstorySystemOptions) {
    this.scene = options.scene;
    this.nodes = options.nodes
      .filter((node) => node.level === 0)
      .sort((a, b) => a.footprint.minZ - b.footprint.minZ || a.footprint.minX - b.footprint.minX);
    this.worldCells = options.worldCells;
    this.settings = options.settings;
    this.sampler = options.sampler;
    this.geometries = createUnderstoryGeometryMap(this.settings);
    this.materialHandle = createUnderstoryMaterialHandle(this.settings);
    this.lastCenter = new THREE.Vector3(this.worldCells * 0.5, 0, this.worldCells * 0.5);
    this.root.name = "understory";
    this.root.visible = this.settings.enabled;
    this.scene.add(this.root);
    if (this.settings.enabled) this.rebuild();
  }

  setEnabled(enabled: boolean): void {
    const wasEnabled = this.settings.enabled;
    this.settings.enabled = enabled;
    this.root.visible = enabled;
    if (enabled && !wasEnabled) this.refreshForCenter(this.lastCenter);
    if (!enabled) this.updateStats();
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
    if (needsPatchRefresh) this.patchesDirty = true;
    this.setEnabled(this.settings.enabled);
  }

  update(timeSeconds: number, center: THREE.Vector3): void {
    this.materialHandle.setTime(timeSeconds);
    this.lastCenter.copy(center);
    if (!this.settings.enabled) {
      this.updateStats();
      return;
    }
    if (this.patchesDirty || this.lastRefreshCenter.distanceTo(center) >= this.settings.refreshDistanceM) {
      this.refreshForCenter(center);
    } else {
      this.updatePatchVisibility(center);
    }
  }

  rebuild(): void {
    this.clearPatches();
    if (this.settings.enabled) this.refreshForCenter(this.lastCenter);
    this.root.visible = this.settings.enabled;
  }

  rebuildNodePatches(nodeIds: Iterable<string>): void {
    const ids = new Set(nodeIds);
    if (ids.size === 0) return;
    const retained: UnderstoryPatch[] = [];
    for (const patch of this.patches) {
      if (ids.has(patch.nodeId)) this.removePatch(patch);
      else retained.push(patch);
    }
    this.patches = retained;
    this.refreshForCenter(this.lastCenter);
  }

  dispose(): void {
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
    for (const { node } of candidates) {
      if (added >= this.settings.maxNewPatchesPerFrame || totalInstances >= this.settings.maxInstances) break;
      const patch = this.createPatch(node, this.settings.maxInstances - totalInstances);
      totalInstances += patch.instances.length;
      this.patches.push(patch);
      this.root.add(patch.group);
      added++;
    }
    if (added < candidates.length) this.patchesDirty = true;
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
    this.stats = stats;
  }
}

export function emptyUnderstoryStats(): UnderstoryStats {
  return {
    totalInstances: 0,
    patches: 0,
    visiblePatches: 0,
    culledPatches: 0,
    shrub: 0,
    fern: 0,
    sapling: 0,
    flower: 0,
    deadLog: 0,
    stump: 0,
    ...emptyUnderstoryGenerationStats(),
  };
}

function mergeGenerationStats(target: UnderstoryGenerationStats, source: UnderstoryGenerationStats): void {
  target.generatedCandidates += source.generatedCandidates;
  target.acceptedCandidates += source.acceptedCandidates;
  target.rejectedSlope += source.rejectedSlope;
  target.rejectedHeight += source.rejectedHeight;
  target.rejectedMaterial += source.rejectedMaterial;
  target.rejectedEcology += source.rejectedEcology;
  target.rejectedSpacing += source.rejectedSpacing;
  target.acceptedShrub += source.acceptedShrub;
  target.acceptedFern += source.acceptedFern;
  target.acceptedSapling += source.acceptedSapling;
  target.acceptedFlower += source.acceptedFlower;
  target.acceptedDeadLog += source.acceptedDeadLog;
  target.acceptedStump += source.acceptedStump;
}

function clampFootprint(footprint: PageFootprint, worldCells: number): PageFootprint {
  return {
    minX: THREE.MathUtils.clamp(footprint.minX, 0, worldCells),
    minZ: THREE.MathUtils.clamp(footprint.minZ, 0, worldCells),
    maxX: THREE.MathUtils.clamp(footprint.maxX, 0, worldCells),
    maxZ: THREE.MathUtils.clamp(footprint.maxZ, 0, worldCells),
  };
}

function footprintCenterX(footprint: PageFootprint): number {
  return (footprint.minX + footprint.maxX) * 0.5;
}

function footprintCenterZ(footprint: PageFootprint): number {
  return (footprint.minZ + footprint.maxZ) * 0.5;
}

function footprintRadius(footprint: PageFootprint): number {
  return Math.hypot(footprint.maxX - footprint.minX, footprint.maxZ - footprint.minZ) * 0.5;
}

function distance2d(ax: number, az: number, bx: number, bz: number): number {
  if (Math.abs(ax - bx) < INSTANCE_ATTRIBUTE_EPSILON && Math.abs(az - bz) < INSTANCE_ATTRIBUTE_EPSILON) return 0;
  return Math.hypot(ax - bx, az - bz);
}
