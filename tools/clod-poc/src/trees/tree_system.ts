import * as THREE from "three";
import type { ClodPageNode, PageFootprint } from "../types.js";
import {
  TREE_LODS,
  TREE_SPECIES,
  type TreeLod,
  type TreeSettings,
  type TreeSpeciesId,
} from "./tree_config.js";
import {
  disposeTreeGeometryMap,
  createTreeGeometryMap,
  type TreeGeometryMap,
} from "./tree_geometry.js";
import {
  emptyTreeGenerationStats,
  generateTreeInstances,
  type TreeGenerationStats,
  type TreeInstance,
  type TreeTerrainSampler,
} from "./tree_instances.js";

export interface TreeSystemOptions {
  scene: THREE.Scene;
  nodes: ClodPageNode[];
  worldCells: number;
  settings: TreeSettings;
  sampler?: TreeTerrainSampler;
}

export interface TreeStats extends TreeGenerationStats {
  totalTrees: number;
  patches: number;
  visiblePatches: number;
  culledPatches: number;
  nearTrees: number;
  midTrees: number;
  farTrees: number;
}

interface TreePatch {
  nodeId: string;
  footprint: PageFootprint;
  centerX: number;
  centerZ: number;
  radius: number;
  instances: TreeInstance[];
  group: THREE.Group;
  meshes: Record<TreeSpeciesId, Record<TreeLod, THREE.InstancedMesh>>;
  visible: boolean;
  generationStats: TreeGenerationStats;
}

const LOD_COLORS: Record<TreeLod, number> = {
  near: 0x2e7d32,
  mid: 0xd98032,
  far: 0x3a6ea5,
};

export class TreeSystem {
  private readonly scene: THREE.Scene;
  private readonly nodes: ClodPageNode[];
  private readonly worldCells: number;
  private readonly root = new THREE.Group();
  private readonly sampler: TreeTerrainSampler | undefined;
  private readonly matrix = new THREE.Matrix4();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly translation = new THREE.Vector3();
  private readonly upAxis = new THREE.Vector3(0, 1, 0);
  private settings: TreeSettings;
  private geometries: TreeGeometryMap;
  private readonly regularMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent: false,
  });
  private readonly debugMaterials: Record<TreeLod, THREE.MeshBasicMaterial> = {
    near: new THREE.MeshBasicMaterial({ color: LOD_COLORS.near, side: THREE.DoubleSide, transparent: false }),
    mid: new THREE.MeshBasicMaterial({ color: LOD_COLORS.mid, side: THREE.DoubleSide, transparent: false }),
    far: new THREE.MeshBasicMaterial({ color: LOD_COLORS.far, side: THREE.DoubleSide, transparent: false }),
  };
  private patches: TreePatch[] = [];
  private patchesDirty = true;
  private readonly lastRefreshCenter = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0);
  private readonly lastCenter: THREE.Vector3;
  private stats: TreeStats = emptyTreeStats();

  constructor(options: TreeSystemOptions) {
    this.scene = options.scene;
    this.nodes = options.nodes
      .filter((node) => node.level === 0)
      .sort((a, b) => a.footprint.minZ - b.footprint.minZ || a.footprint.minX - b.footprint.minX);
    this.worldCells = options.worldCells;
    this.settings = { ...options.settings };
    this.sampler = options.sampler;
    this.geometries = createTreeGeometryMap(this.settings);
    this.lastCenter = new THREE.Vector3(this.worldCells * 0.5, 0, this.worldCells * 0.5);
    this.root.name = "trees";
    this.scene.add(this.root);
    this.root.visible = this.settings.enabled;
    if (this.settings.enabled) this.rebuild();
  }

  setEnabled(enabled: boolean): void {
    const wasEnabled = this.settings.enabled;
    this.settings.enabled = enabled;
    this.root.visible = enabled;
    if (enabled && !wasEnabled) this.refreshForCenter(this.lastCenter);
    if (!enabled) this.updateStats();
  }

  updateSettings(settings: Partial<TreeSettings>): void {
    const needsGeometry = settings.species !== undefined && settings.species !== this.settings.species;
    Object.assign(this.settings, settings);
    if (needsGeometry) {
      disposeTreeGeometryMap(this.geometries);
      this.geometries = createTreeGeometryMap(this.settings);
      this.clearPatches();
    }
    this.applyMaterials();
    this.patchesDirty = true;
    this.setEnabled(this.settings.enabled);
  }

  update(_timeSeconds: number, center: THREE.Vector3): void {
    this.lastCenter.copy(center);
    if (!this.settings.enabled) {
      this.updateStats();
      return;
    }
    if (this.patchesDirty || this.lastRefreshCenter.distanceTo(center) >= this.settings.refreshDistanceM) {
      this.refreshForCenter(center);
    }
    this.updatePatchLods(center);
  }

  rebuild(): void {
    this.clearPatches();
    if (this.settings.enabled) this.refreshForCenter(this.lastCenter);
    this.root.visible = this.settings.enabled;
  }

  rebuildNodePatches(nodeIds: Iterable<string>): void {
    const ids = new Set(nodeIds);
    if (ids.size === 0) return;
    const retained: TreePatch[] = [];
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
    disposeTreeGeometryMap(this.geometries);
    this.regularMaterial.dispose();
    for (const material of Object.values(this.debugMaterials)) material.dispose();
  }

  getStats(): TreeStats {
    this.updateStats();
    return { ...this.stats };
  }

  private refreshForCenter(center: THREE.Vector3): void {
    this.lastRefreshCenter.copy(center);
    this.patchesDirty = false;
    const distance = this.settings.distanceM;
    const retained: TreePatch[] = [];
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
    let totalTrees = this.patches.reduce((sum, patch) => sum + patch.instances.length, 0);
    let added = 0;
    for (const { node } of candidates) {
      if (added >= this.settings.maxNewPatchesPerFrame || totalTrees >= this.settings.maxInstances) break;
      const patch = this.createPatch(node, this.settings.maxInstances - totalTrees);
      totalTrees += patch.instances.length;
      this.patches.push(patch);
      this.root.add(patch.group);
      added++;
    }

    if (added < candidates.length) this.patchesDirty = true;
    this.updatePatchLods(center);
  }

  private createPatch(node: ClodPageNode, capacityLeft: number): TreePatch {
    const generationStats = emptyTreeGenerationStats();
    const instances = generateTreeInstances(
      node.footprint,
      this.settings,
      capacityLeft,
      generationStats,
      this.sampler,
      this.worldCells,
    );
    const group = new THREE.Group();
    group.name = `tree-patch-${node.id}`;
    const meshes = {} as Record<TreeSpeciesId, Record<TreeLod, THREE.InstancedMesh>>;
    for (const species of TREE_SPECIES) {
      const speciesCapacity = Math.max(1, instances.filter((instance) => instance.species === species).length);
      meshes[species] = {} as Record<TreeLod, THREE.InstancedMesh>;
      for (const lod of TREE_LODS) {
        const mesh = new THREE.InstancedMesh(
          this.geometries[species][lod],
          this.materialFor(lod),
          speciesCapacity,
        );
        mesh.name = `trees-${node.id}-${species}-${lod}`;
        mesh.count = 0;
        // Instance matrices are world-space while InstancedMesh bounds remain at origin; disable culling until per-patch bounds exist.
        mesh.frustumCulled = false;
        mesh.castShadow = this.settings.render.shadowsNearOnly && lod === "near";
        mesh.receiveShadow = false;
        meshes[species][lod] = mesh;
        group.add(mesh);
      }
    }
    return {
      nodeId: node.id,
      footprint: node.footprint,
      centerX: footprintCenterX(node.footprint),
      centerZ: footprintCenterZ(node.footprint),
      radius: footprintRadius(node.footprint),
      instances,
      group,
      meshes,
      visible: false,
      generationStats,
    };
  }

  private updatePatchLods(center: THREE.Vector3): void {
    const nearDistance = this.settings.distanceM * this.settings.lod.nearFraction;
    const midDistance = this.settings.distanceM * this.settings.lod.midFraction;
    const farDistance = this.settings.distanceM * this.settings.lod.farFraction;
    const counts = new Map<THREE.InstancedMesh, number>();
    for (const patch of this.patches) {
      patch.visible = distance2d(center.x, center.z, patch.centerX, patch.centerZ) <= farDistance + patch.radius;
      patch.group.visible = patch.visible;
      for (const species of TREE_SPECIES) {
        for (const lod of TREE_LODS) {
          patch.meshes[species][lod].count = 0;
          counts.set(patch.meshes[species][lod], 0);
        }
      }
      if (!patch.visible) continue;
      for (const instance of patch.instances) {
        const distance = distance2d(center.x, center.z, instance.position[0], instance.position[2]);
        if (distance > farDistance) continue;
        const lod: TreeLod = distance <= nearDistance ? "near" : distance <= midDistance ? "mid" : "far";
        const mesh = patch.meshes[instance.species][lod];
        const index = counts.get(mesh) ?? 0;
        if (index >= mesh.instanceMatrix.count) continue;
        this.translation.set(instance.position[0], instance.position[1], instance.position[2]);
        this.rotation.setFromAxisAngle(this.upAxis, instance.rotationY);
        this.scale.setScalar(instance.scale);
        this.matrix.compose(this.translation, this.rotation, this.scale);
        mesh.setMatrixAt(index, this.matrix);
        counts.set(mesh, index + 1);
      }
      for (const species of TREE_SPECIES) {
        for (const lod of TREE_LODS) {
          const mesh = patch.meshes[species][lod];
          mesh.count = counts.get(mesh) ?? 0;
          mesh.instanceMatrix.needsUpdate = true;
        }
      }
    }
    this.updateStats();
  }

  private materialFor(lod: TreeLod): THREE.Material {
    return this.settings.render.debugColorByLod ? this.debugMaterials[lod] : this.regularMaterial;
  }

  private applyMaterials(): void {
    for (const patch of this.patches) {
      for (const species of TREE_SPECIES) {
        for (const lod of TREE_LODS) {
          const mesh = patch.meshes[species][lod];
          mesh.material = this.materialFor(lod);
          mesh.castShadow = this.settings.render.shadowsNearOnly && lod === "near";
        }
      }
    }
  }

  private clearPatches(): void {
    for (const patch of this.patches) this.removePatch(patch);
    this.patches = [];
    this.updateStats();
  }

  private removePatch(patch: TreePatch): void {
    this.root.remove(patch.group);
    for (const species of TREE_SPECIES) {
      for (const lod of TREE_LODS) patch.meshes[species][lod].dispose();
    }
  }

  private updateStats(): void {
    const stats = emptyTreeStats();
    for (const patch of this.patches) {
      stats.totalTrees += patch.instances.length;
      stats.patches++;
      if (patch.visible) stats.visiblePatches++;
      else stats.culledPatches++;
      stats.generatedCandidates += patch.generationStats.generatedCandidates;
      stats.acceptedCandidates += patch.generationStats.acceptedCandidates;
      stats.rejectedSlope += patch.generationStats.rejectedSlope;
      stats.rejectedHeight += patch.generationStats.rejectedHeight;
      stats.rejectedMaterial += patch.generationStats.rejectedMaterial;
      for (const species of TREE_SPECIES) {
        stats.nearTrees += patch.meshes[species].near.count;
        stats.midTrees += patch.meshes[species].mid.count;
        stats.farTrees += patch.meshes[species].far.count;
      }
    }
    this.stats = stats;
  }
}

function emptyTreeStats(): TreeStats {
  return {
    totalTrees: 0,
    patches: 0,
    visiblePatches: 0,
    culledPatches: 0,
    nearTrees: 0,
    midTrees: 0,
    farTrees: 0,
    generatedCandidates: 0,
    acceptedCandidates: 0,
    rejectedSlope: 0,
    rejectedHeight: 0,
    rejectedMaterial: 0,
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
  return Math.hypot(ax - bx, az - bz);
}
